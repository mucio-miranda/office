import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Client, Office } from '@office/shared';
import { clientDir, insideDir } from '../clients/folder.ts';
import { config, REPO_ROOT } from '../config.ts';
import { sessionImports } from './attachments.ts';
import { codexExecutable, skillCatalog } from './codex.ts';

function contains(a: string, b: string) {
  const rel = path.relative(a, b);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
}

export function startCodexJob(office: Office, client: Client, jobDir: string, thread: string | null, system: string,
  request: string, token: string, lastHumanAt?: string, workerId?: string | null) {
  const exe = codexExecutable();
  if (!exe) throw Error('O Codex CLI está indisponível na máquina do Office.');
  const skills = realpathSync(path.join(office.rootPath, '.claude', 'skills'));
  const folder = clientDir(office, client);
  if (!folder || !existsSync(folder)) throw Error('A pasta do cliente precisa estar disponível.');
  const cwd = realpathSync(folder);
  const linked = office.driveRoot && client.driveFolder ? insideDir(office.driveRoot, client.driveFolder) : null;
  const drive = linked && existsSync(linked) ? realpathSync(linked) : '';
  const settings = path.join(office.rootPath, '.claude', 'settings.json');
  let tempRoot: unknown;
  if (existsSync(settings)) {
    try { tempRoot = JSON.parse(readFileSync(settings, 'utf8')).env?.REZZU_TEMP; } catch { /* Usar temporários locais do Office. */ }
  }
  const tmpBase = typeof tempRoot === 'string' && path.isAbsolute(tempRoot) && existsSync(tempRoot) ? realpathSync(tempRoot) : realpathSync(jobDir);
  const tmp = path.join(tmpBase, 'office-' + path.basename(jobDir));
  const protectedDirs = [skills, realpathSync(office.rootPath)];
  for (const dest of [cwd, drive, existsSync(tmp) ? realpathSync(tmp) : tmp].filter(Boolean)) {
    if (dest === path.parse(dest).root || protectedDirs.some(p => contains(dest, p)) || contains(skills, dest))
      throw Error('Selecione uma pasta exclusiva do cliente para gravar as entregas.');
  }

  mkdirSync(tmp, { recursive: true });
  const sourceDir = path.dirname(config.officeMcp);
  const args = ['exec', '--json', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'read-only',
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"'];
  for (const feature of ['shell_tool','unified_exec','hooks','apps','plugins','computer_use','view_image','code_mode','multi_agent','skill_mcp_dependency_install']) args.push('--disable', feature);
  const register = (name: string, script: string, params: string[], options: string) => {
    args.push('-c', 'mcp_servers.' + name + '={command=' + JSON.stringify(process.execPath) + ',args=' +
      JSON.stringify([path.join(sourceDir, script), ...params]) + ',env={ELECTRON_RUN_AS_NODE="1"},' + options + '}');
  };
  const envKeys = 'env_vars=["OFFICE_JOB_TOKEN","OFFICE_API","OFFICE_CODEX_EXE","OFFICE_LAST_HUMAN_AT","OFFICE_IMPORT_DIR"]';
  register('arquivos', 'codex-read.mjs', [cwd, skills, tmp, drive], 'default_tools_approval_mode="writes"');
  const render = path.join(sourceDir, 'office-render.mjs');
  const renderArgs = existsSync(render) ? [render] : ['--import', import.meta.resolve('tsx'), path.join(REPO_ROOT, 'packages/video-engine/src/cli.ts')];
  register('producao', 'codex-tools.mjs', [cwd, skills, tmp, drive, ...renderArgs], envKeys + ',tool_timeout_sec=2100,default_tools_approval_mode="approve"');
  register('office', 'office-mcp.mjs', [], envKeys + ',enabled_tools=["calendario_listar","calendario_salvar","posts_do_mes","pedir_ajudante","navegador_liberar"],default_tools_approval_mode="approve"');
  if (existsSync(config.claudeBin)) register('chrome', 'codex-chrome.mjs',
    [config.claudeBin, path.join(jobDir,'maquinas-listadas'), randomUUID(), ...[cwd, tmp, drive].filter(Boolean)], envKeys + ',default_tools_approval_mode="approve"');
  if (thread) args.push('resume', thread);
  args.push('-');
  const docs = [...new Set([path.join(office.rootPath,'CLAUDE.md'), path.join(cwd,'CLAUDE.md')])].filter(f => existsSync(f)).map(f => readFileSync(f,'utf8'));
  const catalog = skillCatalog(office.rootPath);
  const chosen = catalog.filter(s => request.includes('`' + s.name + '`'));
  const prompt = [system, ...docs,
    'Execute a demanda com as ferramentas do Office. Leia as skills e suas referências na pasta skills, execute seus scripts originais com executar_skill. Gere versões novas com gravar_arquivo, entregue resultados com entregar_arquivo. Informe o caminho completo devolvido pela ferramenta para a Mesa. Se uma ferramenta falhar, corrija ou informe a etapa pendente.',
    'Anexos marcados como importados: use copiar_para_local com de=importados e o caminho relativo indicado. Para scripts que usam o Drive, copie primeiro os arquivos ou pastas para temporarios. Para capas HTML da skill, use exportar_composicao e confira a prévia; para vídeo, confira o relatório de áudio. Entregue o PNG/JPG e o MP4 na pasta cliente com entregar_arquivo se estiverem em temporarios, e cite os caminhos finais entre crases para a Mesa. Antes de enviar arquivos pelo Chrome confira acesso e tamanho com conferir_anexos.',
    'Pasta cliente: ' + cwd, drive && 'Drive autorizado: ' + drive, 'Temporários desta demanda: ' + tmp,
    'Chrome: antes da primeira ação liste as máquinas e peça a escolha à equipe com [[AGUARDANDO_APROVACAO]]. Depois da resposta selecione a máquina escolhida. Ao voltar à conversa, use a escolha confirmada. Para arquivos ou ferramentas ausentes, informe qual acesso falta.',
    'Skills da casa:', ...catalog.map(s => path.relative(skills, s.file) + ' — ' + s.description),
    ...chosen.map(s => readFileSync(s.file, 'utf8')), request].filter(Boolean).join('\n\n');
  const script = /\.m?js$/i.test(exe);
  const child = spawn(script ? process.execPath : exe, script ? [exe,...args] : args, {
    cwd: jobDir, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OFFICE_CODEX_EXE: exe, OFFICE_API: 'http://127.0.0.1:' + config.port,
      OFFICE_IMPORT_DIR: workerId ? sessionImports(workerId) : '', OFFICE_JOB_TOKEN: token, OFFICE_LAST_HUMAN_AT: lastHumanAt ?? '' },
  });
  child.stdin.on('error', () => { /* O encerramento informa a falha no histórico. */ });
  child.stdin.end(prompt, 'utf8');
  return child;
}
