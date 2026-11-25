import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { constants } from 'node:fs';

const run = promisify(execFile);
const [cliente, skills, temporarios, drive, ...renderArgs] = process.argv.slice(2);
const roots = { cliente, temporarios, ...(drive ? { drive } : {}) };
const string = { type: 'string' };
const pasta = { type: 'string', enum: Object.keys(roots) };
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const tools = [
  { name: 'gravar_arquivo', description: 'Grava texto, Markdown, CSV, SVG ou um arquivo em base64. Informe o caminho relativo completo, incluindo a extensão. Se o arquivo já existir, escolha um nome de versão novo.',
    inputSchema: schema({ pasta, caminho: string, conteudo: string, formato: { enum: ['texto','base64'] } }, ['pasta','caminho','conteudo']) },
  { name: 'executar_skill', description: 'Executa um script original Python, Node ou PowerShell da pasta de skills. Use um caminho relativo a skills e um item por argumento. A pasta escolhida é a pasta de trabalho e saída. Para saída em temporarios, copie o resultado com entregar_arquivo.',
    inputSchema: schema({ pasta, script: string, argumentos: { type: 'array', items: string, maxItems: 256 } }, ['pasta','script','argumentos']) },
  { name: 'renderizar_video', description: 'Renderiza uma timeline JSON do motor de vídeo do Office. Caminhos de timeline e saída MP4 são relativos à pasta escolhida; clipes são relativos à timeline. Use previa para uma versão rápida.',
    inputSchema: schema({ pasta, timeline: string, saida: string, previa: { type: 'boolean' } }, ['pasta','timeline','saida']) },
  { name: 'entregar_arquivo', description: 'Copia um resultado existente entre as pastas autorizadas, com nome de versão novo. Indique caminhos relativos.',
    inputSchema: schema({ de: pasta, arquivo: string, para: pasta, destino: string }, ['de','arquivo','para','destino']) },
];

function contains(root, file) {
  const rel = path.relative(root, file);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
}
async function base(key) {
  if (!Object.hasOwn(roots, key)) throw Error('Pasta desconhecida.');
  return realpath(roots[key]);
}
function parts(raw) {
  if (typeof raw !== 'string' || raw.length > 1600 || path.isAbsolute(raw)) throw Error('Use um caminho relativo.');
  const bits = raw.split(/[\\/]/);
  if (bits.some(p => !p || p.startsWith('.') || /[.: ]$|[:<>?"*|\x00-\x1f]/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(p))) throw Error('Caminho inválido.');
  return bits;
}
async function input(root, raw) {
  const file = await realpath(path.join(root, ...parts(raw)));
  if (!contains(root, file) || !(await stat(file)).isFile()) throw Error('Arquivo fora da pasta autorizada.');
  return file;
}
async function destination(root, raw) {
  const bits = parts(raw), leaf = bits.pop();
  let dir = root;
  for (const bit of bits) {
    const next = path.join(dir, bit);
    try { await mkdir(next); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    dir = await realpath(next);
    if (!contains(root, dir)) throw Error('Atalho fora da pasta autorizada.');
  }
  return path.join(dir, leaf);
}
async function office(tool) {
  const res = await fetch(process.env.OFFICE_API + '/api/agente/' + tool, {
    method: 'POST', headers: { authorization: 'Bearer ' + process.env.OFFICE_JOB_TOKEN, 'content-type': 'application/json' }, body: '{}',
  });
  if (!res.ok) throw Error('O Office não autorizou o uso do recurso.');
  return (await res.json()).ok === true;
}
async function execute(args) {
  const cwd = await base(args.pasta);
  const script = await input(await realpath(skills), args.script);
  const ext = path.extname(script).toLowerCase();
  const windows = process.platform === 'win32';
  const engines = { '.py': windows ? 'python.exe' : 'python3', '.js': process.execPath, '.mjs': process.execPath, '.cjs': process.execPath, '.ps1': windows ? 'powershell.exe' : 'pwsh' };
  const engineName = engines[ext];
  let engine;
  if (engineName && path.isAbsolute(engineName)) engine = engineName;
  else if (engineName) for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute)) {
    const candidate = path.join(dir, engineName);
    try { if ((await stat(candidate)).isFile()) { engine = candidate; break; } } catch { /* próxima entrada do PATH */ }
  }
  if (!engine || !Array.isArray(args.argumentos) || args.argumentos.some(x => typeof x !== 'string')) throw Error('Script ou argumentos incompatíveis.');
  const prefix = ext === '.ps1' ? ['-NoProfile','-NonInteractive','-File'] : [];
  return sandbox(cwd, engine, [...prefix,script,...args.argumentos], /ffmpeg|whisper|render|video|hyperframes/i.test(script));
}
async function sandbox(cwd, engine, args, render) {
  const writable = [...new Set([cwd, temporarios])].map(dir => JSON.stringify(dir) + '="write"');
  const fs = '{":root"="read",' + writable.join(',') + '}';
  const params = ['sandbox','-C',cwd,'--include-managed-config','-P','office-skill','-c','permissions.office-skill.filesystem=' + fs,'-c','permissions.office-skill.network.enabled=false','--',engine,...args];
  const env = { ...process.env, TMP: temporarios, TEMP: temporarios, TMPDIR: temporarios, REZZU_TEMP: temporarios, ELECTRON_RUN_AS_NODE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  delete env.OFFICE_JOB_TOKEN;
  if (render) while (!(await office('render_pegar'))) await new Promise(r => setTimeout(r, 1500));
  try {
    const r = await run(process.env.OFFICE_CODEX_EXE, params, { cwd, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30 * 60_000 });
    return (r.stdout + '\n' + r.stderr).slice(-24000) || 'Script concluído.';
  } finally { if (render) await office('render_liberar'); }
}
async function tool(name, a) {
  if (name === 'executar_skill') return execute(a);
  if (name === 'renderizar_video') {
    const cwd = await base(a.pasta);
    const timeline = await input(cwd, a.timeline);
    if (!timeline.toLowerCase().endsWith('.json') || typeof a.saida !== 'string' || !a.saida.toLowerCase().endsWith('.mp4')) throw Error('Informe a timeline JSON e a saída MP4.');
    const dest = await destination(cwd, a.saida);
    const timelineData = JSON.parse(await readFile(timeline, 'utf8'));
    for (const clip of [...(timelineData.video ?? []), ...(timelineData.audio ?? []), ...(timelineData.overlays ?? [])]) {
      const source = await realpath(path.resolve(path.dirname(timeline), clip.src));
      if (!Object.values(roots).some(root => contains(root, source))) throw Error('Mídia fora das pastas desta demanda.');
    }
    const stage = await mkdtemp(path.join(temporarios, 'render-'));
    const file = path.join(stage, path.basename(dest));
    await sandbox(stage, process.execPath, [...renderArgs, ...(a.previa ? ['previa'] : []), timeline, file], true);
    const saved = [];
    for (const name of await readdir(stage)) {
      const target = path.join(path.dirname(dest), name);
      await copyFile(path.join(stage, name), target, constants.COPYFILE_EXCL);
      saved.push(target);
    }
    return saved.join('\n');
  }
  if (name === 'gravar_arquivo') {
    if (typeof a.conteudo !== 'string' || a.conteudo.length > 8 * 1024 * 1024) throw Error('Arquivo fora do limite de 8 MiB.');
    const file = await destination(await base(a.pasta), a.caminho);
    const handle = await open(file, 'wx');
    try { await handle.writeFile(a.formato === 'base64' ? Buffer.from(a.conteudo, 'base64') : a.conteudo); }
    finally { await handle.close(); }
    return file;
  }
  if (name === 'entregar_arquivo') {
    const src = await input(await base(a.de), a.arquivo);
    const dest = await destination(await base(a.para), a.destino);
    await copyFile(src, dest, constants.COPYFILE_EXCL);
    return dest;
  }
  throw Error('Ferramenta desconhecida.');
}
for await (const line of createInterface({ input: process.stdin })) {
  let req;
  try { req = JSON.parse(line); } catch { continue; }
  if (req.id == null) continue;
  const response = { jsonrpc: '2.0', id: req.id };
  if (req.method === 'initialize') response.result = { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'office-producao', version: '1' } };
  else if (req.method === 'tools/list') response.result = { tools };
  else if (req.method === 'tools/call') {
    try { response.result = { content: [{ type: 'text', text: await tool(req.params.name, req.params.arguments) }] }; }
    catch (e) { response.result = { isError: true, content: [{ type: 'text', text: String(e.message).slice(-3000) }] }; }
  } else if (req.method === 'ping') response.result = {};
  else response.error = { code: -32601, message: 'Método desconhecido' };
  process.stdout.write(JSON.stringify(response) + '\n');
}
