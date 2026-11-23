import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { HelperRequests } from './HelperRequests';
import { ArrowUp, Check, ChevronDown, History, Reply, Sparkles, Square, Wrench } from 'lucide-react';
import { desktop } from '../lib/desktop';
import { LimitBadge } from './LimitBadge';
import { MODEL_CHOICES, canWork, type AgentJob, type Client, type ClientSession, type Demand, type JobMessage } from '@office/shared';
import { useStore } from '../lib/store';
import { useDraft } from '../lib/draft';
import { api, mediaUrl } from '../lib/api';
import { renderMarkdown } from '../lib/markdown';
import { useAttach, withPaths } from '../lib/attach';
import { ReviewDesk, versionsOf } from './ReviewDesk';

const ACTIVE: AgentJob['status'][] = ['fila', 'rodando', 'aguardando'];
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const MAX_JOBS = 30;
export const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
type Line = { role: 'usuario' | 'agente'; text: string; at: string };
type Msg = JobMessage & { agentId: string };

/** Passos técnicos do funcionário, contados por tipo e ditos em português ("leu 3 arquivos · rodou 2 comandos"). */
const STEP_KINDS: { re: RegExp; one: string; many: (n: number) => string }[] = [
  { re: /^(Read|NotebookRead)\b/, one: 'leu 1 arquivo', many: (n) => `leu ${n} arquivos` },
  { re: /^(Glob|Grep|LS)\b/, one: 'procurou 1 vez', many: (n) => `procurou ${n} vezes` },
  { re: /^(Bash|PowerShell)\b/, one: 'rodou 1 comando', many: (n) => `rodou ${n} comandos` },
  { re: /^(Write|Edit|MultiEdit|NotebookEdit)\b/, one: 'mexeu em 1 arquivo', many: (n) => `mexeu em ${n} arquivos` },
  { re: /^(WebSearch|WebFetch)\b/, one: 'pesquisou na web', many: (n) => `pesquisou na web ${n} vezes` },
  { re: /^(Task|Agent)\b/, one: 'chamou um ajudante', many: (n) => `chamou ${n} ajudantes` },
  { re: /^mcp__/, one: 'usou 1 ferramenta externa', many: (n) => `usou ${n} ferramentas externas` },
];
export function summarizeSteps(texts: string[]) {
  const counts = new Map<number, number>();
  const skills: string[] = [];
  let other = 0;
  for (const t of texts) {
    const skill = /^Skill\b[:\s]*([\w:-]+)/.exec(t);
    if (skill) { if (!skills.includes(skill[1])) skills.push(skill[1]); continue; }
    const i = STEP_KINDS.findIndex((k) => k.re.test(t));
    if (i < 0) other++;
    else counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const parts = [...skills.map((s) => `usou a skill ${s}`), ...[...counts].sort((a, b) => a[0] - b[0]).map(([i, n]) => (n === 1 ? STEP_KINDS[i].one : STEP_KINDS[i].many(n)))];
  if (other) parts.push(other === 1 ? 'fez mais 1 passo' : `fez mais ${other} passos`);
  return parts.join(' · ');
}

/** Resposta que é só JSON (em bloco de código ou não): devolve o objeto, para não mostrar dado cru na conversa. */
export function asJson(text: string): Record<string, unknown> | null {
  const t = text.trim().replace(/^```[\w-]*\s*/, '').replace(/\s*```$/, '').trim();
  if (!t.startsWith('{')) return null;
  try {
    const v = JSON.parse(t);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* cortado ou com texto junto: decide pelas chaves */ }
  const keys = [...t.matchAll(/"([\w-]{2,40})"\s*:/g)].map((m) => m[1]);
  return keys.length >= 2 ? Object.fromEntries(keys.map((k) => [k, true])) : null;
}
const BRIEFING_KEYS = ['segmento', 'publico', 'objetivos', 'tomDeVoz', 'diferenciais'];

/** Atalhos das tarefas de todo dia: preenchem o pedido para a pessoa completar e enviar. */
const SHORTCUTS: { label: string; text: string }[] = [
  { label: 'Conteúdo do mês', text: '/start-conteudo ' },
  { label: 'Artes do calendário', text: '/arte-referencia ' },
  { label: 'Editar vídeo', text: '/editar-video ' },
  { label: 'Organizar pasta', text: '/organizar-pasta ' },
];

interface Props {
  c: Client;
  view: string | null;
  setView: (id: string | null) => void;
  sessions: ClientSession[];
  resume: (id: string) => void;
  onSessions: () => void;
  onInterview: () => void;
  onBriefing: () => void;
}

/**
 * A conversa do cliente: uma só, que continua de um pedido para o outro, como no terminal. A função do funcionário é só
 * um rótulo: todos têm as mesmas skills. O comando `/skill` e a correção no meio do trabalho funcionam aqui.
 * Os passos técnicos ficam agrupados numa linha que abre, e resposta em JSON vira um aviso em vez de dado cru.
 */
export function Conversa({ c, view, setView, sessions, resume, onSessions, onInterview, onBriefing }: Props) {
  const { jobs, messages, loadMessages, agents, office, demands, notify } = useStore();
  const base = `/api/offices/${office!.id}`;
  const [text, setText] = useDraft(`conversa:${c.id}`);
  const [newRequest, setNewRequest] = useState(false);
  const [sendMenu, setSendMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [openDemand, setOpenDemand] = useState<string | null>(null);
  const [tail, setTail] = useState<Line[] | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // trecho selecionado numa mensagem: o botão "Responder" aparece em cima dele (como no Claude)
  const [quote, setQuote] = useState<{ text: string; x: number; y: number } | null>(null);
  const attach = useAttach(office!.id, (paths) => { setText((t) => withPaths(t, paths)); input.current?.focus(); }, notify);

  // a conversa é a do titular: o trabalho dos ajudantes (sessão própria) não entra aqui; o resumo deles chega como aviso
  const helperIds = useStore((s) => s.workers).filter((w) => w.role === 'ajudante').map((w) => w.id).join(',');
  const clientJobs = useMemo(() => jobs.filter((j) => j.clientId === c.id && j.stage !== 'aprovacao' && !(j.workerId && helperIds.includes(j.workerId))), [jobs, c.id, helperIds]);
  const active = clientJobs.find((j) => ACTIVE.includes(j.status));
  const viewed = view ? sessions.find((s) => s.id === view) : undefined;
  const mine = useMemo(() => clientJobs.filter((j) => (view ? j.sessionId === view : !j.sessionId || j.sessionId === c.sessionId)).slice(0, MAX_JOBS), [clientJobs, view, c.sessionId]);
  // sessão do terminal: o Office não tem as mensagens, então lê o fim do arquivo da sessão
  useEffect(() => {
    setTail(null);
    if (view && viewed?.origin === 'terminal') api<Line[]>(`${base}/clients/${c.id}/sessoes/${view}`).then(setTail).catch((x) => notify((x as Error).message));
  }, [view, viewed?.origin]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = mine.filter((j) => !messages[j.id]).map((j) => j.id).join(',');
  useEffect(() => { if (missing) missing.split(',').forEach((id) => loadMessages(id)); }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api<{ name: string; description: string }[]>(`${base}/skills`).then(setSkills).catch(() => setSkills([])); }, [base]);

  const msgs = useMemo(() => mine.flatMap((j) => (messages[j.id] ?? []).map((m) => ({ ...m, agentId: j.agentId }))).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [mine, messages]);
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [msgs.length]);
  // passos seguidos viram um bloco só
  const blocks = useMemo(() => {
    const out: (Msg | { steps: Msg[] })[] = [];
    for (const m of msgs) {
      const last = out.at(-1);
      if (m.role === 'ferramenta') {
        if (last && 'steps' in last) last.steps.push(m);
        else out.push({ steps: [m] });
      } else out.push(m);
    }
    return out;
  }, [msgs]);

  const running = active?.status === 'rodando' || active?.status === 'fila';
  const workers = useStore((s) => s.workers);
  const worker = workers.find((w) => w.id === active?.workerId) ?? agents.find((a) => a.id === active?.agentId);
  const typed = text.match(/^\/([\w-]*)$/)?.[1];
  const matches = typed === undefined ? [] : skills.filter((s) => s.name.includes(typed)).slice(0, 7);
  const pieces = useMemo(() => {
    const latest = demands.filter((d: Demand) => d.clientId === c.id && versionsOf(d).length).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return latest ? { demand: latest, files: versionsOf(latest).at(-1)!.files!.filter((f) => IMG.test(f)).slice(0, 8) } : null;
  }, [demands, c.id]);
  const open = openDemand ? demands.find((d) => d.id === openDemand) : null;
  const guest = !canWork(office!.role);
  const current = sessions.find((s) => s.current);

  // com o funcionário trabalhando, a mensagem espera ele terminar esta parte; `interrupt` para o trabalho agora
  const send = async (e?: React.FormEvent, interrupt = false) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setSendMenu(false);
    try {
      await api(`${base}/clients/${c.id}/conversa`, { body: { text, newRequest, interrupt: interrupt && !newRequest } });
      setText('');
      setNewRequest(false);
    } catch (x) { notify((x as Error).message); }
    setBusy(false);
  };
  // caminho citado (código com data-path): no app de Windows abre direto (Ctrl+clique mostra na pasta);
  // no navegador, imagem/vídeo/PDF abre numa aba e o resto copia o caminho completo
  const openCited = async (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('code[data-path]') as HTMLElement | null;
    if (!el || window.getSelection()?.toString()) return;
    try {
      const r = await api<{ abs: string; dir: boolean }>(`${base}/clients/${c.id}/caminho?path=${encodeURIComponent(el.dataset.path!)}`);
      if (desktop) {
        if (e.ctrlKey || e.metaKey) await desktop.showInFolder(r.abs);
        else { const err = await desktop.openPath(r.abs); if (err) notify(err); }
      } else if (!r.dir && /\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm|pdf|mp3|wav|m4a|txt|md|srt)$/i.test(r.abs)) {
        window.open(mediaUrl(office!.id, r.abs), '_blank', 'noreferrer');
      } else {
        await navigator.clipboard?.writeText(r.abs).catch(() => {});
        notify(`Caminho copiado: ${r.abs}`);
      }
    } catch (x) { notify((x as Error).message); }
  };
  const pickQuote = () => {
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!sel || !text || sel.rangeCount === 0 || !list.current?.contains(sel.anchorNode)) { setQuote(null); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setQuote({ text, x: rect.left + rect.width / 2, y: rect.top });
    });
  };
  const replyTo = () => {
    if (!quote) return;
    const quoted = quote.text.split(/\r?\n/).map((l) => `> ${l}`).join('\n');
    setText((t) => `${quoted}\n\n${t.replace(/^\s+/, '')}`);
    setQuote(null);
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };
  const shortcut = (t: string) => { setText(t); requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(t.length, t.length); }); };

  const agentLine = (m: Msg) => {
    const a = agents.find((x) => x.id === m.agentId);
    const who = <div className="who"><span className="avatar" style={{ background: a?.color, width: 18, height: 18, fontSize: 10 }}>{a?.name[0]}</span>{a?.name}</div>;
    const json = asJson(m.text);
    if (json) {
      const briefing = BRIEFING_KEYS.some((k) => k in json);
      return (
        <div key={m.id} className="msg">
          {who}
          {briefing
            ? <div className="msg-note">Briefing preenchido. <button type="button" className="link" onClick={onBriefing}>Ver o briefing</button></div>
            : <details className="msg-data"><summary>Dados técnicos ({Object.keys(json).length} campos)</summary><pre>{m.text}</pre></details>}
        </div>
      );
    }
    return <div key={m.id} className="msg">{who}<div className="msg-text md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} /></div>;
  };
  const block = (b: Msg | { steps: Msg[] }, i: number) => {
    if ('steps' in b) {
      const a = agents.find((x) => x.id === b.steps[0].agentId);
      return (
        <details key={`s${i}-${b.steps[0].id}`} className="msg passos">
          <summary><Wrench size={12} /> {a?.name ?? 'O funcionário'} {summarizeSteps(b.steps.map((s) => s.text))}</summary>
          <div className="passos-list">{b.steps.map((s) => <div key={s.id}>{s.text}</div>)}</div>
        </details>
      );
    }
    if (b.role === 'usuario') {
      // o trecho respondido (linhas com "> " no começo) aparece como citação em cima do texto
      const lines = b.text.split('\n');
      const n = lines.findIndex((l) => !l.startsWith('>'));
      const q = n > 0 ? lines.slice(0, n).map((l) => l.replace(/^> ?/, '')).join('\n') : '';
      const body = n > 0 ? lines.slice(n).join('\n').trim() : b.text;
      return (
        <div key={b.id} className="msg usuario">
          {b.author && <div className="who">{b.author}</div>}
          <div className="msg-text">{q && <div className="msg-quote">{q}</div>}{body}</div>
        </div>
      );
    }
    if (b.role === 'sistema') return <div key={b.id} className="msg sistema">{b.text}</div>;
    return agentLine(b);
  };

  return (
    <div className="conversa">
      <div className="conversa-bar">
        <button type="button" className="ghost small" onClick={onSessions} title="Ver as sessões anteriores, do Office e do terminal">
          <History size={13} /> {view ? 'Sessão anterior (só leitura)' : c.sessionId ? `Sessão atual${current ? ` · desde ${when(current.startedAt)}` : msgs[0] ? ` · desde ${when(msgs[0].createdAt)}` : ''}` : 'Sessão nova'}
          {sessions.length > 1 && <span className="muted"> · {sessions.length} sessões</span>}
        </button>
        <span className="spacer" />
        {!!active?.contextTokens && (
          <span className={`muted small mono ${active.contextTokens > 60_000 ? 'ctx-high' : ''}`}
            title="Tamanho da conversa: o funcionário relê isso a cada passo. Acima de 60 mil, o próximo pedido começa uma conversa nova com a memória do cliente.">
            contexto {Math.round(active.contextTokens / 1000)} mil
          </span>
        )}
        <LimitBadge />
      </div>
      {view && (
        <div className="session-banner">
          <span className="small">{viewed?.origin === 'terminal' ? 'Sessão do terminal' : 'Sessão anterior'}{viewed ? ` de ${when(viewed.startedAt)}` : ''}. Só leitura.</span>
          {!guest && <button className="small" disabled={!!active} title={active ? 'Espere o trabalho atual terminar' : viewed?.origin === 'terminal' ? 'Feche essa sessão no terminal antes, para não escreverem nela ao mesmo tempo' : ''} onClick={() => resume(view)}>Continuar nesta sessão</button>}
          <button className="ghost small" onClick={() => setView(null)}>Voltar para a atual</button>
        </div>
      )}
      <HelperRequests clientId={c.id} />
      <div className="messages" ref={list} aria-live="polite" onClick={openCited} onMouseUp={pickQuote} onScroll={() => quote && setQuote(null)}>
        {tail && tail.map((l, i) => l.role === 'usuario'
          ? <div key={i} className="msg usuario"><div className="msg-text">{l.text}</div></div>
          : <div key={i} className="msg"><div className="msg-text md" dangerouslySetInnerHTML={{ __html: renderMarkdown(l.text) }} /></div>)}
        {view && viewed?.origin === 'terminal' && !tail && <p className="muted small">Lendo o fim da sessão…</p>}
        {!view && msgs.length === 0 && (
          <div className="conversa-empty">
            <p>Peça o que precisar para <b>{c.name}</b>. O funcionário trabalha na pasta do cliente, com todas as skills, e lembra de um pedido para o outro.</p>
          </div>
        )}
        {blocks.map((b, i) => <Fragment key={i}>{block(b, i)}</Fragment>)}
        {running && <div className="typing st-trabalhando"><span className="status-dot" />{worker?.name ?? 'O funcionário'} {active?.status === 'fila' ? 'está na fila' : 'está trabalhando'}…</div>}
      </div>
      {quote && !view && !guest && (
        <button type="button" className="quote-reply" style={{ left: quote.x, top: quote.y }} onMouseDown={(e) => e.preventDefault()} onClick={replyTo}>
          Responder <Reply size={14} />
        </button>
      )}
      {pieces && pieces.files.length > 0 && (
        <button type="button" className="conversa-pieces" title={`Abrir ${pieces.demand.title} na mesa`} onClick={() => setOpenDemand(pieces.demand.id)}>
          {pieces.files.map((f) => <img key={f} src={mediaUrl(office!.id, f)} alt="" loading="lazy" />)}
        </button>
      )}
      {view ? null : guest ? <p className="muted small" style={{ margin: '8px 16px' }}>Você entrou como convidado: acompanha a conversa, mas quem pede trabalho é um membro do escritório.</p> : (
        <>
          {!running && !text && (
            <div className="shortcuts" aria-label="Atalhos">
              <button type="button" className="chip" onClick={onInterview}>{c.briefing?.feitoEm ? 'Refazer briefing' : 'Fazer briefing'}</button>
              {SHORTCUTS.map((s) => <button key={s.label} type="button" className="chip" onClick={() => shortcut(s.text)}>{s.label}</button>)}
            </div>
          )}
          <form className={`composer ${attach.dragging ? 'drop-on' : ''}`} onSubmit={send} {...attach.bind}>
            {matches.length > 0 && (
              <div className="slash-menu" role="listbox" aria-label="Comandos">
                {matches.map((s) => (
                  <button key={s.name} type="button" role="option" aria-selected={false} onClick={() => setText(`/${s.name} `)}>
                    <b>/{s.name}</b><span className="muted small truncate">{s.description}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea ref={input} rows={2} value={text} aria-label={`Mensagem para a conversa de ${c.name}`}
              placeholder={running ? 'Pode mandar: as mensagens se juntam e entram quando ele terminar esta parte' : active ? 'Responda à decisão pedida…' : `O que fazer para ${c.name}?`}
              onChange={(e) => setText(e.target.value)} onPaste={attach.onPaste}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <div className="row gap conversa-actions">
              <span className="muted small">{attach.sending ? `Anexando ${attach.sending} arquivo${attach.sending > 1 ? 's' : ''}…` : newRequest ? 'Vai como pedido novo, em outro cartão' : running ? 'Enter envia: ele lê no próximo passo, sem parar o que está fazendo' : 'Enter envia · / mostra os comandos · arraste ou cole arquivos'}</span>
              <span className="spacer" />
              <ModelPicker c={c} />
              {running && active && <button type="button" className="small" onClick={() => api(`${base}/jobs/${active.id}/cancel`, { body: {} })}><Square size={12} /> Parar</button>}
              {active?.status === 'aguardando' && (
                <button type="button" className="ghost small" title="Encerra este pedido sem responder: a demanda vai para Paradas e não é apagada"
                  onClick={() => api(`${base}/jobs/${active.id}/cancel`, { body: {} }).then(() => notify('Pedido encerrado. A demanda ficou em Paradas, na Mesa.')).catch((x) => notify((x as Error).message))}>
                  <Square size={12} /> Encerrar
                </button>
              )}
              <div className="send-group">
                <button className="primary small" disabled={busy || !text.trim()}><ArrowUp size={14} /> Enviar</button>
                <button type="button" className="primary small icon-only" aria-label="Mais opções de envio" aria-expanded={sendMenu} onClick={() => setSendMenu((v) => !v)}><ChevronDown size={14} /></button>
                {sendMenu && (
                  <div className="send-menu" role="menu">
                    {running && !newRequest && <button type="button" className="ghost small" role="menuitem" disabled={busy || !text.trim()} onClick={() => send(undefined, true)}>Parar e corrigir agora (o trabalho em curso é interrompido)</button>}
                    <label className="check small"><input type="checkbox" checked={newRequest} onChange={(e) => { setNewRequest(e.target.checked); setSendMenu(false); }} /> Enviar como pedido novo (abre outro cartão na esteira)</label>
                  </div>
                )}
              </div>
            </div>
          </form>
        </>
      )}
      {open && <ReviewDesk d={open} onClose={() => setOpenDemand(null)} />}
    </div>
  );
}

/** Modelo da conversa, como no app do Claude: abre uma lista com o que cada um faz. Vale a partir da próxima mensagem. */
function ModelPicker({ c }: { c: Client }) {
  const { office, notify } = useStore();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const own = c.model ?? null;
  const inherited = office?.defaultModel ?? null;
  const shown = own ?? inherited;
  const label = MODEL_CHOICES.find((m) => m.id === shown)?.label ?? 'Padrão';
  const pick = async (id: 'haiku' | 'sonnet' | 'opus' | null) => {
    setOpen(false);
    if (id === own) return;
    try {
      await api(`/api/offices/${office!.id}/clients/${c.id}`, { method: 'PATCH', body: { model: id } });
      notify(id ? `Esta conversa agora usa o ${MODEL_CHOICES.find((m) => m.id === id)?.label}. Vale a partir da próxima mensagem.` : 'Esta conversa volta a usar o modelo do escritório.');
    } catch (x) { notify((x as Error).message); }
  };
  if (!canWork(office!.role)) return null;
  return (
    <div className="model-picker" ref={box}>
      <button type="button" className="ghost small" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Modelo desta conversa">
        <Sparkles size={13} /> {label} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="model-pop" role="listbox" aria-label="Modelo desta conversa">
          {MODEL_CHOICES.map((m) => (
            <button key={m.id} type="button" role="option" aria-selected={own === m.id} className={own === m.id ? 'on' : ''} onClick={() => pick(m.id)}>
              <span className="model-name"><b>{m.label}</b>{own === m.id && <Check size={14} />}</span>
              <small>{m.hint}</small>
            </button>
          ))}
          <button type="button" role="option" aria-selected={own === null} className={own === null ? 'on' : ''} onClick={() => pick(null)}>
            <span className="model-name"><b>Padrão do escritório</b>{own === null && <Check size={14} />}</span>
            <small>{inherited ? `Hoje: ${MODEL_CHOICES.find((m) => m.id === inherited)?.label}. ` : 'Hoje: o padrão do Claude Code. '}Muda na aba Equipe.</small>
          </button>
          <p className="muted small model-note">Trocar no meio da conversa faz a primeira mensagem seguinte reprocessar o histórico (gasta um pouco mais uma vez).</p>
        </div>
      )}
    </div>
  );
}
