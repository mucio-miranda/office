import { createWriteStream, existsSync, mkdtempSync, mkdirSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { config } from '../config.ts';
import { one } from '../db.ts';

/**
 * Anexos do chat: arquivo arrastado ou colado na conversa com um funcionário. No app do Windows, o que já está neste PC
 * vai só como caminho (o dono libera a pasta ao citar); o resto (print colado, arquivo vindo de outro computador) sobe
 * para esta pasta, que todo funcionário enxerga.
 */
export const MAX_ATTACHMENT = 4 * 1024 ** 3;

export function anexosDir() {
  const dir = path.join(config.dataDir, 'anexos');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Nome seguro para o Windows, mantendo a extensão. Print colado (image.png) ganha nome com a hora. */
export function attachmentName(name: string, when = new Date()) {
  const hhmmss = when.toTimeString().slice(0, 8).replaceAll(':', '');
  let base = path.basename(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  if (!base || /^image\.(png|jpe?g|gif|webp)$/i.test(base)) base = `print ${hhmmss}${path.extname(base) || '.png'}`;
  return base.slice(-150);
}

/** Caminho livre em anexos\AAAA-MM-DD\, sem sobrescrever nada. */
export function attachmentPath(name: string, when = new Date()) {
  const dir = path.join(anexosDir(), when.toISOString().slice(0, 10));
  mkdirSync(dir, { recursive: true });
  const file = attachmentName(name, when);
  const ext = path.extname(file);
  const stem = file.slice(0, file.length - ext.length);
  let out = path.join(dir, file);
  for (let n = 2; existsSync(out); n++) out = path.join(dir, `${stem} (${n})${ext}`);
  return out;
}

export function sessionImports(workerId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(workerId)) throw Error('Sessão inválida.');
  const root = path.join(config.dataDir, 'importacoes', workerId);
  mkdirSync(root, { recursive: true });
  return root;
}

export async function saveAttachment(body: Readable, name: string, workerId?: string) {
  const imports = workerId ? sessionImports(workerId) : null;
  const safeName = attachmentName(name).replace(/^[.]+/, '_');
  const out = imports ? path.join(mkdtempSync(path.join(imports, 'arquivo-')), safeName) : attachmentPath(name);
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      cb(size > MAX_ATTACHMENT ? new Error('Arquivo grande demais para anexar (máximo 4 GB).') : null, chunk);
    },
  });
  try {
    await pipeline(body, limit, createWriteStream(out, { flags: 'wx' }));
  } catch (e) {
    await unlink(out).catch(() => {});
    throw e;
  }
  return { path: out, size: statSync(out).size, ...(imports ? { relativo: path.relative(imports, out) } : {}) };
}

export function isOwner(officeId: string, by: string | null | undefined) {
  if (!by) return false;
  const userId = by.replace(/^user:/, '');
  return one<{ role: string }>('SELECT role FROM office_members WHERE office_id = ? AND user_id = ?', officeId, userId)?.role === 'dono';
}

/** Caminhos de quem colou ou arrastou: só os do dono e que existem neste PC vão como caminho; os outros sobem. */
export function localPaths(officeId: string, by: string, paths: string[]) {
  if (!isOwner(officeId, by)) return [];
  return paths.filter((p) => path.isAbsolute(p) && existsSync(p));
}
