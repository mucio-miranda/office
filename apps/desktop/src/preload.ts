// Ponte mínima e segura entre a UI e o Windows. A UI checa `window.officeDesktop`:
// se existir, usa os recursos nativos; se não (navegador), cai no comportamento web.
import { contextBridge, ipcRenderer } from 'electron';

type Filter = { name: string; extensions: string[] };

contextBridge.exposeInMainWorld('officeDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('office:info'),
  pickFolder: (o?: { title?: string; defaultPath?: string }) => ipcRenderer.invoke('office:pickFolder', o),
  pickFiles: (o?: { title?: string; defaultPath?: string; filters?: Filter[]; multiple?: boolean }) => ipcRenderer.invoke('office:pickFiles', o),
  notify: (o: { title: string; body: string; panel?: string; arg?: string }) => ipcRenderer.invoke('office:notify', o),
  setAttention: (count: number) => ipcRenderer.invoke('office:attention', count),
  showInFolder: (p: string) => ipcRenderer.invoke('office:showInFolder', p),
  openPath: (p: string) => ipcRenderer.invoke('office:openPath', p),
  toggleFullscreen: () => ipcRenderer.invoke('office:fullscreen'),
  setAutoStart: (on: boolean) => ipcRenderer.invoke('office:setAutoStart', on),
  setTheme: (t: 'light' | 'dark') => ipcRenderer.invoke('office:theme', t),
  onNavigate: (cb: (to: { panel: string | null; arg: string | null }) => void) => {
    const h = (_: unknown, to: { panel: string | null; arg: string | null }) => cb(to);
    ipcRenderer.on('office:navigate', h);
    return () => ipcRenderer.removeListener('office:navigate', h);
  },
});
