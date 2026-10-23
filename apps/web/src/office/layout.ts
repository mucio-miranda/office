import type { RoomId, Vec2 } from '@office/shared';
import type { PanelId } from '../lib/store';

/**
 * Planta do escritório (unidades do mundo ≈ metros). x cresce para a direita, z para "baixo" (frente).
 *
 *   z=-12 ┌──────────┬──────────┬──────────┐
 *         │   COPY   │ GERÊNCIA │   COPA   │
 *   z=-2  ├──────────┼──────────┼──────────┤
 *         │          │          │  VÍDEO   │
 *         │ REUNIÃO  │ RECEPÇÃO ├──────────┤ z=5
 *         │          │          │  DESIGN  │
 *   z=12  └──────────┴────▼─────┴──────────┘
 *       x=-18      x=-6       x=6        x=18
 */

export interface Room {
  id: RoomId;
  label: string;
  emoji: string;
  x0: number; z0: number; x1: number; z1: number;
  floor: string;
  /** Tecla de atalho para teletransporte. */
  key: string;
}

export const ROOMS: Room[] = [
  { id: 'recepcao', label: 'Recepção', emoji: '🛋️', x0: -6, z0: -2, x1: 6, z1: 12, floor: '#efe8dd', key: '1' },
  { id: 'gerencia', label: 'Gerência', emoji: '📊', x0: -6, z0: -12, x1: 6, z1: -2, floor: '#e3e9f2', key: '2' },
  { id: 'video', label: 'Ilha de vídeo', emoji: '🎬', x0: 6, z0: -2, x1: 18, z1: 5, floor: '#2a2633', key: '3' },
  { id: 'design', label: 'Estúdio de design', emoji: '🎨', x0: 6, z0: 5, x1: 18, z1: 12, floor: '#efe6f6', key: '4' },
  { id: 'copy', label: 'Redação', emoji: '✍️', x0: -18, z0: -12, x1: -6, z1: -2, floor: '#e4f3ee', key: '5' },
  { id: 'reuniao', label: 'Sala de reunião', emoji: '🤝', x0: -18, z0: -2, x1: -6, z1: 12, floor: '#f3ece4', key: '6' },
  { id: 'copa', label: 'Copa', emoji: '☕', x0: 6, z0: -12, x1: 18, z1: -2, floor: '#f6efe0', key: '7' },
];

export const BOUNDS = { x0: -18, z0: -12, x1: 18, z1: 12 };
export const DOOR = 2.6;
export const WALL_T = 0.14;
export const WALL_H = 0.6;

/** Paredes como segmentos (x1,z1)-(x2,z2) com portas (centro no eixo da parede). */
interface WallDef { a: Vec2; b: Vec2; doors: number[] }
const WALL_DEFS: WallDef[] = [
  // contorno (porta de entrada na frente da recepção)
  { a: { x: -18, z: -12 }, b: { x: 18, z: -12 }, doors: [] },
  { a: { x: -18, z: 12 }, b: { x: 18, z: 12 }, doors: [0] },
  { a: { x: -18, z: -12 }, b: { x: -18, z: 12 }, doors: [] },
  { a: { x: 18, z: -12 }, b: { x: 18, z: 12 }, doors: [] },
  // internas
  { a: { x: -18, z: -2 }, b: { x: 18, z: -2 }, doors: [-12, 0, 12] },
  { a: { x: -6, z: -12 }, b: { x: -6, z: 12 }, doors: [-7, 5] },
  { a: { x: 6, z: -12 }, b: { x: 6, z: 12 }, doors: [-7, 1.5, 8.5] },
  { a: { x: 6, z: 5 }, b: { x: 18, z: 5 }, doors: [12] },
];

export interface WallSeg { x: number; z: number; w: number; d: number }

/** Quebra cada parede em blocos retangulares, deixando os vãos das portas. */
export const WALLS: WallSeg[] = WALL_DEFS.flatMap(({ a, b, doors }) => {
  const horizontal = a.z === b.z;
  const from = horizontal ? a.x : a.z;
  const to = horizontal ? b.x : b.z;
  const cuts = [...doors].sort((p, q) => p - q).flatMap((c) => [c - DOOR / 2, c + DOOR / 2]);
  const points = [from, ...cuts, to];
  const segs: WallSeg[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const s = points[i], e = points[i + 1];
    if (e - s < 0.05) continue;
    const mid = (s + e) / 2;
    segs.push(horizontal ? { x: mid, z: a.z, w: e - s, d: WALL_T } : { x: a.x, z: mid, w: WALL_T, d: e - s });
  }
  return segs;
});

export type FurnitureKind =
  | 'mesa' | 'cadeira' | 'sofa' | 'planta' | 'quadro' | 'calendario' | 'tv' | 'mesa-reuniao'
  | 'cafeteira' | 'balcao' | 'cofre' | 'estante' | 'tapete' | 'luminaria';

export interface Furniture {
  kind: FurnitureKind;
  x: number; z: number;
  rot?: number;
  w?: number; d?: number;
  color?: string;
  /** Se definido, apertar E perto (ou clicar) abre este painel. */
  panel?: PanelId;
  label?: string;
  solid?: boolean;
}

/**
 * Mesas das pessoas: ao lado dos funcionários de IA de cada área e duas na recepção.
 * `x,z` é o centro da mesa; a cadeira fica em `z + 1.1`, de frente para o monitor (como as dos funcionários).
 */
export interface HumanDesk { id: string; room: RoomId; x: number; z: number }
export const HUMAN_DESKS: HumanDesk[] = [
  { id: 'redacao-1', room: 'copy', x: -15.2, z: -6.5 },
  { id: 'redacao-2', room: 'copy', x: -8.8, z: -6.5 },
  { id: 'gerencia-1', room: 'gerencia', x: -1.6, z: -6.5 },
  { id: 'video-1', room: 'video', x: 10, z: 2.4 },
  { id: 'design-1', room: 'design', x: 10.6, z: 8.5 },
  { id: 'recepcao-1', room: 'recepcao', x: -3.6, z: 4.2 },
  { id: 'recepcao-2', room: 'recepcao', x: 3.6, z: 4.2 },
];
export const deskSeat = (d: HumanDesk): Vec2 => ({ x: d.x, z: d.z + 1.1 });

export const FURNITURE: Furniture[] = [
  ...HUMAN_DESKS.map((d): Furniture => ({ kind: 'mesa', x: d.x, z: d.z, solid: true })),
  // recepção
  { kind: 'tapete', x: 0, z: 5, w: 7, d: 4 },
  { kind: 'sofa', x: -3.5, z: 9.6, rot: 0, solid: true },
  { kind: 'sofa', x: 3.5, z: 9.6, rot: 0, solid: true },
  { kind: 'balcao', x: 0, z: 1.2, w: 5, d: 1.1, solid: true, panel: 'equipe', label: 'Equipe e convites' },
  { kind: 'planta', x: -5.2, z: 11.2, solid: true },
  { kind: 'planta', x: 5.2, z: 11.2, solid: true },
  { kind: 'quadro', x: -5.85, z: 2.4, rot: Math.PI / 2, panel: 'atividade', label: 'Mural de atividade' },
  // gerência
  { kind: 'quadro', x: 0, z: -11.85, w: 6, panel: 'demandas', label: 'Quadro de demandas' },
  { kind: 'calendario', x: -4.2, z: -11.85, panel: 'calendario', label: 'Calendário' },
  { kind: 'cofre', x: 4.6, z: -11, solid: true, panel: 'financeiro', label: 'Financeiro e métricas' },
  { kind: 'mesa', x: 2.5, z: -6.5, solid: true },
  { kind: 'estante', x: -5.4, z: -7, rot: Math.PI / 2, solid: true },
  { kind: 'planta', x: 5.2, z: -2.8, solid: true },
  // ilha de vídeo
  { kind: 'tv', x: 12, z: -1.85, w: 4, panel: 'video', label: 'Estúdio de vídeo (timeline)' },
  { kind: 'mesa', x: 14.5, z: 2.4, solid: true },
  { kind: 'luminaria', x: 17, z: -1.2 },
  // design
  { kind: 'mesa', x: 14.5, z: 8.5, solid: true },
  { kind: 'estante', x: 17.6, z: 8.5, rot: -Math.PI / 2, solid: true },
  { kind: 'planta', x: 7, z: 11.2, solid: true },
  // redação
  { kind: 'mesa', x: -12, z: -6.5, solid: true },
  { kind: 'estante', x: -17.6, z: -7, rot: Math.PI / 2, solid: true },
  { kind: 'planta', x: -7, z: -11.2, solid: true },
  // reunião
  { kind: 'mesa-reuniao', x: -12, z: 5, w: 6, d: 2.6, solid: true },
  { kind: 'tv', x: -17.85, z: 5, rot: Math.PI / 2, w: 3.4, panel: 'calendario', label: 'Agenda da sala' },
  // copa
  { kind: 'balcao', x: 12, z: -11.2, w: 8, d: 1.2, solid: true },
  { kind: 'cafeteira', x: 10, z: -11.2, label: 'Tomar um café' },
  { kind: 'mesa', x: 12, z: -6, solid: true },
  { kind: 'planta', x: 17.2, z: -2.8, solid: true },
];

/** Onde cada funcionário de IA senta, por sala. */
export const DESKS: Record<RoomId, Vec2> = {
  video: { x: 14.5, z: 3.5 },
  design: { x: 14.5, z: 9.6 },
  copy: { x: -12, z: -5.4 },
  gerencia: { x: 2.5, z: -5.4 },
  recepcao: { x: 0, z: 0.2 },
  reuniao: { x: -12, z: 7 },
  copa: { x: 12, z: -4.9 },
};

export const SPAWN: Vec2 = { x: 0, z: 7 };

export function roomAt(p: Vec2): Room | null {
  return ROOMS.find((r) => p.x >= r.x0 && p.x < r.x1 && p.z >= r.z0 && p.z < r.z1) ?? null;
}

export const roomCenter = (r: Room): Vec2 => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 + 1.5 });

const FURN_SIZE: Partial<Record<FurnitureKind, [number, number]>> = {
  mesa: [2.2, 1.1], sofa: [2.6, 1], planta: [0.7, 0.7], cofre: [1, 1], estante: [2.4, 0.6], 'mesa-reuniao': [6, 2.6], balcao: [5, 1.1],
};

interface Box { x0: number; z0: number; x1: number; z1: number }
const SOLIDS: Box[] = [
  ...WALLS.map((w) => ({ x0: w.x - w.w / 2, z0: w.z - w.d / 2, x1: w.x + w.w / 2, z1: w.z + w.d / 2 })),
  ...FURNITURE.filter((f) => f.solid).map((f) => {
    const [bw, bd] = FURN_SIZE[f.kind] ?? [1, 1];
    let w = f.w ?? bw, d = f.d ?? bd;
    if (f.rot && Math.abs(Math.sin(f.rot)) > 0.5) [w, d] = [d, w];
    return { x0: f.x - w / 2, z0: f.z - d / 2, x1: f.x + w / 2, z1: f.z + d / 2 };
  }),
];

const RADIUS = 0.35;
export function blocked(p: Vec2) {
  if (p.x < BOUNDS.x0 + RADIUS || p.x > BOUNDS.x1 - RADIUS || p.z < BOUNDS.z0 + RADIUS || p.z > BOUNDS.z1 - RADIUS) return true;
  return SOLIDS.some((b) => p.x > b.x0 - RADIUS && p.x < b.x1 + RADIUS && p.z > b.z0 - RADIUS && p.z < b.z1 + RADIUS);
}

/** Move com deslizamento: se o passo diagonal bate, tenta só em x ou só em z. */
export function step(from: Vec2, dx: number, dz: number): Vec2 {
  const full = { x: from.x + dx, z: from.z + dz };
  if (!blocked(full)) return full;
  const onlyX = { x: from.x + dx, z: from.z };
  if (dx && !blocked(onlyX)) return onlyX;
  const onlyZ = { x: from.x, z: from.z + dz };
  if (dz && !blocked(onlyZ)) return onlyZ;
  return from;
}

/** Acha um ponto livre perto do alvo (para teleporte e cliques em móveis). */
export function freeSpotNear(p: Vec2): Vec2 {
  if (!blocked(p)) return p;
  for (let r = 0.5; r < 4; r += 0.5)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const q = { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r };
      if (!blocked(q)) return q;
    }
  return SPAWN;
}
