import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Client, Office } from '@office/shared';

/**
 * Pasta do cliente no padrão da casa (o mesmo da skill organizar-pasta). O Office só cria pastas que faltam:
 * nunca move, renomeia nem apaga nada do que já existe.
 */
export const STANDARD_DIRS = [
  'DOCUMENTOS/IDENTIDADE VISUAL', 'DOCUMENTOS/ARTES', 'DOCUMENTOS/LOGOS', 'DOCUMENTOS/PDFS',
  'FOTOS/BRUTAS', 'FOTOS/EDITADAS',
  'VIDEOS/BRUTOS', 'VIDEOS/EDITADOS', 'VIDEOS/REFERENCIAS',
];

/** Nome de pasta seguro para o Windows, em caixa alta como as pastas da casa. */
export const folderName = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 60) || 'CLIENTE';

/** Caminho absoluto da pasta do cliente (a pasta pode ser relativa à raiz do escritório). */
export function clientDir(office: Office, client: Pick<Client, 'folder'>) {
  if (!client.folder) return null;
  return path.isAbsolute(client.folder) ? client.folder : path.join(office.rootPath, client.folder);
}

/** Cria as subpastas que faltam. Devolve as que foram criadas agora. */
export function ensureStructure(dir: string) {
  const created: string[] = [];
  for (const rel of STANDARD_DIRS) {
    const p = path.join(dir, ...rel.split('/'));
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true });
      created.push(rel);
    }
  }
  return created;
}

/** Grava um arquivo novo sem sobrescrever: se o nome existir, ganha a data e um número. */
export function writeNew(dir: string, name: string, content: string) {
  mkdirSync(dir, { recursive: true });
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let file = path.join(dir, name);
  const stamp = new Date().toISOString().slice(0, 10);
  for (let i = 1; existsSync(file); i++) file = path.join(dir, `${base} ${stamp}${i > 1 ? ` (${i})` : ''}${ext}`);
  writeFileSync(file, content, 'utf8');
  return file;
}

// ---------------------------------------------------------------- índice de arquivos

export type FileKind = 'imagem' | 'video' | 'audio' | 'doc' | 'design' | 'outro';
export interface IndexedFile { rel: string; size: number; mtime: string; kind: FileKind }
export interface FileGroup { key: string; label: string; count: number; size: number; files: IndexedFile[] }
export interface ClientIndex { root: string; exists: boolean; total: number; truncated: boolean; groups: FileGroup[]; scannedAt: string }

const EXT: Record<string, FileKind> = {};
for (const e of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'dng', 'orf', 'rw2']) EXT[e] = 'imagem';
for (const e of ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'mts']) EXT[e] = 'video';
for (const e of ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']) EXT[e] = 'audio';
for (const e of ['pdf', 'md', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'json']) EXT[e] = 'doc';
for (const e of ['psd', 'ai', 'svg', 'eps', 'fig', 'indd', 'xd', 'afdesign', 'afphoto', 'fcproj', 'prproj']) EXT[e] = 'design';

export const kindOf = (file: string): FileKind => EXT[path.extname(file).slice(1).toLowerCase()] ?? 'outro';

/** Grupos do índice, na ordem em que aparecem; o primeiro que casar com o caminho leva o arquivo. */
const GROUPS: { key: string; label: string; test: (rel: string, kind: FileKind) => boolean }[] = [
  { key: 'idv', label: 'Identidade visual', test: (r) => /(^|\/)IDENTIDADE VISUAL\//i.test(r) },
  { key: 'logos', label: 'Logos', test: (r) => /(^|\/)LOGOS?\//i.test(r) || /logo/i.test(path.basename(r)) },
  { key: 'ensaio', label: 'Ensaio e fotos brutas', test: (r, k) => k === 'imagem' && /^FOTOS\//i.test(r) && !/\/EDITADAS?\//i.test(r) },
  { key: 'fotos-editadas', label: 'Fotos editadas', test: (r) => /^FOTOS\/.*EDITADAS?\//i.test(r) },
  { key: 'brutos', label: 'Vídeos brutos', test: (r) => /^VIDEOS\/BRUTOS\//i.test(r) },
  { key: 'referencias', label: 'Referências', test: (r) => /REFERENCIAS?\//i.test(r) },
  { key: 'editados', label: 'Vídeos editados', test: (r) => /^VIDEOS\/EDITADOS\//i.test(r) },
  { key: 'musicas', label: 'Músicas', test: (r, k) => k === 'audio' || /MUSICAS?\//i.test(r) },
  { key: 'artes', label: 'Artes', test: (r) => /(^|\/)ARTES\//i.test(r) },
  { key: 'documentos', label: 'Documentos e briefing', test: (r, k) => k === 'doc' },
  { key: 'outros', label: 'Outros arquivos', test: () => true },
];

const SKIP = new Set(['node_modules', '.git', '.office', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_FILES = 5000;
const PER_GROUP = 40;

export function indexClient(dir: string): ClientIndex {
  const res: ClientIndex = { root: dir, exists: existsSync(dir), total: 0, truncated: false, groups: [], scannedAt: new Date().toISOString() };
  if (!res.exists) return res;
  const groups = new Map<string, FileGroup>(GROUPS.map((g) => [g.key, { key: g.key, label: g.label, count: 0, size: 0, files: [] }]));
  const walk = (abs: string, rel: string, depth: number) => {
    if (depth > 6 || res.total >= MAX_FILES) { res.truncated ||= res.total >= MAX_FILES; return; }
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) { walk(childAbs, childRel, depth + 1); continue; }
      if (!e.isFile() || res.total >= MAX_FILES) continue;
      let st;
      try { st = statSync(childAbs); } catch { continue; }
      const kind = kindOf(e.name);
      const g = groups.get(GROUPS.find((x) => x.test(childRel, kind))!.key)!;
      g.count++;
      g.size += st.size;
      g.files.push({ rel: childRel, size: st.size, mtime: st.mtime.toISOString(), kind });
      res.total++;
    }
  };
  walk(dir, '', 0);
  for (const g of groups.values()) {
    // os mais recentes primeiro
    g.files.sort((a, b) => b.mtime.localeCompare(a.mtime));
    g.files = g.files.slice(0, PER_GROUP);
    if (g.count) res.groups.push(g);
  }
  return res;
}

/** Resumo do índice para os funcionários de IA saberem onde está cada coisa. */
export function indexSummary(idx: ClientIndex) {
  if (!idx.exists) return `A pasta ${idx.root} ainda não existe.`;
  if (!idx.total) return `A pasta ${idx.root} está vazia (só a estrutura padrão).`;
  const lines = idx.groups.map((g) => {
    const ex = g.files.slice(0, 4).map((f) => f.rel).join(', ');
    return `- ${g.label}: ${g.count} arquivo(s)${ex ? `, ex.: ${ex}` : ''}`;
  });
  return `Pasta: ${idx.root}\n${lines.join('\n')}${idx.truncated ? '\n(índice parcial: pasta muito grande)' : ''}`;
}

/** O caminho relativo pedido fica dentro da pasta do cliente? (evita ../ e caminhos absolutos) */
export function insideDir(dir: string, rel: string) {
  const abs = path.resolve(dir, rel);
  const root = path.resolve(dir);
  return abs.startsWith(root + path.sep) ? abs : null;
}
