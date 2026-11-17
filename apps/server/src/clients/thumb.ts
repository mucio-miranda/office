import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

/**
 * Miniatura JPEG em cache para as grades de peças (a arte final passa de 5 MB e o vídeo, de 50 MB). Gera com o ffmpeg
 * (o mesmo da engine de vídeo): imagem redimensionada, ou o quadro de 1 s do vídeo. O cache fica em
 * `data/thumbs`, com o caminho, o tamanho e a data do arquivo na chave: arquivo trocado gera miniatura nova.
 * Sem ffmpeg, devolve null e a rota manda o original.
 */
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const pending = new Map<string, Promise<string | null>>();

export function thumbOf(file: string, width = 320): Promise<string | null> {
  let st;
  try { st = statSync(file); } catch { return Promise.resolve(null); }
  const key = createHash('sha1').update(`${path.resolve(file).toLowerCase()}|${st.size}|${st.mtimeMs}|${width}`).digest('hex');
  const dir = path.join(config.dataDir, 'thumbs', key.slice(0, 2));
  const out = path.join(dir, `${key}.jpg`);
  if (existsSync(out)) return Promise.resolve(out);
  const running = pending.get(out);
  if (running) return running;
  const video = /\.(mp4|mov|m4v|webm)$/i.test(file);
  const args = ['-v', 'error', '-y', ...(video ? ['-ss', '1'] : []), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos`, '-q:v', '4', out];
  const job = new Promise<string | null>((resolve) => {
    try { mkdirSync(dir, { recursive: true }); } catch { resolve(null); return; }
    execFile(FFMPEG, args, { timeout: 20_000, windowsHide: true }, (err) => resolve(!err && existsSync(out) ? out : null));
  }).finally(() => pending.delete(out));
  pending.set(out, job);
  return job;
}
