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
import { onJobCheckpoint, onJobFinished } from './pipeline.ts';
import { availableDirs, deniedTools } from './permissions.ts';
import { pickRunnable, queueRank, turnCost, type QueueEntry } from './queue.ts';

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

function addMessage(jobId: string, officeId: string, role: JobMessage['role'], text: string) {
  const message: JobMessage = { id: uid(), jobId, role, text, createdAt: now() };
  insert('job_messages', message as never);
  broadcast(officeId, { t: 'jobMessage', message });
}

function setJob(jobId: string, patch: Partial<AgentJob>) {
  update('jobs', jobId, { ...patch, updatedAt: now() });
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId)!;
  broadcast(job.officeId, { t: 'job', job });
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

export function enqueueJob(params: { officeId: string; agentId: string; demandId: string | null; prompt: string; createdBy: string; stage?: Stage; cwd?: string | null; clientId?: string | null; display?: string }) {
  const job: AgentJob & { createdBy: string } = {
    id: uid(), officeId: params.officeId, agentId: params.agentId, demandId: params.demandId, stage: params.stage ?? null, clientId: params.clientId ?? null,
    prompt: params.prompt, status: 'fila', sessionId: null, costUsd: 0, cwd: params.cwd ?? null,
    createdBy: params.createdBy, createdAt: now(), updatedAt: now(),
  };
  insert('jobs', job as never);
  addMessage(job.id, job.officeId, 'usuario', params.display ?? params.prompt);
  broadcast(job.officeId, { t: 'job', job });
  queue.push({ jobId: job.id, input: params.prompt, resume: false });
  pump();
  return job;
}

/** Resposta humana a um checkpoint: continua a mesma sessão do Claude Code. */
export function replyToJob(jobId: string, text: string, display?: string) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Tarefa não encontrada');
  if (running.has(jobId)) throw new Error('O funcionário ainda está trabalhando nesta tarefa.');
  addMessage(jobId, job.officeId, 'usuario', display ?? text);
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
export function interruptJob(jobId: string, text: string, display?: string) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Tarefa não encontrada');
  const waiting = queue.find((q) => q.jobId === jobId);
  if (waiting) {
    addMessage(jobId, job.officeId, 'usuario', display ?? text);
    waiting.input += `\n\n${text}`;
    return;
  }
  if (!running.has(jobId)) return replyToJob(jobId, text, display);
  const child = running.get(jobId);
  if (!child) throw new Error('O funcionário ainda está abrindo as ferramentas. Tente de novo em alguns segundos.');
  addMessage(jobId, job.officeId, 'usuario', display ?? text);
  interrupts.set(jobId, interrupts.has(jobId) ? `${interrupts.get(jobId)}\n\n${text}` : text);
  killTree(child);
}

export function cancelJob(jobId: string) {
  const idx = queue.findIndex((q) => q.jobId === jobId);
  if (idx >= 0) queue.splice(idx, 1);
  const child = running.get(jobId);
  if (child) killTree(child);
  releaseLiveForJob(jobId);
  const job = setJob(jobId, { status: 'cancelado' });
  setAgentStatus(job.agentId, job.officeId, 'livre');
}

function queueEntry(jobId: string, isReply: boolean): QueueEntry {
  const job = one<AgentJob>('SELECT id, client_id, demand_id, agent_id, stage FROM jobs WHERE id = ?', jobId)!;
  const d = job.demandId ? one<Pick<Demand, 'kind' | 'priority'>>('SELECT kind, priority FROM demands WHERE id = ?', job.demandId) : undefined;
  const a = one<{ slug: string; base: string | null }>('SELECT slug, base FROM agents WHERE id = ?', job.agentId);
  // quem revisa só lê: não disputa render nem navegador
  const lane = job.stage === 'aprovacao' ? null
    : d?.kind === 'video' || a?.slug === 'editor-de-video' || a?.base === 'editor-de-video' ? 'video'
    : d?.kind === 'design' ? 'navegador' : null;
  return { id: jobId, clientId: job.clientId ?? null, lane, rank: queueRank(d?.priority, isReply) };
}

function pump() {
  const entries = queue.map((q) => queueEntry(q.jobId, q.resume));
  for (const id of pickRunnable(entries, [...running.keys()].map((j) => queueEntry(j, false)), config.maxConcurrentJobs)) {
    const next = queue.splice(queue.findIndex((q) => q.jobId === id), 1)[0];
    void start(next.jobId, next.input, next.resume);
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
  const conversation = client && !reviewer ? client : undefined;
  const session = conversation?.sessionId ?? (resume ? job.sessionId : null);
  // sem sessão para retomar, a mensagem precisa levar o pedido inteiro junto
  const input = !session && typed !== job.prompt ? `${job.prompt}\n\n${typed}` : typed;
  // quanto a sessão retomada já tinha custado, para somar só o que esta rodada gastou
  let sessionTotal = session ? (conversation?.sessionId === session ? conversation.sessionCost ?? 0 : job.sessionCost ?? 0) : 0;
  const saveSession = (id: string) => { if (conversation) update('clients', conversation.id, { sessionId: id }); };

  const dir = path.join(config.dataDir, 'jobs', jobId);
  mkdirSync(dir, { recursive: true });
  // trabalho de cliente roda só com as skills, como no terminal: sem app aberto na tela nem servidores extras
  const isProcess = !!job.stage;
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
  const mcp = mcpConfig(isProcess ? [] : agent.mcp ?? [], office, bridges);
  const mcpIds = Object.keys(mcp.servers);
  const sysFile = path.join(dir, 'system.md');
  writeFileSync(sysFile, systemPrompt(agent, office, mcp.hints), 'utf8');

  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt-file', sysFile,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...(reviewer ? ['Read', 'Glob', 'Grep'] : agent.allowedTools), ...mcpIds.map((id) => `mcp__${id}`),
    '--disallowedTools', ...deniedTools(office.rootPath),
  ];
  if (mcpIds.length) {
    const mcpFile = path.join(dir, 'mcp.json');
    writeFileSync(mcpFile, JSON.stringify({ mcpServers: mcp.servers }, null, 2), 'utf8');
    args.push('--mcp-config', mcpFile);
  }
  // o Drive entra porque o envio aprovado na conversa é feito pelo funcionário
  const dirs = availableDirs([...new Set([...office.extraDirs, ...(office.driveRoot && !reviewer ? [office.driveRoot] : []), ...(conversation?.sessionDirs ?? [])])]);
  for (const d of dirs.ok) args.push('--add-dir', d);
  if (dirs.missing.length) addMessage(jobId, office.id, 'sistema', `Pasta indisponível: ${dirs.missing.join(', ')}. Se o trabalho depende dela, conecte o disco antes de continuar.`);
  // a sessão retomada precisa da mesma pasta; se ela sumiu, volta para a raiz
  const cwd = job.cwd && existsSync(job.cwd) ? job.cwd : office.rootPath;
  // as skills ficam na raiz, fora da pasta do cliente
  if (path.resolve(cwd) !== path.resolve(office.rootPath)) args.push('--add-dir', office.rootPath);
  // tunning no navegador: usa a extensão do Chrome, e a imagem gerada cai em Downloads
  if (!reviewer && agent.allowedTools.includes('mcp__claude-in-chrome')) args.push('--chrome', '--add-dir', path.join(homedir(), 'Downloads'));
  if (session) args.push('--resume', session);

  setJob(jobId, { status: 'rodando', turnStartedAt: now() });
  setAgentStatus(agent.id, office.id, 'trabalhando');
  logActivity(office.id, `agent:${agent.slug}`, resume ? 'retomou' : 'começou', job.prompt.slice(0, 120));

  let child: ChildProcess;
  try {
    // CLAUDE_BIN pode apontar para um script .mjs (um Claude de mentira, nos testes da esteira)
    const [bin, pre] = /\.m?js$/.test(config.claudeBin) ? [process.execPath, [config.claudeBin]] : [config.claudeBin, []];
    child = spawn(bin, [...pre, ...args], { cwd, windowsHide: true, env: { ...process.env, OFFICE_JOB_ID: jobId } });
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
  // o prompt vai pelo stdin: evita limite de linha de comando e problemas de aspas no Windows
  child.stdin?.end(input);

  let buf = '';
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
      } else if (ev.type === 'assistant') {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) addMessage(jobId, office.id, 'agente', block.text.replace(APPROVAL_MARKER, '').trim());
          if (block.type === 'tool_use') addMessage(jobId, office.id, 'ferramenta', describeTool(block.name, block.input ?? {}));
        }
      } else if (ev.type === 'result') {
        finalText = String(ev.result ?? '');
        isError = !!ev.is_error;
        const prev = one<AgentJob>('SELECT cost_usd FROM jobs WHERE id = ?', jobId);
        const reported = Number(ev.total_cost_usd ?? 0);
        const spent = turnCost(reported, sessionTotal);
        sessionTotal = reported;
        setJob(jobId, { costUsd: (prev?.costUsd ?? 0) + spent, sessionCost: reported, sessionId: ev.session_id ?? undefined });
        if (ev.session_id) saveSession(ev.session_id);
        if (conversation) update('clients', conversation.id, { sessionCost: reported });
      }
    }
  });
  child.stderr?.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });

  child.on('close', (code) => {
    running.delete(jobId);
    releaseLiveForJob(jobId);
    const current = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId)!;
    if (current.status === 'cancelado') { interrupts.delete(jobId); pump(); return; }
    const correction = interrupts.get(jobId);
    if (correction !== undefined) {
      interrupts.delete(jobId);
      addMessage(jobId, office.id, 'sistema', 'Interrompi o trabalho para seguir com a sua mensagem.');
      setJob(jobId, { status: 'fila' });
      queue.unshift({ jobId, input: correction, resume: true });
      pump();
      return;
    }
    // a sessão não existe mais (apagada, ou de outra pasta): segue numa nova e avisa, em vez de parar
    if (session && (code !== 0 || isError) && /no conversation found/i.test(`${stderr} ${finalText}`)) {
      if (conversation) update('clients', conversation.id, { sessionId: null, sessionCost: 0 });
      setJob(jobId, { sessionId: null, status: 'fila' });
      addMessage(jobId, office.id, 'sistema', 'Não encontrei a conversa anterior deste cliente, então comecei uma nova. O agente não lembra do que foi dito antes.');
      queue.unshift({ jobId, input: typed, resume: false });
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

/** Ao iniciar o servidor, tarefas que estavam rodando quando ele caiu ficam marcadas como erro. */
export function recoverJobs() {
  for (const j of all<AgentJob>("SELECT * FROM jobs WHERE status IN ('rodando','fila')")) {
    update('jobs', j.id, { status: 'erro', updatedAt: now() });
    insert('job_messages', { id: uid(), jobId: j.id, role: 'sistema', text: 'O servidor reiniciou durante esta tarefa. Responda para retomar.', createdAt: now() } as never);
  }
  for (const a of all<AgentProfile>("SELECT * FROM agents WHERE status = 'trabalhando'")) update('agents', a.id, { status: 'livre' });
}
