import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { constants, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Client, ContentPost, Office, PostDelivery, PostFormat } from '@office/shared';
import { clientDir } from './folder.ts';
import { clientDriveFolder, driveInfo } from './drive.ts';
import { clientPaths, layoutMap } from './layout.ts';
import { driveLink } from './driveId.ts';

/**
 * Entrega da peça aprovada: copia os arquivos finais para a pasta do mês do cliente no Drive (o mês da data de
 * postagem, não o de hoje) com o nome padrão `AAAA-MM-DD Formato – Tema – NN.ext`, confere o SHA-256 e guarda o link
 * do Drive. Reentrega com conteúdo novo guarda a versão anterior em `TRABALHOS/<lote>/_versoes/` (fora da pasta que o
 * cliente vê) e grava a nova com o mesmo nome. Nunca apaga nada.
 */

const FORMAT_NAME: Record<PostFormat, string> = { estatico: 'Estático', carrossel: 'Carrossel', reels: 'Reels', 'capa-reels': 'Capa de reels', story: 'Story' };
const DELIVERABLE = /\.(png|jpe?g|webp|mp4|mov|pdf)$/i;

/** Tira o que o Windows não aceita em nome de arquivo e o que sobra nas pontas. */
export const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');

/** Nome final do arquivo `i` (0, 1…) de `total`. O NN só aparece quando a peça tem mais de um arquivo (carrossel). */
export function finalName(post: Pick<ContentPost, 'date' | 'format' | 'theme'>, i: number, total: number, ext: string) {
  const theme = safeName(post.theme).slice(0, 80) || 'Sem tema';
  const nn = total > 1 ? ` – ${String(i + 1).padStart(2, '0')}` : '';
  return `${post.date} ${FORMAT_NAME[post.format] ?? 'Post'} – ${theme}${nn}${ext.toLowerCase()}`;
}

/** Os arquivos finais da peça, na ordem: os registrados, senão os da pasta FINAL/ da peça, senão as imagens de `files`. */
export function finalsOf(post: Pick<ContentPost, 'finals' | 'workDir' | 'files'>) {
  const exists = (f: string) => existsSync(f) && statSync(f).isFile();
  if (post.finals?.length) return post.finals.filter(exists);
  if (post.workDir) {
    const dir = ['FINAL', 'final', 'Final'].map((d) => path.join(post.workDir!, d)).find((d) => existsSync(d));
    if (dir) {
      const files = readdirSync(dir).filter((f) => DELIVERABLE.test(f) && !f.startsWith('.')).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
      if (files.length) return files.map((f) => path.join(dir, f));
    }
  }
  return (post.files ?? []).filter((f) => DELIVERABLE.test(f) && exists(f));
}

/** A pasta do lote em TRABALHOS (a que fica logo abaixo de TRABALHOS), a partir da pasta da peça ou de um arquivo. */
export function loteDir(p: string | null | undefined) {
  if (!p) return null;
  const parts = path.resolve(p).split(path.sep);
  const i = parts.findIndex((s) => s.toUpperCase() === 'TRABALHOS');
  return i >= 0 && parts[i + 1] ? parts.slice(0, i + 2).join(path.sep) : null;
}

const hashOf = (file: string) => new Promise<string>((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

const real = (p: string) => { try { return realpathSync.native(p); } catch { return path.resolve(p); } };
const inside = (p: string, dir: string) => {
  const a = real(p).toLowerCase(), d = real(dir).toLowerCase();
  return a === d || a.startsWith(d + path.sep);
};

export interface DeliverResult {
  /** Pasta do mês onde a peça foi entregue. */
  dir: string;
  delivered: PostDelivery[];
  /** Já estavam lá com o mesmo conteúdo. */
  same: string[];
}

/** Copia sem sobrescrever: se o nome está ocupado, acrescenta " (2)", " (3)"… */
async function copyAside(file: string, dir: string, base: string) {
  await mkdir(dir, { recursive: true });
  const ext = path.extname(file);
  for (let i = 1; i < 1000; i++) {
    const to = path.join(dir, `${base}${i > 1 ? ` (${i})` : ''}${ext}`);
    try { await copyFile(file, to, constants.COPYFILE_EXCL); return to; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  throw new Error('nomes esgotados');
}

/**
 * Entrega a peça na pasta do mês do cliente no Drive. Devolve um texto de erro (nada foi copiado) ou o resultado.
 * Os arquivos de origem precisam estar na pasta do cliente (local ou no Drive).
 */
export async function deliverPost(office: Office, client: Client, post: ContentPost, by: string, at = new Date().toISOString()): Promise<DeliverResult | string> {
  if (!office.driveRoot) return 'Defina a pasta do Drive em Equipe > Pastas do escritório.';
  const info = driveInfo(office.driveRoot);
  if (!info.ok) return `A pasta do Drive ${office.driveRoot} não está acessível. O Google Drive para computador está aberto?`;
  const files = finalsOf(post);
  if (!files.length) return post.workDir ? `Não achei os arquivos finais em ${path.join(post.workDir, 'FINAL')}.` : 'Esta peça não tem arquivos finais registrados nem pasta de trabalho.';
  const driveClient = path.join(office.driveRoot, clientDriveFolder(office.driveRoot, client));
  const local = clientDir(office, client);
  const strange = files.find((f) => !inside(f, driveClient) && !(local && inside(f, local)));
  if (strange) return `${path.basename(strange)} está fora da pasta do cliente.`;
  const size = files.reduce((n, f) => n + statSync(f).size, 0);
  if (size > info.free) return 'Não cabe no Drive.';

  const paths = clientPaths(driveClient, layoutMap(office.rootPath));
  const dir = paths.abs('mes', { mes: post.date });
  const versions = path.join(loteDir(post.workDir) ?? loteDir(files[0]) ?? paths.abs('trabalhos'), '_versoes');
  const res: DeliverResult = { dir, delivered: [], same: [] };
  await mkdir(dir, { recursive: true });
  for (const [i, file] of files.entries()) {
    const to = path.join(dir, finalName(post, i, files.length, path.extname(file)));
    const sha = await hashOf(file);
    const past = (post.deliveries ?? []).filter((d) => d.to.toLowerCase() === to.toLowerCase());
    let previous: string | null = null;
    if (existsSync(to)) {
      if ((await hashOf(to)) === sha) { res.same.push(to); continue; }
      // a versão que está lá vai para _versoes antes de ser substituída
      const n = past.at(-1)?.version ?? 1;
      previous = await copyAside(to, versions, `${path.basename(to, path.extname(to))} – v${n}`);
      if ((await hashOf(previous)) !== (await hashOf(to))) return `A cópia da versão anterior de ${path.basename(to)} saiu diferente. Nada foi substituído.`;
    }
    await copyFile(file, to);
    if ((await hashOf(to)) !== sha) return `A cópia de ${path.basename(file)} chegou diferente no Drive. Tente de novo.`;
    res.delivered.push({ from: file, to, sha256: sha, version: (past.at(-1)?.version ?? 0) + 1, at, by, link: driveLink(to), previous });
  }
  return res;
}

/** Busca o link das entregas que ainda não têm (o Drive termina de subir alguns segundos depois da cópia). */
export function fillLinks(deliveries: PostDelivery[], find: (file: string) => string | null = (f) => driveLink(f)) {
  let changed = false;
  const next = deliveries.map((d) => {
    if (d.link || !existsSync(d.to)) return d;
    const link = find(d.to);
    if (!link) return d;
    changed = true;
    return { ...d, link };
  });
  return { deliveries: next, changed };
}

/** A entrega atual de cada arquivo da pasta do mês (a última de cada destino). */
export function currentDeliveries(deliveries: PostDelivery[]) {
  const byTo = new Map<string, PostDelivery>();
  for (const d of deliveries) byTo.set(d.to.toLowerCase(), d);
  return [...byTo.values()];
}
