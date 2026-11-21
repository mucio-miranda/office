import { create } from 'zustand';

/**
 * Giro do escritório. A câmera fica sempre na diagonal (isométrico), em quatro lados: girar com Ctrl + arrastar
 * (solta e encaixa no lado mais perto), Q (Shift+Q para o outro lado) ou os botões da tela. As paredes de longe
 * sobem inteiras e as de perto ficam baixas, em qualquer lado; o lado escolhido fica lembrado neste navegador.
 */
export const DEFAULT_ANGLE = Math.PI / 4;
const STEP = Math.PI / 2;
const KEY = 'office.viewQuarter';

const load = () => { try { const q = Number(localStorage.getItem(KEY)); return Number.isInteger(q) ? ((q % 4) + 4) % 4 : 0; } catch { return 0; } };

/** Ângulo-alvo (a câmera anima até ele) e se o giro está sendo arrastado agora. */
export const viewRot = { target: DEFAULT_ANGLE + load() * STEP, dragging: false };

/** Lado atual (0 a 3): muda quais paredes sobem e quais decorações de parede aparecem. */
export const useView = create<{ quarter: number }>(() => ({ quarter: load() }));

export const quarterOf = (angle: number) => ((Math.round((angle - DEFAULT_ANGLE) / STEP) % 4) + 4) % 4;

/** Encaixa no lado mais perto e lembra. */
export function snapView(angle: number) {
  const k = Math.round((angle - DEFAULT_ANGLE) / STEP);
  viewRot.target = DEFAULT_ANGLE + k * STEP;
  try { localStorage.setItem(KEY, String(((k % 4) + 4) % 4)); } catch { /* sem armazenamento */ }
}

/** Gira um lado (1 = sentido horário na tela, -1 = anti-horário). */
export function rotateView(steps: number) {
  snapView(viewRot.target + steps * STEP);
}

/** Volta ao lado de sempre (o modo Decorar trabalha nele: a decoração de parede fica no fundo e na esquerda). */
export function resetView() { snapView(DEFAULT_ANGLE); }

/** Lados do prédio longe da câmera (as paredes deles sobem inteiras). */
export function farSides(quarter = useView.getState().quarter) {
  const a = DEFAULT_ANGLE + quarter * STEP;
  return { z0: Math.sin(a) > 0, z1: Math.sin(a) < 0, x0: Math.cos(a) > 0, x1: Math.cos(a) < 0 };
}
