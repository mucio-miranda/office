import { create } from 'zustand';
import { openPadPicker } from './PadPicker';

/**
 * Controle de videogame (Xbox, PlayStation e genéricos): o Chromium entrega todos no layout padrão, então o mapa
 * dos botões é um só; o que muda é o desenho do botão nas dicas da tela. O mundo lê os analógicos a cada quadro
 * (`pad`); os botões viram ações pelo `startGamepad`. Mexeu no mouse ou no teclado, as dicas somem.
 */
export type PadKind = 'xbox' | 'playstation';
export const usePad = create<{ active: boolean; kind: PadKind; name: string; standard: boolean; mouse: boolean }>(() => ({ active: false, kind: 'xbox', name: '', standard: true, mouse: false }));

/** Analógicos e gatilhos já com zona morta (de -1 a 1; gatilhos de 0 a 1). */
export const pad = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, run: false, lbSince: 0, rbSince: 0 };
/** Segurando LB/RB há mais disto, gira livre (toque rápido gira 90°). */
export const HOLD_MS = 260;

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
export function startGamepad(onPress: (b: PadButton) => void, onRelease?: (b: PadButton, heldMs: number) => void) {
  let raf = 0;
  const was = new Map<number, number>();
  /** quando cada botão começou a ser apertado (para saber se foi toque ou segurada) */
  const first = new Map<number, number>();
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
    pad.lbSince = gp.buttons[B.LB]?.pressed ? (pad.lbSince || t) : 0;
    pad.rbSince = gp.buttons[B.RB]?.pressed ? (pad.rbSince || t) : 0;
    gp.buttons.forEach((btn, i) => {
      if (!btn.pressed) {
        const since = first.get(i);
        if (since !== undefined) { first.delete(i); if (names[i]) onRelease?.(names[i], t - since); }
        was.delete(i);
        return;
      }
      if (!first.has(i)) first.set(i, t);
      used = true;
      const since = was.get(i);
      if (since === undefined) { was.set(i, t); if (names[i]) onPress(names[i]); return; }
      // segurando o direcional: repete depois de 350 ms, a cada 110 ms
      if (repeatable.has(i) && t - since > 350) { was.set(i, t - 350 + 110); onPress(names[i]); }
    });
    if (used) {
      const s = usePad.getState();
      const kind = kindOf(gp.id);
      // sem o layout padrão (alguns controles genéricos), os botões podem vir trocados: a dica avisa
      const standard = gp.mapping === 'standard';
      if (!s.active || s.kind !== kind || s.standard !== standard) usePad.setState({ active: true, kind, name: gp.id, standard });
    }
  };
  raf = requestAnimationFrame(loop);
  // mouse ou teclado de volta: as dicas do controle saem da tela
  let lastMove = 0;
  const off = (e: Event) => {
    // eventos criados pelo próprio controle (modo mouse) não contam como mouse de verdade
    if (!e.isTrusted || !usePad.getState().active) return;
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

/**
 * Cursor do controle nos painéis: o analógico esquerdo move uma seta na tela (o navegador não deixa mexer no mouse
 * de verdade). O item clicável embaixo dela fica marcado e o A clica nele. Some depois de uns segundos parado ou
 * quando o direcional volta a andar pelo foco.
 */
const CLICKABLE = 'button, a[href], summary, select, label, input, textarea, [role="button"], [role="tab"], [role="option"], [tabindex]:not([tabindex="-1"])';
export const padCursor = { x: innerWidth / 2, y: innerHeight / 2, shownAt: 0, el: null as HTMLDivElement | null, hover: null as HTMLElement | null };

const cursorEl = () => {
  if (!padCursor.el) {
    padCursor.el = document.createElement('div');
    padCursor.el.className = 'pad-cursor';
    padCursor.el.style.opacity = '0';
    document.body.appendChild(padCursor.el);
  }
  return padCursor.el;
};

/** Move a seta (dx, dy em pixels) e marca o item clicável embaixo dela. */
export function movePadCursor(dx: number, dy: number) {
  const el = cursorEl();
  padCursor.x = Math.min(innerWidth - 4, Math.max(2, padCursor.x + dx));
  padCursor.y = Math.min(innerHeight - 4, Math.max(2, padCursor.y + dy));
  padCursor.shownAt = performance.now();
  el.style.transform = `translate(${padCursor.x}px, ${padCursor.y}px)`;
  el.style.left = '0'; el.style.top = '0';
  el.style.opacity = '1';
  const under = (document.elementFromPoint(padCursor.x, padCursor.y) as HTMLElement | null)?.closest<HTMLElement>(CLICKABLE) ?? null;
  if (under !== padCursor.hover) { padCursor.hover?.classList.remove('pad-hover'); under?.classList.add('pad-hover'); padCursor.hover = under; }
}

export const padCursorOn = () => performance.now() - padCursor.shownAt < 4000;

export function hidePadCursor() {
  padCursor.shownAt = 0;
  if (padCursor.el) padCursor.el.style.opacity = '0';
  padCursor.hover?.classList.remove('pad-hover');
  padCursor.hover = null;
}

/**
 * Modo mouse do controle: a seta vale como um mouse de verdade. A aperta (pointerdown), mover com A apertado arrasta
 * (pointermove) e soltar solta (pointerup + click), no elemento embaixo da seta: serve para o mapa (canvas), o Decorar
 * (mover peças, salas, desenhar paredes) e qualquer tela.
 */
let pressTarget: Element | null = null;
const fire = (target: Element, type: string, Ctor: typeof PointerEvent | typeof MouseEvent) => {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: padCursor.x, clientY: padCursor.y, button: 0, buttons: type.endsWith('up') || type === 'click' ? 0 : 1, pointerId: 77, pointerType: 'mouse', isPrimary: true, view: window };
  target.dispatchEvent(new Ctor(type, init as any));
};
export function padPointerDown() {
  const t = document.elementFromPoint(padCursor.x, padCursor.y);
  if (!t) return;
  pressTarget = t;
  padCursor.shownAt = performance.now();
  fire(t, 'pointerdown', PointerEvent);
  fire(t, 'mousedown', MouseEvent);
  if (t instanceof HTMLElement && t.matches('input, textarea, select, [contenteditable="true"]')) t.focus();
}
export function padPointerMove() {
  const t = pressTarget ?? document.elementFromPoint(padCursor.x, padCursor.y);
  if (!t) return;
  fire(t, 'pointermove', PointerEvent);
  if (pressTarget) fire(t, 'mousemove', MouseEvent);
}
export function padPointerUp() {
  const t = pressTarget ?? document.elementFromPoint(padCursor.x, padCursor.y);
  const under = document.elementFromPoint(padCursor.x, padCursor.y);
  pressTarget = null;
  if (!t) return;
  fire(t, 'pointerup', PointerEvent);
  fire(t, 'mouseup', MouseEvent);
  // clique só se soltou em cima do mesmo lugar (como o mouse)
  if (under && (under === t || t.contains(under) || under.contains(t))) {
    fire(under, 'click', MouseEvent);
    // seletor, data, cor...: o clique simulado não abre o menu nativo, então abre a lista do Office
    padActivate(under);
  }
}
export const padPressing = () => !!pressTarget;

/** Manda uma tecla para o elemento com foco (a busca e as listas já sabem tratar setas, Enter e Esc). */
export function sendKey(key: string) {
  const el = (document.activeElement as HTMLElement | null) ?? document.body;
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

const visible = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };

/** Janela por cima (diálogo, popover) que prende o foco: a de cima de todas, se houver. */
export function topLayer(): HTMLElement | null {
  const layers = [...document.querySelectorAll<HTMLElement>('.modal-bg .modal, .modal-bg, [role="dialog"]')].filter(visible);
  return layers.at(-1) ?? null;
}

/** B com uma janela por cima: fecha ela (clique no fundo escuro ou Esc), em vez do painel inteiro. Devolve se fechou algo. */
export function closeTopLayer() {
  const layer = topLayer();
  if (!layer) return false;
  const bg = layer.closest<HTMLElement>('.modal-bg') ?? (layer.classList.contains('modal-bg') ? layer : null);
  if (bg) bg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  else layer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return true;
}

/* ---------- campos que o Chromium só abre com clique de verdade: seletor, data, hora, mês, cor, arquivo ---------- */

const PICKABLE = 'select, input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"], input[type="color"], input[type="file"]';
/** O campo com menu nativo em (ou em volta de) um elemento, se houver. */
export const pickableOf = (el: Element | null) => (el?.closest(PICKABLE) as HTMLInputElement | HTMLSelectElement | null) ?? null;

/** Troca o valor como se a pessoa tivesse escolhido: o React só vê a mudança pelo setter nativo e pelos eventos. */
function setValue(el: HTMLInputElement | HTMLSelectElement, v: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayOf = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (s: string, n: number) => { const d = dayOf(s); d.setDate(d.getDate() + n); return isoDay(d); };
const addMonths = (s: string, n: number) => { const [y, m] = s.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dayLabel = (s: string) => { const d = dayOf(s); const t = isoDay(new Date()); const rel = s === t ? ' · hoje' : s === addDays(t, 1) ? ' · amanhã' : ''; return `${WEEK[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}${d.getFullYear() !== new Date().getFullYear() ? `/${d.getFullYear()}` : ''}${rel}`; };
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fromMin = (n: number) => `${pad2(Math.floor(((n % 1440) + 1440) % 1440 / 60))}:${pad2(((n % 60) + 60) % 60)}`;
const COLORS = ['#ffffff', '#000000', '#1f1f1f', '#7a7a7a', '#ff5c8a', '#e5484d', '#ff7a45', '#ffb020', '#f5d90a', '#22c3a6', '#3fae49', '#3fa7ff', '#3b82f6', '#7c5cff', '#9b5de5', '#8b5a2b'];

const dayItems = (base: string) => {
  const today = isoDay(new Date());
  const start = addDays(base < today ? base : today, -7);
  return Array.from({ length: 75 }, (_, i) => { const v = addDays(start, i); return { label: dayLabel(v), value: v }; });
};
const timeItems = () => Array.from({ length: 48 }, (_, i) => { const v = fromMin(i * 30); return { label: v, value: v }; });
/** horário da lista mais perto do atual (a lista anda de meia em meia hora) */
const nearTime = (t: string) => fromMin(Math.round(toMin(t || '09:00') / 30) * 30);

/**
 * A do controle num desses campos: abre a lista de opções do Office no lugar do menu nativo.
 * Devolve se era um desses campos.
 */
export function padActivate(target: Element | null) {
  const el = pickableOf(target);
  if (!el || el.disabled) return false;
  // título: o rótulo do campo, só o texto dele (sem as opções que ficam dentro do <label>)
  const label = el.closest('label');
  const own = label ? [...label.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').trim() : '';
  const title = (el.getAttribute('aria-label') || own || el.getAttribute('title') || '').slice(0, 60);
  if (el instanceof HTMLSelectElement) {
    openPadPicker({
      title: title || 'Escolher', current: el.value,
      items: [...el.options].filter((o) => !o.hidden).map((o) => ({ label: o.label || o.text, value: o.value, disabled: o.disabled })),
      onPick: (v) => setValue(el, v),
    });
    return true;
  }
  const today = isoDay(new Date());
  switch (el.type) {
    case 'date': {
      const base = el.value || today;
      openPadPicker({ title: title || 'Dia', current: el.value || today, items: [...dayItems(base), ...(el.required ? [] : [{ label: 'Sem data', value: '' }])], onPick: (v) => setValue(el, v) });
      return true;
    }
    case 'time':
      openPadPicker({ title: title || 'Horário', current: nearTime(el.value), items: timeItems(), onPick: (v) => setValue(el, v) });
      return true;
    case 'datetime-local': {
      const [d0, t0] = (el.value || `${today}T09:00`).split('T');
      openPadPicker({
        title: title || 'Dia', current: d0, items: dayItems(d0),
        onPick: (d) => setTimeout(() => openPadPicker({ title: `${dayLabel(d)}: horário`, current: nearTime(t0), items: timeItems(), onPick: (t) => setValue(el, `${d}T${t}`) }), 0),
      });
      return true;
    }
    case 'month': {
      const base = el.value || today.slice(0, 7);
      const items = Array.from({ length: 25 }, (_, i) => { const v = addMonths(base, i - 12); const [y, m] = v.split('-').map(Number); return { label: `${MONTHS[m - 1]} ${y}`, value: v }; });
      openPadPicker({ title: title || 'Mês', current: base, items, onPick: (v) => setValue(el, v) });
      return true;
    }
    case 'color': {
      const cur = el.value.toLowerCase();
      const items = [...(COLORS.includes(cur) ? [] : [cur]), ...COLORS].map((c) => ({ label: c, value: c, swatch: c }));
      openPadPicker({ title: title || 'Cor', current: cur, items, onPick: (v) => setValue(el, v) });
      return true;
    }
    case 'file':
      openPadPicker({
        title: 'Escolher arquivo', note: 'A janela de arquivos do Windows não funciona com o controle. Use o mouse, ou arraste o arquivo para esta tela.',
        items: [{ label: 'Entendi', value: '' }], onPick: () => {},
      });
      return true;
  }
  return false;
}

/**
 * Direcional para os lados num campo com foco: troca a opção do seletor, um dia na data, um mês no mês e meia hora no
 * horário (o React vê como se a pessoa tivesse escolhido). Devolve se havia um campo desses.
 */
export function stepField(delta: number) {
  const el = document.activeElement;
  if (el instanceof HTMLSelectElement) {
    if (el.disabled) return false;
    let i = el.selectedIndex;
    do i += delta; while (i >= 0 && i < el.options.length && el.options[i].disabled);
    if (i >= 0 && i < el.options.length && i !== el.selectedIndex) setValue(el, el.options[i].value);
    return true;
  }
  if (!(el instanceof HTMLInputElement) || el.disabled) return false;
  const today = isoDay(new Date());
  if (el.type === 'date') { setValue(el, addDays(el.value || today, el.value ? delta : 0)); return true; }
  if (el.type === 'month') { setValue(el, addMonths(el.value || today.slice(0, 7), el.value ? delta : 0)); return true; }
  if (el.type === 'time') { setValue(el, fromMin(toMin(nearTime(el.value)) + (el.value ? delta * 30 : 0))); return true; }
  if (el.type === 'datetime-local') { const [d, t] = (el.value || `${today}T09:00`).split('T'); setValue(el, `${el.value ? addDays(d, delta) : d}T${t.slice(0, 5)}`); return true; }
  return false;
}

/**
 * A nos painéis: clica no que está sob a seta (ou no foco), abre a lista nos campos com menu nativo e, se for o segundo
 * A em seguida no mesmo lugar, manda também o clique duplo. Devolve o elemento clicado.
 */
let lastPress = { t: 0, el: null as Element | null };
export let pressedEl: Element | null = null;
export function padPress(focusEl: HTMLElement | null, typingNow: boolean) {
  let target: HTMLElement | null = null;
  if (padCursorOn()) {
    target = (document.elementFromPoint(padCursor.x, padCursor.y) as HTMLElement | null)?.closest<HTMLElement>(CLICKABLE) ?? null;
    padCursor.shownAt = performance.now();
    if (!target) return null;
  } else if (focusEl && focusEl !== document.body && (!typingNow || pickableOf(focusEl))) target = focusEl;
  if (!target) return null;
  pressedEl = target;
  if (pickableOf(target)) { target.focus({ preventScroll: true }); padActivate(target); return target; }
  if (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(target.type) || target instanceof HTMLTextAreaElement) { target.focus(); return target; }
  target.focus({ preventScroll: true });
  target.click();
  const now = performance.now();
  if (lastPress.el === target && now - lastPress.t < 400) {
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
    lastPress = { t: 0, el: null };
  } else lastPress = { t: now, el: target };
  return target;
}

/** A segurado (meio segundo ou mais) nos painéis: o "botão direito" no que foi apertado. */
export const LONG_PRESS_MS = 550;
export function padContextMenu() {
  const el = pressedEl;
  pressedEl = null;
  if (!el || !el.isConnected) return;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2 }));
}

/** Rola a área com rolagem em volta do foco (ou a maior da página) pelo analógico direito. */
export function scrollFocusArea(dy: number) {
  let el = document.activeElement as HTMLElement | null;
  const scrolls = (x: HTMLElement) => { const o = getComputedStyle(x).overflowY; return (o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight + 2; };
  while (el && el !== document.body && !scrolls(el)) el = el.parentElement;
  if (!el || el === document.body) {
    const root = topLayer() ?? document.querySelector<HTMLElement>('.main');
    el = [...(root?.querySelectorAll<HTMLElement>('*') ?? [])].filter((x) => visible(x) && scrolls(x)).sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] ?? null;
  }
  el?.scrollBy({ top: dy });
}

/**
 * Direcional nos painéis: vai para o elemento clicável mais perto na direção apertada. Com uma janela por cima, fica
 * dentro dela; senão anda pela página e, saindo pela esquerda, entra na barra lateral (e volta pela direita).
 */
export function moveFocus(dir: 'up' | 'down' | 'left' | 'right') {
  const layer = topLayer();
  const main = document.querySelector<HTMLElement>('.main'), side = document.querySelector<HTMLElement>('.sidebar');
  const cur0 = document.activeElement as HTMLElement | null;
  const inSide = !!(side && cur0 && side.contains(cur0));
  const roots = layer ? [layer] : inSide ? (dir === 'right' ? [side, main] : [side]) : dir === 'left' ? [main, side] : [main];
  for (const root of roots) if (root && focusIn(dir, root)) return;
}

function focusIn(dir: 'up' | 'down' | 'left' | 'right', root: HTMLElement) {
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
  if (!all.length) return false;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur === document.body || !root.contains(cur)) {
    // entrando na área: o item mais perto na direção certa a partir de onde o foco estava (ou o primeiro da área)
    if (cur && cur !== document.body) {
      const a = cur.getBoundingClientRect();
      const ahead = all.filter((el) => { const r = el.getBoundingClientRect(); return dir === 'left' ? r.right <= a.left + 4 : dir === 'right' ? r.left >= a.right - 4 : true; });
      const pick = ahead.sort((x, y) => Math.abs(x.getBoundingClientRect().top - a.top) - Math.abs(y.getBoundingClientRect().top - a.top))[0];
      if (!pick) return false;
      pick.focus({ preventScroll: true }); pick.scrollIntoView({ block: 'nearest' });
      return true;
    }
    all[0].focus(); all[0].scrollIntoView({ block: 'nearest' });
    return true;
  }
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
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true; }
  return false;
}
