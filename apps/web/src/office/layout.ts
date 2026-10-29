import type { RoomId, Vec2 } from '@office/shared';
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
interface WallDef { a: Vec2; b: Vec2; doors: number[] }
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
];

export interface WallSeg { x: number; z: number; w: number; d: number }

/** Vãos das portas, com uma faixa de passagem de cada lado (o modo Decorar não deixa bloquear). */
export const DOOR_ZONES: Box[] = WALL_DEFS.flatMap(({ a, b, doors }) => doors.map((c) => (a.z === b.z
  ? { x0: c - DOOR / 2, x1: c + DOOR / 2, z0: a.z - 1.2, z1: a.z + 1.2 }
  : { x0: a.x - 1.2, x1: a.x + 1.2, z0: c - DOOR / 2, z1: c + DOOR / 2 })));

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
  | 'cafeteira' | 'balcao' | 'cofre' | 'estante' | 'tapete' | 'luminaria' | 'arquivo';

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

/** Distância de um ponto até a borda do móvel (o arquivo é comprido: vale o armário mais perto, não o centro). */
export const distToFurniture = (f: Furniture, p: Vec2) => {
  if (f.kind !== 'arquivo') return Math.hypot(f.x - p.x, f.z - p.z);
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
export const DESKS: Record<RoomId, Vec2> = {
  video: { x: 21.75, z: 4.7 },
  design: { x: 21.75, z: 13.85 },
  copy: { x: -18, z: -8.65 },
  gerencia: { x: 3.75, z: -8.65 },
  recepcao: { x: 0, z: 0.8 },
  reuniao: { x: -18, z: 9.5 },
  copa: { x: 18, z: -7.9 },
};

export const SPAWN: Vec2 = { x: 0, z: 10.5 };

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

export const WALL_BOXES: Box[] = WALLS.map((w) => ({ x0: w.x - w.w / 2, z0: w.z - w.d / 2, x1: w.x + w.w / 2, z1: w.z + w.d / 2 }));
const SOLIDS: Box[] = [
  ...WALL_BOXES,
  ...FURNITURE.filter((f) => f.solid).map(FURN_BOX),
];
/** Peças da decoração que bloqueiam a passagem (atualizadas pelo modo Decorar). */
let decorSolids: Box[] = [];
export const setDecorSolids = (b: Box[]) => { decorSolids = b; grid = new Uint8Array(COLS * ROWS); corners = new Uint8Array((COLS + 1) * (ROWS + 1)); };

const RADIUS = 0.35;
export function blocked(p: Vec2) {
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
const COLS = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL);
const ROWS = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
const cellOf = (p: Vec2) => [Math.floor((p.x - BOUNDS.x0) / CELL), Math.floor((p.z - BOUNDS.z0) / CELL)] as const;
const cellCenter = (c: number, r: number): Vec2 => ({ x: BOUNDS.x0 + (c + 0.5) * CELL, z: BOUNDS.z0 + (r + 0.5) * CELL });
/** Células livres (0 = não testada, 1 = livre, 2 = bloqueada); refeita quando a decoração muda. */
let grid = new Uint8Array(COLS * ROWS);
/** O mesmo para os cantos entre as células: a diagonal passa por eles e não pode cortar a quina de um móvel. */
let corners = new Uint8Array((COLS + 1) * (ROWS + 1));
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
