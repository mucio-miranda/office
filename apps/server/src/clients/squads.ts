import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Squads da agência: cada cliente é atendido por um grupo (uma social media e um designer, por exemplo).
 * O mapa fica em `<raiz>/.claude/skills/_global/squads.json`, o mesmo que as skills leem; sem o arquivo, não há squads.
 * Cada squad lista os clientes com a pasta deles; o Office liga o cliente ao squad pelo nome da pasta (ou pelo nome).
 */
export interface Squad {
  id: string;
  nome: string;
  socialMedia: string | null;
  designProducao: string | null;
  /** Nomes de pasta e de cliente normalizados (sem acento, maiúsculas), para casar com os clientes do Office. */
  match: string[];
}

export const squadKey = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[\\/]+$/, '').trim().toUpperCase();
const base = (p: string) => squadKey(p.split(/[\\/]/).filter(Boolean).pop() ?? '');

let cached: { file: string; mtime: number; squads: Squad[] } | null = null;

export function squadsOf(rootPath?: string | null): Squad[] {
  if (!rootPath) return [];
  const file = path.join(rootPath, '.claude', 'skills', '_global', 'squads.json');
  try {
    const mtime = statSync(file).mtimeMs;
    if (cached?.file === file && cached.mtime === mtime) return cached.squads;
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const squads: Squad[] = (Array.isArray(raw.squads) ? raw.squads : []).filter((s: any) => s && typeof s.id === 'string').map((s: any) => ({
      id: s.id,
      nome: typeof s.nome === 'string' ? s.nome : s.id,
      socialMedia: typeof s.social_media === 'string' ? s.social_media : null,
      designProducao: typeof s.design_producao === 'string' ? s.design_producao : null,
      match: (Array.isArray(s.clientes) ? s.clientes : []).flatMap((c: any) => [
        typeof c?.pasta === 'string' ? base(c.pasta) : '',
        typeof c?.nome === 'string' ? squadKey(c.nome) : '',
      ]).filter(Boolean),
    }));
    cached = { file, mtime, squads };
    return squads;
  } catch {
    return [];
  }
}

/** Squad de um cliente: pelo nome da pasta, senão pelo nome do cliente. */
export function squadOfClient(squads: Squad[], c: { name: string; folder: string | null }) {
  const keys = [c.folder ? base(c.folder) : '', squadKey(c.name)].filter(Boolean);
  return squads.find((s) => keys.some((k) => s.match.includes(k)))?.id ?? null;
}
