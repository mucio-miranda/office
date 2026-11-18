import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

const dataDir = mkdtempSync(path.join(tmpdir(), 'office-anexos-'));
process.env.OFFICE_DATA = dataDir;
const { api } = await import('./api.ts');
const { db } = await import('../db.ts');
const { attachmentName } = await import('../agents/attachments.ts');

let app: FastifyInstance;
let owner: string, member: string, O: string;
const call = async (method: string, url: string, token?: string, body?: unknown, type?: string) => {
  const res = await app.inject({
    method: method as 'GET', url, remoteAddress: '127.0.0.1',
    headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(type ? { 'content-type': type } : {}) },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {} };
};

before(async () => {
  app = Fastify();
  await app.register(api);
  owner = (await call('POST', '/api/auth/enter', undefined, { name: 'Dona', pin: 'senha-forte-1' })).json.token;
  const o = (await call('POST', '/api/offices', owner, { name: 'REZZU', rootPath: dataDir })).json;
  O = `/api/offices/${o.id}`;
  member = (await call('POST', '/api/auth/enter', undefined, { name: 'Colega', pin: 'senha-forte-1', invite: o.inviteCode })).json.token;
});
after(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('anexo: print colado ganha nome com a hora e nome perigoso é limpo', () => {
  const when = new Date(2026, 10, 18, 14, 3, 9);
  assert.equal(attachmentName('image.png', when), 'print 140309.png');
  assert.equal(attachmentName('..\\..\\a:b?.txt', when), 'a_b_.txt');
  assert.equal(attachmentName('', when), 'print 140309.png');
});

test('anexo: arquivo sobe para a pasta de anexos sem sobrescrever', async () => {
  const a = await call('POST', `${O}/anexos?nome=${encodeURIComponent('foto cliente.jpg')}`, member, Buffer.from('abc'), 'application/octet-stream');
  const b = await call('POST', `${O}/anexos?nome=${encodeURIComponent('foto cliente.jpg')}`, member, Buffer.from('xyz'), 'application/octet-stream');
  assert.equal(a.status, 200);
  assert.ok(a.json.path.startsWith(path.join(dataDir, 'anexos')));
  assert.notEqual(a.json.path, b.json.path);
  assert.equal(readFileSync(a.json.path, 'utf8'), 'abc');
  assert.equal(readFileSync(b.json.path, 'utf8'), 'xyz');
  assert.equal((await call('POST', `${O}/anexos?nome=x.txt`, undefined, Buffer.from('a'), 'application/octet-stream')).status, 401);
});

test('anexo: caminho deste PC só vale como texto para o dono e se existir', async () => {
  const f = path.join(dataDir, 'bruto.mp4');
  writeFileSync(f, 'v');
  const paths = [f, path.join(dataDir, 'nao-existe.mp4'), 'relativo.mp4'];
  assert.deepEqual((await call('POST', `${O}/anexos/caminhos`, owner, { paths })).json.local, [f]);
  assert.deepEqual((await call('POST', `${O}/anexos/caminhos`, member, { paths })).json.local, []);
});
