import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Client, Office } from '@office/shared';
import { clientDriveFolder } from './drive.ts';
import { driveFolderLink, driveLink } from './driveId.ts';
import { clientDir, insideDir, kindOf, type FileKind } from './folder.ts';
import { clientPaths, layoutMap } from './layout.ts';

/**
 * Pastas do cliente como estão no Drive, para ver tudo organizado sem abrir o Drive: uma pasta por vez, com as
 * subpastas primeiro (meses do mais novo para o mais antigo) e os arquivos depois. Apagar fica em deleteEntries, no fim.
 */

export interface FolderEntry { name: string; rel: string; dir: boolean; size: number; mtime: string; kind: FileKind | 'pasta'; items?: number }

/** Arquivo de sistema e temporário não aparece. */
const HIDDEN = /^(\.|~\$|desktop\.ini$|thumbs\.db$|\.ds_store$)|\.(tmp|crdownload|part)$/i;
const MONTH = /^\d{4}-\d{2}\b/;

/** A pasta do cliente: a do Drive quando existe, senão a do cadastro. */
export function clientBase(office: Office, client: Client) {
  if (office.driveRoot) {
    const drive = path.join(office.driveRoot, clientDriveFolder(office.driveRoot, client));
    if (existsSync(drive)) return drive;
  }
  return clientDir(office, client);
}

/** `rel` vazio é a raiz do cliente; fora dela é recusado. */
export function resolveRel(base: string, rel: string) {
  const clean = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return clean ? insideDir(base, clean) : path.resolve(base);
}

export function listFolder(base: string, rel: string) {
  const dir = resolveRel(base, rel);
  if (!dir) return null;
  const cleanRel = path.relative(base, dir).split(path.sep).filter(Boolean).join('/');
  const crumbs = cleanRel ? cleanRel.split('/').map((name, i, all) => ({ name, rel: all.slice(0, i + 1).join('/') })) : [];
  if (!existsSync(dir)) return { base, rel: cleanRel, crumbs, exists: false, entries: [] as FolderEntry[] };
  const entries: FolderEntry[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN.test(e.name)) continue;
    const abs = path.join(dir, e.name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    const isDir = st.isDirectory();
    let items: number | undefined;
    if (isDir) { try { items = readdirSync(abs).filter((n) => !HIDDEN.test(n)).length; } catch { items = undefined; } }
    entries.push({
      name: e.name, rel: cleanRel ? `${cleanRel}/${e.name}` : e.name, dir: isDir,
      size: isDir ? 0 : st.size, mtime: st.mtime.toISOString(), kind: isDir ? 'pasta' : kindOf(e.name), items,
    });
  }
  const byName = (a: FolderEntry, b: FolderEntry) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
  entries.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    // pastas de mês: a mais nova primeiro
    if (a.dir && MONTH.test(a.name) && MONTH.test(b.name)) return b.name.localeCompare(a.name);
    return byName(a, b);
  });
  return { base, rel: cleanRel, crumbs, exists: true, entries };
}

/** Atalhos no topo: o mês atual e o anterior, a identidade visual e os trabalhos, quando existem. */
export function shortcuts(office: Office, base: string, today = new Date()) {
  const paths = clientPaths(base, layoutMap(office.rootPath));
  const month = (d: Date) => paths.abs('mes', { mes: d });
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const out: { label: string; rel: string }[] = [];
  const add = (label: string, abs: string) => {
    if (!existsSync(abs)) return;
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (rel && !rel.startsWith('..') && !out.some((s) => s.rel === rel)) out.push({ label, rel });
  };
  add('Este mês', month(today));
  add('Mês passado', month(prev));
  add('Identidade visual', paths.abs('idv_kit'));
  add('Trabalhos', paths.abs('trabalhos'));
  return out;
}

/** Link do Drive da pasta ou do arquivo, quando o Drive para computador já sincronizou. */
export function linkOf(base: string, rel: string) {
  const abs = resolveRel(base, rel);
  if (!abs || !existsSync(abs)) return null;
  return statSync(abs).isDirectory() ? driveFolderLink(abs) : driveLink(abs);
}

/**
 * Apagar pelo Office (aba Arquivos do cliente e página Arquivos). No Drive montado, apagar manda para a lixeira do
 * Google Drive, que guarda por 30 dias; fora do Drive, o item vai para a lixeira do Office (`dados\lixeira`), nunca some
 * de vez. A raiz do cliente e as pastas de primeiro nível (REDES SOCIAIS, ARQUIVOS – …) não podem ser apagadas.
 */
export function deleteEntries(base: string, rels: string[], opts: { driveRoot: string | null; trashDir: string; logFile: string; by: string; client: string }) {
  const onDrive = !!opts.driveRoot && isInside(opts.driveRoot, base);
  const done: string[] = [];
  const refused: { rel: string; why: string }[] = [];
  for (const rel of [...new Set(rels)]) {
    const abs = resolveRel(base, rel);
    const clean = abs ? path.relative(base, abs).split(path.sep).filter(Boolean) : [];
    if (!abs || !clean.length) { refused.push({ rel, why: 'fora da pasta do cliente' }); continue; }
    if (!existsSync(abs)) { refused.push({ rel, why: 'não existe mais' }); continue; }
    const isDir = statSync(abs).isDirectory();
    if (isDir && clean.length === 1) { refused.push({ rel, why: 'pasta principal do cliente' }); continue; }
    try {
      if (onDrive) rmSync(abs, { recursive: true, force: false });
      else {
        const to = path.join(opts.trashDir, new Date().toISOString().slice(0, 10), opts.client.replace(/[<>:"/\|?*]/g, '_'), ...clean);
        mkdirSync(path.dirname(to), { recursive: true });
        try { renameSync(abs, to); } catch { cpSync(abs, to, { recursive: true }); rmSync(abs, { recursive: true }); }
      }
      done.push(clean.join('/'));
      appendFileSync(opts.logFile, JSON.stringify({ quando: new Date().toISOString(), quem: opts.by, cliente: opts.client, caminho: abs, pasta: isDir, destino: onDrive ? 'lixeira do Google Drive' : 'lixeira do Office' }) + '\n');
    } catch (e) { refused.push({ rel, why: (e as Error).message }); }
  }
  return { deleted: done, refused, trash: onDrive ? 'drive' : 'office' };
}

function isInside(parent: string, child: string) {
  const r = path.relative(path.resolve(parent), path.resolve(child));
  return !r.startsWith('..') && !path.isAbsolute(r);
}
