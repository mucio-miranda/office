import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [bin, stateFile, turn, ...roots] = process.argv.slice(2);
const env = { ...process.env };
delete env.OFFICE_JOB_TOKEN;
const script = /\.m?js$/i.test(bin);
const child = spawn(script ? process.execPath : bin, [...(script ? [bin] : []), '--claude-in-chrome-mcp'],  { windowsHide: true, env, stdio: ['pipe', 'pipe', 'inherit'] });
child.stdin.on('error', () => { /* O fechamento da ponte encerra a sessão MCP. */ });
child.stdout.pipe(process.stdout);
child.once('error', () => process.exit(1));
child.once('close', code => process.exit(code ?? 1));
const send = (id, text) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text }] } }) + '\n');
let selected = false;
const selectIds = new Set();
createInterface({ input: child.stdout }).on('line', line => {
  try { const msg = JSON.parse(line); if (selectIds.delete(msg.id)) selected = !!msg.result && !msg.result.isError; } catch {}
});
for await (const line of createInterface({ input: process.stdin })) {
  let req;
  try { req = JSON.parse(line); } catch { continue; }
  if (req.method === 'tools/call') {
    const name = req.params.name;
    try {
      if (name === 'select_browser' || name === 'switch_browser') {
        let listed;
        try { listed = readFileSync(stateFile, 'utf8'); } catch {}
        const prompt = listed ? JSON.parse(listed) : null;
        if (!prompt || prompt.turn === turn || !(Date.parse(process.env.OFFICE_LAST_HUMAN_AT) > prompt.at)) throw Error('Mostre as máquinas à equipe, peça a escolha com [[AGUARDANDO_APROVACAO]] e aguarde a resposta.');
        selectIds.add(req.id);
      } else if (name !== 'list_connected_browsers' && !selected) throw Error('Liste os navegadores e confirme com a equipe qual máquina usar.');
      if (name === 'file_upload') {
        const entries = Object.entries(req.params.arguments ?? {}).filter(([key]) => /path|file/i.test(key));
        const files = entries.flatMap(([,v]) => Array.isArray(v) ? v : [v]);
        if (!files.length || !files.every(f => typeof f === 'string' && path.isAbsolute(f) && roots.some(root => {
          const rel = path.relative(root, realpathSync(f));
          return rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
        }))) throw Error('Para anexar no Chrome, escolha um arquivo da pasta do cliente ou desta demanda.');
      }
      const url = process.env.OFFICE_API + '/api/agente/navegador_pegar';
      while (true) {
        const res = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + process.env.OFFICE_JOB_TOKEN, 'content-type': 'application/json' }, body: '{}' });
        if (!res.ok) throw Error('Não consegui reservar o Chrome no Office.');
        if ((await res.json()).ok) break;
        await new Promise(r => setTimeout(r, 1500));
      }
      if (name === 'list_connected_browsers' && !existsSync(stateFile)) writeFileSync(stateFile, JSON.stringify({ turn, at: Date.now() }));
    } catch (e) { send(req.id, e.message); continue; }
  }
  child.stdin.write(line + '\n');
}
child.stdin.end();
