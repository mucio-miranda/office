import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Office } from '@office/shared';
import { discoverClients } from './discover.ts';

test('importar não repete cliente cuja pasta já está cadastrada por outro caminho (atalho para o Drive)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'disc-'));
  const drive = path.join(root, 'drive');
  const real = path.join(drive, 'CLIENTES', 'SAUDE', 'DRA EXEMPLO');
  const other = path.join(drive, 'CLIENTES', 'COMIDA', 'PADARIA');
  const novo = path.join(drive, 'CLIENTES', 'OUTROS', 'NOVO');
  for (const d of [real, other, novo]) mkdirSync(path.join(d, 'DOCUMENTOS'), { recursive: true });
  const office = { rootPath: path.join(root, 'raiz'), driveRoot: drive } as unknown as Office;
  mkdirSync(path.join(office.rootPath, 'CLIENTES'), { recursive: true });
  // CLIENTES\<nome> no escritório são atalhos para as pastas do Drive
  symlinkSync(real, path.join(office.rootPath, 'CLIENTES', 'EXEMPLO'), 'junction');
  symlinkSync(other, path.join(office.rootPath, 'CLIENTES', 'PADARIA LINK'), 'junction');
  symlinkSync(novo, path.join(office.rootPath, 'CLIENTES', 'NOVO'), 'junction');
  // sobra antiga no C:, pasta de verdade com o mesmo nome da pasta do cliente no Drive
  mkdirSync(path.join(office.rootPath, 'CLIENTES', 'Padaria', 'DOCUMENTOS'), { recursive: true });

  const found = discoverClients(office, [
    { folder: real, driveFolder: null }, // cadastrado com o caminho do Drive
    { folder: null, driveFolder: 'CLIENTES/COMIDA/PADARIA' }, // cadastrado só pela pasta no Drive
  ]);
  assert.deepEqual(found.map((f) => f.dir), ['NOVO']);
});
