import { usePixel, type PixelPalette } from '../../lib/theme';
import { BOUNDS } from '../layout';
import { PBox, PCyl } from './kit';

type V3 = [number, number, number];
/** Face de dentro das paredes do fundo (onde os quadros e janelas encostam). */
const BACK_Z = BOUNDS.z0 + 0.1;
const LEFT_X = BOUNDS.x0 + 0.1;

/** Janela com moldura de madeira, vidro azul-céu, travessas e peitoril. `side` = parede do fundo ou da esquerda. */
function Window({ p, at, side }: { p: PixelPalette; at: number; side: 'fundo' | 'esquerda' }) {
  const pos: V3 = side === 'fundo' ? [at, 1.72, BACK_Z] : [LEFT_X, 1.72, at];
  return (
    <group position={pos} rotation={[0, side === 'fundo' ? 0 : Math.PI / 2, 0]}>
      <PBox p={p} pos={[0, 0, 0]} size={[1.6, 1.2, 0.06]} color={p.woodDark} />
      <PBox p={p} pos={[0, 0.12, 0.035]} size={[1.44, 0.86, 0.01]} color="#9fd8ff" glow outline={false} cast={false} />
      <PBox p={p} pos={[0, -0.3, 0.035]} size={[1.44, 0.18, 0.01]} color="#cfeeff" glow outline={false} cast={false} />
      <PBox p={p} pos={[0, 0, 0.05]} size={[0.06, 1.1, 0.03]} color={p.woodDark} outline={false} />
      <PBox p={p} pos={[0, 0.05, 0.05]} size={[1.5, 0.06, 0.03]} color={p.woodDark} outline={false} />
      <PBox p={p} pos={[0, -0.64, 0.08]} size={[1.76, 0.08, 0.18]} color={p.wood} />
      {/* nuvem no vidro */}
      <PBox p={p} pos={[-0.35, 0.3, 0.045]} size={[0.36, 0.1, 0.005]} color="#ffffff" glow outline={false} cast={false} />
    </group>
  );
}

/** Quadro decorativo (arte abstrata em blocos de cor). */
function Poster({ p, pos, rotY = 0, colors }: { p: PixelPalette; pos: V3; rotY?: number; colors: [string, string, string] }) {
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <PBox p={p} pos={[0, 0, 0]} size={[0.8, 1, 0.05]} color="#2a2230" />
      <PBox p={p} pos={[0, 0, 0.03]} size={[0.66, 0.86, 0.01]} color={colors[0]} outline={false} />
      <PBox p={p} pos={[-0.1, 0.12, 0.04]} size={[0.3, 0.3, 0.01]} color={colors[1]} outline={false} />
      <PBox p={p} pos={[0.12, -0.18, 0.04]} size={[0.26, 0.22, 0.01]} color={colors[2]} outline={false} />
    </group>
  );
}

/** Relógio de parede redondo. */
function Clock({ p, pos }: { p: PixelPalette; pos: V3 }) {
  return (
    <group position={pos} rotation={[Math.PI / 2, 0, 0]}>
      <PCyl p={p} pos={[0, 0, 0]} r={0.3} h={0.06} color={p.paper} sides={12} />
      <PBox p={p} pos={[0, -0.04, 0.08]} size={[0.03, 0.02, 0.17]} color="#1d1720" outline={false} />
      <PBox p={p} pos={[0.09, -0.04, 0]} size={[0.18, 0.02, 0.03]} color="#1d1720" outline={false} />
    </group>
  );
}

/** Bebedouro de galão. */
function WaterCooler({ p, pos }: { p: PixelPalette; pos: V3 }) {
  return (
    <group position={pos}>
      <PBox p={p} pos={[0, 0.5, 0]} size={[0.44, 1, 0.44]} color="#e9edf1" />
      <PBox p={p} pos={[0.1, 0.78, 0.23]} size={[0.06, 0.08, 0.02]} color="#3f7fd6" outline={false} />
      <PBox p={p} pos={[-0.1, 0.78, 0.23]} size={[0.06, 0.08, 0.02]} color="#d64545" outline={false} />
      <PCyl p={p} pos={[0, 1.24, 0]} r={0.19} h={0.48} color="#8fd0ff" sides={10} />
    </group>
  );
}

/** Geladeira e máquina de lanches da copa. */
function Fridge({ p, pos }: { p: PixelPalette; pos: V3 }) {
  return (
    <group position={pos}>
      <PBox p={p} pos={[0, 0.95, 0]} size={[0.9, 1.9, 0.7]} color="#dfe5ea" />
      <PBox p={p} pos={[0, 1.32, 0.36]} size={[0.86, 0.02, 0.02]} color="#9aa3ad" outline={false} />
      <PBox p={p} pos={[0.32, 1.6, 0.37]} size={[0.04, 0.3, 0.03]} color="#9aa3ad" outline={false} />
      <PBox p={p} pos={[0.32, 0.9, 0.37]} size={[0.04, 0.4, 0.03]} color="#9aa3ad" outline={false} />
      <PBox p={p} pos={[-0.2, 1.62, 0.37]} size={[0.14, 0.14, 0.01]} color="#ffd166" outline={false} />
      <PBox p={p} pos={[-0.05, 1.68, 0.37]} size={[0.12, 0.1, 0.01]} color="#ef476f" outline={false} />
    </group>
  );
}

function Vending({ p, pos }: { p: PixelPalette; pos: V3 }) {
  return (
    <group position={pos}>
      <PBox p={p} pos={[0, 1, 0]} size={[0.95, 2, 0.75]} color="#c0392b" />
      <PBox p={p} pos={[-0.12, 1.2, 0.38]} size={[0.6, 1.2, 0.02]} color="#1b2633" glow outline={false} cast={false} />
      {[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => (
        <PBox key={`${r}${c}`} p={p} pos={[-0.32 + c * 0.2, 1.65 - r * 0.28, 0.4]} size={[0.12, 0.16, 0.02]} color={['#ffd166', '#06d6a0', '#ef476f', '#7fd3ff'][(r + c) % 4]} glow outline={false} cast={false} />
      )))}
      <PBox p={p} pos={[0.33, 1.2, 0.39]} size={[0.16, 0.5, 0.02]} color="#9aa3ad" outline={false} />
      <PBox p={p} pos={[-0.12, 0.35, 0.39]} size={[0.6, 0.2, 0.02]} color="#1d1720" outline={false} />
    </group>
  );
}

/** Tripé com câmera e ring light (ilha de vídeo). */
function CameraRig({ p, pos }: { p: PixelPalette; pos: V3 }) {
  return (
    <group position={pos} rotation={[0, -0.7, 0]}>
      {[0, 2.1, 4.2].map((a) => <PBox key={a} p={p} pos={[Math.sin(a) * 0.2, 0.45, Math.cos(a) * 0.2]} size={[0.04, 0.95, 0.04]} rot={[Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35]} color="#22252c" />)}
      <PBox p={p} pos={[0, 1.02, 0]} size={[0.34, 0.24, 0.42]} color="#22252c" />
      <PCyl p={p} pos={[0, 1.02, 0.26]} r={0.09} h={0.14} color="#3a3f48" sides={8} />
      <PBox p={p} pos={[0.5, 1.4, 0]} size={[0.04, 1.5, 0.04]} color="#22252c" />
      <PCyl p={p} pos={[0.5, 2.1, 0]} r={0.28} h={0.05} color="#fff6d8" glow sides={14} />
    </group>
  );
}

/** Cavalete com tela pintada (estúdio de design). */
function Easel({ p, pos }: { p: PixelPalette; pos: V3 }) {
  return (
    <group position={pos} rotation={[0, 0.5, 0]}>
      <PBox p={p} pos={[-0.3, 0.8, 0]} size={[0.06, 1.6, 0.06]} color={p.wood} rot={[0.12, 0, 0.12]} />
      <PBox p={p} pos={[0.3, 0.8, 0]} size={[0.06, 1.6, 0.06]} color={p.wood} rot={[0.12, 0, -0.12]} />
      <PBox p={p} pos={[0, 0.8, -0.3]} size={[0.06, 1.6, 0.06]} color={p.wood} rot={[-0.3, 0, 0]} />
      <PBox p={p} pos={[0, 1.15, 0.06]} size={[0.9, 0.7, 0.04]} color="#fbfbf8" />
      <PBox p={p} pos={[-0.15, 1.2, 0.085]} size={[0.32, 0.3, 0.01]} color="#ef476f" outline={false} />
      <PBox p={p} pos={[0.18, 1.05, 0.085]} size={[0.3, 0.22, 0.01]} color="#118ab2" outline={false} />
      <PBox p={p} pos={[0.05, 1.32, 0.085]} size={[0.18, 0.12, 0.01]} color="#ffd166" outline={false} />
      <PBox p={p} pos={[0, 0.78, 0.08]} size={[0.8, 0.04, 0.12]} color={p.wood} />
    </group>
  );
}

/** Cabideiro (recepção). */
function CoatRack({ p, pos }: { p: PixelPalette; pos: V3 }) {
  return (
    <group position={pos}>
      <PCyl p={p} pos={[0, 0.03, 0]} r={0.22} h={0.06} color={p.woodDark} sides={8} />
      <PCyl p={p} pos={[0, 0.9, 0]} r={0.035} h={1.7} color={p.woodDark} sides={6} />
      <PBox p={p} pos={[0.12, 1.5, 0]} size={[0.24, 0.5, 0.2]} color={p.fabricAlt} />
      <PBox p={p} pos={[-0.1, 1.62, 0.05]} size={[0.2, 0.12, 0.2]} color={p.fabric} />
    </group>
  );
}

/**
 * Decoração do tema Pixel (não ocupa lugar no chão onde se anda): janelas e quadros nas paredes do fundo,
 * relógio, bebedouro, geladeira e máquina de lanches na copa, tripé com ring light na ilha de vídeo,
 * cavalete no design e cabideiro na entrada.
 */
export function PixelDecor() {
  const p = usePixel();
  return (
    <group>
      {[-15, -9, 9, 15].map((x) => <Window key={`wf${x}`} p={p} at={x} side="fundo" />)}
      {[-10.5, -3.5, 0.5, 9.5].map((z) => <Window key={`we${z}`} p={p} at={z} side="esquerda" />)}
      <Clock p={p} pos={[-12, 2.15, BACK_Z]} />
      <Poster p={p} pos={[4.9, 1.75, BACK_Z]} colors={['#f4efe4', '#ef476f', '#118ab2']} />
      <Poster p={p} pos={[LEFT_X, 1.75, -7]} rotY={Math.PI / 2} colors={['#ffd166', '#06d6a0', '#2a2230']} />
      <WaterCooler p={p} pos={[-5.4, 0, 0.6]} />
      <Fridge p={p} pos={[17.2, 0, -11.3]} />
      <Vending p={p} pos={[7, 0, -11.3]} />
      <CameraRig p={p} pos={[7.4, 0, -0.9]} />
      <Easel p={p} pos={[8.3, 0, 6.4]} />
      <CoatRack p={p} pos={[3.2, 0, 11.3]} />
    </group>
  );
}
