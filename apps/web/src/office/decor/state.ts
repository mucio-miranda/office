import { create } from 'zustand';
import { uid, type DecorItem } from '@office/shared';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import {
  BOUNDS, DESKS, DOOR_ZONES, FURNITURE, FURN_BOX, HUMAN_DESKS, SPAWN, WALL_BOXES, deskSeat, roomAt, setDecorSolids, type Box,
} from '../layout';
import { DEF, footprint, type DecorDef } from './catalog';

/** Face de dentro das paredes do fundo, onde encostam os itens de parede. */
export const BACK_Z = BOUNDS.z0 + 0.08;
export const LEFT_X = BOUNDS.x0 + 0.08;
/** Altura das paredes do fundo (Room). */
export const WALL_TOP = 2.6;

let n = 0;
const F = (kind: string, x: number, z: number, rot = 0, color?: string): DecorItem => ({ id: `p${++n}`, kind, x, z, rot, ...(color ? { color } : {}) });
const W = (kind: string, along: number, wall: 'fundo' | 'esquerda', color?: string): DecorItem => ({
  id: `p${++n}`, kind, rot: 0, wall, x: wall === 'fundo' ? along : LEFT_X, z: wall === 'fundo' ? BACK_Z : along, ...(color ? { color } : {}),
});

/**
 * Decoração com que todo escritório começa (dá para mudar tudo no modo Decorar). Recepção biofílica (árvore
 * no meio com sofás orgânicos em volta, bancos com jardineira, divisória verde e plantas suspensas); copa com
 * tijolinho e neon, pebolim e mesa bistrô; redação com cabine acústica; reunião com arquibancada e pendentes.
 */
export const DEFAULT_DECOR: DecorItem[] = [
  // recepção
  F('tapete-grande', 0, 5, 0, '#8aa67a'), F('tapete-redondo', 0, 9.3, 0, '#c9b79c'),
  F('arvore', 0, 9.3),
  F('sofa-curvo', -3.6, 8.9, 1), F('sofa-curvo', 3.6, 8.9, 3, '#c9b79c'),
  F('plantas-suspensas', -3.9, 8.9), F('plantas-suspensas', 3.9, 8.9),
  F('banco-jardineira', -3.6, 11.4, 2), F('banco-jardineira', 3.6, 11.4, 2),
  F('costela', -5.35, 11.35), F('palmeira', 5.2, 11.2),
  F('divisoria-verde', -4.4, 2.4), F('bebedouro', -5.4, 0.6),
  F('pufe', -5.3, 7.9, 0, '#e9c46a'),
  // gerência
  F('tapete-grande', 0.45, -6.2, 0, '#3f7fd6'),
  F('estante', -5.4, -10.2, 1), F('planta', 5.2, -2.8), F('poltrona', -4.6, -3.6, 1, '#2a9d8f'),
  W('quadro-arte', 4.9, 'fundo', '#118ab2'), W('ar-condicionado', 4.9, 'fundo'),
  // copa
  ...[8, 10, 12, 14, 16].map((x) => W('tijolinho', x, 'fundo')),
  W('neon-cafe', 12.4, 'fundo'),
  F('geladeira', 17.2, -11.3), F('maquina-lanches', 7, -11.3),
  F('pebolim', 16.2, -7, 1), F('mesa-bistro', 8.6, -7.6), F('pendente', 8.6, -7.6, 0, '#e63946'),
  F('planta', 17.2, -2.8), F('bar-cereais', 15.6, -3.0, 2),
  // ilha de vídeo
  F('tripe-ring', 7.4, -0.9), F('luminaria', 17, -1.2), F('softbox', 17.2, 4.2),
  // design
  F('estante', 17.6, 8.5, 3), F('planta', 7, 11.2), F('cavalete', 8.3, 6.4),
  F('pufe', 16.6, 11.2, 0, '#ff4fd8'), F('cacto', 12.6, 11.4),
  // redação
  W('janela', -15, 'fundo'), W('janela', -9, 'fundo'), W('relogio', -12, 'fundo'),
  W('janela', -10.5, 'esquerda'), W('janela', -3.5, 'esquerda'), W('musgo', -7, 'esquerda'),
  F('estante', -17.6, -7, 1), F('planta', -7, -11.2), F('cabine', -7.1, -3.1, 3),
  // reunião
  W('neon-crie', 0.3, 'esquerda', '#ff4fd8'), W('janela', 9.5, 'esquerda'),
  F('arquibancada', -16.6, 0.3, 1, '#9b5cff'),
  F('pendente', -13.8, 5), F('pendente', -10.2, 5),
  F('planta', -17.2, 11.2), F('luminaria-arco', -7.4, 11.2),
].filter((it) => DEF[it.kind]);

// ---------------------------------------------------------------- geometria

export const itemBox = (it: DecorItem, d: DecorDef = DEF[it.kind]): Box => {
  const [w, dd] = footprint(d, it.rot);
  return { x0: it.x - w / 2, z0: it.z - dd / 2, x1: it.x + w / 2, z1: it.z + dd / 2 };
};
/** Intervalo ocupado na parede: posição ao longo dela (a) e altura (y). */
const wallSpan = (it: DecorItem, d: DecorDef) => {
  const along = it.wall === 'fundo' ? it.x : it.z;
  return { a0: along - d.size[0] / 2, a1: along + d.size[0] / 2, y0: (d.y ?? 1.5) - d.size[1] / 2, y1: (d.y ?? 1.5) + d.size[1] / 2 };
};
const overlap = (a: Box, b: Box, m = 0) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m;

/** Onde as pessoas sentam e entram: nenhum móvel pode ficar em cima. */
const SEATS = [...Object.values(DESKS), ...HUMAN_DESKS.map(deskSeat), SPAWN].map((s) => ({ x0: s.x - 0.35, x1: s.x + 0.35, z0: s.z - 0.35, z1: s.z + 0.35 }));
/** Móveis fixos, com a cadeira das mesas e as da mesa de reunião. */
const FIXED: Box[] = FURNITURE.filter((f) => f.solid).map((f) => {
  const b = FURN_BOX(f);
  if (f.kind === 'mesa') return { ...b, z1: b.z1 + 0.85 };
  if (f.kind === 'mesa-reuniao') return { ...b, z0: b.z0 - 0.75, z1: b.z1 + 0.75 };
  return b;
});
/** Itens fixos nas paredes do fundo (quadro de demandas, calendário, TV da reunião) e os encontros com as paredes internas. */
type WallSpan = { wall: 'fundo' | 'esquerda'; a0: number; a1: number };
const FIXED_WALL: WallSpan[] = [
  ...FURNITURE.filter((f) => ['quadro', 'calendario', 'tv'].includes(f.kind)).flatMap((f): WallSpan[] => {
    const w = f.w ?? (f.kind === 'calendario' ? 1.1 : 3);
    if (Math.abs(f.z - BOUNDS.z0) < 0.3) return [{ wall: 'fundo', a0: f.x - w / 2, a1: f.x + w / 2 }];
    if (Math.abs(f.x - BOUNDS.x0) < 0.3) return [{ wall: 'esquerda', a0: f.z - w / 2, a1: f.z + w / 2 }];
    return [];
  }),
  { wall: 'fundo', a0: -6.15, a1: -5.85 }, { wall: 'fundo', a0: 5.85, a1: 6.15 }, { wall: 'esquerda', a0: -2.15, a1: -1.85 },
];

/** A peça cabe ali? (dentro do prédio, fora das paredes, portas, assentos e de outras peças). */
export function fits(it: DecorItem, items: DecorItem[]) {
  const d = DEF[it.kind];
  if (!d) return false;
  if (d.place === 'sala') return !!roomAt(it);
  if (d.place === 'parede') {
    if (!it.wall) return false;
    const s = wallSpan(it, d);
    const len = it.wall === 'fundo' ? [BOUNDS.x0, BOUNDS.x1] : [BOUNDS.z0, BOUNDS.z1];
    if (s.a0 < len[0] + 0.1 || s.a1 > len[1] - 0.1 || s.y0 < -0.01 || s.y1 > WALL_TOP + 0.01) return false;
    if (d.cover) return true;
    if (FIXED_WALL.some((f) => f.wall === it.wall && s.a0 < f.a1 && s.a1 > f.a0)) return false;
    return !items.some((o) => {
      const od = DEF[o.kind];
      if (o.id === it.id || !od || od.place !== 'parede' || od.cover || o.wall !== it.wall) return false;
      const os = wallSpan(o, od);
      return s.a0 < os.a1 - 0.02 && s.a1 > os.a0 + 0.02 && s.y0 < os.y1 - 0.02 && s.y1 > os.y0 + 0.02;
    });
  }
  const b = itemBox(it, d);
  if (b.x0 < BOUNDS.x0 + 0.06 || b.x1 > BOUNDS.x1 - 0.06 || b.z0 < BOUNDS.z0 + 0.06 || b.z1 > BOUNDS.z1 - 0.06) return false;
  if (d.place === 'alto') return true;
  if (WALL_BOXES.some((w) => overlap(b, w))) return false;
  if (d.place === 'piso') return true;
  if (FIXED.some((f) => overlap(b, f, 0.02)) || DOOR_ZONES.some((z) => overlap(b, z)) || SEATS.some((s) => overlap(b, s))) return false;
  return !items.some((o) => {
    const od = DEF[o.kind];
    return o.id !== it.id && od?.place === 'chao' && overlap(b, itemBox(o, od), 0.02);
  });
}

// ---------------------------------------------------------------- estado do modo Decorar

export interface Placing { kind: string; rot: number; color?: string }

interface DecorState {
  /** Itens em uso (o rascunho local enquanto há alterações para salvar). */
  items: DecorItem[];
  editing: boolean;
  catalogOpen: boolean;
  sel: string | null;
  /** Peça nova vindo do catálogo (segue o cursor até o clique). */
  placing: Placing | null;
  /** Prévia da posição: da peça nova ou da que está sendo arrastada. */
  ghost: DecorItem | null;
  ghostOk: boolean;
  past: DecorItem[][];
  future: DecorItem[][];
  saving: 'salvo' | 'salvando' | 'erro';
  /** Miniaturas do catálogo (data URL por tipo). */
  thumbs: Record<string, string>;
}

export const useDecor = create<DecorState>(() => ({
  items: DEFAULT_DECOR, editing: false, catalogOpen: true, sel: null, placing: null, ghost: null, ghostOk: false,
  past: [], future: [], saving: 'salvo', thumbs: {},
}));

const solidsOf = (items: DecorItem[]) => items.filter((it) => DEF[it.kind]?.place === 'chao').map((it) => itemBox(it));
setDecorSolids(solidsOf(DEFAULT_DECOR));
useDecor.subscribe((s, prev) => { if (s.items !== prev.items) setDecorSolids(solidsOf(s.items)); });

/** Alterações ainda não confirmadas pelo servidor: enquanto houver, a recarga do servidor não pisa no rascunho. */
let pending = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

useStore.subscribe((s, prev) => {
  if (s.layout !== prev.layout && pending === 0) useDecor.setState({ items: s.layout ?? DEFAULT_DECOR });
  if (s.office?.id !== prev.office?.id) useDecor.setState({ editing: false, sel: null, placing: null, ghost: null, past: [], future: [] });
});

async function save(items: DecorItem[] | null) {
  const o = useStore.getState().office;
  if (!o) return;
  useDecor.setState({ saving: 'salvando' });
  try {
    await api(`/api/offices/${o.id}/layout`, { method: 'PUT', body: { items } });
    useDecor.setState({ saving: 'salvo' });
  } catch (e) {
    useDecor.setState({ saving: 'erro' });
    useStore.getState().notify(`Não deu para salvar a decoração: ${(e as Error).message}`);
  } finally {
    pending = Math.max(0, pending - 1);
  }
}

/** Troca a decoração (guarda o passo para desfazer) e salva no servidor logo depois. */
export function commit(items: DecorItem[]) {
  const s = useDecor.getState();
  useDecor.setState({ items, past: [...s.past.slice(-60), s.items], future: [] });
  queueSave();
}

function queueSave() {
  if (!saveTimer) pending++;
  clearTimeout(saveTimer);
  useDecor.setState({ saving: 'salvando' });
  saveTimer = setTimeout(() => { saveTimer = undefined; save(useDecor.getState().items); }, 600);
}

export function undo() {
  const s = useDecor.getState();
  const prev = s.past.at(-1);
  if (!prev) return;
  useDecor.setState({ items: prev, past: s.past.slice(0, -1), future: [s.items, ...s.future], sel: null });
  queueSave();
}

export function redo() {
  const s = useDecor.getState();
  const next = s.future[0];
  if (!next) return;
  useDecor.setState({ items: next, past: [...s.past, s.items], future: s.future.slice(1), sel: null });
  queueSave();
}

/** Piso escolhido para cada sala (o da prévia por cima, enquanto o mouse passa com um piso na mão). */
export function roomFloors(items: DecorItem[], ghost: DecorItem | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const it of ghost ? [...items, ghost] : items) {
    if (DEF[it.kind]?.place !== 'sala') continue;
    const room = roomAt(it)?.id;
    if (!room) continue;
    if (it.kind === 'piso-original') delete out[room];
    else out[room] = it.kind.slice('piso-'.length);
  }
  return out;
}

/** Volta à decoração padrão do Office (dá para desfazer). */
export function restoreDefault() {
  const s = useDecor.getState();
  clearTimeout(saveTimer);
  if (saveTimer) { saveTimer = undefined; pending = Math.max(0, pending - 1); }
  pending++;
  useDecor.setState({ items: DEFAULT_DECOR, past: [...s.past, s.items], future: [], sel: null });
  save(null);
}

export const canDecorate = () => {
  const o = useStore.getState().office;
  return !!o && o.role !== 'convidado';
};

export function setEditing(on: boolean) {
  if (on && !canDecorate()) return useStore.getState().notify('Convidados não mudam a decoração.');
  useDecor.setState({ editing: on, sel: null, placing: null, ghost: null });
  if (on) useStore.setState({ panel: null, panelArg: null });
}

export const selected = () => {
  const s = useDecor.getState();
  return s.items.find((i) => i.id === s.sel) ?? null;
};

export function updateItem(id: string, patch: Partial<DecorItem>) {
  const s = useDecor.getState();
  const it = s.items.find((i) => i.id === id);
  if (!it) return false;
  const next = { ...it, ...patch };
  if (!fits(next, s.items)) return false;
  commit(s.items.map((i) => (i.id === id ? next : i)));
  return true;
}

export function rotateSelected() {
  const s = useDecor.getState();
  if (s.placing) {
    const placing = { ...s.placing, rot: (s.placing.rot + 1) % 4 };
    const ghost = s.ghost ? { ...s.ghost, rot: placing.rot } : null;
    useDecor.setState({ placing, ghost, ghostOk: ghost ? fits(ghost, s.items) : false });
    return;
  }
  const it = selected();
  if (!it || DEF[it.kind]?.place === 'parede') return;
  for (let k = 1; k < 4; k++) if (updateItem(it.id, { rot: (it.rot + k) % 4 })) return;
  useStore.getState().notify('Sem espaço para girar aqui.');
}

export function removeSelected() {
  const s = useDecor.getState();
  if (!s.sel) return;
  commit(s.items.filter((i) => i.id !== s.sel));
  useDecor.setState({ sel: null });
}

/** Pega uma peça nova do catálogo (ou duplica a selecionada) para posicionar com o mouse. */
export function startPlacing(kind: string, color?: string, rot = 0) {
  useDecor.setState({ placing: { kind, rot, color }, sel: null, ghost: null, ghostOk: false });
}

export function duplicateSelected() {
  const it = selected();
  if (it) startPlacing(it.kind, it.color, it.rot);
}

/** Coloca a peça nova onde está a prévia. Shift mantém a peça na mão para pôr outra igual. */
export function placeGhost(keep: boolean) {
  const s = useDecor.getState();
  if (!s.placing || !s.ghost || !s.ghostOk) return false;
  const it: DecorItem = { ...s.ghost, id: uid() };
  if (DEF[it.kind]?.place === 'sala') {
    // um piso por sala; o "original" só tira a troca
    const room = roomAt(it)?.id;
    const rest = s.items.filter((o) => !(DEF[o.kind]?.place === 'sala' && roomAt(o)?.id === room));
    commit(it.kind === 'piso-original' ? rest : [...rest, it]);
    useDecor.setState(keep ? { ghost: null } : { ghost: null });
    return true;
  }
  commit([...s.items, it]);
  useDecor.setState(keep ? { ghost: null } : { placing: null, ghost: null, sel: it.id });
  return true;
}
