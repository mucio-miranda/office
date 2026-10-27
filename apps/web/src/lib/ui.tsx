import { Box, Building2, Grid2x2, Moon, Sun } from 'lucide-react';
import { useTheme, useWorldStyle } from './theme';

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Building2 size={13} /></span>
      Office
    </div>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="icon" onClick={toggle} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'} aria-label="Alternar tema">
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

/** Alterna o mundo entre pixel art e a maquete minimalista. */
export function WorldStyleToggle() {
  const { style, toggle } = useWorldStyle();
  return (
    <button className="icon" onClick={toggle} title={style === 'pixel' ? 'Mundo em maquete' : 'Mundo em pixel art'} aria-label="Alternar estilo do mundo">
      {style === 'pixel' ? <Box size={16} /> : <Grid2x2 size={16} />}
    </button>
  );
}
