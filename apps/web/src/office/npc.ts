import type { Vec2, Worker } from '@office/shared';
import { DOOR_ZONES, ROOMS, blocked } from './layout';

/**
 * Rotina dos funcionários dos clientes no mapa:
 * - trabalhando ou esperando você: sentado numa mesa;
 * - até 3 h sem trabalho: continua na mesa, parado;
 * - de 3 h a 12 h: vai andando para a copa e circula por ela como NPC, cada um num canto, trocando de lugar de vez em quando;
 * - depois de 12 h: sai do mapa e entra no contador da copa (some de vez depois de 24 h, como antes).
 */
export type Phase = 'mesa' | 'copa' | 'fora';
export const DESK_LINGER_H = 3;
export const COPA_H = 12;
const H = 3_600_000;

export function workerPhase(w: Worker, now = Date.now()): Phase {
  if (w.archivedAt) return 'fora';
  if (w.state !== 'copa') return 'mesa';
  const idle = now - Date.parse(w.lastJobAt ?? w.createdAt);
  if (idle < DESK_LINGER_H * H) return 'mesa';
  if (idle < COPA_H * H) return 'copa';
  return 'fora';
}

/** Pontos livres da copa, espaçados (nada de amontoado): longe de móveis, paredes e portas. */
export function copaSpots(): Vec2[] {
  const r = ROOMS.find((x) => x.id === 'copa');
  if (!r) return [];
  const out: Vec2[] = [];
  const inDoor = (p: Vec2) => DOOR_ZONES.some((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1);
  for (let z = r.z0 + 1.6; z < r.z1 - 1.2; z += 1.9)
    for (let x = r.x0 + 1.4; x < r.x1 - 1.2; x += 1.9) {
      const p = { x, z };
      // folga em volta: o boneco precisa caber parado ali sem encostar em nada
      if (blocked(p) || inDoor(p) || [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].some(([dx, dz]) => blocked({ x: x + dx, z: z + dz }))) continue;
      out.push(p);
    }
  return out;
}

/** Qual ponto da copa é de quem (dois nunca no mesmo). */
const claims = new Map<string, number>();
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** O ponto da copa deste funcionário; `reroll` escolhe outro livre (para ele circular). */
export function copaSpot(id: string, spots: Vec2[], reroll = false): Vec2 | null {
  if (!spots.length) return null;
  const mine = claims.get(id);
  if (!reroll && mine !== undefined && mine < spots.length) return spots[mine];
  const taken = new Set([...claims.entries()].filter(([k]) => k !== id).map(([, v]) => v));
  const free = spots.map((_, i) => i).filter((i) => !taken.has(i) && i !== mine);
  const pick = free.length
    ? free[reroll ? Math.floor(Math.random() * free.length) : hash(id) % free.length]
    : hash(id) % spots.length;
  claims.set(id, pick);
  return spots[pick];
}

export const releaseCopaSpot = (id: string) => claims.delete(id);
