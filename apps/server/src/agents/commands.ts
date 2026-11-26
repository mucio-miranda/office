import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentJob, Client, HelperRequest, Worker } from '@office/shared';
import { all, insert, logActivity, now, one, update } from '../db.ts';
import { broadcast, invalidate } from '../realtime.ts';
import { deliverToJob } from './runtime.ts';

/**
 * Comandos que saem do computador (enviar ao GitHub, criar repositório) não rodam na sessão do funcionário: ele pede, uma
 * pessoa vê o comando exato na tela e aprova, e o próprio Office executa. Só os comandos desta lista, sem shell.
 */

export type CommandAction = 'git_push' | 'gh_repo_create';
export interface CommandSpec { acao: CommandAction; pasta: string; bin: 'git' | 'gh'; args: string[] }

const uid = () => randomBytes(8).toString('hex');
const SAFE_REF = /^(?!-)[A-Za-z0-9._/-]{1,100}$/;
const SAFE_REMOTE = /^(?!-)[A-Za-z0-9._-]{1,50}$/;
const SAFE_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Monta o comando a partir do pedido, ou explica o que está errado. */
export function buildCommand(input: { acao?: unknown; pasta?: unknown; remoto?: unknown; branch?: unknown; nome?: unknown; visibilidade?: unknown }): CommandSpec {
  const pasta = typeof input.pasta === 'string' ? path.normalize(input.pasta.trim()).replace(/[\\/]+$/, '') : '';
  if (!pasta || !path.isAbsolute(pasta) || path.parse(pasta).root === pasta + path.sep || path.parse(pasta).root === pasta) throw new Error('Mande `pasta` com o caminho completo do repositório.');
  if (!existsSync(pasta) || !statSync(pasta).isDirectory()) throw new Error(`Pasta não encontrada: ${pasta}`);
  if (!existsSync(path.join(pasta, '.git'))) throw new Error('A pasta ainda não é um repositório git: rode `git init` e faça o primeiro commit antes.');
  if (input.acao === 'git_push') {
    const remoto = input.remoto == null || input.remoto === '' ? 'origin' : String(input.remoto);
    const branch = input.branch == null || input.branch === '' ? 'main' : String(input.branch);
    if (!SAFE_REMOTE.test(remoto)) throw new Error('Nome de remoto inválido.');
    if (!SAFE_REF.test(branch) || branch.includes('..')) throw new Error('Nome de branch inválido.');
    return { acao: 'git_push', pasta, bin: 'git', args: ['push', '-u', remoto, branch] };
  }
  if (input.acao === 'gh_repo_create') {
    const nome = String(input.nome ?? '');
    if (!SAFE_REPO.test(nome)) throw new Error('Mande `nome` como dono/repositorio (ex.: mucio-miranda/site-cliente).');
    const vis = input.visibilidade === 'publico' ? '--public' : input.visibilidade === 'privado' ? '--private' : null;
    if (!vis) throw new Error('Mande `visibilidade`: "privado" ou "publico" (a pessoa decide; na dúvida, privado).');
    return { acao: 'gh_repo_create', pasta, bin: 'gh', args: ['repo', 'create', nome, vis, '--source', pasta, '--remote', 'origin', '--push'] };
  }
  throw new Error('`acao` precisa ser "git_push" ou "gh_repo_create".');
}

export const commandLine = (c: CommandSpec) => [c.bin, ...c.args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ');

export function requestCommand(job: AgentJob, input: Parameters<typeof buildCommand>[0] & { motivo?: unknown }) {
  if (!job.clientId || !job.workerId) throw new Error('Só o funcionário de um cliente pode pedir comando.');
  const asker = one<Worker>('SELECT * FROM workers WHERE id = ?', job.workerId);
  if (!asker || asker.archivedAt) throw new Error('Funcionário não encontrado.');
  const spec = buildCommand(input);
  const open = all<HelperRequest>("SELECT * FROM helper_requests WHERE client_id = ? AND status = 'pendente' AND kind = 'comando'", job.clientId);
  if (open.length >= 3) throw new Error('Já há pedidos de comando esperando aprovação neste cliente.');
  const r = {
    id: uid(), officeId: job.officeId, clientId: job.clientId, workerId: asker.id, jobId: job.id,
    task: `${commandLine(spec)}\nem ${spec.pasta}`, reason: String(input.motivo ?? '').trim().slice(0, 600), status: 'pendente', helperId: null,
    createdAt: now(), decidedBy: null, kind: 'comando', command: JSON.stringify(spec),
  };
  insert('helper_requests', r as never);
  invalidate(job.officeId, 'helpers');
  const client = one<Client>('SELECT name FROM clients WHERE id = ?', job.clientId);
  broadcast(job.officeId, { t: 'notice', text: `${asker.name} (${client?.name ?? 'cliente'}) pede para rodar: ${commandLine(spec).slice(0, 90)}` });
  return r;
}

type Runner = (bin: string, args: string[], cwd: string) => Promise<{ ok: boolean; out: string }>;
const run: Runner = (bin, args, cwd) => new Promise((resolve) => {
  execFile(bin, args, { cwd, windowsHide: true, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } },
    (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}\n${stderr}`.trim().slice(-3000) || (err ? err.message : '') }));
});

/** Aprovado: o Office roda o comando guardado no pedido (nunca o texto da tela) e devolve a saída na conversa. */
export async function decideCommand(r: HelperRequest & { command?: string | null }, approve: boolean, by: string, runner: Runner = run) {
  const parent = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', r.jobId);
  if (!approve) {
    update('helper_requests', r.id, { status: 'recusado', decidedBy: by });
    invalidate(r.officeId, 'helpers');
    if (parent) deliverToJob(parent.id, `O comando \`${r.task.split('\n')[0]}\` não foi aprovado. Não tente de outro jeito; siga com o resto ou pergunte à pessoa.`, 'Comando recusado', by);
    return { ok: false, out: '' };
  }
  update('helper_requests', r.id, { status: 'aprovado', decidedBy: by });
  invalidate(r.officeId, 'helpers');
  const spec = buildCommand(fromStored(r.command));
  logActivity(r.officeId, by, 'aprovou comando', commandLine(spec));
  const res = await runner(spec.bin, spec.args, spec.pasta);
  if (parent) {
    deliverToJob(parent.id, [
      `Comando aprovado e executado pelo Office: \`${commandLine(spec)}\` em ${spec.pasta}.`,
      res.ok ? 'Terminou sem erro. Saída:' : 'Falhou. Saída:',
      '```', res.out || '(sem saída)', '```',
    ].join('\n'), res.ok ? 'Comando executado' : 'Comando falhou', by);
  }
  return res;
}

function fromStored(raw: string | null | undefined) {
  const s = JSON.parse(raw ?? '{}') as CommandSpec;
  if (s.acao === 'git_push') return { acao: s.acao, pasta: s.pasta, remoto: s.args[2], branch: s.args[3] };
  return { acao: s.acao, pasta: s.pasta, nome: s.args[2], visibilidade: s.args[3] === '--public' ? 'publico' : 'privado' };
}
