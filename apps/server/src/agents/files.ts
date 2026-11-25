import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync, statfsSync } from 'node:fs';
import path from 'node:path';

/**
 * Arquivos para o funcionário, feitos pelo Office e não por comando dele:
 * - copiar do Drive para o disco: o Google Drive para computador baixa o arquivo enquanto é lido, e um vídeo de 2 GB
 *   não cabe no limite de ~2 min de um comando. A cópia roda aqui em segundo plano (robocopy com retomada) e o
 *   funcionário só espera.
 * - mover com trava: o `mv`/`Move-Item` é sempre bloqueado (no modo sem tela não há pedido de permissão para alguém
 *   aprovar). Aqui o mover nunca sobrescreve, fica dentro das pastas do escritório e é registrado para desfazer.
 */

const key = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
/**
 * Caminho real (atalhos resolvidos, nome curto "RUNNER~1" vira o longo). O que ainda não existe é resolvido pela pasta
 * mais próxima que existe, para comparar do mesmo jeito que o resto.
 */
function real(p: string) {
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(p);
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  try { return path.join(realpathSync.native(cur), ...rest); } catch { return path.resolve(p); }
}
/** O caminho está dentro de uma das pastas (comparando o caminho real, por causa dos atalhos para o Drive). */
export function inside(p: string, roots: string[]) {
  const k = key(real(p));
  return roots.some((r) => { const rk = key(real(r)); return k === rk || k.startsWith(rk + path.sep); });
}

function sizeOf(p: string): number {
  try {
    const s = statSync(p);
    if (!s.isDirectory()) return s.size;
    return readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
  } catch { return 0; }
}

/* ---------------- mover ---------------- */

export function moveSafe(from: string, to: string, roots: string[], logFile?: string, who = '') {
  if (!path.isAbsolute(from) || !path.isAbsolute(to)) throw new Error('Use caminhos completos (com a letra do disco).');
  if (!existsSync(from)) throw new Error(`Não achei: ${from}`);
  if (!inside(from, roots) || !inside(path.dirname(to), roots) && !inside(to, roots)) throw new Error('Só movo dentro das pastas do escritório (raiz, Drive e pastas extras).');
  // "para" uma pasta que já existe: vai para dentro dela com o mesmo nome
  const dest = existsSync(to) && statSync(to).isDirectory() ? path.join(to, path.basename(from)) : to;
  if (existsSync(dest)) throw new Error(`Já existe algo em ${dest}. Não sobrescrevo: escolha outro nome ou peça para a pessoa resolver.`);
  if (key(real(dest)).startsWith(key(real(from)) + path.sep)) throw new Error('Não dá para mover uma pasta para dentro dela mesma.');
  const fromRoot = path.parse(real(from)).root.toLowerCase(), toRoot = path.parse(real(path.dirname(dest)) || dest).root.toLowerCase();
  if (fromRoot !== toRoot) throw new Error('Os dois lugares estão em discos diferentes. Mover entre discos é copiar e apagar, e apagar não é permitido: copie com `copiar_para_local` e deixe o original.');
  mkdirSync(path.dirname(dest), { recursive: true });
  renameSync(from, dest);
  if (logFile) appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), who, from, to: dest })}\n`);
  return { de: from, para: dest, desfazer: `mover de "${dest}" para "${from}"` };
}

/* ---------------- copiar para o disco ---------------- */

export interface Copy { id: string; jobId: string; items: { from: string; to: string; size: number }[]; dest: string; total: number; startedAt: number; done: boolean; failed: string[] }
const copies = new Map<string, Copy>();

const free = (dir: string) => { try { const s = statfsSync(dir); return s.bavail * s.bsize; } catch { return Infinity; } };
const gb = (n: number) => `${(n / 1e9).toFixed(2).replace('.', ',')} GB`;

function robocopy(src: string, dst: string, file?: string) {
  // /Z retoma de onde parou se o Drive falhar no meio; 10 tentativas de 10 s; sem /MIR, /MOV nem /PURGE: nunca apaga
  const args = file ? [src, dst, file] : [src, dst, '/E'];
  args.push('/Z', '/R:10', '/W:10', '/NP', '/NJH', '/NJS', '/NDL', '/XO');
  return new Promise<boolean>((resolve) => {
    const p = spawn('robocopy', args, { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code !== null && code < 8));
  });
}

export function startCopy(jobId: string, sources: string[], dest: string, roots: string[]) {
  if (!sources.length) throw new Error('Mande ao menos um arquivo ou pasta em `de`.');
  if (!path.isAbsolute(dest)) throw new Error('`para` precisa ser um caminho completo.');
  if (!inside(dest, roots)) throw new Error('Só copio para as pastas do escritório (ex.: C:\\REZZU-TEMP\\...).');
  const items = sources.map((s) => {
    if (!path.isAbsolute(s) || !existsSync(s)) throw new Error(`Não achei: ${s}`);
    if (!inside(s, roots)) throw new Error(`Fora das pastas do escritório: ${s}`);
    return { from: s, to: path.join(dest, path.basename(s)), size: sizeOf(s) };
  });
  const total = items.reduce((n, i) => n + i.size, 0);
  mkdirSync(dest, { recursive: true });
  const room = free(dest);
  if (total > room - 2e9) throw new Error(`Não cabe: ${gb(total)} para copiar e ${gb(room)} livres em ${path.parse(dest).root}. Libere espaço antes.`);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const c: Copy = { id, jobId, items, dest, total, startedAt: Date.now(), done: false, failed: [] };
  copies.set(id, c);
  void (async () => {
    for (const it of items) {
      const dir = statSync(it.from).isDirectory();
      const ok = dir ? await robocopy(it.from, it.to) : await robocopy(path.dirname(it.from), dest, path.basename(it.from));
      if (!ok) c.failed.push(it.from);
    }
    c.done = true;
  })();
  return c;
}

export function copyStatus(c: Copy) {
  const copied = Math.min(c.total, c.items.reduce((n, i) => n + sizeOf(i.to), 0));
  const pct = c.total ? Math.round((copied / c.total) * 100) : 100;
  const min = Math.round((Date.now() - c.startedAt) / 60000);
  if (c.done) {
    return c.failed.length
      ? { id: c.id, pronto: false, erro: true, texto: `A cópia terminou com falha em: ${c.failed.join(', ')}. O Drive não entregou o arquivo; peça para a pessoa marcar a pasta como "Disponível off-line" ou copiar do cartão, e tente de novo.` }
      : { id: c.id, pronto: true, texto: `Pronto: ${gb(c.total)} em ${c.dest} (${min} min). Trabalhe nas cópias; o original no Drive fica intocado.`, arquivos: c.items.map((i) => i.to) };
  }
  return { id: c.id, pronto: false, texto: `Copiando: ${gb(copied)} de ${gb(c.total)} (${pct}%, ${min} min). Chame copia_status com este id para esperar mais. Enquanto isso, adiante o que não depende desses arquivos.` };
}

export const getCopy = (id: string, jobId: string) => { const c = copies.get(id); return c && c.jobId === jobId ? c : undefined; };

/** Espera a cópia terminar por até `ms` (o pedido HTTP do servidor MCP não pode passar de ~5 min). */
export async function waitCopy(c: Copy, ms = 240_000) {
  const end = Date.now() + ms;
  while (!c.done && Date.now() < end) await new Promise((r) => setTimeout(r, 3000));
  return copyStatus(c);
}
