import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactThrash, THRASH } from './runtime.ts';

test('resumo em loop: 3 resumos em 10 minutos param o trabalho; espaçados, não', () => {
  const m = 60_000;
  let r = compactThrash([], 0);
  assert.equal(r.thrash, false);
  r = compactThrash(r.times, 2 * m);
  assert.equal(r.thrash, false);
  r = compactThrash(r.times, 4 * m);
  assert.equal(r.thrash, true);
  // espaçados: o antigo sai da janela
  const s = compactThrash([0, 6 * m], 12 * m);
  assert.equal(s.thrash, false);
  assert.deepEqual(s.times, [6 * m, 12 * m]);
  assert.equal(THRASH.count, 3);
});
