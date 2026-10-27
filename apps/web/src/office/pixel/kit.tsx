import { createContext, useContext, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { PixelPalette } from '../../lib/theme';

/**
 * Kit da pixel art: sombreamento chapado em 3 tons (topo claro, lados médio e escuro), contorno escuro
 * por casca invertida e texturas geradas em canvas com filtro "nearest". A cena é renderizada em
 * baixa resolução e ampliada sem suavizar (ver World), o que dá o pixel nítido.
 */

/** Gradiente de 3 degraus do MeshToonMaterial: sombra, meio-tom e luz. */
let gradient: THREE.DataTexture | null = null;
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
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
const OUT = 0.045;

export function Toon({ color, map, emissive }: { color: string; map?: THREE.Texture | null; emissive?: string }) {
  return <meshToonMaterial color={color} map={map ?? null} gradientMap={toonGradient()} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 0.9 : 0} />;
}

/** Caixa com sombreamento chapado e contorno. `glow` = cor que brilha (tela, lâmpada). */
export function PBox({ p, pos, size, color, rot, map, glow, outline = true, cast = true, out = OUT }: {
  p: PixelPalette; pos: [number, number, number]; size: [number, number, number]; color: string;
  rot?: [number, number, number]; map?: THREE.Texture | null; glow?: boolean; outline?: boolean; cast?: boolean;
  /** Espessura do contorno (peças pequenas, como as do avatar, usam um contorno mais fino). */
  out?: number;
}) {
  const hover = useContext(OutlineCtx);
  return (
    <group position={pos} rotation={rot}>
      <mesh castShadow={cast} receiveShadow>
        <boxGeometry args={size} />
        {glow ? <meshBasicMaterial color={color} map={map ?? null} toneMapped={false} /> : <Toon color={color} map={map} />}
      </mesh>
      {outline && (
        <mesh raycast={() => null}>
          <boxGeometry args={[size[0] + out * 2, size[1] + out * 2, size[2] + out * 2]} />
          <meshBasicMaterial color={hover ?? p.outline} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
  );
}

/** Cilindro (vasos, mesas redondas, postes) com o mesmo contorno. */
export function PCyl({ p, pos, r, h, color, rTop, sides = 10, glow }: {
  p: PixelPalette; pos: [number, number, number]; r: number; h: number; color: string; rTop?: number; sides?: number; glow?: boolean;
}) {
  const hover = useContext(OutlineCtx);
  return (
    <group position={pos}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[rTop ?? r, r, h, sides]} />
        {glow ? <meshBasicMaterial color={color} toneMapped={false} /> : <Toon color={color} />}
      </mesh>
      <mesh raycast={() => null}>
        <cylinderGeometry args={[(rTop ?? r) + OUT, r + OUT, h + OUT * 2, sides]} />
        <meshBasicMaterial color={hover ?? p.outline} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- texturas

const textures = new Map<string, THREE.CanvasTexture>();

/** Textura pequena desenhada à mão em canvas (cache por chave), com pixel duro e repetição. */
function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
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

const shade = (hex: string, k: number) => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
};

/** Piso de cada sala, 16 px por metro: tacos, carpete, ladrilho, xadrez. */
export function floorTexture(room: string, [a, b]: [string, string]) {
  return canvasTexture(`floor:${room}:${a}`, 16, 16, (g) => {
    const px = (x: number, y: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
    g.fillStyle = a;
    g.fillRect(0, 0, 16, 16);
    if (room === 'recepcao') {
      // tacos de madeira em fiadas desencontradas
      for (let row = 0; row < 4; row++) {
        g.fillStyle = row % 2 ? b : a;
        g.fillRect(0, row * 4, 16, 4);
        g.fillStyle = shade(a, 0.78);
        g.fillRect(0, row * 4 + 3, 16, 1);
        const off = row % 2 ? 4 : 12;
        g.fillRect(off, row * 4, 1, 3);
        px((off + 6) % 16, row * 4 + 1, shade(b, 0.9));
      }
    } else if (room === 'copa' || room === 'design') {
      // xadrez de ladrilho
      g.fillStyle = b;
      g.fillRect(0, 0, 8, 8);
      g.fillRect(8, 8, 8, 8);
      g.fillStyle = shade(b, 0.85);
      g.fillRect(0, 7, 16, 1);
      g.fillRect(7, 0, 1, 16);
      g.fillRect(0, 15, 16, 1);
      g.fillRect(15, 0, 1, 16);
    } else if (room === 'video' || room === 'copy') {
      // ladrilho grande com rejunte
      g.fillStyle = shade(a, 0.8);
      g.fillRect(0, 15, 16, 1);
      g.fillRect(15, 0, 1, 16);
      px(3, 4, b); px(10, 9, b); px(6, 12, b);
    } else {
      // carpete: ruído fino com pontinhos
      for (let i = 0; i < 26; i++) px((i * 7) % 16, (i * 11 + (i >> 2)) % 16, i % 3 ? b : shade(a, 1.12));
    }
  });
}

/** Papel de parede listrado com faixa (lambri) embaixo, repetindo a cada metro. */
export function wallpaperTexture(p: PixelPalette) {
  return canvasTexture(`wall:${p.wall}`, 16, 32, (g) => {
    g.fillStyle = p.wall;
    g.fillRect(0, 0, 16, 32);
    g.fillStyle = p.wallStripe;
    for (let x = 0; x < 16; x += 4) g.fillRect(x, 0, 2, 22);
    g.fillStyle = shade(p.wall, 0.82);
    g.fillRect(0, 22, 16, 10);
    g.fillStyle = shade(p.wall, 0.7);
    g.fillRect(0, 22, 16, 1);
    for (let x = 0; x < 16; x += 8) g.fillRect(x, 23, 1, 9);
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
    t.repeat.set(r.x1 - r.x0, r.z1 - r.z0);
    t.needsUpdate = true;
    return [r.id, t];
  })), [p, rooms]);
