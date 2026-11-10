import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Office, SkillsState } from '@office/shared';

/**
 * As skills de cada escritório: a pasta `.claude/skills` da raiz dele, sempre com histórico (git local) para que
 * toda mudança aplicada pela Mesa possa ser desfeita. A cópia remota é opcional e é da agência: o Office só usa o
 * acesso que já existe na máquina, nunca guarda senha nem token.
 */
export const skillsDirOf = (office: Pick<Office, 'rootPath'>) => path.join(office.rootPath, '.claude', 'skills');

const run = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { windowsHide: true, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryRun = (dir: string, ...args: string[]) => { try { return run(dir, ...args); } catch { return ''; } };
/** Sem nome configurado no git (PC novo), o registro sai assinado pelo Office em vez de não sair. */
const identity = (dir: string) => (tryRun(dir, 'config', 'user.name') ? [] : ['-c', 'user.name=Office', '-c', 'user.email=office@localhost']);
export const commitAll = (dir: string, message: string, files?: string[]) => {
  run(dir, 'add', '--', ...(files?.length ? files : ['.']));
  if (!tryRun(dir, 'diff', '--cached', '--name-only')) return null;
  run(dir, ...identity(dir), 'commit', '-q', '-m', message);
  return run(dir, 'rev-parse', '--short', 'HEAD');
};

const isGit = (dir: string) => existsSync(path.join(dir, '.git'));
const skillFolders = (dir: string) =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && existsSync(path.join(dir, e.name, 'SKILL.md'))).map((e) => e.name) : [];

/** Endereço do repositório sem credencial embutida: um token na URL ficaria gravado em texto puro. */
export function cleanRemote(url: string) {
  const u = url.trim();
  if (/^git@[\w.-]+:[\w./-]+$/.test(u)) return u;
  let parsed: URL;
  try { parsed = new URL(u); } catch { throw new Error('Endereço inválido. Use https://… ou git@….'); }
  if (parsed.protocol !== 'https:') throw new Error('Use um endereço https:// ou git@….');
  if (parsed.username || parsed.password) throw new Error('Não coloque usuário, senha ou token no endereço: o acesso fica no gerenciador de credenciais do Windows.');
  return parsed.toString().replace(/\/$/, '');
}

export function skillsState(office: Pick<Office, 'rootPath'>): SkillsState {
  const dir = skillsDirOf(office);
  const exists = existsSync(dir);
  const git = exists && isGit(dir);
  const last = git ? tryRun(dir, 'log', '-1', '--format=%h%x09%cI%x09%s') : '';
  const [ref, at, subject] = last ? last.split('\t') : [];
  const remote = git ? tryRun(dir, 'remote', 'get-url', 'origin') : '';
  const pending = git ? tryRun(dir, 'status', '--porcelain').split('\n').filter(Boolean).length : 0;
  const ahead = git && remote ? Number(tryRun(dir, 'rev-list', '--count', '@{u}..HEAD') || 0) : 0;
  return {
    dir, exists, skills: skillFolders(dir), history: git,
    last: ref ? { ref, at, subject } : null,
    // um endereço antigo com token embutido não volta para a tela
    remote: remote ? remote.replace(/\/\/[^@/]+@/, '//') : null,
    pending, unpushed: ahead,
  };
}

/** Liga o histórico: cria a pasta se faltar, o git local e o primeiro registro. Não apaga nem move nada. */
export function startHistory(office: Pick<Office, 'rootPath'>) {
  const dir = skillsDirOf(office);
  mkdirSync(dir, { recursive: true });
  if (!isGit(dir)) run(dir, 'init', '-q');
  if (tryRun(dir, 'rev-parse', '--verify', 'HEAD')) return null;
  // primeiro registro, mesmo com a pasta vazia: daqui para frente toda mudança tem para onde voltar
  run(dir, 'add', '--', '.');
  run(dir, ...identity(dir), 'commit', '-q', '--allow-empty', '-m', 'Office: começo do histórico das skills');
  return run(dir, 'rev-parse', '--short', 'HEAD');
}

/**
 * Traz skills de outra pasta (um `.claude/skills` ou uma pasta com as skills dentro). Só copia as que ainda não
 * existem aqui: uma skill com o mesmo nome fica como está.
 */
export function importSkills(office: Pick<Office, 'rootPath'>, from: string) {
  const dir = skillsDirOf(office);
  const src = path.resolve(existsSync(path.join(from, '.claude', 'skills')) ? path.join(from, '.claude', 'skills') : from);
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`A pasta ${from} não existe.`);
  if (path.resolve(src) === path.resolve(dir)) throw new Error('Essa já é a pasta de skills deste escritório.');
  const found = skillFolders(src);
  if (!found.length) throw new Error('Não achei skills nessa pasta (cada skill é uma pasta com SKILL.md).');
  startHistory(office);
  const have = new Set(skillFolders(dir));
  const copied = found.filter((s) => !have.has(s));
  for (const s of copied) cpSync(path.join(src, s), path.join(dir, s), { recursive: true, errorOnExist: false, force: false, filter: (p) => !p.split(path.sep).includes('.git') });
  for (const f of ['README.md', 'INSIGHTS-PRODUCAO.md']) if (existsSync(path.join(src, f)) && !existsSync(path.join(dir, f))) cpSync(path.join(src, f), path.join(dir, f));
  const ref = copied.length ? commitAll(dir, `Office: ${copied.length} skill(s) importada(s) de ${path.basename(path.dirname(src)) || src}`) : null;
  return { copied, skipped: found.filter((s) => have.has(s)), ref };
}

/** Liga (ou desliga, com null) a cópia remota. O acesso é o que a máquina já tem. */
export function setRemote(office: Pick<Office, 'rootPath'>, url: string | null) {
  const dir = skillsDirOf(office);
  startHistory(office);
  const has = !!tryRun(dir, 'remote', 'get-url', 'origin');
  if (!url) { if (has) run(dir, 'remote', 'remove', 'origin'); return null; }
  const clean = cleanRemote(url);
  run(dir, 'remote', has ? 'set-url' : 'add', 'origin', clean);
  return clean;
}

/** Envia o histórico para a cópia remota. Erros de acesso voltam como mensagem, sem pedir senha. */
export function pushSkills(office: Pick<Office, 'rootPath'>) {
  const dir = skillsDirOf(office);
  if (!isGit(dir) || !tryRun(dir, 'remote', 'get-url', 'origin')) throw new Error('Ligue a cópia remota antes.');
  try {
    execFileSync('git', ['-C', dir, 'push', '-u', 'origin', 'HEAD'], { windowsHide: true, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).split('\n').find((l) => /fatal|error|denied|not found/i.test(l)) ?? 'falhou';
    throw new Error(`Não consegui enviar: ${msg.trim()}. Confira o endereço e se esta máquina tem acesso ao repositório.`);
  }
}
