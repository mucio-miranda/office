import { useEffect, useState } from 'react';
import { Bot, Check, Pause, Play, Plus, RotateCcw, Workflow, X } from 'lucide-react';
import { DEMAND_COLUMNS, DEMAND_COLUMN_LABEL, STAGE_AGENT, STAGE_LABEL, type Demand, type DemandKind, type DemandStatus, type Priority, type Stage } from '@office/shared';
import { useStore } from '../lib/store';
import { api, fmtDuration } from '../lib/api';

const KIND_LABEL: Record<DemandKind, string> = { video: 'Vídeo', design: 'Design', copy: 'Copy', estrategia: 'Estratégia', foto: 'Foto', outro: 'Outro' };
const PRIO_LEVEL: Record<Priority, string> = { baixa: 'on1', media: 'on2', alta: 'on3', urgente: 'on3 urgent' };
/** Que funcionário de IA é o natural para cada tipo de demanda. */
const KIND_AGENT: Record<DemandKind, string> = { video: 'editor-de-video', design: 'designer', foto: 'designer', copy: 'copywriter', estrategia: 'copywriter', outro: 'gerente' };

/** Situação de cada etapa da esteira: feita, atual, com erro ou por fazer. */
function stageState(d: Demand, s: Stage): 'feita' | 'atual' | 'erro' | 'falta' {
  const log = (d.stageLog ?? []).filter((e) => e.stage === s);
  const last = log.at(-1);
  if (d.stage === s) {
    if (last?.result === 'erro') return 'erro';
    if (s === 'agendado' || (d.status === 'entregue' && last)) return 'feita';
    return 'atual';
  }
  const i = d.pipeline.indexOf(s), cur = d.stage ? d.pipeline.indexOf(d.stage) : -1;
  return i < cur || (last && last.result !== 'erro') ? 'feita' : 'falta';
}

/** Trilha das etapas (pauta → copy → arte → aprovação → pronto). */
export function StageTrack({ d, compact = false }: { d: Demand; compact?: boolean }) {
  if (!d.pipeline?.length) return null;
  return (
    <span className={`stage-track ${compact ? 'compact' : ''}`}>
      {d.pipeline.map((s) => (
        <span key={s} className={`stage ${stageState(d, s)}`} title={STAGE_LABEL[s]}>{compact ? '' : STAGE_LABEL[s]}</span>
      ))}
    </span>
  );
}

const Prio = ({ p }: { p: Priority }) => <span className={`prio ${PRIO_LEVEL[p]}`} title={`Prioridade ${p}`}><i /><i /><i /></span>;

export function Demands() {
  const { demands, clients, agents, members, office, panelArg, notify } = useStore();
  const [editing, setEditing] = useState<Partial<Demand> | null>(null);
  const [delegating, setDelegating] = useState<Demand | null>(null);
  const [filter, setFilter] = useState('');
  const [over, setOver] = useState<DemandStatus | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    // 'nova' abre o formulário de demanda em branco (fim do tour)
    if (panelArg === 'nova') setEditing({ status: 'a_fazer', kind: 'video', priority: 'media' });
    else if (panelArg) setEditing(demands.find((d) => d.id === panelArg) ?? null);
  }, [panelArg]);

  const base = `/api/offices/${office!.id}/demands`;
  const move = (id: string, status: DemandStatus) => api(`${base}/${id}`, { method: 'PATCH', body: { status } });
  const assignee = (a: string | null) => {
    if (!a) return null;
    const [kind, id] = a.split(':');
    if (kind === 'agent') { const ag = agents.find((x) => x.id === id); return ag ? { name: ag.name, color: ag.color, ai: true } : null; }
    const m = members.find((x) => x.id === id);
    return m ? { name: m.name, color: m.color, ai: false } : null;
  };
  const elapsed = (d: Demand) => d.trackedSeconds + (d.timerStartedAt ? Math.round((Date.now() - Date.parse(d.timerStartedAt)) / 1000) : 0);
  const today = new Date().toISOString().slice(0, 10);
  const visible = demands.filter((d) => !filter || d.clientId === filter);

  return (
    <>
      <div className="toolbar">
        <button className="primary" onClick={() => setEditing({ status: 'a_fazer', kind: 'video', priority: 'media' })}><Plus size={14} /> Nova demanda</button>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="muted small">Arraste entre colunas. Play conta o tempo. O robô delega para a IA.</span>
      </div>
      <div className="kanban">
        {DEMAND_COLUMNS.map((col) => {
          const cards = visible.filter((d) => d.status === col);
          return (
            <div key={col} className={`kcol ${over === col ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { setOver(null); move(e.dataTransfer.getData('id'), col); }}>
              <div className={`kcol-head st-${col}`}><span className="status-dot" /><span>{DEMAND_COLUMN_LABEL[col]}</span><span>{cards.length}</span></div>
              {cards.map((d) => {
                const client = clients.find((c) => c.id === d.clientId);
                const who = assignee(d.assignee);
                const late = d.dueDate && d.dueDate < today && d.status !== 'entregue';
                return (
                  <article key={d.id} className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData('id', d.id)} onClick={() => setEditing(d)}>
                    <div className="kcard-title">{d.title}</div>
                    {d.stage && <div className="kcard-stage"><StageTrack d={d} compact /><span>{d.auto && d.status !== 'entregue' ? <Workflow size={11} /> : null} {STAGE_LABEL[d.stage]}</span></div>}
                    <div className="kcard-meta">
                      <Prio p={d.priority} />
                      <span className="badge">{KIND_LABEL[d.kind]}</span>
                      {client && <span className="badge outline"><span className="dot" style={{ background: client.color }} />{client.name}</span>}
                      {d.dueDate && <span className={`badge outline due ${late ? 'late' : ''}`}>{d.dueDate.slice(8, 10)}/{d.dueDate.slice(5, 7)}</span>}
                    </div>
                    <div className="kcard-foot" onClick={(e) => e.stopPropagation()}>
                      <span className="who truncate">
                        {who ? <><span className="avatar" style={{ background: who.color, width: 18, height: 18, fontSize: 10 }}>{who.ai ? <Bot size={11} /> : who.name[0]}</span>{who.name}</> : 'sem responsável'}
                      </span>
                      <button className={`timer ${d.timerStartedAt ? 'on' : ''}`} onClick={() => api(`${base}/${d.id}/timer`, { body: {} })} title="Cronômetro">
                        {d.timerStartedAt ? <Pause size={11} /> : <Play size={11} />} {fmtDuration(elapsed(d))}
                      </button>
                      <button className="icon" title="Delegar para IA" onClick={() => setDelegating(d)}><Bot size={15} /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
      {editing && <DemandForm d={editing} onClose={() => setEditing(null)} />}
      {delegating && <Delegate d={delegating} onClose={() => setDelegating(null)} onDone={(name) => { setDelegating(null); notify(`${name} começou a trabalhar`); }} />}
    </>
  );
}

/** Esteira da demanda: etapas, o que cada funcionário fez e as ações (ligar, pausar, aprovar, pedir ajustes). */
function Pipeline({ d }: { d: Demand }) {
  const { office, agents, members, jobs, notify, open } = useStore();
  const [changes, setChanges] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/offices/${office!.id}/demands/${d.id}`;
  const act = async (name: string, body: object = {}) => {
    setBusy(true);
    try { await api(`${base}/${name}`, { body }); } catch (e) { notify((e as Error).message); }
    setBusy(false);
  };
  const who = (by: string) => {
    const [k, id] = by.split(':');
    return k === 'agent' ? agents.find((a) => a.id === id)?.name : k === 'user' ? members.find((m) => m.id === id)?.name : 'Office';
  };
  const active = jobs.find((j) => j.demandId === d.id && ['fila', 'rodando', 'aguardando'].includes(j.status));
  const waitingHuman = d.stage === 'aprovacao' && d.status === 'aprovacao' && !active;
  const finished = d.status === 'entregue' && (d.stage === 'agendado' || d.pipeline?.[0] === 'briefing');
  const next = (d.stage ? d.pipeline[d.pipeline.indexOf(d.stage)] : d.pipeline?.[0]) as Stage | undefined;
  const nextAgent = next && STAGE_AGENT[next] ? agents.find((a) => a.slug === STAGE_AGENT[next]) : undefined;
  if (!d.pipeline?.length) return null;
  return (
    <div className="pipeline">
      <div className="row between">
        <b className="row gap"><Workflow size={14} /> Esteira</b>
        <div className="row gap">
          {active && <button type="button" className="ghost small" onClick={() => open('agente', active.agentId)}><Bot size={13} /> {agents.find((a) => a.id === active.agentId)?.name} {active.status === 'aguardando' ? 'precisa de você' : 'trabalhando'}</button>}
          {!finished && !active && !waitingHuman && (
            <button type="button" className="primary small" disabled={busy} onClick={() => act('esteira')} title={nextAgent ? `${nextAgent.name} começa a etapa ${STAGE_LABEL[next!]}` : undefined}>
              <Play size={13} /> {d.stage ? 'Continuar esteira' : 'Ligar esteira'}
            </button>
          )}
          {d.auto && !finished && <button type="button" className="ghost small" disabled={busy} onClick={() => act('pausar')} title="Termina a etapa atual e não começa a próxima"><Pause size={13} /> Pausar</button>}
        </div>
      </div>
      <StageTrack d={d} />
      {waitingHuman && (
        <div className="approval">
          <span>Esperando a sua aprovação.</span>
          {changes === null ? (
            <div className="row gap">
              <button type="button" className="ghost small" onClick={() => setChanges('')}><RotateCcw size={13} /> Pedir ajustes</button>
              <button type="button" className="primary small" disabled={busy} onClick={() => act('aprovar')}><Check size={13} /> Aprovar</button>
            </div>
          ) : (
            <div className="col gap-s">
              <textarea autoFocus rows={3} placeholder="O que precisa mudar?" value={changes} onChange={(e) => setChanges(e.target.value)} />
              <div className="row gap end">
                <button type="button" className="ghost small" onClick={() => setChanges(null)}>Cancelar</button>
                <button type="button" className="primary small" disabled={busy || changes.trim().length < 3} onClick={async () => { await act('ajustes', { text: changes }); setChanges(null); }}>Mandar ajustes</button>
              </div>
            </div>
          )}
        </div>
      )}
      {(d.stageLog ?? []).length > 0 && (
        <ol className="stage-log">
          {[...d.stageLog].reverse().map((e, i) => (
            <li key={i} className={`r-${e.result}`}>
              <div className="row between"><b>{STAGE_LABEL[e.stage]} · {who(e.by) ?? '—'}</b><span className="muted small">{new Date(e.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
              <p>{e.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DemandForm({ d, onClose }: { d: Partial<Demand>; onClose: () => void }) {
  const { clients, members, agents, office, demands } = useStore();
  const [f, setF] = useState<Partial<Demand>>(d);
  const set = (k: keyof Demand) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value || null });
  const base = `/api/offices/${office!.id}/demands`;
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        const body = { title: f.title, description: f.description ?? '', clientId: f.clientId ?? null, kind: f.kind, status: f.status, priority: f.priority, assignee: f.assignee ?? null, dueDate: f.dueDate ?? null };
        if (f.id) await api(`${base}/${f.id}`, { method: 'PATCH', body }); else await api(base, { body });
        onClose();
      }}>
        <header className="modal-head"><h3>{f.id ? 'Editar demanda' : 'Nova demanda'}</h3><button type="button" className="icon" onClick={onClose}><X size={16} /></button></header>
        <div className="modal-body">
          {f.id && <Pipeline d={demands.find((x) => x.id === f.id) ?? (f as Demand)} />}
          <label>Título<input autoFocus required value={f.title ?? ''} onChange={set('title')} /></label>
          <label>Briefing<textarea rows={4} value={f.description ?? ''} onChange={set('description')} /></label>
          <div className="grid3">
            <label>Cliente<select value={f.clientId ?? ''} onChange={set('clientId')}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Tipo<select value={f.kind} onChange={set('kind')}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Prioridade<select value={f.priority} onChange={set('priority')}>{['baixa', 'media', 'alta', 'urgente'].map((k) => <option key={k}>{k}</option>)}</select></label>
            <label>Coluna<select value={f.status} onChange={set('status')}>{DEMAND_COLUMNS.map((k) => <option key={k} value={k}>{DEMAND_COLUMN_LABEL[k]}</option>)}</select></label>
            <label>Prazo<input type="date" value={f.dueDate ?? ''} onChange={set('dueDate')} /></label>
            <label>Responsável<select value={f.assignee ?? ''} onChange={set('assignee')}>
              <option value="">—</option>
              <optgroup label="Pessoas">{members.map((m) => <option key={m.id} value={`user:${m.id}`}>{m.name}</option>)}</optgroup>
              <optgroup label="Funcionários de IA">{agents.map((a) => <option key={a.id} value={`agent:${a.id}`}>{a.name} · {a.role}</option>)}</optgroup>
            </select></label>
          </div>
        </div>
        <footer className="modal-foot">
          {f.id ? <button type="button" className="ghost danger" onClick={async () => { if (confirm('Remover esta demanda?')) { await api(`${base}/${f.id}`, { method: 'DELETE' }); onClose(); } }}>Remover</button> : <span />}
          <div className="row gap"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary">Salvar</button></div>
        </footer>
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
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/offices/${office!.id}/jobs`, { body: { agentId, prompt, demandId: d.id } });
          onDone(agents.find((a) => a.id === agentId)?.name ?? '');
        } catch (x) { setErr((x as Error).message); }
      }}>
        <header className="modal-head"><h3>Delegar para IA</h3><button type="button" className="icon" onClick={onClose}><X size={16} /></button></header>
        <div className="modal-body">
          <p className="muted" style={{ margin: 0 }}>{d.title}</p>
          <label>Funcionário<select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role} ({a.status})</option>)}
          </select></label>
          <label>Instruções<textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
          <p className="muted small" style={{ margin: 0 }}>O briefing e a pasta do cliente vão junto. O funcionário roda o Claude Code na pasta do escritório e para quando precisar de você.</p>
          {err && <div className="error">{err}</div>}
        </div>
        <footer className="modal-foot"><span /><div className="row gap"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary"><Bot size={14} /> Delegar</button></div></footer>
      </form>
    </div>
  );
}
