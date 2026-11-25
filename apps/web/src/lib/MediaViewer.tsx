import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, ExternalLink, FolderOpen, Image as ImageIcon, X } from 'lucide-react';
import { useStore } from './store';
import { api, mediaUrl } from './api';
import { desktop } from './desktop';
import { ZoomImage } from './ZoomImage';

/**
 * Visualizador em tela grande: lâmina por lâmina (setas do teclado também), vídeo com player e o link do Drive de cada
 * arquivo. Abre por cima de qualquer painel ou modal.
 */

const IMG = /\.(png|jpe?g|webp|gif)$/i;
const VID = /\.(mp4|mov|webm|m4v)$/i;
const name = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function MediaViewer({ files, title, start = 0, onClose }: { files: string[]; title: string; start?: number; onClose: () => void }) {
  const { office, notify } = useStore();
  const [i, setI] = useState(Math.min(start, Math.max(0, files.length - 1)));
  const file = files[i];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); }
      if (e.key === 'ArrowRight') setI((n) => Math.min(files.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [files.length, onClose]);
  const link = async () => {
    try { return (await api<{ link: string | null }>(`/api/offices/${office!.id}/link?path=${encodeURIComponent(file)}`)).link; } catch { return null; }
  };
  const openDrive = async () => { const l = await link(); if (l) window.open(l, '_blank'); else notify('O Drive ainda não deu o link deste arquivo (pode estar subindo).'); };
  const copyLink = async () => {
    const l = await link();
    if (!l) { notify('O Drive ainda não deu o link deste arquivo (pode estar subindo).'); return; }
    try { await navigator.clipboard.writeText(l); notify('Link copiado'); } catch { notify(l); }
  };

  return (
    <div className="modal-bg top viewer-bg" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <header className="viewer-head">
          <b className="truncate" title={title}>{title}</b>
          {files.length > 1 && <span className="muted small mono">{i + 1}/{files.length}</span>}
          <span className="spacer" />
          {file && <button className="ghost small" onClick={openDrive}><ExternalLink size={13} /> No Drive</button>}
          {file && <button className="ghost small" onClick={copyLink}><Copy size={13} /> Copiar link</button>}
          {file && desktop && <button className="icon" title="Mostrar na pasta" onClick={() => desktop!.showInFolder(file)}><FolderOpen size={14} /></button>}
          <button className="icon" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </header>
        <div className="viewer-stage">
          {!file ? <div className="post-empty"><ImageIcon size={22} /><span className="muted small">Nenhum arquivo para mostrar.</span></div>
            : VID.test(file) ? <video key={file} src={mediaUrl(office!.id, file)} controls autoPlay />
            : IMG.test(file) ? <ZoomImage key={file} src={mediaUrl(office!.id, file)} alt={name(file)} />
            : <div className="post-empty"><span className="muted small">{name(file)}: sem prévia para este tipo.</span></div>}
          {files.length > 1 && (
            <>
              <button className="icon post-nav prev" aria-label="Anterior" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={20} /></button>
              <button className="icon post-nav next" aria-label="Próxima" disabled={i >= files.length - 1} onClick={() => setI(i + 1)}><ChevronRight size={20} /></button>
            </>
          )}
        </div>
        {files.length > 1 && (
          <div className="post-strip viewer-strip">
            {files.map((f, n) => (
              <button key={f} className={n === i ? 'on' : ''} title={name(f)} onClick={() => setI(n)}>
                {IMG.test(f) || VID.test(f) ? <img src={`/api/offices/${office!.id}/thumb?w=120&path=${encodeURIComponent(f)}`} alt="" loading="lazy" /> : <span className="mono small">{n + 1}</span>}
              </button>
            ))}
          </div>
        )}
        {file && <div className="muted small truncate viewer-file" title={file}>{name(file)}</div>}
      </div>
    </div>
  );
}
