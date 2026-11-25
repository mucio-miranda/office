import { randomBytes } from 'node:crypto';
import { MAX_WORKERS, type AgentJob, type Client, type HelperRequest, type Worker } from '@office/shared';
import { all, insert, logActivity, now, one, update } from '../db.ts';
import { broadcast, invalidate } from '../realtime.ts';
import { deliverToJob, enqueueJob } from './runtime.ts';
import { activeWorkers, archiveWorker, createWorker, titularOf } from './workers.ts';

/**
 * Ajudante: um funcionário pede, com o motivo, outra sessão para fazer uma tarefa em paralelo. Nada começa sem uma pessoa
 * aprovar. O ajudante é do mesmo cliente, trabalha em sessão própria, devolve o resultado na conversa de quem pediu e é
 * arquivado quando termina.
 */

const uid = () => randomBytes(8).toString('hex');
/** Ajudantes ao mesmo tempo num cliente. */
export const MAX_HELPERS_PER_CLIENT = 2;

export function requestHelper(job: AgentJob, task: string, reason: string) {
  if (!job.clientId || !job.workerId) throw new Error('Só o funcionário de um cliente pode pedir ajudante.');
  const asker = one<Worker>('SELECT * FROM workers WHERE id = ?', job.workerId);
  if (!asker || asker.archivedAt) throw new Error('Funcionário não encontrado.');
  if (asker.role === 'ajudante') throw new Error('Ajudante não chama outro ajudante: termine a sua tarefa e devolva a quem pediu.');
  const open = all<HelperRequest>("SELECT * FROM helper_requests WHERE client_id = ? AND status = 'pendente'", job.clientId);
  if (open.length >= 3) throw new Error('Já há pedidos de ajudante esperando aprovação neste cliente. Siga com o que der enquanto isso.');
  const r: HelperRequest = {
    id: uid(), officeId: job.officeId, clientId: job.clientId, workerId: asker.id, jobId: job.id,
    task: task.trim().slice(0, 2000), reason: reason.trim().slice(0, 600), status: 'pendente', helperId: null, createdAt: now(), decidedBy: null,
  };
  if (!r.task) throw new Error('Diga a tarefa do ajudante.');
  insert('helper_requests', r as never);
  invalidate(job.officeId, 'helpers');
  const client = one<Client>('SELECT name FROM clients WHERE id = ?', job.clientId);
  broadcast(job.officeId, { t: 'notice', text: `${asker.name} (${client?.name ?? 'cliente'}) pede um ajudante: ${r.task.slice(0, 90)}` });
  return r;
}

export function decideHelper(officeId: string, id: string, approve: boolean, by: string) {
  const r = one<HelperRequest>('SELECT * FROM helper_requests WHERE id = ? AND office_id = ?', id, officeId);
  if (!r) throw new Error('Pedido não encontrado.');
  if (r.status !== 'pendente') throw new Error('Esse pedido já foi decidido.');
  const parentJob = one<AgentJob>('SELECT * FROM jobs WHERE id = ?', r.jobId);
  if (!approve) {
    update('helper_requests', id, { status: 'recusado', decidedBy: by });
    invalidate(officeId, 'helpers');
    if (parentJob) deliverToJob(parentJob.id, `Seu pedido de ajudante ("${r.task.slice(0, 120)}") não foi aprovado. Siga você mesmo com essa parte.`, 'Pedido de ajudante recusado', by);
    return null;
  }
  if (activeWorkers(officeId).length >= MAX_WORKERS) throw new Error(`O escritório já tem ${MAX_WORKERS} funcionários ativos. Arquive alguém em Equipe antes.`);
  const helpers = all<Worker>("SELECT * FROM workers WHERE client_id = ? AND role = 'ajudante' AND archived_at IS NULL", r.clientId);
  if (helpers.length >= MAX_HELPERS_PER_CLIENT) throw new Error(`Este cliente já tem ${MAX_HELPERS_PER_CLIENT} ajudantes trabalhando. Espere um terminar.`);
  const asker = one<Worker>('SELECT * FROM workers WHERE id = ?', r.workerId);
  const client = one<Client>('SELECT * FROM clients WHERE id = ?', r.clientId)!;
  const helper = createWorker(officeId, r.clientId, 'ajudante', by, r.workerId, asker?.provider);
  update('helper_requests', id, { status: 'aprovado', helperId: helper.id, decidedBy: by });
  const prompt = [
    `## Tarefa de ajudante (${client.name})`,
    '',
    `Você é ${helper.name}, funcionário de IA da casa, ajudando ${asker?.name ?? 'o titular'} no cliente ${client.name}, que pediu:`,
    '',
    r.task,
    '',
    r.reason ? `Motivo: ${r.reason}` : '',
    '',
    'Faça só esta tarefa, na pasta do cliente, seguindo as skills da casa. Não abra outras frentes nem peça outro ajudante.',
    `No fim, responda com um resumo curto do que fez e os caminhos completos dos arquivos: esse resumo vai para ${asker?.name ?? 'o titular'}.`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  enqueueJob({
    officeId, agentId: parentJob?.agentId ?? one<{ id: string }>('SELECT id FROM agents WHERE office_id = ? ORDER BY name LIMIT 1', officeId)!.id,
    demandId: null, clientId: r.clientId, workerId: helper.id, stage: parentJob?.stage ?? undefined, cwd: parentJob?.cwd ?? null,
    prompt, display: `Ajudante de ${asker?.name ?? 'titular'}: ${r.task.slice(0, 160)}`, createdBy: by,
  });
  logActivity(officeId, by, 'aprovou ajudante', `${helper.name} para ${client.name}`);
  invalidate(officeId, 'helpers');
  return helper;
}

/** O ajudante terminou: o resumo vai para a conversa de quem pediu (ou do titular atual) e ele é arquivado. */
export function handoffHelper(job: AgentJob, finalText: string, ok: boolean) {
  const helper = job.workerId ? one<Worker>('SELECT * FROM workers WHERE id = ?', job.workerId) : undefined;
  if (!helper || helper.role !== 'ajudante') return false;
  const asker = helper.parentId ? one<Worker>('SELECT * FROM workers WHERE id = ?', helper.parentId) : undefined;
  const target = asker && !asker.archivedAt ? asker : titularOf(helper.officeId, helper.clientId);
  const targetJob = target && one<AgentJob>('SELECT * FROM jobs WHERE worker_id = ? ORDER BY updated_at DESC LIMIT 1', target.id);
  const summary = finalText.trim().slice(0, 4000) || (ok ? '(sem resumo)' : 'A tarefa parou com erro.');
  if (targetJob) {
    deliverToJob(targetJob.id, `O ajudante ${helper.name} ${ok ? 'terminou' : 'parou com erro'}. O que ele devolveu:\n\n${summary}`, `${helper.name} (ajudante) ${ok ? 'terminou' : 'parou'}`, `agent:${helper.id}`);
  }
  archiveWorker(helper.id);
  return true;
}
