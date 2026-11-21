import { create } from 'zustand';

/**
 * Câmera do escritório: giro livre e altura. Ctrl + arrastar gira para os lados e sobe/desce a câmera; Q (Shift+Q)
 * e os botões giram de 90 em 90; PageUp/PageDown e os botões sobem e descem; "vista padrão" volta ao de sempre.
 * As paredes de longe sobem inteiras e as de perto ficam baixas, conforme o lado mais perto do giro. O ângulo e a
 * altura ficam lembrados neste navegador.
 */
export const DEFAULT_ANGLE = Math.PI / 4;
const STEP = Math.PI / 2;
const KEY = 'office.viewAngle';
const KEY_ELEV = 'office.viewElev';
const OLD_KEY = 'office.viewQuarter';
/** Altura da câmera em relação à padrão (1 = a de sempre; menor = mais rasante; maior = mais de cima). */
export const ELEV_MIN = 0.45, ELEV_MAX = 2.6;

const read = (k: string) => { try { const v = localStorage.getItem(k); return v === null ? null : Number(v); } catch { return null; } };
const loadAngle = () => {
  const a = read(KEY);
  if (a !== null && Number.isFinite(a)) return a;
  const q = read(OLD_KEY);
  return DEFAULT_ANGLE + (q !== null && Number.isInteger(q) ? q : 0) * STEP;
};
const loadElev = () => { const e = read(KEY_ELEV); return e !== null && Number.isFinite(e) ? Math.min(ELEV_MAX, Math.max(ELEV_MIN, e)) : 1; };

/** Ângulo e altura-alvo (a câmera anima até eles) e se o giro está sendo arrastado agora. */
export const viewRot = { target: loadAngle(), dragging: false, elev: loadElev(), elevTarget: loadElev() };

export const quarterOf = (angle: number) => ((Math.round((angle - DEFAULT_ANGLE) / STEP) % 4) + 4) % 4;
/** Lado mais perto do giro atual (muda quais paredes sobem e quais decorações de parede aparecem). */
export const useView = create<{ quarter: number }>(() => ({ quarter: quarterOf(loadAngle()) }));

const save = () => { try { localStorage.setItem(KEY, String(viewRot.target)); localStorage.setItem(KEY_ELEV, String(viewRot.elevTarget)); } catch { /* sem armazenamento */ } };

/** Encaixa no lado mais perto (Q e os botões giram de lado em lado). */
export function snapView(angle: number) {
  viewRot.target = DEFAULT_ANGLE + Math.round((angle - DEFAULT_ANGLE) / STEP) * STEP;
  save();
}

/** Fica no ângulo em que soltou (giro livre). */
export function holdView(angle: number) { viewRot.target = angle; save(); }

/** Gira um lado (1 = sentido horário na tela, -1 = anti-horário), partindo do lado mais perto. */
export function rotateView(steps: number) { snapView(viewRot.target + steps * STEP); }

/** Sobe (positivo) ou desce (negativo) a câmera; `k` multiplica a altura atual. */
export function tiltView(k: number) {
  viewRot.elevTarget = Math.min(ELEV_MAX, Math.max(ELEV_MIN, viewRot.elevTarget * k));
  save();
}
export function setElev(e: number) { viewRot.elevTarget = Math.min(ELEV_MAX, Math.max(ELEV_MIN, e)); save(); }

/** Volta ao lado e à altura de sempre (o modo Decorar trabalha neles). */
export function resetView() { viewRot.target = DEFAULT_ANGLE + Math.round((viewRot.target - DEFAULT_ANGLE) / (2 * Math.PI)) * 2 * Math.PI; viewRot.elevTarget = 1; save(); }

/** Lados do prédio longe da câmera (as paredes deles sobem inteiras). */
export function farSides(quarter = useView.getState().quarter) {
  const a = DEFAULT_ANGLE + quarter * STEP;
  return { z0: Math.sin(a) > 0, z1: Math.sin(a) < 0, x0: Math.cos(a) > 0, x1: Math.cos(a) < 0 };
}
