import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Office, ToolInfo } from '@office/shared';

/**
 * Ferramentas criativas dos funcionários: programas com servidor MCP que o Claude Code de cada
 * tarefa liga via `--mcp-config`. Ficam fora do repositório, em `toolsDir` (ou no PATH).
 */
export const toolsDir = path.resolve(
  process.env.OFFICE_TOOLS_DIR
    ?? (process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Office', 'tools') : path.join(homedir(), '.office', 'tools')),
);

interface ToolDef {
  id: string;
  name: string;
  replaces: string;
  summary: string;
  repo: string;
  /** Executável do servidor MCP (sem .exe). */
  exe: string;
  /** Asset do release para Windows (arch = x64 | arm64); o resto das plataformas instala pelo link. */
  winAsset: (version: string, arch: string) => string;
  sums: string;
  /** Argumentos do servidor MCP, com as pastas que ele pode ler e gravar. */
  args: (office: Office) => string[];
  env?: Record<string, string>;
  /** O que o funcionário lê no prompt de sistema. */
  hint: string;
}

const craftRoots = (office: Office, multi: boolean) => [
  ...(multi ? [office.rootPath, ...office.extraDirs] : [office.rootPath]).flatMap((d) => ['--automation-read-root', d]),
  '--automation-write-root', office.rootPath,
];

const CATALOG: ToolDef[] = [
  {
    id: 'photocraft', name: 'PhotoCraft', replaces: 'Photoshop', repo: 'storytold/photocraft', exe: 'photocraft-cli',
    summary: 'Imagens e PSD com camadas, máscaras, ajustes e exportação.',
    winAsset: (v, a) => `photocraft-${v}-windows-${a}-portable.zip`, sums: 'SHA256SUMS.txt',
    // o PhotoCraft aceita uma pasta de leitura só: a raiz do escritório
    args: (o) => ['mcp', ...craftRoots(o, false)],
    hint: 'edição de imagem e PSD (abrir, camadas, máscaras, ajustes, texto, exportar PNG/JPG/PSD). Só lê e grava dentro da pasta raiz do escritório: para usar um arquivo de outra pasta, copie antes para a pasta de trabalho do cliente.',
  },
  {
    id: 'vectorcraft', name: 'VectorCraft', replaces: 'Illustrator', repo: 'storytold/vectorcraft', exe: 'vectorcraft-cli',
    summary: 'Vetor: SVG, PDF e .ai, logos, ícones e layouts.',
    winAsset: (v, a) => `vectorcraft-${v}-windows-${a}-portable.zip`, sums: 'SHA256SUMS.txt',
    args: (o) => ['mcp', ...craftRoots(o, true)],
    hint: 'vetor (SVG, PDF, .ai): logos, ícones, layouts e exportação. Lê nas pastas do escritório e grava só na pasta raiz.',
  },
  {
    id: 'filmcraft', name: 'FilmCraft', replaces: 'Premiere', repo: 'storytold/filmcraft', exe: 'filmcraft-cli',
    summary: 'Edição de vídeo por comandos: sequência, cortes, títulos e exportação.',
    winAsset: (v, a) => `filmcraft-${v}-windows-${a}-portable.zip`, sums: 'SHA256SUMS.txt',
    args: () => ['mcp'],
    hint: 'edição de vídeo em projeto .fcproj (importar mídia, montar a sequência, cortar, títulos, exportar H.264/ProRes). Use junto com a engine de timeline do Office; nunca grave fora da pasta do cliente.',
  },
  {
    id: 'officecli', name: 'OfficeCLI', replaces: 'Word, Excel e PowerPoint', repo: 'iOfficeAI/OfficeCLI', exe: 'officecli',
    summary: 'Cria, lê e edita DOCX, XLSX e PPTX, e renderiza em HTML ou PNG.',
    winAsset: (_v, a) => `officecli-win-${a}.exe`, sums: 'SHA256SUMS',
    args: () => ['mcp'],
    // sem atualização automática no meio de uma tarefa
    env: { OFFICECLI_SKIP_UPDATE: '1' },
    hint: 'documentos do Office (DOCX, XLSX, PPTX): propostas, relatórios, planilhas e apresentações, com prévia em PNG.',
  },
];

const ext = process.platform === 'win32' ? '.exe' : '';

/** Procura o executável em toolsDir/<id> (até 2 níveis) e depois no PATH. */
function locate(t: ToolDef): string | null {
  const name = t.exe + ext;
  const base = path.join(toolsDir, t.id);
  const walk = (dir: string, depth: number): string | null => {
    if (!existsSync(dir)) return null;
    const direct = path.join(dir, name);
    if (existsSync(direct)) return direct;
    if (depth === 0) return null;
    // versões lado a lado: a mais nova primeiro
    const subdirs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const sub of subdirs) {
      const hit = walk(path.join(dir, sub), depth - 1);
      if (hit) return hit;
    }
    return null;
  };
  const local = walk(base, 2);
  if (local) return local;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [t.exe], { encoding: 'utf8', windowsHide: true });
  const first = r.status === 0 ? r.stdout.split(/\r?\n/).find(Boolean) : undefined;
  return first?.trim() || null;
}

const versions = new Map<string, string | null>();
function version(t: ToolDef, bin: string) {
  const key = `${t.id}:${bin}`;
  if (!versions.has(key)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, ...t.env } });
    versions.set(key, (r.stdout ?? '').match(/\d+\.\d+\.\d+/)?.[0] ?? null);
  }
  return versions.get(key)!;
}

export function listTools(): ToolInfo[] {
  return CATALOG.map((t) => {
    const bin = locate(t);
    return {
      id: t.id, name: t.name, replaces: t.replaces, summary: t.summary, url: `https://github.com/${t.repo}`,
      installed: !!bin, path: bin, version: bin ? version(t, bin) : null,
      canInstall: process.platform === 'win32',
    };
  });
}

/** Configuração MCP de uma tarefa: só as ferramentas do funcionário que estão instaladas. */
export function mcpConfig(ids: string[], office: Office) {
  const servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  const hints: string[] = [];
  for (const t of CATALOG.filter((c) => ids.includes(c.id))) {
    const bin = locate(t);
    if (!bin) continue;
    servers[t.id] = { command: bin, args: t.args(office), ...(t.env ? { env: t.env } : {}) };
    hints.push(`- **${t.name}** (servidor MCP \`${t.id}\`, no lugar do ${t.replaces}): ${t.hint}`);
  }
  return { servers, hints };
}

const gh = async (url: string) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'office-app', Accept: 'application/vnd.github+json' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} em ${url}`);
  return r;
};

const installing = new Set<string>();

/**
 * Baixa o release oficial mais recente (Windows), confere o SHA256 publicado e extrai em
 * toolsDir/<id>/<versão>. Versões antigas ficam onde estão (nada é apagado); vale a mais nova.
 */
export async function installTool(id: string) {
  const t = CATALOG.find((c) => c.id === id);
  if (!t) throw new Error('Ferramenta desconhecida');
  if (process.platform !== 'win32') throw new Error(`Instale pelo site: https://github.com/${t.repo}/releases`);
  if (installing.has(id)) throw new Error(`${t.name} já está sendo instalado.`);
  installing.add(id);
  try {
    const rel = await (await gh(`https://api.github.com/repos/${t.repo}/releases/latest`)).json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
    const v = rel.tag_name.replace(/^v/, '');
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const name = t.winAsset(v, arch);
    const asset = rel.assets.find((a) => a.name === name);
    const sums = rel.assets.find((a) => a.name === t.sums);
    if (!asset || !sums) throw new Error(`O release ${rel.tag_name} não tem ${name} com ${t.sums}.`);
    const expected = (await (await gh(sums.browser_download_url)).text()).split(/\r?\n/)
      .map((l) => l.trim().split(/\s+\*?/)).find((p) => p[1] === name)?.[0]?.toLowerCase();
    const data = Buffer.from(await (await gh(asset.browser_download_url)).arrayBuffer());
    const got = createHash('sha256').update(data).digest('hex');
    if (!expected || expected !== got) throw new Error(`O SHA256 de ${name} não confere com o publicado. Nada foi instalado.`);

    const dest = path.join(toolsDir, id, v);
    mkdirSync(dest, { recursive: true });
    if (name.endsWith('.zip')) {
      const tmp = path.join(toolsDir, '_dl');
      mkdirSync(tmp, { recursive: true });
      const file = path.join(tmp, name);
      writeFileSync(file, data);
      // o tar do Windows 10+ (bsdtar) abre .zip; pelo caminho completo, porque o tar do Git no PATH não entende "C:"
      const tar = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');
      await new Promise<void>((ok, fail) => execFile(tar, ['-xf', file, '-C', dest], { windowsHide: true }, (e) => (e ? fail(e) : ok())));
      // só o .zip que acabamos de baixar
      rmSync(file, { force: true });
    } else {
      writeFileSync(path.join(dest, t.exe + ext), data);
    }
    versions.clear();
    return listTools().find((x) => x.id === id)!;
  } finally {
    installing.delete(id);
  }
}

export const TOOL_IDS = CATALOG.map((t) => t.id);
