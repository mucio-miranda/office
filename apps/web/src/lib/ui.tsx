import { Building2, Moon, Sun } from 'lucide-react';
import { useTheme } from './theme';

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
