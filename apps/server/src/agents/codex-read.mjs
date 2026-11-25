import { createInterface } from 'node:readline';
import { open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const roots = { cliente: process.argv[2], skills: process.argv[3], ...(process.argv[4] ? { temporarios: process.argv[4] } : {}), ...(process.argv[5] ? { drive: process.argv[5] } : {}) };
const inputSchema = {
  type: 'object', properties: { pasta: { type: 'string', enum: Object.keys(roots) }, caminho: { type: 'string' } },
  required: ['pasta', 'caminho'], additionalProperties: false,
};
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const tools = [
  { name: 'listar', description: 'Lista uma pasta do cliente ou das skills. Use . para a raiz.', inputSchema, annotations },
  { name: 'ler', description: 'Lê um documento de texto pelo caminho relativo à pasta escolhida.', inputSchema, annotations },
];

if (process.argv[4]) tools.push({ name: 'ver_imagem', description: 'Abre uma imagem PNG, JPEG ou WebP para conferência visual.', inputSchema, annotations });

async function consult(name, args) {
  if (!Object.hasOwn(roots, args.pasta) || typeof args.caminho !== 'string') throw Error('Pasta inválida.');
  const root = await realpath(roots[args.pasta]);
  const target = await realpath(path.resolve(root, args.caminho));
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) ||
      relative.split(path.sep).some(part => part.startsWith('.') || part.includes(':'))) throw Error('Fora das pastas de consulta.');
  if (name === 'listar') return { type: 'text', text: (await readdir(target)).filter(f => !f.startsWith('.')).slice(0, 500).join('\n') };
  if (name === 'ver_imagem' && process.argv[4]) {
    const mime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' }[path.extname(target).toLowerCase()];
    if (!mime) throw Error('Formato de imagem incompatível.');
    const f = await open(target, 'r');
    try {
      const st = await f.stat();
      if (!st.isFile() || st.size > 8*1024*1024) throw Error('Use uma prévia de até 8 MiB.');
      return { type:'image', mimeType:mime, data:(await f.readFile()).toString('base64') };
    } finally { await f.close(); }
  }
  if (name !== 'ler' || !/\.(md|txt|json|csv|srt|vtt|ya?ml)$/i.test(target)) throw Error('Escolha um documento de texto.');
  const file = await open(target, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 512 * 1024) throw Error('Arquivo fora do limite de 512 KiB.');
    return { type: 'text', text: await file.readFile('utf8') };
  } finally { await file.close(); }
}

for await (const line of createInterface({ input: process.stdin })) {
  let req;
  try { req = JSON.parse(line); } catch { continue; }
  if (req.id == null) continue;
  const response = { jsonrpc: '2.0', id: req.id };
  if (req.method === 'initialize') response.result = { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'office-consulta', version: '1' } };
  else if (req.method === 'tools/list') response.result = { tools };
  else if (req.method === 'tools/call') {
    try { response.result = { content: [await consult(req.params.name, req.params.arguments)] }; }
    catch (error) { response.result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
  } else if (req.method === 'ping') response.result = {};
  else response.error = { code: -32601, message: 'Método desconhecido' };
  process.stdout.write(JSON.stringify(response) + '\n');
}
