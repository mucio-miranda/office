import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain, Check, ChevronLeft, ChevronRight, Clock, Trash2, Copy, ExternalLink, FolderOpen, FolderPlus, LayoutGrid, Network, RefreshCw, Search, Sparkles, Unplug, X, Inbox,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { desktop } from '../lib/desktop';
import { usePersisted } from '../lib/persisted';
import { renderMarkdown } from '../lib/markdown';
import { BrowseDialog } from '../lib/PathPicker';
import { NewDemand } from './NewDemand';
import { CerebroGraph, type GraphNode } from './CerebroGraph';

/**
 * Cérebro: as notas de uma pasta do Obsidian dentro do Office. Três jeitos de olhar o mesmo cofre: Triagem (decidir o
 * que entra), Biblioteca (achar e usar) e Grafo (navegar como no Obsidian). A decisão vai para o frontmatter da nota,
 * então o Obsidian continua vendo tudo; o Office não apaga nem move nada.
 */

interface Cerebro { id: string; name: string; path: string }
interface Note {
  id: string; title: string; folder: string; fm: Record<string, string>; tags: string[]; links: string[]; cover: string | null; slides: string[];
  excerpt: string; comoUsar: string[]; url: string | null; mtime: number; group: number;
}
interface Indice { cerebro: Cerebro; groups: { query: string; color: string }[]; notes: Note[] }
interface Full { id: string; body: string; backlinks: { id: string; title: string }[]; links: Record<string, string | null>; embeds: Record<string, string | null>; abs: string }
type View = 'triagem' | 'biblioteca' | 'grafo';

const PENDING = new Set(['', 'nova', 'revisada', 'referencia']);
const DESTINO: Record<string, { label: string; acao: string }> = {
  pauta: { label: 'Pauta', acao: 'Transforme esta nota do cérebro em pauta para o calendário: proponha formato, gancho e roteiro curto no padrão do cliente antes de produzir.' },
  'formato-e-conteudo': { label: 'Formato e conteúdo', acao: 'Use esta nota do cérebro como referência de formato e conteúdo: diga o que copiar da estrutura e proponha 2 ideias de post no padrão do cliente.' },
  'referencia-visual': { label: 'Referência visual', acao: 'Use esta nota do cérebro como referência visual da próxima arte (estrutura, luz, tipografia), pelo método da skill arte-referencia.' },
  ferramenta: { label: 'Ferramenta', acao: 'Avalie esta ferramenta do cérebro para a agência e o Office: o que faz, licença, riscos e como testar. Não instale nada sem o meu OK.' },
  melhoria: { label: 'Melhoria', acao: 'Proponha como aplicar esta ideia do cérebro como melhoria no nosso processo, skills ou Office, com o passo a passo e o que muda.' },
  concorrente: { label: 'Concorrente', acao: 'Analise este concorrente/perfil do cérebro: posicionamento, formatos que performam e o que podemos fazer melhor.' },
  descartar: { label: 'Descartar', acao: '' },
};
const STATUS_LABEL: Record<string, string> = {
  nova: 'Nova', revisada: 'Revisada pela IA', referencia: 'Referência', aprovada: 'Aprovada', adiada: 'Adiada', 'em-uso': 'Em uso', descartada: 'Descartada',
};
const statusOf = (n: Note) => n.fm.status ?? '';
const isPending = (n: Note) => 'status' in n.fm && PENDING.has(statusOf(n));
const destLabel = (d?: string) => (d ? DESTINO[d]?.label ?? d : 'Sem destino');
const stLabel = (s: string) => STATUS_LABEL[s] ?? (s || 'Sem status');

export function Cerebro() {
  const { office, notify } = useStore();
  const base = `/api/offices/${office!.id}/cerebros`;
  const [list, setList] = useState<Cerebro[] | null>(null);
  const [sel, setSel] = usePersisted<string>('office.cerebro.sel', '');
  const [view, setView] = usePersisted<View>('office.cerebro.view', 'triagem');
  const [idx, setIdx] = useState<Indice | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [browse, setBrowse] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [st, setSt] = useState<string | null>(null);
  const [use, setUse] = useState<Note | null>(null);
  const [removed, setRemoved] = useState<{ moved: { from: string; to: string }[]; titles: string[] } | null>(null);

  const loadList = useCallback(() => api<Cerebro[]>(base).then((l) => { setList(l); return l; }).catch((e) => { setErr((e as Error).message); return []; }), [base]);
  useEffect(() => { loadList(); }, [loadList]);
  const current = list?.find((c) => c.id === sel) ?? list?.[0] ?? null;

  const loadIdx = useCallback(() => {
    if (!current) return;
    setLoading(true);
    api<Indice>(`${base}/${current.id}/indice`)
      .then((d) => { setIdx(d); setErr(''); })
      .catch((e) => { setIdx(null); setErr((e as Error).message); })
      .finally(() => setLoading(false));
  }, [base, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setIdx(null); loadIdx(); }, [loadIdx]);

  const connect = async (p: string) => {
    setBrowse(false);
    try {
      const c = await api<Cerebro>(base, { body: { path: p } });
      await loadList();
      setSel(c.id);
      notify(`Cérebro ligado: ${c.name}. A primeira leitura de uma pasta no Drive pode levar alguns minutos.`);
    } catch (e) { notify((e as Error).message); }
  };
  const unplug = async (c: Cerebro) => {
    try { await api(`${base}/${c.id}`, { method: 'DELETE' }); notify('Cérebro desligado. A pasta e as notas continuam onde estão.'); setSel(''); setIdx(null); loadList(); } catch (e) { notify((e as Error).message); }
  };

  /** Grava a decisão e atualiza a nota na memória, sem reler o cofre. */
  const decide = async (ids: string[], patch: { status?: string; destino?: string }) => {
    if (!current || !ids.length) return;
    try {
      const r = await api<{ notes: Omit<Note, 'group'>[] }>(`${base}/${current.id}/decidir`, { body: { ids, ...patch } });
      setIdx((d) => d && { ...d, notes: d.notes.map((n) => { const u = r.notes.find((x) => x.id === n.id); return u ? { ...n, ...u } : n; }) });
    } catch (e) { notify((e as Error).message); }
  };

  /** Remover: a nota sai do cérebro e vai para _apagados, dentro da própria pasta (dá para desfazer). */
  const remove = async (ids: string[]) => {
    if (!current || !ids.length) return;
    try {
      const r = await api<{ moved: { from: string; to: string }[] }>(`${base}/${current.id}/remover`, { body: { ids } });
      const titles = ids.map((id) => idx?.notes.find((n) => n.id === id)?.title ?? id);
      setIdx((d) => d && { ...d, notes: d.notes.filter((n) => !ids.includes(n.id)) });
      if (open && ids.includes(open)) setOpen(null);
      setRemoved({ moved: r.moved, titles });
    } catch (e) { notify((e as Error).message); }
  };
  const undoRemove = async () => {
    if (!current || !removed) return;
    try { await api(`${base}/${current.id}/restaurar`, { body: { moved: removed.moved } }); setRemoved(null); loadIdx(); } catch (e) { notify((e as Error).message); }
  };

  const notes = idx?.notes ?? [];
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const query = q.trim().toLowerCase();
  const matches = useCallback((n: Note) => {
    if (folder !== null && n.folder !== folder && !n.folder.startsWith(`${folder}/`)) return false;
    if (dest && (n.fm.destino ?? '') !== dest) return false;
    if (st && statusOf(n) !== st) return false;
    if (!query) return true;
    return [n.title, n.excerpt, n.folder, n.fm.categoria, n.fm.perfil, n.fm.destino, ...n.comoUsar, ...n.tags].some((v) => (v ?? '').toLowerCase().includes(query));
  }, [folder, dest, st, query]);
  const shown = useMemo(() => notes.filter(matches), [notes, matches]);
  const folders = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) { const top = n.folder.split('/')[0]; m.set(top, (m.get(top) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);
  const pending = notes.filter(isPending);
  const colorOf = (n: Note) => (n.group >= 0 ? idx?.groups[n.group]?.color ?? null : null);
  const ctx: Ctx = { base, cerebro: current!, byId, decide, remove, openNote: setOpen, colorOf, onUse: setUse };

  const counts = (key: (n: Note) => string, list: Note[]) => {
    const m = new Map<string, number>();
    for (const n of list) m.set(key(n), (m.get(key(n)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  return (
    <div className="archive-page cb-page">
      <aside className="clients-list cb-rail">
        <small className="muted mood-rail-title">Cérebros</small>
        {list?.map((c) => (
          <button key={c.id} className={`mood-rail-item ${current?.id === c.id ? 'on' : ''}`} onClick={() => { setSel(c.id); setOpen(null); }} title={c.path}>
            <Brain size={16} /><span className="truncate">{c.name}</span>
          </button>
        ))}
        <button className="mood-rail-item cb-add" onClick={() => setBrowse(true)}><FolderPlus size={16} /><span>Ligar uma pasta</span></button>
        {idx && (
          <>
            <small className="muted mood-rail-title">Ver</small>
            <RailBtn on={view === 'triagem'} icon={<Inbox size={16} />} label="Triagem" n={pending.length} onClick={() => setView('triagem')} />
            <RailBtn on={view === 'biblioteca'} icon={<LayoutGrid size={16} />} label="Biblioteca" n={notes.length} onClick={() => setView('biblioteca')} />
            <RailBtn on={view === 'grafo'} icon={<Network size={16} />} label="Grafo" onClick={() => setView('grafo')} />
            <small className="muted mood-rail-title">Pastas</small>
            <RailBtn on={folder === null} label="Todas" n={notes.length} onClick={() => setFolder(null)} />
            {folders.map(([f, n]) => {
              const g = idx.groups.find((x) => x.query.replace(/^path:\s*"?|"$/g, '') === f);
              return <RailBtn key={f || '(raiz)'} on={folder === f} label={f || 'Raiz do cofre'} n={n} dot={g?.color} onClick={() => setFolder(folder === f ? null : f)} />;
            })}
          </>
        )}
      </aside>

      <div className="cb-main">
        {!list ? null : !current ? (
          <Empty onConnect={() => setBrowse(true)} />
        ) : (
          <>
            <header className="cb-head">
              <label className="cb-search"><Search size={14} /><input placeholder="Buscar: tema, perfil, ferramenta, ideia…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
              <button className="ghost small" onClick={loadIdx} disabled={loading} title="Ler a pasta de novo (só as notas que mudaram)"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
              {desktop && <button className="ghost small" onClick={() => desktop!.openPath(current.path)} title="Abrir a pasta"><FolderOpen size={14} /></button>}
              <button className="ghost small" onClick={() => unplug(current)} title="Desligar do Office (a pasta fica como está)"><Unplug size={14} /></button>
            </header>
            {err && <div className="error" style={{ margin: '0 20px 12px' }}>{err}</div>}
            {loading && !idx && <p className="cb-loading">Lendo o cérebro… Na primeira vez, uma pasta do Google Drive pode levar alguns minutos; depois abre na hora.</p>}
            {idx && view !== 'grafo' && (
              <div className="cb-chips">
                <Chips label="Destino" value={dest} onChange={setDest} items={counts((n) => n.fm.destino ?? '', notes.filter((n) => n.fm.destino))} fmt={destLabel} />
                {view === 'biblioteca' && <Chips label="Status" value={st} onChange={setSt} items={counts(statusOf, notes.filter((n) => n.fm.status))} fmt={stLabel} />}
              </div>
            )}
            {idx && view === 'triagem' && <Triagem ctx={ctx} queue={pending.filter(matches)} />}
            {idx && view === 'biblioteca' && <Biblioteca ctx={ctx} notes={shown} />}
            {idx && view === 'grafo' && (
              <GraphView notes={notes} shown={shown} colorOf={colorOf} selected={open} onOpen={setOpen} groups={idx.groups} />
            )}
          </>
        )}
      </div>

      {open && idx && current && <NoteDrawer key={open} ctx={ctx} id={open} onClose={() => setOpen(null)} />}
      {removed && (
        <div className="cb-removed" role="status">
          <span className="truncate">{removed.titles.length === 1 ? `“${removed.titles[0]}” saiu do cérebro` : `${removed.titles.length} notas saíram do cérebro`} (foi para _apagados, na pasta do cofre).</span>
          <button className="link" onClick={undoRemove}>Desfazer</button>
          <button className="icon" onClick={() => setRemoved(null)} aria-label="Fechar"><X size={14} /></button>
        </div>
      )}
      {browse && <BrowseDialog title="Pasta do cérebro (a do cofre do Obsidian)" scope="system" onPick={connect} onClose={() => setBrowse(false)} />}
      {use && current && (
        <NewDemand initialText={demandText(use, current)} onClose={() => setUse(null)}
          onDone={() => { decide([use.id], { status: 'em-uso' }); setUse(null); }} />
      )}
    </div>
  );
}

interface Ctx {
  base: string; cerebro: Cerebro; byId: Map<string, Note>;
  decide: (ids: string[], patch: { status?: string; destino?: string }) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  openNote: (id: string) => void; colorOf: (n: Note) => string | null; onUse: (n: Note) => void;
}

const fileUrl = (base: string, c: Cerebro, p: string) => `${base}/${c.id}/arquivo?p=${encodeURIComponent(p)}`;
const absOf = (c: Cerebro, id: string) => `${c.path}${c.path.includes('\\') ? '\\' : '/'}${id.split('/').join(c.path.includes('\\') ? '\\' : '/')}`;

function demandText(n: Note, c: Cerebro) {
  const acao = DESTINO[n.fm.destino ?? '']?.acao || 'Use esta nota do cérebro como referência e proponha como aplicá-la.';
  return [
    acao, '',
    `Nota: «${n.title}»`,
    `Arquivo: ${absOf(c, n.id)}`,
    n.url ? `Link: ${n.url}` : '',
    n.comoUsar.length ? `Como usar (do cérebro):\n${n.comoUsar.map((l) => `- ${l}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function RailBtn({ on, icon, label, n, dot, onClick }: { on: boolean; icon?: React.ReactNode; label: string; n?: number; dot?: string; onClick: () => void }) {
  return (
    <button className={`mood-rail-item cb-rail-btn ${on ? 'on' : ''}`} onClick={onClick}>
      {icon ?? <i className="cb-dot" style={{ background: dot ?? 'var(--border-strong)' }} />}
      <span className="truncate">{label}</span>
      {n !== undefined && <span className="cb-count">{n}</span>}
    </button>
  );
}

function Chips({ label, value, onChange, items, fmt }: { label: string; value: string | null; onChange: (v: string | null) => void; items: [string, number][]; fmt: (v: string) => string }) {
  if (!items.length) return null;
  return (
    <div className="cb-chip-row">
      <span className="muted small">{label}</span>
      {items.slice(0, 12).map(([v, n]) => (
        <button key={v} className={`cb-chip ${value === v ? 'on' : ''}`} onClick={() => onChange(value === v ? null : v)}>{fmt(v)} <span>{n}</span></button>
      ))}
    </div>
  );
}

function Empty({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="cb-empty">
      <Brain size={36} strokeWidth={1.4} />
      <h2>Ligue o seu cérebro</h2>
      <p className="muted">Escolha a pasta de notas, a mesma que você abre no Obsidian. O Office lê as notas, mostra o grafo e ajuda a decidir e usar cada ideia. A pasta continua sua: nada é apagado nem movido.</p>
      <button className="primary" onClick={onConnect}><FolderPlus size={15} /> Escolher a pasta</button>
    </div>
  );
}

/* ---------------- Triagem ---------------- */

function Triagem({ ctx, queue }: { ctx: Ctx; queue: Note[] }) {
  // o que a IA já leu e preencheu vem primeiro, depois as mais novas
  const ordered = useMemo(() => [...queue].sort((a, b) => Number(b.comoUsar.length > 0) - Number(a.comoUsar.length > 0) || b.id.localeCompare(a.id, 'pt-BR', { numeric: true })), [queue]);
  const [pos, setPos] = useState(0);
  const [undo, setUndo] = useState<{ id: string; status: string } | null>(null);
  const note = ordered[Math.min(pos, ordered.length - 1)];
  const [dest, setDest] = useState(note?.fm.destino ?? '');
  useEffect(() => { setDest(note?.fm.destino ?? ''); }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (status: string) => {
    if (!note) return;
    setUndo({ id: note.id, status: statusOf(note) });
    await ctx.decide([note.id], { status, ...(dest && dest !== note.fm.destino ? { destino: dest } : {}) });
  }, [note, dest, ctx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'a') act('aprovada');
      else if (k === 'd') act('adiada');
      else if (k === 'x') act('descartada');
      else if (k === 'arrowright') setPos((p) => Math.min(ordered.length - 1, p + 1));
      else if (k === 'arrowleft') setPos((p) => Math.max(0, p - 1));
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [act, ordered.length]);

  if (!note) return <div className="cb-empty"><Check size={32} /><h2>Triagem em dia</h2><p className="muted">Nada esperando decisão com esses filtros.</p></div>;
  const color = ctx.colorOf(note);
  return (
    <div className="cb-triage">
      <article className="cb-focus">
        <div className="cb-focus-media">
          {note.slides.length ? <Slides key={note.id} ctx={ctx} slides={note.slides} /> : <div className="cb-nocover"><Brain size={28} strokeWidth={1.3} /></div>}
        </div>
        <div className="cb-focus-body">
          <div className="cb-kicker">
            {color && <i className="cb-dot" style={{ background: color }} />}
            {[note.fm.categoria, note.fm.perfil && `@${note.fm.perfil}`, note.fm.data].filter(Boolean).join(' · ') || note.folder}
            <span className="cb-pos">{Math.min(pos, ordered.length - 1) + 1} de {ordered.length}</span>
          </div>
          <h2 className="cb-focus-title">{note.title}</h2>
          {note.excerpt && <p className="cb-excerpt">{note.excerpt}</p>}
          <section className="cb-como">
            <h3><Sparkles size={13} /> Como usar</h3>
            {note.comoUsar.length ? <ul>{note.comoUsar.map((l, i) => <li key={i} dangerouslySetInnerHTML={{ __html: inlineMd(l) }} />)}</ul>
              : <p className="muted small">Ainda sem leitura da IA. Abra a nota ou peça para um funcionário revisar.</p>}
          </section>
          <div className="cb-dest">
            <span className="muted small">Destino</span>
            {Object.entries(DESTINO).filter(([k]) => k !== 'descartar').map(([k, d]) => (
              <button key={k} className={`cb-chip ${dest === k ? 'on' : ''}`} onClick={() => setDest(dest === k ? '' : k)}>{d.label}</button>
            ))}
          </div>
          <div className="cb-actions">
            <button className="primary" onClick={() => act('aprovada')}><Check size={15} /> Aprovar <kbd>A</kbd></button>
            <button className="ghost" onClick={() => act('adiada')}><Clock size={15} /> Adiar <kbd>D</kbd></button>
            <button className="ghost" onClick={() => act('descartada')}><X size={15} /> Descartar <kbd>X</kbd></button>
            <button className="ghost" onClick={() => ctx.remove([note.id])} title="Tira a nota do cérebro (vai para _apagados; dá para desfazer)"><Trash2 size={15} /> Remover</button>
            <span className="cb-spacer" />
            <button className="ghost small" onClick={() => ctx.openNote(note.id)}>Abrir a nota</button>
            {note.url && <a className="ghost small btn-link" href={note.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Original</a>}
          </div>
          {undo && (
            <p className="muted small cb-undo">
              Decisão gravada na nota. <button className="link" onClick={() => { ctx.decide([undo.id], { status: undo.status || 'nova' }); setUndo(null); }}>Desfazer</button>
            </p>
          )}
        </div>
      </article>
      <ol className="cb-queue">
        {ordered.slice(0, 60).map((n, i) => (
          <li key={n.id}>
            <button className={i === Math.min(pos, ordered.length - 1) ? 'on' : ''} onClick={() => setPos(i)}>
              {n.cover ? <img src={fileUrl(ctx.base, ctx.cerebro, n.cover)} alt="" loading="lazy" /> : <span className="cb-qthumb" />}
              <span className="col" style={{ minWidth: 0 }}>
                <span className="truncate">{n.title}</span>
                <span className="muted small truncate">{n.comoUsar.length ? 'com leitura da IA' : stLabel(statusOf(n))}{n.fm.destino ? ` · ${destLabel(n.fm.destino)}` : ''}</span>
              </span>
            </button>
          </li>
        ))}
        {ordered.length > 60 && <li className="muted small cb-more">e mais {ordered.length - 60}</li>}
      </ol>
    </div>
  );
}

/** Lâminas do carrossel: setas, contador e miniaturas; Shift+← e Shift+→ também passam. */
function Slides({ ctx, slides }: { ctx: Ctx; slides: string[] }) {
  const [i, setI] = useState(0);
  const go = useCallback((d: number) => setI((x) => Math.min(slides.length - 1, Math.max(0, x + d))), [slides.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.shiftKey || (e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); go(-1); }
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [go]);
  return (
    <div className="cb-slides">
      <img src={fileUrl(ctx.base, ctx.cerebro, slides[i])} alt={`Lâmina ${i + 1} de ${slides.length}`} />
      {slides.length > 1 && (
        <>
          <button className="cb-slide-nav prev" onClick={() => go(-1)} disabled={i === 0} aria-label="Lâmina anterior"><ChevronLeft size={18} /></button>
          <button className="cb-slide-nav next" onClick={() => go(1)} disabled={i === slides.length - 1} aria-label="Próxima lâmina"><ChevronRight size={18} /></button>
          <span className="cb-slide-count">{i + 1}/{slides.length}</span>
          <div className="cb-slide-thumbs">
            {slides.map((s, j) => (
              <button key={s} className={j === i ? 'on' : ''} onClick={() => setI(j)} aria-label={`Lâmina ${j + 1}`}>
                <img src={fileUrl(ctx.base, ctx.cerebro, s)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Markdown de uma linha (negrito, código, links) para os itens do "Como usar". */
const inlineMd = (s: string) => renderMarkdown(s).replace(/^<p>|<\/p>\s*$/g, '');

/* ---------------- Biblioteca ---------------- */

function Biblioteca({ ctx, notes }: { ctx: Ctx; notes: Note[] }) {
  const [group, setGroup] = usePersisted<'destino' | 'pasta' | 'nada'>('office.cerebro.group', 'destino');
  const [limit, setLimit] = useState(120);
  useEffect(() => setLimit(120), [notes]);
  const sections = useMemo(() => {
    if (group === 'nada') return [['', notes] as const];
    const m = new Map<string, Note[]>();
    for (const n of notes) { const k = group === 'destino' ? n.fm.destino ?? '' : n.folder; m.set(k, [...(m.get(k) ?? []), n]); }
    return [...m.entries()].sort((a, b) => Number(a[0] === '') - Number(b[0] === '') || b[1].length - a[1].length);
  }, [notes, group]);
  let budget = limit;
  return (
    <div className="cb-lib">
      <div className="cb-lib-tools">
        <span className="muted small">{notes.length} {notes.length === 1 ? 'nota' : 'notas'}</span>
        <span className="cb-spacer" />
        <span className="muted small">Agrupar</span>
        {(['destino', 'pasta', 'nada'] as const).map((g) => <button key={g} className={`cb-chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{g === 'destino' ? 'Destino' : g === 'pasta' ? 'Pasta' : 'Sem grupo'}</button>)}
      </div>
      {sections.map(([k, list]) => {
        if (budget <= 0) return null;
        const part = list.slice(0, budget);
        budget -= part.length;
        return (
          <section key={k || '_'} className="cb-section">
            {group !== 'nada' && <h2>{group === 'destino' ? destLabel(k || undefined) : k || 'Raiz do cofre'} <span>{list.length}</span></h2>}
            <div className="cb-grid">
              {part.map((n) => <Card key={n.id} ctx={ctx} n={n} />)}
            </div>
          </section>
        );
      })}
      {notes.length > limit && <button className="ghost cb-more-btn" onClick={() => setLimit(limit + 120)}>Mostrar mais ({notes.length - limit})</button>}
      {!notes.length && <p className="cb-empty-inline muted">Nenhuma nota com esses filtros.</p>}
    </div>
  );
}

function Card({ ctx, n }: { ctx: Ctx; n: Note }) {
  const color = ctx.colorOf(n);
  const s = statusOf(n);
  return (
    <article className="cb-card">
      <button className="cb-card-open" onClick={() => ctx.openNote(n.id)}>
        {n.cover ? <img src={fileUrl(ctx.base, ctx.cerebro, n.cover)} alt="" loading="lazy" /> : (
          <div className="cb-card-text">{n.excerpt || n.comoUsar[0] || ''}</div>
        )}
        {n.slides.length > 1 && <span className="cb-slide-count" title="Carrossel">1/{n.slides.length}</span>}
        <div className="cb-card-body">
          <div className="cb-kicker">{color && <i className="cb-dot" style={{ background: color }} />}<span className="truncate">{n.fm.perfil ? `@${n.fm.perfil}` : n.folder || 'Raiz'}</span></div>
          <h3>{n.title}</h3>
          <div className="cb-badges">
            {s && <span className={`cb-badge st-${s.replace(/\W+/g, '-').toLowerCase()}`}>{stLabel(s)}</span>}
            {n.comoUsar.length > 0 && <span className="cb-badge">Como usar</span>}
          </div>
        </div>
      </button>
      {n.fm.destino && n.fm.destino !== 'descartar' && s !== 'descartada' && (
        <button className="cb-use" onClick={() => ctx.onUse(n)} title="Abrir uma demanda com esta nota"><Sparkles size={13} /> Usar</button>
      )}
    </article>
  );
}

/* ---------------- Grafo ---------------- */

function GraphView({ notes, shown, colorOf, selected, onOpen, groups }: {
  notes: Note[]; shown: Note[]; colorOf: (n: Note) => string | null; selected: string | null; onOpen: (id: string) => void; groups: { query: string; color: string }[];
}) {
  const [orphans, setOrphans] = usePersisted<boolean>('office.cerebro.orphans', true);
  const visible = useMemo(() => new Set(shown.map((n) => n.id)), [shown]);
  const linked = useMemo(() => { const s = new Set<string>(); for (const n of notes) for (const l of n.links) { s.add(n.id); s.add(l); } return s; }, [notes]);
  const nodes = useMemo<GraphNode[]>(() => notes.filter((n) => orphans || linked.has(n.id)).map((n) => ({ id: n.id, title: n.title, color: colorOf(n), dim: !visible.has(n.id) })), [notes, orphans, linked, visible, colorOf]);
  const edges = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const out: [string, string][] = [];
    for (const n of notes) if (ids.has(n.id)) for (const l of n.links) if (ids.has(l)) out.push([n.id, l]);
    return out;
  }, [nodes, notes]);
  return (
    <div className="cb-graph-wrap">
      <CerebroGraph nodes={nodes} edges={edges} selected={selected} onOpen={onOpen} />
      <div className="cb-graph-legend">
        {groups.map((g) => <span key={g.query}><i className="cb-dot" style={{ background: g.color }} />{g.query.replace(/^\w+:\s*"?|"$/g, '')}</span>)}
        <label className="cb-check"><input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> Notas soltas</label>
      </div>
      <p className="cb-graph-hint muted small">Arraste para mover · role para aproximar · clique numa nota para abrir · a busca e as pastas acendem as notas</p>
    </div>
  );
}

/* ---------------- Nota ---------------- */

function NoteDrawer({ ctx, id, onClose }: { ctx: Ctx; id: string; onClose: () => void }) {
  const { notify } = useStore();
  const [confirmDel, setConfirmDel] = useState(false);
  const [full, setFull] = useState<Full | null>(null);
  const [err, setErr] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const n = ctx.byId.get(id);
  useEffect(() => {
    api<Full>(`${ctx.base}/${ctx.cerebro.id}/nota?id=${encodeURIComponent(id)}`).then(setFull).catch((e) => setErr((e as Error).message));
  }, [id, ctx.base, ctx.cerebro.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [onClose]);

  const html = useMemo(() => {
    if (!full) return '';
    // ![[anexo|320]] vira imagem do cofre; [[nota|apelido]] vira link interno
    const src = full.body
      .replace(/!\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, t: string, size?: string) => {
        const p = full.embeds[t.trim()];
        if (!p) return `*(anexo não encontrado: ${t.trim()})*`;
        const w = size && /^\d+$/.test(size.trim()) ? size.trim() : '';
        return `<img src="${fileUrl(ctx.base, ctx.cerebro, p)}" alt=""${w ? ` width="${w}"` : ''} />`;
      })
      .replace(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, t: string, alias?: string) => {
        const target = full.links[t.trim()];
        const label = (alias ?? t).trim();
        return target ? `[${label}](#cb:${encodeURIComponent(target)})` : `<span class="cb-unresolved">${label}</span>`;
      });
    return renderMarkdown(src);
  }, [full, ctx.base, ctx.cerebro]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    const href = a?.getAttribute('href') ?? '';
    if (href.startsWith('#cb:')) { e.preventDefault(); ctx.openNote(decodeURIComponent(href.slice(4))); }
  };
  const copy = (t: string, msg: string) => { navigator.clipboard?.writeText(t); notify(msg); };
  const s = n ? statusOf(n) : '';

  return (
    <div className="cb-drawer-bg" onClick={onClose}>
      <aside className="cb-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={n?.title ?? 'Nota'}>
        <header className="cb-drawer-head">
          <div className="cb-kicker truncate">{n?.folder || 'Raiz do cofre'}</div>
          <button className="icon" onClick={onClose} title="Fechar (Esc)"><X size={16} /></button>
        </header>
        {n && (
          <div className="cb-drawer-meta">
            <div className="cb-badges">
              {s && <span className={`cb-badge st-${s.replace(/\W+/g, '-').toLowerCase()}`}>{stLabel(s)}</span>}
              {n.fm.destino && <span className="cb-badge">{destLabel(n.fm.destino)}</span>}
              {n.fm.categoria && <span className="cb-badge">{n.fm.categoria}</span>}
              {n.tags.map((t) => <span key={t} className="cb-badge">#{t}</span>)}
            </div>
            <div className="cb-actions">
              {n.fm.destino && n.fm.destino !== 'descartar' && <button className="primary small" onClick={() => ctx.onUse(n)}><Sparkles size={13} /> Usar em uma demanda</button>}
              {'status' in n.fm && s !== 'aprovada' && <button className="ghost small" onClick={() => ctx.decide([n.id], { status: 'aprovada' })}><Check size={13} /> Aprovar</button>}
              {'status' in n.fm && s !== 'adiada' && <button className="ghost small" onClick={() => ctx.decide([n.id], { status: 'adiada' })}><Clock size={13} /> Adiar</button>}
              {'status' in n.fm && s !== 'descartada' && <button className="ghost small" onClick={() => ctx.decide([n.id], { status: 'descartada' })}><X size={13} /> Descartar</button>}
            </div>
            <div className="cb-actions">
              {n.url && <a className="ghost small btn-link" href={n.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Link da nota</a>}
              <button className="ghost small" onClick={() => copy(absOf(ctx.cerebro, n.id), 'Caminho copiado')}><Copy size={13} /> Caminho</button>
              {desktop && full && <button className="ghost small" onClick={() => desktop!.showInFolder(full.abs)}><FolderOpen size={13} /> Na pasta</button>}
              <span className="cb-spacer" />
              {confirmDel
                ? <button className="ghost small danger" onClick={() => ctx.remove([n.id])}><Trash2 size={13} /> Confirmar: remover do cérebro</button>
                : <button className="ghost small" onClick={() => setConfirmDel(true)} title="Vai para _apagados, dentro da pasta do cofre; dá para desfazer"><Trash2 size={13} /> Remover</button>}
            </div>
          </div>
        )}
        {err && <div className="error">{err}</div>}
        {!full && !err && <p className="muted small" style={{ padding: 20 }}>Abrindo…</p>}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
        {full && <div ref={body} className="markdown cb-note" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />}
        {full && full.backlinks.length > 0 && (
          <section className="cb-backlinks">
            <h3>Citada em {full.backlinks.length} {full.backlinks.length === 1 ? 'nota' : 'notas'}</h3>
            {full.backlinks.map((b) => <button key={b.id} className="link" onClick={() => ctx.openNote(b.id)}>{b.title}</button>)}
          </section>
        )}
      </aside>
    </div>
  );
}
