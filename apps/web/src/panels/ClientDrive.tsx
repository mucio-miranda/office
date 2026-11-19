import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Copy, ExternalLink, FileText, Film, Folder, FolderOpen, Image, Music, RefreshCw, Search, Trash2 } from 'lucide-react';
import { canWork } from '@office/shared';
import type { Client } from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { desktop } from '../lib/desktop';
import { Preview, type IndexedFile } from './Archive';

/**
 * As pastas do cliente como estão no Drive, para ninguém precisar abrir o Drive: uma pasta por vez, com caminho clicável,
 * atalhos (este mês, mês passado, identidade visual), miniaturas, prévia e o link do Drive de cada pasta e arquivo.
 * Usado na aba Arquivos do cliente e na página Arquivos (o armário).
 */

type Kind = IndexedFile['kind'] | 'pasta';
interface Entry { name: string; rel: string; dir: boolean; size: number; mtime: string; kind: Kind; items?: number }
interface Listing { base: string; rel: string; crumbs: { name: string; rel: string }[]; exists: boolean; entries: Entry[]; shortcuts: { label: string; rel: string }[] }

const THUMB = /\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm)$/i;
const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const absOf = (base: string, rel: string) => `${base.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}`;

function KindIcon({ kind, size = 22 }: { kind: Kind; size?: number }) {
  if (kind === 'pasta') return <Folder size={size} />;
  if (kind === 'video') return <Film size={size} />;
  if (kind === 'audio') return <Music size={size} />;
  if (kind === 'imagem' || kind === 'design') return <Image size={size} />;
  return <FileText size={size} />;
}

export function ClientDrive({ c }: { c: Client }) {
  const { office, notify } = useStore();
  const api0 = `/api/offices/${office!.id}/clients/${c.id}`;
  const [rel, setRel] = useState('');
  const [list, setList] = useState<Listing | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [rootShortcuts, setRootShortcuts] = useState<Listing['shortcuts']>([]);
  const [confirmDel, setConfirmDel] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canDelete = canWork(office!.role);
  // pasta de primeiro nível (REDES SOCIAIS, ARQUIVOS – …) não se apaga por aqui
  const deletable = (e: Entry) => canDelete && (!e.dir || e.rel.includes('/'));
  const remove = async (e: Entry) => {
    setDeleting(true);
    try {
      const r = await api<{ deleted: string[]; refused: { rel: string; why: string }[]; trash: 'drive' | 'office' }>(`${api0}/pasta/apagar`, { body: { rels: [e.rel] } });
      if (r.deleted.length) notify(`${e.name} apagado. ${r.trash === 'drive' ? 'Fica 30 dias na lixeira do Google Drive.' : 'Foi para a lixeira do Office.'}`);
      else notify(`Não apaguei ${e.name}: ${r.refused[0]?.why ?? 'erro'}`);
      if (open?.rel === e.rel) setOpen(null);
      load();
    } catch (x) { notify((x as Error).message); }
    finally { setDeleting(false); setConfirmDel(null); }
  };

  const load = (to = rel) => {
    setLoading(true);
    api<Listing>(`${api0}/pasta?rel=${encodeURIComponent(to)}`)
      .then((r) => { setList(r); setErr(''); if (!r.rel) setRootShortcuts(r.shortcuts); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { setRel(''); setOpen(null); setQ(''); load(''); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (to: string) => { setRel(to); setOpen(null); setQ(''); load(to); };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list?.entries ?? []).filter((e) => !t || e.name.toLowerCase().includes(t));
  }, [list, q]);
  const thumb = (e: Entry) => `/api/offices/${office!.id}/thumb?w=240&path=${encodeURIComponent(absOf(list!.base, e.rel))}`;

  const driveLink = async (target: string) => {
    try {
      const r = await api<{ link: string | null }>(`${api0}/pasta/link?rel=${encodeURIComponent(target)}`);
      return r.link;
    } catch { return null; }
  };
  const openDrive = async (target: string) => {
    const link = await driveLink(target);
    if (link) window.open(link, '_blank');
    else if (desktop && list) desktop.openPath(target ? absOf(list.base, target) : list.base);
    else notify('O Drive ainda não sincronizou esta pasta. Tente de novo em instantes.');
  };
  const copyLink = async (target: string) => {
    const link = await driveLink(target);
    if (!link) { notify('O Drive ainda não deu o link (pode estar subindo).'); return; }
    try { await navigator.clipboard.writeText(link); notify('Link do Drive copiado'); } catch { notify(link); }
  };

  const files = shown.filter((e) => !e.dir);
  const step = (n: number) => {
    if (!open) return;
    const i = files.findIndex((f) => f.rel === open.rel);
    const next = files[i + n];
    if (next) setOpen(next);
  };
  useEffect(() => {
    if (!open) return;
    const key = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.closest('input, textarea')) return;
      if (ev.key === 'ArrowRight') step(1);
      if (ev.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className="drive-browser">
      <header className="drive-head">
        <nav className="drive-crumbs" aria-label="Caminho da pasta">
          <button className={!rel ? 'on' : ''} onClick={() => go('')}>{c.name}</button>
          {list?.crumbs.map((b) => (
            <span key={b.rel} className="row"><ChevronRight size={13} className="muted" /><button className={b.rel === rel ? 'on' : ''} onClick={() => go(b.rel)}>{b.name}</button></span>
          ))}
        </nav>
        <div className="row gap wrap">
          <label className="archive-search"><Search size={14} /><input placeholder="Procurar nesta pasta" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="ghost small" onClick={() => openDrive(rel)} title="Abrir esta pasta no Google Drive"><ExternalLink size={13} /> Abrir no Drive</button>
          <button className="ghost small" onClick={() => copyLink(rel)} title="Copiar o link desta pasta no Drive"><Copy size={13} /> Copiar link</button>
          {desktop && list && <button className="icon" onClick={() => desktop!.openPath(rel ? absOf(list.base, rel) : list.base)} title="Abrir no Explorer"><FolderOpen size={14} /></button>}
          <button className="icon" onClick={() => load()} title="Ler a pasta de novo"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        </div>
      </header>
      {rootShortcuts.length > 0 && (
        <div className="chips drive-shortcuts">
          {rootShortcuts.map((s) => <button key={s.rel} className={`chip ${rel === s.rel ? 'on' : ''}`} onClick={() => go(s.rel)} title={s.rel}>{s.label}</button>)}
        </div>
      )}
      <div className={`archive-body ${open ? 'with-preview' : ''}`}>
        <div className="drive-list">
          {err && <div className="error">{err}</div>}
          {list && !list.exists && <p className="muted small">Esta pasta não existe (o Drive pode estar desconectado).</p>}
          {list?.exists && list.entries.length === 0 && <p className="muted small">Pasta vazia.</p>}
          {list && list.entries.length > 0 && shown.length === 0 && <p className="muted small">Nada com "{q}" nesta pasta.</p>}
          <div className="drive-grid">
            {shown.map((e) => (
              <div key={e.rel} className="drive-tile-wrap">
              <button className={`drive-tile ${e.dir ? 'folder' : ''} ${open?.rel === e.rel ? 'on' : ''}`}
                onClick={() => (e.dir ? go(e.rel) : setOpen(e))} title={e.name}>
                <span className="drive-thumb">
                  {!e.dir && THUMB.test(e.name)
                    ? <img src={thumb(e)} alt="" loading="lazy" onError={(x) => { x.currentTarget.style.display = 'none'; }} />
                    : <KindIcon kind={e.kind} />}
                </span>
                <span className="drive-name">{e.name}</span>
                <small className="muted">{e.dir ? `${e.items ?? 0} ${e.items === 1 ? 'item' : 'itens'}` : mb(e.size)}</small>
              </button>
              {deletable(e) && <button className="icon drive-del" onClick={() => setConfirmDel(e)} title={`Apagar ${e.dir ? 'pasta' : 'arquivo'}`} aria-label={`Apagar ${e.name}`}><Trash2 size={13} /></button>}
              </div>
            ))}
          </div>
        </div>
        {open && list && (
          <div className="drive-preview">
            <Preview key={open.rel} c={c} f={{ rel: open.rel, size: open.size, mtime: open.mtime, kind: open.kind as IndexedFile['kind'] }} abs={absOf(list.base, open.rel)} onClose={() => setOpen(null)} />
            <div className="row gap wrap drive-preview-links">
              <button className="ghost small" onClick={() => openDrive(open.rel)}><ExternalLink size={13} /> Arquivo no Drive</button>
              <button className="ghost small" onClick={() => copyLink(open.rel)}><Copy size={13} /> Copiar link</button>
              {deletable(open) && <button className="ghost small danger" onClick={() => setConfirmDel(open)}><Trash2 size={13} /> Apagar</button>}
              {files.length > 1 && <span className="muted small">← → passa os arquivos</span>}
            </div>
          </div>
        )}
      </div>
      {confirmDel && (
        <div className="modal-bg top" onClick={() => !deleting && setConfirmDel(null)}>
          <div className="modal drive-confirm" role="dialog" aria-modal="true" onClick={(ev) => ev.stopPropagation()}>
            <h3>Apagar {confirmDel.dir ? 'a pasta' : 'o arquivo'}?</h3>
            <p><b>{confirmDel.name}</b>{confirmDel.dir ? ` e tudo o que está dentro (${confirmDel.items ?? 0} ${confirmDel.items === 1 ? 'item' : 'itens'})` : ''}, de {c.name}.</p>
            <p className="muted small">Sai da pasta para todo mundo. No Drive, fica 30 dias na lixeira do Google Drive, de onde dá para restaurar.</p>
            <div className="row gap" style={{ justifyContent: 'flex-end' }}>
              <button className="ghost" disabled={deleting} onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button className="danger" disabled={deleting} onClick={() => remove(confirmDel)}><Trash2 size={14} /> {deleting ? 'Apagando…' : 'Apagar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
