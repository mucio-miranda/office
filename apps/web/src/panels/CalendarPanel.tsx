import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import type { CalendarEvent } from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

const KIND_COLOR: Record<CalendarEvent['kind'], string> = { reuniao: 'var(--running)', gravacao: 'var(--review)', entrega: 'var(--done)', publicacao: 'var(--waiting)', pessoal: 'var(--idle)', outro: 'var(--waiting)' };
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function CalendarPanel() {
  const { events, demands, clients, office, open } = useStore();
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
          <button className="primary" onClick={() => setForm({ kind: 'reuniao', start: `${today}T10:00`, end: `${today}T11:00` })}>
            <Plus size={14} /> Evento</button>
        </div>
        <div className="cal-grid">
          {WEEK.map((w) => <div key={w} className="cal-head">{w}</div>)}
          {days.map((d) => {
            const key = ymd(d);
            const dayEvents = events.filter((e) => e.start.slice(0, 10) === key);
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
                {dueHere.map((x) => <div key={x.id} className="cal-due" title="Prazo de demanda">prazo · {x.title}</div>)}
              </div>
            );
          })}
        </div>
        <p className="muted small">Clique duas vezes num dia para criar um evento. Os prazos das demandas aparecem em amarelo.</p>
      </div>
      <aside className="cal-side">
        <div className="section-label" style={{ padding: 0 }}>Próximos</div>
        {upcoming.length === 0 && <p className="muted small">Nada marcado.</p>}
        {upcoming.map((e) => (
          <div key={e.id} className="up-item" onClick={() => pick(e)}>
            <span className="dot" style={{ background: KIND_COLOR[e.kind] }} />
            <div><b>{e.title}</b><small>{new Date(e.start).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div>
          </div>
        ))}
      </aside>
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
