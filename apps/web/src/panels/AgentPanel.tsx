import { useEffect, useRef, useState } from 'react';
import type { AgentJob } from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

const STATUS_LABEL: Record<AgentJob['status'], string> = {
  fila: '⏳ na fila', rodando: '⌨️ trabalhando', aguardando: '✋ esperando você', concluido: '✅ concluído', erro: '⚠️ erro', cancelado: '⛔ cancelado',
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
  const { agents, jobs, messages, panelArg, office, demands, loadMessages } = useStore();
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

  if (!agent) return <p className="muted">Nenhum funcionário neste escritório.</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setErr('');
    try {
      if (job && (job.status === 'aguardando' || job.status === 'concluido' || job.status === 'erro')) {
        await api(`${base}/jobs/${job.id}/reply`, { body: { text } });
      } else {
        const j = await api<AgentJob>(`${base}/jobs`, { body: { agentId: agent.id, prompt: text, demandId: demandId || null } });
        setJobId(j.id);
        await loadMessages(j.id);
      }
      setText('');
    } catch (x) { setErr((x as Error).message); }
  };

  const busy = job?.status === 'rodando' || job?.status === 'fila';

  return (
    <div className="agent-panel">
      <div className="agent-head">
        <div className="avatar-big" style={{ background: agent.color }}>{agent.name[0]}</div>
        <div>
          <h3>{agent.name} <small className="muted">· {agent.role}</small></h3>
          <div className="chips">
            {agent.skills.map((s) => <span key={s} className="chip">⚡ {s}</span>)}
            {agent.tools.map((s) => <span key={s} className="chip alt">🧰 {s}</span>)}
          </div>
        </div>
      </div>

      <div className="agent-body">
        <aside className="job-list">
          <button className={`job-item ${job === null ? 'active' : ''}`} onClick={() => setJobId(null)}>+ Nova tarefa</button>
          {myJobs.map((j) => (
            <button key={j.id} className={`job-item ${j.id === jobId ? 'active' : ''} ${j.status}`} onClick={() => setJobId(j.id)}>
              <span>{j.prompt.replace(/^## Demanda: /, '').slice(0, 60)}</span>
              <small>{STATUS_LABEL[j.status]}{j.costUsd ? ` · US$ ${j.costUsd.toFixed(2)}` : ''}</small>
            </button>
          ))}
        </aside>

        <div className="job-chat">
          {job ? (
            <div className="messages" ref={list}>
              {msgs.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  {m.role === 'ferramenta' ? <code>🔧 {m.text}</code> : <div className="msg-text" dangerouslySetInnerHTML={{ __html: miniMarkdown(m.text) }} />}
                </div>
              ))}
              {busy && <div className="msg sistema typing">{agent.name} está trabalhando…</div>}
            </div>
          ) : (
            <div className="new-job muted">
              <p>Peça qualquer coisa ao {agent.name}. Ele trabalha com o Claude Code na pasta do escritório, usando as skills da casa, e para quando precisar da sua aprovação.</p>
              <label>Ligar a uma demanda (opcional)
                <select value={demandId} onChange={(e) => setDemandId(e.target.value)}>
                  <option value="">—</option>
                  {demands.filter((d) => d.status !== 'entregue').map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              </label>
            </div>
          )}

          {job?.status === 'aguardando' && (
            <div className="approval">
              <b>✋ {agent.name} precisa da sua decisão.</b>
              <div className="row gap">
                <button className="primary" onClick={() => api(`${base}/jobs/${job.id}/reply`, { body: { text: 'Aprovado. Pode seguir.' } })}>Aprovar e seguir</button>
                <span className="muted small">ou escreva um ajuste abaixo</span>
              </div>
            </div>
          )}

          <form className="composer" onSubmit={submit}>
            <textarea rows={2} value={text} disabled={busy} placeholder={busy ? 'Trabalhando…' : job ? 'Responder / pedir ajuste…' : 'Descreva a tarefa…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); } }} />
            <div className="row gap">
              {busy && job && <button type="button" className="danger" onClick={() => api(`${base}/jobs/${job.id}/cancel`, { body: {} })}>Parar</button>}
              <button className="primary" disabled={busy || !text.trim()}>{job ? 'Enviar' : 'Começar'}</button>
            </div>
          </form>
          {err && <div className="error">{err}</div>}
        </div>
      </div>
    </div>
  );
}
