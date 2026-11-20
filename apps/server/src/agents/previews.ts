import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Prévia ao vivo: cada vídeo ou imagem que o funcionário gera (render, prévia, folha de quadros) ou abre para conferir
 * entra aqui na hora, pelo gancho do Claude Code. O estúdio mostra o último e a equipe comenta no minuto exato,
 * sem abrir app nenhum na tela. Só o que passou por aqui pode ser servido (a lista é a permissão).
 */

export interface Preview { path: string; at: string; kind: 'video' | 'imagem'; size: number; mtime: number }

const MEDIA = /\.(mp4|mov|m4v|webm|png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const MAX = 40;
const lists = new Map<string, Preview[]>();

/** Caminhos de mídia citados num comando ou na saída dele: entre aspas, entre crases ou soltos. */
export function mediaPaths(text: string, cwd?: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const p = raw.trim().replace(/[.,;:)\]]+$/, '');
    if (!MEDIA.test(p)) return;
    out.add(path.isAbsolute(p) || !cwd ? p : path.resolve(cwd, p));
  };
  for (const m of text.matchAll(/["'`]([^"'`\n]+)["'`]/g)) add(m[1]);
  for (const m of text.matchAll(/(?:[A-Za-z]:[\\/]|\\\\|\.{0,2}[\\/])?[^\s"'`<>|*?\n=]+\.(?:mp4|mov|m4v|webm|png|jpe?g|webp)\b/gi)) add(m[0]);
  return [...out];
}

/**
 * Mídia nova dentro das pastas citadas ("pronto: 40 s em C:\...\saida", "folhas em conf/final_*.jpg"): os scripts de
 * edição costumam dizer a pasta, não o arquivo. Só um nível, só o que mudou desde `since`, poucos por vez.
 */
export function mediaInDirs(text: string, cwd: string | undefined, since: number): string[] {
  const dirs = new Set<string>();
  const add = (raw: string) => {
    let p = raw.trim().replace(/[.,;:)\]]+$/, '');
    if (!p) return;
    if (/[*?]/.test(p) || MEDIA.test(p) || /\.\w{1,5}$/.test(p)) p = path.dirname(p);
    const abs = path.isAbsolute(p) ? p : cwd ? path.resolve(cwd, p) : '';
    if (!abs || abs.length < 4) return;
    try { if (statSync(abs).isDirectory()) dirs.add(abs); } catch { /* não é pasta */ }
  };
  for (const m of text.matchAll(/["'`]([^"'`\n]+)["'`]/g)) add(m[1]);
  for (const m of text.matchAll(/(?:[A-Za-z]:[\\/]|\\\\)[^\n"'`<>|]+/g)) add(m[0]);
  const out: { f: string; t: number }[] = [];
  for (const d of [...dirs].slice(0, 10)) {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (!MEDIA.test(n) || n.startsWith('._')) continue;
      const f = path.join(d, n);
      try { const st = statSync(f); if (st.isFile() && st.mtimeMs >= since) out.push({ f, t: st.mtimeMs }); } catch { /* sumiu */ }
    }
  }
  return out.sort((a, b) => a.t - b.t).slice(-12).map((x) => x.f);
}

/** Registra o que existe de fato e mudou desde a última vez; devolve quantos entraram. */
export function addPreviews(jobId: string, files: string[], since = 0): number {
  const list = lists.get(jobId) ?? [];
  let n = 0;
  for (const f of files) {
    if (path.basename(f).startsWith('._') || !existsSync(f)) continue;
    let st;
    try { st = statSync(f); } catch { continue; }
    if (!st.isFile() || st.size === 0 || st.mtimeMs < since) continue;
    const key = path.resolve(f).toLowerCase();
    const prev = list.findIndex((p) => path.resolve(p.path).toLowerCase() === key);
    if (prev >= 0) {
      if (list[prev].mtime === st.mtimeMs) continue;
      list.splice(prev, 1);
    }
    list.push({ path: path.resolve(f), at: new Date().toISOString(), kind: VIDEO.test(f) ? 'video' : 'imagem', size: st.size, mtime: st.mtimeMs });
    n++;
  }
  if (list.length > MAX) list.splice(0, list.length - MAX);
  if (n) lists.set(jobId, list);
  return n;
}

export const previewsOf = (jobId: string) => [...(lists.get(jobId) ?? [])].reverse();

/** O arquivo só sai se a tarefa registrou ele (e ele ainda existe). */
export function previewFileOf(jobId: string, file: string) {
  const key = path.resolve(file).toLowerCase();
  const hit = lists.get(jobId)?.find((p) => path.resolve(p.path).toLowerCase() === key);
  return hit && existsSync(hit.path) ? hit.path : null;
}

export const clearPreviews = (jobId: string) => lists.delete(jobId);
