import { usePad, type PadButton, type PadKind } from './gamepad';

/** Desenho de cada botão no controle de Xbox e no de PlayStation (cores e símbolos de cada um). */
const GLYPH: Record<PadKind, Partial<Record<PadButton, { t: string; c?: string }>>> = {
  xbox: {
    A: { t: 'A', c: '#3fae49' }, B: { t: 'B', c: '#e5484d' }, X: { t: 'X', c: '#3b82f6' }, Y: { t: 'Y', c: '#f5b301' },
    LB: { t: 'LB' }, RB: { t: 'RB' }, LT: { t: 'LT' }, RT: { t: 'RT' }, START: { t: '☰' }, BACK: { t: '⧉' },
    UP: { t: '▲' }, DOWN: { t: '▼' }, LEFT: { t: '◀' }, RIGHT: { t: '▶' }, LS: { t: 'L' }, RS: { t: 'R' },
  },
  playstation: {
    A: { t: '✕', c: '#6f9ef8' }, B: { t: '○', c: '#ef5b5b' }, X: { t: '□', c: '#e07cc0' }, Y: { t: '△', c: '#3ec9a7' },
    LB: { t: 'L1' }, RB: { t: 'R1' }, LT: { t: 'L2' }, RT: { t: 'R2' }, START: { t: 'OPT' }, BACK: { t: 'SH' },
    UP: { t: '▲' }, DOWN: { t: '▼' }, LEFT: { t: '◀' }, RIGHT: { t: '▶' }, LS: { t: 'L' }, RS: { t: 'R' },
  },
};

export function Glyph({ b }: { b: PadButton }) {
  const kind = usePad((s) => s.kind);
  const g = GLYPH[kind][b] ?? { t: b };
  const round = ['A', 'B', 'X', 'Y'].includes(b);
  return <span className={`pad-glyph ${round ? 'round' : ''}`} style={g.c ? { color: g.c, borderColor: g.c } : undefined}>{g.t}</span>;
}

/** Dicas do controle no rodapé da tela: só aparecem enquanto você usa o controle. */
export function PadHints({ items }: { items: { b: PadButton[]; label: string }[] }) {
  const active = usePad((s) => s.active);
  const standard = usePad((s) => s.standard);
  if (!active || !items.length) return null;
  return (
    <div className="pad-hints" aria-hidden>
      {!standard && <span className="pad-hint" style={{ color: '#ffd23f' }}>Controle sem o layout padrão: se algum botão estiver trocado, avise</span>}
      {items.map((it) => (
        <span key={it.label} className="pad-hint">{it.b.map((b) => <Glyph key={b} b={b} />)}<span>{it.label}</span></span>
      ))}
    </div>
  );
}
