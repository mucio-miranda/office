import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

// Claude de mentira: responde na hora, sem gastar nada
const dataDir = mkdtempSync(path.join(tmpdir(), 'office-demand-'));
const fake = path.join(dataDir, 'fake-claude.mjs');
const argsLog = path.join(dataDir, 'args.log');
writeFileSync(fake, `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const id = '11111111-2222-4333-8444-555555555555';
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
/** GET cru (mídia), com a sessão da pessoa */
const rawGet = (url: string) => app.inject({ method: 'GET', url, remoteAddress: '127.0.0.1', headers: { host: 'localhost', authorization: `Bearer ${token}` } });
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
  // trabalho de cliente roda no perfil "Sessão" (todas as skills), não mais no funcionário da função
  assert.equal(job.agentId, agents.find((a) => a.slug === 'sessao')!.id);
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
  // retomar transforma a conversa do terminal numa sessão aberta do cliente, com o nome dela
  const retomada = await call('POST', `${O}/clients/${c.id}/sessoes/${sid}/retomar`, {});
  assert.equal(retomada.status, 200);
  const row = db.prepare('SELECT session_id, session_cost, title, archived_at FROM workers WHERE id = ?').get(retomada.json.id) as any;
  assert.deepEqual([row.session_id, row.session_cost, row.title, row.archived_at], [sid, -1, 'planeje novembro', null], 'custo anterior desconhecido');
  assert.equal((await call('POST', `${O}/clients/${c.id}/sessoes/${sid}/retomar`, {})).json.id, retomada.json.id, 'retomar de novo abre a mesma sessão');
  // a que está aberta como sessão não se arquiva; outra sai da lista e volta ao desarquivar ou ao continuar nela
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

  // caminho citado na conversa: relativo à pasta em que o funcionário trabalha; fora das pastas do escritório não abre
  mkdirSync(path.join(cwd, 'REDES SOCIAIS', 'NOV'), { recursive: true });
  writeFileSync(path.join(cwd, 'REDES SOCIAIS', 'NOV', 'final.mp4'), 'x');
  const achou = await call('GET', `${O}/clients/${c.id}/caminho?path=${encodeURIComponent(['REDES SOCIAIS', 'NOV', 'final.mp4'].join(String.fromCharCode(92)))}`);
  assert.deepEqual([achou.status, achou.json.abs, achou.json.dir], [200, path.join(cwd, 'REDES SOCIAIS', 'NOV', 'final.mp4'), false]);
  assert.equal((await call('GET', `${O}/clients/${c.id}/caminho?path=${encodeURIComponent(['REDES SOCIAIS', 'NOV', ''].join(String.fromCharCode(92)))}`)).json.dir, true);
  assert.equal((await call('GET', `${O}/clients/${c.id}/caminho?path=${encodeURIComponent(['nao', 'existe.mp4'].join(String.fromCharCode(92)))}`)).status, 404);
  assert.equal((await call('GET', `${O}/clients/${c.id}/caminho?path=${encodeURIComponent(path.resolve('package.json'))}`)).status, 403);

  // daily report: junta a conversa do terminal de hoje (pedido, resposta final, arquivo mexido) e roda no Sonnet
  const hoje = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const agora = new Date().toISOString();
  writeFileSync(path.join(proj, `${hoje}.jsonl`), [
    { type: 'user', timestamp: agora, cwd, message: { role: 'user', content: 'refaz a legenda do reels da Maria' } },
    { type: 'assistant', timestamp: agora, cwd, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'C:/x/legenda.srt' } }] } },
    { type: 'assistant', timestamp: agora, cwd, message: { role: 'assistant', content: [{ type: 'text', text: 'Legenda refeita e entregue.' }] } },
    { type: 'user', timestamp: '2026-01-01T10:00:00Z', cwd, message: { role: 'user', content: 'pedido de outro dia' } },
  ].map((e) => JSON.stringify(e)).join(String.fromCharCode(10)));
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando')").all().length));
  // limite da assinatura: o Claude Code informa no stream; o daily mostra o limite, nunca custo em dólar
  const { recordUsage } = await import('../agents/usage.ts');
  recordUsage({ unifiedWindows: { five_hour: { utilization: 0.12, resetsAt: 1795223400 }, seven_day: { utilization: 0.38, resetsAt: 1795694400 } } });
  assert.equal((await call('GET', `${O}/limite`)).json.sevenDay, 0.38);
  const daily = await call('POST', `${O}/daily`, {});
  assert.equal(daily.status, 200, JSON.stringify(daily.json));
  const djob = db.prepare('SELECT prompt, model, client_id FROM jobs WHERE id = ?').get(daily.json.id) as any;
  assert.equal(djob.model, 'haiku');
  assert.equal(djob.client_id, null);
  assert.ok(djob.prompt.includes('> refaz a legenda do reels da Maria'), djob.prompt.slice(0, 2000));
  assert.ok(djob.prompt.includes('> Legenda refeita e entregue.'));
  assert.ok(djob.prompt.includes('C:/x/legenda.srt'));
  assert.ok(!djob.prompt.includes('pedido de outro dia'), 'só o dia pedido');
  assert.ok(djob.prompt.includes('Limite semanal da assinatura do Claude: 38% usado'), 'limite no levantamento');
  assert.ok(!djob.prompt.includes('US$'), 'sem custo em dólar');
  assert.equal((await call('POST', `${O}/daily`, { dia: '2001-01-01' })).status, 409, 'dia sem nada');
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
  assert.deepEqual(replies.find((x) => x.id === 2).result.tools.map((t: any) => t.name), ['calendario_listar', 'calendario_salvar', 'posts_do_mes', 'posts_marcar_postado', 'pedir_ajudante', 'copiar_para_local', 'copia_status', 'drive_caminho', 'mover', 'navegador_liberar']);
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
  hook.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'mcp__claude-in-chrome__navigate' }));
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

  // vez do render: só o comando que renderiza espera; o resto do Bash (roteiro, ler arquivos) segue na hora
  const { takeRender, releaseRender } = await import('../agents/runtime.ts');
  assert.equal(takeRender({ id: 'outro-cliente', officeId: job.officeId } as any), true);
  const runHook = (ev: object) => {
    const h = spawn(process.execPath, [path.resolve('src/agents/office-hook.mjs')], { env: { ...process.env, OFFICE_API: `http://127.0.0.1:${port}`, OFFICE_JOB_TOKEN: token } });
    h.stdin.end(JSON.stringify(ev));
    const st = { code: null as number | null };
    h.on('exit', (code) => { st.code = code ?? -1; });
    return st;
  };
  const leitura = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls "H:/Meu Drive/REZZU"' } });
  await wait(() => leitura.code !== null);
  assert.equal(leitura.code, 0, 'comando que não renderiza não espera');
  const ff = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ffmpeg -i bruto.mp4 final.mp4' } });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(ff.code, null, 'render espera o outro vídeo');
  assert.ok((db.prepare("SELECT text FROM job_messages WHERE job_id = ? AND role = 'sistema'").all(job.id) as any[]).some((m) => m.text.startsWith('Esperando a vez de renderizar')));
  releaseRender('outro-cliente');
  await wait(() => ff.code !== null);
  // terminou o comando: o PostToolUse devolve a vez
  const fim = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ffmpeg -i bruto.mp4 final.mp4' } });
  await wait(() => fim.code !== null);
  assert.equal(takeRender({ id: 'outro-cliente', officeId: job.officeId } as any), true, 'a vez voltou');
  releaseRender('outro-cliente');

  // prévia ao vivo: o render que terminou aparece no estúdio; o arquivo só sai para quem é do escritório
  const { mkdtempSync, writeFileSync: wf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const pasta = mkdtempSync(path.join(tmpdir(), 'tv-'));
  wf(path.join(pasta, 'previa.mp4'), 'x');
  const tv = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: pasta, tool_input: { command: 'ffmpeg -i "H:/bruto.mp4" previa.mp4' }, tool_response: { stdout: '' } });
  await wait(() => tv.code !== null);
  const previas = await call('GET', `${O}/jobs/${job.id}/previas`);
  assert.equal(previas.json.length, 1, JSON.stringify(previas.json));
  assert.equal(path.basename(previas.json[0].path), 'previa.mp4');
  const raw = (file: string) => rawGet(`${O}/jobs/${job.id}/previas/arquivo?path=${encodeURIComponent(file)}`);
  const arq = await raw(previas.json[0].path);
  assert.equal(arq.statusCode, 200);
  assert.equal(arq.headers['content-type'], 'video/mp4');
  assert.equal((await raw(path.resolve('package.json'))).statusCode, 404, 'arquivo que a tarefa não gerou não sai');

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
  assert.equal(titular.name, 'Luna', 'primeiro nome da lista que não é de um funcionário de função (Vic, Duda, Theo e Rafa ficam no mapa)');
  const jobs = (await call('GET', `${O}/jobs`)).json.filter((j: any) => j.clientId === c.id && j.stage !== 'aprovacao');
  assert.ok(jobs.length && jobs.every((j: any) => j.workerId === titular.id), 'as tarefas do cliente são dele');
  assert.equal(titular.state, 'copa', 'sem trabalho, fica na copa');
  // nome próprio: dá para trocar, com validação
  assert.equal((await call('PATCH', `${O}/workers/${titular.id}`, { name: 'Bia' })).status, 200);
  assert.equal((await call('GET', `${O}/workers`)).json.find((w: any) => w.id === titular.id).name, 'Bia');
  assert.equal((await call('PATCH', `${O}/workers/${titular.id}`, { name: 'x' })).status, 400, 'nome curto');
  assert.equal((await call('PATCH', `${O}/workers/${titular.id}`, { name: titular.name })).status, 200, 'volta ao nome da lista');
  const r = await call('POST', `${O}/workers/${titular.id}/arquivar`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // com conversa, a sessão primeiro grava a memória e o resumo e só depois é arquivada
  await wait(() => !!(db.prepare('SELECT archived_at FROM workers WHERE id = ?').get(titular.id) as any).archived_at);
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando')").all().length));
  workers = (await call('GET', `${O}/workers`)).json;
  assert.ok(workers.find((w: any) => w.id === titular.id).archivedAt, 'arquivado fica no histórico');
  const { ensureTitular, sessionsOf } = await import('../agents/workers.ts');
  assert.ok(!sessionsOf(c.id).some((w) => w.id === titular.id), 'a sessão arquivada sai da lista do cliente');
  const novo = ensureTitular(titular.officeId, c.id, null);
  assert.notEqual(novo.id, titular.id);
  assert.equal(novo.name, 'Nico', 'o nome arquivado não volta logo');
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
  // uma tarefa normal da conversa (não a de fechamento da sessão arquivada no teste anterior)
  const job = db.prepare("SELECT id FROM jobs WHERE client_id = ? AND (stage IS NULL OR stage != 'aprovacao') AND prompt NOT LIKE '## Conversa nova%' ORDER BY created_at LIMIT 1").get(c.id) as { id: string };
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
  assert.equal(helperJob.worker_id, helperId);
  assert.equal((db.prepare('SELECT session_id FROM workers WHERE id = ?').get(helperId) as any).session_id, null, 'sessão própria: o ajudante não vira uma sessão do cliente');
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
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando','aguardando')").all().length));
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


test('conversa longa: memória e resumo antes, depois o pedido segue numa conversa nova com o mesmo funcionário', async () => {
  const c = (await call('GET', `${O}/clients`)).json[0];
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando')").all().length));
  // a conversa desta sessão passou de 100 mil tokens relidos (vale por sessão: as outras do cliente não contam)
  const titular = db.prepare("SELECT id FROM workers WHERE client_id = ? AND role = 'titular' AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1").get(c.id) as any;
  db.prepare("UPDATE workers SET session_id = 'sessao-longa' WHERE id = ?").run(titular.id);
  const last = db.prepare("SELECT id FROM jobs WHERE client_id = ? ORDER BY created_at DESC LIMIT 1").get(c.id) as any;
  db.prepare("UPDATE jobs SET session_id = 'sessao-longa', context_tokens = 130000, status = 'concluido', worker_id = ? WHERE id = ?").run(titular.id, last.id);
  db.prepare("UPDATE demands SET status = 'entregue' WHERE client_id = ?").run(c.id);
  const r = await call('POST', `${O}/clients/${c.id}/conversa`, { text: 'troca o título da arte', workerId: titular.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const ref = db.prepare("SELECT * FROM jobs WHERE client_id = ? AND prompt LIKE '## Conversa nova%' ORDER BY created_at DESC LIMIT 1").get(c.id) as any;
  assert.ok(ref, 'pede memória e resumo antes');
  assert.ok(ref.prompt.includes('CLAUDE.md') && ref.prompt.includes('RESUMO '), 'memória do cliente e resumo da conversa');
  assert.equal(ref.worker_id, titular?.id ?? null, 'o mesmo funcionário');
  // terminou: a conversa recomeça e o pedido guardado segue
  await wait(() => !!db.prepare("SELECT id FROM jobs WHERE client_id = ? AND prompt LIKE '%troca o título da arte%' AND prompt NOT LIKE '## Conversa nova%'").get(c.id));
  const next = db.prepare("SELECT * FROM jobs WHERE client_id = ? AND prompt LIKE '%troca o título da arte%' AND prompt NOT LIKE '## Conversa nova%'").get(c.id) as any;
  assert.ok(next, 'o pedido seguiu');
  assert.equal(next.worker_id, titular?.id ?? null, 'com o mesmo funcionário');
  assert.ok(!(db.prepare("SELECT archived_at FROM workers WHERE id = ?").get(titular.id) as any).archived_at, 'ninguém é arquivado');
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando')").all().length));
});

test('modelo da conversa: escolhido no cliente, vai para o Claude Code; sem escolha vale o do escritório', async () => {
  const { readFileSync, existsSync: has } = await import('node:fs');
  const c = (await call('GET', `${O}/clients`)).json[0];
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando','aguardando')").all().length));
  assert.equal((await call('PATCH', `${O}/clients/${c.id}`, { model: 'gpt' })).status, 400, 'só haiku, sonnet ou opus');
  assert.equal((await call('PATCH', `${O}/clients/${c.id}`, { model: 'haiku' })).status, 200);
  assert.equal((await call('GET', `${O}/clients`)).json[0].model, 'haiku');
  const modelArg = () => (has(argsLog) ? readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) : []).at(-1)?.join(' ') ?? '';
  const n0 = has(argsLog) ? readFileSync(argsLog, 'utf8').trim().split('\n').length : 0;
  assert.equal((await call('POST', `${O}/clients/${c.id}/conversa`, { text: 'só um oi' })).status, 200);
  await wait(() => (has(argsLog) ? readFileSync(argsLog, 'utf8').trim().split('\n').length : 0) > n0);
  assert.match(modelArg(), /--model haiku/, 'a conversa usa o modelo escolhido');
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando','aguardando')").all().length));
  assert.equal((await call('PATCH', `${O}/clients/${c.id}`, { model: null })).status, 200, 'volta ao padrão');
  assert.equal((await call('GET', `${O}/clients`)).json[0].model, null);
});

test('sessão nova: abre ao lado das outras, mesmo com uma trabalhando ou esperando você, e não mexe nelas', async () => {
  const c = (await call('GET', `${O}/clients`)).json[0];
  const job = db.prepare('SELECT id, worker_id FROM jobs WHERE client_id = ? AND worker_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1').get(c.id) as { id: string; worker_id: string };
  db.prepare("UPDATE jobs SET status = 'aguardando' WHERE id = ?").run(job.id);
  const r = await call('POST', `${O}/clients/${c.id}/conversa/nova`, { title: 'Story Falconi' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.title, 'Story Falconi');
  assert.notEqual(r.json.id, job.worker_id, 'é outra sessão');
  assert.equal((db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any).status, 'aguardando', 'a pergunta da outra sessão continua esperando');
  assert.ok(!(db.prepare('SELECT archived_at FROM workers WHERE id = ?').get(job.worker_id) as any).archived_at, 'a outra sessão continua aberta');
  db.prepare("UPDATE jobs SET status = 'rodando' WHERE id = ?").run(job.id);
  assert.equal((await call('POST', `${O}/clients/${c.id}/conversa/nova`, { title: 'Outra' })).status, 200, 'trabalhando também não trava');
  // o pedido vai para a sessão escolhida, não para a mais nova
  db.prepare("UPDATE jobs SET status = 'concluido' WHERE id = ?").run(job.id);
  const { sessionFor } = await import('../agents/workers.ts');
  assert.equal(sessionFor(O.split('/').pop()!, c.id, r.json.id, null).id, r.json.id);
  assert.equal(sessionFor(O.split('/').pop()!, c.id, 'nao-existe', null).clientId, c.id, 'sessão inválida cai na mais nova do cliente');
  // nome da sessão dá para trocar
  assert.equal((await call('PATCH', `${O}/workers/${r.json.id}`, { title: 'Stories de novembro' })).status, 200);
  assert.equal((db.prepare('SELECT title FROM workers WHERE id = ?').get(r.json.id) as any).title, 'Stories de novembro');
});

test('encerrar um pedido esperando aprovação: a tarefa sai de "esperando você" e a demanda continua existindo', async () => {
  const c = (await call('GET', `${O}/clients`)).json[0];
  const job = db.prepare('SELECT id, demand_id FROM jobs WHERE client_id = ? AND demand_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1').get(c.id) as { id: string; demand_id: string };
  db.prepare("UPDATE jobs SET status = 'aguardando' WHERE id = ?").run(job.id);
  assert.equal((await call('POST', `${O}/jobs/${job.id}/cancel`, {})).status, 200);
  assert.equal((db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as any).status, 'cancelado');
  assert.ok(db.prepare('SELECT id FROM demands WHERE id = ?').get(job.demand_id), 'a demanda não é apagada');
});

test('sessão nova levando o resumo: a primeira mensagem lê o resumo mais recente do cliente; sem pedir, começa limpa', async () => {
  const c = (await call('GET', `${O}/clients`)).json[0];
  const { conversationsDirOf } = await import('../agents/pipeline.ts');
  const dir = conversationsDirOf(c.id)!;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'RESUMO 2026-11-20 10h00.md'), 'antigo');
  writeFileSync(path.join(dir, 'RESUMO 2026-11-22 17h10.md'), 'o mais novo');
  const com = await call('POST', `${O}/clients/${c.id}/conversa/nova`, { title: 'Continuação', levarResumo: true });
  assert.equal(com.status, 200);
  assert.equal((db.prepare('SELECT handoff FROM workers WHERE id = ?').get(com.json.id) as any).handoff, path.join(dir, 'RESUMO 2026-11-22 17h10.md'));
  const sem = await call('POST', `${O}/clients/${c.id}/conversa/nova`, { title: 'Do zero' });
  assert.equal((db.prepare('SELECT handoff FROM workers WHERE id = ?').get(sem.json.id) as any).handoff, null);
});

test('arquivar sessão: com conversa, antes grava a memória do cliente e o resumo e só depois sai da lista; sem conversa, sai na hora', async () => {
  const c = (await call('GET', `${O}/clients`)).json[0];
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando','aguardando')").all().length));
  const vazia = (await call('POST', `${O}/clients/${c.id}/conversa/nova`, { title: 'Vazia' })).json;
  const r0 = await call('POST', `${O}/workers/${vazia.id}/arquivar`, {});
  assert.deepEqual([r0.status, r0.json.closing], [200, false]);
  assert.ok((db.prepare('SELECT archived_at FROM workers WHERE id = ?').get(vazia.id) as any).archived_at, 'sem conversa, arquiva na hora');
  const usada = (await call('POST', `${O}/clients/${c.id}/conversa/nova`, { title: 'Usada' })).json;
  db.prepare("UPDATE workers SET session_id = 'sessao-usada' WHERE id = ?").run(usada.id);
  const r = await call('POST', `${O}/workers/${usada.id}/arquivar`, {});
  assert.deepEqual([r.status, r.json.closing], [200, true]);
  const fecha = db.prepare("SELECT * FROM jobs WHERE worker_id = ? AND prompt LIKE '%fechar-sessao%'").get(usada.id) as any;
  assert.ok(fecha && fecha.prompt.includes('CLAUDE.md') && fecha.prompt.includes('RESUMO '), 'pede memória do cliente e resumo');
  await wait(() => !!(db.prepare('SELECT archived_at FROM workers WHERE id = ?').get(usada.id) as any).archived_at);
  assert.ok((db.prepare('SELECT archived_at FROM workers WHERE id = ?').get(usada.id) as any).archived_at, 'arquivada depois de gravar');
  await wait(() => !(db.prepare("SELECT id FROM jobs WHERE status IN ('fila','rodando')").all().length));
});

test('arquivar tarefas no painel do funcionário: some da lista, nada é apagado; em andamento não arquiva', async () => {
  const jobs = (await call('GET', `${O}/jobs`)).json as any[];
  const done = jobs.find((j) => j.status === 'concluido' || j.status === 'cancelado');
  assert.ok(done, 'há uma tarefa terminada');
  assert.equal((await call('POST', `${O}/jobs/${done.id}/arquivar`, { archived: true })).status, 200);
  assert.ok((await call('GET', `${O}/jobs`)).json.find((j: any) => j.id === done.id).archivedAt, 'marcada como arquivada');
  assert.equal((await call('POST', `${O}/jobs/${done.id}/arquivar`, { archived: false })).status, 200);
  assert.equal((await call('GET', `${O}/jobs`)).json.find((j: any) => j.id === done.id).archivedAt, null);
  // rodando ou esperando você: não arquiva
  db.prepare("UPDATE jobs SET status = 'aguardando' WHERE id = ?").run(done.id);
  assert.equal((await call('POST', `${O}/jobs/${done.id}/arquivar`, { archived: true })).status, 409);
  db.prepare("UPDATE jobs SET status = 'concluido' WHERE id = ?").run(done.id);
  // todas as terminadas de um funcionário de uma vez
  const r = await call('POST', `${O}/agents/${done.agentId}/arquivar-concluidas`, {});
  assert.equal(r.status, 200);
  assert.ok(r.json.archived >= 1);
  const mine = (await call('GET', `${O}/jobs`)).json.filter((j: any) => j.agentId === done.agentId);
  assert.ok(mine.filter((j: any) => ['concluido', 'cancelado', 'erro'].includes(j.status)).every((j: any) => j.archivedAt));
});

test('triagem: palavra de site vai para design; sem palavra-chave, a IA decide e, se falhar, vale o tipo do último pedido do cliente', async () => {
  const { guessKind } = await import('../agents/skills.ts');
  for (const t of ['siga com o site', 'ajuste a landing page', 'fundo com parallax na seção', 'aparelho 3D da batida 3']) assert.equal(guessKind(t), 'design', t);
  assert.equal(guessKind('bom dia, tudo certo?'), 'outro');
  const { parseTriage, triageKind } = await import('../agents/triage.ts');
  assert.equal(parseTriage('{"type":"result","result":"design"}'), 'design');
  assert.equal(parseTriage(JSON.stringify({ type: 'result', result: ' Vídeo.\n' })), 'video');
  assert.equal(parseTriage('{"type":"result","result":"não sei"}'), null);
  // o Claude de mentira responde "Feito.": a triagem não decide e o pedido segue com o tipo do último pedido do cliente
  assert.equal(await triageKind('qualquer coisa'), null);
  const c = (await call('GET', `${O}/clients`)).json[0];
  db.prepare("UPDATE jobs SET status = 'concluido' WHERE client_id = ? AND status IN ('fila','rodando','aguardando')").run(c.id);
  db.prepare("UPDATE demands SET status = 'entregue' WHERE client_id = ?").run(c.id);
  const before = (db.prepare('SELECT count(*) n FROM demands WHERE client_id = ?').get(c.id) as any).n;
  const last = db.prepare("SELECT kind FROM demands WHERE client_id = ? AND kind != 'outro' ORDER BY created_at DESC LIMIT 1").get(c.id) as any;
  assert.equal((await call('POST', `${O}/clients/${c.id}/conversa`, { text: 'bom dia, segue aquilo', newRequest: true })).status, 200);
  await wait(() => (db.prepare('SELECT count(*) n FROM demands WHERE client_id = ?').get(c.id) as any).n > before && !!db.prepare("SELECT id FROM jobs WHERE demand_id = (SELECT id FROM demands WHERE client_id = ? ORDER BY created_at DESC LIMIT 1)").get(c.id));
  const d = db.prepare('SELECT kind FROM demands WHERE client_id = ? ORDER BY created_at DESC LIMIT 1').get(c.id) as any;
  assert.equal(d.kind, last?.kind ?? 'outro', 'sem decisão da IA, segue o tipo do último pedido');
  // a tarefa que o pedido abriu termina antes do fim da suíte (o banco fecha no after)
  await wait(() => !db.prepare("SELECT id FROM jobs WHERE client_id = ? AND status IN ('fila','rodando')").get(c.id));
});
