import { create } from 'zustand';
import { WALL_TYPES, type WallType } from '@office/shared';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { ROOMS, WALLS, isDivider, setWallStyles, wallTypeOf } from '../layout';
import { wallsOfRoomIn } from './wallsOfRoom';

/** Ferramenta de paredes do modo Decorar: um tipo escolhido e cada clique numa parede aplica. */
export const useWallTool = create<{ tool: WallType | null; setTool: (t: WallType | null) => void }>((set) => ({
  tool: null,
  setTool: (tool) => set({ tool }),
}));

export const WALL_LABEL: Record<WallType, string> = {
  alvenaria: 'Reboco com lambri', reboco: 'Reboco liso', branca: 'Branca', preta: 'Preta', verde: 'Verde sálvia', terracota: 'Terracota',
  concreto: 'Concreto aparente', tijolo: 'Tijolinho', azulejo: 'Azulejo metrô', madeira: 'Ripado de madeira', vidro: 'Vidro', 'vidro-fume': 'Vidro fumê', removida: 'Sem parede',
};
export const WALL_OPTIONS = WALL_TYPES;
/** Acabamentos que servem de padrão para o escritório inteiro (sem vidro nem "sem parede"). */
export const WALL_FINISHES = WALL_TYPES.filter((t) => !t.startsWith('vidro') && t !== 'removida');

/** Acabamento padrão do escritório: vale para toda parede sem escolha própria, inclusive das salas que forem criadas. */
export function setDefaultWall(type: WallType) {
  const next = { ...useStore.getState().walls };
  if (type === 'alvenaria') delete next.padrao;
  else next.padrao = type;
  return saveWalls(next);
}
export const defaultWall = (): WallType => useStore.getState().walls.padrao ?? 'alvenaria';

/** Acabamento das divisórias entre as salas (vidro, por exemplo); null volta a seguir o padrão do escritório. */
export function setDividerWall(type: WallType | null) {
  const next = { ...useStore.getState().walls };
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

export function applyWall(keys: string[], type: WallType) {
  const next = { ...useStore.getState().walls };
  // igual ao padrão do escritório: fica sem escolha própria e acompanha o padrão se ele mudar
  for (const k of keys) {
    const base = (isDivider(k) ? next.divisorias : undefined) ?? next.padrao ?? 'alvenaria';
    if (type === base) delete next[k];
    else next[k] = type;
  }
  return saveWalls(next);
}

export function wallsOfRoom(id: string) {
  const r = ROOMS.find((x) => x.id === id);
  return r ? wallsOfRoomIn(r, WALLS) : [];
}

export const removedCount = () => WALLS.filter((w) => wallTypeOf(w.key) === 'removida').length;
