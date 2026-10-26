import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APPROVAL_MARKER, uid, type AgentJob, type AgentProfile, type JobMessage, type Office } from '@office/shared';
import { config } from '../config.ts';
import { all, insert, now, one, update, logActivity } from '../db.ts';
import { broadcast, invalidate } from '../realtime.ts';
import { houseRules } from './templates.ts';
import { mcpConfig } from './tools.ts';

/**
 * Cada funcionário de IA é uma sessão do Claude Code em modo headless (`claude -p`),
 * rodando na pasta raiz do escritório. A saída `stream-json` vira mensagens no chat do
 * funcionário e muda o estado do avatar no mundo 3D.
 */

/** Nunca liberado, mesmo que um modelo de funcionário peça. */
const ALWAYS_DENIED = [
  'Bash(rm:*)', 'Bash(rmdir:*)', 'Bash(del:*)', 'Bash(rd:*)', 'Bash(format:*)', 'Bash(git push:*)',
  'Bash(mv:*)', 'Bash(move:*)', 'Bash(ren:*)',
  'PowerShell(Remove-Item:*)', 'PowerShell(Move-Item:*)', 'PowerShell(Rename-Item:*)', 'PowerShell(Clear-Content:*)',
  'mcp__claude_ai_Google_Drive__trash_file', 'mcp__claude_ai_Google_Drive__share_file',
  'mcp__claude_ai_Notion__notion-delete-pages', 'mcp__claude_ai_Notion__notion-delete-databases',
];

const running = new Map<string, ChildProcess>();
const queue: { jobId: string; input: string; resume: boolean }[] = [];

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
  return `${fill(agent.persona)}\n\n${fill(houseRules())}\n\nSkills que você domina: ${agent.skills.join(', ') || 'nenhuma específica'}.${tools}`;
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

export function enqueueJob(params: { officeId: string; agentId: string; demandId: string | null; prompt: string; createdBy: string }) {
  const job: AgentJob & { createdBy: string } = {
    id: uid(), officeId: params.officeId, agentId: params.agentId, demandId: params.demandId,
    prompt: params.prompt, status: 'fila', sessionId: null, costUsd: 0,
    createdBy: params.createdBy, createdAt: now(), updatedAt: now(),
  };
  insert('jobs', job as never);
  addMessage(job.id, job.officeId, 'usuario', params.prompt);
  broadcast(job.officeId, { t: 'job', job });
  queue.push({ jobId: job.id, input: params.prompt, resume: false });
  pump();
  return job;
}

/** Resposta humana a um checkpoint: continua a mesma sessão do Claude Code. */
export function replyToJob(jobId: string, text: string) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Tarefa não encontrada');
  if (running.has(jobId)) throw new Error('O funcionário ainda está trabalhando nesta tarefa.');
  addMessage(jobId, job.officeId, 'usuario', text);
  setJob(jobId, { status: 'fila' });
  queue.push({ jobId, input: text, resume: !!job.sessionId });
  pump();
}

export function cancelJob(jobId: string) {
  const idx = queue.findIndex((q) => q.jobId === jobId);
  if (idx >= 0) queue.splice(idx, 1);
  running.get(jobId)?.kill();
  const job = setJob(jobId, { status: 'cancelado' });
  setAgentStatus(job.agentId, job.officeId, 'livre');
}

function pump() {
  while (running.size < config.maxConcurrentJobs && queue.length) {
    const next = queue.shift()!;
    start(next.jobId, next.input, next.resume);
  }
}

function start(jobId: string, input: string, resume: boolean) {
  const job = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId)!;
  const agent = one<AgentProfile>('SELECT * FROM agents WHERE id = ?', job.agentId)!;
  const office = one<Office>('SELECT * FROM offices WHERE id = ?', job.officeId)!;

  const dir = path.join(config.dataDir, 'jobs', jobId);
  mkdirSync(dir, { recursive: true });
  // ferramentas criativas instaladas: um servidor MCP por ferramenta, com as pastas do escritório
  const mcp = mcpConfig(agent.mcp ?? [], office);
  const mcpIds = Object.keys(mcp.servers);
  const sysFile = path.join(dir, 'system.md');
  writeFileSync(sysFile, systemPrompt(agent, office, mcp.hints), 'utf8');

  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt-file', sysFile,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...agent.allowedTools, ...mcpIds.map((id) => `mcp__${id}`),
    '--disallowedTools', ...ALWAYS_DENIED,
  ];
  if (mcpIds.length) {
    const mcpFile = path.join(dir, 'mcp.json');
    writeFileSync(mcpFile, JSON.stringify({ mcpServers: mcp.servers }, null, 2), 'utf8');
    args.push('--mcp-config', mcpFile);
  }
  for (const d of office.extraDirs) args.push('--add-dir', d);
  if (resume && job.sessionId) args.push('--resume', job.sessionId);

  setJob(jobId, { status: 'rodando' });
  setAgentStatus(agent.id, office.id, 'trabalhando');
  logActivity(office.id, `agent:${agent.slug}`, resume ? 'retomou' : 'começou', job.prompt.slice(0, 120));

  let child: ChildProcess;
  try {
    child = spawn(config.claudeBin, args, { cwd: office.rootPath, windowsHide: true, env: { ...process.env, OFFICE_JOB_ID: jobId } });
  } catch (e) {
    addMessage(jobId, office.id, 'sistema', `Não consegui iniciar o Claude Code: ${(e as Error).message}`);
    setJob(jobId, { status: 'erro' });
    setAgentStatus(agent.id, office.id, 'erro');
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
      } else if (ev.type === 'assistant') {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) addMessage(jobId, office.id, 'agente', block.text.replace(APPROVAL_MARKER, '').trim());
          if (block.type === 'tool_use') addMessage(jobId, office.id, 'ferramenta', describeTool(block.name, block.input ?? {}));
        }
      } else if (ev.type === 'result') {
        finalText = String(ev.result ?? '');
        isError = !!ev.is_error;
        const prev = one<AgentJob>('SELECT cost_usd FROM jobs WHERE id = ?', jobId);
        setJob(jobId, { costUsd: (prev?.costUsd ?? 0) + Number(ev.total_cost_usd ?? 0), sessionId: ev.session_id ?? undefined });
      }
    }
  });
  child.stderr?.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });

  child.on('close', (code) => {
    running.delete(jobId);
    const current = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', jobId)!;
    if (current.status === 'cancelado') { pump(); return; }
    if (code !== 0 && !finalText) {
      addMessage(jobId, office.id, 'sistema', `O Claude Code saiu com erro (código ${code}). ${stderr.trim().slice(-800)}`);
      setJob(jobId, { status: 'erro' });
      setAgentStatus(agent.id, office.id, 'erro');
    } else if (finalText.includes(APPROVAL_MARKER)) {
      setJob(jobId, { status: 'aguardando' });
      setAgentStatus(agent.id, office.id, 'aguardando');
      logActivity(office.id, `agent:${agent.slug}`, 'pediu aprovação', job.prompt.slice(0, 120));
    } else {
      setJob(jobId, { status: isError ? 'erro' : 'concluido' });
      const stillBusy = all<AgentJob>("SELECT id FROM jobs WHERE agent_id = ? AND status IN ('rodando','aguardando')", agent.id).length > 0;
      setAgentStatus(agent.id, office.id, isError ? 'erro' : stillBusy ? 'aguardando' : 'livre');
      if (!isError && job.demandId) {
        update('demands', job.demandId, { status: 'aprovacao', updatedAt: now() });
        invalidate(office.id, 'demands');
      }
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
