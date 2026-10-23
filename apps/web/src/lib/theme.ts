import { create } from 'zustand';
import { desktop } from './desktop';

export type Theme = 'light' | 'dark';

const saved = (): Theme => {
  try {
    const t = localStorage.getItem('office.theme');
    if (t === 'light' || t === 'dark') return t;
  } catch { /* sem storage */ }
  return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const useTheme = create<{ theme: Theme; toggle: () => void }>((set, get) => ({
  theme: saved(),
  toggle: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('office.theme', theme); } catch { /* ok */ }
    document.documentElement.dataset.theme = theme;
    desktop?.setTheme(theme);
    set({ theme });
  },
}));
document.documentElement.dataset.theme = useTheme.getState().theme;
desktop?.setTheme(useTheme.getState().theme);

export interface ScenePalette {
  background: string; ground: string; floor: string; floorAlt: string; wall: string; wallTop: string;
  furniture: string; furnitureDark: string; surface: string; screen: string; plant: string; skin: string;
  shadow: number; hover: string;
}

/** Paleta da maquete 3D: monocromática, cor só nos avatares e no status. */
export const SCENE: Record<Theme, ScenePalette> = {
  light: {
    background: '#f4f4f5',
    ground: '#f4f4f5',
    floor: '#ffffff',
    floorAlt: '#fafafa',
    wall: '#c4c4c9',
    wallTop: '#d4d4d8',
    furniture: '#dcdce0',
    furnitureDark: '#9a9aa2',
    surface: '#f4f4f5',
    screen: '#27272a',
    plant: '#b8c4b8',
    skin: '#f4f4f5',
    shadow: 0.08,
    hover: '#2563eb',
  },
  dark: {
    background: '#0f0f10',
    ground: '#0f0f10',
    floor: '#1c1c1e',
    floorAlt: '#19191b',
    wall: '#2c2c30',
    wallTop: '#3a3a3f',
    furniture: '#333338',
    furnitureDark: '#52525b',
    surface: '#26262a',
    screen: '#0a0a0b',
    plant: '#3f4a3f',
    skin: '#d4d4d8',
    shadow: 0.35,
    hover: '#60a5fa',
  },
};
export const useScene = (): ScenePalette => SCENE[useTheme((s) => s.theme)];
