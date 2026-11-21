import type { DecorItem, Vec2, Worker } from '@office/shared';
import { DEF } from './decor/catalog';
import { DOOR_ZONES, FURNITURE, ROOMS, blocked } from './layout';

/**
 * Rotina dos funcionários dos clientes no mapa:
 * - trabalhando ou esperando você: sentado numa mesa;
 * - até 3 h sem trabalho: continua na mesa, parado;
 * - de 3 h a 12 h: vai andando passar o tempo: joga pebolim, sinuca ou pingue-pongue, senta no sofá (a sala de cinema
 *   vira uma copa), pega um café, ou fica num canto livre da copa; prefere onde já tem alguém e troca de vez em quando;
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

/** Um lugar para passar o tempo: onde fica, para onde olha, se senta e se mexe as mãos (jogando). */
export interface IdleSpot extends Vec2 { key: string; group: string; dir: number; seated: boolean; play: boolean }

/** Pontos livres da copa, espaçados (nada de amontoado): longe de móveis, paredes e portas. */
export function copaSpots(): IdleSpot[] {
  const r = ROOMS.find((x) => x.id === 'copa');
  if (!r) return [];
  const out: IdleSpot[] = [];
  const inDoor = (p: Vec2) => DOOR_ZONES.some((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1);
  let i = 0;
  for (let z = r.z0 + 1.6; z < r.z1 - 1.2; z += 1.9)
    for (let x = r.x0 + 1.4; x < r.x1 - 1.2; x += 1.9) {
      const p = { x, z };
      if (blocked(p) || inDoor(p) || [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].some(([dx, dz]) => blocked({ x: x + dx, z: z + dz }))) continue;
      out.push({ ...p, key: `copa:${i++}`, group: 'copa', dir: Math.PI / 4 + i, seated: false, play: false });
    }
  return out;
}

/** Lugares dos objetos: jogos, sofás, mesas da copa, máquina de lanches e a cafeteira (café em grupo). */
export function leisureSpots(items: DecorItem[]): IdleSpot[] {
  const out: IdleSpot[] = [];
  for (const it of items) {
    const spots = !it.wall && DEF[it.kind]?.spots;
    if (!spots) continue;
    const t = (it.rot * Math.PI) / 2;
    spots.forEach((s, i) => {
      const x = it.x + s.x * Math.cos(t) + s.z * Math.sin(t);
      const z = it.z - s.x * Math.sin(t) + s.z * Math.cos(t);
      const dir = s.face !== undefined ? t + s.face : Math.atan2(it.x - x, it.z - z);
      out.push({ x, z, key: `${it.id}:${i}`, group: it.id, dir, seated: !!s.seat, play: !!s.play });
    });
  }
  // a cafeteira da copa: até três tomando café juntos, de frente para o balcão
  for (const f of FURNITURE.filter((x) => x.kind === 'cafeteira'))
    [-0.8, 0, 0.8].forEach((dx, i) => out.push({ x: f.x + dx, z: f.z + 1.3, key: `cafe:${f.x}:${i}`, group: `cafe:${f.x}`, dir: Math.PI, seated: false, play: false }));
  return out;
}

/** Qual lugar é de quem (dois nunca no mesmo). */
const claims = new Map<string, string>();
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * O lugar de passar o tempo deste funcionário. Sem `reroll`, mantém o que já tem; com `reroll`, escolhe outro livre,
 * preferindo objetos onde já tem alguém (para jogar ou tomar café junto) e os objetos à copa vazia.
 */
export function idleSpot(id: string, spots: IdleSpot[], reroll = false): IdleSpot | null {
  if (!spots.length) return null;
  const mine = claims.get(id);
  const cur = spots.find((s) => s.key === mine);
  if (!reroll && cur) return cur;
  const taken = new Set([...claims.entries()].filter(([k]) => k !== id).map(([, v]) => v));
  const busyGroups = new Set(spots.filter((s) => taken.has(s.key)).map((s) => s.group));
  const free = spots.filter((s) => !taken.has(s.key) && s.key !== mine);
  if (!free.length) return cur ?? spots[hash(id) % spots.length];
  // sorteio com peso: companhia vale mais, objeto vale mais que canto vazio
  const weight = (s: IdleSpot) => 1 + (busyGroups.has(s.group) ? 3 : 0) + (s.group !== 'copa' ? 1.5 : 0);
  const total = free.reduce((n, s) => n + weight(s), 0);
  let roll = reroll ? Math.random() * total : (hash(id) % 1000) / 1000 * total;
  let pick = free[0];
  for (const s of free) { roll -= weight(s); if (roll <= 0) { pick = s; break; } }
  claims.set(id, pick.key);
  return pick;
}

export const releaseIdleSpot = (id: string) => claims.delete(id);
