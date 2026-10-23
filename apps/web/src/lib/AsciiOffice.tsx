import { useEffect, useRef } from 'react';

/**
 * Campo ASCII animado da tela de entrada: ondas de pontos ao fundo e pequenos
 * "funcionários" (peões) caminhando entre mesas. Inspirado na tela de login do
 * Paperclip (MIT), escrito do zero para o Office.
 */
const GLYPHS = [' ', ' ', ' ', ' ', '.', '·', '·', ':'];
const PAWN = [' ╭─╮ ', ' ╰┬╯ ', '╭─┴─╮', '│   │', '╰─┬─╯', '  ┴  '];
const DESK = ['┌──────┐', '│ ▢  ▫ │', '╘╤════╤╛', ' │    │ '];
const FPS = 20;

export function AsciiOffice() {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 0, rows = 0, raf = 0, last = 0, t = 0;
    let walkers: { x: number; y: number; v: number }[] = [];
    let desks: { x: number; y: number }[] = [];

    const measure = () => {
      const probe = document.createElement('span');
      probe.textContent = 'M';
      probe.style.cssText = 'position:absolute;visibility:hidden;font:11px/1 monospace;';
      el.appendChild(probe);
      const r = probe.getBoundingClientRect();
      el.removeChild(probe);
      cols = Math.ceil(el.clientWidth / Math.max(1, r.width));
      rows = Math.ceil(el.clientHeight / Math.max(1, r.height));
      desks = [];
      for (let y = 6; y < rows - 6; y += 22) for (let x = Math.floor(y / 22) % 2 ? 10 : 32; x < cols - 10; x += 46) desks.push({ x, y });
      walkers = Array.from({ length: Math.max(2, Math.round(cols / 30)) }, (_, i) => ({
        x: (i * 37) % Math.max(1, cols), y: 9 + ((i * 13) % Math.max(1, rows - 16)), v: (0.15 + (i % 3) * 0.06) * (i % 2 ? 1 : -1),
      }));
    };

    const stamp = (grid: string[][], art: readonly string[], x0: number, y0: number) => {
      art.forEach((line, dy) => [...line].forEach((ch, dx) => {
        const y = y0 + dy, x = Math.round(x0) + dx;
        if (ch !== ' ' && y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = ch;
      }));
    };

    const draw = () => {
      const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
        const v = Math.sin(c * 0.09 + t * 0.6) * Math.cos(r * 0.12 - t * 0.4) * 0.5 + Math.sin((c + r) * 0.04 + t * 0.3) * 0.25 + 0.3;
        return GLYPHS[Math.max(0, Math.min(GLYPHS.length - 1, Math.floor(v * GLYPHS.length)))];
      }));
      desks.forEach((d) => stamp(grid, DESK, d.x, d.y));
      walkers.forEach((w) => stamp(grid, PAWN, w.x, w.y));
      el.textContent = grid.map((r) => r.join('')).join('\n');
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / FPS) return;
      last = now;
      t += 1 / FPS;
      for (const w of walkers) {
        w.x += w.v;
        if (w.x > cols + 2) w.x = -6;
        if (w.x < -6) w.x = cols + 2;
      }
      draw();
    };

    const ro = new ResizeObserver(() => { measure(); draw(); });
    ro.observe(el);
    measure();
    draw();
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <pre ref={ref} className="ascii" aria-hidden />;
}
