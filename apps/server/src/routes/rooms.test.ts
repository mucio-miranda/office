import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

const dataDir = mkdtempSync(path.join(tmpdir(), 'office-salas-'));
process.env.OFFICE_DATA = dataDir;
const { api } = await import('./api.ts');
const { db } = await import('../db.ts');

let app: FastifyInstance;
let owner: string, member: string, memberId: string, O: string;
const call = async (method: string, url: string, token?: string, body?: unknown) => {
  const res = await app.inject({ method: method as 'GET', url, remoteAddress: '127.0.0.1', headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {} };
};

before(async () => {
  app = Fastify();
  await app.register(api);
  owner = (await call('POST', '/api/auth/enter', undefined, { name: 'Dona', pin: 'senha-forte-1' })).json.token;
  const o = (await call('POST', '/api/offices', owner, { name: 'REZZU', rootPath: dataDir })).json;
  O = `/api/offices/${o.id}`;
  const m = (await call('POST', '/api/auth/enter', undefined, { name: 'Colega', pin: 'senha-forte-1', invite: o.inviteCode })).json;
  member = m.token;
  memberId = m.user.id;
});
after(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('salas: só o dono cria, os lugares são reaproveitados e há limite', async () => {
  assert.equal((await call('POST', `${O}/rooms`, member, { name: 'Podcast' })).status, 403);
  const a = (await call('POST', `${O}/rooms`, owner, { name: 'Podcast', emoji: '🎙️', floor: '#334455' })).json;
  const b = (await call('POST', `${O}/rooms`, owner, { name: 'Fotografia' })).json;
  assert.deepEqual([a.slot, b.slot], [0, 1]);
  assert.equal((await call('GET', `${O}/rooms`, member)).json.length, 2);
  assert.equal((await call('DELETE', `${O}/rooms/${a.id}`, owner)).status, 200);
  assert.equal((await call('POST', `${O}/rooms`, owner, { name: 'Estúdio' })).json.slot, 0);
  for (let i = 2; i < 12; i++) assert.equal((await call('POST', `${O}/rooms`, owner, { name: `Sala ${i}` })).status, 200);
  assert.equal((await call('POST', `${O}/rooms`, owner, { name: 'Demais' })).status, 409);
  assert.equal((await call('PATCH', `${O}/rooms/${b.id}`, owner, { name: 'Foto' })).status, 200);
  assert.equal((await call('POST', `${O}/rooms`, owner, { name: 'x', floor: 'vermelho' })).status, 400);
});

test('funcionário novo herda o modelo, senta na sala certa e pode sair; os originais não', async () => {
  const room = (await call('GET', `${O}/rooms`, owner)).json[0];
  assert.equal((await call('POST', `${O}/agents`, member, { base: 'designer', name: 'Lia', room: room.id })).status, 403);
  assert.equal((await call('POST', `${O}/agents`, owner, { base: 'nao-existe', name: 'Lia', room: room.id })).status, 400);
  assert.equal((await call('POST', `${O}/agents`, owner, { base: 'designer', name: 'Lia', room: 'marte' })).status, 400);
  const lia = (await call('POST', `${O}/agents`, owner, { base: 'designer', name: 'Lia', role: 'Designer júnior', room: room.id, seat: { x: 33, z: -12 }, color: '#112233', look: { hairStyle: 'black', glasses: true } })).json;
  assert.equal(lia.base, 'designer');
  assert.ok(lia.allowedTools.includes('mcp__claude-in-chrome'));
  assert.ok(lia.skills.includes('arte-referencia'));
  assert.ok(lia.persona.includes('Lia') && !lia.persona.includes('Duda'));
  const listed = (await call('GET', `${O}/agents`, member)).json.find((a: any) => a.id === lia.id);
  assert.deepEqual(listed.seat, { x: 33, z: -12 });
  assert.equal(listed.look.hairStyle, 'black');
  assert.equal((await call('DELETE', `${O}/rooms/${room.id}`, owner)).status, 409);
  const duda = (await call('GET', `${O}/agents`, owner)).json.find((a: any) => a.slug === 'designer');
  assert.equal((await call('DELETE', `${O}/agents/${duda.id}`, owner)).status, 409);
  assert.equal((await call('DELETE', `${O}/agents/${lia.id}`, member)).status, 403);
  assert.equal((await call('DELETE', `${O}/agents/${lia.id}`, owner)).status, 200);
  assert.equal((await call('DELETE', `${O}/rooms/${room.id}`, owner)).status, 200);
});

test('todo funcionário muda de nome e aparência, com validação', async () => {
  const duda = (await call('GET', `${O}/agents`, owner)).json.find((a: any) => a.slug === 'designer');
  assert.equal((await call('PATCH', `${O}/agents/${duda.id}`, member, { name: 'Bia' })).status, 403);
  assert.equal((await call('PATCH', `${O}/agents/${duda.id}`, owner, { name: 'Bia', color: '#abcdef', look: { outfit: 'jaleco', beard: false } })).status, 200);
  const bia = (await call('GET', `${O}/agents`, owner)).json.find((a: any) => a.id === duda.id);
  assert.equal(bia.name, 'Bia');
  assert.equal(bia.look.outfit, 'jaleco');
  assert.equal((await call('PATCH', `${O}/agents/${duda.id}`, owner, { look: { outfit: 'armadura' } })).status, 400);
  assert.equal((await call('PATCH', `${O}/agents/${duda.id}`, owner, { room: 'marte' })).status, 400);
});

test('cada pessoa muda o próprio avatar; o nome novo vale para entrar e não repete', async () => {
  const r = await call('PATCH', '/api/me', member, { name: 'Colega Nova', color: '#123456', look: { hairStyle: 'careca', beard: true } });
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'Colega Nova');
  const me = (await call('GET', '/api/me', member)).json.user;
  assert.equal(me.look.hairStyle, 'careca');
  assert.equal((await call('POST', '/api/auth/enter', undefined, { name: 'Colega Nova', pin: 'senha-forte-1' })).status, 200);
  assert.equal((await call('PATCH', '/api/me', member, { name: 'dona' })).status, 409);
  assert.equal((await call('PATCH', '/api/me', member, { color: 'azul' })).status, 400);
  const list = (await call('GET', `${O}/members`, owner)).json;
  assert.equal(list.find((m: any) => m.id === memberId).look.beard, true);
});

test('o dono muda o avatar de quem é do escritório; membro não muda o dos outros', async () => {
  assert.equal((await call('PATCH', `${O}/members/${memberId}`, owner, { color: '#654321' })).status, 200);
  const dona = (await call('GET', '/api/me', owner)).json.user;
  assert.equal((await call('PATCH', `${O}/members/${dona.id}`, member, { name: 'Invadiu' })).status, 403);
  assert.equal((await call('PATCH', `${O}/members/inexistente`, owner, { color: '#654321' })).status, 404);
});

test('paredes: o tipo de cada trecho fica salvo, com validação', async () => {
  assert.deepEqual((await call('GET', `${O}/walls`, member)).json, {});
  assert.equal((await call('PUT', `${O}/walls`, member, { '-18:-3': 'vidro', '9:2.5': 'removida' })).status, 200);
  assert.deepEqual((await call('GET', `${O}/walls`, owner)).json, { '-18:-3': 'vidro', '9:2.5': 'removida' });
  assert.equal((await call('PUT', `${O}/walls`, owner, { 'h:-1.5:6': 'vidro', 'v:2:-9': 'removida' })).status, 200, 'pedaços de parede');
  assert.equal((await call('PUT', `${O}/walls`, owner, { '-18:-3': 'papelao' })).status, 400);
  assert.equal((await call('PUT', `${O}/walls`, owner, { 'x; drop': 'vidro' })).status, 400);
});

