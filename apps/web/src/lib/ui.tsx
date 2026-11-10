import { useEffect, useRef, useState } from 'react';
import { Building2, Check, Palette } from 'lucide-react';
import { THEMES, useTheme } from './theme';

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Building2 size={13} /></span>
      Office
    </div>
  );
}

/** Temas da interface: claro, escuro, ultradark e vidro. */
export function ThemeToggle({ up = true }: { up?: boolean }) {
  const { theme, set } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="theme-menu" ref={ref}>
      <button className="icon" onClick={() => setOpen(!open)} title="Temas" aria-label="Temas" aria-expanded={open}><Palette size={16} /></button>
      {open && (
        <div className={`theme-pop ${up ? 'up' : 'down'}`} role="menu">
          <small className="muted">Temas</small>
          {THEMES.map((x) => (
            <button key={x.id} role="menuitemradio" aria-checked={theme === x.id} className={theme === x.id ? 'on' : ''} onClick={() => { set(x.id); setOpen(false); }} title={x.hint}>
              <span className={`theme-swatch ${x.id}`} />
              <span className="col"><span>{x.label}</span><span className="muted small">{x.hint}</span></span>
              {theme === x.id && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
