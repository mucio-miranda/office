/** Recursos nativos quando a UI roda dentro do app de Windows (ver apps/desktop/src/preload.ts). */
export interface OfficeDesktop {
  isDesktop: true;
  info(): Promise<{ version: string; port: number; lanUrls: string[]; dataDir: string; autoStart: boolean }>;
  pickFolder(o?: { title?: string; defaultPath?: string }): Promise<string | null>;
  pickFiles(o?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[]; multiple?: boolean }): Promise<string[]>;
  notify(o: { title: string; body: string; panel?: string; arg?: string }): Promise<void>;
  setAttention(count: number): Promise<void>;
  showInFolder(p: string): Promise<void>;
  openPath(p: string): Promise<string>;
  toggleFullscreen(): Promise<void>;
  setAutoStart(on: boolean): Promise<void>;
  setTheme(t: 'light' | 'dark'): Promise<void>;
  onNavigate(cb: (to: { panel: string | null; arg: string | null }) => void): () => void;
}

export const desktop: OfficeDesktop | null = (globalThis as { officeDesktop?: OfficeDesktop }).officeDesktop ?? null;

if (desktop) document.documentElement.classList.add('is-desktop');

/** Converte um RegExp de extensões (/\.(mp4|mov)$/i) em filtro do diálogo nativo. */
export function filterFromRegex(name: string, re?: RegExp) {
  const m = re?.source.match(/\(([^)]+)\)/);
  if (!m) return undefined;
  // "jpe?g" vira jpg e jpeg
  const exts = m[1].split('|').flatMap((e) => (e.includes('?') ? [e.replace(/.\?/, ''), e.replace('?', '')] : [e]));
  return [{ name, extensions: exts.map((e) => e.replace(/[^a-z0-9]/gi, '')).filter(Boolean) }];
}
