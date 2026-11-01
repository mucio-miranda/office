import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALWAYS_DENIED, availableDirs, deniedTools, ruleRoot } from './permissions.ts';

test('caminho do Windows vira o formato das regras de permissão', { skip: process.platform !== 'win32' }, () => {
  assert.equal(ruleRoot('C:\\Users\\ana\\Agencia'), '//c/Users/ana/Agencia');
  assert.equal(ruleRoot('E:\\Pasta Com Espaco\\'), '//e/Pasta Com Espaco');
});

test('funcionário não altera skill, e os bloqueios de sempre continuam', { skip: process.platform !== 'win32' }, () => {
  const denied = deniedTools('C:\\Users\\ana\\Agencia');
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) assert.ok(denied.includes(`${tool}(//c/Users/ana/Agencia/.claude/skills/**)`), tool);
  for (const rule of ALWAYS_DENIED) assert.ok(denied.includes(rule), rule);
});

test('pasta extra que sumiu fica de fora e é avisada', () => {
  const r = availableDirs(['C:\\ok', 'E:\\hd-desconectado'], (p) => p === 'C:\\ok');
  assert.deepEqual(r, { ok: ['C:\\ok'], missing: ['E:\\hd-desconectado'] });
});
