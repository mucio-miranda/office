// Processo principal do app de desktop do Office.
// Sobe o mesmo servidor da versão web num utilityProcess (isolado da janela) e abre a UI
// numa janela imersiva. A equipe na rede continua entrando pelo navegador em http://IP:porta.
import {
  app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, net, shell, utilityProcess,
  type UtilityProcess,
} from 'electron';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const DEFAULT_PORT = 4747;
const isDev = !app.isPackaged;
/** Pasta com server.mjs, web/, agents/ e assets/ (gerada por scripts/build.mjs). */
const RES = isDev ? path.join(__dirname) : path.join(process.resourcesPath, 'office');
const REPO = path.resolve(__dirname, '../../..');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: UtilityProcess | null = null;
let port = DEFAULT_PORT;
let quitting = false;
let attention = 0;

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('town.office.app');

// ---------------- servidor ----------------

/** Em dev usa a mesma pasta de dados do `npm start`; instalado, usa %APPDATA%/Office/data. */
function dataDir() {
  if (process.env.OFFICE_DATA) return process.env.OFFICE_DATA;
  if (isDev && existsSync(path.join(REPO, 'data'))) return path.join(REPO, 'data');
  return path.join(app.getPath('userData'), 'data');
}

async function healthAt(p: number): Promise<{ office: boolean; version?: string } | null> {
  try {
    const res = await net.fetch(`http://127.0.0.1:${p}/api/health`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const portFree = (p: number) =>
  new Promise<boolean>((resolve) => {
    const s = createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
    s.listen(p, '0.0.0.0');
  });

/**
 * Os funcionários de IA renderizam vídeo chamando `office-render timeline.json saida.mp4`.
 * No app instalado não existe npx/tsx: criamos um atalho que roda a CLI empacotada com o
 * próprio executável do Electron em modo Node.
 */
function writeRenderShims(binDir: string) {
  mkdirSync(binDir, { recursive: true });
  const exe = process.execPath;
  const script = path.join(RES, 'office-render.mjs');
  writeFileSync(path.join(binDir, 'office-render'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe.replace(/\\/g, '/')}" "${script.replace(/\\/g, '/')}" "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(binDir, 'office-render.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${script}" %*\r\n`);
}

async function startServer() {
  // já existe um Office rodando (ex.: `npm start` em outro terminal)? então só conecta nele
  const existing = await healthAt(DEFAULT_PORT);
  if (existing?.office) {
    port = DEFAULT_PORT;
    return;
  }
  port = DEFAULT_PORT;
  while (!(await portFree(port)) && port < DEFAULT_PORT + 20) port++;

  const data = dataDir();
  mkdirSync(data, { recursive: true });
  const binDir = path.join(app.getPath('userData'), 'bin');
  writeRenderShims(binDir);
  const logDir = path.join(app.getPath('userData'), 'logs');
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(path.join(logDir, 'server.log'), { flags: 'a' });

  server = utilityProcess.fork(path.join(RES, 'server.mjs'), [], {
    stdio: 'pipe',
    serviceName: 'Office · servidor',
    env: {
      ...process.env,
      PORT: String(port),
      HOST: process.env.HOST ?? '0.0.0.0',
      OFFICE_DATA: data,
      OFFICE_WEB_DIST: path.join(RES, 'web'),
      OFFICE_AGENTS_DIR: path.join(RES, 'agents'),
      OFFICE_RENDER_CMD: 'office-render',
      OFFICE_VERSION: app.getVersion(),
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('O servidor do Office não respondeu em 30 s. Veja o log em ' + logDir)), 30_000);
    server!.on('message', (m: { type?: string }) => { if (m?.type === 'ready') { clearTimeout(timer); resolve(); } });
    server!.on('exit', (code) => {
      clearTimeout(timer);
      if (!quitting) {
        dialog.showErrorBox('Office', `O servidor parou (código ${code}). Veja o log em ${logDir}`);
        reject(new Error('servidor saiu'));
      }
    });
  });
}

const lanUrls = () =>
  Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i!.address}:${port}`);

// ---------------- janela ----------------

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Office',
    icon: path.join(RES, 'assets/icon.png'),
    backgroundColor: '#ffffff',
    // barra de título embutida na UI (os botões do Windows ficam por cima do cabeçalho de 56 px)
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#737373', height: 56 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadURL(`http://localhost:${port}`);
  win.once('ready-to-show', () => win?.show());

  // a janela só navega dentro do próprio Office; links externos abrem no navegador
  const isOffice = (url: string) => url.startsWith(`http://localhost:${port}`) || url.startsWith(`http://127.0.0.1:${port}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!isOffice(url)) { e.preventDefault(); shell.openExternal(url); } });

  // F11 alterna tela cheia, como num jogo
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win?.setFullScreen(!win.isFullScreen());
  });

  // fechar a janela só esconde: o escritório continua aberto para a equipe na rede
  let warned = false;
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    if (!warned) {
      warned = true;
      new Notification({ title: 'O Office continua rodando', body: 'Ele fica na bandeja, perto do relógio. Ctrl+Shift+O abre de novo.', icon: path.join(RES, 'assets/icon.png') }).show();
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (win?.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

// ---------------- bandeja ----------------

function refreshTray() {
  if (!tray) return;
  const icon = path.join(RES, attention ? 'assets/tray-alert.png' : 'assets/tray.png');
  tray.setImage(nativeImage.createFromPath(icon));
  tray.setToolTip(attention ? `Office · ${attention} ${attention === 1 ? 'tarefa espera' : 'tarefas esperam'} sua aprovação` : 'Office');
  const urls = lanUrls();
  const auto = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Office', click: showWindow },
    { label: 'Tela cheia', click: () => { showWindow(); win?.setFullScreen(!win.isFullScreen()); } },
    { type: 'separator' },
    {
      label: urls.length ? `Copiar endereço da rede (${urls[0]})` : 'Sem rede local',
      enabled: urls.length > 0,
      click: () => clipboard.writeText(urls[0]),
    },
    { label: 'Abrir pasta de dados', click: () => shell.openPath(dataDir()) },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: auto, click: (m) => { app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }); refreshTray(); } },
    { type: 'separator' },
    { label: 'Sair do Office', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(RES, 'assets/tray.png')));
  tray.on('click', showWindow);
  refreshTray();
}

// ---------------- ponte com a UI (preload) ----------------

function registerIpc() {
  ipcMain.handle('office:info', () => ({
    version: app.getVersion(), port, lanUrls: lanUrls(), dataDir: dataDir(), autoStart: app.getLoginItemSettings().openAtLogin,
  }));

  ipcMain.handle('office:pickFolder', async (_e, o: { title?: string; defaultPath?: string } = {}) => {
    const r = await dialog.showOpenDialog(win!, { title: o.title ?? 'Escolher pasta', defaultPath: o.defaultPath || undefined, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('office:pickFiles', async (_e, o: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[]; multiple?: boolean } = {}) => {
    const r = await dialog.showOpenDialog(win!, {
      title: o.title ?? 'Escolher arquivo', defaultPath: o.defaultPath || undefined, filters: o.filters,
      properties: ['openFile', ...(o.multiple ? (['multiSelections'] as const) : [])],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('office:notify', (_e, o: { title: string; body: string; panel?: string; arg?: string }) => {
    if (win?.isFocused()) return;
    const n = new Notification({ title: o.title, body: o.body, icon: path.join(RES, 'assets/icon.png') });
    n.on('click', () => { showWindow(); win?.webContents.send('office:navigate', { panel: o.panel ?? null, arg: o.arg ?? null }); });
    n.show();
  });

  ipcMain.handle('office:attention', (_e, count: number) => {
    attention = Math.max(0, Math.floor(count));
    refreshTray();
    if (attention && !win?.isFocused()) win?.flashFrame(true);
    if (!attention) win?.flashFrame(false);
  });

  // abrir arquivos/pastas no Windows (só caminhos absolutos que existem)
  ipcMain.handle('office:showInFolder', (_e, p: string) => { if (path.isAbsolute(p) && existsSync(p)) shell.showItemInFolder(p); });
  ipcMain.handle('office:openPath', (_e, p: string) => (path.isAbsolute(p) && existsSync(p) ? shell.openPath(p) : 'Arquivo não encontrado'));

  ipcMain.handle('office:fullscreen', () => win?.setFullScreen(!win.isFullScreen()));
  ipcMain.handle('office:setAutoStart', (_e, on: boolean) => { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); refreshTray(); });

  // a UI avisa quando troca de tema para os botões da janela acompanharem
  ipcMain.handle('office:theme', (_e, t: 'light' | 'dark') => {
    win?.setTitleBarOverlay({ color: '#00000000', symbolColor: t === 'dark' ? '#a3a3a3' : '#737373', height: 56 });
    win?.setBackgroundColor(t === 'dark' ? '#171717' : '#ffffff');
  });
}

// ---------------- atualização automática ----------------

async function checkUpdates() {
  if (isDev) return;
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', () => {
      new Notification({ title: 'Atualização do Office pronta', body: 'Ela será instalada quando você sair do Office.' }).show();
    });
    await autoUpdater.checkForUpdates();
  } catch {
    // sem internet ou sem release publicado: segue a vida
  }
}

// ---------------- ciclo de vida ----------------

app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  registerIpc();
  try {
    await startServer();
  } catch (e) {
    dialog.showErrorBox('Office', (e as Error).message);
    quitting = true;
    app.quit();
    return;
  }
  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Shift+O', toggleWindow);
  if (!process.argv.includes('--hidden')) win?.once('ready-to-show', showWindow);
  checkUpdates();
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  server?.kill();
});
app.on('window-all-closed', () => { /* continua na bandeja */ });
