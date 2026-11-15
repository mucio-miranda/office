import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { squadOfClient, squadsOf } from './squads.ts';

test('squads: lê o mapa da agência e liga o cliente pela pasta ou pelo nome', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'squads-'));
  assert.deepEqual(squadsOf(root), [], 'sem arquivo, sem squads');
  mkdirSync(path.join(root, '.claude', 'skills', '_global'), { recursive: true });
  writeFileSync(path.join(root, '.claude', 'skills', '_global', 'squads.json'), JSON.stringify({
    squads: [
      { id: 'a', nome: 'Ana & Bia', social_media: 'Ana', design_producao: 'Bia', clientes: [{ nome: 'Padaria', pasta: 'CLIENTES/COMIDA/PADARIA DO ZÉ' }] },
      { id: 'b', nome: 'Caio & Duda', clientes: [{ nome: 'Clínica Sol', pasta: null }] },
    ],
  }));
  const squads = squadsOf(root);
  assert.equal(squads.length, 2);
  assert.equal(squads[0].socialMedia, 'Ana');
  assert.equal(squadOfClient(squads, { name: 'Outro nome', folder: 'CLIENTES/PADARIA DO ZE' }), 'a', 'pasta sem acento casa');
  assert.equal(squadOfClient(squads, { name: 'clinica sol', folder: null }), 'b', 'pelo nome');
  assert.equal(squadOfClient(squads, { name: 'Ninguém', folder: 'X' }), null);
});
