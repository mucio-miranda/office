// Gera os ícones do app (PNG) desenhando pixel a pixel, sem dependências.
// Marca do Office: quadrado arredondado escuro com um prédio claro e janelas.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');
mkdirSync(assets, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Cobertura (0..1) de um retângulo arredondado, com antisserrilhado simples. */
function roundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const d = Math.hypot(x - cx, y - cy) - r;
  return Math.min(1, Math.max(0, 0.5 - d));
}

const BG = [23, 23, 23];
const FG = [250, 250, 250];

/** Coordenadas normalizadas num quadro 0..1. */
function mark(px, py, size, { pad = 0 } = {}) {
  const s = size;
  const u = (v) => v * s;
  const bg = roundRect(px, py, u(pad), u(pad), u(1 - pad), u(1 - pad), u(0.22));
  if (bg <= 0) return [0, 0, 0, 0];
  // prédio
  let fg = roundRect(px, py, u(0.3), u(0.22), u(0.7), u(0.8), u(0.04));
  // janelas (vazadas): 2 colunas x 3 linhas, e a porta
  for (const cx of [0.4, 0.6]) for (const cy of [0.34, 0.47, 0.6]) fg -= roundRect(px, py, u(cx - 0.05), u(cy - 0.04), u(cx + 0.05), u(cy + 0.04), u(0.012));
  fg -= roundRect(px, py, u(0.45), u(0.68), u(0.55), u(0.8), u(0.01));
  fg = Math.max(0, Math.min(1, fg));
  const c = BG.map((b, i) => Math.round(b * (1 - fg) + FG[i] * fg));
  return [...c, Math.round(255 * bg)];
}

writeFileSync(path.join(assets, 'icon.png'), png(512, (x, y, s) => mark(x, y, s, { pad: 0.02 })));
writeFileSync(path.join(assets, 'tray.png'), png(32, (x, y, s) => mark(x, y, s)));
// variante com ponto de alerta (alguém precisa de aprovação)
writeFileSync(path.join(assets, 'tray-alert.png'), png(32, (x, y, s) => {
  const dot = Math.min(1, Math.max(0, 0.5 - (Math.hypot(x - s * 0.78, y - s * 0.22) - s * 0.2)));
  if (dot > 0) return [245, 158, 11, Math.round(255 * dot)];
  return mark(x, y, s);
}));
console.log('ícones gerados em', assets);
