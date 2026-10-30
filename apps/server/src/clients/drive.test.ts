import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { clientDriveFolder, driveDirs, driveSubdir, sendToDrive } from './drive.ts';

const base = mkdtempSync(path.join(tmpdir(), 'office-drive-'));
after(() => rmSync(base, { recursive: true, force: true }));

function setup(name: string) {
  const root = path.join(base, name, 'drive');
  const local = path.join(base, name, 'local');
  mkdirSync(root, { recursive: true });
  mkdirSync(local, { recursive: true });
  const file = path.join(local, 'arte.png');
  writeFileSync(file, 'versao 1');
  return { root, file };
}

test('copia criando as pastas e não duplica o que já está lá', async () => {
  const { root, file } = setup('a');
  const first = await sendToDrive(root, 'CLIENTES/PIZZARIA', [{ file, sub: 'DOCUMENTOS/ARTES' }]);
  assert.ok(typeof first !== 'string');
  assert.equal(first.sent.length, 1);
  const dest = path.join(root, 'CLIENTES', 'PIZZARIA', 'DOCUMENTOS', 'ARTES', 'arte.png');
  assert.equal(readFileSync(dest, 'utf8'), 'versao 1');
  const again = await sendToDrive(root, 'CLIENTES/PIZZARIA', [{ file, sub: 'DOCUMENTOS/ARTES' }]);
  assert.ok(typeof again !== 'string');
  assert.equal(again.sent.length, 0);
  assert.equal(again.skipped.length, 1);
});

test('nunca sobrescreve: um arquivo diferente com o mesmo nome sai como (2)', async () => {
  const { root, file } = setup('b');
  await sendToDrive(root, 'CLIENTE', [{ file, sub: '' }]);
  writeFileSync(file, 'versao 2 diferente');
  const res = await sendToDrive(root, 'CLIENTE', [{ file, sub: '' }]);
  assert.ok(typeof res !== 'string');
  assert.equal(readFileSync(path.join(root, 'CLIENTE', 'arte.png'), 'utf8'), 'versao 1');
  assert.equal(readFileSync(path.join(root, 'CLIENTE', 'arte (2).png'), 'utf8'), 'versao 2 diferente');
});

test('recusa caminhos fora da pasta do Drive e a própria raiz', async () => {
  const { root, file } = setup('c');
  assert.equal(typeof (await sendToDrive(root, '../fora', [{ file, sub: '' }])), 'string');
  assert.equal(typeof (await sendToDrive(root, '', [{ file, sub: '' }])), 'string');
  assert.equal(typeof (await sendToDrive(root, 'CLIENTE', [{ file, sub: '../../fora' }])), 'string');
  assert.equal(driveDirs(root, '../fora'), null);
  assert.ok(!existsSync(path.join(root, '..', 'fora')));
});

test('acha a pasta do cliente pelo nome, mesmo agrupada por nicho', () => {
  const { root } = setup('d');
  mkdirSync(path.join(root, 'CLIENTES', 'COMIDA', 'PIZZARIA DO JOÃO'), { recursive: true });
  assert.equal(clientDriveFolder(root, { name: 'Pizzaria do João', driveFolder: null }), 'CLIENTES/COMIDA/PIZZARIA DO JOÃO');
  assert.equal(clientDriveFolder(root, { name: 'Cliente Novo', driveFolder: null }), 'CLIENTES/CLIENTE NOVO');
  mkdirSync(path.join(root, 'OUTRA'), { recursive: true });
  assert.equal(clientDriveFolder(root, { name: 'Pizzaria do João', driveFolder: 'OUTRA' }), 'OUTRA');
});

test('a subpasta segue a pasta local e, fora do padrão, o tipo do arquivo', () => {
  const dir = path.join(base, 'cli');
  assert.equal(driveSubdir(dir, path.join(dir, 'DOCUMENTOS', 'ARTES', 'post-1', 'a.png')), 'DOCUMENTOS/ARTES/post-1');
  assert.equal(driveSubdir(dir, path.join(dir, 'DOCUMENTOS', 'IDENTIDADE VISUAL', 'IDV.md')), 'DOCUMENTOS/IDENTIDADE VISUAL');
  assert.equal(driveSubdir(dir, path.join(base, 'solto', 'filme.mp4')), 'VIDEOS/EDITADOS');
  assert.equal(driveSubdir(null, path.join(base, 'solto', 'nota.pdf')), 'DOCUMENTOS/PDFS');
});
