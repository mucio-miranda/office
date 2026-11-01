import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, MessageSquarePlus, Square, Wrench } from 'lucide-react';
import type { AgentJob, Client, Demand, JobMessage } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { ReviewDesk, versionsOf } from './ReviewDesk';

const ACTIVE: AgentJob['status'][] = ['fila', 'rodando', 'aguardando'];
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const MAX_JOBS = 30;

/**
 * A conversa do cliente: uma só, que continua de um pedido para o outro, como no terminal. A função do funcionário é só
 * um rótulo: todos têm as mesmas skills. O comando `/skill` e a correção no meio do trabalho funcionam aqui.
 */
export function Conversa({ c }: { c: Client }) {
  const { jobs, messages, loadMessages, agents, office, demands, notify } = useStore();
  const base = `/api/offices/${office!.id}`;
  const [text, setText] = useState('');
  const [newRequest, setNewRequest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [openDemand, setOpenDemand] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const mine = useMemo(() => jobs.filter((j) => j.clientId === c.id && j.stage !== 'aprovacao').slice(0, MAX_JOBS), [jobs, c.id]);
  const active = mine.find((j) => ACTIVE.includes(j.status));
  const missing = mine.filter((j) => !messages[j.id]).map((j) => j.id).join(',');
  useEffect(() => { if (missing) missing.split(',').forEach((id) => loadMessages(id)); }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api<{ name: string; description: string }[]>(`${base}/skills`).then(setSkills).catch(() => setSkills([])); }, [base]);

  const msgs = useMemo(() => mine.flatMap((j) => (messages[j.id] ?? []).map((m) => ({ ...m, agentId: j.agentId }))).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [mine, messages]);
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [msgs.length]);

  const cost = mine.reduce((n, j) => n + (j.costUsd ?? 0), 0);
  const running = active?.status === 'rodando' || active?.status === 'fila';
  const worker = agents.find((a) => a.id === active?.agentId);
  const typed = text.match(/^\/([\w-]*)$/)?.[1];
  const matches = typed === undefined ? [] : skills.filter((s) => s.name.includes(typed)).slice(0, 7);
  const pieces = useMemo(() => {
    const latest = demands.filter((d: Demand) => d.clientId === c.id && versionsOf(d).length).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return latest ? { demand: latest, files: versionsOf(latest).at(-1)!.files!.filter((f) => IMG.test(f)).slice(0, 8) } : null;
  }, [demands, c.id]);
  const open = openDemand ? demands.find((d) => d.id === openDemand) : null;

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api(`${base}/clients/${c.id}/conversa`, { body: { text, newRequest } });
      setText('');
      setNewRequest(false);
    } catch (x) { notify((x as Error).message); }
    setBusy(false);
  };
  const reset = async () => {
    try {
      await api(`${base}/clients/${c.id}/conversa/nova`, { body: {} });
      notify('O próximo pedido começa uma conversa nova');
    } catch (x) { notify((x as Error).message); }
    setConfirmReset(false);
  };

  const line = (m: JobMessage & { agentId: string }) => {
    if (m.role === 'ferramenta') return <div key={m.id} className="msg ferramenta"><Wrench size={12} /><span>{m.text}</span></div>;
    if (m.role === 'usuario') return <div key={m.id} className="msg usuario"><div className="msg-text">{m.text}</div></div>;
    if (m.role === 'sistema') return <div key={m.id} className="msg sistema">{m.text}</div>;
    const a = agents.find((x) => x.id === m.agentId);
    return (
      <div key={m.id} className="msg">
        <div className="who"><span className="avatar" style={{ background: a?.color, width: 18, height: 18, fontSize: 10 }}>{a?.name[0]}</span>{a?.name}</div>
        <div className="msg-text md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
      </div>
    );
  };

  return (
    <div className="card conversa">
      <div className="card-head">
        <h4>Conversa {cost > 0 && <span className="muted small mono">· US$ {cost.toFixed(2)}</span>}</h4>
        {confirmReset ? (
          <div className="row gap">
            <span className="muted small">O agente deixa de lembrar esta conversa.</span>
            <button className="ghost small" onClick={() => setConfirmReset(false)}>Manter</button>
            <button className="small" onClick={reset}>Começar nova</button>
          </div>
        ) : (
          <button className="ghost small" disabled={!c.sessionId || !!active} onClick={() => setConfirmReset(true)}><MessageSquarePlus size={13} /> Nova conversa</button>
        )}
      </div>
      <div className="messages" ref={list} aria-live="polite">
        {msgs.length === 0 && <p className="muted small">Peça o que precisar para {c.name}. O agente trabalha na pasta do cliente, com todas as skills, e lembra de um pedido para o outro. Digite / para ver os comandos.</p>}
        {msgs.map(line)}
        {running && <div className="typing st-trabalhando"><span className="status-dot" />{worker?.name ?? 'O funcionário'} {active?.status === 'fila' ? 'está na fila' : 'está trabalhando'}…</div>}
      </div>
      {pieces && pieces.files.length > 0 && (
        <button type="button" className="conversa-pieces" title={`Abrir ${pieces.demand.title} na mesa`} onClick={() => setOpenDemand(pieces.demand.id)}>
          {pieces.files.map((f) => <img key={f} src={mediaUrl(office!.id, f)} alt="" loading="lazy" />)}
        </button>
      )}
      <form className="composer" onSubmit={send}>
        {matches.length > 0 && (
          <div className="slash-menu" role="listbox" aria-label="Comandos">
            {matches.map((s) => (
              <button key={s.name} type="button" role="option" aria-selected={false} onClick={() => setText(`/${s.name} `)}>
                <b>/{s.name}</b><span className="muted small truncate">{s.description}</span>
              </button>
            ))}
          </div>
        )}
        <textarea rows={2} value={text} aria-label={`Mensagem para a conversa de ${c.name}`}
          placeholder={running ? 'Escreva para corrigir agora: o trabalho é interrompido e continua com a sua mensagem' : active ? 'Responda à decisão pedida…' : 'Peça algo, corrija ou digite / para os comandos…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="row gap conversa-actions">
          <button className="primary small" disabled={busy || !text.trim()}><ArrowUp size={14} /> {running && !newRequest ? 'Interromper e enviar' : 'Enviar'}</button>
          {running && active && <button type="button" className="small" onClick={() => api(`${base}/jobs/${active.id}/cancel`, { body: {} })}><Square size={12} /> Parar</button>}
          <label className="check small"><input type="checkbox" checked={newRequest} onChange={(e) => setNewRequest(e.target.checked)} /> Novo pedido, em outro cartão</label>
        </div>
      </form>
      {open && <ReviewDesk d={open} onClose={() => setOpenDemand(null)} />}
    </div>
  );
}
