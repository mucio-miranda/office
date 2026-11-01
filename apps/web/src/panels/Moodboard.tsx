import { useEffect, useMemo, useState } from 'react';
import { Copy, FolderOpen, Sparkles, Star, X } from 'lucide-react';
import type { MoodboardItem, MoodboardSummary, MoodboardTheme } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { desktop } from '../lib/desktop';

/**
 * Moodboards do estúdio de design: um por nicho e um por cliente, vindos das pastas de referência. Cada um veste as
 * cores e a tipografia da própria marca (ou as medidas nas referências do nicho). As imagens continuam nas pastas.
 */

interface Board {
  key: string; name: string; niche: string | null; folder: string | null; theme: MoodboardTheme; handle: string | null;
  items: MoodboardItem[]; nicheItems: MoodboardItem[];
}
interface Lists { niches: MoodboardSummary[]; clients: MoodboardSummary[] }

const LAYOUT_LABEL: Record<string, string> = {
  'retrato-lateral': 'Retrato lateral', 'retrato-palco': 'Retrato palco', 'frase-editorial': 'Frase editorial', 'titulo-atras': 'Título atrás', 'card-vidro': 'Card de vidro',
  'lamina-texto': 'Lâmina de texto', 'lamina-cta': 'Lâmina de CTA', fundo: 'Fundo', 'palavra-fundo': 'Palavra de fundo', 'selo-tarja': 'Selo e tarja', 'lateral-arco': 'Lateral em arco', outro: 'Outros',
};
const layoutLabel = (l: string) => LAYOUT_LABEL[l] ?? l;
const fontStack = (f: string | null, generic: string) => (f ? `"${f}", ${generic}` : generic);

/** Carrega a tipografia da marca, quando existe no Google Fonts (são fontes abertas); sem internet, cai na genérica. */
function useBoardFonts(t: MoodboardTheme | undefined) {
  useEffect(() => {
    const fams = [t?.titleFont, t?.bodyFont].filter(Boolean) as string[];
    if (!fams.length) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${[...new Set(fams)].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:ital,wght@0,400;0,600;1,400`).join('&')}&display=swap`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [t?.titleFont, t?.bodyFont]);
}

export function Moodboard() {
  const { office, panelArg, notify } = useStore();
  const [lists, setLists] = useState<Lists | null>(null);
  const [sel, setSel] = useState<string | null>(panelArg);
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState('');
  const base = `/api/offices/${office!.id}`;
  useEffect(() => { api<Lists>(`${base}/moodboards`).then(setLists).catch((e) => setErr((e as Error).message)); }, [base]);
  useEffect(() => { if (panelArg) setSel(panelArg); }, [panelArg]);
  const first = lists?.clients.find((c) => c.count > 0) ?? lists?.niches[0] ?? lists?.clients[0];
  const current = sel ?? first?.key ?? null;
  const load = () => {
    if (!current) return;
    const [kind, id] = current.split(':');
    api<Board>(kind === 'nicho' ? `${base}/moodboards/nicho/${encodeURIComponent(id)}` : `${base}/clients/${id}/moodboard`)
      .then((b) => { setBoard(b); setErr(''); }).catch((e) => { setBoard(null); setErr((e as Error).message); });
  };
  useEffect(load, [current, base]); // eslint-disable-line react-hooks/exhaustive-deps
  useBoardFonts(board?.theme);

  const rail = (title: string, list: MoodboardSummary[]) => list.length > 0 && (
    <>
      <small className="muted mood-rail-title">{title}</small>
      {list.map((s) => (
        <button key={s.key} className={`mood-rail-item ${current === s.key ? 'on' : ''}`} onClick={() => setSel(s.key)}>
          <span className="mood-rail-swatch" style={{ background: s.theme.bg }}>
            {s.covers[0] ? <img src={mediaUrl(office!.id, s.covers[0])} alt="" loading="lazy" /> : <i style={{ background: s.theme.accent }} />}
          </span>
          <span className="col" style={{ minWidth: 0 }}>
            <span className="truncate">{s.name}</span>
            <span className="muted small">{s.count ? `${s.count} ${s.count === 1 ? 'referência' : 'referências'}` : 'só do nicho'}</span>
          </span>
        </button>
      ))}
    </>
  );

  const clientId = current?.startsWith('cliente:') ? current.slice(8) : null;
  const niches = lists?.niches ?? [];
  const setNiche = async (niche: string) => {
    try {
      await api(`${base}/clients/${clientId}`, { method: 'PATCH', body: { niche: niche || null } });
      await useStore.getState().reload('clients');
      setLists(await api<Lists>(`${base}/moodboards`));
      load();
    } catch (e) { notify((e as Error).message); }
  };

  return (
    <div className="archive-page">
      <aside className="clients-list mood-rail">
        {rail('Nichos', lists?.niches ?? [])}
        {rail('Clientes', lists?.clients ?? [])}
        {lists && !lists.niches.length && !lists.clients.length && <p className="muted small">Nada ainda. As referências ficam em REFERENCIAS, na pasta raiz, e nas pastas de referência de cada cliente.</p>}
      </aside>
      <div className="mood-scroll">
        {err && <div className="error" style={{ margin: 16 }}>{err}</div>}
        {board && (
          <BoardView key={board.key} board={board} clientId={clientId}
            nicheControl={clientId && niches.length > 0 ? (
              <label className="mood-niche">Nicho
                <select value={board.niche ?? ''} onChange={(e) => setNiche(e.target.value)}>
                  <option value="">Sem nicho</option>
                  {niches.map((n) => <option key={n.key} value={n.niche!}>{n.name}</option>)}
                </select>
              </label>
            ) : null} />
        )}
      </div>
    </div>
  );
}

function BoardView({ board, clientId, nicheControl }: { board: Board; clientId: string | null; nicheControl: React.ReactNode }) {
  const { office, notify, open } = useStore();
  const [filter, setFilter] = useState<string | null>(null);
  const [zoom, setZoom] = useState<MoodboardItem | null>(null);
  const t = board.theme;
  const style = {
    '--mb-bg': t.bg, '--mb-fg': t.fg, '--mb-accent': t.accent,
    '--mb-title': fontStack(t.titleFont, 'Georgia, "Times New Roman", serif'), '--mb-body': fontStack(t.bodyFont, 'system-ui, sans-serif'),
  } as React.CSSProperties;
  const facets = useMemo(() => {
    const count = new Map<string, number>();
    for (const i of board.items) if (i.layout) count.set(i.layout, (count.get(i.layout) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [board.items]);
  const shown = filter ? board.items.filter((i) => i.layout === filter) : board.items;
  const copy = (text: string, msg: string) => { navigator.clipboard?.writeText(text); notify(msg); };

  const card = (i: MoodboardItem) => (
    <button key={i.file} className="mood-card" onClick={() => setZoom(i)} title={i.obs || i.group || ''}>
      <img src={mediaUrl(office!.id, i.file)} alt={i.obs} loading="lazy" style={i.width && i.height ? { aspectRatio: `${i.width} / ${i.height}` } : undefined} />
      {(i.nota ?? 0) >= 5 && <span className="mood-star" title="Aprovada da casa"><Star size={12} fill="currentColor" /></span>}
      {i.layout && <span className="mood-tag">{layoutLabel(i.layout)}</span>}
    </button>
  );

  return (
    <div className="mood-board" style={style}>
      <header className="mood-hero">
        <div className="mood-kicker">{clientId ? 'Moodboard do cliente' : 'Moodboard do nicho'}{board.handle ? ` · ${board.handle}` : ''}</div>
        <h1>{board.name}</h1>
        <div className="mood-swatches">
          {t.swatches.map((c) => (
            <button key={c} className="mood-swatch" title={`Copiar ${c}`} onClick={() => copy(c, `${c} copiado`)}>
              <i style={{ background: c }} /><span>{c.toUpperCase()}</span>
            </button>
          ))}
        </div>
        <div className="mood-meta">
          {t.titleFont && <span className="mood-type"><b>Aa</b> {t.titleFont}{t.bodyFont && t.bodyFont !== t.titleFont ? ` · ${t.bodyFont}` : ''}</span>}
          {nicheControl}
          {desktop && board.folder && <button className="mood-link" onClick={() => desktop!.openPath(board.folder!)}><FolderOpen size={13} /> Abrir a pasta</button>}
        </div>
      </header>

      {facets.length > 1 && (
        <div className="mood-filters">
          <button className={filter === null ? 'on' : ''} onClick={() => setFilter(null)}>Tudo <span>{board.items.length}</span></button>
          {facets.map(([l, n]) => <button key={l} className={filter === l ? 'on' : ''} onClick={() => setFilter(filter === l ? null : l)}>{layoutLabel(l)} <span>{n}</span></button>)}
        </div>
      )}

      {shown.length > 0 && <div className="mood-grid">{shown.map(card)}</div>}
      {!board.items.length && (
        <p className="mood-empty">{clientId ? 'Este cliente ainda não tem imagens numa pasta de referência. Crie uma pasta com "REFERENCIAS" no nome, em qualquer lugar da pasta dele, e elas aparecem aqui.' : 'Nenhuma referência neste nicho.'}</p>
      )}
      {board.nicheItems.length > 0 && (
        <>
          <h2 className="mood-section">Do nicho</h2>
          <div className="mood-grid">{board.nicheItems.map(card)}</div>
        </>
      )}

      {zoom && (
        <div className="mood-zoom" onClick={() => setZoom(null)}>
          <div className="mood-zoom-inner" onClick={(e) => e.stopPropagation()}>
            <img src={mediaUrl(office!.id, zoom.file)} alt={zoom.obs} />
            <aside>
              <button className="mood-close" title="Fechar" onClick={() => setZoom(null)}><X size={16} /></button>
              {zoom.layout && <div className="mood-kicker">{layoutLabel(zoom.layout)}{zoom.tema ? ` · ${zoom.tema}` : ''}</div>}
              {zoom.obs && <p className="mood-obs">{zoom.obs}</p>}
              {zoom.group && <p className="mood-small">{zoom.group}</p>}
              {zoom.paleta.length > 0 && <div className="mood-mini">{zoom.paleta.map((c) => <i key={c} title={c} style={{ background: c }} onClick={() => copy(c, `${c} copiado`)} />)}</div>}
              {zoom.tags.length > 0 && <p className="mood-small">{zoom.tags.join(' · ')}</p>}
              {zoom.origem && <p className="mood-small">Origem: {zoom.origem}</p>}
              <p className="mood-small mood-path">{zoom.file}</p>
              <div className="mood-actions">
                <button className="mood-primary" onClick={() => open('demandas', `ref:${JSON.stringify({ clientId, file: zoom.file })}`)}><Sparkles size={14} /> Nova arte com esta referência</button>
                <button className="mood-link" onClick={() => copy(zoom.file, 'Caminho copiado')}><Copy size={13} /> Copiar caminho</button>
                {desktop && <button className="mood-link" onClick={() => desktop!.showInFolder(zoom.file)}><FolderOpen size={13} /> Mostrar na pasta</button>}
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
