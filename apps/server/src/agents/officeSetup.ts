import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Conferências da pasta raiz ao criar (ou trocar) um escritório. A raiz é a pasta da agência, a que tem o CLAUDE.md e os
 * clientes; as skills ficam dentro dela, em `.claude/skills`.
 */
const lower = (p: string) => path.resolve(p).toLowerCase();
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const skillCount = (dir: string) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && existsSync(path.join(dir, e.name, 'SKILL.md'))).length; } catch { return 0; }
};

/** A pasta escolhida é a das skills (ou a `.claude`), não a raiz? Devolve a mensagem para a pessoa, ou null. */
export function rootProblem(root: string): string | null {
  const abs = path.resolve(root);
  const base = path.basename(abs).toLowerCase();
  const parent = path.basename(path.dirname(abs)).toLowerCase();
  let up: string | null = null;
  if (base === '.claude') up = path.dirname(abs);
  else if (base === 'skills' && parent === '.claude') up = path.dirname(path.dirname(abs));
  else if (!existsSync(path.join(abs, 'CLAUDE.md')) && skillCount(abs) >= 2) up = path.dirname(abs);
  if (!up) return null;
  return `Essa é a pasta das skills, não a raiz. Escolha a pasta da agência (${up}), onde ficam o CLAUDE.md e os clientes: as skills são lidas dela, em .claude\\skills.`;
}

/** Ancestral comum de vários caminhos (sem diferença de maiúsculas), ou null se for só a raiz de um disco. */
function commonParent(paths: string[]) {
  if (!paths.length) return null;
  const split = paths.map((p) => path.resolve(p).split(path.sep));
  const out: string[] = [];
  for (let i = 0; i < split[0].length; i++) {
    const part = split[0][i];
    if (split.every((s) => s[i]?.toLowerCase() === part.toLowerCase())) out.push(part);
    else break;
  }
  // "H:" ou "H:\Meu Drive" sozinhos são largos demais para liberar inteiros
  return out.length >= 3 ? out.join(path.sep) : null;
}

/**
 * Pastas fora da raiz que o trabalho da agência usa e que o funcionário precisa enxergar:
 * - para onde apontam os atalhos da raiz e de `CLIENTES` (o material que mora no Drive, com atalho no caminho antigo);
 * - as pastas declaradas no `env` do `.claude/settings.json` da raiz (temporários, Drive).
 * A pasta do Drive é a que o `env` chama de DRIVE ou, sem isso, o ancestral comum dos atalhos.
 */
export function detectDirs(root: string): { extraDirs: string[]; driveRoot: string | null } {
  const abs = path.resolve(root);
  const inside = (p: string) => lower(p) === lower(abs) || lower(p).startsWith(lower(abs) + path.sep);
  const targets: string[] = [];
  for (const dir of [abs, path.join(abs, 'CLIENTES')]) {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isSymbolicLink()) continue;
      try {
        const real = realpathSync(path.join(dir, e.name));
        if (isDir(real) && !inside(real)) targets.push(real);
      } catch { /* atalho quebrado: Drive fechado ou disco fora */ }
    }
  }
  const env: Record<string, string> = {};
  try {
    const s = JSON.parse(readFileSync(path.join(abs, '.claude', 'settings.json'), 'utf8')) as { env?: Record<string, unknown> };
    for (const [k, v] of Object.entries(s.env ?? {})) if (typeof v === 'string' && path.isAbsolute(v) && isDir(v) && !inside(v)) env[k] = path.resolve(v);
  } catch { /* sem settings.json */ }
  const common = commonParent(targets);
  const linked = common ? [common] : [...new Set(targets)];
  const driveKey = Object.keys(env).find((k) => /drive/i.test(k));
  const driveRoot = driveKey ? env[driveKey] : common && /drive/i.test(common) ? common : null;
  const seen = new Set<string>();
  const extraDirs = [...linked, ...Object.values(env)].filter((p) => !seen.has(lower(p)) && !!seen.add(lower(p)));
  // uma pasta dentro de outra já liberada não precisa entrar de novo
  return { extraDirs: extraDirs.filter((p) => !extraDirs.some((q) => q !== p && lower(p).startsWith(lower(q) + path.sep))), driveRoot };
}

/** Junta as pastas extras sem repetir. */
export const mergeDirs = (a: string[], b: string[]) => {
  const seen = new Set<string>();
  return [...a, ...b].filter((p) => !seen.has(lower(p)) && !!seen.add(lower(p)));
};
