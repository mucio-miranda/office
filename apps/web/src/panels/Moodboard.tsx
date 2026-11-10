import { useEffect, useMemo, useState } from 'react';
import { Copy, FolderOpen, Link2, Plus, Search, Sparkles, Star, Trash2, X } from 'lucide-react';
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
/** Fontes abertas (Google Fonts) para escolher o título de um nicho. */
const FONT_CHOICES = ['Playfair Display', 'Cormorant Garamond', 'Bodoni Moda', 'Fraunces', 'Lora', 'DM Serif Display', 'Instrument Serif', 'Libre Baskerville', 'Abril Fatface',
  'Urbanist', 'Space Grotesk', 'Sora', 'Syne', 'Manrope', 'Outfit', 'Plus Jakarta Sans', 'Unbounded', 'Archivo Black', 'Bebas Neue', 'Oswald', 'Merriweather'];
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
  // o nome de cada moodboard na lista já aparece na tipografia dele
  const railFonts = useMemo(() => [...new Set([...(lists?.niches ?? []), ...(lists?.clients ?? [])].map((s) => s.theme.titleFont).filter(Boolean) as string[])].join('|'), [lists]);
  useEffect(() => {
    if (!railFonts) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${railFonts.split('|').map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}`).join('&')}&display=swap`;
    document.head.appendChild(link);
    return () => link.remove();
  }, [railFonts]);

  const rail = (title: string, list: MoodboardSummary[]) => list.length > 0 && (
    <>
      <small className="muted mood-rail-title">{title}</small>
      {list.map((s) => (
        <button key={s.key} className={`mood-rail-item ${current === s.key ? 'on' : ''}`} onClick={() => setSel(s.key)}>
          <span className="mood-rail-swatch" style={{ background: s.theme.bg }}>
            {s.covers[0] ? <img src={mediaUrl(office!.id, s.covers[0])} alt="" loading="lazy" /> : <i style={{ background: s.theme.accent }} />}
          </span>
          <span className="col" style={{ minWidth: 0 }}>
            <span className="truncate mood-rail-name" style={s.theme.titleFont ? { fontFamily: `"${s.theme.titleFont}", Georgia, serif` } : undefined}>{s.name}</span>
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
          <BoardView key={board.key} board={board} clientId={clientId} onChange={load}
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

const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(new Error(`Não consegui ler ${f.name}`));
  r.readAsDataURL(f);
});

function BoardView({ board, clientId, nicheControl, onChange }: { board: Board; clientId: string | null; nicheControl: React.ReactNode; onChange: () => void }) {
  const { office, notify, open } = useStore();
  const role = useStore((s) => (s.offices.find((o) => o.id === s.office?.id) as { role?: string } | undefined)?.role);
  const canEdit = role !== 'convidado';
  const [query, setQuery] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [drag, setDrag] = useState(false);
  const base = `/api/offices/${office!.id}`;
  // onde entra o que for adicionado: na pasta de referências do cliente, ou na biblioteca do nicho
  const addUrl = clientId ? `${base}/clients/${clientId}/referencias` : board.niche ? `${base}/moodboards/nicho/${encodeURIComponent(board.niche)}/referencias` : null;
  const add = async (items: ({ name: string; data: string } | { url: string })[]) => {
    if (!addUrl || !items.length) return;
    setBusy(true);
    let ok = 0;
    for (const it of items) {
      try { await api(addUrl, { body: it }); ok++; } catch (e) { notify((e as Error).message); }
    }
    setBusy(false);
    if (ok) { notify(ok === 1 ? 'Referência adicionada' : `${ok} referências adicionadas`); onChange(); }
  };
  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type));
    if (!list.length) return notify('Só imagens PNG, JPG ou WebP.');
    add(await Promise.all(list.map(async (f) => ({ name: f.name, data: await toBase64(f) }))));
  };
  const isNicheItem = (i: MoodboardItem) => !clientId || !board.items.includes(i);
  const remove = async (i: MoodboardItem) => {
    try {
      if (isNicheItem(i)) await api(`${base}/moodboards/nicho/${encodeURIComponent(board.niche ?? '')}/referencias/${encodeURIComponent(i.id)}/remover`, { body: {} });
      else await api(`${base}/clients/${clientId}/referencias/remover`, { body: { file: i.file } });
      notify('Referência removida: foi para _apagados, fora do alcance das skills');
      setZoom(null);
      onChange();
    } catch (e) { notify((e as Error).message); }
  };
  const searchNew = async () => {
    const theme = query.trim();
    const text = `Busque novas referências para ${board.name}${theme ? ` sobre: ${theme}` : ''}, pelo método da skill arte-referencia (biblioteca da agência, web, Instagram e Pinterest, só referências fortes do segmento). Mostre uma pré-seleção curta para eu aprovar; as aprovadas entram na biblioteca do nicho (refs.py add) e na pasta de referências do cliente.`;
    try {
      const r = await api<{ agentId?: string }>(`${base}/clients/${clientId}/conversa`, { body: { text } });
      notify('Pedido enviado ao agente');
      if (r.agentId) open('agente', r.agentId);
    } catch (e) { notify((e as Error).message); }
  };
  const [filter, setFilter] = useState<string | null>(null);
  const [zoom, setZoomRaw] = useState<MoodboardItem | null>(null);
  const setZoom = (i: MoodboardItem | null) => { setConfirmDel(false); setZoomRaw(i); };
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
  const q = query.trim().toLowerCase();
  const match = (i: MoodboardItem) => !q || [i.id, i.layout, i.obs, i.origem, i.group, i.tema, ...i.tags, i.file.split(/[\\/]/).pop()].some((v) => (v ?? '').toLowerCase().includes(q));
  const shown = (filter ? board.items.filter((i) => i.layout === filter) : board.items).filter(match);
  const shownNiche = board.nicheItems.filter(match);
  const copy = (text: string, msg: string) => { navigator.clipboard?.writeText(text); notify(msg); };

  const card = (i: MoodboardItem) => (
    <button key={i.file} className="mood-card" onClick={() => setZoom(i)} title={i.obs || i.group || ''}>
      <img src={mediaUrl(office!.id, i.file)} alt={i.obs} loading="lazy" style={i.width && i.height ? { aspectRatio: `${i.width} / ${i.height}` } : undefined} />
      {(i.nota ?? 0) >= 5 && <span className="mood-star" title="Aprovada da casa"><Star size={12} fill="currentColor" /></span>}
      {i.layout && <span className="mood-tag">{layoutLabel(i.layout)}</span>}
    </button>
  );

  return (
    <div className={`mood-board${drag ? ' dragging' : ''}`} style={style}
      onDragOver={(e) => { if (canEdit && addUrl && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (canEdit && addUrl) addFiles(e.dataTransfer.files); }}>
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
          {t.titleFont && !(canEdit && !clientId && board.niche) && <span className="mood-type"><b>Aa</b> {t.titleFont}{t.bodyFont && t.bodyFont !== t.titleFont ? ` · ${t.bodyFont}` : ''}</span>}
          {canEdit && !clientId && board.niche && (
            <label className="mood-type mood-font" title="Tipografia do nicho (vale para os clientes deste nicho sem marca definida)"><b>Aa</b>
              <select value={t.titleFont ?? ''} onChange={async (e) => {
                try { await api(`${base}/moodboards/nicho/${encodeURIComponent(board.niche!)}/fonte`, { method: 'PUT', body: { titulo: e.target.value || null, texto: t.bodyFont } }); onChange(); } catch (x) { notify((x as Error).message); }
              }}>
                {[...new Set([t.titleFont ?? '', ...FONT_CHOICES])].filter(Boolean).map((f) => <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}
              </select>
            </label>
          )}
          {nicheControl}
          {desktop && board.folder && <button className="mood-link" onClick={() => desktop!.openPath(board.folder!)}><FolderOpen size={13} /> Abrir a pasta</button>}
        </div>
      </header>

      <div className="mood-tools">
        <label className="mood-search"><Search size={14} /><input placeholder="Buscar nas referências (tema, layout, tag)" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        {canEdit && addUrl && (
          <>
            <label className={`mood-link mood-add${busy ? ' busy' : ''}`} title="Ou arraste as imagens para o moodboard">
              <Plus size={13} /> {busy ? 'Adicionando…' : 'Adicionar'}
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <form className="mood-url" onSubmit={(e) => { e.preventDefault(); if (link.trim()) { add([{ url: link.trim() }]); setLink(''); } }}>
              <Link2 size={13} /><input placeholder="Colar link da imagem" value={link} onChange={(e) => setLink(e.target.value)} />
            </form>
          </>
        )}
        {canEdit && clientId && <button className="mood-link" onClick={searchNew} title="O agente pesquisa pelo método da casa e traz uma pré-seleção para aprovar"><Sparkles size={13} /> Buscar novas{q ? ` sobre "${query.trim()}"` : ''}</button>}
      </div>

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
      {q && !shown.length && !shownNiche.length && <p className="mood-empty">Nada com "{query.trim()}".{clientId ? ' Use "Buscar novas" para o agente pesquisar.' : ''}</p>}
      {shownNiche.length > 0 && (
        <>
          <h2 className="mood-section">Do nicho</h2>
          <div className="mood-grid">{shownNiche.map(card)}</div>
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
                {canEdit && (confirmDel
                  ? <button className="mood-link mood-danger" onClick={() => { setConfirmDel(false); remove(zoom); }}><Trash2 size={13} /> Confirmar: tirar {isNicheItem(zoom) ? 'da biblioteca do nicho' : 'das referências do cliente'}</button>
                  : <button className="mood-link" onClick={() => setConfirmDel(true)} title="Vai para _apagados, fora das pastas que as skills leem; dá para trazer de volta"><Trash2 size={13} /> Remover</button>)}
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
