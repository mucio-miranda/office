import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

/**
 * Rascunho do chat: o que foi escrito e não enviado continua lá ao sair e voltar para a conversa (e depois de reabrir o
 * Office). Um rascunho por conversa; enviar limpa. Guardado neste navegador, nunca no servidor.
 */
const PREFIX = 'office.rascunho.';
const memory = new Map<string, string>();

function read(key: string) {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(PREFIX + key) ?? ''; } catch { return ''; }
}

function write(key: string, text: string) {
  memory.set(key, text);
  try { text ? localStorage.setItem(PREFIX + key, text) : localStorage.removeItem(PREFIX + key); } catch { /* modo privado */ }
}

export function useDraft(key: string): [string, (v: SetStateAction<string>) => void] {
  const [state, setState] = useState(() => ({ key, text: read(key) }));
  // trocou de conversa sem desmontar o painel: carrega o rascunho da nova
  const current = state.key === key ? state : { key, text: read(key) };
  if (current !== state) setState(current);
  const keyRef = useRef(key);
  keyRef.current = key;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const set = useCallback((v: SetStateAction<string>) => {
    setState((s) => {
      const k = keyRef.current;
      const prev = s.key === k ? s.text : read(k);
      const text = typeof v === 'function' ? v(prev) : v;
      memory.set(k, text);
      clearTimeout(timer.current);
      // gravar no disco a cada tecla pesa; a memória já segura a troca de tela
      if (!text) write(k, ''); else timer.current = setTimeout(() => write(k, text), 300);
      return { key: k, text };
    });
  }, []);

  useEffect(() => () => {
    clearTimeout(timer.current);
    const k = keyRef.current;
    if (memory.has(k)) write(k, memory.get(k)!);
  }, []);

  return [current.text, set];
}
