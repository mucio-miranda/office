import { useEffect, useState } from 'react';
import { DEMAND_COLUMNS, DEMAND_COLUMN_LABEL, type Demand, type DemandKind, type DemandStatus, type Priority } from '@office/shared';
import { useStore } from '../lib/store';
import { api, fmtDuration } from '../lib/api';

const KIND_ICON: Record<DemandKind, string> = { video: '🎬', design: '🎨', copy: '✍️', estrategia: '🧭', foto: '📷', outro: '📌' };
const PRIO_CLASS: Record<Priority, string> = { baixa: 'p-low', media: 'p-med', alta: 'p-high', urgente: 'p-urgent' };
/** Que funcionário de IA é o natural para cada tipo de demanda. */
const KIND_AGENT: Record<DemandKind, string> = { video: 'editor-de-video', design: 'designer', foto: 'designer', copy: 'copywriter', estrategia: 'copywriter', outro: 'gerente' };

export function Demands() {
  const { demands, clients, agents, members, office, panelArg, notify } = useStore();
  const [editing, setEditing] = useState<Partial<Demand> | null>(null);
  const [delegating, setDelegating] = useState<Demand | null>(null);
  const [filter, setFilter] = useState('');
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (panelArg) setEditing(demands.find((d) => d.id === panelArg) ?? null);
  }, [panelArg]);

  const base = `/api/offices/${office!.id}/demands`;
  const move = async (id: string, status: DemandStatus) => {
    await api(`${base}/${id}`, { method: 'PATCH', body: { status } });
  };
  const assigneeName = (a: string | null) => {
    if (!a) return null;
    const [kind, id] = a.split(':');
    if (kind === 'agent') { const ag = agents.find((x) => x.id === id); return ag ? { name: `🤖 ${ag.name}`, color: ag.color } : null; }
    const m = members.find((x) => x.id === id);
    return m ? { name: m.name, color: m.color } : null;
  };
  const elapsed = (d: Demand) => d.trackedSeconds + (d.timerStartedAt ? Math.round((Date.now() - Date.parse(d.timerStartedAt)) / 1000) : 0);
  const today = new Date().toISOString().slice(0, 10);
  const visible = demands.filter((d) => !filter || d.clientId === filter);

  return (
    <div className="kanban-wrap">
      <div className="row gap">
        <button className="primary" onClick={() => setEditing({ status: 'a_fazer', kind: 'video', priority: 'media' })}>+ Nova demanda</button>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="muted small">Arraste os cartões entre as colunas. ▶ liga o cronômetro. 🤖 delega para um funcionário de IA.</span>
      </div>
      <div className="kanban">
        {DEMAND_COLUMNS.map((col) => (
          <div key={col} className="kcol" onDragOver={(e) => e.preventDefault()} onDrop={(e) => move(e.dataTransfer.getData('id'), col)}>
            <h4>{DEMAND_COLUMN_LABEL[col]} <span>{visible.filter((d) => d.status === col).length}</span></h4>
            {visible.filter((d) => d.status === col).map((d) => {
              const client = clients.find((c) => c.id === d.clientId);
              const who = assigneeName(d.assignee);
              return (
                <article key={d.id} className={`kcard ${PRIO_CLASS[d.priority]}`} draggable onDragStart={(e) => e.dataTransfer.setData('id', d.id)} onClick={() => setEditing(d)}>
                  <div className="kcard-top">
                    <span>{KIND_ICON[d.kind]}</span>
                    {client && <span className="chip" style={{ background: client.color + '33', color: client.color }}>{client.name}</span>}
                    {d.dueDate && <span className={`due ${d.dueDate < today && d.status !== 'entregue' ? 'late' : ''}`}>{d.dueDate.slice(8, 10)}/{d.dueDate.slice(5, 7)}</span>}
                  </div>
                  <b>{d.title}</b>
                  <div className="kcard-foot" onClick={(e) => e.stopPropagation()}>
                    {who ? <span className="who"><span className="dot" style={{ background: who.color }} />{who.name}</span> : <span className="muted small">sem responsável</span>}
                    <button className={`timer ${d.timerStartedAt ? 'on' : ''}`} onClick={() => api(`${base}/${d.id}/timer`, { body: {} })}>
                      {d.timerStartedAt ? '⏸' : '▶'} {fmtDuration(elapsed(d))}
                    </button>
                    <button className="ghost small" title="Delegar para IA" onClick={() => setDelegating(d)}>🤖</button>
                  </div>
                </article>
              );
            })}
          </div>
        ))}
      </div>
      {editing && <DemandForm d={editing} onClose={() => setEditing(null)} />}
      {delegating && (
        <Delegate d={delegating} onClose={() => setDelegating(null)} onDone={(name) => { setDelegating(null); notify(`🤖 ${name} começou a trabalhar`); }} />
      )}
    </div>
  );
}

function DemandForm({ d, onClose }: { d: Partial<Demand>; onClose: () => void }) {
  const { clients, members, agents, office } = useStore();
  const [f, setF] = useState<Partial<Demand>>(d);
  const set = (k: keyof Demand) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value || null });
  const base = `/api/offices/${office!.id}/demands`;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { title: f.title, description: f.description ?? '', clientId: f.clientId ?? null, kind: f.kind, status: f.status, priority: f.priority, assignee: f.assignee ?? null, dueDate: f.dueDate ?? null };
    if (f.id) await api(`${base}/${f.id}`, { method: 'PATCH', body });
    else await api(base, { body });
    onClose();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>{f.id ? 'Editar demanda' : 'Nova demanda'}</h3>
        <label>Título<input autoFocus required value={f.title ?? ''} onChange={set('title')} /></label>
        <label>Descrição / briefing<textarea rows={4} value={f.description ?? ''} onChange={set('description')} /></label>
        <div className="grid3">
          <label>Cliente<select value={f.clientId ?? ''} onChange={set('clientId')}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Tipo<select value={f.kind} onChange={set('kind')}>{Object.keys(KIND_ICON).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>Prioridade<select value={f.priority} onChange={set('priority')}>{['baixa', 'media', 'alta', 'urgente'].map((k) => <option key={k}>{k}</option>)}</select></label>
          <label>Coluna<select value={f.status} onChange={set('status')}>{DEMAND_COLUMNS.map((k) => <option key={k} value={k}>{DEMAND_COLUMN_LABEL[k]}</option>)}</select></label>
          <label>Prazo<input type="date" value={f.dueDate ?? ''} onChange={set('dueDate')} /></label>
          <label>Responsável<select value={f.assignee ?? ''} onChange={set('assignee')}>
            <option value="">—</option>
            <optgroup label="Pessoas">{members.map((m) => <option key={m.id} value={`user:${m.id}`}>{m.name}</option>)}</optgroup>
            <optgroup label="IA">{agents.map((a) => <option key={a.id} value={`agent:${a.id}`}>🤖 {a.name} · {a.role}</option>)}</optgroup>
          </select></label>
        </div>
        <div className="row between">
          {f.id ? <button type="button" className="danger" onClick={async () => { if (confirm('Remover esta demanda?')) { await api(`${base}/${f.id}`, { method: 'DELETE' }); onClose(); } }}>Remover</button> : <span />}
          <div className="row gap"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
        </div>
      </form>
    </div>
  );
}

function Delegate({ d, onClose, onDone }: { d: Demand; onClose: () => void; onDone: (name: string) => void }) {
  const { agents, office } = useStore();
  const suggested = agents.find((a) => a.slug === KIND_AGENT[d.kind]) ?? agents[0];
  const [agentId, setAgentId] = useState(suggested?.id ?? '');
  const [prompt, setPrompt] = useState('Faça esta demanda seguindo as skills da casa. Pare para aprovação nos checkpoints.');
  const [err, setErr] = useState('');
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/offices/${office!.id}/jobs`, { body: { agentId, prompt, demandId: d.id } });
          onDone(agents.find((a) => a.id === agentId)?.name ?? '');
        } catch (x) { setErr((x as Error).message); }
      }}>
        <h3>🤖 Delegar: {d.title}</h3>
        <label>Funcionário<select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role} ({a.status})</option>)}
        </select></label>
        <label>Instruções<textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        <p className="muted small">O briefing da demanda e a pasta do cliente vão junto. O funcionário roda o Claude Code na pasta do escritório e para quando precisar de você.</p>
        {err && <div className="error">{err}</div>}
        <div className="row gap end"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary">Delegar</button></div>
      </form>
    </div>
  );
}
