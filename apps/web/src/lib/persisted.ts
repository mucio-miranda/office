import { useState } from 'react';

/** Estado que fica lembrado neste navegador (barra recolhida, filtro escolhido). Sem armazenamento, vale só na sessão. */
export function usePersisted<T extends string | boolean>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return (typeof initial === 'boolean' ? raw === '1' : raw) as T;
    } catch { return initial; }
  });
  const set = (v: T) => {
    setValue(v);
    try { localStorage.setItem(key, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)); } catch { /* sem armazenamento */ }
  };
  return [value, set];
}
