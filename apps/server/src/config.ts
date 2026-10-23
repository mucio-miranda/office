import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

export const config = {
  port: Number(process.env.PORT ?? 4747),
  /** 0.0.0.0 deixa a equipe entrar pela rede local. Use 127.0.0.1 para só esta máquina. */
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.OFFICE_DATA ?? path.join(REPO_ROOT, 'data')),
  agentTemplatesDir: path.join(REPO_ROOT, 'agents'),
  webDist: path.join(REPO_ROOT, 'apps/web/dist'),
  claudeBin: resolveClaude(),
  /** Quantos funcionários de IA podem trabalhar ao mesmo tempo. */
  maxConcurrentJobs: Number(process.env.OFFICE_MAX_JOBS ?? 2),
};

/**
 * No Windows o `claude` instalado pelo npm é um .cmd que chama um .exe nativo.
 * Chamar o .exe direto evita passar o prompt pelo cmd.exe (que quebra aspas e quebras de linha).
 */
function resolveClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const exe = path.join(process.env.APPDATA, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
    if (existsSync(exe)) return exe;
  }
  return 'claude';
}
