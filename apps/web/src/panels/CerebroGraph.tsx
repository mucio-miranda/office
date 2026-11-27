import { useEffect, useRef } from 'react';

/**
 * Grafo do cérebro no estilo do Obsidian: bolinhas por nota, linhas pelos [[links]], cor dos grupos do próprio cofre,
 * tamanho pelo número de ligações. Arrasta para mover, roda o mouse para aproximar, clica para abrir a nota.
 * Simulação de forças simples (sem biblioteca): ~500 notas assentam em poucos segundos e a animação para.
 */
export interface GraphNode { id: string; title: string; color: string | null; dim: boolean }

interface Sim { x: number; y: number; vx: number; vy: number; deg: number; n: GraphNode }

export function CerebroGraph({ nodes, edges, selected, onOpen }: {
  nodes: GraphNode[]; edges: [string, string][]; selected: string | null; onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ sims: Map<string, Sim>; view: { x: number; y: number; k: number }; hover: string | null; heat: number; dirty: boolean }>({
    sims: new Map(), view: { x: 0, y: 0, k: 1 }, hover: null, heat: 1, dirty: true,
  });
  const props = useRef({ nodes, edges, selected, onOpen });
  props.current = { nodes, edges, selected, onOpen };
  state.current.dirty = true;

  // posições continuam entre filtros: só nota nova ganha lugar novo
  useEffect(() => {
    const s = state.current;
    const keep = new Map<string, Sim>();
    const deg = new Map<string, number>();
    for (const [a, b] of edges) { deg.set(a, (deg.get(a) ?? 0) + 1); deg.set(b, (deg.get(b) ?? 0) + 1); }
    nodes.forEach((n, i) => {
      const old = s.sims.get(n.id);
      const a = i * 2.399963, r = 14 * Math.sqrt(i + 1);
      keep.set(n.id, old ? { ...old, n, deg: deg.get(n.id) ?? 0 } : { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, deg: deg.get(n.id) ?? 0, n });
    });
    s.sims = keep;
    s.heat = 1;
  }, [nodes, edges]);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const s = state.current;
    let raf = 0;
    let drag: { id: string | null; x: number; y: number; moved: boolean } | null = null;
    const css = getComputedStyle(canvas);
    // cores do tema lidas uma vez por quadro (não por linha: são mais de mil)
    let fgC = '#888', mutedC = '#999';
    const fg = () => fgC, muted = () => mutedC;
    const radius = (m: Sim) => 3 + Math.min(14, Math.sqrt(m.deg) * 1.6);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * devicePixelRatio;
      canvas.height = r.height * devicePixelRatio;
      s.dirty = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const toWorld = (cx: number, cy: number) => {
      const r = canvas.getBoundingClientRect();
      return { x: (cx - r.left - r.width / 2 - s.view.x) / s.view.k, y: (cy - r.top - r.height / 2 - s.view.y) / s.view.k };
    };
    const hit = (cx: number, cy: number) => {
      const p = toWorld(cx, cy);
      let best: string | null = null, bd = Infinity;
      for (const [id, m] of s.sims) {
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < radius(m) + 4 / s.view.k && d < bd) { bd = d; best = id; }
      }
      return best;
    };

    const tick = () => {
      const sims = [...s.sims.values()];
      if (s.heat <= 0.01 && !s.dirty) { raf = requestAnimationFrame(tick); return; }
      s.dirty = false;
      fgC = css.getPropertyValue('--foreground').trim() || '#888';
      mutedC = css.getPropertyValue('--muted-foreground').trim() || '#999';
      if (s.heat > 0.01) {
        const alpha = s.heat;
        // repulsão entre todas (n² serve para algumas centenas de notas)
        for (let i = 0; i < sims.length; i++) {
          const a = sims[i];
          for (let j = i + 1; j < sims.length; j++) {
            const b = sims[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.25; }
            if (d2 > 90000) continue;
            const f = (30 * alpha) / d2;
            a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
          }
        }
        // molas nos links
        for (const [ia, ib] of props.current.edges) {
          const a = s.sims.get(ia), b = s.sims.get(ib);
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const f = ((d - 60) / d) * 0.04 * alpha;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
        for (const m of sims) {
          if (drag?.id === m.n.id) continue;
          m.vx -= m.x * 0.004 * alpha; m.vy -= m.y * 0.004 * alpha; // gravidade para o centro
          m.vx *= 0.6; m.vy *= 0.6;
          // trava de velocidade: nenhuma nota dispara para longe
          const v = Math.hypot(m.vx, m.vy);
          if (v > 12) { m.vx *= 12 / v; m.vy *= 12 / v; }
          if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) { m.x = Math.random() * 100 - 50; m.y = Math.random() * 100 - 50; m.vx = m.vy = 0; }
          m.x += m.vx; m.y += m.vy;
        }
        s.heat *= 0.985;
      }

      const w = canvas.width, h = canvas.height, k = s.view.k * devicePixelRatio;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(k, 0, 0, k, w / 2 + s.view.x * devicePixelRatio, h / 2 + s.view.y * devicePixelRatio);
      const focus = s.hover ?? props.current.selected;
      const near = new Set<string>();
      if (focus) for (const [a, b] of props.current.edges) { if (a === focus) near.add(b); if (b === focus) near.add(a); }
      ctx.lineWidth = 0.6 / s.view.k;
      for (const [ia, ib] of props.current.edges) {
        const a = s.sims.get(ia), b = s.sims.get(ib);
        if (!a || !b) continue;
        const lit = focus && (ia === focus || ib === focus);
        ctx.strokeStyle = lit ? fg() : muted();
        ctx.globalAlpha = lit ? 0.9 : focus ? 0.08 : (a.n.dim || b.n.dim ? 0.06 : 0.22);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const m of sims) {
        const on = !focus || m.n.id === focus || near.has(m.n.id);
        ctx.globalAlpha = m.n.dim ? 0.15 : on ? 1 : 0.25;
        ctx.fillStyle = m.n.color ?? muted();
        ctx.beginPath(); ctx.arc(m.x, m.y, radius(m), 0, Math.PI * 2); ctx.fill();
        if (m.n.id === props.current.selected) { ctx.strokeStyle = fg(); ctx.lineWidth = 2 / s.view.k; ctx.stroke(); ctx.lineWidth = 0.6 / s.view.k; }
      }
      // nomes: do foco e vizinhos sempre; dos outros só com zoom (como o Obsidian)
      ctx.fillStyle = fg();
      ctx.textAlign = 'center';
      ctx.font = `${12 / s.view.k}px Inter, system-ui, sans-serif`;
      for (const m of sims) {
        const show = m.n.id === focus || near.has(m.n.id) || (s.view.k > 1.6 && !m.n.dim) || (m.deg > 12 && !focus && !m.n.dim);
        if (!show) continue;
        ctx.globalAlpha = m.n.id === focus ? 1 : 0.75;
        const t = m.n.title.length > 42 ? `${m.n.title.slice(0, 40)}…` : m.n.title;
        ctx.fillText(t, m.x, m.y + radius(m) + 12 / s.view.k);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { id: hit(e.clientX, e.clientY), x: e.clientX, y: e.clientY, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!drag) {
        const h = hit(e.clientX, e.clientY);
        if (h !== s.hover) s.dirty = true;
        s.hover = h;
        canvas.style.cursor = h ? 'pointer' : 'grab';
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.id) {
        const m = s.sims.get(drag.id);
        if (m) { const p = toWorld(e.clientX, e.clientY); m.x = p.x; m.y = p.y; m.vx = m.vy = 0; s.heat = Math.max(s.heat, 0.3); }
      } else { s.view.x += dx; s.view.y += dy; }
      drag.x = e.clientX; drag.y = e.clientY;
      s.dirty = true;
    };
    const up = () => {
      if (drag && !drag.moved && drag.id) props.current.onOpen(drag.id);
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
      const k2 = Math.min(6, Math.max(0.15, s.view.k * Math.exp(-e.deltaY * 0.0015)));
      s.view.x = cx - ((cx - s.view.x) * k2) / s.view.k;
      s.view.y = cy - ((cy - s.view.y) * k2) / s.view.k;
      s.view.k = k2;
      s.dirty = true;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', () => { s.hover = null; s.dirty = true; });
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="cb-graph" aria-label="Grafo das notas do cérebro" />;
}
