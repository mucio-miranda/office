import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * Troca o squad de um cliente direto no squads.json (o mesmo que as skills leem): tira o cliente de onde estava e
 * põe no squad escolhido (null = sem squad), guardando o que já estava anotado nele (status, observações). Devolve
 * o caminho do arquivo, para quem chamou registrar no histórico das skills.
 */
export function setClientSquad(office: { rootPath: string; driveRoot?: string | null }, c: { name: string; folder: string | null; dir: string | null }, squadId: string | null) {
  const file = path.join(office.rootPath, '.claude', 'skills', '_global', 'squads.json');
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const raw = JSON.parse(text);
  if (!Array.isArray(raw.squads)) throw new Error('squads.json sem a lista de squads.');
  const keys = [c.folder ? base(c.folder) : '', squadKey(c.name)].filter(Boolean);
  const same = (e: any) => keys.includes(typeof e?.pasta === 'string' ? base(e.pasta) : '') || keys.includes(typeof e?.nome === 'string' ? squadKey(e.nome) : '');
  let kept: any = null;
  for (const sq of raw.squads) {
    if (!Array.isArray(sq.clientes)) continue;
    const old = sq.clientes.find(same);
    if (old && !kept) kept = old;
    sq.clientes = sq.clientes.filter((e: any) => !same(e));
  }
  if (squadId) {
    const target = raw.squads.find((sq: any) => sq.id === squadId);
    if (!target) throw new Error('Squad não encontrado.');
    // a pasta vai relativa ao Drive da agência, como as outras (o atalho em Documents\REZZU leva até ela)
    let pasta: string | null = kept?.pasta ?? null;
    if (c.dir && office.driveRoot) {
      let real = c.dir;
      try { real = realpathSync(c.dir); } catch { /* pasta fora do ar */ }
      const rel = path.relative(office.driveRoot, real);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) pasta = rel.split(path.sep).join('/');
    }
    target.clientes = [...(target.clientes ?? []), { ...(kept ?? {}), nome: kept?.nome ?? c.name, pasta }];
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(file, `${JSON.stringify(raw, null, 2).replace(/\n/g, eol)}${eol}`, 'utf8');
  cached = null;
  return file;
}
