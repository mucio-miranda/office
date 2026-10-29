import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Demand, Office, ReviewMark, Stage } from '@office/shared';

/**
 * Peças que cada etapa da esteira produz: onde a etapa grava, quais arquivos saíram de uma tarefa (para a mesa
 * do diretor de arte mostrar as versões) e a legenda que vai no pacote de publicação.
 */

export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'peca';

/** Onde a etapa grava, dentro da pasta do cliente: um arquivo (pauta, copy) ou uma pasta (arte, vídeo). */
export function stageOutput(stage: Stage, d: Demand, dir: string): { path: string; isDir: boolean } | null {
  const name = slug(d.title);
  const p = (...parts: string[]) => path.join(dir, ...parts);
  switch (stage) {
    case 'pauta': return { path: p('DOCUMENTOS', 'PAUTAS', `${name}.md`), isDir: false };
    case 'copy': return { path: p('DOCUMENTOS', 'COPYS', `${name}.md`), isDir: false };
    case 'arte': return { path: p('DOCUMENTOS', 'ARTES', name), isDir: true };
    case 'video': return { path: p('VIDEOS', 'EDITADOS', name), isDir: true };
    default: return null;
  }
}

/** Caminhos completos citados no texto (o resumo final do funcionário), sem a pontuação em volta. */
export function pathsInText(text: string): string[] {
  // caminhos entre crases podem ter espaços (pastas como "DOCUMENTOS/ARTES/post 1")
  const quoted = [...text.matchAll(/`((?:[A-Za-z]:[\\/]|\\\\|\/)[^`\n]+)`/g)].map((m) => m[1].trim());
  const out = new Set<string>(quoted);
  // sem crases, o caminho termina no primeiro espaço ("... em C:\pasta\arte.png e o PSD")
  for (const m of text.matchAll(/(?:[A-Za-z]:[\\/]|\\\\)[^\s`'"<>|*?\n]+/g)) {
    const p = m[0].replace(/[.,;:)\]]+$/, '');
    if (!quoted.some((q) => q.startsWith(p))) out.add(p);
  }
  return [...out];
}

const listFiles = (dir: string, depth = 2): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 1) out.push(...listFiles(full, depth - 1)); } else out.push(full);
  }
  return out;
};

/**
 * Arquivos que uma tarefa produziu: os citados na resposta final que existem dentro das pastas do escritório e
 * os que mudaram na saída da etapa desde que a tarefa começou (o funcionário às vezes esquece de citar algum).
 */
export function producedFiles(opts: { finalText: string; since: string; stage: Stage; d: Demand; clientDir: string; inside: (p: string) => boolean }) {
  const since = Date.parse(opts.since) - 5000;
  const found = new Set<string>();
  for (const raw of pathsInText(opts.finalText)) {
    const p = path.resolve(raw);
    if (!opts.inside(p) || !existsSync(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) listFiles(p).forEach((f) => found.add(f));
    else found.add(p);
  }
  const out = stageOutput(opts.stage, opts.d, opts.clientDir);
  if (out) {
    // a copy e a pauta podem sair como "<nome>-v2.md": vale qualquer arquivo da pasta que começa com o nome
    const candidates = out.isDir ? listFiles(out.path) : listFiles(path.dirname(out.path), 1).filter((f) => path.basename(f).startsWith(path.basename(out.path, '.md')));
    // o que já é de uma versão anterior desta etapa só entra se o funcionário citou de novo
    const before = new Set((opts.d.stageLog ?? []).filter((e) => e.stage === opts.stage).flatMap((e) => e.files ?? []));
    for (const f of candidates) if (!before.has(f) && statSync(f).mtimeMs >= since) found.add(f);
  }
  return [...found].sort().slice(0, 40);
}

/** Texto do pedido de ajuste com as áreas marcadas, do jeito que o funcionário vai ler. */
export function marksText(marks: ReviewMark[]) {
  if (!marks.length) return '';
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return `Áreas marcadas pelo diretor de arte (medidas a partir do canto superior esquerdo da imagem):\n${marks.map((m, i) =>
    `${i + 1}. \`${m.file}\`: de ${pct(m.x)} a ${pct(m.x + m.w)} da largura e de ${pct(m.y)} a ${pct(m.y + m.h)} da altura. ${m.note.trim()}`).join('\n')}`;
}

/** Legenda do post: a seção "Legenda" da copy, se houver; senão a copy inteira. */
export function captionFrom(copyFile: string | undefined) {
  if (!copyFile || !existsSync(copyFile)) return '';
  const lines = readFileSync(copyFile, 'utf8').split(/\r?\n/);
  const head = (l: string) => /^#{1,4}\s/.test(l);
  const i = lines.findIndex((l) => head(l) && /legenda/i.test(l));
  if (i < 0) return lines.join('\n').trim().slice(0, 2200);
  const end = lines.findIndex((l, k) => k > i && head(l));
  return lines.slice(i + 1, end < 0 ? undefined : end).join('\n').trim().slice(0, 2200);
}

/** As peças da versão mais recente de cada etapa de produção, da última para a primeira (arte/vídeo antes da copy). */
export function latestFiles(d: Demand): { byStage: Partial<Record<Stage, string[]>>; final: string[] } {
  const byStage: Partial<Record<Stage, string[]>> = {};
  for (const e of d.stageLog ?? []) if (e.files?.length && e.result === 'feito') byStage[e.stage] = e.files;
  const final = byStage.video ?? byStage.arte ?? byStage.copy ?? byStage.pauta ?? [];
  return { byStage, final };
}

export const isInsideAny = (office: Office) => (p: string) => {
  const roots = [office.rootPath, ...office.extraDirs].map((r) => path.resolve(r).toLowerCase());
  const abs = path.resolve(p).toLowerCase();
  return roots.some((r) => abs === r || abs.startsWith(r + path.sep));
};
