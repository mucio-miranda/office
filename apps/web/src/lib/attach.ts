import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { api, getToken } from './api';
import { desktop } from './desktop';

/**
 * Arquivos no chat dos funcionários: arrastar até a conversa ou colar (Ctrl+V de um arquivo copiado no Explorer, ou um
 * print). Vira texto com o caminho, como no terminal. No app do Windows, o que já está neste PC vai só como caminho;
 * o resto sobe para a pasta de anexos do Office, que todo funcionário enxerga. Colar um caminho como texto continua normal.
 */
export function useAttach(officeId: string, insert: (paths: string[]) => void, notify?: (msg: string) => void) {
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(0);
  const depth = useRef(0);

  const handle = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setSending((n) => n + files.length);
    const base = `/api/offices/${officeId}`;
    try {
      const withPath = files.map((f) => ({ f, p: desktop?.pathForFile?.(f) || '' }));
      const candidates = withPath.map((x) => x.p).filter(Boolean);
      const local = new Set<string>(candidates.length ? (await api<{ local: string[] }>(`${base}/anexos/caminhos`, { body: { paths: candidates } })).local : []);
      const out: string[] = [];
      for (const { f, p } of withPath) {
        if (p && local.has(p)) { out.push(p); setSending((n) => n - 1); continue; }
        try {
          const token = getToken();
          const res = await fetch(`${base}/anexos?nome=${encodeURIComponent(f.name)}`, {
            method: 'POST', body: f,
            headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.path) throw new Error(data.error ?? `Não deu para anexar ${f.name}`);
          out.push(data.path);
        } catch (e) {
          notify?.((e as Error).message);
        } finally { setSending((n) => n - 1); }
      }
      if (out.length) insert(out);
    } catch (e) {
      setSending(0);
      notify?.((e as Error).message);
    }
  }, [officeId, insert, notify]);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return {
    dragging,
    sending,
    bind: {
      onDragEnter: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setDragging(true); },
      onDragOver: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
      onDragLeave: (e: DragEvent) => { if (!hasFiles(e)) return; if (--depth.current <= 0) { depth.current = 0; setDragging(false); } },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth.current = 0; setDragging(false);
        void handle(Array.from(e.dataTransfer.files));
      },
    },
    onPaste: (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return; // texto (inclusive um caminho) cola normal
      e.preventDefault();
      void handle(files);
    },
  };
}

/** Junta os caminhos ao texto, um por linha. Caminho com espaço vai entre aspas, como no terminal. */
export function withPaths(text: string, paths: string[]) {
  const lines = paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join('\n');
  return text && !/\s$/.test(text) ? `${text}\n${lines}\n` : `${text}${lines}\n`;
}

// arquivo solto fora do chat não pode fazer a janela abrir o arquivo (o app do Windows o abriria no programa padrão)
if (typeof window !== 'undefined') {
  const block = (e: globalThis.DragEvent) => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault(); };
  window.addEventListener('dragover', block);
  window.addEventListener('drop', block);
}
