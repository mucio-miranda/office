import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, History, MessageSquarePlus, Square, Terminal, Wrench } from 'lucide-react';
import { canWork, type AgentJob, type Client, type ClientSession, type Demand, type JobMessage } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { ReviewDesk, versionsOf } from './ReviewDesk';

const ACTIVE: AgentJob['status'][] = ['fila', 'rodando', 'aguardando'];
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const MAX_JOBS = 30;
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
type Line = { role: 'usuario' | 'agente'; text: string; at: string };

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
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  // null = a sessão atual; um id = uma sessão anterior, só para ler até alguém continuar nela
  const [view, setView] = useState<string | null>(null);
  const [tail, setTail] = useState<Line[] | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const clientJobs = useMemo(() => jobs.filter((j) => j.clientId === c.id && j.stage !== 'aprovacao'), [jobs, c.id]);
  const active = clientJobs.find((j) => ACTIVE.includes(j.status));
  const viewed = view ? sessions.find((s) => s.id === view) : undefined;
  const mine = useMemo(() => clientJobs.filter((j) => (view ? j.sessionId === view : !j.sessionId || j.sessionId === c.sessionId)).slice(0, MAX_JOBS), [clientJobs, view, c.sessionId]);
  const sessionCount = clientJobs.length;
  useEffect(() => { api<ClientSession[]>(`${base}/clients/${c.id}/sessoes`).then(setSessions).catch(() => setSessions([])); }, [base, c.id, c.sessionId, sessionCount]);
  useEffect(() => { setView(null); }, [c.id]);
  // sessão do terminal: o Office não tem as mensagens, então lê o fim do arquivo da sessão
  useEffect(() => {
    setTail(null);
    if (view && viewed?.origin === 'terminal') api<Line[]>(`${base}/clients/${c.id}/sessoes/${view}`).then(setTail).catch((x) => notify((x as Error).message));
  }, [view, viewed?.origin]); // eslint-disable-line react-hooks/exhaustive-deps
  const resume = async (id: string) => {
    try {
      await api(`${base}/clients/${c.id}/sessoes/${id}/retomar`, { body: {} });
      setView(null);
      setShowSessions(false);
      notify('A próxima mensagem continua essa sessão');
    } catch (x) { notify((x as Error).message); }
  };
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
  const guest = !canWork(office!.role);

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
    if (m.role === 'usuario') return <div key={m.id} className="msg usuario">{m.author && <div className="who">{m.author}</div>}<div className="msg-text">{m.text}</div></div>;
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
        <button className={`ghost small ${showSessions ? 'active' : ''}`} onClick={() => setShowSessions((v) => !v)} title="Sessões deste cliente, do Office e do terminal">
          <History size={13} /> Sessões{sessions.length ? ` (${sessions.length})` : ''}</button>
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
      {showSessions && (
        <div className="session-list" role="list" aria-label={`Sessões de ${c.name}`}>
          <button type="button" role="listitem" className={`session-item ${view === null ? 'on' : ''}`} onClick={() => { setView(null); setShowSessions(false); }}>
            <b>Sessão atual</b><span className="muted small">{c.sessionId ? 'o agente lembra desta conversa' : 'o próximo pedido começa uma sessão nova'}</span>
          </button>
          {sessions.filter((s) => !s.current).map((s) => (
            <button type="button" role="listitem" key={s.id} className={`session-item ${view === s.id ? 'on' : ''}`} onClick={() => { setView(s.id); setShowSessions(false); }}>
              <span className="row gap">{s.origin === 'terminal' ? <Terminal size={12} /> : <History size={12} />}<b className="truncate">{s.title}</b></span>
              <span className="muted small">{s.origin === 'terminal' ? 'terminal' : 'Office'} · {when(s.startedAt)} até {when(s.updatedAt)}{s.costUsd > 0 ? ` · US$ ${s.costUsd.toFixed(2)}` : ''}{s.people.length ? ` · ${s.people.join(', ')}` : ''}</span>
            </button>
          ))}
          {sessions.length === 0 && <p className="muted small">Nenhuma sessão ainda nesta pasta.</p>}
        </div>
      )}
      {view && (
        <div className="session-banner">
          <span className="small">{viewed?.origin === 'terminal' ? 'Sessão do terminal' : 'Sessão anterior'}{viewed ? ` de ${when(viewed.startedAt)}` : ''}. Só leitura.</span>
          {!guest && <button className="small" disabled={!!active} title={active ? 'Espere o trabalho atual terminar' : viewed?.origin === 'terminal' ? 'Feche essa sessão no terminal antes, para não escreverem nela ao mesmo tempo' : ''} onClick={() => resume(view)}>Continuar nesta sessão</button>}
          <button className="ghost small" onClick={() => setView(null)}>Voltar para a atual</button>
        </div>
      )}
      <div className="messages" ref={list} aria-live="polite">
        {tail && tail.map((l, i) => l.role === 'usuario'
          ? <div key={i} className="msg usuario"><div className="msg-text">{l.text}</div></div>
          : <div key={i} className="msg"><div className="msg-text md" dangerouslySetInnerHTML={{ __html: renderMarkdown(l.text) }} /></div>)}
        {view && viewed?.origin === 'terminal' && !tail && <p className="muted small">Lendo o fim da sessão…</p>}
        {!view && msgs.length === 0 && <p className="muted small">Peça o que precisar para {c.name}. O agente trabalha na pasta do cliente, com todas as skills, e lembra de um pedido para o outro. Digite / para ver os comandos.</p>}
        {msgs.map(line)}
        {running && <div className="typing st-trabalhando"><span className="status-dot" />{worker?.name ?? 'O funcionário'} {active?.status === 'fila' ? 'está na fila' : 'está trabalhando'}…</div>}
      </div>
      {pieces && pieces.files.length > 0 && (
        <button type="button" className="conversa-pieces" title={`Abrir ${pieces.demand.title} na mesa`} onClick={() => setOpenDemand(pieces.demand.id)}>
          {pieces.files.map((f) => <img key={f} src={mediaUrl(office!.id, f)} alt="" loading="lazy" />)}
        </button>
      )}
      {view ? null : guest ? <p className="muted small" style={{ margin: '8px 16px' }}>Você entrou como convidado: acompanha a conversa, mas quem pede trabalho é um membro do escritório.</p> : <form className="composer" onSubmit={send}>
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
      </form>}
      {open && <ReviewDesk d={open} onClose={() => setOpenDemand(null)} />}
    </div>
  );
}
