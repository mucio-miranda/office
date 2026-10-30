import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statfsSync, statSync } from 'node:fs';
import { constants, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Client } from '@office/shared';
import { folderName, insideDir, kindOf, type FileKind } from './folder.ts';

/**
 * Envio do trabalho aprovado para o Drive: a pasta do Drive montada no Windows (Google Drive para computador).
 * O envio só acontece quando uma pessoa aperta o botão. Só copia: nunca sobrescreve, move nem apaga nada lá.
 */

const SUB_BY_KIND: Record<FileKind, string> = {
  imagem: 'DOCUMENTOS/ARTES', design: 'DOCUMENTOS/ARTES', video: 'VIDEOS/EDITADOS', audio: 'VIDEOS/MUSICAS', doc: 'DOCUMENTOS/PDFS', outro: 'DOCUMENTOS',
};

/** A pasta do Drive está acessível? E quanto cabe nela (a cota da conta aparece como espaço livre do disco). */
export function driveInfo(root: string | null) {
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) return { root, ok: false, free: 0 };
  const st = statfsSync(root);
  return { root, ok: true, free: st.bavail * st.bsize };
}

/** Subpastas de uma pasta do Drive. Uma pasta que ainda não existe (vai ser criada no envio) lista vazio. */
export function driveDirs(root: string, rel: string) {
  const clean = rel.split(/[\\/]+/).filter(Boolean).join('/');
  const abs = clean ? insideDir(root, clean) : path.resolve(root);
  if (!abs) return null;
  const dirs = existsSync(abs)
    ? readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$')).map((e) => e.name).sort((a, b) => a.localeCompare(b))
    : [];
  return { rel: clean, parent: clean ? clean.split('/').slice(0, -1).join('/') : null, dirs };
}

/** Pasta do cliente no Drive: a do último envio, a que tem o nome dele (até duas pastas abaixo) ou uma nova em CLIENTES. */
export function clientDriveFolder(root: string, client: Pick<Client, 'name' | 'driveFolder'> | undefined) {
  if (!client) return '';
  if (client.driveFolder && insideDir(root, client.driveFolder) && existsSync(path.join(root, client.driveFolder))) return client.driveFolder;
  const want = folderName(client.name);
  const subdirs = (rel: string) => driveDirs(root, rel)?.dirs.map((d) => (rel ? `${rel}/${d}` : d)) ?? [];
  const same = (rel: string) => folderName(rel.split('/').pop()!) === want;
  const first = subdirs('');
  const second = first.flatMap(subdirs);
  const found = [...first, ...second, ...second.flatMap(subdirs)].find(same);
  if (found) return found;
  return first.some((d) => d.toUpperCase() === 'CLIENTES') ? `${first.find((d) => d.toUpperCase() === 'CLIENTES')}/${want}` : want;
}

/** Subpasta de um arquivo na pasta do cliente: a mesma da pasta local ou, fora do padrão, a do tipo de arquivo. */
export function driveSubdir(localClientDir: string | null, file: string) {
  if (localClientDir) {
    const rel = path.relative(localClientDir, file).split(path.sep);
    if (rel.length > 1 && /^(DOCUMENTOS|FOTOS|VIDEOS)$/i.test(rel[0])) return rel.slice(0, -1).join('/');
  }
  return SUB_BY_KIND[kindOf(file)];
}

const hashOf = (file: string) => new Promise<string>((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

const sameContent = async (a: string, b: string) => statSync(a).size === statSync(b).size && (await hashOf(a)) === (await hashOf(b));

export interface DriveItem { file: string; sub: string }
export interface DriveResult {
  sent: { file: string; to: string }[];
  /** Já estavam lá, com o mesmo conteúdo. */
  skipped: { file: string; to: string }[];
  failed: { file: string; error: string }[];
}

/** Copia sem sobrescrever: um arquivo diferente com o mesmo nome faz o novo sair como "nome (2).ext". */
async function copyNew(file: string, dir: string): Promise<{ to: string; copied: boolean }> {
  await mkdir(dir, { recursive: true });
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  for (let i = 1; i < 1000; i++) {
    const to = path.join(dir, `${base}${i > 1 ? ` (${i})` : ''}${ext}`);
    if (existsSync(to)) {
      if (await sameContent(file, to)) return { to, copied: false };
      continue;
    }
    try {
      await copyFile(file, to, constants.COPYFILE_EXCL);
      return { to, copied: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('nomes esgotados');
}

export async function sendToDrive(root: string, clientRel: string, items: DriveItem[]): Promise<DriveResult | string> {
  const info = driveInfo(root);
  if (!info.ok) return `A pasta do Drive ${root} não está acessível. O Google Drive para computador está aberto?`;
  if (!insideDir(root, clientRel)) return 'Escolha uma pasta dentro do Drive.';
  const planned: { file: string; dir: string }[] = [];
  for (const it of items) {
    const dir = insideDir(root, path.join(clientRel, it.sub));
    if (!dir) return `A subpasta ${it.sub} fica fora da pasta do cliente.`;
    planned.push({ file: it.file, dir });
  }
  const size = planned.reduce((n, p) => n + (existsSync(p.file) ? statSync(p.file).size : 0), 0);
  if (size > info.free) return `Não cabe no Drive: o envio tem ${gb(size)} e restam ${gb(info.free)}.`;
  const res: DriveResult = { sent: [], skipped: [], failed: [] };
  for (const p of planned) {
    try {
      const { to, copied } = await copyNew(p.file, p.dir);
      (copied ? res.sent : res.skipped).push({ file: p.file, to });
    } catch (e) {
      res.failed.push({ file: p.file, error: (e as Error).message });
    }
  }
  return res;
}

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
