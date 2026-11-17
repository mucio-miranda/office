import { useEffect, useState } from 'react';
import { Check, CloudUpload, Copy, ExternalLink, FolderOpen, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { POST_FORMAT_LABEL, POST_STATUS_LABEL, needsTunning, type ContentPost, type Demand } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { desktop } from '../lib/desktop';

/**
 * As peças do calendário desta demanda na Mesa: cada uma com a trilha de etapas e o "Aprovar e entregar", que copia os
 * finais para a pasta do mês do cliente no Drive com o nome padrão e devolve o link para mandar à social media.
 */

const TRAIL = ['composicao', 'tunning', 'conferencia', 'aprovado', 'drive'] as const;
const TRAIL_LABEL: Record<(typeof TRAIL)[number], string> = { composicao: 'composição', tunning: 'tunning', conferencia: 'conferência', aprovado: 'aprovada', drive: 'entregue' };
const ORDER = ['planejado', 'referencia', ...TRAIL, 'programado', 'postado'];
const IMG = /\.(png|jpe?g|webp)$/i;
const base = (f: string) => f.split(/[\\/]/).pop() ?? f;

const latest = (p: ContentPost) => {
  const byTo = new Map(p.deliveries.map((d) => [d.to.toLowerCase(), d]));
  return [...byTo.values()];
};

function PostCard({ p, onAdjust }: { p: ContentPost; onAdjust?: (prefix: string) => void }) {
  const { office, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);
  const delivered = latest(p);
  const missingLink = delivered.some((d) => !d.link);
  const step = ORDER.indexOf(p.status);
  const thumb = delivered[0]?.from ?? p.finals[0] ?? p.files.find((f) => IMG.test(f));
  const untuned = needsTunning(p.format) && !p.tunning;
  const label = `${p.number != null ? `${String(p.number).padStart(2, '0')} · ` : ''}${p.theme}`;

  // o Drive termina de subir alguns segundos depois da cópia: pergunta de novo até o link aparecer
  useEffect(() => {
    if (!missingLink) return;
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > 30) return clearInterval(t);
      api(`/api/offices/${office!.id}/posts/${p.id}/link`, { body: {} }).catch(() => clearInterval(t));
    }, 10000);
    return () => clearInterval(t);
  }, [missingLink, p.id, office]);

  const deliver = async (again: boolean) => {
    setBusy(true);
    try {
      const r = await api<{ delivered: unknown[]; same: string[] }>(`/api/offices/${office!.id}/posts/${p.id}/${again ? 'reentregar' : 'aprovar'}`, { body: {} });
      notify(r.delivered.length ? `${p.theme}: ${r.delivered.length} arquivo(s) na pasta do mês` : `${p.theme}: já estava entregue igual`);
    } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  const copyLinks = async () => {
    const links = delivered.map((d) => d.link).filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(links); notify('Link copiado'); } catch { notify(links); }
  };
  const openDrive = () => {
    const first = delivered[0];
    if (first?.link) window.open(first.link, '_blank');
    else if (first && desktop) desktop.showInFolder(first.to);
  };

  return (
    <li className={`post-card st-${p.status}`}>
      <div className="post-thumb">
        {thumb && thumbOk ? <img src={mediaUrl(office!.id, thumb)} alt="" onError={() => setThumbOk(false)} /> : <ImageIcon size={18} />}
      </div>
      <div className="post-main">
        <b className="truncate" title={p.theme}>{label}</b>
        <span className="muted small">{p.date.split('-').reverse().slice(0, 2).join('/')} · {POST_FORMAT_LABEL[p.format]}{untuned ? ' · falta o tunning' : ''}</span>
        <ol className="post-trail" aria-label={`Etapa: ${POST_STATUS_LABEL[p.status]}`}>
          {TRAIL.map((s) => <li key={s} className={ORDER.indexOf(s) <= step ? 'done' : ''} title={TRAIL_LABEL[s]} />)}
        </ol>
        {delivered.length > 0 ? (
          <>
            <span className="small truncate" title={delivered.map((d) => d.to).join('\n')}>{base(delivered[0].to)}{delivered.length > 1 ? ` +${delivered.length - 1}` : ''}</span>
            <div className="row gap-s wrap">
              <button type="button" className="ghost small" onClick={openDrive} title={missingLink ? 'O Drive ainda está subindo; abre a pasta no computador' : undefined}>
                {missingLink ? <FolderOpen size={12} /> : <ExternalLink size={12} />} Abrir no Drive
              </button>
              <button type="button" className="ghost small" disabled={missingLink} onClick={copyLinks} title={missingLink ? 'O link aparece quando o Drive terminar de subir' : undefined}><Copy size={12} /> {missingLink ? 'Subindo…' : 'Copiar link'}</button>
              <button type="button" className="ghost small" disabled={busy} onClick={() => deliver(true)} title="Entrega de novo os finais corrigidos. A versão anterior fica guardada em _versoes, no lote."><RotateCcw size={12} /> Reentregar</button>
            </div>
          </>
        ) : p.status !== 'cancelado' && (
          <div className="row gap-s wrap">
            <button type="button" className="primary small" disabled={busy || untuned} title={untuned ? 'Faça o tunning ou marque no calendário que fica sem' : 'Aprova e copia para a pasta do mês no Drive'} onClick={() => deliver(false)}>
              {busy ? <CloudUpload size={12} /> : <Check size={12} />} Aprovar e entregar
            </button>
            {onAdjust && <button type="button" className="ghost small" onClick={() => onAdjust(`${label}: `)}>Pedir ajuste</button>}
          </div>
        )}
      </div>
    </li>
  );
}

/** Lista das peças da demanda. `onAdjust` põe "NN · tema: " no comentário da revisão. */
export function PostCards({ d, onAdjust }: { d: Demand; onAdjust?: (prefix: string) => void }) {
  const posts = useStore((s) => s.posts).filter((p) => p.demandId === d.id && p.status !== 'cancelado');
  if (!posts.length) return null;
  const done = posts.filter((p) => p.deliveries.length).length;
  return (
    <section className="col gap-s">
      <b className="row gap">Peças <span className="muted small">{done}/{posts.length} entregues</span></b>
      <ul className="post-cards">{posts.map((p) => <PostCard key={p.id} p={p} onAdjust={onAdjust} />)}</ul>
    </section>
  );
}
