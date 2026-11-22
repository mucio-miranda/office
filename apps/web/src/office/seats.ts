import type { DecorItem, Vec2, Worker } from '@office/shared';
import { DEF, skinOf } from './decor/catalog';
import { DESKS, DESK_DIRS, ROOMS, roomAt, roomCenter } from './layout';

/**
 * Lugares de trabalho dos funcionários de IA: a mesa padrão de cada sala e as mesas de trabalho colocadas no modo
 * Decorar (cada tipo diz onde ficam as cadeiras). Quem está trabalhando ou esperando senta numa mesa livre da
 * sala dele; sem mesa livre ali, na mais perto em outra sala. Só sem mesa nenhuma ele fica em pé ao lado.
 */
export interface Seat { key: string; x: number; z: number; dir: number; room: string | null }

/** Gira a posição da cadeira junto com a peça (rot em quartos de volta, como no modo Decorar). */
function place(it: DecorItem, s: { x: number; z: number; back?: boolean }): Seat {
  const t = (it.rot * Math.PI) / 2;
  const x = it.x + s.x * Math.cos(t) + s.z * Math.sin(t);
  const z = it.z - s.x * Math.sin(t) + s.z * Math.cos(t);
  // de frente para a mesa: quem senta na frente olha para o fundo da peça
  const dir = s.back ? t : t + Math.PI;
  return { key: `${it.id}:${s.x}:${s.z}`, x, z, dir, room: roomAt({ x, z })?.id ?? null };
}

/** Mesa fixa trocada por uma do catálogo? */
const swapped = (it: DecorItem) => !!it.as && !!DEF[it.kind]?.fixed && skinOf(it) !== DEF[it.kind];

/**
 * Onde senta o dono de uma mesa fixa trocada por uma do catálogo (a primeira cadeira dela): a pessoa da mesa ou o
 * funcionário de função da sala. Sem troca, null (vale a cadeira padrão da mesa).
 */
export function ownerSeat(it: DecorItem): { x: number; z: number; dir: number } | null {
  const first = swapped(it) ? skinOf(it)?.seats?.[0] : undefined;
  if (!first) return null;
  const s = place(it, first);
  return { x: s.x, z: s.z, dir: s.dir };
}

/** Cadeiras de uma peça para quem trabalha ou está em pausa: na mesa fixa trocada, as que sobram depois da do dono. */
const spareSeats = (it: DecorItem): Seat[] => {
  const all = skinOf(it)?.seats ?? [];
  return (swapped(it) ? all.slice(1) : all).map((s) => place(it, s));
};

/** Peças de sentar do Decorar (cadeiras, sofás, pufes…): o lugar é o meio da peça. */
export const CHAIR_KINDS = new Set(['cadeira', 'banqueta', 'poltrona', 'pufe', 'sofa', 'sofa-curvo', 'banco-jardineira', 'arquibancada']);

/** Onde a pessoa pode sentar: lugares das mesas de trabalho e peças de sentar. */
export function sittable(items: DecorItem[]): Seat[] {
  const chairs = items.filter((it) => !it.wall && CHAIR_KINDS.has(it.kind))
    .map((it): Seat => ({ key: `${it.id}:c`, x: it.x, z: it.z, dir: (it.rot * Math.PI) / 2, room: roomAt(it)?.id ?? null }));
  const desks = items.flatMap((it) => (it.wall ? [] : spareSeats(it)));
  return [...desks, ...chairs];
}

/** Lugares de uma peça (para o clique nela): os da mesa ou o da cadeira. */
export function seatsOf(it: DecorItem): Seat[] {
  if (it.wall) return [];
  if (CHAIR_KINDS.has(it.kind)) return [{ key: `${it.id}:c`, x: it.x, z: it.z, dir: (it.rot * Math.PI) / 2, room: roomAt(it)?.id ?? null }];
  return (skinOf(it)?.seats ?? []).map((s) => place(it, s));
}

export function allSeats(items: DecorItem[]): Seat[] {
  const fixed = Object.entries(DESKS).map(([room, p]): Seat => ({ key: `sala:${room}`, x: p.x, z: p.z, dir: DESK_DIRS[room] ?? Math.PI, room }));
  const decor = items.flatMap((it) => (it.wall ? [] : spareSeats(it)));
  return [...fixed, ...decor];
}

const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Cada funcionário visível (fora da copa) numa mesa. `taken` são lugares já ocupados por quem fica sempre na mesa
 * (o gerente). A ordem é estável (mais antigo primeiro), para ninguém trocar de mesa à toa quando outro chega.
 */
export function seatWorkers(workers: Worker[], items: DecorItem[], taken: Vec2[] = []): Map<string, Seat> {
  const free = allSeats(items).filter((s) => !taken.some((t) => near(t, s) < 0.4));
  const out = new Map<string, Seat>();
  const order = [...workers].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const pending: Worker[] = [];
  // primeiro: uma mesa da própria sala, a mais perto da mesa padrão dela
  for (const w of order) {
    const r = ROOMS.find((x) => x.id === w.room);
    const anchor = DESKS[w.room] ?? (r ? roomCenter(r) : null);
    const mine = free.filter((s) => s.room === w.room).sort((a, b) => (anchor ? near(a, anchor) - near(b, anchor) : 0));
    if (mine[0]) { out.set(w.id, mine[0]); free.splice(free.indexOf(mine[0]), 1); }
    else pending.push(w);
  }
  // sala cheia (ou sem mesa): a mesa livre mais perto, em qualquer sala
  for (const w of pending) {
    const r = ROOMS.find((x) => x.id === w.room);
    const anchor = DESKS[w.room] ?? (r ? roomCenter(r) : { x: 0, z: 0 });
    const best = [...free].sort((a, b) => near(a, anchor) - near(b, anchor))[0];
    if (best) { out.set(w.id, best); free.splice(free.indexOf(best), 1); }
  }
  return out;
}
