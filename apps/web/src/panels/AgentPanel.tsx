import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Plus, Square, Wrench } from 'lucide-react';
import type { AgentJob } from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

const STATUS_LABEL: Record<AgentJob['status'], string> = {
  fila: 'na fila', rodando: 'trabalhando', aguardando: 'esperando você', concluido: 'concluído', erro: 'erro', cancelado: 'cancelado',
};

/** Markdown mínimo (negrito, código, títulos, citações), sempre escapando o HTML antes. */
function miniMarkdown(s: string) {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,4} (.+)$/gm, '<b class="h">$1</b>')
    .replace(/^&gt; (.+)$/gm, '<span class="quote">$1</span>');
}

export function AgentPanel() {
  const { agents, jobs, messages, panelArg, office, demands, loadMessages, user } = useStore();
  const agent = agents.find((a) => a.id === panelArg) ?? agents[0];
  const myJobs = jobs.filter((j) => j.agentId === agent?.id);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = myJobs.find((j) => j.id === jobId) ?? null;
  const [text, setText] = useState('');
  const [demandId, setDemandId] = useState('');
  const [err, setErr] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const base = `/api/offices/${office!.id}`;

  useEffect(() => { setJobId(myJobs[0]?.id ?? null); }, [agent?.id]);
  useEffect(() => { if (jobId && !messages[jobId]) loadMessages(jobId); }, [jobId]);
  const msgs = jobId ? messages[jobId] ?? [] : [];
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [msgs.length]);

  if (!agent) return <div className="empty">Nenhum funcionário neste escritório.</div>;

  const busy = job?.status === 'rodando' || job?.status === 'fila';
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setErr('');
    try {
      if (job) await api(`${base}/jobs/${job.id}/reply`, { body: { text } });
      else {
        const j = await api<AgentJob>(`${base}/jobs`, { body: { agentId: agent.id, prompt: text, demandId: demandId || null } });
        setJobId(j.id);
        await loadMessages(j.id);
      }
      setText('');
    } catch (x) { setErr((x as Error).message); }
  };

  return (
    <div className="agent-page">
      <aside className="agent-side">
        <div className="agent-profile">
          <div className="row gap">
            <span className={`avatar st-${agent.status}`} style={{ background: agent.color }}>{agent.name[0]}<span className="status-dot" /></span>
            <div>
              <h3>{agent.name}</h3>
              <div className="muted small">{agent.role}</div>
            </div>
          </div>
          <div className="chips">{agent.skills.map((s) => <span key={s} className="badge">{s}</span>)}</div>
          <div className="chips">{agent.tools.map((s) => <span key={s} className="badge outline">{s}</span>)}</div>
        </div>
        <div className="job-list">
          <button className={`job-item ${job === null ? 'active' : ''}`} onClick={() => setJobId(null)}>
            <span className="row gap"><Plus size={14} /> Nova tarefa</span>
          </button>
          {myJobs.map((j) => (
            <button key={j.id} className={`job-item ${j.id === jobId ? 'active' : ''}`} onClick={() => setJobId(j.id)}>
              <span>{j.prompt.replace(/^## Demanda: /, '').split('\n')[0]}</span>
              <small className={`st-${j.status}`}><span className="status-dot" />{STATUS_LABEL[j.status]}{j.costUsd ? <span className="mono">· US$ {j.costUsd.toFixed(2)}</span> : null}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="job-chat">
        {job ? (
          <div className="messages" ref={list}>
            {msgs.map((m) =>
              m.role === 'ferramenta' ? (
                <div key={m.id} className="msg ferramenta"><Wrench size={12} /><span>{m.text}</span></div>
              ) : m.role === 'usuario' ? (
                <div key={m.id} className="msg usuario"><div className="msg-text">{m.text}</div></div>
              ) : m.role === 'sistema' ? (
                <div key={m.id} className="msg sistema">{m.text}</div>
              ) : (
                <div key={m.id} className="msg">
                  <div className="who"><span className="avatar" style={{ background: agent.color, width: 18, height: 18, fontSize: 10 }}>{agent.name[0]}</span>{agent.name}</div>
                  <div className="msg-text" dangerouslySetInnerHTML={{ __html: miniMarkdown(m.text) }} />
                </div>
              ),
            )}
            {busy && <div className="typing st-trabalhando"><span className="status-dot" />{agent.name} está trabalhando…</div>}
          </div>
        ) : (
          <div className="new-job">
            <h2>Nova tarefa para {agent.name}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {agent.name} trabalha com o Claude Code na pasta do escritório, usa as skills da casa e para quando precisar da sua aprovação.
            </p>
            <label>Ligar a uma demanda <span className="muted">(opcional)</span>
              <select value={demandId} onChange={(e) => setDemandId(e.target.value)}>
                <option value="">—</option>
                {demands.filter((d) => d.status !== 'entregue').map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
          </div>
        )}

        {job?.status === 'aguardando' && (
          <div className="approval">
            <span className="status-dot st-aguardando" />
            <b>{agent.name} precisa da sua decisão.</b>
            <span className="spacer" />
            <button className="primary small" onClick={() => api(`${base}/jobs/${job.id}/reply`, { body: { text: 'Aprovado. Pode seguir.' } })}><Check size={14} /> Aprovar e seguir</button>
          </div>
        )}

        <form className="composer" onSubmit={submit}>
          <textarea rows={2} value={text} disabled={busy}
            placeholder={busy ? 'Trabalhando…' : job ? `Responder a ${agent.name}…` : 'Descreva a tarefa…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <div className="row">
            <span className="muted small">{user?.name} · Enter envia, Shift+Enter quebra linha</span>
            <div className="row gap">
              {busy && job && <button type="button" className="small" onClick={() => api(`${base}/jobs/${job.id}/cancel`, { body: {} })}><Square size={12} /> Parar</button>}
              <button className="primary small" disabled={busy || !text.trim()}><ArrowUp size={14} /> {job ? 'Enviar' : 'Começar'}</button>
            </div>
          </div>
        </form>
        {err && <div className="error" style={{ margin: '0 24px 16px' }}>{err}</div>}
      </section>
    </div>
  );
}
