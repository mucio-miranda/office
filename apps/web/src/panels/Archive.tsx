import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Film, FolderOpen, Image, Music, PenLine, RefreshCw, Search, X } from 'lucide-react';
import type { Client } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { desktop } from '../lib/desktop';
import { TextPreview, openFile } from './ReviewDesk';

/**
 * Arquivo dos clientes (o armário da redação): os documentos, fotos e vídeos da pasta de cada cliente por grupo,
 * com prévia de imagem, vídeo, áudio, PDF e texto. Os arquivos nunca saem da pasta: abrir usa o programa padrão
 * do Windows, e editar um PDF vira uma tarefa para o funcionário que tem o PdfCraft.
 */

type Kind = 'imagem' | 'video' | 'audio' | 'doc' | 'design' | 'outro';
interface IndexedFile { rel: string; size: number; mtime: string; kind: Kind }
interface FileGroup { key: string; label: string; count: number; size: number; files: IndexedFile[] }
interface ClientIndex { root: string | null; exists: boolean; total: number; truncated: boolean; groups: FileGroup[] }

const IMG = /\.(png|jpe?g|webp|gif)$/i;
const VID = /\.(mp4|m4v|mov|webm)$/i;
const AUD = /\.(mp3|wav|m4a|ogg|aac|flac)$/i;
const PDF = /\.pdf$/i;
const TXT = /\.(md|txt|csv|json)$/i;
/** Quantos arquivos cada grupo mostra antes de "mostrar todos" (pastas de ensaio têm milhares). */
const PAGE = 60;

const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const name = (rel: string) => rel.split('/').pop() ?? rel;
const dirOf = (rel: string) => rel.split('/').slice(0, -1).join(' / ');
const absOf = (root: string, rel: string) => (root.includes('\\') ? `${root}\\${rel.replace(/\//g, '\\')}` : `${root}/${rel}`);

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
      {current && <ClientFiles key={current.id} c={current} />}
    </div>
  );
}

function ClientFiles({ c }: { c: Client }) {
  const office = useStore((s) => s.office)!;
  const [idx, setIdx] = useState<ClientIndex | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [open, setOpen] = useState<IndexedFile | null>(null);
  const [all, setAll] = useState<Record<string, boolean>>({});
  const load = () => api<ClientIndex>(`/api/offices/${office.id}/clients/${c.id}/files`).then((r) => { setIdx(r); setErr(''); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [c.id, c.folder]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (idx?.groups ?? [])
      .filter((g) => !group || g.key === group)
      .map((g) => ({ ...g, files: term ? g.files.filter((f) => f.rel.toLowerCase().includes(term)) : g.files }))
      .filter((g) => g.files.length);
  }, [idx, q, group]);

  return (
    <div className="archive-main">
      <header className="archive-head">
        <div className="col">
          <b>{c.name}</b>
          <span className="muted small truncate" title={idx?.root ?? ''}>{idx?.root ?? 'Sem pasta definida'}{idx?.total ? ` · ${idx.total}${idx.truncated ? '+' : ''} arquivos` : ''}</span>
        </div>
        <div className="row gap">
          <label className="archive-search"><Search size={14} /><input placeholder="Procurar na pasta" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {desktop && idx?.root && <button className="ghost small" onClick={() => desktop!.openPath(idx.root!)} title="Abrir a pasta no Explorer"><FolderOpen size={14} /> Pasta</button>}
          <button className="icon" onClick={load} title="Ler a pasta de novo"><RefreshCw size={14} /></button>
        </div>
      </header>
      {idx && idx.groups.length > 1 && (
        <div className="chips archive-chips">
          <button className={`chip ${group === null ? 'on' : ''}`} onClick={() => setGroup(null)}>Tudo</button>
          {idx.groups.map((g) => <button key={g.key} className={`chip ${group === g.key ? 'on' : ''}`} onClick={() => setGroup(group === g.key ? null : g.key)}>{g.label} <span className="muted">{g.count}</span></button>)}
        </div>
      )}
      <div className={`archive-body ${open ? 'with-preview' : ''}`}>
        <div className="archive-list">
          {err && <div className="error">{err}</div>}
          {idx && !idx.root && <p className="muted small">Este cliente ainda não tem pasta. Em Clientes, use "Estrutura padrão" para criar uma.</p>}
          {idx?.root && !idx.exists && <p className="muted small">A pasta {idx.root} não existe (o disco pode estar desconectado).</p>}
          {idx?.exists && idx.total === 0 && <p className="muted small">A pasta está vazia.</p>}
          {idx && idx.total > 0 && groups.length === 0 && <p className="muted small">Nada com "{q}".</p>}
          {groups.map((g) => {
            const shown = all[g.key] ? g.files : g.files.slice(0, PAGE);
            const imgs = shown.filter((f) => IMG.test(f.rel));
            const rest = shown.filter((f) => !IMG.test(f.rel));
            return (
              <section key={g.key} className="file-group">
                <div className="row between"><b>{g.label}</b><span className="muted small">{g.count} · {mb(g.size)}</span></div>
                {imgs.length > 0 && (
                  <div className="thumbs">
                    {imgs.map((f) => (
                      <button key={f.rel} className={`thumb ${open?.rel === f.rel ? 'on' : ''}`} onClick={() => setOpen(f)} title={f.rel}>
                        <img src={mediaUrl(office.id, absOf(idx!.root!, f.rel))} alt={name(f.rel)} loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
                {rest.map((f) => (
                  <button key={f.rel} className={`file-row archive-row ${open?.rel === f.rel ? 'on' : ''}`} onClick={() => setOpen(f)} title={f.rel}>
                    <KindIcon kind={f.kind} />
                    <span className="truncate">{name(f.rel)}</span>
                    <span className="muted small truncate">{dirOf(f.rel)}</span>
                    <span className="muted small">{mb(f.size)}</span>
                  </button>
                ))}
                {g.files.length > shown.length && <button className="ghost small" onClick={() => setAll({ ...all, [g.key]: true })}>Mostrar todos ({g.files.length})</button>}
              </section>
            );
          })}
        </div>
        {open && idx?.root && <Preview key={open.rel} c={c} f={open} abs={absOf(idx.root, open.rel)} onClose={() => setOpen(null)} />}
      </div>
    </div>
  );
}

function Preview({ c, f, abs, onClose }: { c: Client; f: IndexedFile; abs: string; onClose: () => void }) {
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
