import { existsSync, readFileSync, statSync } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Client, MoodboardItem, MoodboardSummary, MoodboardTheme, Office } from '@office/shared';
import { clientDir, isFolder } from './folder.ts';
import { clientPaths } from './layout.ts';
import { refsRoot } from './references.ts';

/**
 * Moodboards: um por nicho, da biblioteca da agência (REFERENCIAS\<segmento> + indice.json, mantidos pela skill
 * arte-referencia), e um por cliente, das pastas de referência dele e dos tokens de marca. Só lê: nada aqui grava em disco.
 */

interface IndexRef {
  id: string; segmento: string; arquivo: string; origem?: string; layout?: string; tema?: string; pessoa?: boolean;
  tags?: string[]; paleta?: string[]; tamanho?: [number, number]; nota?: number | null; obs?: string;
}

const NICHE_LABEL: Record<string, string> = { 'saude-estetica': 'Saúde e estética', juridico: 'Jurídico', imobiliario: 'Imobiliário', comida: 'Comida' };
/**
 * Tipografia de cada nicho (Google Fonts, abertas), para o moodboard ter o clima dele mesmo sem marca definida.
 * Ordem: a escolhida pela equipe (indice.json > nichos), a da tabela, a que combina com o nome do nicho e, por fim,
 * uma da lista fixa pelo nome, para dois nichos novos não saírem iguais.
 */
export const NICHE_FONTS: Record<string, { title: string; body: string }> = {
  'saude-estetica': { title: 'Playfair Display', body: 'Lato' },
  juridico: { title: 'Cormorant Garamond', body: 'Source Sans 3' },
  imobiliario: { title: 'Urbanist', body: 'Inter' },
  comida: { title: 'Fraunces', body: 'Nunito Sans' },
  'saas-ia': { title: 'Space Grotesk', body: 'Inter' },
  'unhas-beleza': { title: 'Bodoni Moda', body: 'Jost' },
  'founder-tech': { title: 'Sora', body: 'Inter' },
  psicologia: { title: 'Lora', body: 'Nunito' },
  'propostas-comerciais': { title: 'Manrope', body: 'Manrope' },
  sites: { title: 'Syne', body: 'DM Sans' },
  eventos: { title: 'Bebas Neue', body: 'Barlow' },
};
const BY_WORD: [RegExp, { title: string; body: string }][] = [
  [/tech|ia\b|saas|startup|software|app/, NICHE_FONTS['saas-ia']],
  [/beleza|unha|moda|estetic|cabel|make/, NICHE_FONTS['unhas-beleza']],
  [/comida|food|restaur|doce|bolo|bar\b|cafe/, NICHE_FONTS.comida],
  [/advoc|jurid|direito/, NICHE_FONTS.juridico],
  [/imov|imobil|arquit|constru|interior/, NICHE_FONTS.imobiliario],
  [/saude|clinic|odont|medic|dent/, NICHE_FONTS['saude-estetica']],
  [/psic|terap|bem-estar|coach/, NICHE_FONTS.psicologia],
  [/evento|show|festa|music/, NICHE_FONTS.eventos],
  [/fitness|academia|esporte|treino/, { title: 'Oswald', body: 'Roboto' }],
  [/educa|curso|escola|mentor/, { title: 'Merriweather', body: 'Open Sans' }],
];
const POOL = ['DM Serif Display', 'Archivo Black', 'Libre Baskerville', 'Outfit', 'Abril Fatface', 'Plus Jakarta Sans', 'Instrument Serif', 'Unbounded'];
export function nicheFont(niche: string, chosen?: { titulo?: string; texto?: string } | null) {
  const known = NICHE_FONTS[niche] ?? BY_WORD.find(([re]) => re.test(niche))?.[1];
  const pooled = POOL[[...niche].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % POOL.length];
  const base = known ?? { title: pooled, body: 'Inter' };
  return { title: chosen?.titulo || base.title, body: chosen?.texto || base.body };
}
const nicheLabel = (id: string) => NICHE_LABEL[id] ?? id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const IMAGE = /\.(png|jpe?g|webp)$/i;
const MIN_BYTES = 30 * 1024; // abaixo disso costuma ser ícone de página salva, não referência
const MAX_ITEMS = 120;
const COVERS = 6;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => { const [r, g, b] = rgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const sat = (hex: string) => { const c = rgb(hex); const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };
const dist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

/** Tema medido nas paletas das referências: as cores mais frequentes, a de fundo e a de destaque. */
export function themeFrom(colors: string[], dark: boolean, font: string | null): MoodboardTheme {
  const count = new Map<string, number>();
  for (const c of colors.filter(isHex)) {
    const key = `#${rgb(c).map((v) => ((v >> 4) * 17).toString(16).padStart(2, '0')).join('')}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const swatches: string[] = [];
  for (const c of [...count.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])) {
    if (swatches.length < 6 && swatches.every((s) => dist(s, c) > 48)) swatches.push(c);
  }
  if (!swatches.length) swatches.push(dark ? '#1c1a19' : '#f4f1ec');
  const byLum = [...swatches].sort((a, b) => lum(a) - lum(b));
  const bg = dark ? (lum(byLum[0]) < 0.3 ? byLum[0] : '#161412') : (lum(byLum.at(-1)!) > 0.75 ? byLum.at(-1)! : '#f6f3ee');
  const fg = lum(bg) < 0.5 ? '#f6f2ec' : '#1b1917';
  const contrasting = swatches.filter((c) => Math.abs(lum(c) - lum(bg)) > 0.3);
  const accent = [...contrasting].sort((a, b) => sat(b) - sat(a))[0] ?? fg;
  return { bg, fg, accent, swatches, titleFont: font, bodyFont: null };
}

// ---------------------------------------------------------------- biblioteca por nicho

type Index = { refs: IndexRef[]; nichos: Record<string, { titulo?: string; texto?: string }> };
const indexes = new Map<string, { mtime: number; size: number; index: Index }>();
/** Lido de novo s\u00F3 quando o arquivo muda: a lista consulta o \u00EDndice uma vez por nicho e por cliente. */
function indexOf(office: Office): Index {
  const file = path.join(refsRoot(office), 'indice.json');
  let st;
  try { st = statSync(file); } catch { return { refs: [], nichos: {} }; }
  const hit = indexes.get(file);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.index;
  let index: Index;
  try {
    const ind = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    index = { refs: Array.isArray(ind.refs) ? ind.refs : [], nichos: ind.nichos && typeof ind.nichos === 'object' ? ind.nichos : {} };
  } catch {
    return { refs: [], nichos: {} };
  }
  indexes.set(file, { mtime: st.mtimeMs, size: st.size, index });
  return index;
}
const libraryOf = (office: Office) => indexOf(office).refs;

const refFile = (office: Office, r: IndexRef) => path.join(refsRoot(office), ...String(r.arquivo).split(/[\\/]/));
const score = (r: IndexRef) => r.nota ?? 0;

function toItem(office: Office, r: IndexRef): MoodboardItem {
  return {
    id: r.id, file: refFile(office, r), layout: r.layout ?? null, tema: r.tema ?? null, tags: r.tags ?? [], paleta: (r.paleta ?? []).filter(isHex),
    nota: r.nota ?? null, obs: r.obs ?? '', origem: r.origem ?? '', width: r.tamanho?.[0] ?? null, height: r.tamanho?.[1] ?? null, group: null,
  };
}

const nicheCache = new Map<string, { at: number; refs: IndexRef[] }>();
const nicheScans = new Map<string, Promise<IndexRef[]>>();
/**
 * Guardado por 30 s (ou até o índice mudar): a lista passa por todos os nichos e clientes, e conferir as ~800 referências no
 * Drive a cada passada travava o servidor.
 */
async function nicheItems(office: Office, niche: string): Promise<IndexRef[]> {
  let mtime = 0;
  try { mtime = statSync(path.join(refsRoot(office), 'indice.json')).mtimeMs; } catch { /* sem índice */ }
  const key = `${office.rootPath}|${niche}|${mtime}`;
  const hit = nicheCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.refs;
  const pending = nicheScans.get(key);
  if (pending) return pending;
  const scan = (async () => {
    const lib = libraryOf(office).filter((r) => r.segmento === niche && !r.arquivo.split(/[\\/]/).includes('..'));
    const ok = await Promise.all(lib.map((r) => access(refFile(office, r)).then(() => true, () => false)));
    const refs = lib.filter((_, i) => ok[i]).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    for (const [k, v] of nicheCache) if (Date.now() - v.at >= 30_000) nicheCache.delete(k);
    nicheCache.set(key, { at: Date.now(), refs });
    return refs;
  })().finally(() => nicheScans.delete(key));
  nicheScans.set(key, scan);
  return scan;
}

function nicheTheme(refs: IndexRef[], niche: string, office?: Office) {
  const dark = refs.filter((r) => r.tema === 'escuro').length >= refs.filter((r) => r.tema === 'claro').length;
  const f = nicheFont(niche, office ? indexOf(office).nichos[niche] : null);
  return { ...themeFrom(refs.flatMap((r) => r.paleta ?? []), dark, f.title), bodyFont: f.body };
}

// ---------------------------------------------------------------- por cliente

interface Marca { cores?: Record<string, string>; fontes?: { titulo?: string; apoio?: string }; segmento?: string; nome?: string; handle?: string }

function marcaOf(dir: string | null): Marca | null {
  const file = dir && clientPaths(dir).marca;
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

const CACHE_MS = 30_000;
type RefFile = { file: string; rel: string; mtime: number };
const scans = new Map<string, { at: number; files: RefFile[] }>();
const walking = new Map<string, Promise<RefFile[]>>();

/**
 * Imagens dentro de qualquer pasta de referência do cliente, das mais novas para as mais antigas. Assíncrono: no Drive, varrer
 * as pastas dos clientes leva dezenas de segundos e, síncrono, travava o Office inteiro. Com `allowStale`, devolve a última
 * varredura na hora e atualiza por trás (a lista de moodboards); sem, espera a varredura nova (o quadro aberto).
 */
async function clientRefs(dir: string | null, allowStale = false): Promise<RefFile[]> {
  if (!dir) return [];
  const cached = scans.get(dir);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.files;
  const scan = walking.get(dir) ?? walkRefs(dir);
  walking.set(dir, scan);
  if (cached && allowStale) { scan.catch(() => {}); return cached.files; }
  return scan;
}

function walkRefs(dir: string) {
  const files: RefFile[] = [];
  const walk = async (abs: string, rel: string, depth: number, inside: boolean): Promise<void> => {
    if (depth > 8) return;
    let entries;
    try { entries = await readdir(abs, { withFileTypes: true }); } catch { return; }
    const subs: Promise<void>[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || /_files$|^_trabalho$|^_apagados$|^node_modules$/i.test(e.name)) continue;
      const full = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      // a pasta começa com o nome: "TESTE ARTE-REFERENCIA", por exemplo, é trabalho da skill, não referência
      if (isFolder(e, full)) subs.push(walk(full, childRel, depth + 1, inside || /^REFER[EÊ]NCIAS?\b/i.test(e.name)));
      else if (inside && e.isFile() && IMAGE.test(e.name)) {
        subs.push(stat(full).then((st) => { if (st.size >= MIN_BYTES) files.push({ file: full, rel: childRel, mtime: st.mtimeMs }); }, () => {}));
      }
    }
    await Promise.all(subs);
  };
  return walk(dir, '', 0, false).then(() => {
    files.sort((a, b) => b.mtime - a.mtime || a.rel.localeCompare(b.rel));
    scans.set(dir, { at: Date.now(), files });
    return files;
  }).finally(() => walking.delete(dir));
}

/** Nicho do cliente: o escolhido no Office, o da marca ou o que dá para deduzir do nome e da pasta. */
export function nicheOf(office: Office, client: Client) {
  const known = new Set(libraryOf(office).map((r) => r.segmento));
  if (client.niche) return client.niche;
  const marca = marcaOf(clientDir(office, client));
  if (marca?.segmento && known.has(marca.segmento)) return marca.segmento;
  const text = `${client.name} ${client.folder ?? ''} ${marca?.segmento ?? ''} ${client.briefing?.segmento ?? ''}`;
  const guess = /advoc|jur[ií]d|direito|\bdr\.? .*oab/i.test(text) ? 'juridico'
    : /im[oó]v|imobili|corretor|realty/i.test(text) ? 'imobiliario'
    : /odonto|dent|cl[ií]nic|est[eé]tic|dermat|m[eé]dic|sa[uú]de|\bdra?\b/i.test(text) ? 'saude-estetica'
    : null;
  return guess && known.has(guess) ? guess : null;
}

async function clientTheme(office: Office, client: Client, marca: Marca | null, niche: string | null): Promise<MoodboardTheme> {
  const c = marca?.cores;
  if (c && isHex(c.escuro) && isHex(c.claro)) {
    const swatches = [c.escuro, c.claro, c.acento, c.acento2, c.neutro].filter(isHex);
    return { bg: c.escuro, fg: c.claro, accent: isHex(c.acento) ? c.acento : c.claro, swatches, titleFont: marca?.fontes?.titulo ?? null, bodyFont: marca?.fontes?.apoio ?? null };
  }
  const base = nicheTheme(niche ? await nicheItems(office, niche) : [], niche ?? '', office);
  return isHex(client.color) && Math.abs(lum(client.color) - lum(base.bg)) > 0.3 ? { ...base, accent: client.color } : base;
}

// ---------------------------------------------------------------- saídas

export async function moodboardList(office: Office, clients: Client[]): Promise<{ niches: MoodboardSummary[]; clients: MoodboardSummary[] }> {
  const library = libraryOf(office);
  const nicheIds = [...new Set(library.map((r) => r.segmento))].sort();
  const niches = await Promise.all(nicheIds.map(async (id): Promise<MoodboardSummary> => {
    const refs = await nicheItems(office, id);
    return { key: `nicho:${id}`, name: nicheLabel(id), count: refs.length, theme: nicheTheme(refs, id, office), covers: refs.slice(0, COVERS).map((r) => refFile(office, r)), niche: id };
  }));
  const list = await Promise.all(clients.filter((c) => c.status !== 'encerrado').map(async (c): Promise<MoodboardSummary> => {
    const dir = clientDir(office, c);
    const niche = nicheOf(office, c);
    const [own, fromNiche, theme] = await Promise.all([clientRefs(dir, true), niche ? nicheItems(office, niche) : [], clientTheme(office, c, marcaOf(dir), niche)]);
    return {
      key: `cliente:${c.id}`, name: c.name, count: own.length, theme, niche,
      covers: [...own.map((f) => f.file), ...fromNiche.map((r) => refFile(office, r))].slice(0, COVERS),
    };
  }));
  return { niches, clients: list };
}

export async function nicheBoard(office: Office, niche: string) {
  const refs = await nicheItems(office, niche);
  if (!refs.length) return null;
  return { key: `nicho:${niche}`, name: nicheLabel(niche), niche, folder: path.join(refsRoot(office), niche), theme: nicheTheme(refs, niche, office), handle: null, items: refs.map((r) => toItem(office, r)), nicheItems: [] as MoodboardItem[] };
}

export async function clientBoard(office: Office, client: Client) {
  const dir = clientDir(office, client);
  const marca = marcaOf(dir);
  const niche = nicheOf(office, client);
  const [own, fromNiche, theme] = await Promise.all([clientRefs(dir), niche ? nicheItems(office, niche) : [], clientTheme(office, client, marca, niche)]);
  const items = own.slice(0, MAX_ITEMS).map((f): MoodboardItem => ({
    id: f.rel, file: f.file, layout: null, tema: null, tags: [], paleta: [], nota: null, obs: '', origem: '', width: null, height: null,
    group: f.rel.split('/').slice(0, -1).at(-1) ?? null,
  }));
  return {
    key: `cliente:${client.id}`, name: client.name, niche, folder: dir, theme, handle: marca?.handle ?? null, items,
    nicheItems: fromNiche.slice(0, 36).map((r) => toItem(office, r)),
  };
}
