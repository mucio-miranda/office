import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

const dataDir = mkdtempSync(path.join(tmpdir(), 'office-import-'));
process.env.OFFICE_DATA = dataDir;
const { api } = await import('./api.ts');
const { db } = await import('../db.ts');
const { baseCheck } = await import('../agents/outputs.ts');
const { indexClient } = await import('../clients/folder.ts');
const { prettyName } = await import('../clients/discover.ts');

let app: FastifyInstance;
let token: string, O: string;
const root = path.join(dataDir, 'raiz');
const hd = path.join(dataDir, 'hd');
const call = async (method: string, url: string, body?: unknown) => {
  const res = await app.inject({ method: method as 'GET', url, remoteAddress: '127.0.0.1', headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : {} };
};
const put = (rel: string, content = 'x') => {
  const f = path.join(root, 'CLIENTES', ...rel.split('/'));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, content);
};

before(async () => {
  put('FERNANDA MIRANDA/DOCUMENTOS/IDENTIDADE VISUAL/marca.json', '﻿{"nome": "Fernanda Miranda"}');
  put('BOLO DE MAE JP/FOTOS/a.jpg');
  put('STG/stg-studio/index.html');
  put('.oculta/x.txt');
  put('solto.txt');
  app = Fastify();
  await app.register(api);
  token = (await call('POST', '/api/auth/enter', { name: 'Dona', pin: 'senha-forte-1' })).json.token;
  O = `/api/offices/${(await call('POST', '/api/offices', { name: 'REZZU', rootPath: root })).json.id}`;
});
after(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('nome da pasta vira nome de gente', () => {
  assert.equal(prettyName('BOLO DE MAE JP'), 'Bolo de Mae JP');
  assert.equal(prettyName('DR. ANDERSON'), 'Dr. Anderson');
  assert.equal(prettyName("PIZZARIA BONA'S"), "Pizzaria Bona's");
  assert.equal(prettyName('KOMMUchat'), 'KOMMUchat');
});

test('lista só as pastas de cliente que faltam, com o nome da marca', async () => {
  const { json } = await call('GET', `${O}/clients/importar`);
  assert.deepEqual(json.found.map((f: any) => [f.dir, f.name, f.standard, f.marca]), [
    ['BOLO DE MAE JP', 'Bolo de Mae JP', true, false],
    ['FERNANDA MIRANDA', 'Fernanda Miranda', true, true],
    ['STG', 'STG', false, false],
  ]);
});

test('importa sem criar nada na pasta, não duplica e recusa o que não foi encontrado', async () => {
  const before = readdirSync(path.join(root, 'CLIENTES', 'STG'));
  const r = await call('POST', `${O}/clients/importar`, { items: [
    { dir: 'STG', name: 'STG Studio' },
    { dir: '../fora', name: 'Fora' },
    { dir: 'NAO EXISTE', name: 'Nada' },
  ], rascunho: false });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.created.map((c: any) => c.name), ['STG Studio']);
  assert.deepEqual(r.json.skipped, ['../fora', 'NAO EXISTE']);
  assert.deepEqual(readdirSync(path.join(root, 'CLIENTES', 'STG')), before, 'não cria a estrutura padrão');
  assert.ok(!existsSync(path.join(dataDir, 'fora')));
  const again = await call('POST', `${O}/clients/importar`, { items: [{ dir: 'STG', name: 'De novo' }], rascunho: false });
  assert.deepEqual(again.json.created, []);
  const list = await call('GET', `${O}/clients/importar`);
  assert.ok(!list.json.found.some((f: any) => f.dir === 'STG'));
});

test('bruto que mora no HD por junction aparece no índice e na conferência do processo', { skip: process.platform !== 'win32' }, () => {
  mkdirSync(hd, { recursive: true });
  writeFileSync(path.join(hd, 'take.mp4'), 'x');
  const cliente = path.join(root, 'CLIENTES', 'COM HD');
  mkdirSync(path.join(cliente, 'VIDEOS'), { recursive: true });
  symlinkSync(hd, path.join(cliente, 'VIDEOS', 'BRUTOS'), 'junction');
  const idx = indexClient(cliente);
  assert.equal(idx.groups.find((g) => g.key === 'brutos')?.count, 1);
  assert.deepEqual(baseCheck(cliente, [{ label: 'Brutos', test: '^VIDEOS/BRUTOS/' }]), [{ label: 'Brutos', ok: true }]);
  rmSync(path.join(cliente, 'VIDEOS', 'BRUTOS'));
  assert.ok(existsSync(path.join(hd, 'take.mp4')), 'tirar a junction não mexe no HD');
});
