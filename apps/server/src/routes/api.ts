import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import {
  DEMAND_COLUMNS, uid,
  type AgentJob, type AgentProfile, type CalendarEvent, type Client, type Demand, type JobMessage, type Member, type Office, type Transaction, type User,
} from '@office/shared';
import { all, db, insert, logActivity, now, one, update } from '../db.ts';
import { checkPin, createSession, hashPin, membership, requireMember, requireUser, sessionCookie } from '../auth.ts';
import { invalidate, onlineUsers } from '../realtime.ts';
import { loadTemplates } from '../agents/templates.ts';
import { cancelJob, enqueueJob, replyToJob } from '../agents/runtime.ts';
import { renderTimeline } from '../video/service.ts';
import { probe } from '@office/video-engine';

const COLORS = ['#ff5c8a', '#7c5cff', '#22c3a6', '#ffb020', '#3fa7ff', '#ff7a45', '#9be15d', '#e056fd'];
const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)];

/** Valida o corpo com zod e responde 400 com mensagem legível. */
const members = (officeId: string) =>
  all<Member>('SELECT u.id, u.name, u.color, u.created_at, m.role, m.desk FROM office_members m JOIN users u ON u.id = m.user_id WHERE m.office_id = ?', officeId);

function body<T extends z.ZodTypeAny>(schema: T, req: FastifyRequest, reply: FastifyReply): z.infer<T> | undefined {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) {
    reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return undefined;
  }
  return r.data;
}

/**
 * Funcionários já criados guardam uma cópia das permissões. Ao iniciar, somamos as ferramentas
 * novas dos modelos (ex.: office-render no app de desktop) sem apagar personalizações.
 */
export function syncAgentTools() {
  const templates = new Map(loadTemplates().map((t) => [t.slug, t]));
  for (const a of all<AgentProfile>('SELECT * FROM agents')) {
    const t = templates.get(a.slug);
    if (!t) continue;
    const merged = [...new Set([...a.allowedTools, ...t.allowedTools])];
    if (merged.length !== a.allowedTools.length) update('agents', a.id, { allowedTools: merged });
  }
}

export function seedAgents(officeId: string) {
  for (const t of loadTemplates()) {
    if (one('SELECT id FROM agents WHERE office_id = ? AND slug = ?', officeId, t.slug)) continue;
    insert('agents', { id: uid(), officeId, ...t, status: 'livre' });
  }
}

export function createOffice(name: string, rootPath: string, extraDirs: string[], ownerId: string) {
  const office: Office & { inviteCode: string } = {
    id: uid(), name, rootPath, extraDirs,
    theme: { primary: '#ff5c8a', floor: '#e9e4dc', wall: '#f6f3ee' },
    inviteCode: randomBytes(4).toString('hex').toUpperCase(),
    createdAt: now(),
  };
  insert('offices', office as never);
  db.prepare('INSERT INTO office_members (office_id, user_id, role) VALUES (?, ?, ?)').run(office.id, ownerId, 'dono');
  seedAgents(office.id);
  return office;
}

export async function api(app: FastifyInstance) {
  // ---------------- autenticação ----------------
  app.post('/api/auth/enter', async (req, reply) => {
    const b = body(z.object({ name: z.string().trim().min(2).max(40), pin: z.string().min(4).max(32).optional() }), req, reply);
    if (!b) return;
    let user = one<User & { pinHash: string | null }>('SELECT * FROM users WHERE name = ?', b.name);
    if (user) {
      if (user.pinHash && (!b.pin || !checkPin(b.pin, user.pinHash))) return reply.code(401).send({ error: 'PIN incorreto.' });
    } else {
      user = { id: uid(), name: b.name, color: pick(), createdAt: now(), pinHash: b.pin ? hashPin(b.pin) : null };
      insert('users', user as never);
    }
    const { pinHash: _, ...pub } = user;
    const token = createSession(user.id);
    reply.header('Set-Cookie', sessionCookie(token));
    return { token, user: pub };
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireUser);

    r.get('/api/me', async (req, reply) => {
      // renova o cookie de sessão (usado por <video>/<img>) a partir do token da UI
      const h = req.headers.authorization;
      if (h?.startsWith('Bearer ')) reply.header('Set-Cookie', sessionCookie(h.slice(7)));
      return {
        user: req.user,
        offices: all<Office & { role: string; inviteCode: string }>(
          'SELECT o.*, m.role FROM offices o JOIN office_members m ON m.office_id = o.id WHERE m.user_id = ? ORDER BY o.created_at',
          req.user.id,
        ),
      };
    });

    // ---------------- navegador de pastas da máquina ----------------
    // Só para quem está no próprio computador do servidor: na LAN isso exporia o disco inteiro.
    r.get('/api/system/browse', async (req, reply) => {
      const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
      const socketIp = req.socket.remoteAddress ?? '';
      // atrás do proxy do Vite (dev) a conexão vem de 127.0.0.1; o IP real chega no X-Forwarded-For
      const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      const ip = LOOPBACK.includes(socketIp) && fwd ? fwd : socketIp;
      if (!LOOPBACK.includes(ip))
        return reply.code(403).send({ error: 'Por segurança, só dá para navegar pelas pastas no computador que roda o Office.' });
      const q = (req.query as { path?: string }).path;
      const places = [
        { name: 'Início', path: homedir() },
        { name: 'Documentos', path: path.join(homedir(), 'Documents') },
        { name: 'Área de trabalho', path: path.join(homedir(), 'Desktop') },
        ...(process.platform === 'win32'
          ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => existsSync(d)).map((d) => ({ name: `Disco ${d.slice(0, 2)}`, path: d }))
          : [{ name: 'Raiz', path: '/' }]),
      ].filter((p) => existsSync(p.path));
      const dir = path.resolve(q || homedir());
      let entries: { name: string; path: string; dir: boolean }[] = [];
      try {
        entries = readdirSync(dir, { withFileTypes: true })
          .filter((e) => !e.name.startsWith('.') && !e.name.startsWith('$') && e.isDirectory())
          .map((e) => ({ name: e.name, path: path.join(dir, e.name), dir: true }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      } catch (e) {
        return reply.code(400).send({ error: `Não consegui abrir ${dir}: ${(e as Error).message}` });
      }
      const parent = path.dirname(dir);
      return { path: dir, parent: parent !== dir ? parent : null, places, entries };
    });

    // ---------------- escritórios ----------------
    r.post('/api/offices', async (req, reply) => {
      const b = body(z.object({ name: z.string().trim().min(2), rootPath: z.string().min(2), extraDirs: z.array(z.string()).default([]) }), req, reply);
      if (!b) return;
      if (!existsSync(b.rootPath) || !statSync(b.rootPath).isDirectory()) return reply.code(400).send({ error: `A pasta ${b.rootPath} não existe.` });
      return createOffice(b.name, path.resolve(b.rootPath), b.extraDirs, req.user.id);
    });

    r.post('/api/offices/join', async (req, reply) => {
      const b = body(z.object({ code: z.string().trim().toUpperCase() }), req, reply);
      if (!b) return;
      const office = one<Office>('SELECT * FROM offices WHERE invite_code = ?', b.code);
      if (!office) return reply.code(404).send({ error: 'Código de convite inválido.' });
      if (!membership(office.id, req.user.id))
        db.prepare('INSERT INTO office_members (office_id, user_id, role) VALUES (?, ?, ?)').run(office.id, req.user.id, 'membro');
      logActivity(office.id, `user:${req.user.id}`, 'entrou no escritório');
      return office;
    });

    r.get('/api/offices/:officeId', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const { officeId } = req.params as { officeId: string };
      return {
        office: one<Office>('SELECT * FROM offices WHERE id = ?', officeId),
        members: members(officeId),
        online: onlineUsers(officeId).map((p) => p.userId),
      };
    });

    r.get('/api/offices/:officeId/members', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      return members((req.params as { officeId: string }).officeId);
    });

    // escolher (ou liberar, com null) a própria mesa
    r.put('/api/offices/:officeId/desk', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const { officeId } = req.params as { officeId: string };
      const b = body(z.object({ desk: z.string().regex(/^[a-z0-9-]{1,32}$/).nullable() }), req, reply);
      if (!b) return;
      if (b.desk) {
        const owner = one<{ id: string; name: string }>(
          'SELECT u.id, u.name FROM office_members m JOIN users u ON u.id = m.user_id WHERE m.office_id = ? AND m.desk = ?', officeId, b.desk);
        if (owner && owner.id !== req.user.id) return reply.code(409).send({ error: `Essa mesa já é de ${owner.name}.` });
      }
      db.prepare('UPDATE office_members SET desk = ? WHERE office_id = ? AND user_id = ?').run(b.desk, officeId, req.user.id);
      invalidate(officeId, 'members');
      return { ok: true };
    });

    r.patch('/api/offices/:officeId', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const b = body(z.object({ name: z.string().min(2).optional(), rootPath: z.string().optional(), extraDirs: z.array(z.string()).optional(), theme: z.any().optional() }), req, reply);
      if (!b) return;
      for (const dir of [b.rootPath, ...(b.extraDirs ?? [])].filter(Boolean) as string[])
        if (!existsSync(dir) || !statSync(dir).isDirectory()) return reply.code(400).send({ error: `A pasta ${dir} não existe.` });
      update('offices', (req.params as any).officeId, b);
      return { ok: true };
    });

    // CRUD genérico das coleções do escritório
    const collection = <T extends { id: string }>(
      name: string, table: string, schema: z.ZodObject<z.ZodRawShape>, order: string,
      what: 'demands' | 'events' | 'transactions' | 'clients', defaults: (b: any) => Partial<T> = () => ({}),
    ) => {
      r.get(`/api/offices/:officeId/${name}`, async (req, reply) => {
        if (!requireMember(req, reply)) return;
        return all<T>(`SELECT * FROM ${table} WHERE office_id = ? ORDER BY ${order}`, (req.params as any).officeId);
      });
      r.post(`/api/offices/:officeId/${name}`, async (req, reply) => {
        if (!requireMember(req, reply)) return;
        const b = body(schema, req, reply);
        if (!b) return;
        const officeId = (req.params as any).officeId;
        const row = { id: uid(), officeId, ...defaults(b), ...b };
        insert(table, row);
        logActivity(officeId, `user:${req.user.id}`, `criou ${name}`, String((b as any).title ?? (b as any).name ?? (b as any).description ?? ''));
        invalidate(officeId, what);
        return row;
      });
      r.patch(`/api/offices/:officeId/${name}/:id`, async (req, reply) => {
        if (!requireMember(req, reply)) return;
        const b = body(schema.partial(), req, reply);
        if (!b) return;
        const { officeId, id } = req.params as any;
        if (!one(`SELECT id FROM ${table} WHERE id = ? AND office_id = ?`, id, officeId)) return reply.code(404).send({ error: 'Não encontrado' });
        update(table, id, table === 'demands' ? { ...b, updatedAt: now() } : b);
        invalidate(officeId, what);
        return one<T>(`SELECT * FROM ${table} WHERE id = ?`, id);
      });
      r.delete(`/api/offices/:officeId/${name}/:id`, async (req, reply) => {
        if (!requireMember(req, reply)) return;
        const { officeId, id } = req.params as any;
        db.prepare(`DELETE FROM ${table} WHERE id = ? AND office_id = ?`).run(id, officeId);
        logActivity(officeId, `user:${req.user.id}`, `removeu ${name}`, id);
        invalidate(officeId, what);
        return { ok: true };
      });
    };

    collection<Client>('clients', 'clients', z.object({
      name: z.string().min(1), folder: z.string().nullable().optional(), monthlyFee: z.number().min(0).default(0),
      status: z.enum(['ativo', 'pausado', 'encerrado']).default('ativo'), color: z.string().optional(),
    }), 'name', 'clients', (b) => ({ color: b.color ?? pick() }));

    collection<Demand>('demands', 'demands', z.object({
      title: z.string().min(1), description: z.string().default(''), clientId: z.string().nullable().optional(),
      kind: z.enum(['video', 'design', 'copy', 'estrategia', 'foto', 'outro']).default('outro'),
      status: z.enum(DEMAND_COLUMNS).default('backlog'), priority: z.enum(['baixa', 'media', 'alta', 'urgente']).default('media'),
      assignee: z.string().nullable().optional(), dueDate: z.string().nullable().optional(), position: z.number().optional(),
    }), 'status, position, created_at', 'demands', () => ({ createdAt: now(), updatedAt: now(), position: Date.now() }));

    collection<CalendarEvent>('events', 'events', z.object({
      title: z.string().min(1), start: z.string(), end: z.string(),
      kind: z.enum(['reuniao', 'gravacao', 'entrega', 'pessoal', 'outro']).default('reuniao'),
      clientId: z.string().nullable().optional(), demandId: z.string().nullable().optional(), room: z.string().nullable().optional(),
    }), 'start', 'events');

    collection<Transaction>('transactions', 'transactions', z.object({
      kind: z.enum(['receita', 'despesa']), category: z.string().min(1), description: z.string().default(''),
      amount: z.number().positive(), date: z.string(), paid: z.boolean().default(false), clientId: z.string().nullable().optional(),
    }), 'date DESC', 'transactions');

    // cronômetro da demanda
    r.post('/api/offices/:officeId/demands/:id/timer', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const { officeId, id } = req.params as any;
      const d = one<Demand>('SELECT * FROM demands WHERE id = ? AND office_id = ?', id, officeId);
      if (!d) return reply.code(404).send({ error: 'Demanda não encontrada' });
      if (d.timerStartedAt) {
        const add = Math.round((Date.now() - Date.parse(d.timerStartedAt)) / 1000);
        update('demands', id, { trackedSeconds: d.trackedSeconds + add, timerStartedAt: null, updatedAt: now() });
      } else {
        update('demands', id, { timerStartedAt: now(), updatedAt: now() });
      }
      invalidate(officeId, 'demands');
      return one<Demand>('SELECT * FROM demands WHERE id = ?', id);
    });

    // ---------------- métricas e financeiro (o "contador") ----------------
    r.get('/api/offices/:officeId/metrics', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const { officeId } = req.params as any;
      const month = new Date().toISOString().slice(0, 7);
      const today = new Date().toISOString().slice(0, 10);
      const sum = (sql: string, ...p: string[]) => (db.prepare(sql).get(officeId, ...p) as { v: number | null }).v ?? 0;
      const byStatus = Object.fromEntries(DEMAND_COLUMNS.map((s) => [s, 0]));
      for (const row of db.prepare('SELECT status, COUNT(*) AS n FROM demands WHERE office_id = ? GROUP BY status').all(officeId) as any[]) byStatus[row.status] = row.n;
      const receita = sum("SELECT SUM(amount) v FROM transactions WHERE office_id = ? AND kind = 'receita' AND substr(date,1,7) = ?", month);
      const despesa = sum("SELECT SUM(amount) v FROM transactions WHERE office_id = ? AND kind = 'despesa' AND substr(date,1,7) = ?", month);
      return {
        month,
        demandsByStatus: byStatus,
        overdue: sum("SELECT COUNT(*) v FROM demands WHERE office_id = ? AND status != 'entregue' AND due_date IS NOT NULL AND due_date < ?", today),
        deliveredThisMonth: sum("SELECT COUNT(*) v FROM demands WHERE office_id = ? AND status = 'entregue' AND substr(updated_at,1,7) = ?", month),
        mrr: sum("SELECT SUM(monthly_fee) v FROM clients WHERE office_id = ? AND status = 'ativo'"),
        activeClients: sum("SELECT COUNT(*) v FROM clients WHERE office_id = ? AND status = 'ativo'"),
        revenueMonth: receita,
        expenseMonth: despesa,
        profitMonth: receita - despesa,
        receivablePending: sum("SELECT SUM(amount) v FROM transactions WHERE office_id = ? AND kind = 'receita' AND paid = 0"),
        aiCostMonth: sum("SELECT SUM(cost_usd) v FROM jobs WHERE office_id = ? AND substr(created_at,1,7) = ?", month),
        hoursByClient: db.prepare(
          `SELECT COALESCE(c.name, 'Sem cliente') AS client, ROUND(SUM(d.tracked_seconds) / 3600.0, 1) AS hours
           FROM demands d LEFT JOIN clients c ON c.id = d.client_id WHERE d.office_id = ? GROUP BY client ORDER BY hours DESC`,
        ).all(officeId),
        cashflow: db.prepare(
          `SELECT substr(date,1,7) AS month,
                  SUM(CASE WHEN kind='receita' THEN amount ELSE 0 END) AS receita,
                  SUM(CASE WHEN kind='despesa' THEN amount ELSE 0 END) AS despesa
           FROM transactions WHERE office_id = ? GROUP BY month ORDER BY month DESC LIMIT 6`,
        ).all(officeId),
      };
    });

    r.get('/api/offices/:officeId/activity', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      return db.prepare('SELECT * FROM activity WHERE office_id = ? ORDER BY id DESC LIMIT 60').all((req.params as any).officeId);
    });

    // ---------------- funcionários de IA ----------------
    r.get('/api/offices/:officeId/agents', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      return all<AgentProfile>('SELECT * FROM agents WHERE office_id = ? ORDER BY name', (req.params as any).officeId);
    });

    r.patch('/api/offices/:officeId/agents/:id', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const b = body(z.object({ name: z.string().optional(), role: z.string().optional(), persona: z.string().optional(), color: z.string().optional(), allowedTools: z.array(z.string()).optional(), skills: z.array(z.string()).optional() }), req, reply);
      if (!b) return;
      const { officeId, id } = req.params as any;
      update('agents', id, b);
      invalidate(officeId, 'agents');
      return { ok: true };
    });

    r.get('/api/offices/:officeId/jobs', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      return all<AgentJob>('SELECT * FROM jobs WHERE office_id = ? ORDER BY created_at DESC LIMIT 100', (req.params as any).officeId);
    });

    r.get('/api/offices/:officeId/jobs/:id/messages', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      return all<JobMessage>('SELECT * FROM job_messages WHERE job_id = ? ORDER BY created_at, rowid', (req.params as any).id);
    });

    r.post('/api/offices/:officeId/jobs', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const b = body(z.object({ agentId: z.string(), prompt: z.string().min(1), demandId: z.string().nullable().optional() }), req, reply);
      if (!b) return;
      const { officeId } = req.params as any;
      const agent = one<AgentProfile>('SELECT * FROM agents WHERE id = ? AND office_id = ?', b.agentId, officeId);
      if (!agent) return reply.code(404).send({ error: 'Funcionário não encontrado' });
      let prompt = b.prompt;
      if (b.demandId) {
        const d = one<Demand>('SELECT * FROM demands WHERE id = ?', b.demandId);
        const c = d?.clientId ? one<Client>('SELECT * FROM clients WHERE id = ?', d.clientId) : undefined;
        if (d) {
          prompt = `## Demanda: ${d.title}\nCliente: ${c?.name ?? '—'}${c?.folder ? ` (pasta: ${c.folder})` : ''}\nTipo: ${d.kind} · Prioridade: ${d.priority} · Prazo: ${d.dueDate ?? '—'}\n\n${d.description}\n\n## Pedido\n${b.prompt}`;
          update('demands', d.id, { status: 'em_producao', assignee: `agent:${agent.id}`, updatedAt: now() });
          invalidate(officeId, 'demands');
        }
      }
      if (agent.slug === 'gerente') {
        // o gerente recebe o retrato do escritório para trabalhar com números reais
        const snapshot = {
          clientes: all('SELECT id, name, monthly_fee, status FROM clients WHERE office_id = ?', officeId),
          demandas: all('SELECT id, title, client_id, kind, status, priority, assignee, due_date, tracked_seconds FROM demands WHERE office_id = ?', officeId),
          financeiro_90d: all("SELECT kind, category, amount, date, paid, client_id FROM transactions WHERE office_id = ? AND date >= date('now','-90 day')", officeId),
          funcionarios: all('SELECT id, name, role, status FROM agents WHERE office_id = ?', officeId),
          agenda_14d: all("SELECT title, start, kind FROM events WHERE office_id = ? AND start BETWEEN date('now') AND date('now','+14 day')", officeId),
        };
        prompt += `\n\n## Dados do escritório (JSON)\n\`\`\`json\n${JSON.stringify(snapshot)}\n\`\`\``;
      }
      return enqueueJob({ officeId, agentId: agent.id, demandId: b.demandId ?? null, prompt, createdBy: req.user.id });
    });

    r.post('/api/offices/:officeId/jobs/:id/reply', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const b = body(z.object({ text: z.string().min(1) }), req, reply);
      if (!b) return;
      try {
        replyToJob((req.params as any).id, b.text);
        return { ok: true };
      } catch (e) {
        return reply.code(409).send({ error: (e as Error).message });
      }
    });

    r.post('/api/offices/:officeId/jobs/:id/cancel', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      cancelJob((req.params as any).id);
      return { ok: true };
    });

    // ---------------- engine de vídeo ----------------
    r.get('/api/offices/:officeId/timelines', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      return all('SELECT id, name, demand_id, base_dir, output, render_status, updated_at FROM timelines WHERE office_id = ? ORDER BY updated_at DESC', (req.params as any).officeId);
    });

    r.get('/api/offices/:officeId/timelines/:id', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      return one('SELECT * FROM timelines WHERE id = ? AND office_id = ?', (req.params as any).id, (req.params as any).officeId) ?? reply.code(404).send({ error: 'Timeline não encontrada' });
    });

    r.post('/api/offices/:officeId/timelines', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const b = body(z.object({ name: z.string().min(1), baseDir: z.string(), json: z.any(), demandId: z.string().nullable().optional() }), req, reply);
      if (!b) return;
      const { officeId } = req.params as any;
      const row = { id: uid(), officeId, name: b.name, baseDir: b.baseDir, json: b.json ?? { video: [] }, demandId: b.demandId ?? null, updatedAt: now() };
      insert('timelines', row);
      invalidate(officeId, 'timelines');
      return row;
    });

    r.put('/api/offices/:officeId/timelines/:id', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const b = body(z.object({ name: z.string().optional(), json: z.any(), baseDir: z.string().optional() }), req, reply);
      if (!b) return;
      update('timelines', (req.params as any).id, { ...b, updatedAt: now() });
      invalidate((req.params as any).officeId, 'timelines');
      return { ok: true };
    });

    // importa um timeline.json escrito por um funcionário de IA (ou pelo editor) para editar na UI
    r.post('/api/offices/:officeId/timelines/import', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const b = body(z.object({ path: z.string() }), req, reply);
      if (!b) return;
      const { officeId } = req.params as any;
      if (!inside(officeId, b.path) || !existsSync(b.path)) return reply.code(404).send({ error: 'Arquivo não encontrado nas pastas do escritório' });
      let json: any;
      try { json = JSON.parse(readFileSync(b.path, 'utf8')); } catch { return reply.code(400).send({ error: 'JSON inválido' }); }
      const row = { id: uid(), officeId, name: json.name ?? path.basename(b.path, '.json'), baseDir: path.dirname(b.path), json, demandId: null, updatedAt: now() };
      insert('timelines', row);
      invalidate(officeId, 'timelines');
      return row;
    });

    r.get('/api/offices/:officeId/probe', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const file = path.resolve((req.query as any).path ?? '');
      if (!inside((req.params as any).officeId, file)) return reply.code(403).send({ error: 'Fora das pastas do escritório' });
      try { return await probe(file); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
    });

    r.post('/api/offices/:officeId/timelines/:id/render', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const { officeId, id } = req.params as any;
      try {
        return renderTimeline(officeId, id);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    });

    // ---------------- arquivos (só dentro das pastas do escritório) ----------------
    const allowedRoots = (officeId: string) => {
      const o = one<Office>('SELECT * FROM offices WHERE id = ?', officeId)!;
      return [o.rootPath, ...o.extraDirs].map((p) => path.resolve(p).toLowerCase());
    };
    const inside = (officeId: string, p: string) => {
      const abs = path.resolve(p).toLowerCase();
      return allowedRoots(officeId).some((root) => abs === root || abs.startsWith(root + path.sep));
    };

    r.get('/api/offices/:officeId/fs', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const { officeId } = req.params as any;
      const office = one<Office>('SELECT * FROM offices WHERE id = ?', officeId)!;
      const dir = path.resolve((req.query as any).path || office.rootPath);
      if (!inside(officeId, dir)) return reply.code(403).send({ error: 'Fora das pastas do escritório' });
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, dir: e.isDirectory(), path: path.join(dir, e.name) }))
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return { path: dir, parent: inside(officeId, path.dirname(dir)) ? path.dirname(dir) : null, roots: [office.rootPath, ...office.extraDirs], entries };
    });

    r.get('/api/offices/:officeId/media', async (req, reply) => {
      if (!requireMember(req, reply)) return;
      const file = path.resolve((req.query as any).path ?? '');
      if (!inside((req.params as any).officeId, file) || !existsSync(file)) return reply.code(404).send({ error: 'Arquivo não encontrado' });
      const size = statSync(file).size;
      const ext = path.extname(file).toLowerCase();
      const type = ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[ext] ?? 'application/octet-stream';
      // suporte a Range para o <video> conseguir pular no tempo
      const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        reply.code(206).headers({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type });
        return reply.send(createReadStream(file, { start, end }));
      }
      reply.headers({ 'Content-Length': size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
      return reply.send(createReadStream(file));
    });
  });
}
