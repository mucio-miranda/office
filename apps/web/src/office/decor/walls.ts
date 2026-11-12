import { create } from 'zustand';
import { WALL_TYPES, type Vec2, type WallType } from '@office/shared';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { ROOMS, WALLS, baseStyle, canSetPiece, lineKeys, normalizeWalls, setWallStyles, styleOf, wallTypeOf } from '../layout';
import { wallsOfRoomIn } from './wallsOfRoom';

/**
 * Ferramenta de paredes do modo Decorar. Três jeitos de usar:
 * - pintar: clicar num trecho troca o acabamento dele (os pedaços vizinhos do mesmo acabamento);
 * - desenhar: arrastar pelo chão cria parede pedaço por pedaço (meio metro) na linha da grade;
 * - apagar: arrastar por cima tira só os pedaços por onde passou.
 */
export type WallMode = 'pintar' | 'desenhar' | 'apagar';
export const useWallTool = create<{
  tool: WallType | null; mode: WallMode; setTool: (t: WallType | null) => void; setMode: (m: WallMode) => void;
}>((set) => ({
  tool: null,
  mode: 'pintar',
  setTool: (tool) => set({ tool }),
  setMode: (mode) => set({ mode }),
}));

/** Arraste em andamento: de onde começou e os pedaços que vai mudar (a prévia no mapa). */
export const useWallDrag = create<{ start: Vec2 | null; keys: string[] }>(() => ({ start: null, keys: [] }));

export const WALL_LABEL: Record<WallType, string> = {
  alvenaria: 'Reboco com lambri', reboco: 'Reboco liso', branca: 'Branca', preta: 'Preta', verde: 'Verde sálvia', terracota: 'Terracota',
  concreto: 'Concreto aparente', tijolo: 'Tijolinho', azulejo: 'Azulejo metrô', madeira: 'Ripado de madeira', vidro: 'Vidro', 'vidro-fume': 'Vidro fumê', removida: 'Sem parede',
};
export const WALL_OPTIONS = WALL_TYPES;
/** Acabamentos que servem de padrão para o escritório inteiro (sem vidro nem "sem parede"). */
export const WALL_FINISHES = WALL_TYPES.filter((t) => !t.startsWith('vidro') && t !== 'removida');

/** Acabamento padrão do escritório: vale para toda parede sem escolha própria, inclusive das salas que forem criadas. */
export function setDefaultWall(type: WallType) {
  const next = normalizeWalls(useStore.getState().walls);
  if (type === 'alvenaria') delete next.padrao;
  else next.padrao = type;
  return saveWalls(next);
}
export const defaultWall = (): WallType => useStore.getState().walls.padrao ?? 'alvenaria';

/** Acabamento das divisórias entre as salas (vidro, por exemplo); null volta a seguir o padrão do escritório. */
export function setDividerWall(type: WallType | null) {
  const next = normalizeWalls(useStore.getState().walls);
  if (!type) delete next.divisorias;
  else next.divisorias = type;
  return saveWalls(next);
}
export const dividerWall = (): WallType | null => useStore.getState().walls.divisorias ?? null;

/** Salva no servidor; o mapa muda na hora, e a colisão junto (parede removida deixa passar). */
export async function saveWalls(next: Record<string, WallType>) {
  const st = useStore.getState();
  if (!st.office) return;
  setWallStyles(next);
  useStore.setState({ walls: next });
  try {
    await api(`/api/offices/${st.office.id}/walls`, { method: 'PUT', body: next });
  } catch (e) {
    st.notify((e as Error).message);
    st.reload('walls');
  }
}

/**
 * Troca o acabamento dos pedaços. Igual à planta-base, o pedaço fica sem escolha própria (acompanha os padrões);
 * fora do prédio não desenha, e parede de fora não some.
 */
export function applyWall(keys: string[], type: WallType) {
  const next = normalizeWalls(useStore.getState().walls);
  let changed = false;
  for (const k of keys) {
    if (!canSetPiece(k, type) || styleOf(next, k) === type) continue;
    if (type === baseStyle(next, k)) delete next[k];
    else next[k] = type;
    changed = true;
  }
  return changed ? saveWalls(next) : undefined;
}

/** Pedaços que um arraste de `s` até `p` muda, já sem os que não podem (fora do prédio, parede externa, iguais). */
export function dragKeys(s: Vec2, p: Vec2, mode: WallMode, tool: WallType) {
  const type = mode === 'apagar' ? 'removida' : tool;
  const walls = useStore.getState().walls;
  return lineKeys(s, p).filter((k) => canSetPiece(k, type) && styleOf(walls, k) !== type);
}

export function wallsOfRoom(id: string) {
  const r = ROOMS.find((x) => x.id === id);
  return r ? wallsOfRoomIn(r, WALLS) : [];
}

export const removedCount = () => WALLS.filter((w) => wallTypeOf(w.key) === 'removida').length;
