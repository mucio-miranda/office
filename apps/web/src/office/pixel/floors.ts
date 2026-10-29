import { canvasTexture, rand, shade } from './kit';

/**
 * Pisos que o modo Decorar aplica a uma sala inteira. Cada textura tem 64 px e cobre 2 m (32 px por metro,
 * a mesma densidade do assoalho da recepção). Tudo desenhado aqui, com cores fixas; à noite o material
 * do chão escurece a textura.
 */
export interface FloorMaterial { id: string; name: string; draw: (g: CanvasRenderingContext2D) => void }

const S = 64;
const px = (g: CanvasRenderingContext2D, x: number, y: number, c: string, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

/** Tábuas corridas com veio, nós e emendas desencontradas. */
export function drawPlanks(g: CanvasRenderingContext2D, a: string, b: string, gap = 1, plank = 8, seed = 7) {
  const r = rand(seed);
  const tones = [a, b, shade(a, 1.06), shade(b, 0.95), shade(a, 0.97)];
  for (let row = 0; row < S / plank; row++) {
    const y = row * plank;
    let x = -Math.floor(r() * 40);
    while (x < S) {
      const len = 22 + Math.floor(r() * 26);
      const tone = tones[Math.floor(r() * tones.length)];
      const draw = (ox: number) => {
        px(g, x + ox, y, tone, len, plank);
        for (let k = 0; k < 3; k++) px(g, x + ox + 2 + Math.floor(r() * (len - 8)), y + 1 + Math.floor(r() * (plank - 2)), shade(tone, 0.9), 4 + Math.floor(r() * 8), 1);
        if (r() < 0.25) px(g, x + ox + 4 + Math.floor(r() * (len - 10)), y + Math.floor(plank / 2) - 1, shade(tone, 0.75), 2, 2);
        px(g, x + ox, y, shade(tone, 1.08), len, 1);
        px(g, x + ox, y + plank - gap, shade(a, gap > 1 ? 0.45 : 0.72), len, gap);
        px(g, x + ox + len - 1, y, shade(a, 0.72), 1, plank);
      };
      draw(0);
      if (x + len > S) draw(-S);
      if (x < 0) draw(S);
      x += len;
    }
  }
}

/** Ruído de manchas (cimento, pedra, grama). */
function speckle(g: CanvasRenderingContext2D, n: number, colors: string[], seed: number, size = 1) {
  const r = rand(seed);
  for (let i = 0; i < n; i++) px(g, Math.floor(r() * S), Math.floor(r() * S), colors[Math.floor(r() * colors.length)], size, size);
}

export const FLOOR_MATERIALS: FloorMaterial[] = [
  { id: 'tabuas-claras', name: 'Tábuas de carvalho claro', draw: (g) => drawPlanks(g, '#dcb98a', '#cfa877') },
  { id: 'tabuas-nogueira', name: 'Tábuas de nogueira', draw: (g) => drawPlanks(g, '#7a5236', '#6b4630', 1, 8, 13) },
  {
    id: 'parquet', name: 'Parquet trançado',
    draw: (g) => {
      // blocos de 16 px alternando tábuas deitadas e em pé
      const r = rand(17);
      for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
        const flat = (bx + by) % 2 === 0;
        for (let k = 0; k < 4; k++) {
          const tone = ['#d2a873', '#c79b66', '#dbb27e', '#be925d'][Math.floor(r() * 4)];
          const [x, y, w, h] = flat ? [bx * 16, by * 16 + k * 4, 16, 4] : [bx * 16 + k * 4, by * 16, 4, 16];
          px(g, x, y, tone, w, h);
          px(g, x, y, shade(tone, 1.08), flat ? w : 1, flat ? 1 : h);
          px(g, flat ? x : x + w - 1, flat ? y + h - 1 : y, shade(tone, 0.72), flat ? w : 1, flat ? 1 : h);
          px(g, x + 3 + Math.floor(r() * 8), y + 1 + Math.floor(r() * 2), shade(tone, 0.9), flat ? 5 : 1, flat ? 1 : 5);
        }
      }
    },
  },
  {
    id: 'cimento', name: 'Cimento queimado',
    draw: (g) => {
      px(g, 0, 0, '#a9a8a3', S, S);
      // manchas largas e suaves, depois o pontilhado fino e as juntas de dilatação a cada 2 m
      const r = rand(23);
      for (let i = 0; i < 26; i++) px(g, Math.floor(r() * S), Math.floor(r() * S), r() < 0.5 ? '#b3b2ad' : '#a0a09b', 4 + Math.floor(r() * 10), 3 + Math.floor(r() * 6));
      speckle(g, 260, ['#9a9994', '#b8b7b2', '#8f8e89'], 29);
      px(g, 0, S - 1, '#8a8984', S, 1);
      px(g, S - 1, 0, '#8a8984', 1, S);
    },
  },
  {
    id: 'porcelanato', name: 'Porcelanato marmorizado',
    draw: (g) => {
      // placas de 1 m × 1 m com veios finos
      px(g, 0, 0, '#ecebe6', S, S);
      const r = rand(31);
      for (let v = 0; v < 7; v++) {
        let x = Math.floor(r() * S), y = Math.floor(r() * S);
        const c = r() < 0.5 ? '#d3d0c8' : '#c9c5bb';
        for (let k = 0; k < 40; k++) { px(g, ((x % S) + S) % S, ((y % S) + S) % S, c); x += 1; y += r() < 0.5 ? 0 : r() < 0.5 ? 1 : -1; }
      }
      for (const o of [0, 32]) { px(g, 0, o + 31, '#c4c1b8', S, 1); px(g, o + 31, 0, '#c4c1b8', 1, S); px(g, 0, o, '#f6f5f1', S, 1); }
    },
  },
  {
    id: 'granilite', name: 'Granilite (terrazzo)',
    draw: (g) => {
      px(g, 0, 0, '#eee6da', S, S);
      speckle(g, 160, ['#d9cfc0', '#f7f1e8'], 37);
      const r = rand(41);
      const chips = ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#9a8c7a', '#5b7fb8'];
      for (let i = 0; i < 70; i++) {
        const c = chips[Math.floor(r() * chips.length)], x = Math.floor(r() * S), y = Math.floor(r() * S), w = 1 + Math.floor(r() * 3);
        px(g, x, y, c, w, 1 + Math.floor(r() * 2));
        px(g, x, y, shade(c, 1.2));
      }
    },
  },
  {
    id: 'hidraulico', name: 'Ladrilho hidráulico',
    draw: (g) => {
      // ladrilhos de 25 cm (8 px) com flor de quatro pétalas e moldura
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
        const x = tx * 8, y = ty * 8;
        px(g, x, y, '#efe4cf', 8, 8);
        px(g, x, y, '#2f6b6b', 8, 1); px(g, x, y, '#2f6b6b', 1, 8);
        px(g, x + 3, y + 1, '#c8553d', 2, 2); px(g, x + 3, y + 5, '#c8553d', 2, 2);
        px(g, x + 1, y + 3, '#c8553d', 2, 2); px(g, x + 5, y + 3, '#c8553d', 2, 2);
        px(g, x + 3, y + 3, '#2f6b6b', 2, 2);
        px(g, x + 7, y + 7, '#d8ccb4');
      }
    },
  },
  {
    id: 'deck', name: 'Deck de madeira',
    draw: (g) => {
      drawPlanks(g, '#b07a4a', '#9c6a3e', 2, 8, 43);
      // pregos nas pontas das réguas
      for (let y = 3; y < S; y += 8) for (let x = 6; x < S; x += 16) px(g, x, y, '#5a3a22');
    },
  },
  {
    id: 'grama', name: 'Grama natural',
    draw: (g) => {
      px(g, 0, 0, '#5d9e3c', S, S);
      const r = rand(47);
      for (let i = 0; i < 420; i++) {
        const x = Math.floor(r() * S), y = Math.floor(r() * S), c = ['#4e8f31', '#6fb34a', '#82c35a', '#3f7a28'][Math.floor(r() * 4)];
        px(g, x, y, c, 1, 2);
      }
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(r() * (S - 2)), y = Math.floor(r() * (S - 2));
        px(g, x, y, i % 2 ? '#fff6d8' : '#ffd166'); px(g, x + 1, y + 1, '#ffffff');
      }
    },
  },
  {
    id: 'pedra', name: 'Pedra natural',
    draw: (g) => {
      // pedras irregulares em fiadas, rejunte escuro
      px(g, 0, 0, '#6e6a62', S, S);
      const r = rand(53);
      for (let row = 0; row < 6; row++) {
        let x = -Math.floor(r() * 10);
        const y = Math.round(row * (S / 6));
        const h = Math.round(S / 6) - 1;
        while (x < S) {
          const w = 8 + Math.floor(r() * 10);
          const c = ['#a7a196', '#b5afa3', '#9b958a', '#c2bcb0', '#8f8a80'][Math.floor(r() * 5)];
          const draw = (ox: number) => {
            px(g, x + ox + 1, y + 1, c, w - 1, h - 1);
            px(g, x + ox + 1, y + 1, shade(c, 1.1), w - 1, 1);
            px(g, x + ox + 1, y + h - 1, shade(c, 0.85), w - 1, 1);
            px(g, x + ox + 2 + Math.floor(r() * (w - 4)), y + 2 + Math.floor(r() * Math.max(1, h - 4)), shade(c, 0.9), 2, 1);
          };
          draw(0);
          if (x + w > S) draw(-S);
          x += w;
        }
      }
    },
  },
  {
    id: 'carpete', name: 'Carpete em placas',
    draw: (g) => {
      // placas de 50 cm com o fio em direções alternadas (o "quadriculado" dos escritórios)
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        const x = tx * 16, y = ty * 16, flat = (tx + ty) % 2 === 0;
        px(g, x, y, flat ? '#5c6670' : '#535c66', 16, 16);
        for (let k = 0; k < 16; k += 2) px(g, flat ? x : x + k, flat ? y + k : y, flat ? '#66717c' : '#5e6872', flat ? 16 : 1, flat ? 1 : 16);
      }
      speckle(g, 60, ['#7a8590', '#47505a'], 59);
    },
  },
  {
    id: 'xadrez', name: 'Ladrilho xadrez',
    draw: (g) => {
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        const dark = (tx + ty) % 2 === 1;
        const c = dark ? '#2b2b30' : '#f1ede4';
        px(g, tx * 16, ty * 16, c, 16, 16);
        px(g, tx * 16, ty * 16, shade(c, dark ? 1.3 : 1.03), 16, 1);
        px(g, tx * 16 + 15, ty * 16, shade(c, dark ? 0.8 : 0.88), 1, 16);
      }
    },
  },
];

export const FLOOR_BY_ID = Object.fromEntries(FLOOR_MATERIALS.map((m) => [m.id, m]));

/** Metros cobertos por uma repetição de qualquer piso desta lista. */
export const FLOOR_MATERIAL_M = 2;

export const floorMaterialTexture = (id: string) => {
  const m = FLOOR_BY_ID[id];
  return m ? canvasTexture(`floormat:${id}`, S, S, m.draw) : null;
};
