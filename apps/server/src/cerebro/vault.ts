import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { config } from '../config.ts';

/**
 * Cérebro: um cofre do Obsidian (uma pasta de notas .md) lido pelo Office. O cofre continua do usuário: o Office só lê as
 * notas e, na triagem, troca `status` e `destino` no frontmatter da nota (o mesmo lugar que o Obsidian mostra). Nada é
 * apagado nem movido; descartar é só `status: descartada`.
 */

export const STATUSES = ['nova', 'revisada', 'referencia', 'aprovada', 'adiada', 'em-uso', 'descartada'] as const;
export const DESTINOS = ['pauta', 'ferramenta', 'referencia-visual', 'formato-e-conteudo', 'concorrente', 'melhoria', 'descartar'] as const;
/** Ainda esperando decisão: entram na fila da triagem. */
export const PENDING = new Set(['', 'nova', 'revisada', 'referencia']);

export interface NoteMeta {
  /** caminho relativo à pasta do cofre, com barras normais (é o id da nota) */
  id: string;
  title: string;
  folder: string;
  fm: Record<string, string>;
  tags: string[];
  /** ids das notas citadas com [[...]] (só as que existem) */
  links: string[];
  /** primeira imagem embutida (caminho relativo ao cofre) */
  cover: string | null;
  /** todas as imagens embutidas, na ordem (as lâminas do carrossel) */
  slides: string[];
  /** citação do post (linha "> ...") ou primeiro parágrafo */
  excerpt: string;
  /** itens do "## Como usar" já preenchidos */
  comoUsar: string[];
  /** primeiro link externo da nota (o post original, o repositório) */
  url: string | null;
  mtime: number;
}

export interface GraphGroup { query: string; color: string }

const IGNORE_DIR = (n: string) => n.startsWith('.') || n === 'node_modules' || n === '_apagados';
const IMG = /\.(png|jpe?g|webp|gif)$/i;
const rel = (root: string, f: string) => path.relative(root, f).split(path.sep).join('/');
const stem = (p: string) => path.posix.basename(p).replace(/\.md$/i, '');

/* ---------------- texto de uma nota (funções puras) ---------------- */

/** Separa o frontmatter YAML simples (chave: valor por linha) do corpo. */
export function splitFrontmatter(text: string): { fm: Record<string, string>; body: string; raw: string | null } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: text, raw: null };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-zÀ-ÿ0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fm, body: text.slice(m[0].length), raw: m[1] };
}

/** Troca (ou acrescenta) chaves do frontmatter sem mexer no resto do texto. */
export function setFrontmatter(text: string, patch: Record<string, string>): string {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) {
    const head = Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(nl);
    return `---${nl}${head}${nl}---${nl}${text}`;
  }
  const lines = m[1].split(/\r?\n/);
  const left = { ...patch };
  const out = lines.map((line) => {
    const k = line.match(/^([A-Za-zÀ-ÿ0-9_-]+):/)?.[1];
    if (k && k in left) { const v = left[k]; delete left[k]; return `${k}: ${v}`; }
    return line;
  });
  for (const [k, v] of Object.entries(left)) out.push(`${k}: ${v}`);
  return `---${nl}${out.join(nl)}${nl}---${m[2]}${text.slice(m[0].length)}`;
}

/** [[alvo|apelido]] e ![[anexo|320]] → alvo (sem #seção). */
export function wikiTargets(body: string): { links: string[]; embeds: string[] } {
  const links: string[] = [], embeds: string[] = [];
  for (const m of body.matchAll(/(!?)\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) (m[1] ? embeds : links).push(m[2].trim());
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) if (!/^https?:/i.test(m[1])) embeds.push(decodeURIComponent(m[1]));
  return { links, embeds };
}

export function parseNote(text: string) {
  const { fm, body } = splitFrontmatter(text);
  const title = body.match(/^#\s+(.+)$/m)?.[1].trim() ?? '';
  const quote = body.match(/^>\s?(.+)$/m)?.[1].trim();
  const para = body.split(/\r?\n\r?\n/).map((p) => p.trim()).find((p) => p && !/^(#|!\[|\*\*|---|>|-\s*$)/.test(p));
  const como = body.match(/^##\s+Como usar\s*\r?\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] ?? '';
  const comoUsar = como.split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter((l) => l.length > 1);
  const tags = new Set<string>();
  for (const t of (fm.tags ?? '').replace(/[[\]]/g, '').split(',')) if (t.trim()) tags.add(t.trim().replace(/^#/, ''));
  for (const m of body.matchAll(/(?:^|\s)#([A-Za-zÀ-ÿ][\wÀ-ÿ/-]*)/g)) tags.add(m[1]);
  const url = body.match(/https?:\/\/[^\s)>\]]+/)?.[0] ?? null;
  return { fm, body, title, excerpt: (quote ?? para ?? '').slice(0, 280), comoUsar, tags: [...tags], url, ...wikiTargets(body) };
}

/* ---------------- o cofre inteiro ---------------- */

type Parsed = Omit<ReturnType<typeof parseNote>, 'body'>;
interface Cached { mtime: number; size: number; parsed: Parsed }
interface VaultState { files: Map<string, Cached>; attachments: Map<string, string>; scannedAt: number; notes: NoteMeta[]; groups: GraphGroup[] }
const cache = new Map<string, VaultState>();

/** Cópia do que já foi lido, nos dados do Office: depois de reiniciar, só as notas que mudaram são lidas de novo. */
const diskFile = (root: string) => path.join(config.dataDir, 'cerebro', `${createHash('sha1').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16)}.json`);
function loadDisk(root: string): Map<string, Cached> | null {
  try { return new Map(Object.entries(JSON.parse(readFileSync(diskFile(root), 'utf8')) as Record<string, Cached>)); } catch { return null; }
}
function saveDisk(root: string, files: Map<string, Cached>) {
  try {
    const f = diskFile(root);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(`${f}.tmp`, JSON.stringify(Object.fromEntries(files)));
    renameSync(`${f}.tmp`, f);
  } catch { /* sem a cópia, só fica mais lento */ }
}

async function walk(dir: string, md: string[], att: string[]) {
  let entries: import('node:fs').Dirent[] = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  const subs: Promise<void>[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!IGNORE_DIR(e.name)) subs.push(walk(p, md, att)); }
    else if (/\.md$/i.test(e.name)) md.push(p);
    else if (IMG.test(e.name)) att.push(p);
  }
  await Promise.all(subs);
}

/** Roda `fn` em todos os itens, `n` por vez (o Drive em streaming baixa cada arquivo ao abrir). */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Cores dos grupos do grafo do próprio Obsidian (.obsidian/graph.json), para o grafo do Office ficar igual. */
export function graphGroups(root: string): GraphGroup[] {
  try {
    const g = JSON.parse(readFileSync(path.join(root, '.obsidian', 'graph.json'), 'utf8')) as { colorGroups?: { query: string; color: { rgb: number } }[] };
    return (g.colorGroups ?? []).map((c) => ({ query: c.query, color: `#${c.color.rgb.toString(16).padStart(6, '0')}` }));
  } catch { return []; }
}

/** Qual grupo do grafo pega a nota: entende `path:"pasta"`, `tag:#x` e `file:"nome"`, como o Obsidian. */
export function groupOf(note: Pick<NoteMeta, 'id' | 'tags'>, groups: GraphGroup[]): number {
  return groups.findIndex(({ query }) => {
    const m = query.match(/^(path|tag|file):\s*"?([^"]+)"?$/);
    if (!m) return false;
    const v = m[2].replace(/^#/, '').toLowerCase();
    if (m[1] === 'path') return note.id.toLowerCase().startsWith(v.replace(/\/$/, '') + '/') || note.id.toLowerCase() === v;
    if (m[1] === 'tag') return note.tags.some((t) => t.toLowerCase() === v);
    return stem(note.id).toLowerCase().includes(v);
  });
}

const inflight = new Map<string, Promise<VaultState>>();

/**
 * Lê o cofre sem travar o servidor. Notas sem mudança (mesma data e tamanho) não são relidas; duas leituras do mesmo
 * cofre ao mesmo tempo viram uma só.
 */
export function scanVault(root: string): Promise<VaultState> {
  const running = inflight.get(root);
  if (running) return running;
  const job = doScan(root).finally(() => inflight.delete(root));
  inflight.set(root, job);
  return job;
}

async function doScan(root: string): Promise<VaultState> {
  const prev = cache.get(root)?.files ?? loadDisk(root);
  let changed = !cache.has(root);
  const mdFiles: string[] = [], attFiles: string[] = [];
  await walk(root, mdFiles, attFiles);
  const files = new Map<string, Cached>();
  await pool(mdFiles, 16, async (f) => {
    const id = rel(root, f);
    let st;
    try { st = await stat(f); } catch { return; }
    const old = prev?.get(id);
    if (old && old.mtime === st.mtimeMs && old.size === st.size) { files.set(id, old); return; }
    try {
      const { body: _body, ...parsed } = parseNote(await readFile(f, 'utf8'));
      files.set(id, { mtime: st.mtimeMs, size: st.size, parsed });
      changed = true;
    } catch { /* arquivo do Drive ainda baixando */ }
  });
  const attachments = new Map<string, string>();
  for (const f of attFiles) { const r = rel(root, f); attachments.set(path.posix.basename(r).toLowerCase(), r); }
  if (changed || files.size !== (prev?.size ?? 0)) saveDisk(root, files);
  return build(root, files, attachments);
}

function build(root: string, files: Map<string, Cached>, attachments: Map<string, string>): VaultState {
  // como o Obsidian: [[nome]] acha a nota pelo nome do arquivo, em qualquer pasta (ou pelo caminho, se vier com barra)
  const byStem = new Map<string, string>();
  for (const id of files.keys()) { const k = stem(id).toLowerCase(); if (!byStem.has(k) || id.length < byStem.get(k)!.length) byStem.set(k, id); }
  const resolve = (t: string) => {
    const k = t.replace(/\.md$/i, '').toLowerCase();
    if (k.includes('/')) return [...files.keys()].find((id) => id.toLowerCase().replace(/\.md$/, '').endsWith(k)) ?? null;
    return byStem.get(k) ?? null;
  };
  const attach = (t: string) => {
    const k = t.toLowerCase();
    if (k.includes('/')) { const direct = path.posix.normalize(k); for (const v of attachments.values()) if (v.toLowerCase().endsWith(direct)) return v; }
    return attachments.get(path.posix.basename(k)) ?? null;
  };
  const notes: NoteMeta[] = [];
  for (const [id, c] of files) {
    const p = c.parsed;
    notes.push({
      id, title: p.title || stem(id), folder: path.posix.dirname(id) === '.' ? '' : path.posix.dirname(id), fm: p.fm, tags: p.tags,
      links: [...new Set(p.links.map(resolve).filter((x): x is string => !!x && x !== id))],
      cover: p.embeds.map(attach).find((x) => !!x) ?? null,
      slides: [...new Set(p.embeds.map(attach).filter((x): x is string => !!x))],
      excerpt: p.excerpt, comoUsar: p.comoUsar, url: p.url, mtime: c.mtime,
    });
  }
  notes.sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', { numeric: true }));
  const state = { files, attachments, scannedAt: Date.now(), notes, groups: graphGroups(root) };
  cache.set(root, state);
  return state;
}

/** Caminho absoluto de um arquivo do cofre, recusando qualquer coisa que saia da pasta. */
export function vaultFile(root: string, id: string): string | null {
  const abs = path.resolve(root, id);
  const r = path.resolve(root);
  if (abs.toLowerCase() !== r.toLowerCase() && !abs.toLowerCase().startsWith(r.toLowerCase() + path.sep)) return null;
  return existsSync(abs) ? abs : null;
}

export async function readNote(root: string, id: string) {
  const f = vaultFile(root, id);
  if (!f || !/\.md$/i.test(f)) return null;
  const text = await readFile(f, 'utf8');
  const state = cache.get(root) ?? await scanVault(root);
  const backlinks = state.notes.filter((n) => n.links.includes(id)).map((n) => ({ id: n.id, title: n.title }));
  const body = splitFrontmatter(text).body;
  // [[links]] e ![[anexos]] já resolvidos, para a tela abrir a nota certa e mostrar a imagem
  const byStem = new Map(state.notes.map((n) => [stem(n.id).toLowerCase(), n.id]));
  const t = wikiTargets(body);
  const links = Object.fromEntries(t.links.map((x) => [x, byStem.get(path.posix.basename(x).replace(/\.md$/i, '').toLowerCase()) ?? null]));
  const embeds = Object.fromEntries(t.embeds.map((x) => [x, state.attachments.get(path.posix.basename(x).toLowerCase()) ?? null]));
  return { id, text, body, backlinks, links, embeds, abs: f };
}

/** Grava a decisão da triagem no frontmatter (escreve num temporário e troca, para não deixar nota pela metade). */
export async function decide(root: string, id: string, patch: { status?: string; destino?: string }) {
  const f = vaultFile(root, id);
  if (!f || !/\.md$/i.test(f)) throw new Error('Nota não encontrada no cérebro.');
  const clean: Record<string, string> = {};
  if (patch.status) clean.status = patch.status;
  if (patch.destino) clean.destino = patch.destino;
  if (patch.status) clean.decidido = new Date().toISOString().slice(0, 10);
  const next = setFrontmatter(readFileSync(f, 'utf8'), clean);
  const tmp = `${f}.office-tmp`;
  writeFileSync(tmp, next, 'utf8');
  renameSync(tmp, f);
  // só a nota decidida é relida; o resto do cofre continua da última leitura
  const state = cache.get(root) ?? await scanVault(root);
  const st = statSync(f);
  const { body: _body, ...parsed } = parseNote(next);
  state.files.set(rel(root, f), { mtime: st.mtimeMs, size: st.size, parsed });
  saveDisk(root, state.files);
  return build(root, state.files, state.attachments).notes.find((n) => n.id === rel(root, f))!;
}

export interface Moved { from: string; to: string }
const TRASH = '_apagados';

/** Move um arquivo do cofre sem sobrescrever nada: se o destino existe, ganha " (2)", " (3)"… */
function moveInside(root: string, from: string, to: string): Moved {
  let dest = to;
  for (let i = 2; existsSync(path.join(root, dest)); i++) dest = to.replace(/(\.[^./]+)?$/, ` (${i})$1`);
  mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
  renameSync(path.join(root, from), path.join(root, dest));
  return { from, to: dest };
}

/**
 * Remover do cérebro: a nota vai para `_apagados/` dentro do próprio cofre (o Office não lê essa pasta), com o mesmo
 * caminho de antes. A capa vai junto quando nenhuma outra nota usa a mesma imagem. Nada é apagado de verdade: dá para
 * desfazer com `restoreNotes` ou trazendo o arquivo de volta à mão.
 */
export async function trashNotes(root: string, ids: string[]): Promise<Moved[]> {
  const state = cache.get(root) ?? await scanVault(root);
  const moved: Moved[] = [];
  const gone = new Set(ids);
  for (const id of ids) {
    if (!vaultFile(root, id) || !/\.md$/i.test(id) || id.startsWith(`${TRASH}/`)) throw new Error(`Nota não encontrada no cérebro: ${id}`);
    const note = state.notes.find((n) => n.id === id);
    moved.push(moveInside(root, id, `${TRASH}/${id}`));
    state.files.delete(id);
    const cover = note?.cover;
    if (cover && vaultFile(root, cover) && !state.notes.some((n) => !gone.has(n.id) && n.cover === cover)) {
      moved.push(moveInside(root, cover, `${TRASH}/${cover}`));
      state.attachments.delete(path.posix.basename(cover).toLowerCase());
    }
  }
  saveDisk(root, state.files);
  build(root, state.files, state.attachments);
  return moved;
}

/** Desfaz uma remoção: cada arquivo volta para onde estava (se o lugar estiver livre). */
export async function restoreNotes(root: string, moves: Moved[]) {
  for (const m of moves) {
    if (!m.to.startsWith(`${TRASH}/`) || !vaultFile(root, m.to)) continue;
    const back = path.resolve(root, m.from);
    if (!back.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep) || existsSync(back)) continue;
    mkdirSync(path.dirname(back), { recursive: true });
    renameSync(path.join(root, m.to), back);
  }
  return scanVault(root);
}

/** A pasta parece um cérebro: tem notas .md (direto ou em subpastas). */
export function looksLikeVault(dir: string) {
  try {
    if (!statSync(dir).isDirectory()) return false;
    if (existsSync(path.join(dir, '.obsidian'))) return true;
    // basta uma nota .md na pasta ou numa subpasta direta (sem varrer o Drive inteiro)
    const top = readdirSync(dir, { withFileTypes: true });
    if (top.some((e) => e.isFile() && /\.md$/i.test(e.name))) return true;
    return top.filter((e) => e.isDirectory() && !IGNORE_DIR(e.name)).slice(0, 40)
      .some((e) => { try { return readdirSync(path.join(dir, e.name)).some((n) => /\.md$/i.test(n)); } catch { return false; } });
  } catch { return false; }
}
