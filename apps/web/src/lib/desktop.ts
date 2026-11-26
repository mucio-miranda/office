export interface UpdateState { state: 'nenhuma' | 'baixando' | 'pronta'; version?: string; percent?: number }

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
  /** Abre um terminal com `claude --resume` na pasta. Devolve o erro, ou vazio. Versões antigas do app não têm. */
  claudeTerminal?(o: { cwd: string; session?: string | null }): Promise<string>;
  setAutoStart(on: boolean): Promise<void>;
  setTheme(t: 'light' | 'dark'): Promise<void>;
  /** Versões antigas do app não têm: confira antes de usar. */
  updateState?(): Promise<UpdateState>;
  installUpdate?(): Promise<void>;
  onUpdate?(cb: (u: UpdateState) => void): () => void;
  onNavigate(cb: (to: { panel: string | null; arg: string | null }) => void): () => void;
  /** Caminho no disco de um arquivo arrastado ou colado (vazio para um print). Versões antigas do app não têm. */
  pathForFile?(f: File): string;
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
