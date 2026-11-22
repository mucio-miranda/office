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


test('planta: sala nova muda de lugar e tamanho, sem passar por cima de outra nem ficar sem porta', async () => {
  const rooms = (await call('GET', `${O}/rooms`, owner)).json as any[];
  const { roomRect } = await import('@office/shared');
  const east = rooms.map((r) => ({ r, rect: roomRect(r) })).sort((a, b) => b.rect.x1 - a.rect.x1)[0];
  const bigger = { ...east.rect, x1: east.rect.x1 + 6 };
  assert.equal((await call('PATCH', `${O}/rooms/${east.r.id}`, owner, { rect: bigger })).status, 200, 'aumenta para o lado vazio');
  assert.deepEqual(roomRect((await call('GET', `${O}/rooms`, owner)).json.find((x: any) => x.id === east.r.id)), bigger);
  const over = { ...east.rect, x0: east.rect.x0 - 4 };
  const r1 = await call('PATCH', `${O}/rooms/${east.r.id}`, owner, { rect: over });
  assert.equal(r1.status, 400);
  assert.match(r1.json.error, /uma em cima da outra/);
  const far = { x0: 200, z0: -18, x1: 214, z1: -6 };
  const r2 = await call('PATCH', `${O}/rooms/${east.r.id}`, owner, { rect: far });
  assert.equal(r2.status, 400);
  assert.match(r2.json.error, /sem porta/);
  assert.equal((await call('PATCH', `${O}/rooms/${east.r.id}`, owner, { rect: { ...bigger, x1: bigger.x1 + 0.3 } })).status, 400, 'fora da grade');
  assert.equal((await call('PATCH', `${O}/rooms/${east.r.id}`, owner, { rect: { ...bigger, z0: -30 } })).status, 400, 'fora da faixa do prédio');
});

test('planta das salas originais: salva as sete, confere e volta à de sempre', async () => {
  const base = [
    { roomId: 'recepcao', name: 'Recepção', x0: -9, z0: -3, x1: 9, z1: 18 },
    { roomId: 'gerencia', name: 'Gerência', x0: -6, z0: -15, x1: 6, z1: -3 },
    { roomId: 'video', name: 'Vídeo', x0: 9, z0: -3, x1: 27, z1: 7.5 },
    { roomId: 'design', name: 'Design', x0: 9, z0: 7.5, x1: 27, z1: 18 },
    { roomId: 'copy', name: 'Redação', x0: -27, z0: -18, x1: -9, z1: -3 },
    { roomId: 'reuniao', name: 'Reunião', x0: -27, z0: -3, x1: -9, z1: 18 },
    { roomId: 'copa', name: 'Copa', x0: 9, z0: -18, x1: 27, z1: -3 },
  ];
  assert.equal((await call('PUT', `${O}/baseRooms`, member, { rooms: base })).status, 403, 'só o dono');
  assert.equal((await call('PUT', `${O}/baseRooms`, owner, { rooms: base })).status, 200);
  assert.equal((await call('GET', `${O}/baseRooms`, member)).json.length, 7);
  const over = base.map((r) => (r.roomId === 'gerencia' ? { ...r, x0: -12 } : r));
  const r1 = await call('PUT', `${O}/baseRooms`, owner, { rooms: over });
  assert.equal(r1.status, 400);
  assert.match(r1.json.error, /uma em cima da outra/);
  const fora = base.map((r) => (r.roomId === 'copa' ? { ...r, x1: 30 } : r));
  assert.match((await call('PUT', `${O}/baseRooms`, owner, { rooms: fora })).json.error, /cresceria por cima/, 'crescer para a direita esbarra nas salas novas');
  const fundo = base.map((r) => (r.roomId === 'copa' ? { ...r, z0: -20 } : r));
  assert.equal((await call('PUT', `${O}/baseRooms`, owner, { rooms: fundo })).status, 200, 'cresce para o fundo');
  const longe = base.map((r) => (r.roomId === 'copa' ? { ...r, z0: -60 } : r));
  assert.match((await call('PUT', `${O}/baseRooms`, owner, { rooms: longe })).json.error, /limite do terreno/);
  const frente = base.map((r) => (r.roomId === 'design' ? { ...r, z1: 24 } : r));
  assert.equal((await call('PUT', `${O}/baseRooms`, owner, { rooms: frente })).status, 200, 'cresce para a frente');
  assert.equal((await call('PUT', `${O}/baseRooms`, owner, { rooms: base.slice(1) })).status, 400, 'as sete juntas');
  assert.equal((await call('PUT', `${O}/baseRooms`, owner, { rooms: [] })).status, 200, 'volta à planta original');
  assert.equal((await call('GET', `${O}/baseRooms`, owner)).json.length, 0);
});

test('decoração: peças em salas novas do leste (x até ~50) e cor "multi" salvam, e o que vem junto não se perde', async () => {
  const item = (id: string, over: object = {}) => ({ id, kind: 'mesa-pessoa', x: 10, z: 10, rot: 1, ...over });
  const items = [
    item('a', { x: 48.5, z: -19 }),                       // Sala de Múcio / Hall, além de x = 40
    item('b', { kind: 'armarios', color: 'multi' }),      // o catálogo oferece "colorido"
    item('c', { color: '#aabbcc' }),
    item('mesa:video-1', { as: 'mesa-l' }),               // mesa fixa trocada por uma do catálogo
  ];
  assert.equal((await call('PUT', `${O}/layout`, owner, { items })).status, 200);
  const back = (await call('GET', `${O}/layout`, owner)).json as any[];
  assert.equal(back.length, 4);
  assert.equal(back.find((i) => i.id === 'a').x, 48.5);
  assert.equal(back.find((i) => i.id === 'mesa:video-1').as, 'mesa-l');
  // continua recusando lixo de verdade
  assert.equal((await call('PUT', `${O}/layout`, owner, { items: [item('x', { rot: 7 })] })).status, 400);
  assert.equal((await call('PUT', `${O}/layout`, owner, { items: [item('x', { x: 900 })] })).status, 400);
});
