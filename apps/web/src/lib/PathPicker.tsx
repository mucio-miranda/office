import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Check, File, Folder, FolderOpen, HardDrive, X } from 'lucide-react';
import { api } from './api';

interface Listing {
  path: string;
  parent: string | null;
  places?: { name: string; path: string }[];
  roots?: string[];
  entries: { name: string; path: string; dir: boolean }[];
}

/**
 * Navegador de pastas/arquivos.
 * - scope "system": pastas do computador que roda o Office (só funciona nele mesmo)
 * - scope "office": só dentro da pasta raiz e das extras de um escritório
 */
export function BrowseDialog({ title, scope, officeId, start, pick = 'folder', filter, onPick, onClose }: {
  title: string;
  scope: 'system' | 'office';
  officeId?: string;
  start?: string;
  pick?: 'folder' | 'file';
  filter?: RegExp;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<Listing | null>(null);
  const [err, setErr] = useState('');
  const [typed, setTyped] = useState('');

  const go = (p?: string) => {
    setErr('');
    const base = scope === 'system' ? '/api/system/browse' : `/api/offices/${officeId}/fs`;
    api<Listing>(`${base}${p ? `?path=${encodeURIComponent(p)}` : ''}`)
      .then((d) => { setData(d); setTyped(d.path); })
      .catch((e) => setErr(e.status === 404
        ? 'O servidor do Office está desatualizado. Reinicie (Ctrl+C no terminal e npm start) e tente de novo.'
        : e.message));
  };
  useEffect(() => { go(start || undefined); }, []);

  const places = data?.places ?? data?.roots?.map((r) => ({ name: r.split(/[\\/]/).filter(Boolean).pop() ?? r, path: r })) ?? [];
  const entries = (data?.entries ?? []).filter((e) => e.dir || (pick === 'file' && (!filter || filter.test(e.name))));

  // portal: o diálogo costuma ser aberto de dentro de um <form>; fora dele, não dispara submit nem aninha forms
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className="modal browse" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </header>
        <div className="browse-body">
          <nav className="browse-places">
            {places.map((p) => (
              <button type="button" key={p.path} className={`nav-item ${data?.path === p.path ? 'active' : ''}`} onClick={() => go(p.path)}>
                {/^[A-Z]:\\$/.test(p.path) ? <HardDrive size={14} /> : <Folder size={14} />} {p.name}
              </button>
            ))}
          </nav>
          <div className="browse-main">
            <form className="browse-path" onSubmit={(e) => { e.preventDefault(); go(typed); }}>
              <button type="button" className="icon" disabled={!data?.parent} onClick={() => data?.parent && go(data.parent)} title="Subir"><ArrowUp size={14} /></button>
              <input className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} />
            </form>
            {err && <div className="error">{err}</div>}
            <div className="browse-list">
              {entries.length === 0 && !err && <div className="empty small">Pasta vazia</div>}
              {entries.map((e) => (
                <button type="button" key={e.path} className="browse-row" onDoubleClick={() => (e.dir ? go(e.path) : onPick(e.path))} onClick={() => (e.dir ? go(e.path) : onPick(e.path))}>
                  {e.dir ? <Folder size={15} /> : <File size={15} />}
                  <span>{e.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <footer className="modal-foot">
          <span className="muted small mono truncate">{data?.path}</span>
          <div className="row gap">
            <button type="button" className="ghost" onClick={onClose}>Cancelar</button>
            {pick === 'folder' && <button type="button" className="primary" disabled={!data} onClick={() => data && onPick(data.path)}><Check size={14} /> Selecionar esta pasta</button>}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Campo de caminho: dá para digitar ou clicar em "Procurar" e navegar. */
export function PathField({ value, onChange, placeholder, scope = 'system', officeId, pick = 'folder', filter, title }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  scope?: 'system' | 'office';
  officeId?: string;
  pick?: 'folder' | 'file';
  filter?: RegExp;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="path-field">
      <input className="mono" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      <button type="button" onClick={() => setOpen(true)}><FolderOpen size={14} /> Procurar</button>
      {open && (
        <BrowseDialog title={title ?? (pick === 'folder' ? 'Escolher pasta' : 'Escolher arquivo')} scope={scope} officeId={officeId} start={value || undefined}
          pick={pick} filter={filter} onClose={() => setOpen(false)} onPick={(p) => { onChange(p); setOpen(false); }} />
      )}
    </div>
  );
}

/** Lista de pastas (ex.: pastas extras do escritório) com adicionar navegando e remover. */
export function PathList({ values, onChange, scope = 'system', officeId }: { values: string[]; onChange: (v: string[]) => void; scope?: 'system' | 'office'; officeId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="path-list">
      {values.map((v) => (
        <div key={v} className="path-chip mono">
          <Folder size={13} /> <span className="truncate">{v}</span>
          <button type="button" className="icon" onClick={() => onChange(values.filter((x) => x !== v))} aria-label="Remover"><X size={12} /></button>
        </div>
      ))}
      <button type="button" className="ghost small" onClick={() => setOpen(true)}><FolderOpen size={14} /> Adicionar pasta</button>
      {open && (
        <BrowseDialog title="Adicionar pasta" scope={scope} officeId={officeId} onClose={() => setOpen(false)}
          onPick={(p) => { if (!values.includes(p)) onChange([...values, p]); setOpen(false); }} />
      )}
    </div>
  );
}
