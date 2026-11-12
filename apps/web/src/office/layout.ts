import type { CustomRoom, RoomId, Vec2, WallType } from '@office/shared';
import type { PanelId } from '../lib/store';

/**
 * Planta do escritório (unidades do mundo ≈ metros). x cresce para a direita, z para "baixo" (frente).
 * Andar aberto: só a sala de reunião e a ilha de vídeo têm paredes; as outras áreas se juntam (a decoração
 * marca os limites com divisórias verdes e tapetes).
 *
 *   z=-18 ┌──────────┬──────────┬──────────┐
 *         │   COPY   ·  GERÊNCIA ·   COPA   │
 *   z=-3  ├────▼─────┤· · · · · ·├────▼─────┤
 *         │          │          ▶  VÍDEO   │
 *         │ REUNIÃO  ◀ RECEPÇÃO │· · · · · ┤ z=7.5
 *         │          ◀          ·  DESIGN  │
 *   z=18  └──────────┴────▼─────┴──────────┘
 *       x=-27      x=-9       x=9        x=27
 *
 * Salas novas são anexos a leste de x=27, em colunas de três (ver setCustomRooms). As constantes abaixo são
 * alteradas no lugar: quem desenha a planta remonta o mapa quando `mapRev` muda na store.
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
  { id: 'recepcao', label: 'Recepção', emoji: '🛋️', x0: -9, z0: -3, x1: 9, z1: 18, floor: '#efe8dd', key: '1' },
  { id: 'gerencia', label: 'Gerência', emoji: '📊', x0: -9, z0: -18, x1: 9, z1: -3, floor: '#e3e9f2', key: '2' },
  { id: 'video', label: 'Ilha de vídeo', emoji: '🎬', x0: 9, z0: -3, x1: 27, z1: 7.5, floor: '#2a2633', key: '3' },
  { id: 'design', label: 'Estúdio de design', emoji: '🎨', x0: 9, z0: 7.5, x1: 27, z1: 18, floor: '#efe6f6', key: '4' },
  { id: 'copy', label: 'Redação', emoji: '✍️', x0: -27, z0: -18, x1: -9, z1: -3, floor: '#e4f3ee', key: '5' },
  { id: 'reuniao', label: 'Sala de reunião', emoji: '🤝', x0: -27, z0: -3, x1: -9, z1: 18, floor: '#f3ece4', key: '6' },
  { id: 'copa', label: 'Copa', emoji: '☕', x0: 9, z0: -18, x1: 27, z1: -3, floor: '#f6efe0', key: '7' },
];

export const BOUNDS = { x0: -27, z0: -18, x1: 27, z1: 18 };
export const DOOR = 2.6;
export const WALL_T = 0.14;
export const WALL_H = 0.6;

export interface Box { x0: number; z0: number; x1: number; z1: number }

/** Paredes como segmentos (x1,z1)-(x2,z2) com portas (centro no eixo da parede). */
interface WallDef { a: Vec2; b: Vec2; doors: number[]; /** Divisa do andar aberto: existe, mas começa sem parede até alguém escolher um acabamento. */ open?: boolean }
const WALL_DEFS: WallDef[] = [
  // contorno (porta de entrada na frente da recepção)
  { a: { x: -27, z: -18 }, b: { x: 27, z: -18 }, doors: [] },
  { a: { x: -27, z: 18 }, b: { x: 27, z: 18 }, doors: [0] },
  { a: { x: -27, z: -18 }, b: { x: -27, z: 18 }, doors: [] },
  { a: { x: 27, z: -18 }, b: { x: 27, z: 18 }, doors: [] },
  // sala de reunião
  { a: { x: -27, z: -3 }, b: { x: -9, z: -3 }, doors: [-18] },
  { a: { x: -9, z: -3 }, b: { x: -9, z: 18 }, doors: [7.5, 14.5] },
  // ilha de vídeo (aberta para o estúdio de design)
  { a: { x: 9, z: -3 }, b: { x: 27, z: -3 }, doors: [21] },
  { a: { x: 9, z: -3 }, b: { x: 9, z: 7.5 }, doors: [2.2] },
  // divisas do andar aberto (recepção, gerência, redação, copa e design): começam sem parede, mas dá para
  // fechar cada sala no modo Decorar (vidro, por exemplo), com porta já prevista
  { a: { x: -9, z: -3 }, b: { x: 9, z: -3 }, doors: [0], open: true },
  { a: { x: -9, z: -18 }, b: { x: -9, z: -3 }, doors: [-10.5], open: true },
  { a: { x: 9, z: -18 }, b: { x: 9, z: -3 }, doors: [-10.5], open: true },
  { a: { x: 9, z: 7.5 }, b: { x: 9, z: 18 }, doors: [13], open: true },
  { a: { x: 9, z: 7.5 }, b: { x: 27, z: 7.5 }, doors: [23], open: true },
];

export interface WallSeg { key: string; x: number; z: number; w: number; d: number }
const coord = (n: number) => String(Math.round(n * 10) / 10);
/** Divisas entre as salas: a parede é cortada nelas para cada sala poder ter a sua (vidro numa, alvenaria na outra). */
const ROOM_LINES_X = [-9, 9];
const ROOM_LINES_Z = [-3, 7.5];

/** Vãos das portas, com uma faixa de passagem de cada lado (o modo Decorar não deixa bloquear). */
const doorZones = ({ a, b, doors }: WallDef): Box[] => doors.map((c) => (a.z === b.z
  ? { x0: c - DOOR / 2, x1: c + DOOR / 2, z0: a.z - 1.2, z1: a.z + 1.2 }
  : { x0: a.x - 1.2, x1: a.x + 1.2, z0: c - DOOR / 2, z1: c + DOOR / 2 }));
export const DOOR_ZONES: Box[] = WALL_DEFS.flatMap(doorZones);

/** Trechos das versões até a 0.11.8 (entre portas e divisas): as escolhas salvas com essas chaves continuam valendo. */
const legacySegs = ({ a, b, doors }: WallDef): WallSeg[] => {
  const horizontal = a.z === b.z;
  const from = horizontal ? a.x : a.z;
  const to = horizontal ? b.x : b.z;
  const cuts = [...doors].sort((p, q) => p - q).flatMap((c) => [c - DOOR / 2, c + DOOR / 2]);
  const points = [from, ...cuts, to];
  const segs: WallSeg[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const s = points[i], e = points[i + 1];
    if (e - s < 0.05) continue;
    const lines = (horizontal ? ROOM_LINES_X : ROOM_LINES_Z).filter((v) => v > s + 0.05 && v < e - 0.05);
    const stops = [s, ...lines, e];
    for (let k = 0; k + 1 < stops.length; k++) {
      const mid = (stops[k] + stops[k + 1]) / 2, len = stops[k + 1] - stops[k];
      const [x, z] = horizontal ? [mid, a.z] : [a.x, mid];
      segs.push({ key: `${coord(x)}:${coord(z)}`, x, z, ...(horizontal ? { w: len, d: WALL_T } : { w: WALL_T, d: len }) });
    }
  }
  return segs;
};
/**
 * Paredes em pedaços de meio metro (desde a 0.11.9). Cada pedaço tem uma chave `h:<x início>:<z>` (horizontal) ou
 * `v:<z início>:<x>` (vertical). A planta-base gera os pedaços das paredes de sempre; o modo Decorar desenha pedaços
 * novos em qualquer linha da grade e apaga os existentes. No mapa salvo ficam só as diferenças da planta-base.
 */
export const PIECE = 0.5;
export const pieceKey = (horizontal: boolean, start: number, line: number) => `${horizontal ? 'h' : 'v'}:${coord(start)}:${coord(line)}`;
const PIECE_RE = /^([hv]):(-?[\d.]+):(-?[\d.]+)$/;
const LEGACY_RE = /^-?[\d.]+:-?[\d.]+$/;
export const isPieceKey = (k: string) => PIECE_RE.test(k);
export function pieceOf(key: string): WallSeg | null {
  const m = PIECE_RE.exec(key);
  if (!m) return null;
  const a = Number(m[2]), line = Number(m[3]);
  return m[1] === 'h' ? { key, x: a + PIECE / 2, z: line, w: PIECE, d: WALL_T } : { key, x: line, z: a + PIECE / 2, w: WALL_T, d: PIECE };
}
/** Pedaços de uma parede da planta-base, sem os das portas. */
const defPieces = ({ a, b, doors }: WallDef): string[] => {
  const h = a.z === b.z;
  const from = h ? Math.min(a.x, b.x) : Math.min(a.z, b.z), to = h ? Math.max(a.x, b.x) : Math.max(a.z, b.z);
  const out: string[] = [];
  for (let s = Math.ceil(from / PIECE - 1e-6) * PIECE; s + PIECE <= to + 1e-6; s += PIECE) {
    if (doors.some((c) => Math.abs(s + PIECE / 2 - c) < DOOR / 2)) continue;
    out.push(pieceKey(h, s, h ? a.z : a.x));
  }
  return out;
};

const DEFAULT_PIECES = new Set<string>();
/** Pedaços das divisas do andar aberto: existem na planta, mas começam sem parede. */
const OPEN_PIECES = new Set<string>();
const LEGACY_OF = new Map<string, string>();
const LEGACY_PIECES = new Map<string, string[]>();
const dividerCache = new Map<string, boolean>();
let wallStyles: Record<string, WallType> = {};
/** Pedaços com parede possível: os da planta-base mais os desenhados. */
export const WALLS: WallSeg[] = [];

function setDefs(defs: WallDef[]) {
  DEFAULT_PIECES.clear(); OPEN_PIECES.clear(); LEGACY_OF.clear(); LEGACY_PIECES.clear(); dividerCache.clear();
  for (const d of defs) for (const k of defPieces(d)) { DEFAULT_PIECES.add(k); if (d.open) OPEN_PIECES.add(k); }
  for (const s of defs.flatMap(legacySegs)) {
    const h = s.w > s.d;
    const lo = h ? s.x - s.w / 2 : s.z - s.d / 2, hi = h ? s.x + s.w / 2 : s.z + s.d / 2;
    const keys: string[] = [];
    for (let a = Math.ceil(lo / PIECE - 1e-6) * PIECE; a + PIECE <= hi + 1e-6; a += PIECE) {
      const k = pieceKey(h, a, h ? s.z : s.x);
      if (DEFAULT_PIECES.has(k)) { keys.push(k); LEGACY_OF.set(k, s.key); }
    }
    LEGACY_PIECES.set(s.key, keys);
  }
}
function rebuildWalls() {
  const keys = new Set(DEFAULT_PIECES);
  for (const [k, t] of Object.entries(wallStyles)) if (t !== 'removida' && isPieceKey(k)) keys.add(k);
  WALLS.length = 0;
  for (const k of keys) WALLS.push(pieceOf(k)!);
}

/** Salas dos dois lados de um pedaço (null onde é fora do prédio). */
function sidesOf(key: string) {
  const w = pieceOf(key)!;
  const across = w.w > w.d;
  return [roomAt(across ? { x: w.x, z: w.z - 0.6 } : { x: w.x - 0.6, z: w.z }), roomAt(across ? { x: w.x, z: w.z + 0.6 } : { x: w.x + 0.6, z: w.z })];
}
/** Divisórias: pedaços com uma sala diferente de cada lado (as paredes externas do prédio ficam de fora). */
export function isDivider(key: string) {
  let v = dividerCache.get(key);
  if (v === undefined) {
    const [a, b] = isPieceKey(key) ? sidesOf(key) : [null, null];
    v = !!(a && b && a.id !== b.id);
    dividerCache.set(key, v);
  }
  return v;
}
/** Parede de fora do prédio: só troca de acabamento, nunca some (ninguém sai andando pelo vazio). */
export function isExterior(key: string) {
  const [a, b] = sidesOf(key);
  return !a || !b;
}
/** Acabamento de um pedaço: a escolha dele (ou a do trecho antigo onde ele está); senão o que a planta-base mostra. */
export function styleOf(map: Record<string, WallType>, key: string): WallType {
  const legacy = LEGACY_OF.get(key);
  return map[key] ?? (legacy ? map[legacy] : undefined) ?? baseStyle(map, key);
}
/**
 * O que o pedaço mostra sem escolha própria: fora da planta-base e nas divisas do andar aberto, nada (os padrões não
 * fecham as salas sozinhos); nas divisórias, o padrão delas; senão o padrão do escritório ou a alvenaria.
 */
export function baseStyle(map: Record<string, WallType>, key: string): WallType {
  if (!DEFAULT_PIECES.has(key) || OPEN_PIECES.has(key)) return 'removida';
  return (isDivider(key) ? map.divisorias : undefined) ?? map.padrao ?? 'alvenaria';
}

/** Pedaços vizinhos do mesmo acabamento numa mesma linha viram um trecho só (para desenhar e para colidir). */
export interface WallRun extends WallSeg { keys: string[]; type: WallType }
export function wallRuns(map: Record<string, WallType> = wallStyles): WallRun[] {
  const groups = new Map<string, { a: number; key: string }[]>();
  for (const w of WALLS) {
    const m = PIECE_RE.exec(w.key)!;
    const g = `${m[1]}|${m[3]}|${styleOf(map, w.key)}`;
    let list = groups.get(g);
    if (!list) groups.set(g, (list = []));
    list.push({ a: Number(m[2]), key: w.key });
  }
  const out: WallRun[] = [];
  for (const [g, list] of groups) {
    const [o, line, type] = g.split('|');
    list.sort((p, q) => p.a - q.a);
    for (let i = 0; i < list.length;) {
      let j = i;
      while (j + 1 < list.length && Math.abs(list[j + 1].a - list[j].a - PIECE) < 1e-6) j++;
      const s = list[i].a, e = list[j].a + PIECE, ln = Number(line);
      out.push({
        key: `${o}:${coord(s)}:${line}:${type}`, keys: list.slice(i, j + 1).map((x) => x.key), type: type as WallType,
        ...(o === 'h' ? { x: (s + e) / 2, z: ln, w: e - s, d: WALL_T } : { x: ln, z: (s + e) / 2, w: WALL_T, d: e - s }),
      });
      i = j + 1;
    }
  }
  return out;
}

/** Pedaços de uma linha arrastada de `s` até `p`, no eixo em que o arraste andou mais. */
export function lineKeys(s: Vec2, p: Vec2): string[] {
  const r = (v: number) => Math.round(v / PIECE) * PIECE;
  const h = Math.abs(p.x - s.x) >= Math.abs(p.z - s.z);
  const line = r(h ? s.z : s.x);
  const a = r(Math.min(h ? s.x : s.z, h ? p.x : p.z));
  let b = r(Math.max(h ? s.x : s.z, h ? p.x : p.z));
  if (b <= a) b = a + PIECE;
  const out: string[] = [];
  for (let v = a; v < b - 1e-6; v += PIECE) out.push(pieceKey(h, v, line));
  return out;
}
/** Dá para pôr esse acabamento no pedaço? Só dentro do prédio, e as paredes de fora não podem sumir. */
export function canSetPiece(key: string, type: WallType) {
  if (!isPieceKey(key)) return false;
  const [a, b] = sidesOf(key);
  if (!a && !b) return false;
  return type !== 'removida' || (!!a && !!b);
}
/**
 * Mapa no formato de pedaços: as escolhas por trecho antigo viram escolhas dos pedaços dele, e o que fica igual à
 * planta-base sai do mapa.
 */
export function normalizeWalls(map: Record<string, WallType>): Record<string, WallType> {
  const out = { ...map };
  for (const k of Object.keys(map)) {
    if (!LEGACY_RE.test(k)) continue;
    for (const p of LEGACY_PIECES.get(k) ?? []) if (!(p in out)) out[p] = map[k];
    delete out[k];
  }
  for (const k of Object.keys(out)) if (isPieceKey(k) && out[k] === baseStyle(out, k)) delete out[k];
  return out;
}

setDefs(WALL_DEFS);
rebuildWalls();

export type FurnitureKind =
  | 'mesa' | 'cadeira' | 'sofa' | 'planta' | 'quadro' | 'calendario' | 'tv' | 'mesa-reuniao'
  | 'cafeteira' | 'balcao' | 'cofre' | 'estante' | 'tapete' | 'luminaria' | 'arquivo' | 'moodboard';

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
 * Móveis fixos (os que abrem páginas e as mesas onde as pessoas e os funcionários sentam). A decoração
 * em volta (sofás, plantas, tapetes, quadros…) é editável no modo Decorar e fica em decor/.
 *
 * Mesas das pessoas: ao lado dos funcionários de IA de cada área e duas na recepção.
 * `x,z` é o centro da mesa; a cadeira fica em `z + 1.1`, de frente para o monitor (como as dos funcionários).
 */
export interface HumanDesk { id: string; room: RoomId; x: number; z: number }
export const HUMAN_DESKS: HumanDesk[] = [
  { id: 'redacao-1', room: 'copy', x: -22.8, z: -9.75 },
  { id: 'redacao-2', room: 'copy', x: -13.2, z: -9.75 },
  { id: 'gerencia-1', room: 'gerencia', x: -2.4, z: -9.75 },
  { id: 'video-1', room: 'video', x: 15, z: 3.6 },
  { id: 'design-1', room: 'design', x: 15.9, z: 12.75 },
  { id: 'recepcao-1', room: 'recepcao', x: -5.4, z: 6.3 },
  { id: 'recepcao-2', room: 'recepcao', x: 5.4, z: 6.3 },
];
export const deskSeat = (d: HumanDesk): Vec2 => ({ x: d.x, z: d.z + 1.1 });

/**
 * Arquivo dos clientes: fileira de arquivos de aço na parede do fundo da redação, abaixo das janelas (um armário
 * por cliente, ver Archive.tsx). Ocupa sempre a fileira inteira, para a rota não mudar quando entra cliente.
 */
export const ARCHIVE_SLOTS = 12;
export const ARCHIVE: Furniture & { w: number; d: number } = { kind: 'arquivo', x: -18.4, z: -17.62, w: 14.4, d: 0.6, solid: true, panel: 'arquivo', label: 'Arquivo dos clientes' };

/** Cavaletes de moodboard no estúdio de design, na divisa com a ilha de vídeo, deixando a passagem livre à direita. */
export const MOODBOARD_SLOTS = 3;
export const MOODBOARD: Furniture & { w: number; d: number } = { kind: 'moodboard', x: 15, z: 8.6, w: 9.6, d: 0.5, solid: true, panel: 'moodboard', label: 'Moodboards' };

/** Distância de um ponto até a borda do móvel (o arquivo é comprido: vale o armário mais perto, não o centro). */
export const distToFurniture = (f: Furniture, p: Vec2) => {
  if (f.kind !== 'arquivo' && f.kind !== 'moodboard') return Math.hypot(f.x - p.x, f.z - p.z);
  const b = FURN_BOX(f);
  return Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.z0 - p.z, 0, p.z - b.z1)) + 0.6;
};

export const FURNITURE: Furniture[] = [
  ...HUMAN_DESKS.map((d): Furniture => ({ kind: 'mesa', x: d.x, z: d.z, solid: true })),
  // recepção
  { kind: 'balcao', x: 0, z: 1.8, w: 5, d: 1.1, solid: true, panel: 'equipe', label: 'Equipe e convites' },
  { kind: 'quadro', x: -8.85, z: 1.5, rot: Math.PI / 2, panel: 'atividade', label: 'Mural de atividade' },
  // gerência
  { kind: 'quadro', x: 0, z: -17.85, w: 6, panel: 'demandas', label: 'Quadro de demandas' },
  { kind: 'calendario', x: -6.3, z: -17.85, panel: 'calendario', label: 'Calendário' },
  { kind: 'cofre', x: 6.9, z: -17, solid: true, panel: 'financeiro', label: 'Financeiro e métricas' },
  { kind: 'mesa', x: 3.75, z: -9.75, solid: true },
  // ilha de vídeo
  { kind: 'tv', x: 18, z: -2.85, w: 4, panel: 'video', label: 'Estúdio de vídeo (timeline)' },
  { kind: 'mesa', x: 21.75, z: 3.6, solid: true },
  // design
  { kind: 'mesa', x: 21.75, z: 12.75, solid: true },
  MOODBOARD,
  // redação
  { kind: 'mesa', x: -18, z: -9.75, solid: true },
  ARCHIVE,
  // reunião
  { kind: 'mesa-reuniao', x: -18, z: 7.5, w: 6, d: 2.6, solid: true },
  { kind: 'tv', x: -26.85, z: 7.5, rot: Math.PI / 2, w: 3.4, panel: 'calendario', label: 'Agenda da sala' },
  // copa
  { kind: 'balcao', x: 18, z: -17.2, w: 8, d: 1.2, solid: true },
  { kind: 'cafeteira', x: 15, z: -17.2, label: 'Tomar um café' },
  { kind: 'mesa', x: 18, z: -9, solid: true },
];

/** Onde cada funcionário de IA senta, por sala. */
export const DESKS: Record<string, Vec2> = {
  video: { x: 21.75, z: 4.7 },
  design: { x: 21.75, z: 13.85 },
  copy: { x: -18, z: -8.65 },
  gerencia: { x: 3.75, z: -8.65 },
  recepcao: { x: 0, z: 0.8 },
  reuniao: { x: -18, z: 9.5 },
  copa: { x: 18, z: -7.9 },
};

export const SPAWN: Vec2 = { x: 0, z: 10.5 };

/** Onde o funcionário senta: o lugar dele, a mesa padrão da sala ou, sem nenhum dos dois, o meio da sala. */
export const agentSeat = (a: { room: string; seat?: Vec2 | null }): Vec2 => {
  if (a.seat) return a.seat;
  if (DESKS[a.room]) return DESKS[a.room];
  const r = ROOMS.find((x) => x.id === a.room);
  return r ? roomCenter(r) : SPAWN;
};

export function roomAt(p: Vec2): Room | null {
  return ROOMS.find((r) => p.x >= r.x0 && p.x < r.x1 && p.z >= r.z0 && p.z < r.z1) ?? null;
}

export const roomCenter = (r: Room): Vec2 => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 + 1.5 });

const FURN_SIZE: Partial<Record<FurnitureKind, [number, number]>> = {
  mesa: [2.2, 1.1], sofa: [2.6, 1], planta: [0.7, 0.7], cofre: [1, 1], estante: [2.4, 0.6], 'mesa-reuniao': [6, 2.6], balcao: [5, 1.1],
};

export const FURN_BOX = (f: Furniture): Box => {
  const [bw, bd] = FURN_SIZE[f.kind] ?? [1, 1];
  let w = f.w ?? bw, d = f.d ?? bd;
  if (f.rot && Math.abs(Math.sin(f.rot)) > 0.5) [w, d] = [d, w];
  return { x0: f.x - w / 2, z0: f.z - d / 2, x1: f.x + w / 2, z1: f.z + d / 2 };
};

const wallBox = (w: WallSeg): Box => ({ x0: w.x - w.w / 2, z0: w.z - w.d / 2, x1: w.x + w.w / 2, z1: w.z + w.d / 2 });
export const WALL_BOXES: Box[] = wallRuns().filter((r) => r.type !== 'removida').map(wallBox);
const SOLIDS: Box[] = [
  ...WALL_BOXES,
  ...FURNITURE.filter((f) => f.solid).map(FURN_BOX),
];
/** Peças da decoração que bloqueiam a passagem (atualizadas pelo modo Decorar). */
let decorSolids: Box[] = [];
export const setDecorSolids = (b: Box[]) => { decorSolids = b; resetGrid(); };

// ---------------------------------------------------------------- planta que muda: anexos, paredes e mesas extras

const MAIN = { rooms: [...ROOMS], furniture: [...FURNITURE], desks: [...HUMAN_DESKS], x1: BOUNDS.x1, walls: WALL_DEFS };
const ANNEX_W = 14, ANNEX_D = 12, ANNEX_ROWS = 3;
const annexRect = (slot: number) => {
  const col = Math.floor(slot / ANNEX_ROWS), row = slot % ANNEX_ROWS;
  const x0 = MAIN.x1 + col * ANNEX_W, z0 = BOUNDS.z0 + row * ANNEX_D;
  return { col, row, x0, x1: x0 + ANNEX_W, z0, z1: z0 + ANNEX_D };
};

let agentDesks: Box[] = [];
export const wallTypeOf = (key: string): WallType => styleOf(wallStyles, key);
export const dividerKeys = () => WALLS.filter((w) => isDivider(w.key)).map((w) => w.key);

function rebuildSolids() {
  WALL_BOXES.length = 0;
  WALL_BOXES.push(...wallRuns().filter((r) => r.type !== 'removida').map(wallBox));
  SOLIDS.length = 0;
  SOLIDS.push(...WALL_BOXES, ...FURNITURE.filter((f) => f.solid).map(FURN_BOX), ...agentDesks);
  resetGrid();
}

/** Tipo de cada trecho de parede; a removida deixa de bloquear a passagem. */
export function setWallStyles(map: Record<string, WallType>) {
  wallStyles = map;
  rebuildWalls();
  rebuildSolids();
}

/** Mesas dos funcionários que não usam a mesa padrão da sala. */
export function setAgentDesks(agents: { seat?: Vec2 | null }[]) {
  agentDesks = agents.filter((a) => a.seat).map((a) => FURN_BOX({ kind: 'mesa', x: a.seat!.x, z: a.seat!.z - 1.1 }));
  rebuildSolids();
}

/** Salas novas: cada uma ganha paredes próprias, porta para o vizinho e duas mesas para pessoas. */
export function setCustomRooms(list: CustomRoom[]) {
  const taken = new Map(list.map((r) => [r.slot, r]));
  const has = (col: number, row: number) => row >= 0 && row < ANNEX_ROWS && col >= 0 && taken.has(col * ANNEX_ROWS + row);
  ROOMS.length = 0;
  ROOMS.push(...MAIN.rooms, ...list.map((r): Room => {
    const a = annexRect(r.slot);
    return { id: r.id, label: r.name, emoji: r.emoji, x0: a.x0, x1: a.x1, z0: a.z0, z1: a.z1, floor: r.floor, key: r.slot < 2 ? String(8 + r.slot) : '' };
  }));
  const extra: WallDef[] = [];
  for (const r of list) {
    const { col, row, x0, x1, z0, z1 } = annexRect(r.slot);
    const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
    if (!has(col, row - 1)) extra.push({ a: { x: x0, z: z0 }, b: { x: x1, z: z0 }, doors: [] });
    extra.push({ a: { x: x0, z: z1 }, b: { x: x1, z: z1 }, doors: has(col, row + 1) ? [xc] : [] });
    extra.push({ a: { x: x1, z: z0 }, b: { x: x1, z: z1 }, doors: has(col + 1, row) ? [zc] : [] });
    if (col > 0 && !has(col - 1, row)) extra.push({ a: { x: x0, z: z0 }, b: { x: x0, z: z1 }, doors: [] });
  }
  // a parede leste do prédio abre uma porta para cada sala da primeira coluna
  const eastDoors = [0, 1, 2].filter((row) => has(0, row)).map((row) => BOUNDS.z0 + (row + 0.5) * ANNEX_D);
  const defs = [...MAIN.walls.map((d) => (d.a.x === MAIN.x1 && d.b.x === MAIN.x1 && d.a.z === BOUNDS.z0 ? { ...d, doors: eastDoors } : d)), ...extra];
  setDefs(defs);
  rebuildWalls();
  DOOR_ZONES.length = 0;
  DOOR_ZONES.push(...defs.flatMap(doorZones));
  const desks = list.flatMap((r): HumanDesk[] => {
    const a = annexRect(r.slot);
    return [{ id: `${r.id}-1`, room: r.id, x: a.x0 + 3.5, z: a.z0 + 3 }, { id: `${r.id}-2`, room: r.id, x: a.x1 - 3.5, z: a.z0 + 3 }];
  });
  HUMAN_DESKS.length = 0;
  HUMAN_DESKS.push(...MAIN.desks, ...desks);
  FURNITURE.length = 0;
  FURNITURE.push(...MAIN.furniture, ...desks.map((d): Furniture => ({ kind: 'mesa', x: d.x, z: d.z, solid: true })));
  BOUNDS.x1 = list.reduce((m, r) => Math.max(m, annexRect(r.slot).x1), MAIN.x1);
  COLS = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL);
  rebuildSolids();
}

/**
 * Lugar para mais um funcionário: varre a sala atrás de um espaço para a mesa e a cadeira. Devolve onde ele senta,
 * ou null se a sala estiver cheia.
 */
export function findDeskSpot(roomId: string): Vec2 | null {
  const r = ROOMS.find((x) => x.id === roomId);
  if (!r) return null;
  const hit = (b: Box, list: Box[]) => list.some((s) => b.x0 < s.x1 && b.x1 > s.x0 && b.z0 < s.z1 && b.z1 > s.z0);
  for (let z = r.z0 + 3.2; z < r.z1 - 1.5; z += 1.5)
    for (let x = r.x0 + 2.2; x < r.x1 - 2.1; x += 1.5) {
      const box = { x0: x - 1.6, x1: x + 1.6, z0: z - 2, z1: z + 1 };
      if (!hit(box, SOLIDS) && !hit(box, decorSolids) && !hit(box, DOOR_ZONES)) return { x, z };
    }
  return null;
}

const RADIUS = 0.35;
export function blocked(p: Vec2) {
  // a leste do prédio, só dentro das salas que existem: o espaço entre elas é vazio
  if (p.x > MAIN.x1 && !ROOMS.some((r) => r.x0 >= MAIN.x1 && p.x >= r.x0 - 0.2 && p.x <= r.x1 + 0.2 && p.z >= r.z0 && p.z <= r.z1)) return true;
  if (p.x < BOUNDS.x0 + RADIUS || p.x > BOUNDS.x1 - RADIUS || p.z < BOUNDS.z0 + RADIUS || p.z > BOUNDS.z1 - RADIUS) return true;
  const hit = (b: Box) => p.x > b.x0 - RADIUS && p.x < b.x1 + RADIUS && p.z > b.z0 - RADIUS && p.z < b.z1 + RADIUS;
  return SOLIDS.some(hit) || decorSolids.some(hit);
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

/**
 * O segmento a→b passa por dentro da caixa (aumentada pelo raio do avatar e mais uma folga)? Teste exato, por
 * intervalos. A folga evita rotas que raspam a quina: andando, o arredondamento punha o avatar dentro dela e ele parava.
 */
const CLEARANCE = RADIUS + 0.06;
function segHits(a: Vec2, b: Vec2, box: Box, pad = CLEARANCE) {
  let t0 = 0, t1 = 1;
  const slab = (p: number, d: number, lo: number, hi: number) => {
    if (Math.abs(d) < 1e-9) return p > lo && p < hi;
    let ta = (lo - p) / d, tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    return t0 < t1;
  };
  return slab(a.x, b.x - a.x, box.x0 - pad, box.x1 + pad) && slab(a.z, b.z - a.z, box.z0 - pad, box.z1 + pad);
}

const inBounds = (p: Vec2) => p.x >= BOUNDS.x0 + RADIUS && p.x <= BOUNDS.x1 - RADIUS && p.z >= BOUNDS.z0 + RADIUS && p.z <= BOUNDS.z1 - RADIUS;

/** Dá para ir em linha reta de `a` até `b` sem encostar em nada? */
function clearLine(a: Vec2, b: Vec2, pad = CLEARANCE) {
  if (!inBounds(a) || !inBounds(b)) return false;
  return !SOLIDS.some((s) => segHits(a, b, s, pad)) && !decorSolids.some((s) => segHits(a, b, s, pad));
}

const CELL = 0.25;
let COLS = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL);
const ROWS = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
const cellOf = (p: Vec2) => [Math.floor((p.x - BOUNDS.x0) / CELL), Math.floor((p.z - BOUNDS.z0) / CELL)] as const;
const cellCenter = (c: number, r: number): Vec2 => ({ x: BOUNDS.x0 + (c + 0.5) * CELL, z: BOUNDS.z0 + (r + 0.5) * CELL });
/** Células livres (0 = não testada, 1 = livre, 2 = bloqueada); refeita quando a decoração muda. */
let grid = new Uint8Array(COLS * ROWS);
/** O mesmo para os cantos entre as células: a diagonal passa por eles e não pode cortar a quina de um móvel. */
let corners = new Uint8Array((COLS + 1) * (ROWS + 1));
function resetGrid() { grid = new Uint8Array(COLS * ROWS); corners = new Uint8Array((COLS + 1) * (ROWS + 1)); }
const cornerFree = (c: number, r: number) => {
  const k = r * (COLS + 1) + c;
  if (!corners[k]) corners[k] = blocked({ x: BOUNDS.x0 + c * CELL, z: BOUNDS.z0 + r * CELL }) ? 2 : 1;
  return corners[k] === 1;
};

/** Ladrilho de 1 m do chão (o cursor e o destino do clique, como no Habbo): devolve o centro dele. */
export const TILE = 1;
export const tileAt = (p: Vec2): Vec2 => ({
  x: BOUNDS.x0 + (Math.floor((p.x - BOUNDS.x0) / TILE) + 0.5) * TILE,
  z: BOUNDS.z0 + (Math.floor((p.z - BOUNDS.z0) / TILE) + 0.5) * TILE,
});

/** O trecho a→b segue uma das 8 direções da grade (reto ou na diagonal exata)? */
const gridDir = (a: Vec2, b: Vec2) => {
  const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
  return dx < 1e-6 || dz < 1e-6 || Math.abs(dx - dz) < 1e-6;
};

/**
 * Caminho de `from` até `to` desviando de paredes e móveis (A* numa grade de 25 cm). Como no Habbo, o avatar
 * anda só reto ou na diagonal da grade: os pontos são juntados em trechos longos, mas sem sair dessas 8 direções.
 * Devolve os pontos a percorrer, sem o de partida; vazio se não há como chegar.
 */
export function findPath(from: Vec2, to: Vec2): Vec2[] {
  const goal = freeSpotNear(to);
  const [sc, sr] = cellOf(from), [gc, gr] = cellOf(goal);
  const first = cellCenter(sc, sr);
  const lead: Vec2[] = Math.hypot(first.x - from.x, first.z - from.z) > 0.02 ? [first] : [];
  // atalho para o caminho livre: uma diagonal e depois uma reta (ou o contrário), sem rodar o A*
  {
    const dx = goal.x - first.x, dz = goal.z - first.z, d = Math.min(Math.abs(dx), Math.abs(dz));
    const diagFirst = { x: first.x + Math.sign(dx) * d, z: first.z + Math.sign(dz) * d };
    const straightFirst = { x: goal.x - Math.sign(dx) * d, z: goal.z - Math.sign(dz) * d };
    for (const mid of [diagFirst, straightFirst])
      if (clearLine(first, mid) && clearLine(mid, goal)) return [...lead, mid, goal].filter((q, i, a) => i === 0 || Math.hypot(q.x - a[i - 1].x, q.z - a[i - 1].z) > 0.02);
  }
  const idx = (c: number, r: number) => r * COLS + c;
  const isFree = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    if ((c === sc && r === sr) || (c === gc && r === gr)) return true;
    const k = idx(c, r);
    if (!grid[k]) grid[k] = blocked(cellCenter(c, r)) ? 2 : 1;
    return grid[k] === 1;
  };
  const g = new Float32Array(COLS * ROWS).fill(Infinity);
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const h = (c: number, r: number) => Math.hypot(c - gc, r - gr);
  // fila de prioridade simples (heap binário) com [f, índice]
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    for (let j = heap.length - 1; j > 0;) {
      const pj = (j - 1) >> 1;
      if (heap[pj][0] <= heap[j][0]) break;
      [heap[pj], heap[j]] = [heap[j], heap[pj]]; j = pj;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let j = 0; ;) {
        const l = 2 * j + 1, r = l + 1;
        let m = j;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === j) break;
        [heap[m], heap[j]] = [heap[j], heap[m]]; j = m;
      }
    }
    return top[1];
  };
  const start = idx(sc, sr), end = idx(gc, gr);
  g[start] = 0;
  push(h(sc, sr), start);
  let found = false;
  while (heap.length) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === end) { found = true; break; }
    const c = cur % COLS, r = (cur / COLS) | 0;
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const nc = c + dc, nr = r + dr;
        if (!isFree(nc, nr)) continue;
        // diagonal só se as duas laterais estão livres (não corta quina)
        if (dc && dr && (!isFree(c + dc, r) || !isFree(c, r + dr) || !cornerFree(c + (dc > 0 ? 1 : 0), r + (dr > 0 ? 1 : 0)))) continue;
        const ni = idx(nc, nr);
        const ng = g[cur] + (dc && dr ? Math.SQRT2 : 1);
        if (ng < g[ni]) { g[ni] = ng; prev[ni] = cur; push(ng + h(nc, nr), ni); }
      }
  }
  if (!found) return [];
  const cells: Vec2[] = [];
  for (let i = prev[end]; i !== -1 && i !== start; i = prev[i]) cells.unshift(cellCenter(i % COLS, (i / COLS) | 0));
  cells.push(goal);
  // primeiro encaixa no centro da célula de partida; depois, de cada ponto, pula para o mais distante que dá
  // para alcançar em linha reta numa das 8 direções
  const out: Vec2[] = [...lead];
  let at = out[0] ?? from;
  for (let i = 0; i < cells.length;) {
    let j = i;
    while (j + 1 < cells.length && gridDir(at, cells[j + 1]) && clearLine(at, cells[j + 1])) j++;
    out.push(cells[j]);
    at = cells[j];
    i = j + 1;
  }
  return out;
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
