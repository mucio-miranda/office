import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Chrome do GPT reserva o navegador e espera a escolha humana antes de atuar', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'office-chrome-'));
  const fake = path.join(tmp,'chrome.mjs');
  writeFileSync(fake, `import {createInterface} from 'node:readline';
    for await(const line of createInterface({input:process.stdin})) {
      const {id}=JSON.parse(line); console.log(JSON.stringify({jsonrpc:'2.0',id,result:{content:[{type:'text',text:'ok'}]}}));
    }`);
  const calls: string[] = [];
  const office = createServer((req,res) => { calls.push(req.url!); res.end('{"ok":true}'); });
  office.listen(0,'127.0.0.1');
  await once(office,'listening');
  const addr = office.address();
  if (!addr || typeof addr === 'string') throw Error('Sem porta local.');
  async function turn(id: string, human: string, expected: [string, boolean][]) {
    const bridge = spawn(process.execPath,[path.resolve('src/agents/codex-chrome.mjs'),fake,path.join(tmp,'escolha'),id,tmp],
      {env:{...process.env,OFFICE_API:'http://127.0.0.1:'+ (addr as {port:number}).port,OFFICE_JOB_TOKEN:'teste',OFFICE_LAST_HUMAN_AT:human}});
    const lines = createInterface({input:bridge.stdout})[Symbol.asyncIterator]();
    try {
      for (const [i,[name, success]] of expected.entries()) {
        bridge.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i+1,method:'tools/call',params:{name,arguments:{}}})+'\n');
        const {value}=await lines.next();
        assert.ok(value, 'A ponte fechou antes de responder.');
        assert.equal(!JSON.parse(value).result.isError,success,name);
      }
    } finally { bridge.stdin.end(); await once(bridge,'close'); }
  }
  try {
    await turn('primeira','',[['navigate',false],['list_connected_browsers',true],['select_browser',false]]);
    await turn('sem-resposta','',[['select_browser',false]]);
    await turn('respondida',new Date().toISOString(),[['select_browser',true],['navigate',true],['file_upload',false]]);
    assert.deepEqual(calls,Array(3).fill('/api/agente/navegador_pegar'));
  } finally { office.close(); rmSync(tmp,{recursive:true,force:true}); }
});
