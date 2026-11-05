import { randomBytes } from 'node:crypto';
import type { ContentPost, PostFormat, PostStatus } from '@office/shared';
import { POST_FORMATS, POST_STATUSES, needsTunning } from '@office/shared';
import { all, insert, now, one, update } from '../db.ts';
import { invalidate } from '../realtime.ts';

/**
 * Calendário de conteúdo do cliente: cada post do mês é uma peça ligada à demanda que a produz. O funcionário
 * preenche e atualiza pelo servidor MCP `office`, só dentro do cliente da tarefa; a pessoa edita pela tela.
 */
const uid = () => randomBytes(8).toString('hex');

export interface PostInput {
  id?: string;
  date?: string;
  format?: PostFormat;
  theme?: string;
  caption?: string;
  notes?: string;
  number?: number | null;
  status?: PostStatus;
  tunning?: 'feito' | 'dispensado' | null;
  files?: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Arte só passa de conferência para frente com tunning feito ou dispensado de propósito: o tunning é parte do design. */
export function checkPost(p: Pick<ContentPost, 'format' | 'status' | 'tunning'>) {
  const ahead = POST_STATUSES.indexOf(p.status) > POST_STATUSES.indexOf('conferencia');
  if (ahead && needsTunning(p.format) && !p.tunning) return 'Falta o tunning desta peça (ou marque que ela fica sem tunning).';
  return null;
}

function clean(i: PostInput) {
  const out: Partial<ContentPost> = {};
  if (i.date !== undefined) { if (!DATE.test(i.date)) throw new Error(`Data inválida: ${i.date} (use AAAA-MM-DD).`); out.date = i.date; }
  if (i.format !== undefined) { if (!POST_FORMATS.includes(i.format)) throw new Error(`Formato inválido: ${i.format}.`); out.format = i.format; }
  if (i.status !== undefined) { if (!POST_STATUSES.includes(i.status)) throw new Error(`Etapa inválida: ${i.status}.`); out.status = i.status; }
  if (i.theme !== undefined) out.theme = String(i.theme).trim().slice(0, 200);
  if (i.caption !== undefined) out.caption = String(i.caption).slice(0, 2200);
  if (i.notes !== undefined) out.notes = String(i.notes).slice(0, 2000);
  if (i.number !== undefined) out.number = i.number === null ? null : Math.max(0, Math.min(999, Math.round(Number(i.number))));
  if (i.tunning !== undefined) { if (i.tunning !== null && !['feito', 'dispensado'].includes(i.tunning)) throw new Error('tunning deve ser "feito" ou "dispensado".'); out.tunning = i.tunning; }
  if (i.files !== undefined) out.files = (i.files ?? []).map(String).slice(0, 40);
  return out;
}

export const postsOf = (officeId: string, clientId?: string | null, month?: string) =>
  all<ContentPost>(
    `SELECT * FROM content_posts WHERE office_id = ?${clientId ? ' AND client_id = ?' : ''}${month ? ' AND substr(date,1,7) = ?' : ''} ORDER BY date, number, theme`,
    ...([officeId, clientId, month].filter(Boolean) as string[]),
  );

/** Cria ou atualiza posts do calendário de um cliente. Um post de outro cliente nunca é alcançado. */
export function savePosts(officeId: string, clientId: string, demandId: string | null, items: PostInput[], by: string) {
  if (items.length > 60) throw new Error('No máximo 60 posts por vez.');
  const saved: ContentPost[] = [];
  for (const item of items) {
    const patch = clean(item);
    if (item.id) {
      const cur = one<ContentPost>('SELECT * FROM content_posts WHERE id = ? AND office_id = ? AND client_id = ?', item.id, officeId, clientId);
      if (!cur) throw new Error(`Post ${item.id} não é deste cliente.`);
      const next = { ...cur, ...patch };
      const err = checkPost(next);
      if (err) throw new Error(`${cur.theme}: ${err}`);
      update('content_posts', cur.id, { ...patch, demandId: cur.demandId ?? demandId, updatedAt: now(), updatedBy: by });
      saved.push({ ...next, updatedAt: now(), updatedBy: by });
    } else {
      if (!patch.date || !patch.format || !patch.theme) throw new Error('Post novo precisa de data, formato e tema.');
      const row: ContentPost = {
        id: uid(), officeId, clientId, demandId, date: patch.date, format: patch.format, theme: patch.theme,
        caption: patch.caption ?? '', notes: patch.notes ?? '', number: patch.number ?? null, status: patch.status ?? 'planejado',
        tunning: patch.tunning ?? null, files: patch.files ?? [], updatedAt: now(), updatedBy: by,
      };
      const err = checkPost(row);
      if (err) throw new Error(`${row.theme}: ${err}`);
      insert('content_posts', row as never);
      saved.push(row);
    }
  }
  if (saved.length) invalidate(officeId, 'posts');
  return saved;
}

/** Andamento do lote: quantas peças já passaram da produção, e onde está cada uma. */
export function progress(posts: Pick<ContentPost, 'status'>[]) {
  const done = posts.filter((p) => ['aprovado', 'drive', 'postado'].includes(p.status)).length;
  const by = Object.fromEntries(POST_STATUSES.map((s) => [s, posts.filter((p) => p.status === s).length]));
  return { total: posts.length, done, byStatus: by };
}
