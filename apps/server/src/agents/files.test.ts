import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { moveSafe, startCopy, waitCopy } from './files.ts';

const sandbox = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-files-'));
  mkdirSync(path.join(root, 'BRUTOS'));
  mkdirSync(path.join(root, 'ANIVERSARIO'));
  writeFileSync(path.join(root, 'ANIVERSARIO', 'v1.mp4'), 'video');
  return root;
};

test('mover: pasta para dentro de outra que existe, com o mesmo nome, e registra para desfazer', () => {
  const root = sandbox();
  const log = path.join(root, 'mov.log');
  const r = moveSafe(path.join(root, 'ANIVERSARIO'), path.join(root, 'BRUTOS'), [root], log, 'agent:x');
  assert.equal(r.para, path.join(root, 'BRUTOS', 'ANIVERSARIO'));
  assert.ok(existsSync(path.join(root, 'BRUTOS', 'ANIVERSARIO', 'v1.mp4')));
  assert.ok(!existsSync(path.join(root, 'ANIVERSARIO')));
  assert.match(readFileSync(log, 'utf8'), /ANIVERSARIO/);
  assert.match(r.desfazer, /mover de/);
});

test('mover: nunca sobrescreve, nem sai das pastas do escritório, nem entra em si mesma', () => {
  const root = sandbox();
  mkdirSync(path.join(root, 'BRUTOS', 'ANIVERSARIO'));
  assert.throws(() => moveSafe(path.join(root, 'ANIVERSARIO'), path.join(root, 'BRUTOS'), [root]), /Já existe/);
  const other = mkdtempSync(path.join(tmpdir(), 'office-fora-'));
  assert.throws(() => moveSafe(path.join(root, 'ANIVERSARIO'), path.join(other, 'X'), [root]), /pastas do escritório/);
  assert.throws(() => moveSafe(path.join(root, 'ANIVERSARIO'), path.join(root, 'ANIVERSARIO', 'sub'), [root]), /dentro dela mesma/);
  assert.throws(() => moveSafe('ANIVERSARIO', path.join(root, 'X'), [root]), /caminhos completos/);
  assert.ok(existsSync(path.join(root, 'ANIVERSARIO', 'v1.mp4')));
});

test('copiar para o disco: arquivo e pasta, sem mexer no original', { skip: process.platform !== 'win32' }, async () => {
  const root = sandbox();
  writeFileSync(path.join(root, 'BRUTOS', 'grande.MP4'), 'x'.repeat(5000));
  const dest = path.join(root, 'TMP');
  const c = startCopy('job1', [path.join(root, 'BRUTOS', 'grande.MP4'), path.join(root, 'ANIVERSARIO')], dest, [root]);
  const s = await waitCopy(c, 30_000);
  assert.equal(s.pronto, true, s.texto);
  assert.equal(readFileSync(path.join(dest, 'grande.MP4'), 'utf8').length, 5000);
  assert.ok(existsSync(path.join(dest, 'ANIVERSARIO', 'v1.mp4')));
  assert.ok(existsSync(path.join(root, 'BRUTOS', 'grande.MP4')));
});

test('copiar: recusa destino fora das pastas do escritório', () => {
  const root = sandbox();
  const other = mkdtempSync(path.join(tmpdir(), 'office-fora-'));
  assert.throws(() => startCopy('job1', [path.join(root, 'ANIVERSARIO')], other, [root]), /pastas do escritório/);
});
