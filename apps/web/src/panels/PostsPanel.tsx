import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, Image as ImageIcon, Instagram, Layers, Play, RotateCcw, X } from 'lucide-react';
import { POST_FORMAT_LABEL, canWork, type PostFormat } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { usePersisted } from '../lib/persisted';

/**
 * Posts: a página da social media. Mostra, mês a mês e cliente por cliente, o que já está pronto na pasta do mês no Drive,
 * o que ainda está em produção, o que foi agendado e o que foi ao ar. Copiar a legenda, abrir no Drive, agendar com dia e
 * hora e marcar como postado sem sair daqui. Agendar e marcar postado só mudam o registro no Office: nenhum arquivo muda.
 */

type State = 'producao' | 'pronto' | 'agendado' | 'postado';
interface Item {
  key: string; clientId: string; postId: string | null; date: string | null; time: string | null; format: PostFormat | null;
  theme: string; caption: string; number: number | null; files: string[]; state: State;
}
interface Squad { id: string; nome: string }
interface SquadInfo { squads: Squad[]; byClient: Record<string, string | null> }

const TABS: { id: State | 'todos'; label: string }[] = [
  { id: 'pronto', label: 'Para agendar' },
  { id: 'agendado', label: 'Agendados' },
  { id: 'postado', label: 'Postados' },
  { id: 'producao', label: 'Em produção' },
  { id: 'todos', label: 'Tudo' },
];
const STATE_LABEL: Record<State, string> = { producao: 'em produção', pronto: 'pronto', agendado: 'agendado', postado: 'postado' };
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const VID = /\.(mp4|mov|webm|m4v)$/i;
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ymd = (d: Date) => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`;
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** Domingo da semana do dia. */
const weekOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const thumbUrl = (officeId: string, file: string, w = 320) => `/api/offices/${officeId}/thumb?w=${w}&path=${encodeURIComponent(file)}`;
const when = (it: Pick<Item, 'date' | 'time'>) => {
  if (!it.date) return 'Sem data';
  const d = new Date(`${it.date}T12:00`);
  const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
  return it.time ? `${day} · ${it.time}` : day;
};
/** A imagem que representa a peça: a primeira imagem; num reels, a capa (ou o próprio vídeo). */
const coverOf = (files: string[]) => files.find((f) => IMG.test(f)) ?? files.find((f) => VID.test(f));

export function PostsPanel() {
  const { office, clients, notify } = useStore();
  const posts = useStore((s) => s.posts);
  const [month, setMonth] = useState(() => ym(new Date()));
  const [tab, setTab] = usePersisted<string>('office.posts.tab', 'pronto');
  const [only, setOnly] = usePersisted<string>('office.posts.cliente', '');
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState('');
  const [sq, setSq] = useState<SquadInfo>({ squads: [], byClient: {} });
  const [open, setOpen] = useState<Item | null>(null);
  const [confirmCheck, setConfirmCheck] = useState(false);
  // aba Calendário: semana ou mês (clicar num dia do mês abre a semana dele)
  const [calView, setCalView] = usePersisted<string>('office.posts.calview', 'semana');
  const [weekStart, setWeekStart] = useState(() => weekOf(new Date()));
  const worker = canWork(office?.role);
  const onCalendar = tab === 'calendario';
  const weekly = onCalendar && calView === 'semana';

  // a semana pode cruzar dois meses: lê os dois
  const months = weekly ? [...new Set([ym(weekStart), ym(addDays(weekStart, 6))])] : [month];
  const load = () => {
    Promise.all(months.map((m) => {
      const q = new URLSearchParams({ mes: m });
      if (only && !only.startsWith('squad:')) q.set('cliente', only);
      return api<Item[]>(`/api/offices/${office!.id}/agenda?${q}`);
    })).then((rs) => {
      const seen = new Set<string>();
      setItems(rs.flat().filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true))));
      setErr('');
    }).catch((e) => setErr((e as Error).message));
  };
  // recarrega quando um post muda (agendado aqui, ou o funcionário entregou uma peça)
  const version = posts.map((p) => p.updatedAt).sort().at(-1);
  useEffect(() => { load(); }, [months.join(','), only, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api<SquadInfo>(`/api/offices/${office!.id}/squads`).then(setSq).catch(() => {}); }, [office]);
  useEffect(() => { if (open && items) setOpen(items.find((i) => i.key === open.key) ?? null); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const inScope = (items ?? []).filter((i) => !only.startsWith('squad:') || sq.byClient[i.clientId] === only.slice(6));
  const counts = Object.fromEntries(TABS.map((t) => [t.id, t.id === 'todos' ? inScope.length : inScope.filter((i) => i.state === t.id).length]));
  const shown = onCalendar ? [] : inScope.filter((i) => tab === 'todos' || i.state === tab);
  const groups = useMemo(() => {
    const by = new Map<string, Item[]>();
    for (const i of shown) by.set(i.clientId, [...(by.get(i.clientId) ?? []), i]);
    return [...by.entries()].map(([id, list]) => ({ client: clients.find((c) => c.id === id), list }))
      .sort((a, b) => (a.client?.name ?? '').localeCompare(b.client?.name ?? ''));
  }, [shown, clients]);

  // conferência no Instagram: os clientes em vista que têm peça pronta ou agendada
  const toCheck = [...new Set(inScope.filter((i) => i.state === 'pronto' || i.state === 'agendado').map((i) => i.clientId))];
  const runCheck = async () => {
    setConfirmCheck(false);
    try {
      const r = await api<{ jobs: string[]; agent: string }>(`/api/offices/${office!.id}/agenda/conferir`, { body: { mes: month, clientIds: toCheck } });
      notify(`${r.agent} vai conferir ${r.jobs.length} ${r.jobs.length === 1 ? 'cliente' : 'clientes'} no Instagram. Acompanhe na conversa de cada cliente.`);
    } catch (e) { notify((e as Error).message); }
  };

  const shiftMonth = (n: number) => { const [y, m] = month.split('-').map(Number); setMonth(ym(new Date(y, m - 1 + n, 1))); };
  const shift = (n: number) => {
    if (!weekly) { shiftMonth(n); return; }
    const next = addDays(weekStart, n * 7);
    setWeekStart(next);
    setMonth(ym(addDays(next, 3)));
  };
  const monthLabel = new Date(`${month}-15`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const short = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  const title = weekly ? `${short(weekStart)} – ${short(addDays(weekStart, 6))}` : monthLabel;
  const openWeek = (day: Date) => { setWeekStart(weekOf(day)); setCalView('semana'); };

  const save = async (it: Item, patch: { state: 'pronto' | 'agendado' | 'postado'; date?: string; time?: string | null; caption?: string }, ok?: string) => {
    const date = patch.date ?? it.date;
    if (!date) { notify('Escolha o dia primeiro.'); return false; }
    try {
      await api(`/api/offices/${office!.id}/agenda`, { body: {
        clientId: it.clientId, postId: it.postId, files: it.files, theme: it.theme, format: it.format,
        date, time: patch.time === undefined ? it.time : patch.time, state: patch.state, caption: patch.caption,
      } });
      if (ok) notify(ok);
      load();
      return true;
    } catch (e) { notify((e as Error).message); return false; }
  };

  return (
    <div className="posts-page">
      <header className="posts-head">
        <div className="row gap">
          <button className="icon" onClick={() => shift(-1)} aria-label={weekly ? 'Semana anterior' : 'Mês anterior'}><ChevronLeft size={16} /></button>
          <h3 className="cap">{title}</h3>
          <button className="icon" onClick={() => shift(1)} aria-label={weekly ? 'Próxima semana' : 'Próximo mês'}><ChevronRight size={16} /></button>
          {weekly && <button className="ghost small" onClick={() => { setWeekStart(weekOf(new Date())); setMonth(ym(new Date())); }}>Hoje</button>}
        </div>
        <div className="row gap wrap">
        {worker && <button className="small" disabled={!toCheck.length} title="Um funcionário abre o Instagram de cada cliente no Chrome, compara com as peças e marca o que já foi ao ar (movendo para POSTADOS)" onClick={() => setConfirmCheck(true)}><Instagram size={13} /> Conferir postados</button>}
        <select className="small" value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Clientes">
          <option value="">Todos os clientes</option>
          {sq.squads.map((s) => <option key={s.id} value={`squad:${s.id}`}>Squad {s.nome}</option>)}
          {clients.filter((c) => c.status !== 'encerrado').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        </div>
      </header>
      {confirmCheck && (
        <div className="approval">
          <span>Conferir no Instagram {toCheck.length === 1 ? `o perfil de ${clients.find((c) => c.id === toCheck[0])?.name ?? 'um cliente'}` : `${toCheck.length} clientes`}? O funcionário abre cada perfil no Chrome (só leitura), compara com as peças de {monthLabel} e marca as que já foram ao ar, movendo os arquivos para POSTADOS.</span>
          <span className="spacer" />
          <button className="ghost small" onClick={() => setConfirmCheck(false)}>Cancelar</button>
          <button className="primary small" onClick={runCheck}>Conferir</button>
        </div>
      )}
      <nav className="posts-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label} <span className="count">{counts[t.id] ?? 0}</span>
          </button>
        ))}
        <button role="tab" aria-selected={onCalendar} className={`posts-tab-cal ${onCalendar ? 'on' : ''}`} onClick={() => setTab('calendario')}>
          <CalendarDays size={13} /> Calendário
        </button>
        {onCalendar && (
          <div className="seg posts-calview" role="group" aria-label="Ver por">
            <button className={calView === 'semana' ? 'on' : ''} onClick={() => { setCalView('semana'); setWeekStart(weekOf(ym(new Date()) === month ? new Date() : new Date(`${month}-01T12:00`))); }}>Semana</button>
            <button className={calView === 'mes' ? 'on' : ''} onClick={() => { setCalView('mes'); setMonth(ym(addDays(weekStart, 3))); }}>Mês</button>
          </div>
        )}
      </nav>
      {err && <div className="error">{err}</div>}
      {!items && !err && <p className="muted small">Lendo as pastas do mês…</p>}
      {items && onCalendar && (calView === 'mes'
        ? <MonthGrid month={month} items={inScope} clients={clients} onDay={openWeek} />
        : <WeekGrid start={weekStart} items={inScope} clients={clients} onOpen={setOpen} />)}
      {items && onCalendar && inScope.some((i) => !i.date) && (
        <p className="muted small">{inScope.filter((i) => !i.date).length} peça(s) sem data não aparecem no calendário: agende pela aba Para agendar.</p>
      )}
      {items && !onCalendar && shown.length === 0 && (
        <div className="empty"><CalendarClock size={22} /><p>{tab === 'pronto' ? 'Nada esperando agendamento neste mês. As peças aparecem aqui quando chegam na pasta do mês no Drive.' : 'Nada aqui neste mês.'}</p></div>
      )}
      {groups.map(({ client, list }) => (
        <ClientGroup key={client?.id ?? '?'} name={client?.name ?? 'Cliente'} color={client?.color} list={list}
          render={(it) => <PostItem key={it.key} it={it} worker={worker} onOpen={() => setOpen(it)} save={save} />} />
      ))}
      {open && <PostDetail it={open} worker={worker} client={clients.find((c) => c.id === open.clientId)?.name ?? ''} save={save} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ClientGroup({ name, color, list, render }: { name: string; color?: string; list: Item[]; render: (it: Item) => React.ReactNode }) {
  const [closed, setClosed] = useState(false);
  return (
    <section className={`fold posts-group ${closed ? 'closed' : ''}`}>
      <button type="button" className="fold-head" aria-expanded={!closed} onClick={() => setClosed(!closed)}>
        <ChevronDown size={13} className="fold-chevron" />
        <span className="dot" style={{ background: color }} />
        <span>{name}</span>
        <span className="fold-count">{list.length}</span>
      </button>
      {!closed && <div className="posts-grid">{list.map(render)}</div>}
    </section>
  );
}

type Save = (it: Item, patch: { state: 'pronto' | 'agendado' | 'postado'; date?: string; time?: string | null; caption?: string }, ok?: string) => Promise<boolean>;

const copy = async (text: string, notify: (s: string) => void, what = 'Legenda copiada') => {
  try { await navigator.clipboard.writeText(text); notify(what); } catch { notify(text); }
};

function PostItem({ it, worker, onOpen, save }: { it: Item; worker: boolean; onOpen: () => void; save: Save }) {
  const { office, notify } = useStore();
  const [scheduling, setScheduling] = useState(false);
  const cover = coverOf(it.files);
  const video = it.files.some((f) => VID.test(f));
  const slides = it.files.filter((f) => IMG.test(f)).length;
  return (
    <article className={`post-item st-${it.state}`}>
      <button type="button" className="post-item-thumb" onClick={onOpen} title="Ver a peça">
        {cover ? <img src={thumbUrl(office!.id, cover)} alt="" loading="lazy" /> : <ImageIcon size={20} />}
        {slides > 1 && <span className="badge-corner"><Layers size={11} /> {slides}</span>}
        {video && <span className="badge-corner"><Play size={11} /></span>}
      </button>
      <div className="post-item-body">
        <span className="post-item-meta">
          <span className={`state-pill st-${it.state}`}>{STATE_LABEL[it.state]}</span>
          <span className="muted small">{when(it)}</span>
        </span>
        <b className="post-item-title" title={it.theme}>{it.number != null ? `${String(it.number).padStart(2, '0')} · ` : ''}{it.theme}</b>
        <span className="muted small">{it.format ? POST_FORMAT_LABEL[it.format] : 'Peça'}</span>
        {it.caption && <p className="post-item-caption">{it.caption}</p>}
        {scheduling ? (
          <ScheduleForm it={it} onCancel={() => setScheduling(false)} onSave={async (date, time) => { if (await save(it, { state: 'agendado', date, time }, 'Agendado')) setScheduling(false); }} />
        ) : (
          <div className="row gap-s wrap">
            {it.caption && <button className="ghost small" onClick={() => copy(it.caption, notify)}><Copy size={12} /> Legenda</button>}
            {worker && it.state === 'pronto' && <button className="primary small" onClick={() => setScheduling(true)}><CalendarClock size={12} /> Agendar</button>}
            {worker && (it.state === 'pronto' || it.state === 'agendado') && <button className="small" title="Marca como postado e move os arquivos para POSTADOS" onClick={() => save(it, { state: 'postado', date: it.date ?? new Date().toISOString().slice(0, 10) }, 'Postado: arquivos em POSTADOS')}><Check size={12} /> Postado</button>}
            {worker && it.state === 'postado' && <button className="ghost small" title="Volta para Para agendar e devolve os arquivos que o Office moveu para POSTADOS" onClick={() => save(it, { state: 'pronto', date: it.date ?? undefined, time: null }, 'Voltou para Para agendar')}><RotateCcw size={12} /> Desfazer</button>}
            {worker && it.state === 'agendado' && <button className="ghost small" onClick={() => setScheduling(true)}>Mudar</button>}
            {it.state === 'producao' && <span className="muted small">Ainda não chegou à pasta do mês</span>}
          </div>
        )}
      </div>
    </article>
  );
}

function ScheduleForm({ it, onSave, onCancel }: { it: Item; onSave: (date: string, time: string | null) => void; onCancel: () => void }) {
  const [date, setDate] = useState(it.date ?? '');
  const [time, setTime] = useState(it.time ?? '');
  return (
    <form className="schedule-form" onSubmit={(e) => { e.preventDefault(); if (date) onSave(date, time || null); }}>
      <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} aria-label="Dia" />
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Horário" />
      <button className="primary small" disabled={!date}>Salvar</button>
      <button type="button" className="ghost small" onClick={onCancel}>Cancelar</button>
    </form>
  );
}

function PostDetail({ it, client, worker, save, onClose }: { it: Item; client: string; worker: boolean; save: Save; onClose: () => void }) {
  const { office, notify } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  const [i, setI] = useState(0);
  const [caption, setCaption] = useState(it.caption);
  const [date, setDate] = useState(it.date ?? '');
  const [time, setTime] = useState(it.time ?? '');
  useEffect(() => { setCaption(it.caption); setDate(it.date ?? ''); setTime(it.time ?? ''); }, [it.key, it.caption, it.date, it.time]);
  const file = it.files[Math.min(i, it.files.length - 1)];
  const name = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const link = async (p: string) => {
    try { return (await api<{ link: string | null }>(`/api/offices/${office!.id}/link?path=${encodeURIComponent(p)}`)).link; } catch { return null; }
  };
  const openDrive = async (p: string) => { const l = await link(p); if (l) window.open(l, '_blank'); else notify('O Drive ainda não deu o link (pode estar subindo).'); };
  const copyLink = async (p: string) => { const l = await link(p); if (l) copy(l, notify, 'Link copiado'); else notify('O Drive ainda não deu o link (pode estar subindo).'); };
  const folder = file ? file.replace(/[\\/][^\\/]+$/, '') : null;
  const captionChanged = caption !== it.caption;
  const keepState = it.state === 'producao' ? 'pronto' : it.state;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal post-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3 className="truncate">{client} · {it.number != null ? `${String(it.number).padStart(2, '0')} · ` : ''}{it.theme}</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
        </header>
        <div className="post-modal-body">
          <section className="post-preview">
            <div className="post-stage">
              {!file ? <div className="post-empty"><ImageIcon size={22} /><span className="muted small">Ainda sem arquivo.</span></div>
                : VID.test(file) ? <video key={file} src={mediaUrl(office!.id, file)} controls />
                : <img key={file} src={mediaUrl(office!.id, file)} alt={name(file)} />}
              {it.files.length > 1 && (
                <>
                  <button type="button" className="icon post-nav prev" aria-label="Anterior" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={18} /></button>
                  <button type="button" className="icon post-nav next" aria-label="Próxima" disabled={i >= it.files.length - 1} onClick={() => setI(i + 1)}><ChevronRight size={18} /></button>
                  <span className="post-count mono">{i + 1}/{it.files.length}</span>
                </>
              )}
            </div>
            {it.files.length > 1 && (
              <div className="post-strip">
                {it.files.map((f, n) => (
                  <button type="button" key={f} className={n === i ? 'on' : ''} title={name(f)} onClick={() => setI(n)}>
                    {IMG.test(f) || VID.test(f) ? <img src={thumbUrl(office!.id, f, 120)} alt="" loading="lazy" /> : <span className="mono small">{n + 1}</span>}
                  </button>
                ))}
              </div>
            )}
            {file && (
              <div className="post-links">
                <span className="small truncate" title={file}>{name(file)}</span>
                <div className="row gap-s wrap">
                  <button type="button" className="ghost small" onClick={() => openDrive(file)}><ExternalLink size={12} /> Arquivo no Drive</button>
                  <button type="button" className="ghost small" onClick={() => copyLink(file)}><Copy size={12} /> Copiar link</button>
                  {folder && <button type="button" className="ghost small" onClick={() => openDrive(folder)}><ExternalLink size={12} /> Pasta no Drive</button>}
                </div>
              </div>
            )}
          </section>
          <div className="modal-body">
            <div className="row gap">
              <span className={`state-pill st-${it.state}`}>{STATE_LABEL[it.state]}</span>
              <span className="muted small">{it.format ? POST_FORMAT_LABEL[it.format] : 'Peça'} · {when(it)}</span>
            </div>
            <label>Legenda
              <textarea rows={12} maxLength={2200} value={caption} disabled={!worker} placeholder="Escreva ou cole a legenda do post" onChange={(e) => setCaption(e.target.value)} />
            </label>
            <div className="row gap-s wrap">
              <button className="ghost small" disabled={!caption} onClick={() => copy(caption, notify)}><Copy size={12} /> Copiar legenda</button>
              {worker && captionChanged && <button className="small" onClick={() => save(it, { state: keepState, date: date || undefined, caption }, 'Legenda salva')}>Salvar legenda</button>}
              <span className="muted small">{caption.length}/2200</span>
            </div>
            {worker && it.state !== 'producao' && (
              <fieldset className="schedule-box">
                <legend className="section-label">Agendamento</legend>
                <div className="grid2">
                  <label>Dia<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                  <label>Horário<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
                </div>
                <div className="row gap-s wrap">
                  {it.state !== 'postado' && <button className="primary small" disabled={!date} onClick={() => save(it, { state: 'agendado', date, time: time || null, caption: captionChanged ? caption : undefined }, 'Agendado')}><CalendarClock size={12} /> {it.state === 'agendado' ? 'Salvar agendamento' : 'Agendar'}</button>}
                  {it.state !== 'postado' && <button className="small" onClick={() => save(it, { state: 'postado', date: date || today, time: time || null, caption: captionChanged ? caption : undefined }, 'Postado: arquivos em POSTADOS')}><Check size={12} /> Já foi postado</button>}
                  {(it.state === 'agendado' || it.state === 'postado') && <button className="ghost small" onClick={() => save(it, { state: 'pronto', date: date || undefined, time: null }, 'Voltou para Para agendar')}><RotateCcw size={12} /> Desfazer</button>}
                </div>
                <span className="muted small">Agendar só registra no Office. Postado move os arquivos para POSTADOS, com o nome de postado; desfazer devolve.</span>
              </fieldset>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type ClientLite = { id: string; name: string; color?: string };
const STATE_ORDER: State[] = ['postado', 'agendado', 'pronto', 'producao'];

/** Mês inteiro: cada dia com as miniaturas dos posts. Clicar no dia abre a semana dele. */
function MonthGrid({ month, items, clients, onDay }: { month: string; items: Item[]; clients: ClientLite[]; onDay: (d: Date) => void }) {
  const { office } = useStore();
  const first = new Date(`${month}-01T12:00`);
  const start = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = ymd(new Date());
  const byDay = new Map<string, Item[]>();
  for (const it of items) if (it.date) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
  return (
    <div className="pcal-month">
      {WEEK.map((w) => <div key={w} className="pcal-head">{w}</div>)}
      {days.map((d) => {
        const key = ymd(d);
        const list = (byDay.get(key) ?? []).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
        return (
          <button key={key} className={`pcal-day ${ym(d) !== month ? 'out' : ''} ${key === today ? 'today' : ''}`} onClick={() => onDay(d)} title="Ver a semana">
            <span className="num">{d.getDate()}</span>
            <span className="pcal-thumbs">
              {list.slice(0, 6).map((it) => {
                const cover = coverOf(it.files);
                const c = clients.find((x) => x.id === it.clientId);
                return (
                  <span key={it.key} className={`pcal-thumb st-${it.state}`} style={{ ['--cl' as string]: c?.color ?? 'var(--border)' }} title={`${c?.name ?? ''} · ${it.theme} · ${STATE_LABEL[it.state]}`}>
                    {cover ? <img src={thumbUrl(office!.id, cover, 120)} alt="" loading="lazy" /> : null}
                  </span>
                );
              })}
              {list.length > 6 && <span className="pcal-more">+{list.length - 6}</span>}
            </span>
          </button>
        );
      })}
      <div className="pcal-legend">{STATE_ORDER.map((s) => <span key={s} className={`state-pill st-${s}`}>{STATE_LABEL[s]}</span>)}<span className="muted small">a borda tem a cor do cliente</span></div>
    </div>
  );
}

/** Semana: uma coluna por dia com os posts em ordem de horário. */
function WeekGrid({ start, items, clients, onOpen }: { start: Date; items: Item[]; clients: ClientLite[]; onOpen: (it: Item) => void }) {
  const { office } = useStore();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = ymd(new Date());
  return (
    <div className="pcal-week">
      {days.map((d) => {
        const key = ymd(d);
        const list = items.filter((i) => i.date === key).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99') || (a.number ?? 999) - (b.number ?? 999));
        return (
          <section key={key} className={`pcal-col ${key === today ? 'today' : ''}`}>
            <header><span className="muted small">{WEEK[d.getDay()]}</span><b>{d.getDate()}</b>{list.length > 0 && <span className="muted small">{list.length}</span>}</header>
            <div className="pcal-col-body">
              {list.length === 0 && <span className="muted small pcal-empty">—</span>}
              {list.map((it) => {
                const cover = coverOf(it.files);
                const c = clients.find((x) => x.id === it.clientId);
                const slides = it.files.filter((f) => IMG.test(f)).length;
                return (
                  <button key={it.key} className={`pcal-card st-${it.state}`} style={{ ['--cl' as string]: c?.color ?? 'var(--border)' }} onClick={() => onOpen(it)} title={it.theme}>
                    <span className="pcal-card-thumb">
                      {cover ? <img src={thumbUrl(office!.id, cover, 240)} alt="" loading="lazy" /> : <ImageIcon size={16} />}
                      {slides > 1 && <span className="badge-corner"><Layers size={10} /> {slides}</span>}
                      {it.files.some((f) => VID.test(f)) && <span className="badge-corner"><Play size={10} /></span>}
                    </span>
                    <span className="pcal-card-client truncate"><span className="dot" style={{ background: c?.color }} />{c?.name}</span>
                    <span className="pcal-card-title">{it.theme}</span>
                    <span className="pcal-card-meta"><span className={`state-pill st-${it.state}`}>{STATE_LABEL[it.state]}</span>{it.time && <span className="mono small">{it.time}</span>}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
