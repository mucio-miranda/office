import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

/**
 * Foto RAW da câmera (ARW da Sony, CR2/CR3, NEF, DNG...) não abre no navegador. Todo RAW traz dentro uma prévia JPEG
 * que a própria câmera gerou (na Sony, do tamanho da foto ou perto disso): o Office tira essa prévia, sem programa
 * extra, desvira pela orientação gravada no RAW (com o ffmpeg, se houver) e guarda em cache. O RAW nunca é alterado.
 */

export const RAW = /\.(arw|srf|sr2|cr2|cr3|nef|nrw|dng|raf|orf|rw2|pef|srw)$/i;
const MIN_JPEG = 20 * 1024;
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';

/** Fim de um JPEG que começa em `start` (percorre os segmentos; dentro da imagem, procura o próximo marcador). */
function jpegEnd(buf: Buffer, start: number): number | null {
  let p = start + 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9) return p + 2;
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (len < 2) return null;
    p += 2 + len;
    if (m === 0xda) {
      // dados da imagem: termina no primeiro FF seguido de algo que não seja 00 nem reinício (RSTn)
      while (p + 1 < buf.length && !(buf[p] === 0xff && buf[p + 1] !== 0x00 && !(buf[p + 1] >= 0xd0 && buf[p + 1] <= 0xd7))) p++;
    }
  }
  return null;
}

/** A maior prévia JPEG completa dentro do arquivo. */
export function largestJpeg(buf: Buffer): Buffer | null {
  let best: [number, number] | null = null;
  let i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  while (i >= 0) {
    const end = jpegEnd(buf, i);
    if (end && end - i >= MIN_JPEG && (!best || end - i > best[1] - best[0])) best = [i, end];
    // a próxima procura começa depois deste JPEG inteiro (as miniaturas dentro dele não interessam)
    i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), end && end - i >= MIN_JPEG ? end : i + 3);
  }
  return best ? buf.subarray(best[0], best[1]) : null;
}

/** Orientação (tag 0x0112 do primeiro IFD) dos RAW que são TIFF por dentro (ARW, CR2, NEF, DNG...). 1 = normal. */
export function tiffOrientation(buf: Buffer): number {
  try {
    const le = buf.toString('latin1', 0, 2) === 'II';
    if (!le && buf.toString('latin1', 0, 2) !== 'MM') return 1;
    const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    const ifd = u32(4);
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (u16(e) === 0x0112) return u16(e + 8);
    }
  } catch { /* cabeçalho diferente: fica como veio */ }
  return 1;
}

const ROTATE: Record<number, string> = { 3: 'hflip,vflip', 6: 'transpose=1', 8: 'transpose=2' };
const pending = new Map<string, Promise<string | null>>();

/** JPEG para mostrar um RAW (em cache em data/thumbs/raw). Sem prévia dentro do arquivo, null. */
export function rawPreview(file: string): Promise<string | null> {
  let st;
  try { st = statSync(file); } catch { return Promise.resolve(null); }
  const key = createHash('sha1').update(`raw|${path.resolve(file).toLowerCase()}|${st.size}|${st.mtimeMs}`).digest('hex');
  const dir = path.join(config.dataDir, 'thumbs', 'raw');
  const out = path.join(dir, `${key}.jpg`);
  if (existsSync(out)) return Promise.resolve(out);
  const running = pending.get(out);
  if (running) return running;
  const job = new Promise<string | null>((resolve) => {
    try {
      const buf = readFileSync(file);
      const jpg = largestJpeg(buf);
      if (!jpg) { resolve(null); return; }
      mkdirSync(dir, { recursive: true });
      const rot = ROTATE[tiffOrientation(buf)];
      if (!rot) { writeFileSync(out, jpg); resolve(out); return; }
      const raw = `${out}.raw.jpg`;
      writeFileSync(raw, jpg);
      execFile(FFMPEG, ['-v', 'error', '-y', '-i', raw, '-vf', rot, '-q:v', '2', out], { timeout: 30_000, windowsHide: true }, (err) => {
        if (err || !existsSync(out)) { try { renameSync(raw, out); } catch { /* fica sem */ } } else { try { unlinkSync(raw); } catch { /* some na próxima */ } }
        resolve(existsSync(out) ? out : null);
      });
    } catch { resolve(null); }
  }).finally(() => pending.delete(out));
  pending.set(out, job);
  return job;
}
