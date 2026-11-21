import { create } from 'zustand';
import { PLAN, basePlanProblem, planProblem, type Rect, type Vec2, type WallType } from '@office/shared';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { BASE_ROOM_IDS, ROOMS, customRects, isPieceKey, normalizeWalls, pieceKey, relocate } from '../layout';
import { commit, useDecor } from './state';
import { saveWalls } from './walls';

/**
 * Ferramenta Planta do modo Decorar: mover, aumentar e diminuir as salas (as originais dentro do prédio, as novas a
 * leste dele) e desenhar sala nova no espaço a leste. Ao mover, a decoração e as mesas de quem senta lá vão junto.
 */
export type PlanDrag =
  | { mode: 'novo'; start: Vec2; rect: Rect }
  | { mode: 'mover'; id: string; start: Vec2; base: Rect; rect: Rect }
  | { mode: 'borda'; id: string; edges: { l: boolean; r: boolean; t: boolean; b: boolean }; base: Rect; rect: Rect };

/** Uma mudança da planta, para desfazer e refazer: `before` null = a sala foi criada. */
interface PlanStep { id: string; before: Rect | null; after: Rect }
export const usePlan = create<{ on: boolean; sel: string | null; drag: PlanDrag | null; problem: string | null; busy: boolean; past: PlanStep[]; future: PlanStep[] }>(() => ({
  on: false, sel: null, drag: null, problem: null, busy: false, past: [], future: [],
}));
const remember = (step: PlanStep) => usePlan.setState((s) => ({ past: [...s.past.slice(-30), step], future: [] }));

/** Desfaz a última mudança da planta (sala criada sai, se ainda estiver vazia; sala mexida volta ao lugar). */
export async function undoPlan() {
  const { past, busy } = usePlan.getState();
  const step = past.at(-1);
  if (!step || busy) return;
  usePlan.setState({ busy: true });
  try {
    if (step.before) await changeRoom(step.id, step.after, step.before);
    else await removeCreated(step.id, step.after);
    usePlan.setState((s) => ({ past: s.past.slice(0, -1), future: [...s.future, step] }));
  } catch (e) { useStore.getState().notify((e as Error).message); }
  usePlan.setState({ busy: false });
}

export async function redoPlan() {
  const { future, busy } = usePlan.getState();
  const step = future.at(-1);
  if (!step || busy) return;
  usePlan.setState({ busy: true });
  try {
    if (step.before) { await changeRoom(step.id, step.before, step.after); usePlan.setState((s) => ({ future: s.future.slice(0, -1), past: [...s.past, step] })); }
    else {
      // refazer a criação: uma sala nova no mesmo lugar (o id muda; o passo passa a apontar para ela)
      const id = await createRoom(step.after);
      usePlan.setState((s) => ({ future: s.future.slice(0, -1), past: [...s.past, { ...step, id }] }));
    }
  } catch (e) { useStore.getState().notify((e as Error).message); }
  usePlan.setState({ busy: false });
}

async function removeCreated(id: string, rect: Rect) {
  const st = useStore.getState();
  if (useDecor.getState().items.some((it) => !it.wall && inside(it, rect))) throw new Error('A sala já tem peças de decoração: tire as peças ou remova a sala pela aba Equipe.');
  await api(`/api/offices/${st.office!.id}/rooms/${id}`, { method: 'DELETE' });
  await st.reload('rooms');
  usePlan.setState({ sel: null });
}

export const STEP = 1;
export const snap = (v: number) => Math.round(v / STEP) * STEP;
export const sameRect = (a: Rect, b: Rect) => a.x0 === b.x0 && a.z0 === b.z0 && a.x1 === b.x1 && a.z1 === b.z1;
const norm = (a: Vec2, b: Vec2): Rect => ({ x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) });

export const customRooms = () => useStore.getState().rooms;
export const nameOf = (id: string) => ROOMS.find((r) => r.id === id)?.label ?? 'A sala';
export const isBase = (id: string | null) => !!id && BASE_ROOM_IDS.includes(id);
/** Retângulo atual de qualquer sala (original ou nova). */
export function rectOf(id: string): Rect | undefined {
  if (!isBase(id)) return customRects.get(id);
  const r = ROOMS.find((x) => x.id === id);
  return r ? { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 } : undefined;
}

/** O problema da planta com essa mudança (null = pode). `id` null é a sala nova. */
export function problemWith(id: string | null, rect: Rect) {
  if (isBase(id)) return basePlanProblem(BASE_ROOM_IDS.map((b) => ({ id: b, name: nameOf(b), rect: b === id ? rect : rectOf(b)! })));
  const rooms = customRooms().filter((r) => r.id !== id).map((r) => ({ id: r.id, name: r.name, rect: customRects.get(r.id)! })).filter((r) => r.rect);
  return planProblem([...rooms, { id: id ?? 'nova', name: id ? nameOf(id) : 'A sala nova', rect }]);
}

/** Sala nova da Planta (ou a de baixo do ponto) e a borda perto dele. */
export function hitRoom(p: Vec2) {
  const M = 0.8;
  // as salas novas primeiro (ficam fora do prédio); depois as originais
  for (const r of [...customRooms(), ...BASE_ROOM_IDS.map((id) => ({ id }))]) {
    const a = rectOf(r.id);
    if (!a || p.x < a.x0 - M || p.x > a.x1 + M || p.z < a.z0 - M || p.z > a.z1 + M) continue;
    const edges = { l: Math.abs(p.x - a.x0) < M, r: Math.abs(p.x - a.x1) < M, t: Math.abs(p.z - a.z0) < M, b: Math.abs(p.z - a.z1) < M };
    const inside = p.x > a.x0 && p.x < a.x1 && p.z > a.z0 && p.z < a.z1;
    if (edges.l || edges.r || edges.t || edges.b || inside) return { id: r.id, rect: a, edges, onEdge: edges.l || edges.r || edges.t || edges.b };
  }
  return null;
}

export function startDrag(p: Vec2) {
  const hit = hitRoom(p);
  if (hit?.onEdge) usePlan.setState({ sel: hit.id, drag: { mode: 'borda', id: hit.id, edges: hit.edges, base: hit.rect, rect: hit.rect }, problem: null });
  else if (hit) usePlan.setState({ sel: hit.id, drag: { mode: 'mover', id: hit.id, start: p, base: hit.rect, rect: hit.rect }, problem: null });
  else {
    const s = { x: snap(p.x), z: snap(p.z) };
    usePlan.setState({ sel: null, drag: { mode: 'novo', start: s, rect: norm(s, s) }, problem: null });
  }
}

export function moveDrag(p: Vec2) {
  const d = usePlan.getState().drag;
  if (!d) return;
  let rect: Rect;
  if (d.mode === 'novo') rect = norm(d.start, { x: snap(p.x), z: snap(p.z) });
  else if (d.mode === 'mover') {
    const dx = snap(p.x - d.start.x), dz = snap(p.z - d.start.z);
    rect = { x0: d.base.x0 + dx, z0: d.base.z0 + dz, x1: d.base.x1 + dx, z1: d.base.z1 + dz };
  } else {
    const b = d.base, e = d.edges;
    rect = {
      x0: e.l ? Math.min(snap(p.x), b.x1 - PLAN.minW) : b.x0, x1: e.r ? Math.max(snap(p.x), b.x0 + PLAN.minW) : b.x1,
      z0: e.t ? Math.min(snap(p.z), b.z1 - PLAN.minD) : b.z0, z1: e.b ? Math.max(snap(p.z), b.z0 + PLAN.minD) : b.z1,
    };
  }
  const id = d.mode === 'novo' ? null : d.id;
  const tiny = d.mode === 'novo' && (rect.x1 - rect.x0 < 1 || rect.z1 - rect.z0 < 1);
  usePlan.setState({ drag: { ...d, rect } as PlanDrag, problem: tiny ? null : problemWith(id, rect) });
}

export async function endDrag() {
  const { drag: d, problem } = usePlan.getState();
  usePlan.setState({ drag: null });
  if (!d) return;
  const notify = useStore.getState().notify;
  if (d.mode === 'novo' && (d.rect.x1 - d.rect.x0 < 1 || d.rect.z1 - d.rect.z0 < 1)) return;
  if (d.mode !== 'novo' && sameRect(d.base, d.rect)) return;
  if (problem) { notify(problem); usePlan.setState({ problem: null }); return; }
  usePlan.setState({ busy: true });
  try {
    if (d.mode === 'novo') { const id = await createRoom(d.rect); remember({ id, before: null, after: d.rect }); }
    else { await changeRoom(d.id, d.base, d.rect); remember({ id: d.id, before: d.base, after: d.rect }); }
  } catch (e) { notify((e as Error).message); }
  usePlan.setState({ busy: false, problem: null });
}

async function createRoom(rect: Rect) {
  const st = useStore.getState();
  const n = st.rooms.length + 1;
  const room = await api<{ id: string; name: string }>(`/api/offices/${st.office!.id}/rooms`, { body: { name: `Sala nova ${n}`, emoji: '🚪', floor: '#e8e4dc', rect } });
  await st.reload('rooms');
  usePlan.setState({ sel: room.id });
  st.notify(`${room.name} criada. Troque o nome e o ícone na aba Equipe.`);
  return room.id;
}

const inside = (p: Vec2, a: Rect, pad = 0) => p.x >= a.x0 - pad && p.x <= a.x1 + pad && p.z >= a.z0 - pad && p.z <= a.z1 + pad;

/**
 * Salva o retângulo novo e leva o que é da sala junto: peças da decoração (as que ficariam de fora de uma sala
 * menor encostam na parede), paredes desenhadas e as mesas próprias dos funcionários.
 */
async function changeRoom(id: string, from: Rect, to: Rect) {
  if (isBase(id)) return changeBase(id, from, to);
  const st = useStore.getState();
  const base = `/api/offices/${st.office!.id}`;
  await api(`${base}/rooms/${id}`, { method: 'PATCH', body: { rect: to } });
  const moved = to.x1 - to.x0 === from.x1 - from.x0 && to.z1 - to.z0 === from.z1 - from.z0;
  const dx = moved ? to.x0 - from.x0 : 0, dz = moved ? to.z0 - from.z0 : 0;
  const keep = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo + 0.7), hi - 0.7);
  const shift = (p: Vec2): Vec2 => moved ? { x: p.x + dx, z: p.z + dz } : { x: keep(p.x, to.x0, to.x1), z: keep(p.z, to.z0, to.z1) };
  // decoração de chão (as de parede só existem nas paredes do fundo e da esquerda do prédio)
  const items = useDecor.getState().items;
  if (items.some((it) => !it.wall && inside(it, from))) {
    commit(items.map((it) => (!it.wall && inside(it, from) ? { ...it, ...shift(it) } : it)));
  }
  // paredes desenhadas ou pintadas dentro da sala (e nas bordas dela) vão junto quando a sala muda de lugar
  if (moved) {
    const walls = normalizeWalls(st.walls);
    const next: Record<string, WallType> = {};
    let changed = false;
    for (const [k, t] of Object.entries(walls)) {
      const m = /^([hv]):(-?[\d.]+):(-?[\d.]+)$/.exec(k);
      if (!m || !isPieceKey(k)) { next[k] = t; continue; }
      const h = m[1] === 'h', a = Number(m[2]), line = Number(m[3]);
      const mid = h ? { x: a + 0.25, z: line } : { x: line, z: a + 0.25 };
      if (!inside(mid, from, 0.01)) { next[k] = t; continue; }
      next[pieceKey(h, a + (h ? dx : dz), line + (h ? dz : dx))] = t;
      changed = true;
    }
    if (changed) await saveWalls(next);
  }
  // funcionários com mesa própria dentro da sala
  for (const a of st.agents) {
    if (a.seat && inside(a.seat, from)) await api(`${base}/agents/${a.id}`, { method: 'PATCH', body: { seat: shift(a.seat) } }).catch(() => {});
  }
  await Promise.all([st.reload('rooms'), st.reload('agents')]);
}

/**
 * Sala original em outro lugar ou tamanho: salva a planta das sete (o servidor confere) e leva junto a decoração de
 * dentro e as mesas próprias de quem senta lá. Os móveis fixos (quadro, cofre, arquivo…) o próprio mapa reposiciona.
 */
async function changeBase(id: string, from: Rect, to: Rect) {
  const st = useStore.getState();
  const base = `/api/offices/${st.office!.id}`;
  const rooms = BASE_ROOM_IDS.map((b) => ({ roomId: b, name: nameOf(b), ...(b === id ? to : rectOf(b)!) }));
  await api(`${base}/baseRooms`, { method: 'PUT', body: { rooms } });
  const items = useDecor.getState().items;
  if (items.some((it) => !it.wall && inside(it, from))) commit(items.map((it) => (!it.wall && inside(it, from) ? { ...it, ...relocate(it, from, to) } : it)));
  for (const a of st.agents) {
    if (a.seat && inside(a.seat, from)) await api(`${base}/agents/${a.id}`, { method: 'PATCH', body: { seat: relocate(a.seat, from, to) } }).catch(() => {});
  }
  await Promise.all([st.reload('baseRooms'), st.reload('agents')]);
}

/** Volta as salas originais para a planta de sempre (a decoração que foi junto fica onde está). */
export async function resetBasePlan() {
  const st = useStore.getState();
  await api(`/api/offices/${st.office!.id}/baseRooms`, { method: 'PUT', body: { rooms: [] } });
  await st.reload('baseRooms');
  usePlan.setState({ past: [], future: [], sel: null });
}
