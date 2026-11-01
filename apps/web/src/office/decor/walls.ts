import { create } from 'zustand';
import { WALL_TYPES, type WallType } from '@office/shared';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { ROOMS, WALLS, setWallStyles, wallTypeOf } from '../layout';
import { wallsOfRoomIn } from './wallsOfRoom';

/** Ferramenta de paredes do modo Decorar: um tipo escolhido e cada clique numa parede aplica. */
export const useWallTool = create<{ tool: WallType | null; setTool: (t: WallType | null) => void }>((set) => ({
  tool: null,
  setTool: (tool) => set({ tool }),
}));

export const WALL_LABEL: Record<WallType, string> = {
  alvenaria: 'Padrão', branca: 'Branca', preta: 'Preta', concreto: 'Concreto', madeira: 'Madeira', vidro: 'Vidro', 'vidro-fume': 'Vidro fumê', removida: 'Sem parede',
};
export const WALL_OPTIONS = WALL_TYPES;

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
  for (const k of keys) {
    if (type === 'alvenaria') delete next[k];
    else next[k] = type;
  }
  return saveWalls(next);
}

export function wallsOfRoom(id: string) {
  const r = ROOMS.find((x) => x.id === id);
  return r ? wallsOfRoomIn(r, WALLS) : [];
}

export const removedCount = () => WALLS.filter((w) => wallTypeOf(w.key) === 'removida').length;
