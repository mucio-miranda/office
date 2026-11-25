import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Client, Office } from '@office/shared';
import { requireMember, requireWorker } from '../auth.ts';
import { all, db, one } from '../db.ts';
import { clientDir } from '../clients/folder.ts';
import { briefingText } from '../agents/pipeline.ts';
import { codexExecutable, codexTurn, consultationPrompt } from '../agents/codex.ts';

export function registerCodex(app: FastifyInstance) {
  const base = '/api/offices/:officeId/clients/:id/codex';
  const busy = new Set<string>();
  const ids = (params: unknown) => params as { officeId: string; id: string; sid: string };
  const client = (p: ReturnType<typeof ids>) => one<Client>('SELECT * FROM clients WHERE office_id=? AND id=?', p.officeId, p.id);
  const available = (officeId: string) => {
    const office = one<Office>('SELECT * FROM offices WHERE id=?', officeId);
    return !!office && existsSync(path.join(office.rootPath, '.claude', 'skills')) && !!codexExecutable();
  };
  app.get(base, async (req, reply) => {
    if (!requireMember(req, reply)) return;
    const p = ids(req.params);
    if (!client(p)) return reply.code(404).send({ error: 'Cliente não encontrado' });
    return { enabled: available(p.officeId), sessions: all('SELECT id,title FROM codex_sessions WHERE client_id=? ORDER BY rowid DESC', p.id) };
  });
  const session = (p: ReturnType<typeof ids>) => one<{ thread: string | null; contextDigest: string | null }>(
    'SELECT s.thread,s.context_digest FROM codex_sessions s JOIN clients c ON c.id=s.client_id WHERE s.id=? AND c.id=? AND c.office_id=?', p.sid, p.id, p.officeId);
  app.post(base, async (req, reply) => {
    if (!requireWorker(req, reply)) return;
    const p = ids(req.params);
    if (!client(p)) return reply.code(404).send({ error: 'Cliente não encontrado' });
    if (!available(p.officeId)) return reply.code(409).send({ error: 'Confira a instalação do Codex CLI e a pasta de skills do escritório.' });
    const b = z.object({ title: z.string().trim().max(60) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Nome de sessão inválido' });
    const id = randomUUID(), title = b.data.title || 'Consulta GPT';
    db.prepare('INSERT INTO codex_sessions(id,client_id,title) VALUES(?,?,?)').run(id, p.id, title);
    return { id, title };
  });
  app.get(base + '/:sid', async (req, reply) => {
    if (!requireMember(req, reply)) return;
    const p = ids(req.params);
    if (!session(p)) return reply.code(404).send({ error: 'Sessão não encontrada' });
    return all('SELECT seq,prompt,answer FROM codex_turns WHERE session_id=? ORDER BY seq', p.sid);
  });
  app.post(base + '/:sid', async (req, reply) => {
    if (!requireWorker(req, reply)) return;
    const p = ids(req.params), s = session(p);
    if (!s) return reply.code(404).send({ error: 'Sessão não encontrada' });
    const b = z.object({ text: z.string().trim().min(1).max(16000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Mensagem inválida' });
    if (busy.has(p.sid)) return reply.code(409).send({ error: 'Aguarde a resposta desta sessão.' });
    const c = client(p)!;
    const office = one<Office>('SELECT * FROM offices WHERE id=?', p.officeId)!;
    const cwd = clientDir(office, c);
    if (!cwd || !existsSync(cwd)) return reply.code(409).send({ error: 'A pasta do cliente precisa estar disponível.' });
    busy.add(p.sid);
    try {
      const { prompt, digest } = consultationPrompt(office.rootPath, cwd, briefingText(c.briefing), b.data.text, s.contextDigest);
      const result = await codexTurn(cwd, path.join(office.rootPath, '.claude', 'skills'), s.thread, prompt);
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE codex_sessions SET thread=?,context_digest=? WHERE id=?').run(result.thread, digest, p.sid);
        db.prepare('INSERT INTO codex_turns(session_id,prompt,answer) VALUES(?,?,?)').run(p.sid, b.data.text, result.text);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { ok: true };
    } catch (error) {
      return reply.code(422).send({ error: (error as Error).message });
    } finally { busy.delete(p.sid); }
  });
}
