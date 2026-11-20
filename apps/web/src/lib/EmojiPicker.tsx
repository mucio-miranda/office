import { useEffect, useRef, useState } from 'react';

/** Ícones prontos para salas (trabalho de agência e escritório); o campo livre aceita qualquer outro emoji. */
const ICONS = [
  '🚪', '🏢', '💼', '📊', '📈', '🗂️', '📁', '📝',
  '🎬', '🎥', '📹', '🎞️', '📸', '🎙️', '🎧', '🎵',
  '🎨', '🖌️', '✏️', '🖼️', '💡', '🧠', '🎯', '🚀',
  '💻', '🖥️', '⌨️', '📱', '🛠️', '⚙️', '🔬', '📚',
  '☕', '🍕', '🍰', '🛋️', '🌿', '🪴', '🎮', '🏋️',
  '🤝', '👥', '📣', '📢', '💬', '📞', '⭐', '❤️',
];

/** Botão com o ícone atual; clicar abre uma grade para escolher. */
export function EmojiPicker({ value, onChange, label = 'Ícone' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (v: string) => { onChange(v); setOpen(false); setCustom(''); };
  return (
    <div className="emoji-picker" ref={box}>
      <button type="button" className="emoji-current" aria-label={`${label}: ${value}. Trocar`} aria-expanded={open} title="Escolher o ícone" onClick={() => setOpen((o) => !o)}>{value}</button>
      {open && (
        <div className="emoji-pop" role="listbox" aria-label={label}>
          <div className="emoji-grid">
            {ICONS.map((e) => (
              <button type="button" key={e} role="option" aria-selected={e === value} className={e === value ? 'on' : ''} onClick={() => pick(e)}>{e}</button>
            ))}
          </div>
          <div className="row gap emoji-custom">
            <input value={custom} maxLength={8} placeholder="Outro (cole um emoji)" onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { e.preventDefault(); pick(custom.trim()); } }} />
            <button type="button" className="small" disabled={!custom.trim()} onClick={() => pick(custom.trim())}>Usar</button>
          </div>
        </div>
      )}
    </div>
  );
}
