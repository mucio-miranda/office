import { createContext, useContext, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { PixelPalette } from '../../lib/theme';

/**
 * Kit da pixel art: sombreamento chapado em 3 tons (topo claro, lados médio e escuro), contorno escuro
 * por casca invertida e texturas geradas em canvas com filtro "nearest". A cena é renderizada em
 * baixa resolução e ampliada sem suavizar (ver World), o que dá o pixel nítido.
 */

/** Gradiente de 4 degraus do MeshToonMaterial: sombra, meio-tom, tom e luz. */
let gradient: THREE.DataTexture | null = null;
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([96, 96, 96, 255, 150, 150, 150, 255, 208, 208, 208, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

/** Cor do contorno de um grupo (o hover troca a cor do contorno, como no Habbo). */
const OutlineCtx = createContext<string | null>(null);
export function OutlineColor({ color, children }: { color: string | null; children: ReactNode }) {
  return <OutlineCtx.Provider value={color}>{children}</OutlineCtx.Provider>;
}

/** Espessura do contorno: cerca de 1 pixel da arte no zoom padrão. */
const OUT = 0.03;

/** Contorno: um tom bem escuro da própria cor, puxado para o contorno da paleta (as peças não ficam com borda preta). */
export function edgeOf(color: string, p: PixelPalette) {
  const c = new THREE.Color(color).multiplyScalar(0.38);
  return `#${c.lerp(new THREE.Color(p.outline), 0.4).getHexString()}`;
}

export function Toon({ color, map, emissive }: { color: string; map?: THREE.Texture | null; emissive?: string }) {
  return <meshToonMaterial color={color} map={map ?? null} gradientMap={toonGradient()} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 0.9 : 0} />;
}

/** Caixa com sombreamento chapado e contorno. `glow` = cor que brilha (tela, lâmpada). */
export function PBox({ p, pos, size, color, rot, map, glow, outline = true, cast = true, out = OUT, edge }: {
  p: PixelPalette; pos: [number, number, number]; size: [number, number, number]; color: string;
  rot?: [number, number, number]; map?: THREE.Texture | null; glow?: boolean; outline?: boolean; cast?: boolean;
  /** Espessura do contorno (peças pequenas, como as do avatar, usam um contorno mais fino). */
  out?: number;
  /** Cor do contorno (padrão: tom escuro da própria cor). */
  edge?: string;
}) {
  const hover = useContext(OutlineCtx);
  const line = hover ?? edge ?? (map || glow ? p.outline : edgeOf(color, p));
  return (
    <group position={pos} rotation={rot}>
      <mesh castShadow={cast} receiveShadow>
        <boxGeometry args={size} />
        {glow ? <meshBasicMaterial color={color} map={map ?? null} toneMapped={false} /> : <Toon color={color} map={map} />}
      </mesh>
      {outline && (
        <mesh raycast={() => null}>
          <boxGeometry args={[size[0] + out * 2, size[1] + out * 2, size[2] + out * 2]} />
          <meshBasicMaterial color={line} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
  );
}

/** Cilindro (vasos, mesas redondas, postes) com o mesmo contorno. */
export function PCyl({ p, pos, r, h, color, rTop, sides = 10, glow, rot, outline = true }: {
  p: PixelPalette; pos: [number, number, number]; r: number; h: number; color: string; rTop?: number; sides?: number; glow?: boolean;
  rot?: [number, number, number]; outline?: boolean;
}) {
  const hover = useContext(OutlineCtx);
  return (
    <group position={pos} rotation={rot}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[rTop ?? r, r, h, sides]} />
        {glow ? <meshBasicMaterial color={color} toneMapped={false} /> : <Toon color={color} />}
      </mesh>
      {outline && (
        <mesh raycast={() => null}>
          <cylinderGeometry args={[(rTop ?? r) + OUT, r + OUT, h + OUT * 2, sides]} />
          <meshBasicMaterial color={hover ?? (glow ? p.outline : edgeOf(color, p))} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
  );
}

/** Volume arredondado (moitas, copas de árvore): icosaedro achatado na medida `size`, com contorno. */
export function PBlob({ p, pos, size, color, map, rot, edge }: {
  p: PixelPalette; pos: [number, number, number]; size: [number, number, number]; color: string;
  map?: THREE.Texture | null; rot?: [number, number, number]; edge?: string;
}) {
  const hover = useContext(OutlineCtx);
  const k = 1 + (OUT * 2) / Math.min(...size);
  return (
    <group position={pos} rotation={rot} scale={[size[0] / 2, size[1] / 2, size[2] / 2]}>
      <mesh castShadow receiveShadow>
        <icosahedronGeometry args={[1, 1]} />
        <Toon color={color} map={map} />
      </mesh>
      <mesh raycast={() => null} scale={k}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color={hover ?? edge ?? p.outline} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- texturas

const textures = new Map<string, THREE.CanvasTexture>();

/** Textura pequena desenhada à mão em canvas (cache por chave), com pixel duro e repetição. */
export function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  let t = textures.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    draw(g);
    t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, t);
  }
  return t;
}

export const shade = (hex: string, k: number) => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
};

/** Cópia de uma textura com outra repetição (cache por chave e repetição). */
export function tiled(base: THREE.CanvasTexture, rx: number, ry: number) {
  const key = `${base.uuid}@${rx}x${ry}`;
  let t = textures.get(key);
  if (!t) {
    t = base.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    textures.set(key, t);
  }
  return t;
}

/** Vidro: caixa translúcida sem contorno (divisórias, cabines, aquário). */
export function Glass({ pos, size, tint = '#bfe6ff', opacity = 0.32, rot }: {
  pos: [number, number, number]; size: [number, number, number]; tint?: string; opacity?: number; rot?: [number, number, number];
}) {
  return (
    <mesh position={pos} rotation={rot}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={tint} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** Sorteio repetível (as texturas saem iguais em toda máquina). */
export const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** Assoalho de tábuas largas (madeira clara de escritório escandinavo), 32 px por metro, 2 m por repetição. */
function planksTexture(key: string, [a, b]: [string, string]) {
  return canvasTexture(`planks:${key}:${a}`, 64, 64, (g) => {
    const r = rand(7);
    const tones = [a, b, shade(a, 1.06), shade(b, 0.95), shade(a, 0.97)];
    for (let row = 0; row < 8; row++) {
      const y = row * 8;
      let x = -Math.floor(r() * 40);
      while (x < 64) {
        const len = 22 + Math.floor(r() * 26);
        const tone = tones[Math.floor(r() * tones.length)];
        const draw = (ox: number) => {
          g.fillStyle = tone;
          g.fillRect(x + ox, y, len, 8);
          // veio: riscos finos um pouco mais escuros, e um nó de vez em quando
          g.fillStyle = shade(tone, 0.9);
          for (let k = 0; k < 3; k++) g.fillRect(x + ox + 2 + Math.floor(r() * (len - 8)), y + 1 + Math.floor(r() * 6), 4 + Math.floor(r() * 8), 1);
          if (r() < 0.25) { g.fillStyle = shade(tone, 0.75); g.fillRect(x + ox + 4 + Math.floor(r() * (len - 10)), y + 3, 2, 2); }
          // brilho na borda de cima, fresta embaixo e na emenda
          g.fillStyle = shade(tone, 1.08);
          g.fillRect(x + ox, y, len, 1);
          g.fillStyle = shade(a, 0.72);
          g.fillRect(x + ox, y + 7, len, 1);
          g.fillRect(x + ox + len - 1, y, 1, 8);
        };
        draw(0);
        if (x + len > 64) draw(-64);
        if (x < 0) draw(64);
        x += len;
      }
    }
  });
}

/** Metros cobertos por uma repetição da textura de piso de qualquer sala. */
export const FLOOR_TILE_M = 2;

/**
 * Piso padrão de cada sala, 32 px por metro e 2 m por repetição (a mesma densidade dos pisos do modo Decorar):
 * tábuas na recepção, carpete em placas na gerência, carpete felpudo na reunião, porcelanato na redação,
 * placas de borracha na ilha de vídeo e ladrilho xadrez na copa e no design.
 */
export function floorTexture(room: string, [a, b]: [string, string]) {
  if (room === 'recepcao') return planksTexture(room, [a, b]);
  return canvasTexture(`floor32:${room}:${a}`, 64, 64, (g) => {
    const px = (x: number, y: number, c: string, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    const r = rand(room.length * 31 + 5);
    px(0, 0, a, 64, 64);
    if (room === 'copa' || room === 'design') {
      // ladrilho xadrez de 50 cm com chanfro claro em cima e sombra embaixo
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        const c = (tx + ty) % 2 ? b : a, x = tx * 16, y = ty * 16;
        px(x, y, c, 16, 16);
        for (let k = 0; k < 5; k++) px(x + 2 + Math.floor(r() * 12), y + 2 + Math.floor(r() * 12), shade(c, 0.96));
        px(x, y, shade(c, 1.06), 16, 1);
        px(x, y, shade(c, 1.03), 1, 16);
        px(x, y + 15, shade(a, 0.8), 16, 1);
        px(x + 15, y, shade(a, 0.84), 1, 16);
      }
    } else if (room === 'copy') {
      // porcelanato de 1 m com manchas suaves e rejunte fino
      for (let i = 0; i < 40; i++) px(Math.floor(r() * 64), Math.floor(r() * 64), r() < 0.5 ? b : shade(a, 1.04), 3 + Math.floor(r() * 6), 2 + Math.floor(r() * 3));
      for (let i = 0; i < 120; i++) px(Math.floor(r() * 64), Math.floor(r() * 64), shade(a, r() < 0.5 ? 0.95 : 1.05));
      for (const o of [0, 32]) {
        px(0, o + 31, shade(a, 0.78), 64, 1); px(o + 31, 0, shade(a, 0.78), 1, 64);
        px(0, o, shade(a, 1.08), 64, 1); px(o, 0, shade(a, 1.05), 1, 64);
      }
    } else if (room === 'video') {
      // placas de borracha de 50 cm com pastilhas em relevo (piso de estúdio)
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        const x = tx * 16, y = ty * 16;
        px(x, y, (tx + ty) % 2 ? a : b, 16, 16);
        for (let dy = 3; dy < 16; dy += 5) for (let dx = 3; dx < 16; dx += 5) { px(x + dx, y + dy, shade(a, 1.25), 2, 1); px(x + dx, y + dy + 1, shade(a, 0.75), 2, 1); }
        px(x, y + 15, shade(a, 0.7), 16, 1); px(x + 15, y, shade(a, 0.7), 1, 16);
      }
    } else if (room === 'gerencia') {
      // carpete em placas de 50 cm, o fio em direções alternadas
      for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
        const x = tx * 16, y = ty * 16, flat = (tx + ty) % 2 === 0, c = flat ? a : b;
        px(x, y, c, 16, 16);
        for (let k = 0; k < 16; k += 2) px(flat ? x : x + k, flat ? y + k : y, shade(c, 1.07), flat ? 16 : 1, flat ? 1 : 16);
        px(x, y + 15, shade(a, 0.85), 16, 1); px(x + 15, y, shade(a, 0.85), 1, 16);
      }
      for (let i = 0; i < 90; i++) px(Math.floor(r() * 64), Math.floor(r() * 64), shade(a, r() < 0.5 ? 0.88 : 1.14));
    } else {
      // carpete felpudo: trama fina em diagonal e fios soltos
      for (let y = 0; y < 64; y++) for (let x = (y % 4); x < 64; x += 4) px(x, y, b);
      for (let i = 0; i < 260; i++) px(Math.floor(r() * 64), Math.floor(r() * 64), shade(a, r() < 0.5 ? 0.86 : 1.12));
    }
  });
}

/**
 * Parede de reboco claro com textura fina e lambri ripado de madeira embaixo (o "quente" dos escritórios
 * biofílicos), 32 px por metro, repetindo a cada metro de largura e 2 m de altura.
 */
export function wallpaperTexture(p: PixelPalette) {
  return canvasTexture(`wall:${p.wall}`, 32, 64, (g) => {
    const r = rand(3);
    g.fillStyle = p.wall;
    g.fillRect(0, 0, 32, 64);
    // reboco: pontinhos claros e escuros espalhados
    for (let i = 0; i < 90; i++) {
      g.fillStyle = r() < 0.5 ? shade(p.wall, 1.04) : p.wallStripe;
      g.fillRect(Math.floor(r() * 32), Math.floor(r() * 40), 1, 1);
    }
    // lambri ripado (de 0,8 m para baixo): ripas de 4 px com luz à esquerda e sombra à direita
    const wood = shade(p.wood, 1.18);
    g.fillStyle = shade(wood, 0.55);
    g.fillRect(0, 38, 32, 26);
    for (let x = 0; x < 32; x += 4) {
      g.fillStyle = x % 8 ? wood : shade(wood, 0.94);
      g.fillRect(x, 40, 3, 24);
      g.fillStyle = shade(wood, 1.12);
      g.fillRect(x, 40, 1, 24);
    }
    // arremate do lambri
    g.fillStyle = shade(p.wood, 0.85);
    g.fillRect(0, 38, 32, 2);
    g.fillStyle = shade(p.wood, 1.25);
    g.fillRect(0, 38, 32, 1);
  });
}

/** Folhagem: folhas miúdas em 3 tons com brilho, como as moitas dos quartos do Habbo (32 px). */
export function leafTexture(light: string, dark: string, flowers?: string) {
  return canvasTexture(`leaf:${light}:${dark}:${flowers ?? ''}`, 32, 32, (g) => {
    const r = rand(11);
    g.fillStyle = shade(dark, 0.8);
    g.fillRect(0, 0, 32, 32);
    const leaf = (x: number, y: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, 3, 2);
      g.fillRect(x + 1, y - 1, 1, 1);
      g.fillStyle = shade(c, 0.8);
      g.fillRect(x, y + 1, 1, 1);
    };
    for (let i = 0; i < 120; i++) leaf(Math.floor(r() * 32), Math.floor(r() * 32), i % 3 ? dark : shade(dark, 1.15));
    for (let i = 0; i < 90; i++) leaf(Math.floor(r() * 32), Math.floor(r() * 32), i % 4 ? light : shade(light, 1.2));
    g.fillStyle = shade(light, 1.45);
    for (let i = 0; i < 14; i++) g.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 1, 1);
    if (flowers) for (let i = 0; i < 6; i++) {
      const x = Math.floor(r() * 30), y = Math.floor(r() * 30);
      g.fillStyle = flowers; g.fillRect(x, y, 2, 2);
      g.fillStyle = '#fff6d8'; g.fillRect(x, y, 1, 1);
    }
  });
}

/** Musgo preservado: tufos arredondados em verdes e um pouco de líquen amarelado. */
export function mossTexture() {
  return canvasTexture('moss', 48, 32, (g) => {
    const r = rand(5);
    g.fillStyle = '#2f5d2a';
    g.fillRect(0, 0, 48, 32);
    const tones = ['#3f7a34', '#4f8f3c', '#6aa84a', '#87bf5c', '#2b5225', '#b5b85a'];
    for (let i = 0; i < 160; i++) {
      const x = Math.floor(r() * 48), y = Math.floor(r() * 32), s = 1 + Math.floor(r() * 3);
      g.fillStyle = tones[Math.floor(r() * (i % 9 ? 5 : 6))];
      g.fillRect(x, y, s, s);
      g.fillStyle = shade(g.fillStyle as string, 1.25);
      g.fillRect(x, y, 1, 1);
    }
  });
}

/** Madeira clara com veio (tampos, bancos, ripas), 32 px. */
export function woodTexture(base: string) {
  return canvasTexture(`wood:${base}`, 32, 32, (g) => {
    const r = rand(9);
    g.fillStyle = base;
    g.fillRect(0, 0, 32, 32);
    for (let y = 0; y < 32; y++) {
      if (r() < 0.45) { g.fillStyle = shade(base, 0.9 + r() * 0.05); g.fillRect(Math.floor(r() * 16), y, 8 + Math.floor(r() * 20), 1); }
    }
    g.fillStyle = shade(base, 1.08);
    for (let i = 0; i < 10; i++) g.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 3, 1);
  });
}

/** Tapete com borda e losango no meio. */
export function rugTexture(main: string, border: string) {
  return canvasTexture(`rug:${main}:${border}`, 32, 24, (g) => {
    g.fillStyle = border;
    g.fillRect(0, 0, 32, 24);
    g.fillStyle = main;
    g.fillRect(2, 2, 28, 20);
    g.fillStyle = border;
    g.fillRect(4, 4, 24, 1);
    g.fillRect(4, 19, 24, 1);
    g.fillRect(4, 4, 1, 16);
    g.fillRect(27, 4, 1, 16);
    for (let i = 0; i < 6; i++) {
      g.fillRect(16 - i, 7 + i, i * 2 + 1, 1);
      g.fillRect(16 - i, 16 - i, i * 2 + 1, 1);
    }
  });
}

/** Lombadas de livros coloridos para as estantes. */
export function booksTexture() {
  return canvasTexture('books', 32, 8, (g) => {
    const cols = ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22', '#ecf0f1', '#16a085'];
    let x = 0;
    let i = 0;
    while (x < 32) {
      const w = 2 + ((i * 5) % 3);
      const h = 5 + ((i * 3) % 3);
      g.fillStyle = cols[i % cols.length];
      g.fillRect(x, 8 - h, w, h);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + w - 1, 8 - h, 1, h);
      x += w;
      i++;
    }
  });
}

/** Tela de computador com janelas e linhas de código. */
export function screenTexture(glow: string) {
  return canvasTexture(`screen:${glow}`, 16, 10, (g) => {
    g.fillStyle = '#1b2633';
    g.fillRect(0, 0, 16, 10);
    g.fillStyle = glow;
    g.fillRect(1, 1, 14, 1);
    const lines = [[2, 3, 7], [2, 5, 10], [4, 6, 6], [2, 8, 9]];
    for (const [x, y, w] of lines) g.fillRect(x, y, w, 1);
    g.fillStyle = '#ffd166';
    g.fillRect(11, 3, 3, 2);
  });
}

export const useFloorTextures = (p: PixelPalette, rooms: { id: string; x0: number; x1: number; z0: number; z1: number }[]) =>
  useMemo(() => Object.fromEntries(rooms.map((r) => {
    const t = floorTexture(r.id, p.floors[r.id] ?? ['#bbbbbb', '#aaaaaa']).clone();
    t.repeat.set((r.x1 - r.x0) / FLOOR_TILE_M, (r.z1 - r.z0) / FLOOR_TILE_M);
    t.needsUpdate = true;
    return [r.id, t];
  })), [p, rooms]);
