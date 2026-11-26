import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Git local pelo Office: o funcionário trabalha na pasta do cliente e não pode trocar de pasta (comando composto é bloqueado),
 * então `git add` e `git commit` no repositório do site não passavam pelas regras de permissão. Aqui o Office roda o
 * subcomando na pasta pedida, sem shell. Só o que fica no computador: enviar (push) continua pelo pedido aprovado.
 */

const ALLOWED = new Set(['init', 'status', 'add', 'commit', 'log', 'diff', 'show', 'branch', 'remote', 'config', 'rev-parse', 'ls-files']);

export function gitArgs(input: { pasta?: unknown; comando?: unknown; args?: unknown }) {
  const pasta = typeof input.pasta === 'string' ? path.normalize(input.pasta.trim()) : '';
  if (!pasta || !path.isAbsolute(pasta) || !existsSync(pasta) || !statSync(pasta).isDirectory()) throw new Error('Mande `pasta` com o caminho completo do repositório (a pasta precisa existir).');
  const cmd = String(input.comando ?? '');
  if (!ALLOWED.has(cmd)) throw new Error(`Subcomando não liberado: ${cmd || '(vazio)'}. Liberados: ${[...ALLOWED].join(', ')}. Enviar e criar repositório no GitHub: pedir_comando.`);
  const args = Array.isArray(input.args) ? input.args.map(String) : [];
  if (args.length > 200 || args.some((a) => a.length > 2000)) throw new Error('Argumentos demais.');
  if (cmd !== 'init' && !existsSync(path.join(pasta, '.git'))) throw new Error('A pasta ainda não é um repositório: rode antes o subcomando init.');
  if (cmd === 'config') {
    const key = args.filter((a) => !a.startsWith('-'))[0];
    const readOnly = args.length === 1 || args.includes('--get') || args.includes('--list') || args.includes('-l');
    if (!readOnly && !/^user\.(name|email)$/.test(key ?? '')) throw new Error('No config só dá para gravar user.name e user.email.');
    if (args.includes('--global') || args.includes('--system')) throw new Error('Só o config deste repositório (sem --global).');
  }
  if (cmd === 'remote' && args[0] && !['add', '-v', 'get-url', 'show', 'set-url'].includes(args[0])) throw new Error('No remote: add, -v, get-url, show ou set-url.');
  if (cmd === 'branch' && args.some((a) => /^-(d|D|-delete)$/.test(a))) throw new Error('Apagar branch não é liberado.');
  return { pasta, args: ['-C', pasta, cmd, ...args] };
}

export function runGit(input: Parameters<typeof gitArgs>[0]) {
  const { args } = gitArgs(input);
  return new Promise<{ ok: boolean; saida: string }>((resolve) => {
    execFile('git', args, { windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat' } },
      (err, stdout, stderr) => resolve({ ok: !err, saida: `${stdout}\n${stderr}`.trim().slice(-6000) || (err ? err.message : '(sem saída)') }));
  });
}
