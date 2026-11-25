import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { parseFrontmatter } from './templates.ts';

export function codexExecutable() {
  if (process.env.OFFICE_CODEX_BIN) return existsSync(process.env.OFFICE_CODEX_BIN) ? process.env.OFFICE_CODEX_BIN : null;
  if (process.platform === 'win32') {
    const target = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const base = path.join(process.env.APPDATA ?? '', 'npm/node_modules/@openai/codex/node_modules/@openai');
    const exe = path.join(base, 'codex-win32-' + process.arch, 'vendor', target + '-pc-windows-msvc/bin/codex.exe');
    if (existsSync(exe)) return exe;
  }
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name)).find(file => existsSync(file)) ?? null;
}

export function skillCatalog(agency: string) {
  const root = path.join(agency, '.claude', 'skills');
  return readdirSync(root).flatMap(folder => {
    const file = path.join(root, folder, 'SKILL.md');
    if (folder.startsWith('.') || !existsSync(file)) return [];
    const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
    return [{ name: String(data.name ?? folder), file, description: String(data.description ?? '').slice(0, 280) }];
  });
}

export function consultationPrompt(agency: string, cwd: string, briefing: string, message: string, previousContext?: string | null) {
  const catalog = skillCatalog(agency);
  const name = message.trim().match(/^\/([\w-]+)\/?(?:\s|$)/)?.[1];
  const skill = catalog.find(s => s.name === name);
  if (name && !skill) throw new Error('Skill ausente no catálogo da agência: ' + name);
  const rules = [...new Set([path.join(agency, 'CLAUDE.md'), path.join(cwd, 'CLAUDE.md')])]
    .filter(f => existsSync(f)).map(f => readFileSync(f, 'utf8'));
  const context = [
    ...rules, 'Briefing do cliente: ' + briefing,
    'Consulta em modo de leitura do Office. Analise e planeje em português. Use as ferramentas de leitura do Office para consultar documentos em cliente ou skills, com caminhos relativos a cada pasta. Para produzir arquivos, usar Chrome ou sincronizar git, informe a etapa pendente e aguarde a equipe.',
    'Escolha as skills pertinentes ao pedido e consulte o SKILL.md no caminho indicado. Resolva referências a partir da pasta dessa skill.',
    ...catalog.map(s => s.name + ' — ' + s.description + ' (' + path.relative(path.join(agency, '.claude', 'skills'), s.file) + ')'),
  ].join('\n\n');
  const digest = createHash('sha256').update(context).digest('hex');
  const prompt = [
    ...(previousContext === digest ? [] : [context]),
    ...(skill ? ['Skill solicitada em ' + skill.file, readFileSync(skill.file, 'utf8')] : []),
    'Pedido da equipe:', message,
  ].join('\n\n');
  return { prompt, digest };
}

export async function codexTurn(cwd: string, skills: string, thread: string | null, prompt: string) {
  const workDir = path.join(config.dataDir, 'codex-consultas');
  mkdirSync(workDir, { recursive: true });
  const reader = path.join(path.dirname(config.officeMcp), 'codex-read.mjs');
  const readerConfig = '{command=' + JSON.stringify(process.execPath) + ',args=' + JSON.stringify([reader, cwd, skills]) +
    ',enabled_tools=["ler","listar"],default_tools_approval_mode="writes",env={ELECTRON_RUN_AS_NODE="1"}}';
  const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    '--sandbox', 'read-only', '-c', 'mcp_servers.office_consulta=' + readerConfig, '-c', 'web_search="disabled"', '-c', 'approval_policy="never"', '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins', '--disable', 'computer_use'];
  for (const feature of ['shell_tool', 'unified_exec', 'view_image', 'code_mode', 'multi_agent', 'skill_mcp_dependency_install']) args.push('--disable', feature);
  if (thread) args.push('resume', thread);
  args.push('-');
  const bin = codexExecutable();
  if (!bin) throw new Error('Instale o Codex CLI na máquina do Office e conecte sua conta.');
  const script = /\.m?js$/i.test(bin);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(script ? process.execPath : bin, script ? [bin, ...args] : args,
      { cwd: workDir, windowsHide: true, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
      (err, out, stderr) => {
        if (err) {
          const detail = stderr.trim().split(/\r?\n/).at(-1)?.slice(0, 350);
          reject(new Error('Codex interrompeu a consulta (' + (err.code ?? 'tempo esgotado') + '). ' + (detail ?? 'Confira a conexão e o login do Codex.')));
        } else resolve(out);
      });
    child.stdin?.on('error', () => { /* execFile informa falhas ao encerrar o processo. */ });
    child.stdin?.end(prompt, 'utf8');
  });
  let id = thread;
  let complete = false;
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'thread.started') id = event.thread_id;
    if (event.type === 'turn.completed') complete = true;
    if (event.type === 'turn.failed') throw new Error('A rodada do Codex falhou.');
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') messages.push(event.item.text);
  }
  if (!id || !complete || !messages.length || (thread && id !== thread)) throw new Error('Resposta incompleta do Codex. Confira a sessão antes de tentar novamente.');
  return { thread: id as string, text: messages.join('\n\n') };
}
