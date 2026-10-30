import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';

const dataDir = mkdtempSync(path.join(tmpdir(), 'office-auth-'));
process.env.OFFICE_DATA = dataDir;
const { api } = await import('./routes/api.ts');
const { db } = await import('./db.ts');
const { guardHost, hostAllowed, resetAttempts } = await import('./auth.ts');
const { backupDir, listBackups, runBackup } = await import('./backup.ts');

const LOCAL = '127.0.0.1';
const VPN = '100.70.1.2';
const STRONG = 'senha-forte-1';
let app: FastifyInstance;

const call = async (method: string, url: string, o: { ip?: string; token?: string; body?: unknown; host?: string } = {}) => {
  const res = await app.inject({
    method: method as 'GET', url, remoteAddress: o.ip ?? VPN,
    headers: { host: o.host ?? 'localhost:4747', ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
    ...(o.body !== undefined ? { payload: o.body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {} };
};
const enter = (name: string, pin?: string, o: { ip?: string; invite?: string } = {}) =>
  call('POST', '/api/auth/enter', { ip: o.ip, body: { name, pin, invite: o.invite } });

let owner: string;
let officeId: string;
let invite: string;

before(async () => {
  app = Fastify();
  app.addHook('onRequest', guardHost);
  await app.register(api);
  const r = await enter('Dona', STRONG, { ip: LOCAL });
  assert.equal(r.status, 200);
  owner = r.json.token;
  const o = await call('POST', '/api/offices', { ip: LOCAL, token: owner, body: { name: 'REZZU', rootPath: dataDir } });
  assert.equal(o.status, 200);
  officeId = o.json.id;
  invite = o.json.inviteCode;
});
beforeEach(() => resetAttempts());
after(async () => {
  await app.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const O = () => `/api/offices/${officeId}`;
const join = async (name: string) => {
  const r = await enter(name, STRONG, { invite });
  assert.equal(r.status, 200);
  return r.json as { token: string; user: { id: string } };
};

test('de fora, conta nova só com convite válido', async () => {
  assert.equal((await enter('Estranho', STRONG)).status, 401);
  assert.equal((await enter('Estranho', STRONG, { invite: 'ERRADO' })).status, 401);
  const r = await enter('Convidada', STRONG, { invite });
  assert.equal(r.status, 200);
  assert.equal(r.json.officeId, officeId);
  const me = await call('GET', '/api/me', { token: r.json.token });
  assert.equal(me.json.offices[0].role, 'membro');
});

test('senha curta não cria conta', async () => {
  assert.equal((await enter('Curta', '1234', { invite })).status, 400);
  assert.equal((await enter('Curta', undefined, { invite })).status, 400);
});

test('erros seguidos bloqueiam por um tempo, mesmo com a senha certa depois', async () => {
  await join('Alvo');
  for (let i = 0; i < 5; i++) assert.equal((await enter('Alvo', 'errada-errada')).status, 401);
  assert.equal((await enter('Alvo', STRONG)).status, 429);
  // de outro endereço a pessoa continua entrando
  assert.equal((await enter('Alvo', STRONG, { ip: '100.70.9.9' })).status, 200);
});

test('conta antiga sem senha: de fora é recusada, no computador do Office vai para a troca', async () => {
  db.prepare("INSERT INTO users (id, name, color, pin_hash, created_at) VALUES ('velha', 'Antiga', '#000000', NULL, 'x')").run();
  assert.equal((await enter('Antiga')).status, 401);
  const r = await enter('Antiga', undefined, { ip: LOCAL });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.mustChangePin, true);
  // até trocar, só as rotas da troca respondem
  assert.equal((await call('GET', '/api/offices/x', { token: r.json.token })).status, 403);
  assert.equal((await call('POST', '/api/auth/senha', { token: r.json.token, body: { pin: 'curta' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/senha', { token: r.json.token, body: { pin: STRONG } })).status, 200);
  const me = await call('GET', '/api/me', { token: r.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.mustChangePin, false);
  assert.equal((await enter('Antiga', STRONG)).status, 200);
});

test('o PIN curto da versão antiga ainda entra, mas obriga a troca', async () => {
  const { hashPin } = await import('./auth.ts');
  db.prepare("INSERT INTO users (id, name, color, pin_hash, created_at) VALUES ('pin', 'ComPin', '#000000', ?, 'x')").run(hashPin('1234'));
  const r = await enter('ComPin', '1234');
  assert.equal(r.status, 200);
  assert.equal(r.json.user.mustChangePin, true);
});

test('o banco não guarda o token, e sessão vencida ou encerrada para de valer', async () => {
  const { token, user } = await join('Sessao');
  const rows = db.prepare('SELECT token, expires_at FROM sessions WHERE user_id = ?').all(user.id) as { token: string }[];
  assert.ok(rows.length && rows.every((s) => s.token !== token));

  db.prepare("UPDATE sessions SET expires_at = '2000-01-01' WHERE user_id = ?").run(user.id);
  assert.equal((await call('GET', '/api/me', { token })).status, 401);

  const again = (await enter('Sessao', STRONG)).json.token;
  assert.equal((await call('POST', '/api/auth/sair', { token: again })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: again })).status, 401);
});

test('trocar a senha exige a atual e derruba os outros aparelhos', async () => {
  const { token } = await join('Troca');
  const other = (await enter('Troca', STRONG)).json.token;
  assert.equal((await call('POST', '/api/auth/senha', { token, body: { current: 'errada-errada', pin: 'senha-nova-22' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/senha', { token, body: { current: STRONG, pin: 'senha-nova-22' } })).status, 200);
  assert.equal((await call('GET', '/api/me', { token })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: other })).status, 401);
  assert.equal((await enter('Troca', 'senha-nova-22')).status, 200);
});

test('membro não mexe em pastas, permissões, convite nem contas, e não vê o convite', async () => {
  const { token, user } = await join('Membro');
  assert.equal((await call('PATCH', O(), { token, body: { rootPath: 'C:\\' } })).status, 403);
  assert.equal((await call('POST', `${O()}/convite`, { token })).status, 403);
  assert.equal((await call('GET', `${O()}/backups`, { token })).status, 403);
  assert.equal((await call('POST', `${O()}/members/${user.id}/redefinir`, { token })).status, 403);
  const agent = (await call('GET', `${O()}/agents`, { token })).json[0];
  assert.equal((await call('PATCH', `${O()}/agents/${agent.id}`, { token, body: { allowedTools: ['Bash'] } })).status, 403);
  assert.equal((await call('POST', '/api/offices', { token, body: { name: 'Meu', rootPath: dataDir } })).status, 403);
  assert.equal((await call('GET', '/api/me', { token })).json.offices[0].inviteCode, '');
  assert.equal((await call('GET', O(), { token })).json.office.inviteCode, '');
});

test('um escritório não alcança as tarefas e timelines de outro', async () => {
  const other = (await call('POST', '/api/offices', { ip: LOCAL, token: owner, body: { name: 'Outro', rootPath: dataDir } })).json;
  const agent = (await call('GET', `/api/offices/${other.id}/agents`, { token: owner })).json[0];
  db.prepare("INSERT INTO jobs (id, office_id, agent_id, prompt, status, created_at, updated_at) VALUES ('job-outro', ?, ?, 'p', 'aguardando', 'x', 'x')").run(other.id, agent.id);
  db.prepare("INSERT INTO timelines (id, office_id, name, json, base_dir, updated_at) VALUES ('tl-outro', ?, 'n', '{}', 'b', 'x')").run(other.id);
  const { token } = await join('Vizinha');
  assert.equal((await call('GET', `${O()}/jobs/job-outro/messages`, { token })).status, 404);
  assert.equal((await call('POST', `${O()}/jobs/job-outro/reply`, { token, body: { text: 'oi' } })).status, 404);
  assert.equal((await call('POST', `${O()}/jobs/job-outro/cancel`, { token })).status, 404);
  assert.equal((await call('PUT', `${O()}/timelines/tl-outro`, { token, body: { name: 'x' } })).status, 404);
  assert.equal((await call('PATCH', `${O()}/agents/${agent.id}`, { token: owner, body: { name: 'x' } })).status, 404);
});

test('o código de redefinição vale uma vez e derruba as sessões antigas', async () => {
  const { token, user } = await join('Esqueci');
  const { code } = (await call('POST', `${O()}/members/${user.id}/redefinir`, { token: owner })).json;
  assert.ok(code);
  assert.equal((await call('GET', '/api/me', { token })).status, 401);
  assert.equal((await call('POST', '/api/auth/redefinir', { body: { name: 'Esqueci', code: 'ERRADO', pin: 'senha-nova-33' } })).status, 401);
  // sem código, só no computador do Office
  assert.equal((await call('POST', '/api/auth/redefinir', { body: { name: 'Esqueci', pin: 'senha-nova-33' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/redefinir', { body: { name: 'Esqueci', code, pin: 'senha-nova-33' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/redefinir', { body: { name: 'Esqueci', code, pin: 'senha-nova-44' } })).status, 401);
  assert.equal((await enter('Esqueci', 'senha-nova-33')).status, 200);
});

test('remover uma pessoa encerra o acesso; o dono não pode ser removido', async () => {
  const { token, user } = await join('Saiu');
  assert.equal((await call('DELETE', `${O()}/members/${user.id}`, { token: owner })).status, 200);
  assert.equal((await call('GET', O(), { token })).status, 401);
  const relogin = (await enter('Saiu', STRONG)).json.token;
  assert.equal((await call('GET', O(), { token: relogin })).status, 403);
  const me = (await call('GET', '/api/me', { token: owner })).json.user.id;
  assert.equal((await call('DELETE', `${O()}/members/${me}`, { token: owner })).status, 409);
});

test('trocar o convite invalida o código antigo', async () => {
  const old = invite;
  invite = (await call('POST', `${O()}/convite`, { token: owner })).json.inviteCode;
  assert.notEqual(invite, old);
  assert.equal((await enter('Atrasada', STRONG, { invite: old })).status, 401);
  assert.equal((await enter('Atrasada', STRONG, { invite })).status, 200);
});

test('navegar pelas pastas da máquina continua só local', async () => {
  assert.equal((await call('GET', '/api/system/browse', { token: owner })).status, 403);
  assert.equal((await call('GET', '/api/system/browse', { token: owner, ip: LOCAL })).status, 200);
});

test('nomes de domínio estranhos são recusados (DNS rebinding)', async () => {
  assert.equal((await call('GET', '/api/me', { token: owner, host: 'site-malicioso.com:4747', ip: LOCAL })).status, 403);
  for (const h of ['localhost:4747', '127.0.0.1:4747', '[::1]:4747', '100.70.1.2:4747', '192.168.0.10:4747', 'meu-pc.netbird.cloud:4747']) assert.ok(hostAllowed(h), h);
  for (const h of ['site-malicioso.com', 'localhost.site-malicioso.com', 'netbird.cloud.site-malicioso.com', undefined]) assert.ok(!hostAllowed(h), String(h));
});

test('backup: a cópia abre íntegra, tem os dados e só as 14 mais recentes ficam', async () => {
  const stale = path.join(backupDir(), 'office-20000101-000000.db');
  const res = runBackup();
  const copy = new DatabaseSync(res.file, { readOnly: true });
  const names = (copy.prepare('SELECT name FROM users').all() as { name: string }[]).map((u) => u.name);
  copy.close();
  assert.ok(names.includes('Dona'));

  for (let i = 0; i < 20; i++) writeFileSync(path.join(backupDir(), `office-2000010${i % 9 + 1}-0000${String(i).padStart(2, '0')}.db`), '');
  writeFileSync(stale, '');
  const alien = path.join(backupDir(), 'nao-e-backup.txt');
  writeFileSync(alien, 'fica');
  await new Promise((r) => setTimeout(r, 1100));
  runBackup();
  assert.equal(listBackups().length, 14);
  assert.ok(existsSync(alien), 'não apaga o que não é backup');
  assert.equal(listBackups()[0].size > 0, true);
});

test('backup: a segunda cópia substitui só o arquivo do dia e não apaga nada na pasta', async () => {
  const extra = mkdtempSync(path.join(tmpdir(), 'office-bkp-'));
  writeFileSync(path.join(extra, 'arquivo-da-pessoa.txt'), 'fica');
  assert.equal((await call('PATCH', O(), { token: owner, body: { backupDir: extra } })).status, 200);
  await new Promise((r) => setTimeout(r, 1100));
  const a = runBackup();
  await new Promise((r) => setTimeout(r, 1100));
  const b = runBackup();
  assert.equal(a.copies[0], b.copies[0]);
  assert.deepEqual(readdirSync(extra).sort(), [path.basename(b.copies[0]), 'arquivo-da-pessoa.txt'].sort());
  await call('PATCH', O(), { token: owner, body: { backupDir: null } });
  rmSync(extra, { recursive: true, force: true });
});
