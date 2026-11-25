import { randomBytes } from 'node:crypto';
import { WORKER_NAMES, type AgentJob, type Client, type Demand, type Worker, type WorkerState } from '@office/shared';
import { all, now, one, insert, update } from '../db.ts';
import { invalidate } from '../realtime.ts';

/**
 * Funcionários de IA: cada sessão do Claude Code é um funcionário com nome, sempre de um cliente ou projeto. O titular é
 * a conversa contínua do cliente; ajudantes (com permissão) fazem uma tarefa em paralelo. O funcionário trabalha na sala
 * do tipo de trabalho, espera na copa e, arquivado, sai do escritório.
 */

const uid = () => randomBytes(8).toString('hex');
const COLORS = ['#ff5c8a', '#7c5cff', '#22c3a6', '#ffb020', '#3fa7ff', '#ff7a45', '#9b5de5', '#00b894', '#e84393', '#0984e3', '#fd9644', '#6c5ce7'];
/** Nome arquivado volta para a fila depois disto, para o histórico antigo não confundir. */
const NAME_COOLDOWN_DAYS = 30;

export const activeWorkers = (officeId: string) =>
  all<Worker>('SELECT * FROM workers WHERE office_id = ? AND archived_at IS NULL ORDER BY created_at', officeId);

export const titularOf = (officeId: string, clientId: string) =>
  one<Worker>("SELECT * FROM workers WHERE office_id = ? AND client_id = ? AND role = 'titular' AND provider = 'claude' AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1", officeId, clientId);

/** O próximo nome livre da lista: nenhum ativo com ele e nenhum arquivado há menos de 30 dias. */
export function nextName(officeId: string, when = new Date()) {
  const cutoff = new Date(when.getTime() - NAME_COOLDOWN_DAYS * 86_400_000).toISOString();
  const busy = new Set(all<{ name: string }>('SELECT name FROM workers WHERE office_id = ? AND (archived_at IS NULL OR archived_at > ?)', officeId, cutoff).map((w) => w.name));
  // os funcionários de função ficam sempre no mapa: os dos clientes não repetem o nome deles
  for (const a of all<{ name: string }>('SELECT name FROM agents WHERE office_id = ?', officeId)) busy.add(a.name);
  const free = WORKER_NAMES.find((n) => !busy.has(n));
  if (free) return free;
  // a lista acabou: o mesmo nome com número
  for (let i = 2; ; i++) {
    const n = WORKER_NAMES.find((x) => !busy.has(`${x} ${i}`));
    if (n) return `${n} ${i}`;
  }
}

const colorOf = (name: string) => COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];

export function createWorker(officeId: string, clientId: string, role: Worker['role'], by: string | null, parentId: string | null = null, provider: Worker['provider'] = 'claude') {
  const name = nextName(officeId);
  const w: Worker = { id: uid(), officeId, clientId, name, color: colorOf(name), role, parentId, provider, state: 'copa', room: 'copa', createdAt: now(), archivedAt: null };
  insert('workers', { ...w, createdBy: by } as never);
  invalidate(officeId, 'workers');
  return w;
}

/** O titular do cliente; o primeiro pedido de um cliente sem titular cria um. */
export function ensureTitular(officeId: string, clientId: string, by: string | null) {
  return titularOf(officeId, clientId) ?? createWorker(officeId, clientId, 'titular', by);
}

/** Sessões abertas do cliente (titulares não arquivados), a mais nova primeiro. */
export const sessionsOf = (clientId: string) =>
  all<Worker>("SELECT * FROM workers WHERE client_id = ? AND role = 'titular' AND archived_at IS NULL ORDER BY created_at DESC", clientId);

/** A sessão de um pedido: a escolhida na conversa, se for deste cliente e estiver aberta; senão a mais nova. */
export function sessionFor(officeId: string, clientId: string, workerId: string | null | undefined, by: string | null) {
  const w = workerId ? one<Worker>("SELECT * FROM workers WHERE id = ? AND client_id = ? AND role = 'titular' AND archived_at IS NULL", workerId, clientId) : undefined;
  return w ?? ensureTitular(officeId, clientId, by);
}

/**
 * Sessão nova do cliente, para uma demanda: começa com a conversa vazia (lê a memória do cliente) e, se pedido, com o
 * resumo de uma conversa anterior como passagem. As outras sessões continuam abertas e podem rodar junto.
 */
export function createSession(officeId: string, clientId: string, by: string | null, title?: string | null, handoff?: string | null, provider: Worker['provider'] = 'claude') {
  const w = createWorker(officeId, clientId, 'titular', by, null, provider);
  const t = title?.trim().slice(0, 60) || null;
  update('workers', w.id, { title: t, handoff: handoff ?? null });
  invalidate(officeId, 'workers');
  return { ...w, title: t, handoff: handoff ?? null };
}

export function archiveWorker(id: string) {
  const w = one<Worker>('SELECT * FROM workers WHERE id = ?', id);
  if (!w || w.archivedAt) return w ?? null;
  update('workers', id, { archivedAt: now(), state: 'copa', room: 'copa' });
  invalidate(w.officeId, 'workers');
  return { ...w, archivedAt: now() };
}

/** Sala do trabalho: a etapa ou o tipo da demanda; sem isso, a sala do modelo que a esteira escolheu. */
export function roomFor(job: Pick<AgentJob, 'stage' | 'demandId' | 'agentId'>) {
  const byStage: Record<string, string> = { arte: 'design', video: 'video', copy: 'copy', pauta: 'copy', briefing: 'copy', agendado: 'copy' };
  if (job.stage && byStage[job.stage]) return byStage[job.stage];
  const d = job.demandId ? one<Pick<Demand, 'kind'>>('SELECT kind FROM demands WHERE id = ?', job.demandId) : undefined;
  const byKind: Record<string, string> = { design: 'design', video: 'video', copy: 'copy' };
  if (d?.kind && byKind[d.kind]) return byKind[d.kind];
  return one<{ room: string }>('SELECT room FROM agents WHERE id = ?', job.agentId)?.room ?? 'design';
}

/** Depois que a tarefa muda de situação: trabalhando na sala do trabalho, esperando você ali mesmo, senão na copa. */
export function syncWorker(job: AgentJob) {
  if (!job.workerId) return;
  const w = one<Worker>('SELECT * FROM workers WHERE id = ?', job.workerId);
  if (!w || w.archivedAt) return;
  const state: WorkerState = job.status === 'rodando' ? 'trabalhando' : job.status === 'aguardando' ? 'aguardando' : 'copa';
  const room = state === 'copa' ? 'copa' : roomFor(job);
  if (state === w.state && room === w.room) return;
  update('workers', w.id, { state, room });
  invalidate(w.officeId, 'workers');
}

/**
 * Uma vez: cada cliente que já tinha conversa ganha o titular dela, com os nomes na ordem da lista (as conversas mais
 * recentes primeiro). As tarefas desses clientes passam a apontar para ele.
 */
export function migrateWorkers() {
  const clients = all<Client & { lastAt: string | null }>(
    `SELECT c.*, (SELECT MAX(j.updated_at) FROM jobs j WHERE j.client_id = c.id) AS last_at FROM clients c
     WHERE c.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workers w WHERE w.client_id = c.id) ORDER BY last_at DESC`);
  for (const c of clients) {
    const w = createWorker(c.officeId, c.id, 'titular', null);
    all<{ id: string }>("SELECT id FROM jobs WHERE client_id = ? AND worker_id IS NULL AND (stage IS NULL OR stage != 'aprovacao')", c.id)
      .forEach((j) => update('jobs', j.id, { workerId: w.id }));
  }
  return clients.length;
}
