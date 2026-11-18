import { existsSync } from 'node:fs';
import type { Client, ContentPost, Office, PostFormat } from '@office/shared';
import { all, now, one, update } from '../db.ts';
import { invalidate } from '../realtime.ts';
import { finalsOf } from '../clients/deliver.ts';
import { assignPiece, movePosted, piecesOf, undoPosted } from '../clients/month.ts';
import { postsOf } from './calendar.ts';

/**
 * Agenda de posts para a social media: o que já está pronto na pasta do mês do cliente no Drive (a fonte de verdade), o que
 * ainda está em produção no Office, o que foi agendado e o que já foi ao ar. Agendar e marcar como postado só mudam o
 * registro no Office: nenhum arquivo é movido nem renomeado.
 */

export type AgendaState = 'producao' | 'pronto' | 'agendado' | 'postado';
export interface AgendaItem {
  key: string;
  clientId: string;
  postId: string | null;
  date: string | null;
  /** HH:MM do agendamento, quando marcado. */
  time: string | null;
  format: PostFormat | null;
  theme: string;
  caption: string;
  number: number | null;
  files: string[];
  state: AgendaState;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const PRODUCED = ['aprovado', 'drive'];

const timeOf = (p?: ContentPost) => (p?.scheduledAt && TIME.test(p.scheduledAt.slice(11, 16)) ? p.scheduledAt.slice(11, 16) : null);
const stateOf = (p: ContentPost | undefined, posted: boolean, hasFiles: boolean): AgendaState => {
  if (posted || p?.status === 'postado') return 'postado';
  if (p?.status === 'programado') return 'agendado';
  if (!p || PRODUCED.includes(p.status) || hasFiles) return 'pronto';
  return 'producao';
};

export function agendaOf(office: Office, month: string, clientId?: string | null) {
  const clients = all<Client>("SELECT * FROM clients WHERE office_id = ? AND status != 'encerrado' ORDER BY name", office.id)
    .filter((c) => !clientId || c.id === clientId);
  const items: AgendaItem[] = [];
  for (const c of clients) {
    const posts = postsOf(office.id, c.id, month);
    const { pieces } = piecesOf(office, c, month);
    const linked = new Set<string>();
    for (const pc of pieces) {
      const post = pc.postId ? posts.find((p) => p.id === pc.postId) : undefined;
      if (post) linked.add(post.id);
      items.push({
        key: `${c.id}|${pc.key}`, clientId: c.id, postId: pc.postId, date: pc.date, time: timeOf(post), format: pc.format,
        theme: pc.theme, caption: post?.caption ?? '', number: pc.number ?? post?.number ?? null, files: pc.files,
        state: stateOf(post, pc.posted, true),
      });
    }
    // o que está no calendário do Office e ainda não chegou à pasta do mês (em produção, ou entregue em outro lugar)
    for (const p of posts) {
      if (linked.has(p.id) || p.status === 'cancelado') continue;
      const delivered = p.deliveries.map((d) => d.to).filter((f) => existsSync(f));
      const files = delivered.length ? delivered : finalsOf(p);
      items.push({
        key: `${c.id}|post|${p.id}`, clientId: c.id, postId: p.id, date: p.date, time: timeOf(p), format: p.format, theme: p.theme,
        caption: p.caption, number: p.number, files, state: stateOf(p, false, false) === 'pronto' && !files.length ? 'producao' : stateOf(p, false, false),
      });
    }
  }
  return items.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '99').localeCompare(b.time ?? '99') || (a.number ?? 999) - (b.number ?? 999));
}

export interface ScheduleInput {
  postId?: string | null;
  files: string[];
  theme: string;
  format?: PostFormat | null;
  date: string;
  time?: string | null;
  state: 'pronto' | 'agendado' | 'postado';
  caption?: string;
}

/**
 * Agenda, desmarca ou marca como postado. Peça da pasta sem post no Office ganha um post ligado aos arquivos dela.
 * Postado move os arquivos para POSTADOS (com o nome de postado); desfazer devolve os que o Office moveu.
 */
export function schedule(officeId: string, clientId: string, input: ScheduleInput, by: string) {
  if (!DATE.test(input.date)) throw new Error('Data inválida (use AAAA-MM-DD).');
  if (input.time && !TIME.test(input.time)) throw new Error('Horário inválido (use HH:MM).');
  let post = input.postId ? one<ContentPost>('SELECT * FROM content_posts WHERE id = ? AND office_id = ? AND client_id = ?', input.postId, officeId, clientId) : undefined;
  if (input.postId && !post) throw new Error('Post não encontrado neste cliente.');
  if (!post) {
    if (!input.files.length) throw new Error('Esta peça não tem arquivos.');
    const r = assignPiece(officeId, clientId, { files: input.files, date: input.date, format: input.format ?? null, theme: input.theme, posted: input.state === 'postado' }, by);
    if (typeof r === 'string') throw new Error(r);
    if (!r) throw new Error('Não consegui registrar a peça.');
    post = r;
  }
  let moved: { renamed: unknown[]; skipped: string[] } = { renamed: [], skipped: [] };
  if (input.state === 'postado') {
    moved = movePosted(officeId, clientId, post.files.length ? post.files : input.files, input.date, by);
    post = one<ContentPost>('SELECT * FROM content_posts WHERE id = ?', post.id)!;
  } else if (post.status === 'postado') {
    const r = undoPosted(officeId, clientId, post.files);
    if (typeof r === 'string') throw new Error(r);
    post = one<ContentPost>('SELECT * FROM content_posts WHERE id = ?', post.id)!;
  }
  const status = input.state === 'postado' ? 'postado' : input.state === 'agendado' ? 'programado'
    : ['programado', 'postado'].includes(post.status) ? 'drive' : post.status;
  const patch: Partial<ContentPost> = {
    date: input.date, status,
    scheduledAt: input.state === 'pronto' ? null : input.time ? `${input.date}T${input.time}` : post.scheduledAt && input.state === 'postado' ? post.scheduledAt : null,
    updatedAt: now(), updatedBy: by,
  };
  if (input.caption !== undefined) patch.caption = String(input.caption).slice(0, 2200);
  update('content_posts', post.id, patch);
  invalidate(officeId, 'posts');
  return { ...one<ContentPost>('SELECT * FROM content_posts WHERE id = ?', post.id)!, moved: moved.renamed.length, skipped: moved.skipped };
}

/** O pedido da conferência no Instagram: o funcionário compara o perfil com as peças do mês e marca as que já foram ao ar. */
export function conferencePrompt(client: Client, month: string) {
  const label = new Date(`${month}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return [
    `## Conferir no Instagram o que já foi postado (${label})`,
    '',
    `1. Use \`posts_do_mes\` (mês ${month}) para ver as peças de ${client.name} que estão prontas ou agendadas, com os arquivos de cada uma.`,
    '2. Ache o @ do Instagram do cliente (no briefing, na IDV ou no CLAUDE.md da pasta). Se não achar, pare e pergunte.',
    '3. Abra o perfil no Chrome, numa aba nova, e veja os posts do mês (feed e reels). Só leitura: não curta, não comente, não siga, não mande mensagem.',
    '4. Compare cada post do perfil com as peças (olhe as imagens das peças com Read; compare arte, texto da capa e legenda). Só conta como postado se for claramente a mesma peça.',
    '5. Para as que bateram, chame `posts_marcar_postado` com a chave da peça e o dia em que foi ao ar. O Office move os arquivos para POSTADOS sozinho.',
    '6. No fim, responda com uma lista curta: o que marcou como postado (com o dia), o que está no perfil e não achei nas peças, e o que segue sem postar.',
  ].join('\n');
}
