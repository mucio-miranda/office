import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existingDriveFolders, linkedDriveFolder } from './drive.ts';

test('nunca escolhe DUPLICADOS, mesmo mais rasa que a pasta real', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'drive-'));
  mkdirSync(path.join(root, 'DUPLICADOS', "PIZZARIA EXEMPLO"), { recursive: true });
  mkdirSync(path.join(root, 'CLIENTES', 'COMIDA', "PIZZARIA EXEMPLO"), { recursive: true });
  assert.equal(existingDriveFolders(root)("PIZZARIA EXEMPLO"), "CLIENTES/COMIDA/PIZZARIA EXEMPLO");
});
test('segue o link da pasta local até o Drive, mesmo com outro nome', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'drive-'));
  const real = path.join(root, 'CLIENTES', 'SAUDE', 'CLINICA EXEMPLO');
  mkdirSync(real, { recursive: true });
  const local = mkdtempSync(path.join(tmpdir(), 'local-'));
  const link = path.join(local, 'APELIDO');
  try { symlinkSync(real, link, 'junction'); } catch { return; }
  assert.equal(linkedDriveFolder(root, link), 'CLIENTES/SAUDE/CLINICA EXEMPLO');
  assert.equal(linkedDriveFolder(root, local), null);
});
