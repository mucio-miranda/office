import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Mapa das pastas de um cliente: onde fica a IDV, o mês, os brutos, os trabalhos. Duas estruturas convivem:
 * - "novo": <cliente>/REDES SOCIAIS (o que o cliente vê) + <cliente>/ARQUIVOS – CLIENTE (só a equipe);
 * - "antigo": <cliente>/DOCUMENTOS, FOTOS e VIDEOS.
 * Cada pasta de cliente é lida como está: a nova quando existe REDES SOCIAIS ou ARQUIVOS – …, senão a antiga.
 * A agência pode trocar os nomes com `.claude/skills/_global/pastas.json` (o mesmo mapa que as skills usam).
 */

export type LayoutKey =
  | 'redes' | 'arquivos' | 'idv_kit' | 'perfil' | 'mes' | 'legendas' | 'ensaios' | 'making_of' | 'fotos_editadas'
  | 'trabalhos' | 'documentos' | 'idv' | 'projetos' | 'referencias' | 'brutos' | 'fotos_brutas' | 'videos_brutos'
  | 'banco' | 'musicas' | 'sfx' | 'broll' | 'sem_data';

export interface LayoutMap { inativos: string; novo: Record<LayoutKey, string>; antigo: Record<LayoutKey, string> }

export const DEFAULT_LAYOUT: LayoutMap = {
  inativos: 'CLIENTES/INATIVOS',
  novo: {
    redes: 'REDES SOCIAIS',
    arquivos: 'ARQUIVOS – {CLIENTE}',
    idv_kit: '{redes}/IDENTIDADE VISUAL',
    perfil: '{redes}/IDENTIDADE VISUAL/PERFIL E DESTAQUES',
    mes: '{redes}/{AAAA}-{MM} {Mes} – {Cliente}',
    legendas: '{mes}/LEGENDAS – {Mes} – {Cliente}.pdf',
    ensaios: '{mes}/ENSAIOS – {Mes}',
    making_of: '{ensaios}/Making Of – {Mes} – {Cliente}',
    fotos_editadas: '{ensaios}/Fotos Editadas – {Mes}',
    trabalhos: '{arquivos}/TRABALHOS',
    documentos: '{arquivos}/DOCUMENTOS',
    idv: '{arquivos}/DOCUMENTOS/IDENTIDADE VISUAL',
    projetos: '{arquivos}/PROJETOS',
    referencias: '{arquivos}/REFERENCIAS',
    brutos: '{arquivos}/BRUTOS',
    fotos_brutas: '{brutos}/{captacao}/FOTOS BRUTAS',
    videos_brutos: '{brutos}/{captacao}/VIDEOS BRUTOS',
    banco: '{arquivos}/BANCO E MUSICAS',
    musicas: '{banco}',
    sfx: '{banco}/EFEITOS SONOROS',
    broll: '{banco}/BROLL',
    sem_data: '{arquivos}/SEM DATA',
  },
  antigo: {
    redes: '.', arquivos: '.',
    idv_kit: 'DOCUMENTOS/IDENTIDADE VISUAL', perfil: 'DOCUMENTOS/IDENTIDADE VISUAL',
    mes: 'DOCUMENTOS/ARTES', legendas: 'DOCUMENTOS/ARTES/LEGENDAS.pdf',
    ensaios: 'FOTOS/EDITADAS', making_of: 'VIDEOS/EDITADOS', fotos_editadas: 'FOTOS/EDITADAS',
    trabalhos: 'TRABALHOS', documentos: 'DOCUMENTOS', idv: 'DOCUMENTOS/IDENTIDADE VISUAL', projetos: 'DOCUMENTOS/ARTES',
    referencias: 'VIDEOS/REFERENCIAS', brutos: '.',
    fotos_brutas: 'FOTOS/BRUTAS/{captacao}', videos_brutos: 'VIDEOS/BRUTOS/{captacao}',
    banco: 'FOTOS/BANCO', musicas: 'VIDEOS/MUSICAS', sfx: 'VIDEOS/MUSICAS/EFEITOS SONOROS', broll: 'VIDEOS/BROLL',
    sem_data: 'DOCUMENTOS',
  },
};

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

let cached: { file: string; mtime: number; map: LayoutMap } | null = null;

/** O mapa da agência (`<raiz>/.claude/skills/_global/pastas.json`), completando o que faltar com o padrão. */
export function layoutMap(rootPath?: string | null): LayoutMap {
  if (!rootPath) return DEFAULT_LAYOUT;
  const file = path.join(rootPath, '.claude', 'skills', '_global', 'pastas.json');
  try {
    const mtime = statSync(file).mtimeMs;
    if (cached?.file === file && cached.mtime === mtime) return cached.map;
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const map: LayoutMap = {
      inativos: typeof raw.inativos === 'string' ? raw.inativos : DEFAULT_LAYOUT.inativos,
      novo: { ...DEFAULT_LAYOUT.novo, ...(raw.novo ?? {}) },
      antigo: { ...DEFAULT_LAYOUT.antigo, ...(raw.antigo ?? {}) },
    };
    cached = { file, mtime, map };
    return map;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

const dirsOf = (dir: string) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name); } catch { return []; }
};

/** A pasta já está na estrutura nova? */
export function isNewLayout(dir: string, map: LayoutMap = DEFAULT_LAYOUT) {
  return existsSync(path.join(dir, map.novo.redes)) || dirsOf(dir).some((n) => /^ARQUIVOS\b/i.test(n));
}

/** Nome de exibição do cliente para as pastas do mês: o do marca.json ou o da pasta, com iniciais maiúsculas. */
function displayName(dir: string, idvDir: string) {
  try {
    const nome = JSON.parse(readFileSync(path.join(idvDir, 'marca.json'), 'utf8').replace(/^﻿/, '')).nome;
    if (typeof nome === 'string' && nome.trim()) return nome.trim();
  } catch { /* sem marca.json */ }
  return path.basename(dir).toLowerCase().replace(/(^|\s)(\S)/g, (_, s: string, c: string) => s + c.toUpperCase());
}

export interface ClientPaths {
  estrutura: 'novo' | 'antigo';
  /** Caminho relativo à pasta do cliente (com "/"); "" é a própria pasta. */
  rel(key: LayoutKey, opts?: { mes?: string | Date; captacao?: string }): string;
  /** Caminho absoluto. */
  abs(key: LayoutKey, opts?: { mes?: string | Date; captacao?: string }): string;
  marca: string;
  idvMd: string;
}

/** As pastas de um cliente, na estrutura em que ele está. */
export function clientPaths(dir: string, map: LayoutMap = DEFAULT_LAYOUT, force?: 'novo' | 'antigo'): ClientPaths {
  const estrutura = force ?? (isNewLayout(dir, map) ? 'novo' : 'antigo');
  const modelos = map[estrutura];
  const upper = path.basename(dir).toUpperCase();
  const arquivosDir = estrutura === 'novo'
    ? dirsOf(dir).find((n) => /^ARQUIVOS\b/i.test(n)) ?? modelos.arquivos.replace('{CLIENTE}', upper)
    : '.';
  let nome: string | null = null;
  const rel = (key: LayoutKey, opts: { mes?: string | Date; captacao?: string } = {}): string => {
    const when = opts.mes instanceof Date ? opts.mes : opts.mes ? new Date(`${String(opts.mes).slice(0, 7)}-15T12:00:00`) : new Date();
    const a = when.getFullYear(), m = when.getMonth() + 1;
    const resolve = (k: LayoutKey): string => {
      if (k === 'arquivos') return arquivosDir;
      if (k === 'mes' && estrutura === 'novo') {
        const prefix = `${a}-${String(m).padStart(2, '0')} `;
        const ja = dirsOf(path.join(dir, modelos.redes)).find((n) => n.startsWith(prefix));
        if (ja) return `${modelos.redes}/${ja}`;
      }
      let t = modelos[k];
      for (const ref of t.match(/\{([a-z_]+)\}/g) ?? []) {
        const name = ref.slice(1, -1) as LayoutKey;
        if (name in modelos) t = t.replace(ref, resolve(name));
      }
      if (t.includes('{Cliente}')) nome ??= displayName(dir, path.join(dir, ...resolve('idv').split('/')));
      return t
        .replaceAll('{CLIENTE}', upper).replaceAll('{Cliente}', nome ?? '')
        .replaceAll('{AAAA}', String(a)).replaceAll('{MM}', String(m).padStart(2, '0')).replaceAll('{Mes}', MESES[m - 1])
        .replaceAll('{captacao}', opts.captacao || `${new Date().toISOString().slice(0, 10)} sem nome`);
    };
    return resolve(key).split('/').filter((s) => s && s !== '.').join('/');
  };
  const abs = (key: LayoutKey, opts?: { mes?: string | Date; captacao?: string }) => path.join(dir, ...rel(key, opts).split('/'));
  return { estrutura, rel, abs, marca: path.join(abs('idv'), 'marca.json'), idvMd: path.join(abs('idv'), 'IDV.md') };
}
