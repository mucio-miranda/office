import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Client, MoodboardItem, MoodboardSummary, MoodboardTheme, Office } from '@office/shared';
import { clientDir } from './folder.ts';

/**
 * Moodboards: um por nicho, da biblioteca da agência (REFERENCIAS\<segmento> + indice.json, mantidos pela skill
 * arte-referencia), e um por cliente, das pastas de referência dele e dos tokens de marca. Só lê: nada aqui grava em disco.
 */

interface IndexRef {
  id: string; segmento: string; arquivo: string; origem?: string; layout?: string; tema?: string; pessoa?: boolean;
  tags?: string[]; paleta?: string[]; tamanho?: [number, number]; nota?: number | null; obs?: string;
}

const NICHE_LABEL: Record<string, string> = { 'saude-estetica': 'Saúde e estética', juridico: 'Jurídico', imobiliario: 'Imobiliário', comida: 'Comida' };
/** Título de cada nicho, para o moodboard ter o clima dele mesmo sem marca definida. */
const NICHE_FONT: Record<string, string> = { 'saude-estetica': 'Playfair Display', juridico: 'Cormorant Garamond', imobiliario: 'Urbanist', comida: 'Fraunces' };
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

function libraryOf(office: Office): IndexRef[] {
  const file = path.join(office.rootPath, 'REFERENCIAS', 'indice.json');
  if (!existsSync(file)) return [];
  try {
    const refs = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')).refs;
    return Array.isArray(refs) ? refs : [];
  } catch {
    return [];
  }
}

const refFile = (office: Office, r: IndexRef) => path.join(office.rootPath, 'REFERENCIAS', ...String(r.arquivo).split(/[\\/]/));
const score = (r: IndexRef) => r.nota ?? 0;

function toItem(office: Office, r: IndexRef): MoodboardItem {
  return {
    id: r.id, file: refFile(office, r), layout: r.layout ?? null, tema: r.tema ?? null, tags: r.tags ?? [], paleta: (r.paleta ?? []).filter(isHex),
    nota: r.nota ?? null, obs: r.obs ?? '', origem: r.origem ?? '', width: r.tamanho?.[0] ?? null, height: r.tamanho?.[1] ?? null, group: null,
  };
}

function nicheItems(office: Office, niche: string) {
  return libraryOf(office)
    .filter((r) => r.segmento === niche && !r.arquivo.split(/[\\/]/).includes('..') && existsSync(refFile(office, r)))
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
}

function nicheTheme(refs: IndexRef[], niche: string) {
  const dark = refs.filter((r) => r.tema === 'escuro').length >= refs.filter((r) => r.tema === 'claro').length;
  return themeFrom(refs.flatMap((r) => r.paleta ?? []), dark, NICHE_FONT[niche] ?? 'Playfair Display');
}

// ---------------------------------------------------------------- por cliente

interface Marca { cores?: Record<string, string>; fontes?: { titulo?: string; apoio?: string }; segmento?: string; nome?: string; handle?: string }

function marcaOf(dir: string | null): Marca | null {
  const file = dir && path.join(dir, 'DOCUMENTOS', 'IDENTIDADE VISUAL', 'marca.json');
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

const CACHE_MS = 30_000;
const scans = new Map<string, { at: number; files: { file: string; rel: string; mtime: number }[] }>();

/** Imagens dentro de qualquer pasta de referência do cliente, das mais novas para as mais antigas. */
function clientRefs(dir: string | null) {
  if (!dir || !existsSync(dir)) return [];
  const cached = scans.get(dir);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.files;
  const files: { file: string; rel: string; mtime: number }[] = [];
  const walk = (abs: string, rel: string, depth: number, inside: boolean) => {
    if (depth > 8) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || /_files$|^_trabalho$|^node_modules$/i.test(e.name)) continue;
      const full = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      // a pasta começa com o nome: "TESTE ARTE-REFERENCIA", por exemplo, é trabalho da skill, não referência
      if (e.isDirectory()) walk(full, childRel, depth + 1, inside || /^REFER[EÊ]NCIAS?\b/i.test(e.name));
      else if (inside && e.isFile() && IMAGE.test(e.name)) {
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.size >= MIN_BYTES) files.push({ file: full, rel: childRel, mtime: st.mtimeMs });
      }
    }
  };
  walk(dir, '', 0, false);
  files.sort((a, b) => b.mtime - a.mtime);
  scans.set(dir, { at: Date.now(), files });
  return files;
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

function clientTheme(office: Office, client: Client, marca: Marca | null, niche: string | null): MoodboardTheme {
  const c = marca?.cores;
  if (c && isHex(c.escuro) && isHex(c.claro)) {
    const swatches = [c.escuro, c.claro, c.acento, c.acento2, c.neutro].filter(isHex);
    return { bg: c.escuro, fg: c.claro, accent: isHex(c.acento) ? c.acento : c.claro, swatches, titleFont: marca?.fontes?.titulo ?? null, bodyFont: marca?.fontes?.apoio ?? null };
  }
  const base = nicheTheme(niche ? nicheItems(office, niche) : [], niche ?? '');
  return isHex(client.color) && Math.abs(lum(client.color) - lum(base.bg)) > 0.3 ? { ...base, accent: client.color } : base;
}

// ---------------------------------------------------------------- saídas

export function moodboardList(office: Office, clients: Client[]): { niches: MoodboardSummary[]; clients: MoodboardSummary[] } {
  const library = libraryOf(office);
  const nicheIds = [...new Set(library.map((r) => r.segmento))].sort();
  const niches = nicheIds.map((id): MoodboardSummary => {
    const refs = nicheItems(office, id);
    return { key: `nicho:${id}`, name: nicheLabel(id), count: refs.length, theme: nicheTheme(refs, id), covers: refs.slice(0, COVERS).map((r) => refFile(office, r)), niche: id };
  });
  const list = clients.filter((c) => c.status !== 'encerrado').map((c): MoodboardSummary => {
    const dir = clientDir(office, c);
    const niche = nicheOf(office, c);
    const own = clientRefs(dir);
    const fromNiche = niche ? nicheItems(office, niche) : [];
    return {
      key: `cliente:${c.id}`, name: c.name, count: own.length, theme: clientTheme(office, c, marcaOf(dir), niche), niche,
      covers: [...own.map((f) => f.file), ...fromNiche.map((r) => refFile(office, r))].slice(0, COVERS),
    };
  });
  return { niches, clients: list };
}

export function nicheBoard(office: Office, niche: string) {
  const refs = nicheItems(office, niche);
  if (!refs.length) return null;
  return { key: `nicho:${niche}`, name: nicheLabel(niche), niche, folder: path.join(office.rootPath, 'REFERENCIAS', niche), theme: nicheTheme(refs, niche), handle: null, items: refs.map((r) => toItem(office, r)), nicheItems: [] as MoodboardItem[] };
}

export function clientBoard(office: Office, client: Client) {
  const dir = clientDir(office, client);
  const marca = marcaOf(dir);
  const niche = nicheOf(office, client);
  const items = clientRefs(dir).slice(0, MAX_ITEMS).map((f): MoodboardItem => ({
    id: f.rel, file: f.file, layout: null, tema: null, tags: [], paleta: [], nota: null, obs: '', origem: '', width: null, height: null,
    group: f.rel.split('/').slice(0, -1).at(-1) ?? null,
  }));
  return {
    key: `cliente:${client.id}`, name: client.name, niche, folder: dir, theme: clientTheme(office, client, marca, niche), handle: marca?.handle ?? null, items,
    nicheItems: niche ? nicheItems(office, niche).slice(0, 36).map((r) => toItem(office, r)) : [],
  };
}
