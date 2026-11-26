import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { driveIdFromLink, drivePathOf } from './driveId.ts';

/** Um banco igual ao do Drive para computador, com o Meu Drive montado numa pasta temporária. */
function fakeDrive() {
  const dir = mkdtempSync(path.join(tmpdir(), 'drivefs-'));
  const mount = path.join(dir, 'Meu Drive');
  mkdirSync(path.join(mount, 'REZZU', 'CLIENTES', 'SAUDE'), { recursive: true });
  const file = path.join(dir, 'metadata_sqlite_db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE items (stable_id INTEGER, id TEXT, local_title TEXT, is_folder INTEGER, trashed INTEGER, is_tombstone INTEGER); CREATE TABLE stable_parents (item_stable_id INTEGER, parent_stable_id INTEGER);');
  const add = db.prepare('INSERT INTO items VALUES (?, ?, ?, 1, 0, 0)');
  add.run(1, '0AC3STYDUqql4Uk9PVA', 'Meu Drive');
  add.run(2, '1gCnwwl1wSYUC4ImizJkk8YPOrC0_QR6L', 'REZZU');
  add.run(3, '1iHj1Xllq-yliBR_eCSSX6awgCl1KWpdz', 'CLIENTES');
  add.run(4, '1Q9NBP1doxhdL9KsHm7TZS5E6nFJX7kKA', 'SAUDE');
  add.run(5, '1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'COMPARTILHADA');
  const link = db.prepare('INSERT INTO stable_parents VALUES (?, ?)');
  link.run(2, 1); link.run(3, 2); link.run(4, 3);
  db.close();
  return { file, mount };
}

test('drive: link vira caminho no computador; fora do Meu Drive diz o motivo', () => {
  assert.equal(driveIdFromLink('https://drive.google.com/drive/folders/1Q9NBP1doxhdL9KsHm7TZS5E6nFJX7kKA?usp=sharing'), '1Q9NBP1doxhdL9KsHm7TZS5E6nFJX7kKA');
  assert.equal(driveIdFromLink('https://drive.google.com/file/d/1Q9NBP1doxhdL9KsHm7TZS5E6nFJX7kKA/view'), '1Q9NBP1doxhdL9KsHm7TZS5E6nFJX7kKA');
  assert.equal(driveIdFromLink('https://drive.google.com/open?id=1Q9NBP1doxhdL9KsHm7TZS5E6nFJX7kKA'), '1Q9NBP1doxhdL9KsHm7TZS5E6nFJX7kKA');
  assert.equal(driveIdFromLink('oi'), null);
  const { file, mount } = fakeDrive();
  const r = drivePathOf('https://drive.google.com/drive/folders/1Q9NBP1doxhdL9KsHm7TZS5E6nFJX7kKA', path.join(mount, 'REZZU'), [file]);
  assert.equal(r?.caminho, path.join(mount, 'REZZU', 'CLIENTES', 'SAUDE'));
  assert.equal(r?.pasta, true);
  const fora = drivePathOf('1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', path.join(mount, 'REZZU'), [file]);
  assert.equal(fora?.caminho, null);
  assert.match(fora!.motivo!, /fora do Meu Drive/);
  assert.match(drivePathOf('1yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', null, [file])!.motivo!, /não está no banco/);
});
