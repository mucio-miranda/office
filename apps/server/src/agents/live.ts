import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { uid, type AgentJob, type LiveSession, type Office } from '@office/shared';
import { config } from '../config.ts';
import { now } from '../db.ts';
import { invalidate } from '../realtime.ts';
import { liveApp, type LiveBridge, type LiveDef } from './tools.ts';

/**
 * Modo ao vivo: o app criativo (PhotoCraft, FilmCraft...) abre de verdade na tela desta máquina,
 * com o canal de controle numa porta local e um token novo por sessão. O servidor MCP da tarefa
 * vira uma ponte para essa janela, então quem estiver na frente do computador vê a IA trabalhando
 * e pode pegar o mouse. O Office tira prints da janela para o espelho no navegador e no mapa.
 */

/** Cliente do canal de controle (JSON por linha, só em 127.0.0.1). */
class Control {
  private sock: net.Socket | null = null;
  private buf = '';
  private seq = 0;
  private pending = new Map<number | string, (m: any) => void>();
  constructor(private port: number, private token: string, private auth: LiveDef['auth']) {}

  private connect() {
    return new Promise<void>((ok, fail) => {
      const s = net.connect(this.port, '127.0.0.1');
      s.setEncoding('utf8');
      s.on('data', (d: string) => {
        this.buf += d;
        let i: number;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 1);
          try {
            const m = JSON.parse(line);
            this.pending.get(m.id)?.(m);
            this.pending.delete(m.id);
          } catch { /* linha que não é JSON */ }
        }
      });
      const drop = () => {
        if (this.sock === s) this.sock = null;
        for (const r of this.pending.values()) r({ ok: false, error: 'conexão fechada' });
        this.pending.clear();
      };
      s.on('close', drop);
      s.on('error', (e) => { drop(); fail(e); });
      s.on('connect', async () => {
        this.sock = s;
        if (this.auth === 'frame') {
          const r = await this.send({ id: 'auth', method: 'auth', params: { token: this.token } }, 10000);
          if (!r.ok) { s.destroy(); return fail(new Error(r.error ?? 'autenticação recusada')); }
        }
        ok();
      });
    });
  }

  private send(msg: Record<string, unknown>, timeout: number) {
    return new Promise<any>((resolve) => {
      const id = msg.id as number | string;
      this.pending.set(id, resolve);
      this.sock!.write(JSON.stringify(msg) + '\n');
      setTimeout(() => { if (this.pending.delete(id)) resolve({ ok: false, error: 'sem resposta' }); }, timeout);
    });
  }

  async call(method: string, params: Record<string, unknown> = {}, timeout = 20000) {
    if (!this.sock) await this.connect();
    const id = ++this.seq;
    return this.send({ id, method, params, ...(this.auth === 'inline' ? { token: this.token } : {}) }, timeout);
  }

  close() { this.sock?.destroy(); this.sock = null; }
}

interface Live extends LiveSession {
  proc: ChildProcess;
  ctl: Control;
  bridge: LiveBridge;
  def: LiveDef;
  /** Print mais recente completo e a pasta onde os prints ficam. */
  frame: string | null;
  shotDir: string;
  office: Office;
  /** Última vez que alguém olhou o espelho em tamanho grande (ms). */
  watchedAt: number;
  timer: NodeJS.Timeout | null;
}

const sessions = new Map<string, Live>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise<number>((ok, fail) => {
  const srv = net.createServer();
  srv.unref();
  srv.on('error', fail);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address() as net.AddressInfo;
    srv.close(() => ok(port));
  });
});

const publicView = ({ id, officeId, jobId, agentId, toolId, toolName, status, error, startedAt, frameAt }: Live): LiveSession =>
  ({ id, officeId, jobId, agentId, toolId, toolName, status, error, startedAt, frameAt });

function changed(s: Live, patch: Partial<Live>) {
  Object.assign(s, patch);
  invalidate(s.officeId, 'live');
}

export const listLive = (officeId: string) => [...sessions.values()].filter((s) => s.officeId === officeId).map(publicView);
export const getLive = (id: string) => sessions.get(id);

/** Prints alternando dois arquivos: o espelho sempre lê um que já terminou de ser gravado. */
async function shoot(s: Live) {
  const name = `${s.id}-${s.frame?.endsWith('a.png') ? 'b' : 'a'}.png`;
  const abs = path.join(s.shotDir, name);
  // o PhotoCraft só grava dentro da pasta de gravação dele e quer caminho relativo
  const target = s.def.relativeShot ? path.relative(s.office.rootPath, abs).split(path.sep).join('/') : abs.split(path.sep).join('/');
  const r = await s.ctl.call('ui.screenshot', { path: target }, 15000);
  if (r.ok && existsSync(abs)) {
    const first = !s.frame;
    s.frame = abs;
    s.frameAt = now();
    if (first || s.error) changed(s, { error: null });
  } else if (!r.ok) {
    const covered = /covered|minimi|no frame|hidden/i.test(String(r.error));
    const error = covered ? 'A janela está coberta ou minimizada: traga para a frente para o espelho voltar.' : String(r.error ?? 'sem print');
    if (s.error !== error) changed(s, { error });
  }
}

function loop(s: Live) {
  const tick = async () => {
    if (!sessions.has(s.id)) return;
    try { await shoot(s); } catch { /* app ocupado: tenta no próximo */ }
    // rápido enquanto alguém assiste em tela grande; devagar para o monitor do mapa
    const watched = Date.now() - s.watchedAt < 5000;
    s.timer = setTimeout(tick, watched ? 900 : 4000);
  };
  s.timer = setTimeout(tick, 500);
}

/** Fecha o app (sem prompt de salvar: o que não foi salvo fica no diário de recuperação do app). */
export async function closeLive(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  if (s.timer) clearTimeout(s.timer);
  await s.ctl.call('app.quit', {}, 5000).catch(() => null);
  s.ctl.close();
  setTimeout(() => { if (s.proc.exitCode === null) s.proc.kill(); }, 5000);
  invalidate(s.officeId, 'live');
}

export async function focusLive(id: string) {
  const s = sessions.get(id);
  if (!s) throw new Error('Esse app já foi fechado.');
  const r = await s.ctl.call('ui.focus', {}, 3000);
  if (r.ok) return;
  // apps sem ui.focus (PhotoCraft): minimiza e restaura a janela principal pelo PID, o que a traz
  // para cima mesmo quando o Windows bloqueia a troca de foco vinda de outro processo
  if (process.platform === 'win32' && s.proc.pid) {
    const ps = [
      `Add-Type 'using System;using System.Runtime.InteropServices;public class OfficeWin{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}'`,
      `$h = (Get-Process -Id ${s.proc.pid}).MainWindowHandle`,
      `if ($h -eq 0) { exit 1 }`,
      `[void][OfficeWin]::ShowWindow($h, 6); [void][OfficeWin]::ShowWindow($h, 9); [void][OfficeWin]::SetForegroundWindow($h)`,
    ].join('; ');
    const ok = await new Promise<boolean>((done) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (e) => done(!e)));
    if (ok) return;
  }
  throw new Error('Não consegui trazer a janela para a frente.');
}

export function watchFrame(id: string, big: boolean) {
  const s = sessions.get(id);
  if (!s) return null;
  if (big) s.watchedAt = Date.now();
  return s.frame && existsSync(s.frame) ? { file: s.frame, size: statSync(s.frame).size } : null;
}

async function openOne(job: AgentJob, office: Office, toolId: string): Promise<Live | null> {
  const app = liveApp(toolId);
  if (!app) return null;
  // abre espaço fechando o app livre mais antigo; com todos ocupados, a tarefa segue sem janela
  const open = [...sessions.values()];
  if (open.length >= config.maxLiveApps) {
    const idle = open.filter((s) => s.status === 'livre').sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    if (!idle) return null;
    await closeLive(idle.id);
  }
  const port = await freePort();
  const token = randomBytes(32).toString('hex');
  const shotDir = path.join(office.rootPath, '.office', 'live');
  mkdirSync(shotDir, { recursive: true });
  const env = { ...process.env, [`${app.def.env}_CONTROL_PORT`]: String(port), [`${app.def.env}_CONTROL_TOKEN`]: token };
  const proc = spawn(app.exe, [...(app.def.appArgs?.(office) ?? []), '--control', String(port)], { cwd: path.dirname(app.exe), env, stdio: 'ignore' });
  const s: Live = {
    id: uid(), officeId: office.id, jobId: job.id, agentId: job.agentId, toolId, toolName: app.name,
    status: 'abrindo', error: null, startedAt: now(), frameAt: null,
    proc, ctl: new Control(port, token, app.def.auth), bridge: { port, token }, def: app.def,
    frame: null, shotDir, office, watchedAt: 0, timer: null,
  };
  sessions.set(s.id, s);
  invalidate(office.id, 'live');
  proc.on('exit', () => {
    if (!sessions.has(s.id)) return;
    sessions.delete(s.id);
    if (s.timer) clearTimeout(s.timer);
    s.ctl.close();
    invalidate(office.id, 'live');
  });
  // apps grandes (FilmCraft, EffectCraft) levam alguns segundos para abrir o canal
  for (let i = 0; i < 90; i++) {
    if (proc.exitCode !== null) break;
    const r = await s.ctl.call('ui.inspect', {}, 5000).catch(() => null);
    if (r?.ok) {
      changed(s, { status: 'ativa' });
      loop(s);
      return s;
    }
    await sleep(1000);
  }
  changed(s, { status: 'erro', error: `O ${app.name} não abriu o canal de controle.` });
  await closeLive(s.id);
  return null;
}

/**
 * Garante os apps ao vivo de uma tarefa (reaproveita os que ela já tem abertos) e devolve as pontes
 * para o mcp.json. O que não abrir fica de fora, e a ferramenta roda headless como antes.
 */
export async function openLiveForJob(job: AgentJob, office: Office, toolIds: string[]) {
  const bridges: Record<string, LiveBridge> = {};
  const failed: string[] = [];
  for (const toolId of toolIds) {
    let s = [...sessions.values()].find((x) => x.jobId === job.id && x.toolId === toolId && x.status !== 'erro');
    if (!s) s = (await openOne(job, office, toolId).catch(() => null)) ?? undefined;
    if (s) {
      changed(s, { status: 'ativa' });
      bridges[toolId] = s.bridge;
    } else failed.push(toolId);
  }
  return { bridges, failed };
}

/** A tarefa parou (concluída, aguardando, erro): o app segue aberto para a revisão humana. */
export function releaseLiveForJob(jobId: string) {
  for (const s of sessions.values()) if (s.jobId === jobId && s.status === 'ativa') changed(s, { status: 'livre' });
}

/** Ao fechar o servidor, os apps abertos por ele fecham junto. */
export function closeAllLive() {
  for (const s of sessions.values()) { try { s.proc.kill(); } catch { /* já saiu */ } }
  sessions.clear();
}
