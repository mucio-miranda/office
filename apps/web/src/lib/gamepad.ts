import { create } from 'zustand';

/**
 * Controle de videogame (Xbox, PlayStation e genéricos): o Chromium entrega todos no layout padrão, então o mapa
 * dos botões é um só; o que muda é o desenho do botão nas dicas da tela. O mundo lê os analógicos a cada quadro
 * (`pad`); os botões viram ações pelo `startGamepad`. Mexeu no mouse ou no teclado, as dicas somem.
 */
export type PadKind = 'xbox' | 'playstation';
export const usePad = create<{ active: boolean; kind: PadKind; name: string }>(() => ({ active: false, kind: 'xbox', name: '' }));

/** Analógicos e gatilhos já com zona morta (de -1 a 1; gatilhos de 0 a 1). */
export const pad = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, run: false };

/** Botões no layout padrão (iguais no Xbox e no PlayStation). */
export const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
export type PadButton = keyof typeof B;

const kindOf = (id: string): PadKind => (/054c|playstation|dualshock|dualsense|ps[345]|wireless controller/i.test(id) ? 'playstation' : 'xbox');

const DEAD = 0.18;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/** Vibração curta (quando um funcionário precisa de você, por exemplo). */
export function rumble(ms = 180, strong = 0.5) {
  for (const gp of navigator.getGamepads?.() ?? []) {
    const act = (gp as any)?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: strong * 0.7 }).catch?.(() => {});
  }
}

/**
 * Lê o controle a cada quadro e chama `onPress` quando um botão é apertado (o direcional repete se ficar segurado).
 * Devolve a função que para a leitura.
 */
export function startGamepad(onPress: (b: PadButton) => void) {
  let raf = 0;
  const was = new Map<number, number>();
  const names = Object.keys(B) as PadButton[];
  const repeatable = new Set<number>([B.UP, B.DOWN, B.LEFT, B.RIGHT]);
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    const gp = [...(navigator.getGamepads?.() ?? [])].find((g) => g && g.connected);
    if (!gp) { pad.lx = pad.ly = pad.rx = pad.ry = pad.lt = pad.rt = 0; return; }
    const ax = gp.axes;
    pad.lx = dz(ax[0] ?? 0); pad.ly = dz(ax[1] ?? 0); pad.rx = dz(ax[2] ?? 0); pad.ry = dz(ax[3] ?? 0);
    pad.lt = gp.buttons[B.LT]?.value ?? 0; pad.rt = gp.buttons[B.RT]?.value ?? 0;
    pad.run = !!gp.buttons[B.LS]?.pressed || Math.hypot(pad.lx, pad.ly) > 0.97;
    let used = Math.abs(pad.lx) + Math.abs(pad.ly) + Math.abs(pad.rx) + Math.abs(pad.ry) + pad.lt + pad.rt > 0.05;
    gp.buttons.forEach((btn, i) => {
      if (!btn.pressed) { was.delete(i); return; }
      used = true;
      const since = was.get(i);
      if (since === undefined) { was.set(i, t); if (names[i]) onPress(names[i]); return; }
      // segurando o direcional: repete depois de 350 ms, a cada 110 ms
      if (repeatable.has(i) && t - since > 350) { was.set(i, t - 350 + 110); onPress(names[i]); }
    });
    if (used) {
      const s = usePad.getState();
      const kind = kindOf(gp.id);
      if (!s.active || s.kind !== kind) usePad.setState({ active: true, kind, name: gp.id });
    }
  };
  raf = requestAnimationFrame(loop);
  // mouse ou teclado de volta: as dicas do controle saem da tela
  let lastMove = 0;
  const off = (e: Event) => {
    if (!usePad.getState().active) return;
    if (e.type === 'mousemove') { const now = performance.now(); if (now - lastMove < 60) return; lastMove = now; if (Math.abs((e as MouseEvent).movementX) + Math.abs((e as MouseEvent).movementY) < 6) return; }
    if (e instanceof KeyboardEvent && !e.isTrusted) return;
    usePad.setState({ active: false });
  };
  addEventListener('mousemove', off);
  addEventListener('keydown', off);
  addEventListener('mousedown', off);
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('mousemove', off);
    removeEventListener('keydown', off);
    removeEventListener('mousedown', off);
  };
}

/** Manda uma tecla para o elemento com foco (a busca e as listas já sabem tratar setas, Enter e Esc). */
export function sendKey(key: string) {
  const el = (document.activeElement as HTMLElement | null) ?? document.body;
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

/**
 * Direcional nos painéis: vai para o elemento clicável mais perto na direção apertada (dentro de `root`). Prefere
 * o que está alinhado com o atual; o escolhido ganha foco visível e entra na tela.
 */
export function moveFocus(dir: 'up' | 'down' | 'left' | 'right', root: HTMLElement | null = document.querySelector('.main')) {
  if (!root) return;
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
  if (!all.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !root.contains(cur) || cur === document.body) { all[0].focus(); all[0].scrollIntoView({ block: 'nearest' }); return; }
  const a = cur.getBoundingClientRect();
  const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const el of all) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const dx = c.x - ac.x, dy = c.y - ac.y;
    const main = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    if (main <= 4) continue;
    const side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = main + side * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}
