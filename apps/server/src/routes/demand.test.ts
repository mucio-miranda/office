import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  // a atual não se arquiva; outra sai da lista e volta ao desarquivar ou ao continuar nela
  assert.equal((await call('POST', `${O}/clients/${c.id}/sessoes/${sid}/arquivar`, { archived: true })).status, 409);
  const other = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  writeFileSync(path.join(proj, `${other}.jsonl`), `${JSON.stringify({ type: 'user', timestamp: '2026-11-05T10:00:00Z', message: { content: 'outra' } })}
`);
  assert.equal((await call('POST', `${O}/clients/${c.id}/sessoes/${other}/arquivar`, { archived: true })).status, 200);
  const arch = (await call('GET', `${O}/clients/${c.id}/sessoes`)).json as any[];
  assert.ok(arch.find((s) => s.id === other).archivedAt);
  assert.ok(existsSync(path.join(proj, `${other}.jsonl`)), 'nada é apagado');
  assert.equal((await call('POST', `${O}/clients/${c.id}/sessoes/${other}/arquivar`, { archived: false })).status, 200);
  assert.equal((await call('GET', `${O}/clients/${c.id}/sessoes`)).json.find((s: any) => s.id === other).archivedAt, null);
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
  assert.deepEqual(replies.find((x) => x.id === 2).result.tools.map((t: any) => t.name), ['calendario_listar', 'calendario_salvar', 'posts_do_mes', 'posts_marcar_postado', 'pedir_ajudante', 'navegador_liberar']);
  assert.ok(!replies.find((x) => x.id === 3).result.isError, JSON.stringify(replies.find((x) => x.id === 3)));
  const listed = JSON.parse(replies.find((x) => x.id === 4).result.content[0].text);
  assert.equal(listed.posts.find((p: any) => p.id === mitos.id).status, 'aprovado');
  assert.equal(listed.andamento.done, 2);
  assert.equal((db.prepare('SELECT updated_by FROM content_posts WHERE id = ?').get(mitos.id) as any).updated_by, `agent:${job.agentId}`);

  // o funcionário não dispensa o tunning
  const dispensa = await app.inject({ method: 'POST', url: '/api/agente/calendario_salvar', remoteAddress: '127.0.0.1', headers: { host: 'localhost', authorization: `Bearer ${token}` }, payload: { posts: [{ id: mitos.id, tunning: 'dispensado' }] } });
  assert.equal(dispensa.statusCode, 409);

  // vez do navegador: com outro cliente no Chrome, o gancho espera; liberou, ele segue
  const { takeBrowser, releaseBrowser } = await import('../agents/runtime.ts');
  issueJobToken('outro-cliente');
  assert.equal(takeBrowser({ id: 'outro-cliente', officeId: job.officeId } as any), true);
  const hook = spawn(process.execPath, [path.resolve('src/agents/office-hook.mjs')], { env: { ...process.env, OFFICE_API: `http://127.0.0.1:${port}`, OFFICE_JOB_TOKEN: token } });
  hook.stdin.end('{}');
  let hookDone: number | null = null;
  hook.on('exit', (code) => { hookDone = code ?? -1; });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(hookDone, null, 'espera enquanto outro cliente usa o Chrome');
  const msgs = (db.prepare("SELECT text FROM job_messages WHERE job_id = ? AND role = 'sistema'").all(job.id) as any[]).map((m) => m.text);
  assert.ok(msgs.some((t) => t.startsWith('Esperando a vez do navegador')), msgs.join(' | '));
  releaseBrowser('outro-cliente');
  await wait(() => hookDone !== null);
  assert.equal(hookDone, 0);
  releaseBrowser(job.id);

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

test('reinício (atualização): a tarefa que rodava volta para a fila sozinha; caiu de novo sem avançar, espera alguém', async () => {
  const { recoverJobs, RESUMED_TEXT } = await import('../agents/runtime.ts');
  const job = (await call('GET', `${O}/jobs`)).json[0];
  const status = () => (db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any).status;
  db.prepare("UPDATE jobs SET status = 'rodando' WHERE id = ?").run(job.id);
  recoverJobs();
  await wait(() => status() === 'concluido');
  assert.equal(status(), 'concluido', 'retomou e terminou');
  const texts = (db.prepare("SELECT text FROM job_messages WHERE job_id = ? AND role = 'sistema'").all(job.id) as any[]).map((m) => m.text);
  assert.ok(texts.includes(RESUMED_TEXT));

  db.prepare("UPDATE jobs SET status = 'rodando' WHERE id = ?").run(job.id);
  db.prepare("INSERT INTO job_messages (id, job_id, role, text, created_at) VALUES (?, ?, 'sistema', ?, ?)").run('loop-1', job.id, RESUMED_TEXT, new Date(Date.now() + 60_000).toISOString());
  recoverJobs();
  assert.equal(status(), 'erro', 'não entra em ciclo');
});

test('agenda da social media: agendar com hora, marcar postado e desfazer só mudam o registro', async () => {
  const post = db.prepare("SELECT id, client_id AS clientId, date, theme, format FROM content_posts WHERE status != 'cancelado' LIMIT 1").get() as any;
  const mes = post.date.slice(0, 7);
  const base = { clientId: post.clientId, postId: post.id, files: [], theme: post.theme, format: post.format, date: `${mes}-20` };
  let r = await call('POST', `${O}/agenda`, { ...base, time: '18:30', state: 'agendado', caption: 'Legenda nova' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'programado');
  assert.equal(r.json.scheduledAt, `${mes}-20T18:30`);
  let item = (await call('GET', `${O}/agenda?mes=${mes}&cliente=${post.clientId}`)).json.find((i: any) => i.postId === post.id);
  assert.deepEqual([item.state, item.time, item.caption], ['agendado', '18:30', 'Legenda nova']);
  r = await call('POST', `${O}/agenda`, { ...base, state: 'postado' });
  assert.equal(r.json.status, 'postado');
  r = await call('POST', `${O}/agenda`, { ...base, state: 'pronto', time: null });
  assert.equal(r.json.status, 'drive');
  assert.equal(r.json.scheduledAt, null);
  assert.equal((await call('POST', `${O}/agenda`, { ...base, files: ['C:/Windows/win.ini'], state: 'agendado' })).status, 403, 'arquivo fora do escritório');
  assert.equal((await call('POST', `${O}/agenda`, { ...base, time: '25h', state: 'agendado' })).status, 409);
});

test('postado pela página Posts: os arquivos vão para POSTADOS e desfazer devolve', async () => {
  const { existsSync: has } = await import('node:fs');
  const c = (await call('GET', `${O}/clients`)).json[0];
  const office = (await call('GET', O)).json.office;
  const mesDir = path.join(office.rootPath, 'CLIENTES', 'MARIA TESTE', 'MES-TESTE');
  mkdirSync(mesDir, { recursive: true });
  const f1 = path.join(mesDir, '07 Carrossel – Postar hoje – 01.png');
  const f2 = path.join(mesDir, '07 Carrossel – Postar hoje – 02.png');
  writeFileSync(f1, 'a'); writeFileSync(f2, 'b');
  const base = { clientId: c.id, postId: null, files: [f1, f2], theme: 'Postar hoje', format: 'carrossel', date: '2026-11-21' };
  const r = await call('POST', `${O}/agenda`, { ...base, state: 'postado' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.moved, 2);
  const moved = path.join(mesDir, 'POSTADOS', '07_postado 2026-11-21 Carrossel – Postar hoje – 01.png');
  assert.ok(has(moved) && !has(f1), 'foi para POSTADOS com o nome de postado');
  assert.ok(r.json.files.some((f: string) => f === moved), 'o post aponta para o arquivo novo');
  const back = await call('POST', `${O}/agenda`, { ...base, postId: r.json.id, files: r.json.files, state: 'pronto' });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.ok(has(f1) && has(f2) && !has(moved), 'desfazer devolve para a pasta do mês');
  assert.equal(back.json.status, 'drive');
});

test('funcionário = sessão do cliente: nasce com o primeiro pedido, tem nome da lista e conversa nova chama outro', async () => {
  const c = (await call('GET', `${O}/clients`)).json[0];
  let workers = (await call('GET', `${O}/workers`)).json;
  const titular = workers.find((w: any) => w.clientId === c.id && w.role === 'titular' && !w.archivedAt);
  assert.ok(titular, 'o cliente que já pediu algo tem titular');
  assert.equal(titular.name, 'Vic', 'primeiro nome da lista');
  const jobs = (await call('GET', `${O}/jobs`)).json.filter((j: any) => j.clientId === c.id && j.stage !== 'aprovacao');
  assert.ok(jobs.length && jobs.every((j: any) => j.workerId === titular.id), 'as tarefas do cliente são dele');
  assert.equal(titular.state, 'copa', 'sem trabalho, fica na copa');
  const r = await call('POST', `${O}/workers/${titular.id}/arquivar`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  workers = (await call('GET', `${O}/workers`)).json;
  assert.ok(workers.find((w: any) => w.id === titular.id).archivedAt, 'arquivado fica no histórico');
  assert.equal((db.prepare('SELECT session_id FROM clients WHERE id = ?').get(c.id) as any).session_id, null, 'a conversa recomeça');
  const { ensureTitular } = await import('../agents/workers.ts');
  const novo = ensureTitular(titular.officeId, c.id, null);
  assert.notEqual(novo.id, titular.id);
  assert.equal(novo.name, 'Duda', 'o nome arquivado não volta logo');
});

test('conversa direta: só as duas pessoas leem, a não lida conta para quem recebeu e some ao abrir', async () => {
  const { createSession } = await import('../auth.ts');
  const officeId = O.split('/').pop()!;
  db.prepare("INSERT INTO users (id, name, color, created_at) VALUES ('u-bia', 'Bia Teste', '#123456', ?)").run(new Date().toISOString());
  db.prepare("INSERT INTO office_members (office_id, user_id, role) VALUES (?, 'u-bia', 'membro')").run(officeId);
  db.prepare("INSERT INTO users (id, name, color, created_at) VALUES ('u-fora', 'De Fora', '#654321', ?)").run(new Date().toISOString());
  const bia = createSession('u-bia');
  const as = async (tk: string, method: string, url: string, payload?: unknown) => {
    const res = await app.inject({ method: method as 'GET', url, remoteAddress: '127.0.0.1', headers: { host: 'localhost', authorization: `Bearer ${tk}` }, ...(payload ? { payload: payload as object } : {}) });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {} };
  };
  const me = (await call('GET', '/api/me')).json.user.id;
  assert.equal((await call('POST', `${O}/dm/u-bia`, { text: 'Oi, Bia! Viu a arte?' })).status, 200);
  assert.equal((await call('POST', `${O}/dm/u-fora`, { text: 'oi' })).status, 404, 'só gente do escritório');
  assert.equal((await call('POST', `${O}/dm/${me}`, { text: 'oi' })).status, 400, 'não conversa consigo');
  assert.deepEqual((await as(bia, 'GET', `${O}/dm`)).json, { [me]: 1 }, 'a Bia tem uma não lida');
  const conv = (await as(bia, 'GET', `${O}/dm/${me}`)).json;
  assert.deepEqual(conv.map((m: any) => m.text), ['Oi, Bia! Viu a arte?']);
  await as(bia, 'POST', `${O}/dm/${me}/lida`, {});
  assert.deepEqual((await as(bia, 'GET', `${O}/dm`)).json, {}, 'lida ao abrir');
  assert.deepEqual((await call('GET', `${O}/dm`)).json, {}, 'quem mandou não tem não lida');
});

test('ajudante: o funcionário pede, uma pessoa aprova, ele trabalha em sessão própria, devolve o resumo e é arquivado', async () => {
  const { issueJobToken } = await import('../agents/runtime.ts');
  const c = (await call('GET', `${O}/clients`)).json[0];
  // o cliente precisa de um titular ativo com uma tarefa (o anterior foi arquivado no teste da equipe)
  const { ensureTitular } = await import('../agents/workers.ts');
  const officeId = O.split('/').pop()!;
  const titular = ensureTitular(officeId, c.id, null);
  const job = (await call('GET', `${O}/jobs`)).json.find((j: any) => j.clientId === c.id && j.stage !== 'aprovacao');
  db.prepare('UPDATE jobs SET worker_id = ? WHERE id = ?').run(titular.id, job.id);
  const token = issueJobToken(job.id);
  const ask = await app.inject({ method: 'POST', url: '/api/agente/pedir_ajudante', remoteAddress: '127.0.0.1', headers: { host: 'localhost', authorization: `Bearer ${token}` }, payload: { tarefa: 'Tratar as 30 fotos do ensaio', motivo: 'enquanto monto os carrosséis' } });
  assert.equal(ask.statusCode, 200, ask.body);
  const pedido = (await call('GET', `${O}/helpers`)).json.find((h: any) => h.status === 'pendente');
  assert.equal(pedido.task, 'Tratar as 30 fotos do ensaio');
  const ok = await call('POST', `${O}/helpers/${pedido.id}`, { approve: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const helperId = ok.json.helper.id;
  const status = (id: string) => (db.prepare('SELECT archived_at FROM workers WHERE id = ?').get(id) as any).archived_at;
  await wait(() => !!status(helperId));
  assert.ok(status(helperId), 'terminou e foi arquivado');
  const helperJob = db.prepare('SELECT * FROM jobs WHERE worker_id = ?').get(helperId) as any;
  assert.equal(helperJob.status, 'concluido');
  assert.notEqual(helperJob.session_id, (db.prepare('SELECT session_id FROM clients WHERE id = ?').get(c.id) as any).session_id ?? 'x', 'sessão própria, fora da conversa do cliente');
  const msgs = (db.prepare("SELECT text FROM job_messages WHERE job_id = ? AND role = 'sistema'").all(job.id) as any[]).map((m) => m.text);
  assert.ok(msgs.some((t) => t.includes('(ajudante) terminou')), msgs.join(' | '));
  assert.equal((await call('POST', `${O}/helpers/${pedido.id}`, { approve: true })).status, 409, 'não decide duas vezes');
  // a conversa do titular continua com o resumo do ajudante: espera ela terminar antes de limpar a pasta do teste
  await wait(() => !(db.prepare("SELECT 1 FROM jobs WHERE status IN ('fila','rodando')").get()));
  assert.equal((db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any).status, 'concluido', 'o titular seguiu com o resultado');
});

test('virada de mês: o titular escreve a passagem, é arquivado e outro assume; quem começou neste mês não vira sozinho', async () => {
  const { monthlyTurnover } = await import('../agents/pipeline.ts');
  const c = (await call('GET', `${O}/clients`)).json[0];
  const officeId = O.split('/').pop()!;
  db.prepare("UPDATE clients SET session_id = 'sessao-de-teste' WHERE id = ?").run(c.id);
  assert.equal(monthlyTurnover(), 0, 'titular criado neste mês fica');
  const before = db.prepare("SELECT id, name FROM workers WHERE client_id = ? AND role = 'titular' AND archived_at IS NULL").get(c.id) as any;
  const r = await call('POST', `${O}/clients/${c.id}/virada`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const turn = db.prepare("SELECT * FROM jobs WHERE prompt LIKE '## Virada de mês%' AND client_id = ?").get(c.id) as any;
  assert.ok(turn.prompt.includes('PASSAGEM '), 'pede o arquivo da passagem');
  await wait(() => !!(db.prepare('SELECT archived_at FROM workers WHERE id = ?').get(before.id) as any).archived_at);
  const after = db.prepare("SELECT id, name FROM workers WHERE client_id = ? AND role = 'titular' AND archived_at IS NULL").get(c.id) as any;
  assert.ok(after && after.id !== before.id, `outro assumiu (${before.name} → ${after?.name})`);
  assert.equal((db.prepare('SELECT session_id FROM clients WHERE id = ?').get(c.id) as any).session_id, null, 'conversa nova');
  void officeId;
});

