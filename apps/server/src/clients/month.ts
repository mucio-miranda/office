import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CheckState, Client, ClientMonth, ContentPost, MonthAuto, MonthCheck, MonthPiece, MonthStep, Office, PostFormat, RenamePlan } from '@office/shared';
import { CHECK_STATES, MONTH_STEPS } from '@office/shared';
import { all, insert, now, one, update } from '../db.ts';
import { clientDir } from './folder.ts';
import { clientDriveFolder } from './drive.ts';
import { clientPaths, layoutMap } from './layout.ts';
import { safeName } from './deliver.ts';

/**
 * Gestão mensal do squad: a checklist de cada cliente no mês e as peças da pasta do mês ligadas às datas do calendário.
 *
 * A pasta do mês segue o padrão do squad (16/11/2026):
 *   `NN AAAA-MM-DD Formato – Tema – LL.ext`  (o que ainda vai ao ar; LL só no carrossel)
 *   `POSTADOS/NN_postado AAAA-MM-DD Formato – Tema – LL.ext`
 *   `RESERVAS/`, `DESCARTADAS/`, `ENSAIOS – Mês/` e `VÍDEOS – Mês/` (com `Reels – … .mp4` e a `… – capa.jpg`).
 * A entrega automática da Mesa grava `AAAA-MM-DD Formato – Tema – NN.ext`; os dois formatos são lidos.
 * Trocar nomes ("Aplicar na pasta") só renomeia dentro da própria pasta, nunca sobrescreve e fica registrado para desfazer.
 */

const uid = () => randomBytes(8).toString('hex');
const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEDIA = /\.(png|jpe?g|webp|mp4|mov)$/i;
const IMAGE = /\.(png|jpe?g|webp|heic|arw|cr2|cr3|nef|dng)$/i;

export const FORMAT_NAME: Record<PostFormat, string> = { estatico: 'Estático', carrossel: 'Carrossel', reels: 'Reels', 'capa-reels': 'Capa de reels', story: 'Story' };
const FORMAT_OF: Record<string, PostFormat> = {
  estatico: 'estatico', estático: 'estatico', carrossel: 'carrossel', reels: 'reels', reel: 'reels', 'capa de reels': 'capa-reels', story: 'story', stories: 'story',
};
const formatOf = (s: string) => FORMAT_OF[s.trim().toLowerCase()] ?? null;
const FORMATS = 'Estático|Estatico|Carrossel|Reels|Reel|Story|Stories|Capa de reels';

// NN[_postado] [AAAA-MM-DD|sem data] Formato – Tema[ – LL]
const SQUAD = new RegExp(`^(\\d{1,3})(_postado)?\\s+(?:(\\d{4}-\\d{2}-\\d{2})|sem data)?\\s*(${FORMATS})\\s+[–-]\\s+(.+?)(?:\\s+[–-]\\s+(\\d{1,2}))?(?:\\s*\\(\\d+\\))?$`, 'i');
// AAAA-MM-DD Formato – Tema[ – NN] (entrega da Mesa)
const MESA = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})\\s+(${FORMATS})\\s+[–-]\\s+(.+?)(?:\\s+[–-]\\s+(\\d{1,2}))?(?:\\s*\\(\\d+\\))?$`, 'i');
// Reels – [postado AAAA-MM-DD – ]Tema[ – capa]  (pasta de vídeos)
const REELS = /^Reels\s+[–-]\s+(?:postado\s+(\d{4}-\d{2}-\d{2})\s+[–-]\s+)?(.+?)(\s+[–-]\s+capa)?$/i;

export interface ParsedName {
  number: number | null;
  date: string | null;
  format: PostFormat | null;
  theme: string;
  /** Número da lâmina (carrossel) ou 0 para a capa do reels. */
  slide: number | null;
  posted: boolean;
}

/** Lê o nome de um arquivo da pasta do mês; `null` quando não segue nenhum padrão. */
export function parseName(file: string): ParsedName | null {
  const stem = path.basename(file, path.extname(file)).trim();
  let m = stem.match(SQUAD);
  if (m) return { number: Number(m[1]), posted: !!m[2], date: m[3] ?? null, format: formatOf(m[4]), theme: m[5].trim(), slide: m[6] ? Number(m[6]) : null };
  m = stem.match(MESA);
  if (m) return { number: null, posted: false, date: m[1], format: formatOf(m[2]), theme: m[3].trim(), slide: m[4] ? Number(m[4]) : null };
  m = stem.match(REELS);
  if (m) return { number: null, posted: !!m[1], date: m[1] ?? null, format: 'reels', theme: m[2].trim(), slide: m[3] ? 0 : null };
  return null;
}

/** Nome padrão do squad para o arquivo `i` de `total` da peça. */
export function squadName(p: { number: number; date: string; format: PostFormat; theme: string }, i: number, total: number, ext: string, posted = false) {
  const nn = String(p.number).padStart(2, '0') + (posted ? '_postado' : '');
  const theme = safeName(p.theme).slice(0, 80) || 'Sem tema';
  const ll = total > 1 ? ` – ${String(i + 1).padStart(2, '0')}` : '';
  return `${nn} ${p.date} ${FORMAT_NAME[p.format]} – ${theme}${ll}${ext.toLowerCase()}`;
}

const dirsIn = (dir: string) => { try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
const filesIn = (dir: string) => { try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => path.join(dir, e.name)); } catch { return []; } };
const byName = (a: string, b: string) => path.basename(a).localeCompare(path.basename(b), 'pt-BR', { numeric: true });

/** A pasta do mês do cliente no Drive (ou na pasta local, se o Drive não estiver configurado). */
export function monthDir(office: Office, client: Client, month: string) {
  const base = office.driveRoot ? path.join(office.driveRoot, clientDriveFolder(office.driveRoot, client)) : clientDir(office, client);
  if (!base || !existsSync(base)) return null;
  return clientPaths(base, layoutMap(office.rootPath)).abs('mes', { mes: month });
}

/** Os arquivos de mídia que contam como peças: raiz do mês, POSTADOS e a pasta de vídeos (com o POSTADOS dela). */
export function monthFiles(dir: string) {
  const out: string[] = [];
  const take = (d: string) => out.push(...filesIn(d).filter((f) => MEDIA.test(f) && !/^0+\s*mosaico/i.test(path.basename(f))));
  take(dir);
  for (const sub of dirsIn(dir)) {
    const full = path.join(dir, sub);
    if (/^POSTADOS$/i.test(sub)) take(full);
    else if (/^V[ÍI]DEOS\b/i.test(sub)) { take(full); for (const s2 of dirsIn(full)) if (/^POSTADOS$/i.test(s2)) take(path.join(full, s2)); }
  }
  return out.sort(byName);
}

const inPosted = (f: string) => /[\\/]POSTADOS[\\/][^\\/]+$/i.test(f);
/** Peça solta: lâminas "Tema – 01", "Tema - 2", "Tema-03" ficam juntas. */
const looseStem = (f: string) => path.basename(f, path.extname(f)).replace(/\s*[–-]\s*\d{1,2}$/, '').replace(/\s*\(\d+\)$/, '').trim();

/** Agrupa os arquivos em peças e liga cada uma ao post do calendário que já tem esses arquivos. */
export function groupPieces(files: string[], posts: Pick<ContentPost, 'id' | 'files' | 'date' | 'format' | 'theme' | 'number' | 'status'>[] = []): MonthPiece[] {
  const groups = new Map<string, MonthPiece & { slides: Map<string, number> }>();
  for (const f of files) {
    const p = parseName(f);
    const posted = inPosted(f) || !!p?.posted;
    const key = p
      ? `${path.dirname(f).toLowerCase()}|${p.number ?? ''}|${p.date ?? ''}|${p.format ?? ''}|${p.theme.toLowerCase()}`
      : `${path.dirname(f).toLowerCase()}|solta|${looseStem(f).toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, number: p?.number ?? null, date: p?.date ?? null, format: p?.format ?? null, theme: p?.theme ?? looseStem(f), files: [], posted, postId: null, loose: !p, slides: new Map() };
      groups.set(key, g);
    }
    g.files.push(f);
    g.slides.set(f, p?.slide ?? 1);
  }
  const lower = (s: string) => s.toLowerCase();
  const pieces = [...groups.values()].map(({ slides, ...g }) => {
    // capa do reels (slide 0) vem depois do vídeo; lâminas na ordem
    g.files.sort((a, b) => (slides.get(a) || 99) - (slides.get(b) || 99) || byName(a, b));
    const post = posts.find((x) => x.files.some((pf) => g.files.some((f) => lower(f) === lower(pf))));
    if (post) {
      g.postId = post.id;
      if (!g.date) g.date = post.date;
      if (!g.format) g.format = post.format;
      if (post.status === 'postado') g.posted = true;
    }
    if (!g.format && g.files.length > 1 && g.files.every((f) => /\.(png|jpe?g|webp)$/i.test(f))) g.format = 'carrossel';
    if (!g.format && g.files.some((f) => /\.(mp4|mov)$/i.test(f))) g.format = 'reels';
    return g;
  });
  return pieces.sort((a, b) => Number(b.posted) - Number(a.posted) || (a.date ?? '9').localeCompare(b.date ?? '9') || (a.number ?? 999) - (b.number ?? 999) || a.theme.localeCompare(b.theme));
}

export function piecesOf(office: Office, client: Client, month: string) {
  const dir = monthDir(office, client, month);
  const posts = all<ContentPost>("SELECT * FROM content_posts WHERE office_id = ? AND client_id = ? AND status != 'cancelado'", office.id, client.id);
  if (!dir || !existsSync(dir)) return { dir, pieces: [] as MonthPiece[] };
  return { dir, pieces: groupPieces(monthFiles(dir), posts) };
}

/**
 * Os nomes no padrão do squad para as peças com data. O número que a peça já tem nunca muda (é o do calendário, e a
 * equipe decide quando renumerar); quem não tem número ganha o próximo livre, pela ordem das datas. As postadas ganham
 * `_postado`. Nada muda de pasta.
 */
export function renamePlan(pieces: MonthPiece[]): { plan: RenamePlan[]; skipped: string[] } {
  // vídeos e capas de reels ficam com o nome da pasta de vídeos e não entram na numeração do feed
  const video = (p: MonthPiece) => p.files.some((f) => /\.(mp4|mov)$/i.test(f));
  const dated = pieces.filter((p) => p.date && p.format && (!p.loose || p.postId) && !video(p))
    .sort((a, b) => a.date!.localeCompare(b.date!) || (a.number ?? 999) - (b.number ?? 999));
  const plan: RenamePlan[] = [];
  const skipped: string[] = [];
  for (const p of pieces) if (p.date && video(p)) skipped.push(`${p.theme}: reels mantém o nome da pasta de vídeos`);
  let n = Math.max(0, ...pieces.map((p) => p.number ?? 0));
  for (const p of dated) push(p, p.loose ? ++n : p.number ?? ++n, p.posted);
  function push(p: MonthPiece, number: number, isPosted: boolean) {
    p.files.forEach((f, i) => {
      const to = path.join(path.dirname(f), squadName({ number, date: p.date!, format: p.format!, theme: p.theme }, i, p.files.length, path.extname(f), isPosted));
      if (path.resolve(to) !== path.resolve(f)) plan.push({ from: f, to });
    });
  }
  // dois arquivos para o mesmo nome, ou nome ocupado por arquivo que não vai sair do lugar
  const froms = new Set(plan.map((r) => r.from.toLowerCase()));
  const seen = new Set<string>();
  const ok = plan.filter((r) => {
    const t = r.to.toLowerCase();
    if (seen.has(t) || (existsSync(r.to) && !froms.has(t))) { skipped.push(`${path.basename(r.from)}: ${path.basename(r.to)} já existe`); return false; }
    seen.add(t);
    return true;
  });
  return { plan: ok, skipped };
}

/** Executa as trocas em duas fases (nome temporário e depois o final), para que uma cadeia A→B, B→C não colida. */
export function runRenames(plan: RenamePlan[]) {
  const done: RenamePlan[] = [];
  const tmp = plan.map((r) => ({ ...r, tmp: path.join(path.dirname(r.from), `.office-${uid()}${path.extname(r.from)}`) }));
  try {
    for (const r of tmp) { if (!existsSync(r.from)) throw new Error(`${path.basename(r.from)} não está mais na pasta.`); renameSync(r.from, r.tmp); }
    for (const r of tmp) {
      if (existsSync(r.to)) throw new Error(`${path.basename(r.to)} apareceu na pasta durante a troca.`);
      renameSync(r.tmp, r.to);
      done.push({ from: r.from, to: r.to });
    }
  } catch (e) {
    // volta o que já tinha mudado: finais para o nome original, temporários também
    for (const r of tmp) {
      if (existsSync(r.to) && done.some((d) => d.to === r.to) && !existsSync(r.from)) renameSync(r.to, r.from);
      else if (existsSync(r.tmp) && !existsSync(r.from)) renameSync(r.tmp, r.from);
    }
    throw e;
  }
  return done;
}

/** Troca os caminhos dos posts do calendário depois de renomear os arquivos. */
export function retargetPosts(officeId: string, clientId: string, renames: RenamePlan[]) {
  const map = new Map(renames.map((r) => [r.from.toLowerCase(), r.to]));
  const posts = all<ContentPost>('SELECT * FROM content_posts WHERE office_id = ? AND client_id = ?', officeId, clientId);
  for (const p of posts) {
    const fix = (l: string[]) => l.map((f) => map.get(f.toLowerCase()) ?? f);
    const files = fix(p.files), finals = fix(p.finals);
    const deliveries = p.deliveries.map((d) => (map.has(d.to.toLowerCase()) ? { ...d, to: map.get(d.to.toLowerCase())! } : d));
    if (JSON.stringify([files, finals, deliveries]) !== JSON.stringify([p.files, p.finals, p.deliveries])) update('content_posts', p.id, { files, finals, deliveries });
  }
}

export function applyRenames(office: Office, client: Client, month: string, by: string) {
  const { pieces } = piecesOf(office, client, month);
  const { plan, skipped } = renamePlan(pieces);
  if (!plan.length) return { id: null, renamed: [] as RenamePlan[], skipped };
  const renamed = runRenames(plan);
  const id = uid();
  insert('folder_renames', { id, officeId: office.id, clientId: client.id, month, renames: renamed, createdAt: now(), createdBy: by, undoneAt: null } as never);
  retargetPosts(office.id, client.id, renamed);
  return { id, renamed, skipped };
}

export function undoRenames(officeId: string, id: string) {
  const row = one<{ id: string; clientId: string; renames: RenamePlan[]; undoneAt: string | null }>('SELECT * FROM folder_renames WHERE id = ? AND office_id = ?', id, officeId);
  if (!row) return 'Registro não encontrado.';
  if (row.undoneAt) return 'Essas trocas já foram desfeitas.';
  const back = row.renames.map((r) => ({ from: r.to, to: r.from }));
  const blocked = back.find((r) => !existsSync(r.from) || existsSync(r.to));
  if (blocked) return `Não dá para desfazer: ${path.basename(blocked.from)} mudou de lugar ou ${path.basename(blocked.to)} já existe.`;
  runRenames(back);
  retargetPosts(officeId, row.clientId, back);
  update('folder_renames', id, { undoneAt: now() });
  return { undone: back.length };
}

/** Liga uma peça da pasta a uma data do calendário: cria ou atualiza o post. `date: null` tira a peça do calendário. */
export function assignPiece(officeId: string, clientId: string, input: { files: string[]; date: string | null; format?: PostFormat | null; theme: string; posted?: boolean }, by: string) {
  const lower = (s: string) => s.toLowerCase();
  const posts = all<ContentPost>('SELECT * FROM content_posts WHERE office_id = ? AND client_id = ?', officeId, clientId);
  const cur = posts.find((p) => p.files.some((pf) => input.files.some((f) => lower(f) === lower(pf))));
  if (input.date === null) {
    if (!cur) return null;
    if (cur.demandId || cur.deliveries.length) return 'Esta peça veio da produção do Office: mude a data dela pela Mesa ou pelo Calendário.';
    update('content_posts', cur.id, { status: 'cancelado', updatedAt: now(), updatedBy: by });
    return null;
  }
  if (!DATE.test(input.date)) return 'Data inválida.';
  const format = input.format ?? cur?.format ?? 'estatico';
  if (cur) {
    const status = cur.status === 'cancelado' ? (input.posted ? 'postado' : 'drive') : cur.status;
    update('content_posts', cur.id, { date: input.date, files: input.files, format, status, updatedAt: now(), updatedBy: by });
    return one<ContentPost>('SELECT * FROM content_posts WHERE id = ?', cur.id)!;
  }
  // a peça já está na pasta do mês: está pronta (tunning feito); postada se veio de POSTADOS
  const row: ContentPost = {
    id: uid(), officeId, clientId, demandId: null, date: input.date, format, theme: input.theme.slice(0, 200) || 'Sem tema',
    caption: '', notes: '', number: null, status: input.posted ? 'postado' : 'drive', tunning: 'feito', files: input.files,
    workDir: null, finals: [], deliveries: [], updatedAt: now(), updatedBy: by,
  };
  insert('content_posts', row as never);
  return row;
}

// ---------- checklist ----------

export const emptyMonth = (clientId: string, month: string): ClientMonth => ({ clientId, month, checks: {}, note: '', updatedAt: null, updatedBy: null });

export function monthOf(officeId: string, clientId: string, month: string): ClientMonth {
  const row = one<ClientMonth & { id: string }>('SELECT * FROM client_months WHERE office_id = ? AND client_id = ? AND month = ?', officeId, clientId, month);
  return row ? { clientId, month, checks: row.checks ?? {}, note: row.note ?? '', updatedAt: row.updatedAt, updatedBy: row.updatedBy } : emptyMonth(clientId, month);
}

/** Marca uma etapa (ou a nota geral) do mês de um cliente. */
export function saveCheck(officeId: string, clientId: string, month: string, patch: { step?: MonthStep; state?: CheckState; note?: string; monthNote?: string }, by: string) {
  if (!MONTH.test(month)) throw new Error('Mês inválido (use AAAA-MM).');
  if (patch.step && !MONTH_STEPS.includes(patch.step)) throw new Error('Etapa inválida.');
  if (patch.state && !CHECK_STATES.includes(patch.state)) throw new Error('Estado inválido.');
  const cur = one<{ id: string; checks: ClientMonth['checks']; note: string }>('SELECT * FROM client_months WHERE office_id = ? AND client_id = ? AND month = ?', officeId, clientId, month);
  const checks = { ...(cur?.checks ?? {}) };
  if (patch.step) {
    const prev: MonthCheck = checks[patch.step] ?? { state: 'pendente', note: '', by: null, at: null };
    checks[patch.step] = { state: patch.state ?? prev.state, note: patch.note !== undefined ? patch.note.slice(0, 300) : prev.note, by, at: now() };
  }
  const note = patch.monthNote !== undefined ? patch.monthNote.slice(0, 1000) : cur?.note ?? '';
  if (cur) update('client_months', cur.id, { checks, note, updatedAt: now(), updatedBy: by });
  else insert('client_months', { id: uid(), officeId, clientId, month, checks, note, updatedAt: now(), updatedBy: by } as never);
  return monthOf(officeId, clientId, month);
}

/** O que dá para saber sozinho: posts do mês por etapa, peças na pasta e fotos do ensaio. */
export function autoOf(office: Office, client: Client, month: string): MonthAuto {
  const posts = all<Pick<ContentPost, 'status' | 'files'>>("SELECT status, files FROM content_posts WHERE office_id = ? AND client_id = ? AND substr(date,1,7) = ? AND status != 'cancelado'", office.id, client.id, month);
  const at = (...s: string[]) => posts.filter((p) => s.includes(p.status)).length;
  let pecas = 0, fotosEnsaio = 0, pasta: string | null = null;
  try {
    const dir = monthDir(office, client, month);
    if (dir && existsSync(dir)) {
      pasta = dir;
      pecas = groupPieces(monthFiles(dir)).length;
      const ensaio = dirsIn(dir).find((d) => /^ENSAIOS?\b/i.test(d));
      if (ensaio) {
        const count = (d: string, depth: number): number => filesIn(d).filter((f) => IMAGE.test(f)).length + (depth ? dirsIn(d).reduce((n, s) => n + count(path.join(d, s), depth - 1), 0) : 0);
        fotosEnsaio = count(path.join(dir, ensaio), 2);
      }
    }
  } catch { /* Drive fora do ar: fica só o que está no banco */ }
  return {
    posts: posts.length,
    feitos: posts.filter((p) => p.files.length || ['aprovado', 'drive', 'programado', 'postado'].includes(p.status)).length,
    aprovados: at('aprovado', 'drive', 'programado', 'postado'),
    programados: at('programado', 'postado'),
    postados: at('postado'),
    pecas, fotosEnsaio, pasta,
  };
}

export const isMonth = (m: unknown): m is string => typeof m === 'string' && MONTH.test(m);
export const fileSize = (f: string) => { try { return statSync(f).size; } catch { return 0; } };
