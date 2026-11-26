import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Film, FolderOpen, Image, Music, PenLine, X } from 'lucide-react';
import type { Client } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { desktop } from '../lib/desktop';
import { TextPreview, openFile } from './ReviewDesk';
import { ClientDrive } from './ClientDrive';
import { IMG } from '../lib/media';

/**
 * Arquivo dos clientes (o armário da redação): os pastas de cada cliente como estão no Drive (ClientDrive),
 * com prévia de imagem, vídeo, áudio, PDF e texto. Os arquivos nunca saem da pasta: abrir usa o programa padrão
 * do Windows, e editar um PDF vira uma tarefa para o funcionário que tem o PdfCraft.
 */

type Kind = 'imagem' | 'video' | 'audio' | 'doc' | 'design' | 'outro';
export interface IndexedFile { rel: string; size: number; mtime: string; kind: Kind }

const VID = /\.(mp4|m4v|mov|webm)$/i;
const AUD = /\.(mp3|wav|m4a|ogg|aac|flac)$/i;
const PDF = /\.pdf$/i;
const TXT = /\.(md|txt|csv|json)$/i;

const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const name = (rel: string) => rel.split('/').pop() ?? rel;
const dirOf = (rel: string) => rel.split('/').slice(0, -1).join(' / ');

function KindIcon({ kind, size = 14 }: { kind: Kind; size?: number }) {
  if (kind === 'video') return <Film size={size} />;
  if (kind === 'audio') return <Music size={size} />;
  if (kind === 'imagem' || kind === 'design') return <Image size={size} />;
  return <FileText size={size} />;
}

export function Archive() {
  const { clients, panelArg } = useStore();
  const active = clients.filter((c) => c.status !== 'encerrado');
  const [sel, setSel] = useState<string | null>(panelArg);
  useEffect(() => { if (panelArg) setSel(panelArg); }, [panelArg]);
  const current = clients.find((c) => c.id === sel) ?? active[0] ?? clients[0];
  return (
    <div className="archive-page">
      <aside className="clients-list">
        <small className="muted">Um armário por cliente na redação</small>
        {active.map((c) => (
          <button key={c.id} className={`client-item ${current?.id === c.id ? 'active' : ''}`} onClick={() => setSel(c.id)}>
            <span className="dot" style={{ background: c.color }} />
            <span className="truncate">{c.name}</span>
          </button>
        ))}
        {clients.length === 0 && <p className="muted small">Nenhum cliente ainda. Cadastre em Clientes e o armário aparece na redação.</p>}
      </aside>
      {current && <div className="archive-main"><ClientDrive key={current.id} c={current} /></div>}
    </div>
  );
}

export function Preview({ c, f, abs, onClose }: { c: Client; f: IndexedFile; abs: string; onClose: () => void }) {
  const { office, agents, notify, open } = useStore();
  const url = mediaUrl(office!.id, abs);
  const [ask, setAsk] = useState(false);
  const [text, setText] = useState('');
  // quem edita o PDF: o funcionário com o PdfCraft ligado; sem ninguém, o gerente
  const editor = agents.find((a) => a.tools?.includes('pdfcraft')) ?? agents.find((a) => a.slug === 'gerente');
  const requestEdit = async () => {
    if (!editor || !text.trim()) return;
    try {
      await api(`/api/offices/${office!.id}/jobs`, { body: { agentId: editor.id, prompt:
        `Edite o PDF \`${abs}\` (arquivo do cliente ${c.name}) com o PdfCraft.\n\nO que mudar:\n${text.trim()}\n\n` +
        'Não sobrescreva o original: grave a versão editada na mesma pasta com o sufixo "-editado" (ou "-editado-2" se já existir) e diga o caminho no fim.' } });
      notify(`${editor.name} vai editar ${name(f.rel)}`);
      open('agente', editor.id);
    } catch (e) { notify((e as Error).message); }
  };
  return (
    <aside className="archive-preview">
      <header className="row between">
        <div className="col" style={{ minWidth: 0 }}>
          <b className="truncate" title={f.rel}>{name(f.rel)}</b>
          <span className="muted small">{dirOf(f.rel) || 'raiz da pasta'} · {mb(f.size)} · {new Date(f.mtime).toLocaleDateString('pt-BR')}</span>
        </div>
        <button className="icon" onClick={onClose} title="Fechar a prévia"><X size={16} /></button>
      </header>
      <div className="archive-view">
        {IMG.test(f.rel) ? <img src={url} alt="" />
          : VID.test(f.rel) ? <video src={url} controls preload="metadata" />
          : AUD.test(f.rel) ? <audio src={url} controls preload="metadata" />
          : PDF.test(f.rel) ? <iframe src={url} title={name(f.rel)} />
          : TXT.test(f.rel) ? <TextPreview officeId={office!.id} file={abs} />
          : <div className="archive-none"><KindIcon kind={f.kind} size={28} /><p className="muted small">Sem prévia para este tipo. Abra no programa do computador.</p></div>}
      </div>
      <footer className="row gap wrap">
        <button className="primary small" onClick={() => openFile(abs)}><ExternalLink size={14} /> Abrir</button>
        {desktop && <button className="ghost small" onClick={() => desktop!.showInFolder(abs)}><FolderOpen size={14} /> Mostrar na pasta</button>}
        {PDF.test(f.rel) && editor && <button className="ghost small" onClick={() => setAsk(!ask)}><PenLine size={14} /> Editar com o PdfCraft</button>}
      </footer>
      {ask && editor && (
        <form className="col gap-s" onSubmit={(e) => { e.preventDefault(); requestEdit(); }}>
          <textarea autoFocus rows={3} placeholder="O que mudar? (ex.: trocar o valor da página 2, juntar com o contrato, preencher o nome)" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="muted small">{editor.name} faz a edição e grava uma cópia ao lado. O original não muda.</span>
          <div className="row gap"><button className="primary small" disabled={!text.trim()}>Pedir a {editor.name}</button><button type="button" className="ghost small" onClick={() => setAsk(false)}>Cancelar</button></div>
        </form>
      )}
    </aside>
  );
}
