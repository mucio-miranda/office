import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

// Claude de mentira: responde na hora, sem gastar nada
const dataDir = mkdtempSync(path.join(tmpdir(), 'office-demand-'));
const fake = path.join(dataDir, 'fake-claude.mjs');
writeFileSync(fake, `const id = '11111111-2222-4333-8444-555555555555';
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: id }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Feito.' }] } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', result: 'Feito.', total_cost_usd: 0.01, session_id: id }) + '\\n');`);
process.env.OFFICE_DATA = dataDir;
process.env.CLAUDE_BIN = fake;
process.env.CLAUDE_PROJECTS_DIR = path.join(dataDir, 'projects');
const { api } = await import('./api.ts');
const { db } = await import('../db.ts');

let app: FastifyInstance;
let token = '';
let O = '';
const call = async (method: string, url: string, body?: unknown) => {
  const res = await app.inject({ method: method as 'GET', url, remoteAddress: '127.0.0.1', headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {} };
};
const wait = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50)); };

before(async () => {
  const root = path.join(dataDir, 'raiz');
  mkdirSync(path.join(root, 'CLIENTES', 'MARIA TESTE'), { recursive: true });
  app = Fastify();
  await app.register(api);
  token = (await call('POST', '/api/auth/enter', { name: 'Dona', pin: 'senha-forte-1' })).json.token;
  O = `/api/offices/${(await call('POST', '/api/offices', { name: 'REZZU', rootPath: root })).json.id}`;
});
after(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('demanda pelo mapa: sai com quem faz, processo, prazo e prioridade, e a sessão do cliente começa', async () => {
  const c = (await call('POST', `${O}/clients`, { name: 'Maria Teste', folder: 'CLIENTES/MARIA TESTE' })).json.client;
  const agents = (await call('GET', `${O}/agents`)).json as { id: string; slug: string; name: string }[];
  const vic = agents.find((a) => a.slug === 'editor-de-video')!;
  const r = await call('POST', `${O}/clients/${c.id}/conversa`, {
    text: 'capa do reels com outra foto, mande 3 opções antes',
    demand: { agentId: vic.id, process: 'arte-feed', dueDate: '2026-11-10', priority: 'alta' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = (await call('GET', `${O}/demands`)).json.find((x: any) => x.clientId === c.id);
  assert.equal(d.process, 'arte-feed');
  assert.equal(d.dueDate, '2026-11-10');
  assert.equal(d.priority, 'alta');
  assert.equal(d.assignee, `agent:${vic.id}`, 'quem foi escolhido no mapa faz');
  await wait(() => !!db.prepare('SELECT session_id FROM clients WHERE id = ?').get(c.id)?.session_id);
  const job = (await call('GET', `${O}/jobs`)).json.find((j: any) => j.demandId === d.id);
  assert.equal(job.agentId, vic.id);
  const msgs = (await call('GET', `${O}/jobs/${job.id}/messages`)).json;
  assert.equal(msgs[0].author, 'Dona', 'a mensagem diz quem pediu');
  assert.equal((db.prepare('SELECT session_id FROM clients WHERE id = ?').get(c.id) as any).session_id, '11111111-2222-4333-8444-555555555555');
});

test('sessões do cliente: lista as do terminal e retoma uma delas', async () => {
  const c = (await call('GET', `${O}/clients`)).json[0];
  const office = (await call('GET', O)).json.office;
  const cwd = path.join(office.rootPath, 'CLIENTES', 'MARIA TESTE');
  const proj = path.join(dataDir, 'projects', path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(proj, { recursive: true });
  const sid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  writeFileSync(path.join(proj, `${sid}.jsonl`), `${JSON.stringify({ type: 'user', timestamp: '2026-11-04T10:00:00Z', message: { content: 'planeje novembro' } })}\n`);
  const list = (await call('GET', `${O}/clients/${c.id}/sessoes`)).json as any[];
  assert.deepEqual(list.find((s) => s.id === sid) && [list.find((s) => s.id === sid).origin, list.find((s) => s.id === sid).title], ['terminal', 'planeje novembro']);
  assert.equal((await call('GET', `${O}/clients/${c.id}/sessoes/${sid}`)).json[0].text, 'planeje novembro');
  assert.equal((await call('POST', `${O}/clients/${c.id}/sessoes/00000000-0000-4000-8000-000000000000/retomar`, {})).status, 404);
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando')").all().length));
  assert.equal((await call('POST', `${O}/clients/${c.id}/sessoes/${sid}/retomar`, {})).status, 200);
  const row = db.prepare('SELECT session_id, session_cost FROM clients WHERE id = ?').get(c.id) as any;
  assert.deepEqual([row.session_id, row.session_cost], [sid, -1], 'custo anterior desconhecido');
});

test('calendário: a pessoa e o funcionário preenchem; arte não passa de conferência sem tunning; token de fora não entra', async () => {
  const { issueJobToken } = await import('../agents/runtime.ts');
  const { spawn } = await import('node:child_process');
  const c = (await call('GET', `${O}/clients`)).json[0];
  const d = (await call('GET', `${O}/demands`)).json.find((x: any) => x.clientId === c.id);
  const r = await call('POST', `${O}/clients/${c.id}/posts`, { posts: [
    { date: '2026-11-06', format: 'carrossel', theme: 'Mitos', number: 1, demandId: d.id },
    { date: '2026-11-07', format: 'reels', theme: 'Bastidor', number: 2, demandId: d.id, status: 'aprovado' },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [mitos] = r.json;
  assert.equal((await call('POST', `${O}/clients/${c.id}/posts`, { posts: [{ id: mitos.id, status: 'aprovado' }] })).status, 409, 'sem tunning não aprova');
  assert.equal((await call('POST', `${O}/clients/${c.id}/posts`, { posts: [{ id: mitos.id, status: 'tunning' }] })).status, 200);
  assert.deepEqual((await call('GET', `${O}/demands/${d.id}/progresso`)).json.done, 1, 'o reels aprovado conta');

  // o funcionário, pelo servidor MCP de verdade, com o token da tarefa
  const job = (await call('GET', `${O}/jobs`)).json.find((j: any) => j.demandId === d.id);
  const token = issueJobToken(job.id);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as any).port;
  const mcp = spawn(process.execPath, [path.resolve('src/agents/office-mcp.mjs')], { env: { ...process.env, OFFICE_API: `http://127.0.0.1:${port}`, OFFICE_JOB_TOKEN: token } });
  const replies: any[] = [];
  let buf = '';
  mcp.stdout.on('data', (b) => { buf += b; let i; while ((i = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const rpc = (id: number, method: string, params: unknown) => mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  rpc(1, 'initialize', { protocolVersion: '2025-06-18' });
  rpc(2, 'tools/list', {});
  rpc(3, 'tools/call', { name: 'calendario_salvar', arguments: { posts: [{ id: mitos.id, status: 'conferencia', tunning: 'feito', files: ['E:/saida/01.png'] }, { id: mitos.id, status: 'aprovado' }] } });
  rpc(4, 'tools/call', { name: 'calendario_listar', arguments: { mes: '2026-11' } });
  await wait(() => replies.length >= 4);
  mcp.kill();
  assert.deepEqual(replies.find((x) => x.id === 2).result.tools.map((t: any) => t.name), ['calendario_listar', 'calendario_salvar']);
  assert.ok(!replies.find((x) => x.id === 3).result.isError, JSON.stringify(replies.find((x) => x.id === 3)));
  const listed = JSON.parse(replies.find((x) => x.id === 4).result.content[0].text);
  assert.equal(listed.posts.find((p: any) => p.id === mitos.id).status, 'aprovado');
  assert.equal(listed.andamento.done, 2);
  assert.equal((db.prepare('SELECT updated_by FROM content_posts WHERE id = ?').get(mitos.id) as any).updated_by, `agent:${job.agentId}`);

  // o funcionário não dispensa o tunning
  const dispensa = await app.inject({ method: 'POST', url: '/api/agente/calendario_salvar', remoteAddress: '127.0.0.1', headers: { host: 'localhost', authorization: `Bearer ${token}` }, payload: { posts: [{ id: mitos.id, tunning: 'dispensado' }] } });
  assert.equal(dispensa.statusCode, 409);

  // token errado ou de fora da máquina não entra
  const bad = await app.inject({ method: 'POST', url: '/api/agente/calendario_listar', remoteAddress: '127.0.0.1', headers: { host: 'localhost', authorization: 'Bearer x' }, payload: {} });
  assert.equal(bad.statusCode, 401);
  const far = await app.inject({ method: 'POST', url: '/api/agente/calendario_listar', remoteAddress: '100.70.1.2', headers: { host: 'localhost', authorization: `Bearer ${token}` }, payload: {} });
  assert.equal(far.statusCode, 403);
});

test('skills: só mudam pela proposta aprovada, com o trecho conferido e registro no git', async () => {
  const { execFileSync } = await import('node:child_process');
  const { parseProposal } = await import('../agents/curator.ts');
  const office = (await call('GET', O)).json.office;
  const sk = path.join(office.rootPath, '.claude', 'skills');
  mkdirSync(path.join(sk, 'arte-referencia'), { recursive: true });
  const file = path.join(sk, 'arte-referencia', 'SKILL.md');
  writeFileSync(file, '# Arte\n\n## Carrossel\n- Indicador no centro.\n');
  const git = (...a: string[]) => execFileSync('git', ['-C', sk, '-c', 'user.name=Teste', '-c', 'user.email=teste@exemplo.com', ...a], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');

  const ok = parseProposal('Proposta.\n```json\n{"resumo":"indicador à direita","edicoes":[{"arquivo":".claude/skills/arte-referencia/SKILL.md","trocar":"- Indicador no centro.","por":"- Indicador à direita quando a pessoa está centralizada."}]}\n```', office.rootPath);
  assert.equal(ok.edits[0].file, 'arte-referencia/SKILL.md');
  assert.throws(() => parseProposal('```json\n{"edicoes":[{"arquivo":"../../CLAUDE.md","trocar":"","por":"x"}]}\n```', office.rootPath), /Fora das skills/);
  assert.throws(() => parseProposal('```json\n{"edicoes":[{"arquivo":"arte-referencia/SKILL.md","trocar":"não existe","por":"x"}]}\n```', office.rootPath), /exatamente uma vez/);

  const lid = 'l1';
  db.prepare("INSERT INTO learnings (id, office_id, agent_id, text, status, created_at) VALUES (?, ?, 'a', 'indicador à direita', 'aprovado', '2026-11-05')").run(lid, office.id);
  db.prepare("INSERT INTO skill_changes (id, office_id, learning_ids, status, summary, edits, created_at) VALUES ('ch1', ?, ?, 'pronta', 'indicador à direita', ?, '2026-11-05')").run(office.id, JSON.stringify([lid]), JSON.stringify(ok.edits));
  const r = await call('POST', `${O}/skills/mudancas/ch1/aplicar`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(readFileSync(file, 'utf8'), /Indicador à direita/);
  assert.equal((db.prepare('SELECT status FROM learnings WHERE id = ?').get(lid) as any).status, 'na-skill');
  assert.match(git('log', '-1', '--format=%s'), /^Office: indicador à direita/);
  assert.doesNotMatch(git('log', '-1', '--format=%B'), /Co-Authored-By/i, 'sem coautor');
  assert.equal((await call('POST', `${O}/skills/mudancas/ch1/aplicar`, {})).status, 409, 'não aplica duas vezes');
});
