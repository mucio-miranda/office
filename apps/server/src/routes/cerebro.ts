import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { uid } from '@office/shared';
import { isLocal, requireMember, requireWorker } from '../auth.ts';
import { all, db, now, one } from '../db.ts';
import { DESTINOS, STATUSES, decide, groupOf, looksLikeVault, readNote, restoreNotes, scanVault, trashNotes, vaultFile } from '../cerebro/vault.ts';

/**
 * Página Cérebro: cada escritório liga uma ou mais pastas de notas (cofres do Obsidian). Ligar uma pasta só pode ser feito
 * no computador que roda o Office, porque é ele que enxerga o disco; quem estiver na rede só lê o que já foi ligado.
 */
interface Cerebro { id: string; officeId: string; name: string; path: string; createdAt: string }

const IMG_TYPE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export function registerCerebro(app: FastifyInstance) {
  const base = '/api/offices/:officeId/cerebros';
  const params = (req: FastifyRequest) => req.params as { officeId: string; id: string };
  const find = (req: FastifyRequest, reply: FastifyReply) => {
    const p = params(req);
    const c = one<Cerebro>('SELECT * FROM cerebros WHERE id = ? AND office_id = ?', p.id, p.officeId);
    if (!c) { reply.code(404).send({ error: 'Cérebro não encontrado.' }); return null; }
    return c;
  };

  app.get(base, async (req, reply) => {
    if (!requireMember(req, reply)) return;
    return all<Cerebro>('SELECT * FROM cerebros WHERE office_id = ? ORDER BY created_at', params(req).officeId);
  });

  app.post(base, async (req, reply) => {
    if (!requireWorker(req, reply)) return;
    if (!isLocal(req)) return reply.code(403).send({ error: 'Por segurança, a pasta do cérebro só se escolhe no computador que roda o Office.' });
    const b = z.object({ path: z.string().min(2).max(1000), name: z.string().trim().max(60).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Escolha uma pasta.' });
    const dir = path.resolve(b.data.path);
    if (!looksLikeVault(dir)) return reply.code(400).send({ error: 'Essa pasta não tem notas .md. Escolha a pasta do cofre (a que tem a pasta .obsidian).' });
    const { officeId } = params(req);
    const dup = all<Cerebro>('SELECT * FROM cerebros WHERE office_id = ?', officeId).find((c) => c.path.toLowerCase() === dir.toLowerCase());
    if (dup) return dup;
    const row: Cerebro = { id: uid(), officeId, name: b.data.name || path.basename(dir), path: dir, createdAt: now() };
    db.prepare('INSERT INTO cerebros (id, office_id, name, path, created_at) VALUES (?, ?, ?, ?, ?)').run(row.id, row.officeId, row.name, row.path, row.createdAt);
    return row;
  });

  app.patch(`${base}/:id`, async (req, reply) => {
    if (!requireWorker(req, reply)) return;
    const c = find(req, reply);
    if (!c) return;
    const b = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Nome inválido.' });
    db.prepare('UPDATE cerebros SET name = ? WHERE id = ?').run(b.data.name, c.id);
    return { ...c, name: b.data.name };
  });

  // desligar só tira o cérebro do Office: a pasta e as notas ficam como estão
  app.delete(`${base}/:id`, async (req, reply) => {
    if (!requireWorker(req, reply)) return;
    const c = find(req, reply);
    if (!c) return;
    db.prepare('DELETE FROM cerebros WHERE id = ?').run(c.id);
    return { ok: true };
  });

  app.get(`${base}/:id/indice`, async (req, reply) => {
    if (!requireMember(req, reply)) return;
    const c = find(req, reply);
    if (!c) return;
    if (!looksLikeVault(c.path)) return reply.code(409).send({ error: `Não encontrei a pasta ${c.path}. Se ela mudou de lugar, desligue e ligue de novo.` });
    const v = await scanVault(c.path);
    return {
      cerebro: c, groups: v.groups, statuses: STATUSES, destinos: DESTINOS,
      notes: v.notes.map((n) => ({ ...n, group: groupOf(n, v.groups) })),
    };
  });

  app.get(`${base}/:id/nota`, async (req, reply) => {
    if (!requireMember(req, reply)) return;
    const c = find(req, reply);
    if (!c) return;
    const note = await readNote(c.path, String((req.query as { id?: string }).id ?? ''));
    if (!note) return reply.code(404).send({ error: 'Nota não encontrada.' });
    return note;
  });

  app.post(`${base}/:id/decidir`, async (req, reply) => {
    if (!requireWorker(req, reply)) return;
    const c = find(req, reply);
    if (!c) return;
    const b = z.object({
      ids: z.array(z.string().min(1)).min(1).max(200),
      status: z.enum(STATUSES).optional(), destino: z.enum(DESTINOS).optional(),
    }).safeParse(req.body);
    if (!b.success || (!b.data.status && !b.data.destino)) return reply.code(400).send({ error: 'Diga o status ou o destino.' });
    try {
      const notes = [];
      for (const id of b.data.ids) notes.push(await decide(c.path, id, { status: b.data.status, destino: b.data.destino }));
      return { notes };
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // remover do cérebro: vai para _apagados dentro do cofre (não apaga); "restaurar" desfaz
  app.post(`${base}/:id/remover`, async (req, reply) => {
    if (!requireWorker(req, reply)) return;
    const c = find(req, reply);
    if (!c) return;
    const b = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Diga quais notas remover.' });
    try { return { moved: await trashNotes(c.path, b.data.ids) }; } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  app.post(`${base}/:id/restaurar`, async (req, reply) => {
    if (!requireWorker(req, reply)) return;
    const c = find(req, reply);
    if (!c) return;
    const b = z.object({ moved: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).min(1).max(400) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Nada para restaurar.' });
    await restoreNotes(c.path, b.data.moved);
    return { ok: true };
  });

  // imagens do cofre (capas e anexos), só de dentro da pasta ligada
  app.get(`${base}/:id/arquivo`, async (req, reply) => {
    if (!requireMember(req, reply)) return;
    const c = find(req, reply);
    if (!c) return;
    const f = vaultFile(c.path, String((req.query as { p?: string }).p ?? ''));
    const type = f ? IMG_TYPE[path.extname(f).toLowerCase()] : undefined;
    if (!f || !type) return reply.code(404).send({ error: 'Imagem não encontrada.' });
    reply.headers({ 'Content-Type': type, 'Content-Length': statSync(f).size, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    return reply.send(createReadStream(f));
  });
}
