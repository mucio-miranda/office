import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * Lista de opções do controle de videogame. O Chromium não abre o menu nativo de `<select>`, data, hora, cor e arquivo
 * a partir de um clique simulado (trava de segurança), e o A do controle só consegue simular. Então o Office abre esta
 * lista no lugar: direcional escolhe, A confirma, B fecha.
 */
export interface PickItem { label: string; value: string; hint?: string; swatch?: string; disabled?: boolean }
interface PickerState { title: string; items: PickItem[]; current: string | null; note?: string; onPick: ((v: string) => void) | null; back: HTMLElement | null }
export const usePadPicker = create<PickerState>(() => ({ title: '', items: [], current: null, onPick: null, back: null }));

export function openPadPicker(p: { title: string; items: PickItem[]; current?: string | null; note?: string; onPick: (v: string) => void }) {
  usePadPicker.setState({ title: p.title, items: p.items, current: p.current ?? null, note: p.note, onPick: p.onPick, back: document.activeElement as HTMLElement | null });
}

export function closePadPicker(pick?: string) {
  const s = usePadPicker.getState();
  const back = s.back;
  usePadPicker.setState({ items: [], onPick: null, back: null, note: undefined });
  // o foco volta para o campo, para o direcional seguir dali
  back?.focus({ preventScroll: true });
  if (pick !== undefined) s.onPick?.(pick);
}

export function PadPicker() {
  const { title, items, current, note, onPick } = usePadPicker();
  const list = useRef<HTMLDivElement>(null);
  const open = !!onPick;
  useEffect(() => {
    if (!open) return;
    const btns = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const cur = btns.find((b) => b.dataset.value === current) ?? btns[0];
    cur?.focus({ preventScroll: true });
    cur?.scrollIntoView({ block: 'center' });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closePadPicker(); } };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [open, items, current]);
  if (!open) return null;
  return (
    <div className="modal-bg pad-picker-bg" onClick={(e) => { if (e.target === e.currentTarget) closePadPicker(); }}>
      <div className="modal pad-picker" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {note && <p className="muted small">{note}</p>}
        <div className="pad-picker-list" ref={list}>
          {items.map((it) => (
            <button key={it.value + it.label} type="button" data-value={it.value} disabled={it.disabled}
              className={it.value === current ? 'on' : ''} onClick={() => closePadPicker(it.value)}>
              {it.swatch && <span className="swatch" style={{ background: it.swatch }} />}
              <span className="truncate">{it.label}</span>
              {it.hint && <small className="muted">{it.hint}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
