import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import Fastify from 'fastify';

test('cliente fictício: Claude padrão, skill original, retomada GPT e escopo da sessão', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-piloto-'));
  process.env.OFFICE_DATA = dir;
  const cwd = path.join(dir, 'Cliente Ficticio');
  const skills = path.join(dir, '.claude', 'skills', 'fluxo-trabalho');
  mkdirSync(cwd);
  mkdirSync(skills, { recursive: true });
  const skillFile = path.join(skills, 'SKILL.md');
  const original = '---\nname: fluxo-trabalho\ndescription: Consulta de teste\n---\nA palavra da primeira entrega é CEDRO.';
  writeFileSync(skillFile, original);
  writeFileSync(path.join(cwd, 'referencia.txt'), 'A palavra da referência é IPÊ.');
  const live = process.env.OFFICE_TEST_CODEX_LIVE === '1';
  if (!live) {
    const fake = path.join(dir, 'codex.mjs');
    writeFileSync(fake, `let input = ''; for await (const buf of process.stdin) input += buf;
      const resume = process.argv.includes('resume');
      if (!process.argv.includes('read-only') || !process.argv.includes('shell_tool') || (!resume && !input.includes('primeira entrega é CEDRO')) ||
         (resume && (!process.argv.includes('thread-teste') || input.includes('Consulta de teste')))) process.exit(3);
      await new Promise(r => setTimeout(r, 120));
      for (const e of [{type:'thread.started',thread_id:'thread-teste'}, {type:'item.completed',item:{type:'agent_message',text:'CEDRO'}},{type:'turn.completed'}]) console.log(JSON.stringify(e));`);
    process.env.OFFICE_CODEX_BIN = fake;
  }
  const { api, createOffice } = await import('./api.ts');
  const { db, insert, now } = await import('../db.ts');
  const { createSession } = await import('../auth.ts');
  const app = Fastify();
  try {
    await app.register(api);
    insert('users', { id: 'u', name: 'Dona fictícia', color: 'red', createdAt: now() });
    const token = createSession('u');
    const o = createOffice('Piloto', dir, [], 'u');
    for (const id of ['c1', 'c2']) insert('clients', { id, officeId: o.id, name: id, folder: cwd, color: 'red' });
    const base = '/api/offices/' + o.id + '/clients/c1';
    const call = (url: string, payload?: object) => app.inject({ method: payload ? 'POST' : 'GET', url, payload,
      headers: { authorization: 'Bearer ' + token, host: 'localhost' } });
    const claude = await call(base + '/conversa/nova', { title: 'Claude padrão' });
    assert.equal(claude.statusCode, 200, claude.body);
    assert.equal(claude.json().role, 'titular');
    assert.equal((await call(base + '/codex')).json().enabled, true);
    const newChat = await call(base + '/codex', { title: 'GPT' });
    assert.equal(newChat.statusCode, 200, newChat.body);
    const url = base + '/codex/' + newChat.json().id;
    const first = call(url, { text: '/fluxo-trabalho Responda só a palavra da primeira entrega. Guarde a palavra para a próxima pergunta.' }).then(r => r);
    if (!live) {
      await new Promise(r => setTimeout(r, 35));
      assert.equal((await call(url, { text: 'simultânea' })).statusCode, 409);
    }
    const r = await first;
    assert.equal(r.statusCode, 200, r.body);
    const next = await call(url, { text: 'Qual palavra eu pedi para guardar antes? Responda apenas com ela.' });
    assert.equal(next.statusCode, 200, next.body);
    const turns = (await call(url)).json();
    assert.equal(turns.length, 2);
    assert.match(turns[0].answer, /CEDRO/i);
    assert.match(turns[1].answer, /CEDRO/i);
    if (live) {
      const ref = await call(url, { text: 'Leia referencia.txt na pasta cliente com a ferramenta de consulta do Office. Responda só a palavra contida no arquivo.' });
      assert.equal(ref.statusCode, 200, ref.body);
      assert.match((await call(url)).json().at(-1).answer, /IPÊ/i);
    }
    assert.equal((await call(url.replace('/c1/', '/c2/'))).statusCode, 404);
    assert.equal((await call(url, { text: '/ausente' })).statusCode, 422);
    assert.equal((await call(base + '/codex')).json().sessions.length, 1);
    assert.equal(db.prepare('SELECT session_id FROM workers WHERE id=?').get(claude.json().id)?.session_id, null);
    assert.equal(readFileSync(skillFile, 'utf8'), original);
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
