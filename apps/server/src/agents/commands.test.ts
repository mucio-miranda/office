import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALWAYS_DENIED } from './permissions.ts';
import { buildCommand, commandLine } from './commands.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'office-cmd-'));
mkdirSync(path.join(repo, '.git'));
const plain = mkdtempSync(path.join(os.tmpdir(), 'office-cmd-'));

test('pedido de comando: só git push e gh repo create, montados pelo Office e sem shell', () => {
  const push = buildCommand({ acao: 'git_push', pasta: repo });
  assert.deepEqual([push.bin, ...push.args], ['git', 'push', '-u', 'origin', 'main']);
  const gh = buildCommand({ acao: 'gh_repo_create', pasta: repo, nome: 'mucio-miranda/site-falconi', visibilidade: 'privado' });
  assert.deepEqual(gh.args.slice(0, 4), ['repo', 'create', 'mucio-miranda/site-falconi', '--private']);
  assert.match(commandLine(gh), /^gh repo create mucio-miranda\/site-falconi --private --source /);

  assert.throws(() => buildCommand({ acao: 'rm', pasta: repo }), /acao/);
  assert.throws(() => buildCommand({ acao: 'git_push', pasta: plain }), /git init/);
  assert.throws(() => buildCommand({ acao: 'git_push', pasta: 'relativa' }), /caminho completo/);
  assert.throws(() => buildCommand({ acao: 'git_push', pasta: repo, branch: '--force' }), /branch/);
  assert.throws(() => buildCommand({ acao: 'git_push', pasta: repo, remoto: 'origin; del' }), /remoto/);
  assert.throws(() => buildCommand({ acao: 'gh_repo_create', pasta: repo, nome: 'x/y' }), /visibilidade/);
  assert.throws(() => buildCommand({ acao: 'gh_repo_create', pasta: repo, nome: '../y', visibilidade: 'publico' }), /dono\/repositorio/);
});

test('o funcionário continua sem git push direto', () => {
  assert.ok(ALWAYS_DENIED.includes('Bash(git push:*)'));
});
