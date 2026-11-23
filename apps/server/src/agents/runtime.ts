import { changedSkillFiles, skillsFingerprint } from './curator.ts';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { APPROVAL_MARKER, uid, type AgentJob, type AgentProfile, type Client, type Demand, type JobMessage, type Office, type Stage } from '@office/shared';
import { config } from '../config.ts';
import { all, insert, now, one, update, logActivity } from '../db.ts';
import { broadcast, invalidate } from '../realtime.ts';
import { houseRules } from './templates.ts';
import { mcpConfig } from './tools.ts';
import { openLiveForJob, releaseLiveForJob } from './live.ts';
import { pct, recordUsage } from './usage.ts';
import { onJobCheckpoint, onJobFinished } from './pipeline.ts';
import { availableDirs, deniedTools, mentionedDirs } from './permissions.ts';
import { anexosDir, isOwner } from './attachments.ts';
import { pickRunnable, queueRank, turnCost, waitReason, type QueueEntry } from './queue.ts';
import { ensureTitular, syncWorker } from './workers.ts';

/**
 * Cada funcionário de IA é uma sessão do Claude Code em modo headless (`claude -p`). Ela roda dentro da pasta do
 * cliente, como quando alguém abre o Claude Code lá: vale a memória dessa pasta e, das pastas acima, o CLAUDE.md
 * e as skills do escritório. Sem cliente, roda na pasta raiz. A saída `stream-json` vira mensagens no chat do
 * funcionário e muda o estado do avatar no mundo 3D.
 *
 * Cada cliente tem uma conversa só: toda tarefa dele retoma a mesma sessão, e o funcionário é só um rótulo do tipo de
 * trabalho. A exceção é a aprovação pela IA, que lê as peças em sessão própria, sem o histórico de quem as fez.
 */

const running = new Map<string, ChildProcess | null>();
const queue: { jobId: string; input: string; resume: boolean }[] = [];
/** Mensagem que interrompeu o trabalho: entra assim que o processo fechar. */
const interrupts = new Map<string, string>();
/** Mensagens que chegaram com o funcionário trabalhando: ele termina o que está fazendo e recebe todas juntas. */
const followups = new Map<string, string>();
/**
 * Entrada aberta de quem está trabalhando: a mensagem enviada no meio do trabalho entra no próximo passo do funcionário,
 * como no terminal (Warp, Claude Code), sem esperar a tarefa acabar. Fecha quando ele termina a rodada.
 */
const liveInput = new Map<string, ChildProcess>();
const userLine = (text: string) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: '' })}\n`;

/** Entrega a mensagem para o funcionário que está trabalhando. Devolve false se a entrada já fechou (vai depois, como continuação). */
function injectLive(jobId: string, text: string) {
  const child = liveInput.get(jobId);
  if (!child?.stdin || child.stdin.destroyed || child.stdin.writableEnded) return false;
  try { child.stdin.write(userLine(text)); return true; } catch { return false; }
}
function closeLiveInput(jobId: string) {
  const child = liveInput.get(jobId);
  liveInput.delete(jobId);
  try { child?.stdin?.end(); } catch { /* já fechou */ }
}
/** Novidade que chegou com o funcionário esperando você (ex.: o ajudante terminou): entra junto com a sua resposta. */
const notes = new Map<string, string>();

/** Token de cada tarefa rodando: o servidor MCP `office` só alcança o cliente dela. Vive na memória e some ao fim. */
const jobTokens = new Map<string, string>();
export function issueJobToken(jobId: string) {
  const token = randomBytes(24).toString('hex');
  jobTokens.set(jobId, token);
  return token;
}
export const jobForToken = (token: string | undefined) => {
  if (!token) return undefined;
  for (const [jobId, t] of jobTokens) if (t === token) return one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId);
  return undefined;
};

/**
 * Vez do navegador: o Chrome e a pasta Downloads são um só para todos os clientes. O gancho de cada tarefa pede a vez
 * antes de usar o Chrome; ela fica com a tarefa enquanto o uso continua e volta ao fim da tarefa, com
 * `navegador_liberar` ou depois de 10 minutos sem uso.
 */
const BROWSER_LEASE = 10 * 60_000;
let browser: { jobId: string; until: number } | null = null;
const browserWaiting = new Set<string>();
const clientNameOf = (jobId: string) => one<{ name: string }>('SELECT c.name FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.id = ?', jobId)?.name;

/** Teto de contexto dos funcionários, em tokens. */
export const COMPACT_WINDOW = 120_000;
/**
 * Trava contra resumo em loop: se a conversa é resumida 3 vezes em 10 minutos, ela reenche logo depois de cada resumo
 * (arquivo ou imagem grande relidos) e cada resumo relê ~90 mil tokens. Melhor parar e abrir uma conversa nova.
 */
export const THRASH = { count: 3, windowMs: 10 * 60_000 };
const compactLog = new Map<string, number[]>();
export function compactThrash(times: number[], at: number) {
  const recent = [...times, at].filter((t) => at - t <= THRASH.windowMs);
  return { times: recent, thrash: recent.length >= THRASH.count };
}
/** Limite semanal da assinatura a partir do qual a conversa avisa (uma vez por semana e por faixa). */
export const LIMIT_ALERTS = [0.8, 0.95];
const limitAlerted = new Set<string>();

// a vez do render: o gancho pede só quando o comando renderiza ou transcreve, e devolve quando ele termina
const RENDER_LEASE = 3 * 3_600_000;
let render: { jobId: string; until: number } | null = null;
const renderWaiting = new Set<string>();

export function takeRender(job: AgentJob) {
  const t = Date.now();
  if (render && render.jobId !== job.id && jobTokens.has(render.jobId) && render.until > t) {
    if (!renderWaiting.has(job.id)) {
      renderWaiting.add(job.id);
      const who = clientNameOf(render.jobId);
      addMessage(job.id, job.officeId, 'sistema', `Esperando a vez de renderizar${who ? `: o vídeo de ${who} está renderizando` : ''}. Vídeo renderiza um por vez; sigo assim que ele terminar.`);
    }
    return false;
  }
  render = { jobId: job.id, until: t + RENDER_LEASE };
  if (renderWaiting.delete(job.id)) addMessage(job.id, job.officeId, 'sistema', 'Peguei a vez de renderizar. Seguindo.');
  return true;
}

export function releaseRender(jobId: string) {
  renderWaiting.delete(jobId);
  if (render?.jobId === jobId) render = null;
}

export function takeBrowser(job: AgentJob) {
  const t = Date.now();
  // o token só existe enquanto a tarefa roda: tarefa encerrada não segura o navegador
  if (browser && browser.jobId !== job.id && jobTokens.has(browser.jobId) && browser.until > t) {
    if (!browserWaiting.has(job.id)) {
      browserWaiting.add(job.id);
      const who = clientNameOf(browser.jobId);
      addMessage(job.id, job.officeId, 'sistema', `Esperando a vez do navegador${who ? `: ${who} está usando o Chrome` : ''}. Sigo assim que ele liberar.`);
    }
    return false;
  }
  browser = { jobId: job.id, until: t + BROWSER_LEASE };
  if (browserWaiting.delete(job.id)) addMessage(job.id, job.officeId, 'sistema', 'Peguei a vez do navegador. Seguindo.');
  return true;
}

export function releaseBrowser(jobId: string) {
  browserWaiting.delete(jobId);
  if (browser?.jobId === jobId) browser = null;
}

/** Quem já foi avisado do motivo da espera na fila (o aviso sai uma vez por espera). */
const queueNoticed = new Set<string>();

const RENDER_CMD = config.renderCmd;

function systemPrompt(agent: AgentProfile, office: Office, toolHints: string[]) {
  const fill = (s: string) =>
    s
      .replaceAll('{{OFFICE_NAME}}', office.name)
      .replaceAll('{{OFFICE_ROOT}}', office.rootPath)
      .replaceAll('{{OFFICE_RENDER}}', RENDER_CMD)
      .replaceAll('{{APPROVAL_MARKER}}', APPROVAL_MARKER)
      .replaceAll('{{TODAY}}', new Date().toLocaleDateString('pt-BR'));
  const tools = toolHints.length
    ? `\n\n## Suas ferramentas criativas (MCP)\n${toolHints.join('\n')}\nCada servidor lista os próprios comandos (\`command_list\` ou equivalente): consulte antes de usar.`
    : '';
  // o funcionário pode ter sido renomeado: a persona ainda pode trazer o nome do modelo
  const named = agent.persona.includes(agent.name) ? '' : `Neste escritório, você se chama **${agent.name}** (${agent.role}). Se o texto abaixo usar outro nome, vale este.\n\n`;
  return `${named}${fill(agent.persona)}\n\n${fill(houseRules())}\n\nSua função é só um rótulo do tipo de trabalho: todas as skills de \`.claude/skills\` são suas, e você combina as que o pedido precisar.${tools}`;
}

/** `user:<id>` vira o nome da pessoa; funcionário e sistema ficam sem nome. */
export function authorName(by: string | undefined) {
  const id = by?.replace(/^user:/, '');
  if (!id || id.startsWith('agent:')) return null;
  return one<{ name: string }>('SELECT name FROM users WHERE id = ?', id)?.name ?? null;
}

export function addMessage(jobId: string, officeId: string, role: JobMessage['role'], text: string, author: string | null = null) {
  const message: JobMessage = { id: uid(), jobId, role, text, author, createdAt: now() };
  insert('job_messages', message as never);
  broadcast(officeId, { t: 'jobMessage', message });
}

function setJob(jobId: string, patch: Partial<AgentJob>) {
  update('jobs', jobId, { ...patch, updatedAt: now() });
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId)!;
  broadcast(job.officeId, { t: 'job', job });
  // o funcionário vai para a sala do trabalho, espera ali ou volta para a copa
  if (patch.status) syncWorker(job);
  return job;
}

function setAgentStatus(agentId: string, officeId: string, status: AgentProfile['status']) {
  update('agents', agentId, { status });
  invalidate(officeId, 'agents');
}

/** Resumo legível de uma chamada de ferramenta para o chat do funcionário. */
function describeTool(name: string, input: Record<string, unknown>) {
  const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 160);
  if (name === 'Bash' || name === 'PowerShell') return `${name}: ${s(input.command)}`;
  if (['Read', 'Write', 'Edit'].includes(name)) return `${name}: ${s(input.file_path)}`;
  if (name === 'Skill') return `Usando a skill ${s(input.skill)}`;
  if (name === 'Glob' || name === 'Grep') return `${name}: ${s(input.pattern)}`;
  if (name === 'WebSearch') return `Pesquisando: ${s(input.query)}`;
  // mcp__photocraft__command_run → "photocraft · command_run layer.new"
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (m) {
    const detail = input.id ?? input.command ?? input.path ?? input.file ?? '';
    return `${m[1]} · ${m[2]}${detail ? ` ${s(detail)}` : ''}`;
  }
  return name;
}

/** Funções que não pegam mais trabalho de cliente: todas tinham as mesmas skills, e dividir por função espalhava o cliente em vários chats. */
export const CLIENT_FUNCTIONS = ['copywriter', 'designer', 'editor-de-video', 'gerente'];
export const SESSION_AGENT = 'sessao';

/** Trabalho de cliente roda sempre no perfil "Sessão" (todas as skills e ferramentas); Rafa e Nina ficam para a agência. */
export function clientAgentId(officeId: string, agentId: string, clientId?: string | null) {
  if (!clientId) return agentId;
  const a = one<{ slug: string; base: string | null }>('SELECT slug, base FROM agents WHERE id = ?', agentId);
  if (a && !CLIENT_FUNCTIONS.includes(a.base ?? a.slug)) return agentId;
  return one<{ id: string }>('SELECT id FROM agents WHERE office_id = ? AND slug = ?', officeId, SESSION_AGENT)?.id ?? agentId;
}

export function enqueueJob(params: { officeId: string; agentId: string; demandId: string | null; prompt: string; createdBy: string; stage?: Stage; cwd?: string | null; clientId?: string | null; display?: string; workerId?: string | null; model?: string | null }) {
  // a conversa do cliente é a do titular dele; a revisão pela IA é função do sistema, sem funcionário
  const workerId = params.workerId !== undefined ? params.workerId
    : params.clientId && params.stage !== 'aprovacao' ? ensureTitular(params.officeId, params.clientId, params.createdBy).id : null;
  const job: AgentJob & { createdBy: string } = {
    id: uid(), officeId: params.officeId, agentId: clientAgentId(params.officeId, params.agentId, params.clientId), demandId: params.demandId, stage: params.stage ?? null, clientId: params.clientId ?? null, workerId,
    prompt: params.prompt, status: 'fila', sessionId: null, costUsd: 0, cwd: params.cwd ?? null, model: params.model ?? null,
    createdBy: params.createdBy, createdAt: now(), updatedAt: now(),
  };
  insert('jobs', job as never);
  addMessage(job.id, job.officeId, 'usuario', params.display ?? params.prompt, authorName(params.createdBy));
  broadcast(job.officeId, { t: 'job', job });
  queue.push({ jobId: job.id, input: params.prompt, resume: false });
  pump();
  return job;
}

/** Resposta humana a um checkpoint: continua a mesma sessão do Claude Code. */
export function replyToJob(jobId: string, text: string, display?: string, by?: string) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Tarefa não encontrada');
  if (running.has(jobId)) throw new Error('O funcionário ainda está trabalhando nesta tarefa.');
  addMessage(jobId, job.officeId, 'usuario', display ?? text, authorName(by));
  const note = notes.get(jobId);
  notes.delete(jobId);
  setJob(jobId, { status: 'fila' });
  queue.push({ jobId, input: note ? `${note}\n\n${text}` : text, resume: !!job.sessionId });
  pump();
}

/**
 * Uma novidade para a conversa de um funcionário (o ajudante terminou, o pedido foi recusado), sem ser mensagem de
 * pessoa: na fila, junta com o que espera; trabalhando, entra quando ele terminar a parte atual; esperando você, vai junto
 * com a sua resposta; parado, a conversa continua com ela.
 */
export function deliverToJob(jobId: string, text: string, display: string, _by?: string) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) return;
  addMessage(jobId, job.officeId, 'sistema', display);
  const waiting = queue.find((q) => q.jobId === jobId);
  if (waiting) { waiting.input += `\n\n${text}`; return; }
  if (running.has(jobId)) {
    if (!injectLive(jobId, text)) followups.set(jobId, followups.has(jobId) ? `${followups.get(jobId)}\n\n${text}` : text);
    return;
  }
  if (job.status === 'aguardando') { notes.set(jobId, notes.has(jobId) ? `${notes.get(jobId)}\n\n${text}` : text); return; }
  setJob(jobId, { status: 'fila' });
  queue.push({ jobId, input: text, resume: !!job.sessionId });
  pump();
}

/** Encerra o funcionário e o que ele abriu, como um render ou um script: no Windows, `kill` só alcança o primeiro processo. */
function killTree(child: ChildProcess) {
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill();
}

/** Correção no meio do trabalho: para o que está rodando e continua a mesma conversa com a mensagem, como Esc no terminal. */
export function interruptJob(jobId: string, text: string, display?: string, by?: string) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Tarefa não encontrada');
  const waiting = queue.find((q) => q.jobId === jobId);
  if (waiting) {
    addMessage(jobId, job.officeId, 'usuario', display ?? text, authorName(by));
    waiting.input += `\n\n${text}`;
    return;
  }
  if (!running.has(jobId)) return replyToJob(jobId, text, display, by);
  const child = running.get(jobId);
  if (!child) throw new Error('O funcionário ainda está abrindo as ferramentas. Tente de novo em alguns segundos.');
  addMessage(jobId, job.officeId, 'usuario', display ?? text, authorName(by));
  interrupts.set(jobId, interrupts.has(jobId) ? `${interrupts.get(jobId)}\n\n${text}` : text);
  killTree(child);
}

/**
 * Mensagem nova com o funcionário trabalhando: não interrompe. Ela fica guardada e, quando ele terminar esta parte,
 * continua a mesma conversa com todas as mensagens que chegaram, na ordem. Na fila, junta com o pedido que espera.
 */
export function followUpJob(jobId: string, text: string, display?: string, by?: string) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Tarefa não encontrada');
  const waiting = queue.find((q) => q.jobId === jobId);
  if (waiting) {
    addMessage(jobId, job.officeId, 'usuario', display ?? text, authorName(by));
    waiting.input += `\n\n${text}`;
    return;
  }
  if (!running.has(jobId)) return replyToJob(jobId, text, display, by);
  addMessage(jobId, job.officeId, 'usuario', display ?? text, authorName(by));
  // como no terminal: entra no próximo passo dele, sem interromper o que está fazendo
  if (injectLive(jobId, text)) return;
  followups.set(jobId, followups.has(jobId) ? `${followups.get(jobId)}\n\n${text}` : text);
}

export function cancelJob(jobId: string) {
  const idx = queue.findIndex((q) => q.jobId === jobId);
  if (idx >= 0) queue.splice(idx, 1);
  const child = running.get(jobId);
  if (child) killTree(child);
  releaseLiveForJob(jobId);
  releaseBrowser(jobId);
  releaseRender(jobId);
  queueNoticed.delete(jobId);
  const job = setJob(jobId, { status: 'cancelado' });
  setAgentStatus(job.agentId, job.officeId, 'livre');
}

function queueEntry(jobId: string, isReply: boolean): QueueEntry {
  const job = one<AgentJob>('SELECT id, client_id, demand_id, agent_id, stage FROM jobs WHERE id = ?', jobId)!;
  const d = job.demandId ? one<Pick<Demand, 'kind' | 'priority'>>('SELECT kind, priority FROM demands WHERE id = ?', job.demandId) : undefined;
  // vídeo não trava mais a tarefa inteira: só o comando de render pede a vez (gancho), o roteiro e a decupagem correm juntos
  return { id: jobId, clientId: job.clientId ?? null, lane: null, rank: queueRank(d?.priority, isReply) };
}

function pump() {
  const entries = queue.map((q) => queueEntry(q.jobId, q.resume));
  const busy = [...running.keys()].map((j) => queueEntry(j, false));
  const picked = pickRunnable(entries, busy, config.maxConcurrentJobs);
  for (const id of picked) {
    queueNoticed.delete(id);
    const next = queue.splice(queue.findIndex((q) => q.jobId === id), 1)[0];
    void start(next.jobId, next.input, next.resume);
  }
  // quem ficou na fila sabe por quê
  const after = [...busy, ...entries.filter((e) => picked.includes(e.id))];
  for (const e of entries) {
    if (picked.includes(e.id) || queueNoticed.has(e.id)) continue;
    const why = waitReason(e, after, config.maxConcurrentJobs);
    if (!why) continue;
    queueNoticed.add(e.id);
    const job = one<{ officeId: string }>('SELECT office_id FROM jobs WHERE id = ?', e.id);
    if (job) addMessage(e.id, job.officeId, 'sistema', why);
  }
}

async function start(jobId: string, typed: string, resume: boolean) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId)!;
  const agent = one<AgentProfile>('SELECT * FROM agents WHERE id = ?', job.agentId)!;
  const office = one<Office>('SELECT * FROM offices WHERE id = ?', job.officeId)!;
  // reserva a vaga enquanto os apps ao vivo abrem
  running.set(jobId, null);
  const client = job.clientId ? one<Client>('SELECT * FROM clients WHERE id = ?', job.clientId) : undefined;
  const reviewer = job.stage === 'aprovacao';
  // o ajudante trabalha em sessão própria, fora da conversa do cliente (que é a do titular)
  const helper = job.workerId ? one<{ role: string; name: string }>('SELECT role, name FROM workers WHERE id = ?', job.workerId) : undefined;
  const isHelper = helper?.role === 'ajudante';
  const conversation = client && !reviewer && !isHelper ? client : undefined;
  // na conversa do cliente vale a sessão atual dele: depois de uma conversa nova (sessionId vazio), um pedido antigo que
  // estava em aberto continua na conversa nova, e não reabre a antiga (que era justamente a grande)
  const session = conversation ? conversation.sessionId ?? null : (resume ? job.sessionId : null);
  // sem sessão para retomar, a mensagem precisa levar o pedido inteiro junto
  const input = !session && typed !== job.prompt ? `${job.prompt}\n\n${typed}` : typed;
  // quanto a sessão retomada já tinha custado, para somar só o que esta rodada gastou
  let sessionTotal = session ? (conversation?.sessionId === session ? conversation.sessionCost ?? 0 : job.sessionCost ?? 0) : 0;
  const saveSession = (id: string) => { if (conversation) update('clients', conversation.id, { sessionId: id }); };

  const dir = path.join(config.dataDir, 'jobs', jobId);
  mkdirSync(dir, { recursive: true });
  // trabalho de cliente roda só com as skills, como no terminal: sem app aberto na tela nem servidores extras
  // trabalho de cliente (conversa, ajudante, virada de mês) roda só com as skills: nenhum app abre na tela
  const isProcess = !!job.stage || isHelper || !!job.clientId;
  // modo ao vivo: o app abre na tela e o servidor MCP vira uma ponte para a janela
  const liveIds = isProcess ? [] : (agent.live ?? []).filter((id) => (agent.mcp ?? []).includes(id));
  let bridges = {};
  if (liveIds.length) {
    setJob(jobId, { status: 'rodando' });
    setAgentStatus(agent.id, office.id, 'trabalhando');
    const r = await openLiveForJob(job, office, liveIds);
    bridges = r.bridges;
    if (r.failed.length) {
      addMessage(jobId, office.id, 'sistema', `Não consegui abrir ao vivo: ${r.failed.join(', ')} (limite de ${config.maxLiveApps} apps abertos ou o app não respondeu). Essa ferramenta segue sem janela.`);
    }
    if (one<AgentJob>('SELECT status FROM jobs WHERE id = ?', jobId)?.status === 'cancelado') {
      running.delete(jobId);
      releaseLiveForJob(jobId);
      pump();
      return;
    }
  }
  // ferramentas criativas instaladas: um servidor MCP por ferramenta, com as pastas do escritório
  // daily report: só lê o levantamento e grava o relatório. Sem integrações nem servidores MCP, que somam centenas de
  // milhares de tokens de definição de ferramenta a cada passo
  const lean = job.prompt.startsWith('# Daily report');
  const mcp = mcpConfig(isProcess || lean ? [] : agent.mcp ?? [], office, bridges);
  // funcionário que assumiu na virada do mês: a primeira conversa começa pela passagem do anterior
  const handoff = !isHelper && !session && job.workerId ? one<{ handoff: string | null }>('SELECT handoff FROM workers WHERE id = ?', job.workerId)?.handoff : null;
  if (handoff && existsSync(handoff)) mcp.hints.push(`- **Passagem de bastão**: antes de começar, leia \`${handoff}\`, escrita pelo funcionário que cuidou deste cliente antes de você.`);
  const usesChrome = !reviewer && !lean && agent.allowedTools.includes('mcp__claude-in-chrome');
  const token = (job.clientId && !reviewer) || usesChrome ? issueJobToken(jobId) : null;
  // calendário de conteúdo: toda tarefa de cliente pode ler e atualizar o dele
  if (job.clientId && !reviewer && token && existsSync(config.officeMcp)) {
    mcp.servers.office = {
      command: process.execPath, args: [config.officeMcp],
      env: { ELECTRON_RUN_AS_NODE: '1', OFFICE_API: `http://127.0.0.1:${config.port}`, OFFICE_JOB_TOKEN: token },
    };
    mcp.hints.push('- **Office** (servidor MCP `office`): o calendário de conteúdo do cliente. Use `calendario_listar` antes de planejar ou produzir. Quando o calendário do mês for definido, registre cada post com `calendario_salvar` (data, formato, tema, número). Durante a produção, mova cada peça de etapa: referencia > composicao > tunning > conferencia > aprovado > drive > postado, com os caminhos das peças finais em `files`. O tunning é parte do design: arte só passa de conferência com `tunning: "feito"`. Só uma pessoa dispensa o tunning, pela tela: se alguém pedir sem tunning, avise que precisa ser marcado no calendário.');
    if (!isHelper) mcp.hints.push('- **Ajudante** (`pedir_ajudante`): quando uma parte do trabalho pode andar em paralelo (ex.: tratar as fotos enquanto você monta os carrosséis), peça um ajudante com a tarefa e o motivo. Uma pessoa precisa aprovar; siga com o resto enquanto isso. O resultado dele chega nesta conversa.');
    if (usesChrome) mcp.hints.push('- **Navegador dividido**: o Chrome e a pasta Downloads servem a todos os clientes. Ao usar o Chrome você pega a vez dele sozinho (às vezes espera outro cliente terminar). Adiante antes o que não precisa do Chrome (base, composição, scripts); junte o uso do navegador (tunning, downloads) num trecho só e, quando os arquivos baixados já estiverem na pasta do trabalho, chame `navegador_liberar` para outro cliente usar.');
  }
  const mcpIds = Object.keys(mcp.servers);
  const sysFile = path.join(dir, 'system.md');
  // o funcionário do cliente tem nome próprio (titular ou ajudante): é com ele que a IA se apresenta
  writeFileSync(sysFile, systemPrompt(helper?.name ? { ...agent, name: helper.name } : agent, office, mcp.hints), 'utf8');

  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt-file', sysFile,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...(reviewer ? ['Read', 'Glob', 'Grep'] : agent.allowedTools), ...mcpIds.map((id) => `mcp__${id}`),
    '--disallowedTools', ...deniedTools(office.rootPath),
  ];
  // o modelo da tarefa (o daily vai no Sonnet); senão o escolhido na conversa do cliente; senão o do escritório
  const model = job.model ?? client?.model ?? office.defaultModel ?? null;
  if (model) args.push('--model', model);
  // só os servidores MCP do Office (e o Chrome, que entra por --chrome): sem isso o funcionário herdava todos os da máquina
  // e da conta (Notion, Trello, Drive, rea...), ~14 mil tokens a mais no início e uma lista de ~17 mil reinjetada a cada
  // resumo, o que fazia a conversa encher de novo em 2-3 minutos (resumo em loop, 23/11/2026)
  args.push('--strict-mcp-config');
  if (lean) args.push('--tools', 'Read', 'Write');
  if (mcpIds.length) {
    const mcpFile = path.join(dir, 'mcp.json');
    writeFileSync(mcpFile, JSON.stringify({ mcpServers: mcp.servers }, null, 2), 'utf8');
    args.push('--mcp-config', mcpFile);
  }
  // o Drive entra porque o envio aprovado na conversa é feito pelo funcionário
  const dirs = availableDirs([...new Set([...office.extraDirs, ...(office.driveRoot && !reviewer ? [office.driveRoot] : []), ...(conversation?.sessionDirs ?? [])])]);
  for (const d of dirs.ok) args.push('--add-dir', d);
  if (dirs.missing.length) addMessage(jobId, office.id, 'sistema', `Pasta indisponível: ${dirs.missing.join(', ')}. Se o trabalho depende dela, conecte o disco antes de continuar.`);
  // anexos do chat (prints colados, arquivos de outro PC) e pastas que o dono citou ou arrastou nesta mensagem
  args.push('--add-dir', anexosDir());
  if (isOwner(office.id, (job as AgentJob & { createdBy?: string }).createdBy)) for (const d of mentionedDirs(typed)) if (!dirs.ok.includes(d)) args.push('--add-dir', d);
  // a sessão retomada precisa da mesma pasta; se ela sumiu, volta para a raiz
  const cwd = job.cwd && existsSync(job.cwd) ? job.cwd : office.rootPath;
  // as skills ficam na raiz, fora da pasta do cliente
  if (path.resolve(cwd) !== path.resolve(office.rootPath)) args.push('--add-dir', office.rootPath);
  // tunning no navegador: usa a extensão do Chrome, e a imagem gerada cai em Downloads
  if (usesChrome) args.push('--chrome', '--add-dir', path.join(homedir(), 'Downloads'));
  // vez do navegador e do render: o gancho pede ao Office antes de usar o Chrome ou de renderizar (Bash com ffmpeg,
  // Whisper, motor de vídeo) e espera se outro cliente estiver usando; o render devolve a vez quando o comando termina
  if (!reviewer && token && existsSync(config.officeHook)) {
    const settingsFile = path.join(dir, 'settings.json');
    const q = (p: string) => `"${p.replace(/\\/g, '/')}"`;
    const hook = { type: 'command', command: `${q(process.execPath)} ${q(config.officeHook)}`, timeout: 4 * 3600 };
    const pre = [{ matcher: 'Bash', hooks: [hook] }, ...(usesChrome ? [{ matcher: 'mcp__claude-in-chrome__.*', hooks: [hook] }] : [])];
    writeFileSync(settingsFile, JSON.stringify({ hooks: { PreToolUse: pre, PostToolUse: [{ matcher: 'Bash|Read', hooks: [hook] }] } }, null, 2), 'utf8');
    args.push('--settings', settingsFile);
  }
  if (session) args.push('--resume', session);

  const skillsBefore = reviewer ? null : skillsFingerprint(office);
  setJob(jobId, { status: 'rodando', turnStartedAt: now() });
  setAgentStatus(agent.id, office.id, 'trabalhando');
  logActivity(office.id, `agent:${agent.slug}`, resume ? 'retomou' : 'começou', job.prompt.slice(0, 120));

  let child: ChildProcess;
  try {
    // CLAUDE_BIN pode apontar para um script .mjs (um Claude de mentira, nos testes da esteira)
    const [bin, pre] = /\.m?js$/.test(config.claudeBin) ? [process.execPath, [config.claudeBin]] : [config.claudeBin, []];
    // o gancho do navegador roda com o mesmo executável do Office (no app instalado, Electron em modo Node)
    const hookEnv = token ? { ELECTRON_RUN_AS_NODE: '1', OFFICE_API: `http://127.0.0.1:${config.port}`, OFFICE_JOB_TOKEN: token } : {};
    // teto de contexto: ao passar disso a conversa é resumida e segue (sem o teto ela ia a ~1 milhão de tokens, relidos a cada passo)
    const compact = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: process.env.OFFICE_COMPACT_WINDOW ?? String(COMPACT_WINDOW) };
    child = spawn(bin, [...pre, ...args], { cwd, windowsHide: true, env: { ...process.env, ...compact, ...hookEnv, OFFICE_JOB_ID: jobId } });
  } catch (e) {
    addMessage(jobId, office.id, 'sistema', `Não consegui iniciar o Claude Code: ${(e as Error).message}`);
    setJob(jobId, { status: 'erro' });
    setAgentStatus(agent.id, office.id, 'erro');
    running.delete(jobId);
    releaseLiveForJob(jobId);
    pump();
    return;
  }
  running.set(jobId, child);
  // o prompt vai pelo stdin (sem limite de linha de comando nem problema de aspas no Windows), e a entrada fica aberta
  // para as mensagens que chegarem durante o trabalho
  child.stdin?.on('error', () => liveInput.delete(jobId));
  child.stdin?.write(userLine(input));
  liveInput.set(jobId, child);

  let buf = '';
  let lastCtx = 0;
  let finalText = '';
  let isError = false;
  let stderr = '';

  child.stdout?.on('data', (chunk) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: any;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
        setJob(jobId, { sessionId: ev.session_id });
        saveSession(ev.session_id);
      } else if (ev.type === 'system' && ev.subtype === 'compact_boundary') {
        const { times, thrash } = compactThrash(compactLog.get(jobId) ?? [], Date.now());
        compactLog.set(jobId, times);
        if (thrash && running.has(jobId)) {
          compactLog.delete(jobId);
          followups.delete(jobId);
          addMessage(jobId, office.id, 'sistema', `Parei este trabalho: a conversa foi resumida ${times.length} vezes em menos de 10 minutos. Ela enche de novo logo depois de cada resumo e só gasta limite sem avançar. No painel do cliente, use "Trocar de funcionário (conversa nova)": a conversa nova leva o resumo e começa leve. Depois peça para seguir de onde parou.`);
          logActivity(office.id, `agent:${agent.slug}`, 'parado por resumo em loop', clientNameOf(jobId) ?? '');
          cancelJob(jobId);
        }
      } else if (ev.type === 'assistant') {
        const u = ev.message?.usage;
        const ctx = u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : 0;
        // só grava quando muda de verdade (o medidor não precisa de cada passo)
        if (ctx && Math.abs(ctx - lastCtx) >= 5_000) { lastCtx = ctx; setJob(jobId, { contextTokens: ctx }); }
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) addMessage(jobId, office.id, 'agente', block.text.replace(APPROVAL_MARKER, '').trim());
          if (block.type === 'tool_use') addMessage(jobId, office.id, 'ferramenta', describeTool(block.name, block.input ?? {}));
        }
      } else if (ev.type === 'rate_limit_event') {
        const u = recordUsage(ev.rate_limit_info);
        const hit = u?.sevenDay != null ? LIMIT_ALERTS.filter((a) => u.sevenDay! >= a).at(-1) : undefined;
        if (u && hit && !limitAlerted.has(`${u.sevenDayResets}:${hit}`)) {
          limitAlerted.add(`${u.sevenDayResets}:${hit}`);
          const renova = u.sevenDayResets ? new Date(u.sevenDayResets).toLocaleString('pt-BR', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : 'em breve';
          addMessage(jobId, office.id, 'sistema', `O limite semanal da assinatura do Claude está em ${pct(u.sevenDay)} (renova ${renova}). Priorize o que é urgente; conversas longas e muitas imagens abertas gastam mais.`);
        }
        invalidate(office.id, 'limite');
      } else if (ev.type === 'result') {
        // rodada encerrada: fecha a entrada; o que chegar daqui em diante vai como continuação, quando ele sair
        closeLiveInput(jobId);
        finalText = String(ev.result ?? '');
        isError = !!ev.is_error;
        const prev = one<AgentJob>('SELECT cost_usd FROM jobs WHERE id = ?', jobId);
        const reported = Number(ev.total_cost_usd ?? 0);
        // sessão vinda do terminal (total anterior desconhecido, marcado como -1): a primeira rodada só vira a base
        const spent = sessionTotal < 0 ? 0 : turnCost(reported, sessionTotal);
        sessionTotal = reported;
        setJob(jobId, { costUsd: (prev?.costUsd ?? 0) + spent, sessionCost: reported, sessionId: ev.session_id ?? undefined });
        if (ev.session_id) saveSession(ev.session_id);
        if (conversation) update('clients', conversation.id, { sessionCost: reported });
      }
    }
  });
  child.stderr?.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });

  child.on('close', (code) => {
    liveInput.delete(jobId);
    running.delete(jobId);
    jobTokens.delete(jobId);
    releaseBrowser(jobId);
    releaseRender(jobId);
    const skillsAfter = skillsBefore ? skillsFingerprint(office) : null;
    const touched = skillsBefore && skillsAfter ? changedSkillFiles(skillsBefore, skillsAfter) : [];
    if (touched.length || (skillsBefore && skillsAfter && skillsBefore.split('\n')[0] !== skillsAfter.split('\n')[0])) {
      const text = `As skills mudaram enquanto ${agent.name} trabalhava${touched.length ? `: ${touched.slice(0, 6).join(', ')}` : ' (commit novo)'}. Se não foi alguém no terminal, confira: pelo Office, skill só muda por Mesa > Aprendizados.`;
      addMessage(jobId, office.id, 'sistema', text);
      broadcast(office.id, { t: 'notice', text, agentId: agent.id });
      logActivity(office.id, `agent:${agent.slug}`, 'skills mudaram durante a tarefa', touched.join(', ').slice(0, 200));
    }
    releaseLiveForJob(jobId);
    const current = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId)!;
    if (current.status === 'cancelado') { interrupts.delete(jobId); followups.delete(jobId); pump(); return; }
    const correction = interrupts.get(jobId);
    if (correction !== undefined) {
      interrupts.delete(jobId);
      // o que estava esperando a vez entra junto com a correção
      const pending = followups.get(jobId);
      followups.delete(jobId);
      queue.unshift({ jobId, input: pending ? `${pending}\n\n${correction}` : correction, resume: true });
      addMessage(jobId, office.id, 'sistema', 'Interrompi o trabalho para seguir com a sua mensagem.');
      setJob(jobId, { status: 'fila' });
      pump();
      return;
    }
    // mensagens que chegaram durante o trabalho: continua a mesma conversa com todas elas antes de fechar a etapa
    const pending = followups.get(jobId);
    if (pending !== undefined && !(session && /no conversation found/i.test(`${stderr} ${finalText}`))) {
      followups.delete(jobId);
      addMessage(jobId, office.id, 'sistema', 'Terminei esta parte. Sigo com as mensagens que chegaram enquanto eu trabalhava.');
      setJob(jobId, { status: 'fila' });
      queue.unshift({ jobId, input: pending, resume: true });
      pump();
      return;
    }
    // a sessão não existe mais (apagada, ou de outra pasta): segue numa nova e avisa, em vez de parar
    if (session && (code !== 0 || isError) && /no conversation found/i.test(`${stderr} ${finalText}`)) {
      if (conversation) update('clients', conversation.id, { sessionId: null, sessionCost: 0 });
      setJob(jobId, { sessionId: null, status: 'fila' });
      addMessage(jobId, office.id, 'sistema', 'Não encontrei a conversa anterior deste cliente, então comecei uma nova. O agente não lembra do que foi dito antes.');
      followups.delete(jobId);
      queue.unshift({ jobId, input: pending ? `${typed}\n\n${pending}` : typed, resume: false });
      pump();
      return;
    }
    if (code !== 0 && !finalText) {
      addMessage(jobId, office.id, 'sistema', `O Claude Code saiu com erro (código ${code}). ${stderr.trim().slice(-800)}`);
      const failed = setJob(jobId, { status: 'erro' });
      setAgentStatus(agent.id, office.id, 'erro');
      onJobFinished(failed, '', false);
    } else if (finalText.includes(APPROVAL_MARKER)) {
      const waiting = setJob(jobId, { status: 'aguardando' });
      setAgentStatus(agent.id, office.id, 'aguardando');
      logActivity(office.id, `agent:${agent.slug}`, 'pediu aprovação', job.prompt.slice(0, 120));
      // o que já existe vai para a mesa junto com a pergunta
      try { onJobCheckpoint(waiting, finalText); } catch (e) { addMessage(jobId, office.id, 'sistema', `Não consegui mostrar as peças na mesa: ${(e as Error).message}`); }
    } else {
      const done = setJob(jobId, { status: isError ? 'erro' : 'concluido' });
      const stillBusy = all<AgentJob>("SELECT id FROM jobs WHERE agent_id = ? AND status IN ('rodando','aguardando')", agent.id).length > 0;
      setAgentStatus(agent.id, office.id, isError ? 'erro' : stillBusy ? 'aguardando' : 'livre');
      // esteira: a próxima etapa começa sozinha (ou o cartão vai para Aprovação, nas tarefas avulsas)
      invalidate(office.id, 'clients');
      try { onJobFinished(done, finalText, !isError); } catch (e) { addMessage(jobId, office.id, 'sistema', `A esteira não conseguiu seguir: ${(e as Error).message}`); }
    }
    pump();
  });
}

export const RESUMED_TEXT = 'O Office reiniciou no meio desta tarefa (atualização). Retomei sozinho de onde parou.';
const RESUME_PROMPT = 'O Office reiniciou no meio deste trabalho (atualização do app). Confira o que já ficou pronto nas pastas e continue de onde parou, sem refazer o que já está feito.';

/**
 * Ao iniciar o servidor, as tarefas que estavam rodando ou na fila voltam para a fila sozinhas, na mesma conversa: atualizar
 * o Office não perde trabalho. Mensagens que esperavam a vez entram junto. Se a tarefa já tinha sido retomada assim e
 * caiu de novo sem avançar, fica parada esperando alguém, para um erro não repetir em ciclo.
 */
export function recoverJobs() {
  for (const j of all<AgentJob>("SELECT * FROM jobs WHERE status IN ('rodando','fila') ORDER BY updated_at")) {
    const recent = all<JobMessage>('SELECT * FROM job_messages WHERE job_id = ? ORDER BY created_at DESC LIMIT 20', j.id);
    const last = recent.find((m) => m.role !== 'usuario');
    if (last?.role === 'sistema' && last.text === RESUMED_TEXT) {
      update('jobs', j.id, { status: 'erro', updatedAt: now() });
      insert('job_messages', { id: uid(), jobId: j.id, role: 'sistema', text: 'O Office reiniciou de novo antes de esta tarefa avançar. Responda para retomar.', createdAt: now() } as never);
      continue;
    }
    // o que a pessoa mandou e ainda não foi atendido (as últimas mensagens dela, depois da última resposta)
    const pending: string[] = [];
    for (const m of recent) { if (m.role !== 'usuario') break; pending.unshift(m.text); }
    const typed = j.status === 'fila' && pending.length ? pending.join('\n\n') : RESUME_PROMPT;
    update('jobs', j.id, { status: 'fila', updatedAt: now() });
    insert('job_messages', { id: uid(), jobId: j.id, role: 'sistema', text: RESUMED_TEXT, createdAt: now() } as never);
    queue.push({ jobId: j.id, input: typed, resume: !!j.sessionId });
  }
  for (const a of all<AgentProfile>("SELECT * FROM agents WHERE status = 'trabalhando'")) update('agents', a.id, { status: 'livre' });
  pump();
}
