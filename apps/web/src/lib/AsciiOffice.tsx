import { useEffect, useRef } from 'react';

/**
 * Campo ASCII animado da tela de entrada. Poucos objetos de escritório (monitor, caneca, documento, balão de
 * conversa, calendário, planta) atravessam a tela devagar, aparecendo e sumindo, e deixam um rastro de pontos que se
 * desfaz sobre um fundo de ondas suaves. A ideia vem da tela de login do Paperclip (MIT); desenhos e código
 * são do Office.
 */
const GLYPHS = [' ', '.', '·', '▪', '▫', '○'];
const FPS = 24;

const SPRITES: string[][] = [
  [
    '╭──────────────────╮',
    '│ ▪▪▪▪▪▪▪▪         │',
    '│ ▪▪▪▪▪            │',
    '│ ▪▪▪▪▪▪▪▪▪▪▪      │',
    '│ ▪▪▪              │',
    '│                  │',
    '╰───────┬──┬───────╯',
    '     ───┴──┴───     ',
  ],
  [
    '   ·  ·  ·      ',
    '  ╭─────────╮   ',
    '  │         ├──╮',
    '  │   ○ ○   │  │',
    '  │         ├──╯',
    '  ╰─────────╯   ',
  ],
  [
    '╭───────────╮',
    '│ ▪▪▪▪▪▪▪   │',
    '│ ▪▪▪▪▪▪▪▪▪ │',
    '│ ▪▪▪▪      │',
    '│           │',
    '│ ▪▪▪▪▪▪▪▪  │',
    '│ ▪▪▪▪▪     │',
    '╰───────────╯',
  ],
  [
    '╭─────────────────╮',
    '│                 │',
    '│   ○    ○    ○   │',
    '│                 │',
    '╰──╮╭─────────────╯',
    '   ╰╯',
  ],
  [
    '╭──┬──────────┬──╮',
    '├──┴──────────┴──┤',
    '│ ▪  ▪  ▪  ▪  ▪  │',
    '│ ▪  ▪  ○  ▪  ▪  │',
    '│ ▪  ▪  ▪  ▪     │',
    '╰────────────────╯',
  ],
  [
    '   ○ ○ ○   ',
    '  ○ ○ ○ ○  ',
    ' ○ ○ ○ ○ ○ ',
    '   ○ ○ ○   ',
    '     │     ',
    '  ╭──┴──╮  ',
    '  │     │  ',
    '  ╰─────╯  ',
  ],
];

interface Thing { x: number; y: number; vx: number; vy: number; life: number; max: number; art: string[] }

export function AsciiOffice() {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 0, rows = 0, raf = 0, last = 0, t = 0, next = 0;
    let trail = new Float32Array(0);
    let mask: (string | null)[] = [];
    let things: Thing[] = [];

    const glyph = (v: number) => GLYPHS[Math.max(0, Math.min(GLYPHS.length - 1, Math.floor(v * GLYPHS.length)))];
    const wanted = () => Math.max(4, Math.round((cols * rows) / 1700));

    const measure = () => {
      const probe = document.createElement('span');
      probe.textContent = 'M';
      probe.style.cssText = 'position:absolute;visibility:hidden;font:11px/1 monospace;';
      el.appendChild(probe);
      const r = probe.getBoundingClientRect();
      el.removeChild(probe);
      const c = Math.ceil(el.clientWidth / Math.max(1, r.width)), rr = Math.ceil(el.clientHeight / Math.max(1, r.height));
      if (c === cols && rr === rows) return;
      cols = c; rows = rr;
      trail = new Float32Array(cols * rows);
      things = things.filter((o) => o.x < cols && o.y < rows);
    };

    /** Um objeto novo entra por uma borda e cruza a tela quase na horizontal, sem pressa. */
    const spawn = (anywhere = false) => {
      const art = SPRITES[Math.floor(Math.random() * SPRITES.length)];
      const w = art[0].length, h = art.length;
      const speed = 0.06 + Math.random() * 0.08;
      const ang = (Math.random() * 0.8 - 0.4) + (Math.random() < 0.5 ? 0 : Math.PI);
      const vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed * 0.6;
      const x = anywhere ? Math.random() * Math.max(1, cols - w) : vx > 0 ? -w + 2 : cols - 2;
      const y = Math.random() * Math.max(1, rows - h);
      const max = Math.round((cols + w) / speed);
      things.push({ x, y, vx, vy, life: anywhere ? Math.random() * max * 0.5 : 0, max, art });
    };

    /** Deixa rastro onde o desenho tem traço e, se estiver visível o bastante, desenha por cima do fundo. */
    const stamp = (o: Thing, alpha: number, ink: boolean) => {
      const x0 = Math.round(o.x), y0 = Math.round(o.y);
      o.art.forEach((line, dy) => {
        const a = line.search(/\S/);
        if (a < 0) return;
        const b = line.trimEnd().length;
        for (let dx = a; dx < b; dx++) {
          const x = x0 + dx, y = y0 + dy;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const i = y * cols + x;
          if (line[dx] !== ' ') trail[i] = Math.min(1, trail[i] + 0.12 * alpha);
          if (ink) mask[i] = line[dx];
        }
      });
    };

    const draw = () => {
      if (!cols || !rows) { el.textContent = ''; return; }
      mask = new Array(cols * rows).fill(null);
      for (const o of things) {
        const alpha = Math.sin(Math.PI * Math.min(1, o.life / o.max));
        stamp(o, alpha, alpha > 0.3);
      }
      let out = '';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const m = mask[i];
          if (m !== null) { out += m; continue; }
          const wave = Math.sin(c * 0.06 + t * 0.3) + Math.sin(r * 0.1 - t * 0.2) + Math.sin((c + r) * 0.035 + t * 0.15);
          // pontilhado fixo por célula: as bordas das ondas se desfazem em vez de formar manchas chapadas
          const g = Math.sin(c * 127.1 + r * 311.7) * 43758.5453, grain = g - Math.floor(g) - 0.5;
          const ambient = wave * 0.06 + 0.13 + grain * 0.16;
          out += glyph(ambient + trail[i] * 0.8);
        }
        if (r < rows - 1) out += '\n';
      }
      el.textContent = out;
    };

    const step = () => {
      t += 1 / FPS;
      for (let i = 0; i < trail.length; i++) trail[i] *= 0.95;
      for (const o of things) { o.x += o.vx; o.y += o.vy; o.life++; }
      things = things.filter((o) => o.life < o.max && o.x > -20 && o.x < cols + 4 && o.y > -12 && o.y < rows + 4);
      if (things.length < wanted() && t > next) { spawn(); next = t + 1.2 + Math.random() * 2; }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || now - last < 1000 / FPS) return;
      last = now;
      step();
      draw();
    };

    const ro = new ResizeObserver(() => { measure(); draw(); });
    ro.observe(el);
    measure();
    for (let i = 0; i < wanted(); i++) spawn(true);
    // o rastro já começa formado, mesmo com a animação desligada
    for (let i = 0; i < 90; i++) step();
    draw();
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <pre ref={ref} className="ascii" aria-hidden />;
}
