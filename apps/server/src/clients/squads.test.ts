import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setClientSquad, squadOfClient, squadsOf } from './squads.ts';

test('squad do cliente: troca no squads.json, guarda as anotações e tira de onde estava', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'squads-'));
  const drive = path.join(root, 'drive');
  const dir = path.join(drive, 'CLIENTES', 'COMIDA', 'BOLO DE MÃE JP');
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(root, '.claude', 'skills', '_global'), { recursive: true });
  const file = path.join(root, '.claude', 'skills', '_global', 'squads.json');
  writeFileSync(file, JSON.stringify({ versao: 1, squads: [
    { id: 'a', nome: 'A', clientes: [{ nome: 'Bolo de Mãe', pasta: 'CLIENTES/COMIDA/BOLO DE MÃE JP', obs: 'nota' }] },
    { id: 'b', nome: 'B', clientes: [] },
  ] }, null, 2));
  const office = { rootPath: root, driveRoot: drive };
  const c = { name: 'Bolo de Mãe', folder: dir, dir };
  assert.equal(squadOfClient(squadsOf(root), c), 'a');
  setClientSquad(office, c, 'b');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(raw.squads[0].clientes, []);
  assert.deepEqual(raw.squads[1].clientes, [{ nome: 'Bolo de Mãe', pasta: 'CLIENTES/COMIDA/BOLO DE MÃE JP', obs: 'nota' }]);
  assert.equal(raw.versao, 1, 'o resto do arquivo fica');
  assert.equal(squadOfClient(squadsOf(root), c), 'b');
  setClientSquad(office, c, null);
  assert.equal(squadOfClient(squadsOf(root), c), null);
  const novo = { name: 'Cliente Novo', folder: path.join(drive, 'CLIENTES', 'OUTROS', 'NOVO'), dir: path.join(drive, 'CLIENTES', 'OUTROS', 'NOVO') };
  mkdirSync(novo.dir, { recursive: true });
  setClientSquad(office, novo, 'a');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).squads[0].clientes[0].pasta, 'CLIENTES/OUTROS/NOVO');
  assert.throws(() => setClientSquad(office, novo, 'zzz'), /Squad não encontrado/);
});
