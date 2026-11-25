import { createInterface } from 'node:readline';
import { open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const roots = { cliente: process.argv[2], skills: process.argv[3] };
const inputSchema = {
  type: 'object', properties: { pasta: { type: 'string', enum: ['cliente', 'skills'] }, caminho: { type: 'string' } },
  required: ['pasta', 'caminho'], additionalProperties: false,
};
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const tools = [
  { name: 'listar', description: 'Lista uma pasta do cliente ou das skills. Use . para a raiz.', inputSchema, annotations },
  { name: 'ler', description: 'Lê um documento de texto pelo caminho relativo à pasta escolhida.', inputSchema, annotations },
];

async function consult(name, args) {
  if (!Object.hasOwn(roots, args.pasta) || typeof args.caminho !== 'string') throw Error('Pasta inválida.');
  const root = await realpath(roots[args.pasta]);
  const target = await realpath(path.resolve(root, args.caminho));
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) ||
      relative.split(path.sep).some(part => part.startsWith('.') || part.includes(':'))) throw Error('Fora das pastas de consulta.');
  if (name === 'listar') return (await readdir(target)).filter(f => !f.startsWith('.')).slice(0, 500).join('\n');
  if (name !== 'ler' || !/\.(md|txt|json|csv|srt|vtt|ya?ml)$/i.test(target)) throw Error('Escolha um documento de texto.');
  const file = await open(target, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 512 * 1024) throw Error('Arquivo fora do limite de 512 KiB.');
    return await file.readFile('utf8');
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
    try { response.result = { content: [{ type: 'text', text: await consult(req.params.name, req.params.arguments) }] }; }
    catch (error) { response.result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
  } else if (req.method === 'ping') response.result = {};
  else response.error = { code: -32601, message: 'Método desconhecido' };
  process.stdout.write(JSON.stringify(response) + '\n');
}
