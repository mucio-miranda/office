import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitArgs, runGit } from './gitLocal.ts';

test('git local pelo Office: commit na pasta do repositório, sem push e sem config global', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-git-'));
  assert.throws(() => gitArgs({ pasta: dir, comando: 'add', args: ['.'] }), /init/);
  assert.equal((await runGit({ pasta: dir, comando: 'init' })).ok, true);
  assert.equal((await runGit({ pasta: dir, comando: 'config', args: ['user.name', 'Teste Office'] })).ok, true);
  assert.equal((await runGit({ pasta: dir, comando: 'config', args: ['user.email', 'teste@example.com'] })).ok, true);
  writeFileSync(path.join(dir, 'a.txt'), 'oi');
  assert.equal((await runGit({ pasta: dir, comando: 'add', args: ['.'] })).ok, true);
  const c = await runGit({ pasta: dir, comando: 'commit', args: ['-m', 'primeiro commit'] });
  assert.equal(c.ok, true, c.saida);
  assert.match((await runGit({ pasta: dir, comando: 'log', args: ['--format=%an %s'] })).saida, /Teste Office primeiro commit/);

  assert.throws(() => gitArgs({ pasta: dir, comando: 'push' }), /não liberado/);
  assert.throws(() => gitArgs({ pasta: dir, comando: 'config', args: ['core.sshCommand', 'x'] }), /user\.name/);
  assert.throws(() => gitArgs({ pasta: dir, comando: 'config', args: ['--global', 'user.name', 'x'] }), /global/);
  assert.throws(() => gitArgs({ pasta: dir, comando: 'branch', args: ['-D', 'main'] }), /Apagar/);
  assert.throws(() => gitArgs({ pasta: 'relativa', comando: 'status' }), /caminho completo/);
});
