import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client, Office } from '@office/shared';
import { addClientRef, addNicheRef, removeClientRef, removeNicheRef, trashRoot } from './references.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5f00000000049454e44ae426082', 'hex');

test('referências: adicionar e remover sem apagar, e o que sai fica fora das pastas que as skills leem', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'office-refs-'));
  const root = path.join(base, 'AGENCIA');
  const drive = path.join(base, 'DRIVE');
  mkdirSync(root);
  mkdirSync(drive);
  const office = { id: 'o', rootPath: root, driveRoot: drive, extraDirs: [] } as unknown as Office;
  const client = { id: 'c', name: 'Cliente Teste', folder: 'CLIENTES/CLIENTE TESTE' } as unknown as Client;
  mkdirSync(path.join(root, 'CLIENTES', 'CLIENTE TESTE', 'VIDEOS', 'REFERENCIAS'), { recursive: true });

  // biblioteca do nicho (sem o motor refs.py, entra o básico no indice.json)
  const n = await addNicheRef(office, 'saude-estetica', { data: PNG, name: 'clinica.png', origem: 'teste' });
  assert.ok(existsSync(n.file));
  const index = () => JSON.parse(readFileSync(path.join(root, 'REFERENCIAS', 'indice.json'), 'utf8')).refs as { id: string }[];
  assert.deepEqual(index().map((r) => r.id), [n.id]);
  await assert.rejects(addNicheRef(office, '../fora', { data: PNG, name: 'x.png' }), /Nicho inválido/);
  await assert.rejects(addNicheRef(office, 'saude-estetica', { data: PNG, name: 'x.exe' }), /PNG/);

  const r1 = removeNicheRef(office, 'saude-estetica', n.id, 'Dona');
  assert.equal(existsSync(n.file), false, 'saiu da pasta do nicho');
  assert.ok(r1.moved && existsSync(r1.moved), 'mas não foi apagada');
  assert.ok(r1.moved!.startsWith(trashRoot(office)), 'foi para a lixeira do Office');
  assert.ok(!r1.moved!.startsWith(path.join(root, 'REFERENCIAS')), 'fora de REFERENCIAS, onde as skills procuram');
  assert.deepEqual(index(), [], 'e saiu do indice.json');
  const log = JSON.parse(readFileSync(path.join(trashRoot(office), 'apagados.json'), 'utf8'));
  assert.equal(log[0].indice.id, n.id, 'o registro guarda a entrada para trazer de volta');

  // pasta do cliente: entra na pasta de referências que já existe
  const c1 = addClientRef(office, client, { data: PNG, name: 'ref.png' });
  assert.match(c1.file, /VIDEOS[\\/]REFERENCIAS[\\/]ref\.png$/);
  const c2 = addClientRef(office, client, { data: PNG, name: 'ref.png' });
  assert.match(c2.file, /ref \(2\)\.png$/, 'não sobrescreve');
  const r2 = removeClientRef(office, client, c1.file, 'Dona');
  assert.equal(existsSync(c1.file), false);
  assert.ok(existsSync(r2.moved) && !r2.moved.startsWith(path.join(root, 'CLIENTES')), 'fora da pasta do cliente');
  // não remove o que não é referência do cliente
  const other = path.join(root, 'CLIENTES', 'CLIENTE TESTE', 'VIDEOS', 'final.png');
  writeFileSync(other, PNG);
  assert.throws(() => removeClientRef(office, client, other, 'Dona'), /não é uma referência/);
  assert.throws(() => removeClientRef(office, client, path.join(base, 'qualquer.png'), 'Dona'), /não é da pasta/);
  rmSync(base, { recursive: true, force: true });
});
