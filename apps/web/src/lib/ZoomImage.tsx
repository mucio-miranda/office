import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';

/**
 * Imagem com zoom para conferir detalhe: roda do mouse ou pinça aproxima no ponto do cursor, arrastar move a imagem
 * aproximada, clique duplo alterna entre caber na tela e 2,5x, teclas + e - aproximam e 0 volta a caber.
 */

const MIN = 1;
const MAX = 8;

export function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);

  /** Aproxima mantendo parado o ponto da tela em (cx, cy), relativo ao centro da área. */
  const zoomAt = (k: number, cx = 0, cy = 0) => setZ((o) => {
    const s = Math.min(MAX, Math.max(MIN, o.s * k));
    if (s === 1) return { s: 1, x: 0, y: 0 };
    const r = s / o.s;
    return { s, x: cx - (cx - o.x) * r, y: cy - (cy - o.y) * r };
  });
  const fromCenter = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2] as const;
  };

  useEffect(() => { setZ({ s: 1, x: 0, y: 0 }); }, [src]);
  useEffect(() => {
    const el = box.current!;
    // a roda precisa de listener não passivo para não rolar a página por trás
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [cx, cy] = fromCenter(e);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), cx, cy);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === '+' || e.key === '=') zoomAt(1.25);
      else if (e.key === '-') zoomAt(0.8);
      else if (e.key === '0') setZ({ s: 1, x: 0, y: 0 });
    };
    window.addEventListener('keydown', key);
    return () => { el.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key); };
  }, []);

  const zoomed = z.s > 1.001;
  return (
    <div ref={box} className={`zoom-img ${zoomed ? 'zoomed' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || !zoomed) return;
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        drag.current = { px: e.clientX, py: e.clientY, x: z.x, y: z.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.moved = true;
        setZ((o) => ({ ...o, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={(e) => { if (zoomed) setZ({ s: 1, x: 0, y: 0 }); else { const [cx, cy] = fromCenter(e); zoomAt(2.5, cx, cy); } }}>
      <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />
      <div className="zoom-bar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon" title="Afastar (-)" disabled={!zoomed} onClick={() => zoomAt(0.8)}><Minus size={14} /></button>
        <span className="mono small">{Math.round(z.s * 100)}%</span>
        <button type="button" className="icon" title="Aproximar (+, roda do mouse ou clique duplo)" disabled={z.s >= MAX} onClick={() => zoomAt(1.25)}><Plus size={14} /></button>
        <button type="button" className="icon" title="Caber na tela (0)" disabled={!zoomed} onClick={() => setZ({ s: 1, x: 0, y: 0 })}><Scan size={14} /></button>
      </div>
    </div>
  );
}
