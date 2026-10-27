import type { ReactNode } from 'react';
import type { PixelPalette } from '../../lib/theme';
import { Glass, PBox, PCyl, booksTexture, canvasTexture, rugTexture, screenTexture, shade, tiled } from '../pixel/kit';
import { OfficeChair, Plant } from '../pixel/Furniture';

/**
 * Catálogo de decoração do modo Decorar, no espírito do catálogo de mobis do Habbo. As peças seguem as
 * referências de escritórios de startup: madeira clara e vidro (Apple Park), cabines acústicas, armários
 * coloridos, pufes e bicicletas (Google), arquibancada e neon (Nubank), horta e escada vermelha (iFood),
 * cabanas, tijolinho e bar de cereais (Pixar). Tudo é desenhado por código, sem sprites de terceiros.
 *
 * Cada peça tem a frente para +z; `size` é a pegada no chão sem giro (itens de parede: largura e altura).
 */

export type DecorCat = 'escritorio' | 'lounge' | 'plantas' | 'copa' | 'lazer' | 'estudio' | 'estrutura' | 'parede' | 'luz' | 'piso';

export const CATEGORIES: { id: DecorCat; label: string; emoji: string }[] = [
  { id: 'escritorio', label: 'Escritório', emoji: '🖥️' },
  { id: 'lounge', label: 'Lounge', emoji: '🛋️' },
  { id: 'plantas', label: 'Plantas', emoji: '🌿' },
  { id: 'copa', label: 'Copa', emoji: '☕' },
  { id: 'lazer', label: 'Lazer', emoji: '🎮' },
  { id: 'estudio', label: 'Estúdio', emoji: '🎬' },
  { id: 'estrutura', label: 'Estrutura', emoji: '🧱' },
  { id: 'parede', label: 'Parede', emoji: '🖼️' },
  { id: 'luz', label: 'Luz', emoji: '💡' },
  { id: 'piso', label: 'Tapetes', emoji: '🟫' },
];

export interface DecorDef {
  kind: string;
  name: string;
  cat: DecorCat;
  size: [number, number];
  /** Altura aproximada (maquete e enquadramento da miniatura). */
  h: number;
  /** chao: bloqueia a passagem; piso: tapete (anda por cima); alto: pendurado (não ocupa o chão); parede. */
  place: 'chao' | 'piso' | 'alto' | 'parede';
  /** Parede: altura do centro da peça. */
  y?: number;
  /** Revestimento de parede: fica atrás dos outros itens de parede, sem disputar lugar. */
  cover?: boolean;
  /** Cores que o modo Decorar oferece (a primeira é a padrão). */
  colors?: string[];
  render: (p: PixelPalette, color: string | undefined) => ReactNode;
}

type V3 = [number, number, number];

const FABRICS = ['#d64545', '#3f7fd6', '#f1c40f', '#2a9d8f', '#8e44ad', '#f4a261', '#3d3d46'];
const WOODS = ['#e8cfa0', '#b9824e', '#f4f4f2', '#2b2b30'];
const NEONS = ['#ff4fd8', '#3ff0ff', '#9b5cff', '#ff3b3b', '#ffd23f'];
const BRIGHT = ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#8e44ad'];

// ---------------------------------------------------------------- texturas próprias do catálogo

/** Letras 3×5 da pixel art (só as que os letreiros usam). */
const GLYPHS: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'], I: ['111', '010', '010', '010', '111'],
  O: ['010', '101', '101', '101', '010'], R: ['110', '101', '110', '101', '101'], '!': ['010', '010', '010', '000', '010'],
};
/** Letreiro em 4× (cada pixel da letra vira um bloco 4×4): continua legível mesmo na parede vista de lado. */
function neonTexture(text: string, color: string) {
  const letters = [...text];
  const S = 4;
  return canvasTexture(`neon:${text}:${color}`, (letters.length * 4 + 1) * S, 8 * S, (g) => {
    letters.forEach((ch, i) => {
      const base = ch === 'É' ? 'E' : ch;
      const rows = GLYPHS[base];
      if (!rows) return;
      g.fillStyle = color;
      rows.forEach((row, y) => [...row].forEach((on, x) => { if (on === '1') g.fillRect((1 + i * 4 + x) * S, (2 + y) * S, S, S); }));
      if (ch === 'É') g.fillRect((1 + i * 4 + 1) * S, 0, 2 * S, S);
    });
  });
}

const brickTexture = () => canvasTexture('brick', 16, 16, (g) => {
  g.fillStyle = '#d9cbb8';
  g.fillRect(0, 0, 16, 16);
  const bricks = ['#b5533c', '#a84a35', '#bf5d44', '#9c4431'];
  for (let row = 0; row < 4; row++)
    for (let col = -1; col < 2; col++) {
      g.fillStyle = bricks[(row * 3 + col + 4) % 4];
      g.fillRect(col * 8 + (row % 2 ? 4 : 0) + 1, row * 4 + 1, 7, 3);
    }
});

const slatsTexture = () => canvasTexture('slats', 16, 16, (g) => {
  g.fillStyle = '#d8b98a';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#8a6a45';
  for (let x = 0; x < 16; x += 4) g.fillRect(x + 3, 0, 1, 16);
  g.fillStyle = '#e6c99c';
  for (let x = 0; x < 16; x += 4) g.fillRect(x, 0, 1, 16);
});

const grassTexture = () => canvasTexture('grass', 16, 16, (g) => {
  g.fillStyle = '#5fae3e';
  g.fillRect(0, 0, 16, 16);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = i % 3 ? '#4e9a32' : '#79c653';
    g.fillRect((i * 7) % 16, (i * 5 + (i >> 3)) % 16, 1, 1);
  }
});

const stripesTexture = (c: string) => canvasTexture(`stripes:${c}`, 24, 16, (g) => {
  g.fillStyle = '#f4efe4';
  g.fillRect(0, 0, 24, 16);
  g.fillStyle = c;
  for (let x = 0; x < 24; x += 6) g.fillRect(x, 0, 3, 16);
  g.fillStyle = shade(c, 0.7);
  g.fillRect(0, 0, 24, 1);
  g.fillRect(0, 15, 24, 1);
});

const dashTexture = () => canvasTexture('dash', 24, 14, (g) => {
  g.fillStyle = '#141b26';
  g.fillRect(0, 0, 24, 14);
  g.fillStyle = '#2b3a4d';
  g.fillRect(1, 1, 22, 2);
  const bars = [4, 7, 5, 9, 8, 11];
  bars.forEach((h, i) => { g.fillStyle = i === 5 ? '#06d6a0' : '#7fd3ff'; g.fillRect(2 + i * 3, 13 - h, 2, h); });
  g.fillStyle = '#ffd166';
  g.fillRect(20, 4, 3, 3);
});

const corkTexture = () => canvasTexture('cork', 20, 12, (g) => {
  g.fillStyle = '#c99a62';
  g.fillRect(0, 0, 20, 12);
  for (let i = 0; i < 30; i++) { g.fillStyle = i % 2 ? '#b8874f' : '#d8ab73'; g.fillRect((i * 7) % 20, (i * 3) % 12, 1, 1); }
  const notes: [number, number, string][] = [[2, 2, '#ffd166'], [8, 1, '#ffffff'], [14, 3, '#ef476f'], [4, 7, '#06d6a0'], [11, 7, '#7fd3ff']];
  for (const [x, y, c] of notes) { g.fillStyle = c; g.fillRect(x, y, 4, 4); g.fillStyle = '#d62828'; g.fillRect(x + 1, y, 1, 1); }
});

const mapTexture = () => canvasTexture('worldmap', 24, 12, (g) => {
  g.fillStyle = '#3d7cc9';
  g.fillRect(0, 0, 24, 12);
  g.fillStyle = '#8fd17a';
  const land: [number, number, number, number][] = [[2, 2, 5, 3], [4, 5, 2, 4], [10, 2, 3, 2], [10, 4, 3, 4], [14, 2, 7, 3], [17, 5, 3, 2], [19, 8, 3, 2]];
  for (const [x, y, w, h] of land) g.fillRect(x, y, w, h);
  g.fillStyle = '#ef476f';
  g.fillRect(6, 7, 1, 1);
});

const arcadeTexture = () => canvasTexture('arcade', 12, 10, (g) => {
  g.fillStyle = '#0d0f1f';
  g.fillRect(0, 0, 12, 10);
  g.fillStyle = '#ffd23f';
  g.fillRect(5, 6, 2, 2);
  g.fillStyle = '#ff4fd8';
  [[2, 2], [5, 2], [8, 2], [3, 4], [7, 4]].forEach(([x, y]) => g.fillRect(x, y, 2, 1));
  g.fillStyle = '#3ff0ff';
  g.fillRect(0, 9, 12, 1);
});

const waterTexture = () => canvasTexture('water', 16, 8, (g) => {
  g.fillStyle = '#2b8fd6';
  g.fillRect(0, 0, 16, 8);
  g.fillStyle = '#5ab8f0';
  g.fillRect(0, 0, 16, 1);
  g.fillStyle = '#ff9f1c';
  [[3, 3], [10, 2], [7, 5]].forEach(([x, y]) => { g.fillRect(x, y, 2, 1); g.fillRect(x - 1, y, 1, 1); });
  g.fillStyle = '#e9d8a6';
  g.fillRect(0, 7, 16, 1);
  g.fillStyle = '#2d6a4f';
  g.fillRect(13, 4, 1, 3);
  g.fillRect(1, 5, 1, 2);
});

// ---------------------------------------------------------------- peças reaproveitadas da decoração fixa

function Window({ p }: { p: PixelPalette }) {
  return (
    <group>
      <PBox p={p} pos={[0, 0, 0.03]} size={[1.6, 1.2, 0.06]} color={p.woodDark} />
      <PBox p={p} pos={[0, 0.12, 0.065]} size={[1.44, 0.86, 0.01]} color="#9fd8ff" glow outline={false} cast={false} />
      <PBox p={p} pos={[0, -0.3, 0.065]} size={[1.44, 0.18, 0.01]} color="#cfeeff" glow outline={false} cast={false} />
      <PBox p={p} pos={[0, 0, 0.08]} size={[0.06, 1.1, 0.03]} color={p.woodDark} outline={false} />
      <PBox p={p} pos={[0, 0.05, 0.08]} size={[1.5, 0.06, 0.03]} color={p.woodDark} outline={false} />
      <PBox p={p} pos={[0, -0.64, 0.11]} size={[1.76, 0.08, 0.18]} color={p.wood} />
      <PBox p={p} pos={[-0.35, 0.3, 0.075]} size={[0.36, 0.1, 0.005]} color="#ffffff" glow outline={false} cast={false} />
    </group>
  );
}

function Poster({ p, c }: { p: PixelPalette; c: string }) {
  return (
    <group>
      <PBox p={p} pos={[0, 0, 0.025]} size={[0.8, 1, 0.05]} color="#2a2230" />
      <PBox p={p} pos={[0, 0, 0.055]} size={[0.66, 0.86, 0.01]} color="#f4efe4" outline={false} />
      <PBox p={p} pos={[-0.1, 0.12, 0.065]} size={[0.3, 0.3, 0.01]} color={c} outline={false} />
      <PBox p={p} pos={[0.12, -0.18, 0.065]} size={[0.26, 0.22, 0.01]} color={shade(c, 0.6)} outline={false} />
      <PBox p={p} pos={[0.16, 0.22, 0.065]} size={[0.14, 0.14, 0.01]} color="#ffd166" outline={false} />
    </group>
  );
}

const neonW = (text: string) => text.length * 0.4 + 0.2;
function Neon({ p, text, c }: { p: PixelPalette; text: string; c: string }) {
  const w = neonW(text);
  return (
    <group>
      <PBox p={p} pos={[0, 0, 0.02]} size={[w, 0.62, 0.03]} color="#15121c" />
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[w - 0.06, 0.6]} />
        <meshBasicMaterial map={neonTexture(text, c)} transparent toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <planeGeometry args={[w + 0.3, 0.8]} />
        <meshBasicMaterial color={c} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Panel({ p, map, w, h, frame = '#1c1f26', glow = true }: { p: PixelPalette; map: ReturnType<typeof canvasTexture>; w: number; h: number; frame?: string; glow?: boolean }) {
  return (
    <group>
      <PBox p={p} pos={[0, 0, 0.03]} size={[w, h, 0.06]} color={frame} />
      <PBox p={p} pos={[0, 0, 0.065]} size={[w - 0.1, h - 0.1, 0.01]} color="#ffffff" map={map} glow={glow} outline={false} cast={false} />
    </group>
  );
}

// ---------------------------------------------------------------- ajudantes

const leg = (p: PixelPalette, pos: V3, h: number, color: string, t = 0.05) => <PBox p={p} pos={[pos[0], h / 2, pos[2]]} size={[t, h, t]} color={color} />;

function Laptop({ p, pos, rotY = 0 }: { p: PixelPalette; pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <PBox p={p} pos={[0, 0.01, 0.08]} size={[0.44, 0.02, 0.3]} color="#c9ccd1" />
      <group position={[0, 0.02, -0.07]} rotation={[-0.25, 0, 0]}>
        <PBox p={p} pos={[0, 0.15, 0]} size={[0.44, 0.3, 0.02]} color="#c9ccd1" />
        <PBox p={p} pos={[0, 0.15, 0.012]} size={[0.4, 0.26, 0.005]} color="#ffffff" map={screenTexture(p.screenGlow)} glow outline={false} cast={false} />
      </group>
    </group>
  );
}

function Stool({ p, pos, c, h = 0.72 }: { p: PixelPalette; pos: V3; c: string; h?: number }) {
  return (
    <group position={pos}>
      <PCyl p={p} pos={[0, 0.02, 0]} r={0.18} h={0.04} color={p.metal} sides={8} />
      <PCyl p={p} pos={[0, h / 2, 0]} r={0.03} h={h} color={p.metal} sides={6} outline={false} />
      <PCyl p={p} pos={[0, h * 0.45, 0]} r={0.15} h={0.02} color={p.metal} sides={8} outline={false} />
      <PCyl p={p} pos={[0, h + 0.04, 0]} r={0.2} h={0.08} color={c} sides={10} />
    </group>
  );
}

/** Folhagem em blocos, do escuro (embaixo) ao claro (em cima). */
function Foliage({ p, pos, s = 1 }: { p: PixelPalette; pos: V3; s?: number }) {
  return (
    <group position={pos} scale={s}>
      <PBox p={p} pos={[0, 0, 0]} size={[1, 0.5, 1]} color={p.plantDark} rot={[0, 0.3, 0]} />
      <PBox p={p} pos={[0.05, 0.36, 0.02]} size={[0.8, 0.44, 0.8]} color={p.plant} rot={[0, -0.4, 0]} />
      <PBox p={p} pos={[-0.04, 0.68, -0.02]} size={[0.5, 0.32, 0.5]} color={shade(p.plant, 1.15)} rot={[0, 0.6, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------- o catálogo

export const CATALOG: DecorDef[] = [
  // ------------------------------------------------ escritório
  {
    kind: 'mesa-clara', name: 'Mesa de madeira clara', cat: 'escritorio', size: [1.8, 0.9], h: 1.1, place: 'chao', colors: WOODS,
    render: (p, c = WOODS[0]) => (
      <group>
        <PBox p={p} pos={[0, 0.74, 0]} size={[1.8, 0.05, 0.9]} color={c} />
        {[[-0.82, -0.38], [0.82, -0.38], [-0.82, 0.38], [0.82, 0.38]].map(([x, z]) => <group key={`${x}${z}`}>{leg(p, [x, 0, z], 0.72, '#e9e9ea')}</group>)}
        <Laptop p={p} pos={[0, 0.765, 0]} />
        <PCyl p={p} pos={[-0.66, 0.82, -0.25]} r={0.07} h={0.12} color="#f4f4f2" sides={8} />
        <PBox p={p} pos={[-0.66, 0.94, -0.25]} size={[0.16, 0.12, 0.16]} color={p.plant} />
        <PCyl p={p} pos={[0.6, 0.81, 0.15]} r={0.05} h={0.1} color={p.fabric} sides={8} />
        <PBox p={p} pos={[0.55, 0.77, -0.2]} size={[0.3, 0.02, 0.22]} color={p.paper} rot={[0, -0.2, 0]} />
      </group>
    ),
  },
  {
    kind: 'bancada', name: 'Bancada coletiva', cat: 'escritorio', size: [3.6, 1.2], h: 1.1, place: 'chao', colors: WOODS,
    render: (p, c = WOODS[0]) => (
      <group>
        <PBox p={p} pos={[0, 0.74, 0]} size={[3.6, 0.06, 1.2]} color={c} />
        {[-1.6, 1.6].map((x) => <PBox key={x} p={p} pos={[x, 0.36, 0]} size={[0.08, 0.72, 1]} color="#2b2b30" />)}
        <PBox p={p} pos={[0, 0.5, 0]} size={[3.1, 0.06, 0.06]} color="#2b2b30" outline={false} />
        <PBox p={p} pos={[0, 0.79, 0]} size={[2.4, 0.04, 0.12]} color="#3d3d46" />
        {[-1.05, 0.35].map((x) => <Laptop key={`a${x}`} p={p} pos={[x, 0.77, 0.28]} />)}
        {[-0.35, 1.05].map((x) => <Laptop key={`b${x}`} p={p} pos={[x, 0.77, -0.28]} rotY={Math.PI} />)}
        <PCyl p={p} pos={[1.5, 0.82, 0.35]} r={0.05} h={0.1} color="#ffd166" sides={8} />
      </group>
    ),
  },
  {
    kind: 'cadeira', name: 'Cadeira de escritório', cat: 'escritorio', size: [0.6, 0.6], h: 1.1, place: 'chao', colors: FABRICS,
    render: (p, c = '#3f7fd6') => <OfficeChair p={p} pos={[0, 0, 0]} rot={Math.PI} color={c} />,
  },
  {
    kind: 'banqueta', name: 'Banqueta alta', cat: 'escritorio', size: [0.5, 0.5], h: 0.8, place: 'chao', colors: FABRICS,
    render: (p, c = '#f1c40f') => <Stool p={p} pos={[0, 0, 0]} c={c} />,
  },
  {
    kind: 'gaveteiro', name: 'Gaveteiro', cat: 'escritorio', size: [0.5, 0.6], h: 0.7, place: 'chao', colors: WOODS,
    render: (p, c = '#f4f4f2') => (
      <group>
        <PBox p={p} pos={[0, 0.36, 0]} size={[0.5, 0.62, 0.6]} color={c} />
        {[0.55, 0.36, 0.17].map((y) => (
          <group key={y}>
            <PBox p={p} pos={[0, y, 0.305]} size={[0.44, 0.16, 0.01]} color={shade(c, 0.88)} outline={false} />
            <PBox p={p} pos={[0, y + 0.03, 0.315]} size={[0.14, 0.02, 0.02]} color={p.metal} outline={false} />
          </group>
        ))}
        {[[-0.18, -0.2], [0.18, -0.2], [-0.18, 0.2], [0.18, 0.2]].map(([x, z]) => <PBox key={`${x}${z}`} p={p} pos={[x, 0.025, z]} size={[0.06, 0.05, 0.06]} color="#22252c" outline={false} />)}
      </group>
    ),
  },
  {
    kind: 'armarios', name: 'Armários coloridos', cat: 'escritorio', size: [2, 0.5], h: 1.9, place: 'chao', colors: ['multi', ...BRIGHT],
    render: (p, c = 'multi') => (
      <group>
        {[0, 1, 2, 3].map((i) => {
          const col = c === 'multi' ? BRIGHT[i] : c;
          return (
            <group key={i} position={[-0.75 + i * 0.5, 0, 0]}>
              <PBox p={p} pos={[0, 0.95, 0]} size={[0.48, 1.9, 0.5]} color={col} />
              {[1.55, 1.5, 1.45, 0.55, 0.5, 0.45].map((y) => <PBox key={y} p={p} pos={[0, y, 0.255]} size={[0.3, 0.02, 0.01]} color={shade(col, 0.7)} outline={false} />)}
              <PBox p={p} pos={[0.17, 1.05, 0.26]} size={[0.03, 0.14, 0.02]} color="#e9e9ea" outline={false} />
              <PBox p={p} pos={[0, 1.7, 0.255]} size={[0.16, 0.08, 0.01]} color="#ffffff" outline={false} />
            </group>
          );
        })}
      </group>
    ),
  },
  {
    kind: 'cabine', name: 'Cabine acústica', cat: 'escritorio', size: [1.2, 1.2], h: 2.3, place: 'chao', colors: ['#2a9d8f', '#3d3d46', '#e76f51', '#9b5cff', '#f4f4f2'],
    render: (p, c = '#2a9d8f') => (
      <group>
        <PBox p={p} pos={[0, 0.05, 0]} size={[1.2, 0.1, 1.2]} color="#2b2b30" />
        <PBox p={p} pos={[0, 1.15, -0.55]} size={[1.2, 2.1, 0.1]} color={c} />
        <PBox p={p} pos={[-0.55, 1.15, 0]} size={[0.1, 2.1, 1.2]} color={c} />
        <PBox p={p} pos={[0.55, 1.15, 0]} size={[0.1, 2.1, 1.2]} color={c} />
        <PBox p={p} pos={[0, 2.25, 0]} size={[1.2, 0.1, 1.2]} color={shade(c, 0.8)} />
        <PBox p={p} pos={[0, 2.19, 0.1]} size={[0.5, 0.02, 0.3]} color="#fff6d8" glow outline={false} cast={false} />
        <PBox p={p} pos={[0, 1.05, -0.38]} size={[0.9, 0.05, 0.26]} color={p.wood} />
        <Laptop p={p} pos={[0, 1.08, -0.38]} />
        <Stool p={p} pos={[0, 0.1, 0.05]} c={shade(c, 1.2)} h={0.62} />
        <Glass pos={[0, 1.15, 0.58]} size={[1.0, 2.0, 0.03]} />
        <PBox p={p} pos={[0.4, 1.1, 0.62]} size={[0.03, 0.4, 0.04]} color={p.metal} outline={false} />
      </group>
    ),
  },
  {
    kind: 'lousa', name: 'Lousa com rodinhas', cat: 'escritorio', size: [1.6, 0.5], h: 1.9, place: 'chao',
    render: (p) => (
      <group>
        {[-0.75, 0.75].map((x) => (
          <group key={x}>
            <PBox p={p} pos={[x, 0.9, 0]} size={[0.05, 1.8, 0.05]} color={p.metal} />
            <PBox p={p} pos={[x, 0.05, 0]} size={[0.08, 0.05, 0.5]} color={p.metal} />
          </group>
        ))}
        <PBox p={p} pos={[0, 1.2, 0]} size={[1.5, 1, 0.04]} color="#d7dbe0" />
        <PBox p={p} pos={[0, 1.2, 0.022]} size={[1.42, 0.92, 0.005]} color="#fbfbf8" outline={false} />
        <PBox p={p} pos={[-0.35, 1.4, 0.026]} size={[0.5, 0.03, 0.005]} color="#118ab2" outline={false} />
        <PBox p={p} pos={[-0.3, 1.3, 0.026]} size={[0.6, 0.03, 0.005]} color="#118ab2" outline={false} />
        <PBox p={p} pos={[0.35, 1.25, 0.026]} size={[0.3, 0.3, 0.005]} color="#ef476f" outline={false} />
        <PBox p={p} pos={[-0.1, 0.98, 0.026]} size={[0.9, 0.03, 0.005]} color="#06d6a0" outline={false} />
        <PBox p={p} pos={[0, 0.68, 0.05]} size={[1.2, 0.03, 0.08]} color="#d7dbe0" />
      </group>
    ),
  },
  {
    kind: 'impressora', name: 'Impressora', cat: 'escritorio', size: [0.7, 0.6], h: 1.1, place: 'chao',
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0.35, 0]} size={[0.7, 0.7, 0.6]} color={p.woodDark} />
        <PBox p={p} pos={[0, 0.85, 0]} size={[0.62, 0.3, 0.52]} color="#e4e6ea" />
        <PBox p={p} pos={[0, 1.01, -0.05]} size={[0.5, 0.02, 0.36]} color="#cfd3d8" outline={false} />
        <PBox p={p} pos={[0, 0.82, 0.3]} size={[0.4, 0.04, 0.12]} color={p.paper} />
        <PBox p={p} pos={[0.22, 0.95, 0.265]} size={[0.06, 0.04, 0.01]} color="#06d6a0" glow outline={false} />
      </group>
    ),
  },
  {
    kind: 'estante', name: 'Estante de livros', cat: 'escritorio', size: [2.4, 0.6], h: 1.9, place: 'chao',
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0.95, 0]} size={[2.4, 1.9, 0.5]} color={p.woodDark} />
        {[0.18, 0.72, 1.26].map((y, i) => (
          <group key={i}>
            <PBox p={p} pos={[0, y + 0.22, 0.2]} size={[2.2, 0.44, 0.12]} color="#ffffff" map={booksTexture()} outline={false} />
            <PBox p={p} pos={[0, y, 0.18]} size={[2.24, 0.05, 0.22]} color={p.wood} outline={false} />
          </group>
        ))}
        <Plant p={p} pos={[0.8, 1.9, 0]} scale={0.5} />
      </group>
    ),
  },
  {
    kind: 'estante-baixa', name: 'Nicho baixo com vasos', cat: 'escritorio', size: [1.8, 0.45], h: 1.2, place: 'chao', colors: WOODS,
    render: (p, c = WOODS[1]) => (
      <group>
        <PBox p={p} pos={[0, 0.4, 0]} size={[1.8, 0.8, 0.45]} color={c} />
        {[-0.65, -0.22, 0.22, 0.65].map((x, i) => (
          <PBox key={x} p={p} pos={[x, 0.4, 0.2]} size={[0.38, 0.66, 0.06]} color={i % 2 ? '#ffffff' : shade(c, 0.6)} map={i % 2 ? booksTexture() : null} outline={false} />
        ))}
        <Plant p={p} pos={[-0.6, 0.8, 0]} scale={0.45} />
        <PCyl p={p} pos={[0.1, 0.92, 0]} r={0.08} rTop={0.05} h={0.24} color="#e76f51" sides={8} />
        <PBox p={p} pos={[0.55, 0.86, 0]} size={[0.36, 0.12, 0.24]} color="#264653" />
      </group>
    ),
  },

  {
    kind: 'cabideiro', name: 'Cabideiro', cat: 'escritorio', size: [0.5, 0.5], h: 1.8, place: 'chao',
    render: (p) => (
      <group>
        <PCyl p={p} pos={[0, 0.03, 0]} r={0.22} h={0.06} color={p.woodDark} sides={8} />
        <PCyl p={p} pos={[0, 0.9, 0]} r={0.035} h={1.7} color={p.woodDark} sides={6} />
        <PBox p={p} pos={[0.12, 1.5, 0]} size={[0.24, 0.5, 0.2]} color={p.fabricAlt} />
        <PBox p={p} pos={[-0.1, 1.62, 0.05]} size={[0.2, 0.12, 0.2]} color={p.fabric} />
      </group>
    ),
  },

  // ------------------------------------------------ lounge
  {
    kind: 'sofa', name: 'Sofá', cat: 'lounge', size: [2.6, 1], h: 1, place: 'chao', colors: FABRICS,
    render: (p, c = p.fabric) => (
      <group>
        <PBox p={p} pos={[0, 0.22, 0]} size={[2.6, 0.3, 1]} color={p.woodDark} />
        <PBox p={p} pos={[0, 0.44, 0.05]} size={[2.2, 0.16, 0.86]} color={c} />
        <PBox p={p} pos={[0, 0.72, -0.38]} size={[2.6, 0.62, 0.24]} color={c} />
        <PBox p={p} pos={[-1.2, 0.56, 0]} size={[0.24, 0.42, 1]} color={c} />
        <PBox p={p} pos={[1.2, 0.56, 0]} size={[0.24, 0.42, 1]} color={c} />
        <PBox p={p} pos={[-0.55, 0.62, -0.18]} size={[0.5, 0.36, 0.14]} color={p.paper} rot={[0.25, 0, 0]} />
        <PBox p={p} pos={[0.55, 0.62, -0.18]} size={[0.5, 0.36, 0.14]} color="#f1c40f" rot={[0.25, 0, 0]} />
      </group>
    ),
  },
  {
    kind: 'poltrona', name: 'Poltrona', cat: 'lounge', size: [1, 0.9], h: 1, place: 'chao', colors: FABRICS,
    render: (p, c = '#2a9d8f') => (
      <group>
        {[[-0.4, -0.35], [0.4, -0.35], [-0.4, 0.35], [0.4, 0.35]].map(([x, z]) => <PBox key={`${x}${z}`} p={p} pos={[x, 0.08, z]} size={[0.06, 0.16, 0.06]} color={p.woodDark} outline={false} />)}
        <PBox p={p} pos={[0, 0.3, 0]} size={[1, 0.28, 0.9]} color={c} />
        <PBox p={p} pos={[0, 0.48, 0.06]} size={[0.66, 0.1, 0.7]} color={shade(c, 1.1)} />
        <PBox p={p} pos={[0, 0.72, -0.36]} size={[1, 0.6, 0.18]} color={c} />
        <PBox p={p} pos={[-0.43, 0.56, 0]} size={[0.14, 0.24, 0.9]} color={c} />
        <PBox p={p} pos={[0.43, 0.56, 0]} size={[0.14, 0.24, 0.9]} color={c} />
        <PBox p={p} pos={[0, 0.66, -0.22]} size={[0.4, 0.3, 0.12]} color="#f4efe4" rot={[0.2, 0, 0]} />
      </group>
    ),
  },
  {
    kind: 'pufe', name: 'Pufe', cat: 'lounge', size: [0.8, 0.8], h: 0.6, place: 'chao', colors: FABRICS,
    render: (p, c = '#f1c40f') => (
      <group>
        <PCyl p={p} pos={[0, 0.17, 0]} r={0.38} rTop={0.4} h={0.34} color={c} sides={10} />
        <PCyl p={p} pos={[0, 0.4, 0]} r={0.37} rTop={0.24} h={0.14} color={shade(c, 1.1)} sides={10} outline={false} />
        <PBox p={p} pos={[0, 0.48, 0]} size={[0.3, 0.04, 0.3]} color={shade(c, 0.85)} rot={[0, 0.4, 0]} outline={false} />
      </group>
    ),
  },
  {
    kind: 'mesa-centro', name: 'Mesa de centro', cat: 'lounge', size: [1.2, 0.7], h: 0.6, place: 'chao', colors: WOODS,
    render: (p, c = WOODS[1]) => (
      <group>
        <PBox p={p} pos={[0, 0.4, 0]} size={[1.2, 0.06, 0.7]} color={c} />
        <PBox p={p} pos={[0, 0.14, 0]} size={[1.08, 0.04, 0.58]} color={shade(c, 0.8)} outline={false} />
        {[[-0.54, -0.29], [0.54, -0.29], [-0.54, 0.29], [0.54, 0.29]].map(([x, z]) => <group key={`${x}${z}`}>{leg(p, [x, 0, z], 0.38, '#2b2b30', 0.04)}</group>)}
        <PBox p={p} pos={[-0.3, 0.46, 0]} size={[0.36, 0.06, 0.26]} color="#ef476f" />
        <PBox p={p} pos={[-0.3, 0.52, 0.01]} size={[0.32, 0.05, 0.24]} color="#118ab2" rot={[0, 0.15, 0]} />
        <PCyl p={p} pos={[0.32, 0.47, 0.06]} r={0.05} h={0.09} color="#f4efe4" sides={8} />
        <PCyl p={p} pos={[0.2, 0.49, -0.15]} r={0.06} h={0.12} color="#e76f51" sides={8} />
        <PBox p={p} pos={[0.2, 0.6, -0.15]} size={[0.14, 0.1, 0.14]} color={p.plant} />
      </group>
    ),
  },
  {
    kind: 'arquibancada', name: 'Arquibancada de madeira', cat: 'lounge', size: [3, 2], h: 1.3, place: 'chao', colors: FABRICS,
    render: (p, c = '#9b5cff') => (
      <group>
        {[0, 1, 2].map((i) => (
          <PBox key={i} p={p} pos={[0, ((i + 1) * 0.42) / 2, 0.667 - i * 0.667]} size={[3, (i + 1) * 0.42, 0.667]} color={i % 2 ? p.woodDark : p.wood} />
        ))}
        {[0, 1, 2].map((i) => [-0.9, 0.2, 1.1].filter((_, j) => (i + j) % 2 === 0).map((x) => (
          <PBox key={`${i}${x}`} p={p} pos={[x, (i + 1) * 0.42 + 0.04, 0.72 - i * 0.667]} size={[0.7, 0.08, 0.45]} color={i === 1 ? shade(c, 1.2) : c} />
        )))}
        <Plant p={p} pos={[-1.2, 1.26, -0.67]} scale={0.6} />
      </group>
    ),
  },
  {
    kind: 'cabana', name: 'Cabana criativa', cat: 'lounge', size: [2, 2], h: 2.6, place: 'chao', colors: ['#e9c46a', '#8ecae6', '#f4a261', '#90be6d', '#cdb4db'],
    render: (p, c = '#e9c46a') => (
      <group>
        <PBox p={p} pos={[0, 0.04, 0]} size={[2, 0.08, 2]} color={p.woodDark} />
        <PBox p={p} pos={[0, 1.0, -0.95]} size={[2, 1.9, 0.1]} color={c} />
        <PBox p={p} pos={[-0.95, 1.0, 0]} size={[0.1, 1.9, 2]} color={c} />
        <PBox p={p} pos={[0.95, 1.0, 0]} size={[0.1, 1.9, 2]} color={c} />
        <PBox p={p} pos={[-0.65, 1.0, 0.95]} size={[0.7, 1.9, 0.1]} color={c} />
        <PBox p={p} pos={[0.65, 1.0, 0.95]} size={[0.7, 1.9, 0.1]} color={c} />
        <PBox p={p} pos={[0, 1.75, 0.95]} size={[0.6, 0.4, 0.1]} color={c} />
        <PBox p={p} pos={[1.005, 1.15, 0.2]} size={[0.02, 0.5, 0.6]} color="#9fd8ff" glow outline={false} cast={false} />
        <PBox p={p} pos={[0, 2.12, 0.72]} size={[2.1, 0.1, 0.62]} rot={[0.55, 0, 0]} color="#c0392b" />
        <PBox p={p} pos={[0, 2.12, -0.72]} size={[2.1, 0.1, 0.62]} rot={[-0.55, 0, 0]} color="#c0392b" />
        <PBox p={p} pos={[0, 2.06, 0]} size={[2.1, 0.12, 1.0]} color="#a93226" />
        <PBox p={p} pos={[0, 1.95, 1.02]} size={[1.9, 0.05, 0.02]} color="#ffd23f" glow outline={false} cast={false} />
        <PBox p={p} pos={[0, 1.4, 1.03]} size={[0.5, 0.18, 0.02]} color="#f4efe4" outline={false} />
        <PBox p={p} pos={[0, 0.74, -0.6]} size={[1.4, 0.05, 0.5]} color={p.wood} />
        <PBox p={p} pos={[0, 1.02, -0.78]} size={[0.6, 0.36, 0.04]} color="#ffffff" map={screenTexture(p.screenGlow)} glow outline={false} cast={false} />
      </group>
    ),
  },
  {
    kind: 'rede', name: 'Rede de descanso', cat: 'lounge', size: [2.8, 1], h: 1.6, place: 'chao', colors: ['#e63946', '#2a9d8f', '#f4a261', '#9b5cff'],
    render: (p, c = '#e63946') => (
      <group>
        {[-1.3, 1.3].map((x) => (
          <group key={x}>
            <PBox p={p} pos={[x, 0.8, 0]} size={[0.12, 1.6, 0.12]} color={p.woodDark} />
            <PBox p={p} pos={[x, 0.04, 0]} size={[0.2, 0.08, 0.9]} color={p.woodDark} />
          </group>
        ))}
        {Array.from({ length: 9 }).map((_, i) => {
          const x = -1.0 + i * 0.25;
          const y = 0.55 + 0.42 * (x / 1.0) ** 2;
          return <PBox key={i} p={p} pos={[x, y, 0]} size={[0.26, 0.06, 0.7]} rot={[0, 0, Math.atan(0.84 * x)]} color={i % 2 ? '#f4efe4' : c} out={0.025} />;
        })}
        {[-1, 1].map((s) => <PBox key={s} p={p} pos={[s * 1.15, 1.2, 0]} size={[0.3, 0.02, 0.02]} rot={[0, 0, s * -0.9]} color="#f4efe4" outline={false} />)}
      </group>
    ),
  },
  {
    kind: 'capsula', name: 'Cápsula de soneca', cat: 'lounge', size: [2, 1], h: 1.3, place: 'chao', colors: ['#f4f4f2', '#3d3d46', '#8ecae6'],
    render: (p, c = '#f4f4f2') => (
      <group>
        <PBox p={p} pos={[0, 0.25, 0]} size={[2, 0.5, 1]} color={c} />
        <PBox p={p} pos={[0.1, 0.55, 0]} size={[1.6, 0.12, 0.8]} color="#3d3d46" />
        <PBox p={p} pos={[-0.75, 0.68, 0]} size={[0.3, 0.16, 0.6]} color="#f4efe4" />
        <PBox p={p} pos={[-0.55, 1.0, 0]} size={[0.9, 0.08, 1]} color={c} rot={[0, 0, -0.35]} />
        <PBox p={p} pos={[-0.95, 0.85, 0]} size={[0.1, 0.6, 1]} color={c} />
        <PBox p={p} pos={[-0.55, 0.95, 0]} size={[0.6, 0.02, 0.5]} color="#9b5cff" glow outline={false} cast={false} rot={[0, 0, -0.35]} />
      </group>
    ),
  },

  // ------------------------------------------------ plantas
  {
    kind: 'planta', name: 'Planta em vaso', cat: 'plantas', size: [0.7, 0.7], h: 1.3, place: 'chao',
    render: (p) => <Plant p={p} pos={[0, 0, 0]} />,
  },
  {
    kind: 'costela', name: 'Costela-de-adão', cat: 'plantas', size: [0.9, 0.9], h: 1.4, place: 'chao', colors: ['#c8643b', '#f4f4f2', '#2b2b30'],
    render: (p, c = '#f4f4f2') => (
      <group>
        <PCyl p={p} pos={[0, 0.2, 0]} r={0.24} rTop={0.26} h={0.4} color={c} sides={8} />
        {[0, 1.2, 2.4, 3.6, 4.8].map((a, i) => (
          <group key={a} rotation={[0, a, 0]}>
            <PBox p={p} pos={[0, 0.62 + i * 0.08, 0.1]} size={[0.02, 0.4 + i * 0.08, 0.02]} color={p.plantDark} outline={false} rot={[0.4, 0, 0]} />
            <PBox p={p} pos={[0, 0.85 + i * 0.1, 0.34]} size={[0.38, 0.03, 0.42]} color={i % 2 ? p.plant : p.plantDark} rot={[-0.5, 0, 0]} />
          </group>
        ))}
      </group>
    ),
  },
  {
    kind: 'cacto', name: 'Cacto', cat: 'plantas', size: [0.5, 0.5], h: 1, place: 'chao',
    render: (p) => (
      <group>
        <PCyl p={p} pos={[0, 0.15, 0]} r={0.18} rTop={0.2} h={0.3} color="#e76f51" sides={8} />
        <PBox p={p} pos={[0, 0.55, 0]} size={[0.18, 0.6, 0.18]} color="#4e9a32" />
        <PBox p={p} pos={[0.15, 0.6, 0]} size={[0.12, 0.08, 0.1]} color="#4e9a32" />
        <PBox p={p} pos={[0.2, 0.7, 0]} size={[0.08, 0.2, 0.1]} color="#4e9a32" />
        <PBox p={p} pos={[-0.14, 0.5, 0]} size={[0.1, 0.08, 0.1]} color="#4e9a32" />
        <PBox p={p} pos={[-0.18, 0.58, 0]} size={[0.08, 0.16, 0.1]} color="#4e9a32" />
        <PBox p={p} pos={[0, 0.88, 0]} size={[0.08, 0.06, 0.08]} color="#ff4fd8" />
      </group>
    ),
  },
  {
    kind: 'palmeira', name: 'Palmeira areca', cat: 'plantas', size: [0.8, 0.8], h: 1.9, place: 'chao',
    render: (p) => (
      <group>
        <PCyl p={p} pos={[0, 0.25, 0]} r={0.26} rTop={0.3} h={0.5} color="#d9cbb8" sides={8} />
        {[0, 0.9, 1.8, 2.7, 3.6, 4.5, 5.4].map((a, i) => (
          <group key={a} rotation={[0, a, 0]}>
            <PBox p={p} pos={[0, 1.0 + (i % 3) * 0.15, 0.12]} size={[0.03, 1.0, 0.03]} color={p.plantDark} outline={false} rot={[0.25, 0, 0]} />
            <PBox p={p} pos={[0, 1.45 + (i % 3) * 0.15, 0.4]} size={[0.22, 0.03, 0.6]} color={i % 2 ? p.plant : shade(p.plant, 1.15)} rot={[-0.6, 0, 0]} />
          </group>
        ))}
      </group>
    ),
  },
  {
    kind: 'arvore', name: 'Árvore com banco', cat: 'plantas', size: [1.6, 1.6], h: 2.8, place: 'chao', colors: WOODS,
    render: (p, c = WOODS[0]) => (
      <group>
        <PBox p={p} pos={[0, 0.25, 0]} size={[1.6, 0.5, 1.6]} color="#b8b2a7" />
        {[[0, 0.72], [0, -0.72], [0.72, 0], [-0.72, 0]].map(([x, z]) => (
          <PBox key={`${x}${z}`} p={p} pos={[x, 0.53, z]} size={x ? [0.16, 0.06, 1.6] : [1.6, 0.06, 0.16]} color={c} />
        ))}
        <PBox p={p} pos={[0, 0.52, 0]} size={[1.2, 0.04, 1.2]} color="#5b3a22" outline={false} />
        <PCyl p={p} pos={[0, 1.2, 0]} r={0.1} rTop={0.07} h={1.4} color="#7a5232" sides={6} />
        <Foliage p={p} pos={[0, 2.0, 0]} s={1.15} />
      </group>
    ),
  },
  {
    kind: 'horta', name: 'Horta de canteiro', cat: 'plantas', size: [2, 0.8], h: 1, place: 'chao',
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0.3, 0]} size={[2, 0.6, 0.8]} color={p.wood} />
        {[0.25, 0.45].map((y) => <PBox key={y} p={p} pos={[0, y, 0.405]} size={[1.96, 0.02, 0.01]} color={p.woodDark} outline={false} />)}
        <PBox p={p} pos={[0, 0.61, 0]} size={[1.86, 0.03, 0.66]} color="#5b3a22" outline={false} />
        {[-0.75, -0.45, -0.15].map((x) => [-0.15, 0.15].map((z) => <PBox key={`${x}${z}`} p={p} pos={[x, 0.7, z]} size={[0.22, 0.14, 0.22]} color={z > 0 ? '#79c653' : '#5fae3e'} rot={[0, 0.5, 0]} />))}
        {[0.25, 0.6].map((x) => (
          <group key={x}>
            <PBox p={p} pos={[x, 0.9, 0]} size={[0.03, 0.6, 0.03]} color={p.woodDark} outline={false} />
            <PBox p={p} pos={[x, 0.85, 0]} size={[0.24, 0.34, 0.24]} color={p.plantDark} />
            <PBox p={p} pos={[x + 0.08, 0.86, 0.1]} size={[0.07, 0.07, 0.07]} color="#e63946" outline={false} />
            <PBox p={p} pos={[x - 0.06, 0.78, 0.12]} size={[0.07, 0.07, 0.07]} color="#e63946" outline={false} />
          </group>
        ))}
        {[0.85, 0.95].map((x) => <PBox key={x} p={p} pos={[x, 0.7, 0]} size={[0.04, 0.14, 0.04]} color="#79c653" outline={false} />)}
        <PBox p={p} pos={[-0.8, 0.5, 0.42]} size={[0.3, 0.14, 0.02]} color="#f4efe4" outline={false} />
      </group>
    ),
  },

  // ------------------------------------------------ copa
  {
    kind: 'geladeira', name: 'Geladeira', cat: 'copa', size: [0.9, 0.7], h: 1.9, place: 'chao', colors: ['#dfe5ea', '#ff9f9f', '#8ecae6', '#2b2b30'],
    render: (p, c = '#dfe5ea') => (
      <group>
        <PBox p={p} pos={[0, 0.95, 0]} size={[0.9, 1.9, 0.7]} color={c} />
        <PBox p={p} pos={[0, 1.32, 0.36]} size={[0.86, 0.02, 0.02]} color="#9aa3ad" outline={false} />
        <PBox p={p} pos={[0.32, 1.6, 0.37]} size={[0.04, 0.3, 0.03]} color="#9aa3ad" outline={false} />
        <PBox p={p} pos={[0.32, 0.9, 0.37]} size={[0.04, 0.4, 0.03]} color="#9aa3ad" outline={false} />
        <PBox p={p} pos={[-0.2, 1.62, 0.37]} size={[0.14, 0.14, 0.01]} color="#ffd166" outline={false} />
        <PBox p={p} pos={[-0.05, 1.68, 0.37]} size={[0.12, 0.1, 0.01]} color="#ef476f" outline={false} />
      </group>
    ),
  },
  {
    kind: 'maquina-lanches', name: 'Máquina de lanches', cat: 'copa', size: [0.95, 0.75], h: 2, place: 'chao', colors: ['#c0392b', '#264653', '#9b5cff'],
    render: (p, c = '#c0392b') => (
      <group>
        <PBox p={p} pos={[0, 1, 0]} size={[0.95, 2, 0.75]} color={c} />
        <PBox p={p} pos={[-0.12, 1.2, 0.38]} size={[0.6, 1.2, 0.02]} color="#1b2633" glow outline={false} cast={false} />
        {[0, 1, 2, 3].map((r) => [0, 1, 2].map((col) => (
          <PBox key={`${r}${col}`} p={p} pos={[-0.32 + col * 0.2, 1.65 - r * 0.28, 0.4]} size={[0.12, 0.16, 0.02]} color={['#ffd166', '#06d6a0', '#ef476f', '#7fd3ff'][(r + col) % 4]} glow outline={false} cast={false} />
        )))}
        <PBox p={p} pos={[0.33, 1.2, 0.39]} size={[0.16, 0.5, 0.02]} color="#9aa3ad" outline={false} />
        <PBox p={p} pos={[-0.12, 0.35, 0.39]} size={[0.6, 0.2, 0.02]} color="#1d1720" outline={false} />
      </group>
    ),
  },
  {
    kind: 'bebedouro', name: 'Bebedouro', cat: 'copa', size: [0.5, 0.5], h: 1.5, place: 'chao',
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0.5, 0]} size={[0.44, 1, 0.44]} color="#e9edf1" />
        <PBox p={p} pos={[0.1, 0.78, 0.23]} size={[0.06, 0.08, 0.02]} color="#3f7fd6" outline={false} />
        <PBox p={p} pos={[-0.1, 0.78, 0.23]} size={[0.06, 0.08, 0.02]} color="#d64545" outline={false} />
        <PCyl p={p} pos={[0, 1.24, 0]} r={0.19} h={0.48} color="#8fd0ff" sides={10} />
      </group>
    ),
  },
  {
    kind: 'bar-cereais', name: 'Bar de cereais', cat: 'copa', size: [1.6, 0.6], h: 1.5, place: 'chao', colors: WOODS,
    render: (p, c = WOODS[1]) => (
      <group>
        <PBox p={p} pos={[0, 0.45, 0]} size={[1.6, 0.9, 0.6]} color={c} />
        <PBox p={p} pos={[0, 0.92, 0]} size={[1.66, 0.05, 0.66]} color="#f4f4f2" />
        {['#f4a261', '#e9c46a', '#e76f51', '#90be6d'].map((col, i) => (
          <group key={i} position={[-0.6 + i * 0.4, 0, -0.1]}>
            <PCyl p={p} pos={[0, 1.02, 0]} r={0.1} h={0.16} color="#3d3d46" sides={8} />
            <PCyl p={p} pos={[0, 1.2, 0]} r={0.12} h={0.3} color={col} sides={10} outline={false} />
            <Glass pos={[0, 1.24, 0]} size={[0.28, 0.42, 0.28]} opacity={0.25} />
            <PCyl p={p} pos={[0, 1.48, 0]} r={0.13} h={0.04} color="#3d3d46" sides={8} />
          </group>
        ))}
        <PCyl p={p} pos={[0.55, 0.98, 0.2]} r={0.1} rTop={0.13} h={0.08} color="#f4efe4" sides={10} />
        <PCyl p={p} pos={[0.25, 0.98, 0.2]} r={0.1} rTop={0.13} h={0.08} color="#8ecae6" sides={10} />
      </group>
    ),
  },
  {
    kind: 'mesa-bistro', name: 'Mesa bistrô com banquetas', cat: 'copa', size: [1.5, 1.5], h: 1.1, place: 'chao', colors: FABRICS,
    render: (p, c = '#e76f51') => (
      <group>
        <PCyl p={p} pos={[0, 0.03, 0]} r={0.28} h={0.06} color="#2b2b30" sides={10} />
        <PCyl p={p} pos={[0, 0.52, 0]} r={0.04} h={1} color="#2b2b30" sides={6} outline={false} />
        <PCyl p={p} pos={[0, 1.04, 0]} r={0.45} h={0.05} color="#f4f4f2" sides={14} />
        <PCyl p={p} pos={[0.1, 1.11, 0.1]} r={0.05} h={0.09} color={c} sides={8} />
        <Stool p={p} pos={[-0.55, 0, 0.35]} c={c} />
        <Stool p={p} pos={[0.55, 0, -0.35]} c={c} />
      </group>
    ),
  },
  {
    kind: 'espresso', name: 'Carrinho de espresso', cat: 'copa', size: [0.8, 0.6], h: 1.4, place: 'chao', colors: WOODS,
    render: (p, c = WOODS[1]) => (
      <group>
        {[[-0.36, -0.26], [0.36, -0.26], [-0.36, 0.26], [0.36, 0.26]].map(([x, z]) => <group key={`${x}${z}`}>{leg(p, [x, 0, z], 0.9, '#2b2b30', 0.04)}</group>)}
        {[0.3, 0.9].map((y) => <PBox key={y} p={p} pos={[0, y, 0]} size={[0.8, 0.05, 0.6]} color={c} />)}
        <PBox p={p} pos={[0, 1.12, -0.05]} size={[0.5, 0.4, 0.4]} color="#c9ccd1" />
        <PBox p={p} pos={[0, 1.33, -0.05]} size={[0.52, 0.04, 0.42]} color="#2b2b30" />
        <PBox p={p} pos={[0, 1.05, 0.17]} size={[0.14, 0.06, 0.08]} color="#2b2b30" />
        <PCyl p={p} pos={[0, 0.97, 0.18]} r={0.04} h={0.07} color="#f4efe4" sides={8} />
        {[-0.25, -0.1, 0.05, 0.2].map((x) => <PCyl key={x} p={p} pos={[x, 0.36, 0.1]} r={0.04} h={0.07} color="#f4efe4" sides={8} />)}
        <PBox p={p} pos={[0.17, 1.2, 0.155]} size={[0.05, 0.05, 0.01]} color="#06d6a0" glow outline={false} />
      </group>
    ),
  },

  // ------------------------------------------------ lazer
  {
    kind: 'pebolim', name: 'Pebolim', cat: 'lazer', size: [1.4, 0.8], h: 1, place: 'chao', colors: ['#264653', '#b9824e', '#c0392b'],
    render: (p, c = '#264653') => (
      <group>
        {[[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]].map(([x, z]) => <group key={`${x}${z}`}>{leg(p, [x, 0, z], 0.6, '#1d1720', 0.08)}</group>)}
        <PBox p={p} pos={[0, 0.76, 0]} size={[1.4, 0.32, 0.8]} color={c} />
        <PBox p={p} pos={[0, 0.93, 0]} size={[1.26, 0.01, 0.66]} color="#2e9e4f" outline={false} />
        <PBox p={p} pos={[0, 0.94, 0]} size={[0.02, 0.005, 0.66]} color="#ffffff" outline={false} />
        {[-0.5, -0.3, -0.1, 0.1, 0.3, 0.5].map((x, i) => (
          <group key={x}>
            <PCyl p={p} pos={[x, 1.0, 0]} r={0.015} h={1.2} color="#d7dbe0" sides={6} outline={false} rot={[Math.PI / 2, 0, 0]} />
            <PCyl p={p} pos={[x, 1.0, 0.64]} r={0.035} h={0.1} color="#1d1720" sides={6} rot={[Math.PI / 2, 0, 0]} />
            {[-0.2, 0, 0.2].filter((_, j) => i % 2 || j !== 1).map((z) => (
              <PBox key={z} p={p} pos={[x, 0.98, z]} size={[0.05, 0.12, 0.05]} color={i % 2 ? '#3f7fd6' : '#d64545'} outline={false} />
            ))}
          </group>
        ))}
      </group>
    ),
  },
  {
    kind: 'pingpong', name: 'Mesa de pingue-pongue', cat: 'lazer', size: [2.8, 1.6], h: 0.9, place: 'chao', colors: ['#2b5aa8', '#2e9e4f'],
    render: (p, c = '#2b5aa8') => (
      <group>
        {[[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]].map(([x, z]) => <group key={`${x}${z}`}>{leg(p, [x, 0, z], 0.72, '#2b2b30', 0.06)}</group>)}
        <PBox p={p} pos={[0, 0.74, 0]} size={[2.8, 0.05, 1.6]} color={c} />
        <PBox p={p} pos={[0, 0.768, 0]} size={[2.7, 0.003, 0.02]} color="#ffffff" outline={false} />
        {[-0.78, 0.78].map((z) => <PBox key={z} p={p} pos={[0, 0.768, z]} size={[2.8, 0.003, 0.03]} color="#ffffff" outline={false} />)}
        {[-1.38, 1.38].map((x) => <PBox key={x} p={p} pos={[x, 0.768, 0]} size={[0.03, 0.003, 1.6]} color="#ffffff" outline={false} />)}
        <PBox p={p} pos={[0, 0.85, 0]} size={[0.02, 0.16, 1.7]} color="#f4efe4" />
        <PCyl p={p} pos={[-0.8, 0.78, 0.3]} r={0.08} h={0.02} color="#d64545" sides={10} />
        <PCyl p={p} pos={[0.9, 0.78, -0.4]} r={0.08} h={0.02} color="#1d1720" sides={10} />
        <PBox p={p} pos={[0.4, 0.8, 0.1]} size={[0.04, 0.04, 0.04]} color="#ff9f1c" outline={false} />
      </group>
    ),
  },
  {
    kind: 'fliperama', name: 'Fliperama', cat: 'lazer', size: [0.8, 0.8], h: 1.9, place: 'chao', colors: ['#5b2a86', '#c0392b', '#264653', '#2b2b30'],
    render: (p, c = '#5b2a86') => (
      <group>
        <PBox p={p} pos={[0, 0.5, -0.05]} size={[0.8, 1, 0.7]} color={c} />
        <PBox p={p} pos={[0, 1.05, 0.12]} size={[0.8, 0.1, 0.4]} color="#2b2b30" rot={[0.25, 0, 0]} />
        <PCyl p={p} pos={[-0.15, 1.13, 0.16]} r={0.03} h={0.1} color="#d64545" sides={6} />
        {[0.05, 0.15, 0.25].map((x) => <PCyl key={x} p={p} pos={[x, 1.1, 0.18]} r={0.03} h={0.03} color={['#ffd23f', '#3ff0ff', '#ff4fd8'][Math.round(x * 10) % 3]} sides={6} glow />)}
        <PBox p={p} pos={[0, 1.45, -0.15]} size={[0.8, 0.7, 0.5]} color={c} />
        <PBox p={p} pos={[0, 1.42, 0.106]} size={[0.62, 0.48, 0.01]} color="#ffffff" map={arcadeTexture()} glow outline={false} cast={false} />
        <PBox p={p} pos={[0, 1.86, -0.1]} size={[0.8, 0.2, 0.6]} color={c} />
        <PBox p={p} pos={[0, 1.86, 0.205]} size={[0.66, 0.12, 0.01]} color="#ffd23f" glow outline={false} cast={false} />
      </group>
    ),
  },
  {
    kind: 'sinuca', name: 'Mesa de sinuca', cat: 'lazer', size: [2.4, 1.4], h: 0.9, place: 'chao', colors: ['#2e7d32', '#1f4e8c', '#8e2c2c'],
    render: (p, c = '#2e7d32') => (
      <group>
        {[[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5]].map(([x, z]) => <PBox key={`${x}${z}`} p={p} pos={[x, 0.3, z]} size={[0.16, 0.6, 0.16]} color={p.woodDark} />)}
        <PBox p={p} pos={[0, 0.7, 0]} size={[2.4, 0.2, 1.4]} color={p.woodDark} />
        <PBox p={p} pos={[0, 0.805, 0]} size={[2.16, 0.01, 1.16]} color={c} outline={false} />
        {[-1.08, 0, 1.08].map((x) => [-0.58, 0.58].map((z) => <PCyl key={`${x}${z}`} p={p} pos={[x, 0.81, z]} r={0.06} h={0.01} color="#1d1720" sides={8} outline={false} />))}
        {[[0.5, 0, '#f4efe4'], [-0.4, 0.1, '#ffd23f'], [-0.5, -0.1, '#d64545'], [-0.6, 0.05, '#3f7fd6'], [-0.55, 0.2, '#1d1720']].map(([x, z, col]) => (
          <PCyl key={String(col)} p={p} pos={[x as number, 0.84, z as number]} r={0.04} h={0.06} color={col as string} sides={8} outline={false} />
        ))}
        <PBox p={p} pos={[0.1, 0.84, 0.35]} size={[1.4, 0.025, 0.025]} rot={[0, 0.2, 0]} color="#e9c46a" outline={false} />
      </group>
    ),
  },
  {
    kind: 'bicicleta', name: 'Bicicleta', cat: 'lazer', size: [1.6, 0.5], h: 1.1, place: 'chao', colors: BRIGHT,
    render: (p, c = '#fbbc05') => (
      <group>
        {[-0.55, 0.55].map((x) => (
          <group key={x} position={[x, 0.36, 0]}>
            <mesh><torusGeometry args={[0.33, 0.035, 6, 14]} /><meshBasicMaterial color="#1d1720" /></mesh>
            <PCyl p={p} pos={[0, 0, 0]} r={0.05} h={0.06} color={p.metal} sides={6} rot={[Math.PI / 2, 0, 0]} outline={false} />
          </group>
        ))}
        <PBox p={p} pos={[0, 0.5, 0]} size={[0.75, 0.05, 0.05]} color={c} rot={[0, 0, -0.35]} />
        <PBox p={p} pos={[-0.12, 0.6, 0]} size={[0.05, 0.5, 0.05]} color={c} rot={[0, 0, 0.25]} />
        <PBox p={p} pos={[0.35, 0.62, 0]} size={[0.05, 0.6, 0.05]} color={c} rot={[0, 0, -0.35]} />
        <PBox p={p} pos={[-0.32, 0.46, 0]} size={[0.5, 0.04, 0.04]} color={c} rot={[0, 0, 0.6]} />
        <PBox p={p} pos={[-0.2, 0.86, 0]} size={[0.24, 0.05, 0.12]} color="#1d1720" />
        <PBox p={p} pos={[0.45, 0.94, 0]} size={[0.05, 0.05, 0.46]} color="#1d1720" />
        <PBox p={p} pos={[0.68, 0.78, 0]} size={[0.26, 0.18, 0.3]} color="#b9824e" />
      </group>
    ),
  },
  {
    kind: 'jukebox', name: 'Jukebox', cat: 'lazer', size: [0.9, 0.6], h: 1.7, place: 'chao', colors: ['#8a5a33', '#c0392b', '#264653'],
    render: (p, c = '#8a5a33') => (
      <group>
        <PBox p={p} pos={[0, 0.7, 0]} size={[0.9, 1.4, 0.6]} color={c} />
        <PCyl p={p} pos={[0, 1.4, 0]} r={0.45} h={0.6} color={c} sides={14} rot={[Math.PI / 2, 0, 0]} />
        <PBox p={p} pos={[0, 1.42, 0.305]} size={[0.6, 0.3, 0.01]} color="#fff6d8" glow outline={false} cast={false} />
        {['#ff4fd8', '#ffd23f', '#3ff0ff'].map((col, i) => <PBox key={col} p={p} pos={[-0.36 + i * 0.36, 0.95, 0.305]} size={[0.08, 0.7, 0.01]} color={col} glow outline={false} cast={false} />)}
        <PBox p={p} pos={[0, 0.45, 0.305]} size={[0.5, 0.36, 0.01]} color="#2b2b30" outline={false} />
        {[0.35, 0.45, 0.55].map((y) => <PBox key={y} p={p} pos={[0, y, 0.312]} size={[0.44, 0.02, 0.005]} color="#9aa3ad" outline={false} />)}
      </group>
    ),
  },
  {
    kind: 'aquario', name: 'Aquário', cat: 'lazer', size: [1.4, 0.5], h: 1.5, place: 'chao',
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0.4, 0]} size={[1.4, 0.8, 0.5]} color={p.woodDark} />
        <PBox p={p} pos={[0, 1.1, 0]} size={[1.3, 0.56, 0.42]} color="#ffffff" map={waterTexture()} glow outline={false} cast={false} />
        <Glass pos={[0, 1.12, 0]} size={[1.36, 0.62, 0.48]} opacity={0.18} />
        <PBox p={p} pos={[0, 1.46, 0]} size={[1.4, 0.08, 0.5]} color="#2b2b30" />
      </group>
    ),
  },

  // ------------------------------------------------ estúdio
  {
    kind: 'tripe-ring', name: 'Tripé com ring light', cat: 'estudio', size: [1, 1], h: 2.2, place: 'chao',
    render: (p) => (
      <group rotation={[0, -0.7, 0]}>
        {[0, 2.1, 4.2].map((a) => <PBox key={a} p={p} pos={[Math.sin(a) * 0.2, 0.45, Math.cos(a) * 0.2]} size={[0.04, 0.95, 0.04]} rot={[Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35]} color="#22252c" />)}
        <PBox p={p} pos={[0, 1.02, 0]} size={[0.34, 0.24, 0.42]} color="#22252c" />
        <PCyl p={p} pos={[0, 1.02, 0.26]} r={0.09} h={0.14} color="#3a3f48" sides={8} rot={[Math.PI / 2, 0, 0]} />
        <PBox p={p} pos={[0.5, 1.4, 0]} size={[0.04, 1.5, 0.04]} color="#22252c" />
        <mesh position={[0.5, 2.1, 0.02]}><torusGeometry args={[0.26, 0.05, 6, 16]} /><meshBasicMaterial color="#fff6d8" toneMapped={false} /></mesh>
      </group>
    ),
  },
  {
    kind: 'cavalete', name: 'Cavalete de pintura', cat: 'estudio', size: [1, 1], h: 1.6, place: 'chao',
    render: (p) => (
      <group rotation={[0, 0.5, 0]}>
        <PBox p={p} pos={[-0.3, 0.8, 0]} size={[0.06, 1.6, 0.06]} color={p.wood} rot={[0.12, 0, 0.12]} />
        <PBox p={p} pos={[0.3, 0.8, 0]} size={[0.06, 1.6, 0.06]} color={p.wood} rot={[0.12, 0, -0.12]} />
        <PBox p={p} pos={[0, 0.8, -0.3]} size={[0.06, 1.6, 0.06]} color={p.wood} rot={[-0.3, 0, 0]} />
        <PBox p={p} pos={[0, 1.15, 0.06]} size={[0.9, 0.7, 0.04]} color="#fbfbf8" />
        <PBox p={p} pos={[-0.15, 1.2, 0.085]} size={[0.32, 0.3, 0.01]} color="#ef476f" outline={false} />
        <PBox p={p} pos={[0.18, 1.05, 0.085]} size={[0.3, 0.22, 0.01]} color="#118ab2" outline={false} />
        <PBox p={p} pos={[0.05, 1.32, 0.085]} size={[0.18, 0.12, 0.01]} color="#ffd166" outline={false} />
        <PBox p={p} pos={[0, 0.78, 0.08]} size={[0.8, 0.04, 0.12]} color={p.wood} />
      </group>
    ),
  },
  {
    kind: 'fundo-infinito', name: 'Fundo infinito', cat: 'estudio', size: [2.6, 1.4], h: 2.5, place: 'chao', colors: ['#f2f2f2', '#2b2b30', '#ffd166', '#8ecae6', '#ff9f9f'],
    render: (p, c = '#f2f2f2') => (
      <group>
        {[-1.25, 1.25].map((x) => (
          <group key={x}>
            <PBox p={p} pos={[x, 1.2, -0.6]} size={[0.05, 2.4, 0.05]} color="#22252c" />
            <PBox p={p} pos={[x, 0.03, -0.6]} size={[0.1, 0.06, 0.6]} color="#22252c" />
          </group>
        ))}
        <PCyl p={p} pos={[0, 2.35, -0.6]} r={0.08} h={2.5} color={shade(c, 0.9)} sides={8} rot={[0, 0, Math.PI / 2]} />
        <PBox p={p} pos={[0, 1.25, -0.62]} size={[2.3, 2.1, 0.02]} color={c} cast={false} outline={false} />
        <PBox p={p} pos={[0, 0.12, -0.46]} size={[2.3, 0.02, 0.36]} color={c} rot={[-0.8, 0, 0]} cast={false} outline={false} />
        <PBox p={p} pos={[0, 0.01, 0.1]} size={[2.3, 0.02, 1]} color={c} cast={false} outline={false} />
      </group>
    ),
  },
  {
    kind: 'softbox', name: 'Softbox', cat: 'estudio', size: [0.8, 0.8], h: 2, place: 'chao',
    render: (p) => (
      <group>
        {[0, 2.1, 4.2].map((a) => <PBox key={a} p={p} pos={[Math.sin(a) * 0.18, 0.4, Math.cos(a) * 0.18]} size={[0.04, 0.85, 0.04]} rot={[Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4]} color="#22252c" />)}
        <PBox p={p} pos={[0, 1.1, 0]} size={[0.04, 1.2, 0.04]} color="#22252c" />
        <group position={[0, 1.75, 0]} rotation={[-0.35, 0, 0]}>
          <PBox p={p} pos={[0, 0, -0.12]} size={[0.6, 0.6, 0.24]} color="#22252c" />
          <PBox p={p} pos={[0, 0, 0.005]} size={[0.56, 0.56, 0.01]} color="#fffaf0" glow outline={false} cast={false} />
        </group>
      </group>
    ),
  },
  {
    kind: 'prancheta', name: 'Prancheta de desenho', cat: 'estudio', size: [1.4, 0.9], h: 1.6, place: 'chao', colors: WOODS,
    render: (p, c = WOODS[0]) => (
      <group>
        {[-0.6, 0.6].map((x) => <PBox key={x} p={p} pos={[x, 0.4, 0]} size={[0.06, 0.8, 0.7]} color="#2b2b30" />)}
        <PBox p={p} pos={[0, 0.88, 0]} size={[1.4, 0.04, 0.9]} color={c} rot={[0.35, 0, 0]} />
        <PBox p={p} pos={[0.1, 0.91, 0.02]} size={[0.7, 0.01, 0.5]} color={p.paper} rot={[0.35, 0, 0]} outline={false} />
        <PBox p={p} pos={[0.05, 0.925, 0.0]} size={[0.4, 0.005, 0.02]} color="#118ab2" rot={[0.35, 0.3, 0]} outline={false} />
        <PBox p={p} pos={[-0.62, 1.2, -0.4]} size={[0.04, 0.7, 0.04]} color="#2b2b30" rot={[0.4, 0, 0]} />
        <PCyl p={p} pos={[-0.62, 1.48, -0.18]} r={0.1} rTop={0.04} h={0.14} color="#e63946" sides={8} rot={[0.8, 0, 0]} />
      </group>
    ),
  },

  // ------------------------------------------------ estrutura
  {
    kind: 'escada-caracol', name: 'Escada caracol', cat: 'estrutura', size: [1.8, 1.8], h: 2.7, place: 'chao', colors: ['#d62b2b', '#2b2b30', '#f4f4f2', '#9b5cff'],
    render: (p, c = '#d62b2b') => (
      <group>
        <PCyl p={p} pos={[0, 1.35, 0]} r={0.08} h={2.7} color={c} sides={8} />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return (
            <group key={i} rotation={[0, a, 0]}>
              <PBox p={p} pos={[0, 0.2 + i * 0.2, 0.45]} size={[0.36, 0.05, 0.8]} color={c} />
              <PBox p={p} pos={[0, 0.5 + i * 0.2, 0.84]} size={[0.03, 0.6, 0.03]} color={shade(c, 0.75)} outline={false} />
            </group>
          );
        })}
        <PCyl p={p} pos={[0, 2.62, 0]} r={0.9} h={0.06} color={shade(c, 0.85)} sides={14} />
      </group>
    ),
  },
  {
    kind: 'divisoria-vidro', name: 'Divisória de vidro', cat: 'estrutura', size: [2, 0.15], h: 2.2, place: 'chao', colors: ['#2b2b30', '#e9e9ea', '#b9824e'],
    render: (p, c = '#2b2b30') => (
      <group>
        <PBox p={p} pos={[0, 0.04, 0]} size={[2, 0.08, 0.12]} color={c} />
        <PBox p={p} pos={[0, 2.16, 0]} size={[2, 0.08, 0.12]} color={c} />
        {[-0.98, 0.98].map((x) => <PBox key={x} p={p} pos={[x, 1.1, 0]} size={[0.05, 2.2, 0.12]} color={c} />)}
        <Glass pos={[0, 1.1, 0]} size={[1.9, 2.04, 0.03]} />
        <mesh position={[0, 1.15, 0.02]}><planeGeometry args={[1.9, 0.12]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} /></mesh>
      </group>
    ),
  },
  {
    kind: 'meia-parede-tijolo', name: 'Mureta de tijolinho', cat: 'estrutura', size: [2, 0.3], h: 1.3, place: 'chao',
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0.5, 0]} size={[2, 1, 0.3]} color="#ffffff" map={tiled(brickTexture(), 2, 1)} />
        <PBox p={p} pos={[0, 1.03, 0]} size={[2.06, 0.06, 0.36]} color={p.wood} />
        {[-0.6, 0, 0.6].map((x) => <PBox key={x} p={p} pos={[x, 1.16, 0]} size={[0.26, 0.2, 0.26]} color={x ? p.plant : p.plantDark} rot={[0, 0.4, 0]} />)}
      </group>
    ),
  },

  // ------------------------------------------------ parede
  { kind: 'janela', name: 'Janela', cat: 'parede', size: [1.6, 1.2], h: 1.2, place: 'parede', y: 1.72, render: (p) => <Window p={p} /> },
  { kind: 'quadro-arte', name: 'Quadro de arte', cat: 'parede', size: [0.8, 1], h: 1, place: 'parede', y: 1.7, colors: ['#ef476f', '#118ab2', '#06d6a0', '#9b5cff', '#f4a261'], render: (p, c = '#ef476f') => <Poster p={p} c={c} /> },
  {
    kind: 'relogio', name: 'Relógio de parede', cat: 'parede', size: [0.6, 0.6], h: 0.6, place: 'parede', y: 2.15,
    render: (p) => (
      <group>
        <PCyl p={p} pos={[0, 0, 0.03]} r={0.3} h={0.06} color={p.paper} sides={12} rot={[Math.PI / 2, 0, 0]} />
        <PBox p={p} pos={[0, 0.07, 0.07]} size={[0.03, 0.17, 0.02]} color="#1d1720" outline={false} />
        <PBox p={p} pos={[0.07, 0, 0.07]} size={[0.15, 0.03, 0.02]} color="#1d1720" outline={false} />
      </group>
    ),
  },
  { kind: 'neon-bora', name: 'Neon "BORA!"', cat: 'parede', size: [neonW('BORA!'), 0.62], h: 0.5, place: 'parede', y: 1.95, colors: NEONS, render: (p, c = NEONS[0]) => <Neon p={p} text="BORA!" c={c} /> },
  { kind: 'neon-cafe', name: 'Neon "CAFÉ"', cat: 'parede', size: [neonW('CAFÉ'), 0.62], h: 0.5, place: 'parede', y: 1.95, colors: NEONS, render: (p, c = NEONS[4]) => <Neon p={p} text="CAFÉ" c={c} /> },
  { kind: 'neon-crie', name: 'Neon "CRIE"', cat: 'parede', size: [neonW('CRIE'), 0.62], h: 0.5, place: 'parede', y: 1.95, colors: NEONS, render: (p, c = NEONS[2]) => <Neon p={p} text="CRIE" c={c} /> },
  {
    kind: 'prateleira', name: 'Prateleira de parede', cat: 'parede', size: [1.4, 0.7], h: 0.7, place: 'parede', y: 1.6, colors: WOODS,
    render: (p, c = WOODS[1]) => (
      <group>
        {[-0.3, 0.12].map((y) => <PBox key={y} p={p} pos={[0, y, 0.12]} size={[1.4, 0.05, 0.24]} color={c} />)}
        <PBox p={p} pos={[-0.35, -0.12, 0.1]} size={[0.5, 0.3, 0.14]} color="#ffffff" map={booksTexture()} outline={false} />
        <PCyl p={p} pos={[0.35, -0.2, 0.12]} r={0.07} h={0.16} color="#e76f51" sides={8} />
        <PBox p={p} pos={[0.35, -0.06, 0.12]} size={[0.18, 0.14, 0.18]} color={p.plant} />
        <PBox p={p} pos={[-0.2, 0.26, 0.12]} size={[0.14, 0.22, 0.06]} color="#ffd23f" />
        <PBox p={p} pos={[0.3, 0.24, 0.1]} size={[0.3, 0.2, 0.03]} color="#2a2230" />
        <PBox p={p} pos={[0.3, 0.24, 0.12]} size={[0.24, 0.14, 0.01]} color="#8ecae6" outline={false} />
      </group>
    ),
  },
  { kind: 'tv-parede', name: 'TV com painel', cat: 'parede', size: [1.8, 1], h: 1, place: 'parede', y: 1.55, render: (p) => <Panel p={p} map={dashTexture()} w={1.8} h={1} /> },
  { kind: 'cortica', name: 'Mural de cortiça', cat: 'parede', size: [1.6, 1], h: 1, place: 'parede', y: 1.55, render: (p) => <Panel p={p} map={corkTexture()} w={1.6} h={1} frame={p.woodDark} glow={false} /> },
  { kind: 'mapa', name: 'Mapa-múndi', cat: 'parede', size: [1.8, 1], h: 1, place: 'parede', y: 1.7, render: (p) => <Panel p={p} map={mapTexture()} w={1.8} h={1} frame={p.wood} glow={false} /> },
  {
    kind: 'jardim-vertical', name: 'Jardim vertical', cat: 'parede', size: [2, 1.8], h: 1.8, place: 'parede', y: 1.25,
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0, 0.03]} size={[2, 1.8, 0.06]} color={p.woodDark} />
        {Array.from({ length: 24 }).map((_, i) => {
          const x = -0.8 + (i % 6) * 0.32, y = -0.68 + Math.floor(i / 6) * 0.45;
          return <PBox key={i} p={p} pos={[x + ((i * 7) % 3) * 0.03, y, 0.12]} size={[0.34, 0.3, 0.14]} color={[p.plantDark, p.plant, shade(p.plant, 1.15), '#79c653'][(i * 5) % 4]} rot={[0, 0, (i % 3) * 0.3]} out={0.03} />;
        })}
      </group>
    ),
  },
  {
    kind: 'ar-condicionado', name: 'Ar-condicionado', cat: 'parede', size: [1, 0.32], h: 0.32, place: 'parede', y: 2.38,
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0, 0.12]} size={[1, 0.32, 0.24]} color="#f4f4f2" />
        <PBox p={p} pos={[0, -0.12, 0.245]} size={[0.86, 0.04, 0.01]} color="#c9ccd1" outline={false} />
        <PBox p={p} pos={[0.38, 0.06, 0.245]} size={[0.04, 0.03, 0.01]} color="#06d6a0" glow outline={false} />
      </group>
    ),
  },
  {
    kind: 'tijolinho', name: 'Revestimento de tijolinho', cat: 'parede', size: [2, 2.5], h: 2.5, place: 'parede', y: 1.25, cover: true,
    render: (p) => <PBox p={p} pos={[0, 0, 0.012]} size={[2, 2.5, 0.02]} color="#ffffff" map={tiled(brickTexture(), 2, 2.5)} outline={false} cast={false} />,
  },
  {
    kind: 'ripado', name: 'Painel ripado de madeira', cat: 'parede', size: [2, 2.5], h: 2.5, place: 'parede', y: 1.25, cover: true,
    render: (p) => <PBox p={p} pos={[0, 0, 0.012]} size={[2, 2.5, 0.02]} color="#ffffff" map={tiled(slatsTexture(), 2, 2.5)} outline={false} cast={false} />,
  },

  // ------------------------------------------------ luz
  {
    kind: 'luminaria', name: 'Luminária de piso', cat: 'luz', size: [0.5, 0.5], h: 2, place: 'chao',
    render: (p) => (
      <group>
        <PBox p={p} pos={[0, 0.03, 0]} size={[0.36, 0.06, 0.36]} color="#22252c" />
        <PCyl p={p} pos={[0, 0.9, 0]} r={0.03} h={1.7} color="#22252c" sides={6} />
        <PCyl p={p} pos={[0, 1.8, 0]} r={0.3} rTop={0.18} h={0.3} color="#ffe9a8" glow sides={8} />
      </group>
    ),
  },
  {
    kind: 'luminaria-arco', name: 'Luminária de arco', cat: 'luz', size: [1.4, 0.5], h: 2.1, place: 'chao',
    render: (p) => (
      <group>
        <PBox p={p} pos={[-0.55, 0.06, 0]} size={[0.36, 0.12, 0.36]} color="#e9e9ea" />
        {/* arco em quarto de elipse, da base até em cima da cúpula */}
        {Array.from({ length: 10 }).map((_, i) => {
          const pt = (k: number) => { const a = Math.PI - (k / 10) * (Math.PI / 2); return [0.5 + 1.05 * Math.cos(a), 0.12 + 2.0 * Math.sin(a)]; };
          const [x0, y0] = pt(i), [x1, y1] = pt(i + 1);
          return <PBox key={i} p={p} pos={[(x0 + x1) / 2, (y0 + y1) / 2, 0]} size={[Math.hypot(x1 - x0, y1 - y0) + 0.03, 0.05, 0.05]} rot={[0, 0, Math.atan2(y1 - y0, x1 - x0)]} color="#c9ccd1" out={0.02} />;
        })}
        <PCyl p={p} pos={[0.5, 1.95, 0]} r={0.28} rTop={0.08} h={0.24} color="#c9ccd1" sides={10} />
        <PCyl p={p} pos={[0.5, 1.82, 0]} r={0.24} h={0.02} color="#fff6d8" glow sides={10} outline={false} />
      </group>
    ),
  },
  {
    kind: 'pendente', name: 'Pendente industrial', cat: 'luz', size: [0.6, 0.6], h: 2.6, place: 'alto', colors: ['#2b2b30', '#e63946', '#f4f4f2', '#e9c46a'],
    render: (p, c = '#2b2b30') => (
      <group>
        <PBox p={p} pos={[0, 2.85, 0]} size={[0.015, 0.7, 0.015]} color="#1d1720" outline={false} cast={false} />
        <PCyl p={p} pos={[0, 2.42, 0]} r={0.3} rTop={0.06} h={0.22} color={c} sides={10} />
        <PCyl p={p} pos={[0, 2.3, 0]} r={0.1} h={0.06} color="#fff6d8" glow sides={8} outline={false} />
      </group>
    ),
  },

  // ------------------------------------------------ tapetes
  {
    kind: 'tapete', name: 'Tapete', cat: 'piso', size: [4, 3], h: 0.02, place: 'piso', colors: FABRICS,
    render: (p, c = p.fabric) => (
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4, 3]} />
        <meshLambertMaterial map={rugTexture(c, p.wood)} />
      </mesh>
    ),
  },
  {
    kind: 'tapete-grande', name: 'Tapete grande', cat: 'piso', size: [7, 4], h: 0.02, place: 'piso', colors: FABRICS,
    render: (p, c = p.fabric) => (
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[7, 4]} />
        <meshLambertMaterial map={rugTexture(c, p.wood)} />
      </mesh>
    ),
  },
  {
    kind: 'tapete-redondo', name: 'Tapete redondo', cat: 'piso', size: [2.4, 2.4], h: 0.02, place: 'piso', colors: FABRICS,
    render: (p, c = '#2a9d8f') => (
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[0, 0, 0.006]} receiveShadow><circleGeometry args={[1.2, 16]} /><meshLambertMaterial color={shade(c, 0.7)} /></mesh>
        <mesh position={[0, 0, 0.008]} receiveShadow><circleGeometry args={[1.05, 16]} /><meshLambertMaterial color={c} /></mesh>
        <mesh position={[0, 0, 0.01]} receiveShadow><ringGeometry args={[0.55, 0.65, 16]} /><meshLambertMaterial color="#f4efe4" /></mesh>
      </group>
    ),
  },
  {
    kind: 'tapete-listrado', name: 'Tapete listrado', cat: 'piso', size: [3, 2], h: 0.02, place: 'piso', colors: FABRICS,
    render: (p, c = '#3f7fd6') => (
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3, 2]} />
        <meshLambertMaterial map={stripesTexture(c)} />
      </mesh>
    ),
  },
  {
    kind: 'grama', name: 'Grama sintética', cat: 'piso', size: [3, 3], h: 0.04, place: 'piso',
    render: () => (
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3, 3]} />
        <meshLambertMaterial map={tiled(grassTexture(), 3, 3)} />
      </mesh>
    ),
  },
];

export const DEF: Record<string, DecorDef> = Object.fromEntries(CATALOG.map((d) => [d.kind, d]));

/** Pegada no chão já com o giro (quartos de volta). */
export const footprint = (d: DecorDef, rot: number): [number, number] => (rot % 2 ? [d.size[1], d.size[0]] : d.size);
