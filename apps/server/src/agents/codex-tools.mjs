import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { conferirAudio, copiarLocal, miniatura } from './midia-local.mjs';

const run = promisify(execFile);
const [cliente, skills, temporarios, drive, ...renderArgs] = process.argv.slice(2);
const roots = { cliente, temporarios, ...(drive ? { drive } : {}) };
const string = { type: 'string' };
const pasta = { type: 'string', enum: Object.keys(roots) };
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const background = { type: 'boolean', description: 'Retorna um ID para consultar ou cancelar durante esta execução.' };
const source = { enum: [...Object.keys(roots), ...(process.env.OFFICE_IMPORT_DIR ? ['importados'] : [])] };
const tools = [
  { name: 'exportar_composicao', description: 'Exporte layout.html da skill (foto, marca e fontes locais) em PNG ou JPG nas dimensões finais. Devolve o arquivo e uma miniatura.', inputSchema: schema({ pasta, html: string, saida: string, largura: { type: 'integer' }, altura: { type: 'integer' } }, ['pasta','html','saida','largura','altura']) },
  { name: 'copiar_para_local', description: 'Copie arquivo ou pasta do Drive, cliente ou importados para temporarios. Devolve os caminhos absoluto e relativo e os bytes copiados. Para pastas e vídeos grandes use em_segundo_plano.', inputSchema: schema({ de: source, caminho: string, em_segundo_plano: background }, ['de','caminho']) },
  { name: 'consultar_operacao', description: 'Consulta etapa, progresso e resultado pelo ID durante esta execução.', inputSchema: schema({ id: string }, ['id']) },
  { name: 'cancelar_operacao', description: 'Interrompe uma operação desta execução pelo ID.', inputSchema: schema({ id: string }, ['id']) },
  { name: 'conferir_audio', description: 'Mede duração, faixas, pico e loudness integrado (LUFS) do MP4 e sinaliza silêncio.', inputSchema: schema({ pasta, arquivo: string, em_segundo_plano: background }, ['pasta','arquivo']) },
  { name: 'conferir_anexos', description: 'Antes do WhatsApp verifique acesso e tamanho dos arquivos para a chamada de upload do Chrome. Retorna tamanho individual e total.', inputSchema: schema({ pasta, arquivos: { type: 'array', items: string, minItems: 1, maxItems: 32 } }, ['pasta','arquivos']) },
  { name: 'prever_foto', description: 'Confira visualmente a miniatura do JPG ou PNG produzido pela revelação antes de entregar.', inputSchema: schema({ pasta, arquivo: string }, ['pasta','arquivo']) },
  { name: 'gravar_arquivo', description: 'Grava texto, Markdown, CSV, SVG ou um arquivo em base64. Informe o caminho relativo completo, incluindo a extensão. Se o arquivo já existir, escolha um nome de versão novo.',
    inputSchema: schema({ pasta, caminho: string, conteudo: string, formato: { enum: ['texto','base64'] } }, ['pasta','caminho','conteudo']) },
  { name: 'executar_skill', description: 'Executa um script original Python, Node ou PowerShell da pasta de skills. Use um caminho relativo a skills e um item por argumento. A pasta escolhida é a pasta de trabalho e saída. Para saída em temporarios, copie o resultado com entregar_arquivo.',
    inputSchema: schema({ pasta, script: string, em_segundo_plano: background, prever_saida: string, argumentos: { type: 'array', items: string, maxItems: 256 } }, ['pasta','script','argumentos']) },
  { name: 'renderizar_video', description: 'Renderiza uma timeline JSON do motor de vídeo do Office. Caminhos de timeline e saída MP4 são relativos à pasta escolhida; clipes são relativos à timeline. Centro da sobreposição: x=0.5,y=0.5. Formato raster PNG. Exemplo: {"width":1080,"height":1920,"video":[{"id":"v","src":"base.mp4","out":8,"keepAudio":true}],"overlays":[{"id":"c","src":"capa.png","start":0,"end":3,"x":0.5,"y":0.5,"width":0.8,"fade":0.3}]}. Use uma entrada audio por stem (voz, música, efeitos), com ganhoDb em dB ou volume linear. Com faixas audio explícitas indique keepAudio em cada vídeo. Saída inclui duração, faixas e LUFS. Para renders longos use em_segundo_plano.',
    inputSchema: schema({ pasta, timeline: string, saida: string, em_segundo_plano: background, previa: { type: 'boolean' } }, ['pasta','timeline','saida']) },
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
async function execute(args, op) {
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
  return sandbox(cwd, engine, [...prefix,script,...args.argumentos], /ffmpeg|whisper|render|video|hyperframes/i.test(script), op);
}
async function sandbox(cwd, engine, args, render, op) {
  const writable = [...new Set([cwd, temporarios])].map(dir => JSON.stringify(dir) + '="write"');
  const fs = '{":root"="read",' + writable.join(',') + '}';
  const params = ['sandbox','-C',cwd,'--include-managed-config','-P','office-skill','-c','permissions.office-skill.filesystem=' + fs,'-c','permissions.office-skill.network.enabled=false','--',engine,...args];
  const env = { ...process.env, TMP: temporarios, TEMP: temporarios, TMPDIR: temporarios, REZZU_TEMP: temporarios, ELECTRON_RUN_AS_NODE: '1', PYTHONDONTWRITEBYTECODE: '1' };
  delete env.OFFICE_JOB_TOKEN;
  if (render) while (!(await office('render_pegar'))) {
    op.signal.throwIfAborted();
    op.progresso = 'Aguardando o renderizador';
    await new Promise(r => setTimeout(r, 1500));
  }
  try {
    op.progresso = 'Executando';
    const pending = run(process.env.OFFICE_CODEX_EXE, params, { cwd, env, signal: op.signal, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30 * 60_000 });
    pending.child.stdout?.on('data', data => { const last = String(data).trim().split(/\r?\n/).pop(); if (last) op.progresso = last.slice(-180); });
    const r = await pending;
    return (r.stdout + '\n' + r.stderr).slice(-24000) || 'Script concluído.';
  } finally { if (render) await office('render_liberar'); }
}
const asText = value => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });
async function tool(name, a, op) {
  if (name === 'copiar_para_local') {
    const root = a.de === 'importados' && process.env.OFFICE_IMPORT_DIR ? await realpath(process.env.OFFICE_IMPORT_DIR) : await base(a.de);
    return copiarLocal(root, parts(a.caminho), await base('temporarios'), op);
  }
  if (name === 'conferir_audio') return conferirAudio(await input(await base(a.pasta), a.arquivo), op.signal);
  if (name === 'conferir_anexos') {
    if (!Array.isArray(a.arquivos) || !a.arquivos.length || a.arquivos.length > 32) throw Error('Selecione de 1 a 32 arquivos.');
    const root = await base(a.pasta);
    const arquivos = [];
    for (const caminho of a.arquivos) arquivos.push({ caminho, bytes: (await stat(await input(root, caminho))).size });
    const total = arquivos.reduce((n, f) => n + f.bytes, 0);
    return { arquivos, total, aviso: total > 10000000 ? 'Acima de 10 MB por chamada da ponte. Confira a possibilidade de anexos separados ou envio manual.' : 'Arquivos acessíveis para a ponte. Confirme o destinatário antes do envio.' };
  }
  if (name === 'exportar_composicao') {
    const root = await base(a.pasta);
    const html = await input(root, a.html);
    if (!/\.html?$/i.test(html) || !/\.(?:png|jpe?g)$/i.test(a.saida)) throw Error('Escolha um HTML e uma saída PNG ou JPG.');
    const output = await destination(root, a.saida);
    const { exportarComposicao } = await import('./composicao.mjs');
    const { data, preview } = await exportarComposicao(html, await Promise.all(Object.values(roots).map(p => realpath(p))), a.largura, a.altura, /\.png$/i.test(output) ? 'png' : 'jpeg');
    const handle = await open(output, 'wx');
    try { await handle.writeFile(data); } finally { await handle.close(); }
    return [asText({ absoluto: output, relativo: a.saida, largura: a.largura, altura: a.altura }), { type: 'image', mimeType: 'image/jpeg', data: Buffer.from(preview).toString('base64') }];
  }
  if (name === 'prever_foto' || (name === 'executar_skill' && a.prever_saida)) {
    const message = name === 'executar_skill' ? await execute(a, op) : null;
    const file = await input(await base(a.pasta), a.prever_saida ?? a.arquivo);
    if (!/\.(?:png|jpe?g|webp)$/i.test(file)) throw Error('Selecione uma imagem revelada.');
    return [asText(message || file), await miniatura(file, op.signal)];
  }
  if (name === 'executar_skill') return execute(a, op);
  if (name === 'renderizar_video') {
    const cwd = await base(a.pasta);
    const timeline = await input(cwd, a.timeline);
    if (!timeline.toLowerCase().endsWith('.json') || typeof a.saida !== 'string' || !a.saida.toLowerCase().endsWith('.mp4')) throw Error('Informe a timeline JSON e a saída MP4.');
    const dest = await destination(cwd, a.saida);
    const timelineData = JSON.parse(await readFile(timeline, 'utf8'));
    for (const clip of timelineData.video ?? []) {
      if (clip.keepAudio === undefined && timelineData.audio?.length) throw Error('Há uma mixagem explícita. Indique keepAudio:true para incluir o som do clipe ou false para usar só as faixas audio.');
      clip.keepAudio ??= true;
    }
    if (timelineData.overlays?.some(o => /\.svg$/i.test(o.src))) throw Error('Converta a sobreposição SVG para PNG antes do render.');
    for (const clip of [...(timelineData.video ?? []), ...(timelineData.audio ?? []), ...(timelineData.overlays ?? [])]) {
      const source = await realpath(path.resolve(path.dirname(timeline), clip.src));
      if (!Object.values(roots).some(root => contains(root, source))) throw Error('Mídia fora das pastas desta demanda.');
      clip.src = source;
      if (clip.ganhoDb !== undefined) {
        if (!Number.isFinite(clip.ganhoDb) || clip.ganhoDb < -96 || clip.ganhoDb > 12 || clip.volume !== undefined) throw Error('Use ganhoDb de -96 a +12 ou volume linear, um por faixa.');
        clip.volume = 10 ** (clip.ganhoDb / 20);
        delete clip.ganhoDb;
      }
    }
    const stage = await mkdtemp(path.join(temporarios, 'render-'));
    const file = path.join(stage, path.basename(dest));
    const resolvedTimeline = path.join(stage, 'timeline.json');
    const handle = await open(resolvedTimeline, 'wx');
    try { await handle.writeFile(JSON.stringify(timelineData)); } finally { await handle.close(); }
    await sandbox(stage, process.execPath, [...renderArgs, ...(a.previa ? ['previa'] : []), resolvedTimeline, file], true, op);
    op.progresso = 'Conferindo áudio e duração';
    const saved = [];
    for (const name of (await readdir(stage)).filter(f => /\.mp4$/i.test(f))) {
      const audio = await conferirAudio(path.join(stage, name), op.signal);
      const target = path.join(path.dirname(dest), name);
      await copyFile(path.join(stage, name), target, constants.COPYFILE_EXCL);
      saved.push({ arquivo: target, projeto: resolvedTimeline, ...audio, ...(audio.muda ? { aviso: 'Saída sem áudio audível. Confira se o silêncio foi intencional antes de entregar.' } : {}) });
    }
    return saved;
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
const operations = new Map();
async function dispatch(name, a) {
  if (name === 'consultar_operacao' || name === 'cancelar_operacao') {
    const op = operations.get(a.id);
    if (!op) throw Error('Operação desconhecida nesta execução.');
    if (name === 'cancelar_operacao' && op.estado === 'rodando') op.controller.abort();
    return [asText({ id: op.id, estado: op.estado, etapa: op.progresso, bytes: op.bytes }), ...(op.result ?? [])];
  }
  const controller = new AbortController();
  const op = { controller, signal: controller.signal, id: randomUUID(), estado: 'rodando', progresso: 'Iniciando' };
  const normalize = value => Array.isArray(value) && value[0]?.type ? value : [asText(value)];
  if (a.em_segundo_plano && ['renderizar_video','copiar_para_local','executar_skill','conferir_audio'].includes(name)) {
    operations.set(op.id, op);
    tool(name, a, op).then(value => { op.result = normalize(value); op.estado = 'concluída'; }, e => {
      op.result = [asText(e.message)]; op.estado = op.signal.aborted ? 'cancelada' : 'falhou';
    });
    return [asText({ id: op.id, estado: op.estado, etapa: op.progresso })];
  }
  return normalize(await tool(name, a, op));
}
process.stdin.on('end', () => { for (const op of operations.values()) if (op.estado === 'rodando') op.controller.abort(); });
for await (const line of createInterface({ input: process.stdin })) {
  let req;
  try { req = JSON.parse(line); } catch { continue; }
  if (req.id == null) continue;
  const response = { jsonrpc: '2.0', id: req.id };
  if (req.method === 'initialize') response.result = { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'office-producao', version: '1' } };
  else if (req.method === 'tools/list') response.result = { tools };
  else if (req.method === 'tools/call') {
    try { response.result = { content: await dispatch(req.params.name, req.params.arguments) }; }
    catch (e) { response.result = { isError: true, content: [{ type: 'text', text: String(e.message).slice(-3000) }] }; }
  } else if (req.method === 'ping') response.result = {};
  else response.error = { code: -32601, message: 'Método desconhecido' };
  process.stdout.write(JSON.stringify(response) + '\n');
}
