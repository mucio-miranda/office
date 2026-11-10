import { create } from 'zustand';
import { desktop } from './desktop';

/** Temas da interface. O mundo 3D usa a base clara ou escura de cada um (`baseOf`). */
export type Theme = 'light' | 'dark' | 'ultradark' | 'glass';
export type BaseTheme = 'light' | 'dark';
export const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'light', label: 'Claro', hint: 'Neutro e limpo' },
  { id: 'dark', label: 'Escuro', hint: 'Cinza grafite' },
  { id: 'ultradark', label: 'Ultradark', hint: 'Preto puro, para telas OLED e salas escuras' },
  { id: 'glass', label: 'Vidro', hint: 'Glassmorphism: painéis translúcidos sobre cor' },
];
export const baseOf = (t: Theme): BaseTheme => (t === 'dark' || t === 'ultradark' ? 'dark' : 'light');

const saved = (): Theme => {
  try {
    const t = localStorage.getItem('office.theme');
    if (THEMES.some((x) => x.id === t)) return t as Theme;
  } catch { /* sem storage */ }
  return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  desktop?.setTheme(baseOf(theme));
};

export const useTheme = create<{ theme: Theme; set: (t: Theme) => void; toggle: () => void }>((set, get) => ({
  theme: saved(),
  set: (theme) => {
    try { localStorage.setItem('office.theme', theme); } catch { /* ok */ }
    apply(theme);
    set({ theme });
  },
  /** Atalho antigo: alterna entre claro e escuro. */
  toggle: () => get().set(baseOf(get().theme) === 'dark' ? 'light' : 'dark'),
}));
apply(useTheme.getState().theme);

export interface ScenePalette {
  background: string; ground: string; floor: string; floorAlt: string; wall: string; wallTop: string;
  furniture: string; furnitureDark: string; surface: string; screen: string; plant: string; skin: string;
  shadow: number; hover: string;
}

/** Paleta da maquete 3D: monocromática, cor só nos avatares e no status. */
const SCENE_BASE: Record<BaseTheme, ScenePalette> = {
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
export const SCENE: Record<Theme, ScenePalette> = {
  ...SCENE_BASE,
  ultradark: { ...SCENE_BASE.dark, background: '#000000', ground: '#000000', floor: '#0d0d0e', floorAlt: '#0a0a0b', shadow: 0.5 },
  glass: SCENE_BASE.light,
};
export const useScene = (): ScenePalette => SCENE[useTheme((s) => s.theme)];

// ---------------------------------------------------------------- estilo do mundo

/**
 * Estilo do mundo. Hoje só existe o isométrico em pixel art: a maquete minimalista saiu da interface (v0.11.7).
 * O tipo continua para as próximas skins (texturas e estilos de mundo) entrarem aqui.
 */
export type WorldStyle = 'pixel' | 'maquete';

export const useWorldStyle = create<{ style: WorldStyle; toggle: () => void }>(() => ({
  style: 'pixel',
  toggle: () => { /* uma skin só, por enquanto */ },
}));
// os rótulos do mundo (HTML por cima do canvas) mudam de estilo junto
document.documentElement.dataset.world = useWorldStyle.getState().style;

/** Paleta do mundo em pixel art: cores quentes e saturadas, à noite um pouco mais escuras. */
export interface PixelPalette {
  void: string; slab: string; slabEdge: string; outline: string;
  wall: string; wallStripe: string; wallTop: string; baseboard: string;
  wood: string; woodDark: string; metal: string; screen: string; screenGlow: string;
  fabric: string; fabricAlt: string; plant: string; plantDark: string; pot: string; paper: string;
  skin: string; hair: string; pants: string; shoes: string;
  floors: Record<string, [string, string]>;
  shadow: number;
}

const PIXEL_BASE: Record<BaseTheme, PixelPalette> = {
  light: {
    void: '#2b2a35', slab: '#6b4b2e', slabEdge: '#4a321d', outline: '#1d1720',
    wall: '#d9c7a8', wallStripe: '#cdb894', wallTop: '#8c6a45', baseboard: '#6b4b2e',
    wood: '#b9824e', woodDark: '#8a5a33', metal: '#9aa3ad', screen: '#22303f', screenGlow: '#7fd3ff',
    fabric: '#d64545', fabricAlt: '#3f7fd6', plant: '#4caf50', plantDark: '#2e7d32', pot: '#c8643b', paper: '#f4efe4',
    skin: '#f2c49b', hair: '#4a2f1e', pants: '#2f3b55', shoes: '#1f1f26',
    floors: {
      recepcao: ['#dcb98a', '#cfa877'],
      gerencia: ['#5b7fb8', '#4f72a8'],
      video: ['#3b3550', '#332d47'],
      design: ['#c7a6e0', '#b996d6'],
      copy: ['#8fcfb3', '#7ec2a4'],
      reuniao: ['#b84a4a', '#a64040'],
      copa: ['#efe6d2', '#d9cdb2'],
    },
    shadow: 0.22,
  },
  dark: {
    void: '#14131b', slab: '#4a3420', slabEdge: '#2f2014', outline: '#0b090e',
    wall: '#8f8270', wallStripe: '#857763', wallTop: '#5b4430', baseboard: '#46311d',
    wood: '#8f6440', woodDark: '#6a4528', metal: '#6f7780', screen: '#141d27', screenGlow: '#5fc4ff',
    fabric: '#a83a3a', fabricAlt: '#3462a8', plant: '#3b8a3f', plantDark: '#245e27', pot: '#9a4d2d', paper: '#cfc8bb',
    skin: '#d9ac85', hair: '#3a2417', pants: '#252e44', shoes: '#16161c',
    floors: {
      recepcao: ['#9c8060', '#8f7454'],
      gerencia: ['#3f5884', '#374e76'],
      video: ['#2a2539', '#231f31'],
      design: ['#8c74a0', '#7f6893'],
      copy: ['#5f8f7b', '#53816e'],
      reuniao: ['#843636', '#762f2f'],
      copa: ['#aaa392', '#958e7d'],
    },
    shadow: 0.35,
  },
};
export const PIXEL: Record<Theme, PixelPalette> = {
  ...PIXEL_BASE,
  ultradark: { ...PIXEL_BASE.dark, void: '#000000', outline: '#000000', shadow: 0.45 },
  glass: PIXEL_BASE.light,
};
export const usePixel = (): PixelPalette => PIXEL[useTheme((s) => s.theme)];
