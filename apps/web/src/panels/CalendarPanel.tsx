import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Sparkles, X } from 'lucide-react';
import { POST_FORMATS, POST_FORMAT_LABEL, POST_STATUSES, POST_STATUS_LABEL, canWork, needsTunning, type CalendarEvent, type ContentPost } from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

const KIND_COLOR: Record<CalendarEvent['kind'], string> = { reuniao: 'var(--running)', gravacao: 'var(--review)', entrega: 'var(--done)', publicacao: 'var(--waiting)', pessoal: 'var(--idle)', outro: 'var(--waiting)' };
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const DONE: ContentPost['status'][] = ['aprovado', 'drive', 'postado'];
const FORMAT_SHORT: Record<ContentPost['format'], string> = { estatico: 'EST', carrossel: 'CAR', reels: 'REEL', 'capa-reels': 'CAPA', story: 'STORY' };

/** "7 de 15 prontas · 2 no tunning": responde o "e aí, falta muito?" sem precisar perguntar. */
export function PostProgress({ demandId, posts: given }: { demandId?: string; posts?: ContentPost[] }) {
  const all = useStore((s) => s.posts);
  const posts = (given ?? all.filter((p) => p.demandId === demandId)).filter((p) => p.status !== 'cancelado');
  if (!posts.length) return null;
  const done = posts.filter((p) => DONE.includes(p.status)).length;
  const tun = posts.filter((p) => p.status === 'tunning').length;
  return (
    <div className="post-progress" title={POST_STATUSES.filter((s) => s !== 'cancelado').map((s) => `${POST_STATUS_LABEL[s]}: ${posts.filter((p) => p.status === s).length}`).join(' · ')}>
      <div className="bar"><span style={{ width: `${(done / posts.length) * 100}%` }} /></div>
      <small className="muted">{done} de {posts.length} prontas{tun ? ` · ${tun} no tunning` : ''}</small>
    </div>
  );
}

export function CalendarPanel() {
  const { events, demands, clients, office, open, posts } = useStore();
  const [only, setOnly] = useState('');
  const [post, setPost] = useState<Partial<ContentPost> | null>(null);
  const color = (id: string) => clients.find((c) => c.id === id)?.color ?? 'var(--muted-foreground)';
  // publicação agendada: abre a demanda (é lá que se reagenda e marca como publicado)
  const pick = (e: CalendarEvent) => (e.kind === 'publicacao' && e.demandId ? open('demandas', e.demandId) : setForm(e));
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [form, setForm] = useState<Partial<CalendarEvent> | null>(null);
  const first = new Date(cursor);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const today = ymd(new Date());
  const month = cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const shift = (n: number) => { const d = new Date(cursor); d.setMonth(d.getMonth() + n); setCursor(d); };
  const upcoming = [...events].filter((e) => e.start.slice(0, 10) >= today).slice(0, 8);

  return (
    <div className="calendar-wrap">
      <div className="calendar">
        <div className="row between">
          <div className="row gap">
            <button className="icon" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
            <h3 className="cap">{month}</h3>
            <button className="icon" onClick={() => shift(1)}><ChevronRight size={16} /></button>
          </div>
          <div className="row gap">
            <select className="small" value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Cliente do calendário">
              <option value="">Todos os clientes</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {canWork(office?.role) && <button onClick={() => setPost({ clientId: only || undefined, date: today, format: 'estatico', status: 'planejado' })}><Plus size={14} /> Post</button>}
            <button className="primary" onClick={() => setForm({ kind: 'reuniao', start: `${today}T10:00`, end: `${today}T11:00` })}>
              <Plus size={14} /> Evento</button>
          </div>
        </div>
        <div className="cal-grid">
          {WEEK.map((w) => <div key={w} className="cal-head">{w}</div>)}
          {days.map((d) => {
            const key = ymd(d);
            const dayEvents = events.filter((e) => e.start.slice(0, 10) === key && (!only || e.clientId === only));
            const dayPosts = posts.filter((p) => p.date === key && p.status !== 'cancelado' && (!only || p.clientId === only));
            const dueHere = demands.filter((x) => x.dueDate === key && x.status !== 'entregue');
            return (
              <div key={key} className={`cal-day ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${key === today ? 'today' : ''}`}
                onDoubleClick={() => setForm({ kind: 'reuniao', start: `${key}T10:00`, end: `${key}T11:00` })}>
                <span className="num">{d.getDate()}</span>
                {dayEvents.map((e) => (
                  <div key={e.id} className="cal-ev" style={{ ['--st' as any]: KIND_COLOR[e.kind] }} onClick={() => pick(e)}>
                    {e.start.slice(11, 16)} {e.title}
                  </div>
                ))}
                {dayPosts.map((p) => (
                  <div key={p.id} className={`cal-post st-${p.status}`} style={{ ['--cl' as any]: color(p.clientId) }} onClick={() => setPost(p)}
                    title={`${clients.find((c) => c.id === p.clientId)?.name}: ${POST_FORMAT_LABEL[p.format]} · ${POST_STATUS_LABEL[p.status]}${p.tunning === 'feito' ? ' · tunado' : ''}`}>
                    <b>{p.number ? String(p.number).padStart(2, '0') : FORMAT_SHORT[p.format]}</b> {p.theme}{p.tunning === 'feito' && <Sparkles size={10} />}
                  </div>
                ))}
                {dueHere.map((x) => <div key={x.id} className="cal-due" title="Prazo de demanda">prazo · {x.title}</div>)}
              </div>
            );
          })}
        </div>
        <p className="muted small">Clique duas vezes num dia para criar um evento. Os posts do calendário de conteúdo aparecem com a cor do cliente e a etapa; o funcionário atualiza sozinho enquanto produz. Os prazos das demandas aparecem em amarelo.</p>
      </div>
      <aside className="cal-side">
        <div className="section-label" style={{ padding: 0 }}>Conteúdo do mês</div>
        {clients.filter((c) => posts.some((p) => p.clientId === c.id && p.date.slice(0, 7) === ymd(cursor).slice(0, 7))).map((c) => (
          <div key={c.id} className="up-item" onClick={() => setOnly(c.id)}>
            <span className="dot" style={{ background: c.color }} />
            <div style={{ flex: 1, minWidth: 0 }}><b>{c.name}</b><PostProgress posts={posts.filter((p) => p.clientId === c.id && p.date.slice(0, 7) === ymd(cursor).slice(0, 7))} /></div>
          </div>
        ))}
        <div className="section-label" style={{ padding: 0 }}>Próximos</div>
        {upcoming.length === 0 && <p className="muted small">Nada marcado.</p>}
        {upcoming.map((e) => (
          <div key={e.id} className="up-item" onClick={() => pick(e)}>
            <span className="dot" style={{ background: KIND_COLOR[e.kind] }} />
            <div><b>{e.title}</b><small>{new Date(e.start).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>
          </div>
        ))}
      </aside>
      {post && <PostForm p={post} onClose={() => setPost(null)} />}
      {form && <EventForm e={form} onClose={() => setForm(null)} clients={clients} officeId={office!.id} />}
    </div>
  );
}

function EventForm({ e, onClose, clients, officeId }: { e: Partial<CalendarEvent>; onClose: () => void; clients: { id: string; name: string }[]; officeId: string }) {
  const [f, setF] = useState<Partial<CalendarEvent>>({ ...e, start: e.start?.slice(0, 16), end: e.end?.slice(0, 16) });
  const base = `/api/offices/${officeId}/events`;
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(x) => x.stopPropagation()} onSubmit={async (x) => {
        x.preventDefault();
        const body = { title: f.title, start: f.start, end: f.end, kind: f.kind, clientId: f.clientId || null, room: f.room || null };
        if (f.id) await api(`${base}/${f.id}`, { method: 'PATCH', body }); else await api(base, { body });
        onClose();
      }}>
        <header className="modal-head"><h3>{f.id ? 'Editar evento' : 'Novo evento'}</h3><button type="button" className="icon" onClick={onClose}><X size={16} /></button></header>
        <div className="modal-body">
        <label>Título<input autoFocus required value={f.title ?? ''} onChange={(x) => setF({ ...f, title: x.target.value })} /></label>
        <div className="grid2">
          <label>Início<input type="datetime-local" value={f.start ?? ''} onChange={(x) => setF({ ...f, start: x.target.value })} /></label>
          <label>Fim<input type="datetime-local" value={f.end ?? ''} onChange={(x) => setF({ ...f, end: x.target.value })} /></label>
          <label>Tipo<select value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value as CalendarEvent['kind'] })}>
            {Object.keys(KIND_COLOR).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>Cliente<select value={f.clientId ?? ''} onChange={(x) => setF({ ...f, clientId: x.target.value })}>
            <option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        </div>
        <footer className="modal-foot">
          {f.id ? <button type="button" className="ghost danger" onClick={async () => { await api(`${base}/${f.id}`, { method: 'DELETE' }); onClose(); }}>Remover</button> : <span />}
          <div className="row gap"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
        </footer>
      </form>
    </div>
  );
}

function PostForm({ p, onClose }: { p: Partial<ContentPost>; onClose: () => void }) {
  const { office, clients, demands, notify } = useStore();
  const [f, setF] = useState<Partial<ContentPost>>(p);
  const [err, setErr] = useState('');
  const guest = !canWork(office?.role);
  const theirs = demands.filter((d) => d.clientId === f.clientId);
  const blocked = !!f.format && needsTunning(f.format) && !f.tunning && POST_STATUSES.indexOf(f.status ?? 'planejado') > POST_STATUSES.indexOf('conferencia');
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(x) => x.stopPropagation()} onSubmit={async (x) => {
        x.preventDefault();
        setErr('');
        try {
          const { officeId, clientId, updatedAt, updatedBy, ...rest } = f as ContentPost;
          await api(`/api/offices/${office!.id}/clients/${f.clientId}/posts`, { body: { posts: [rest] } });
          notify('Calendário salvo');
          onClose();
        } catch (e) { setErr((e as Error).message); }
      }}>
        <header className="modal-head"><h3>{f.id ? 'Post do calendário' : 'Novo post'}</h3><button type="button" className="icon" onClick={onClose}><X size={16} /></button></header>
        <fieldset className="modal-body" disabled={guest} style={{ border: 0, margin: 0 }}>
          <div className="grid2">
            <label>Cliente<select required disabled={!!f.id} value={f.clientId ?? ''} onChange={(x) => setF({ ...f, clientId: x.target.value, demandId: null })}>
              <option value="">Escolha</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Demanda<select value={f.demandId ?? ''} onChange={(x) => setF({ ...f, demandId: x.target.value || null })}>
              <option value="">Nenhuma</option>{theirs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
            <label>Data<input type="date" required value={f.date ?? ''} onChange={(x) => setF({ ...f, date: x.target.value })} /></label>
            <div className="grid2">
              <label>Formato<select value={f.format} onChange={(x) => setF({ ...f, format: x.target.value as ContentPost['format'] })}>
                {POST_FORMATS.map((k) => <option key={k} value={k}>{POST_FORMAT_LABEL[k]}</option>)}</select></label>
              <label>Nº<input type="number" min={0} max={999} value={f.number ?? ''} onChange={(x) => setF({ ...f, number: x.target.value === '' ? null : Number(x.target.value) })} /></label>
            </div>
          </div>
          <label>Tema<input required maxLength={200} value={f.theme ?? ''} onChange={(x) => setF({ ...f, theme: x.target.value })} /></label>
          <label>Legenda<textarea rows={3} maxLength={2200} value={f.caption ?? ''} onChange={(x) => setF({ ...f, caption: x.target.value })} /></label>
          <div className="grid2">
            <label>Etapa<select value={f.status} onChange={(x) => setF({ ...f, status: x.target.value as ContentPost['status'] })}>
              {POST_STATUSES.map((k) => <option key={k} value={k}>{POST_STATUS_LABEL[k]}</option>)}</select></label>
            <label>Tunning<select value={f.tunning ?? ''} disabled={!!f.format && !needsTunning(f.format)} onChange={(x) => setF({ ...f, tunning: (x.target.value || null) as ContentPost['tunning'] })}>
              <option value="">ainda não</option><option value="feito">feito</option><option value="dispensado">sem tunning (decisão)</option></select></label>
          </div>
          {blocked && <p className="error small" style={{ margin: 0 }}>O tunning é parte do design: marque "feito" ou decida "sem tunning" antes de aprovar.</p>}
          <label>Observações<textarea rows={2} maxLength={2000} value={f.notes ?? ''} placeholder="Referência, foto escolhida, pedido da cliente" onChange={(x) => setF({ ...f, notes: x.target.value })} /></label>
          {!!f.files?.length && <div className="small"><b>Peças</b>{f.files.map((x) => <div key={x} className="mono truncate" title={x}>{x}</div>)}</div>}
          {err && <div className="error">{err}</div>}
        </fieldset>
        <footer className="modal-foot">
          <span className="muted small">{f.updatedBy?.startsWith('agent:') ? 'Atualizado pelo funcionário' : ''}</span>
          <div className="row gap"><button type="button" className="ghost" onClick={onClose}>Fechar</button>{!guest && <button className="primary" disabled={blocked || !f.clientId}>Salvar</button>}</div>
        </footer>
      </form>
    </div>
  );
}
