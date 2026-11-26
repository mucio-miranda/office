import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitFiveHourLimit, retryAt } from './limit.ts';

test('limite de 5 h: reconhece a mensagem e calcula a volta', () => {
  assert.ok(hitFiveHourLimit("You've hit your 5-hour limit · resets 9:20pm (America/Sao_Paulo)"));
  assert.ok(!hitFiveHourLimit("You've hit your weekly limit"));
  const from = new Date(2026, 10, 25, 19, 0).getTime();
  // a renovação informada pelo Claude Code vale primeiro
  const known = new Date(2026, 10, 25, 20, 0).toISOString();
  assert.equal(retryAt('x', known, from), Date.parse(known) + 120_000);
  // sem ela, a hora da mensagem (hoje, ou amanhã se já passou)
  assert.equal(retryAt('resets 9:20pm', null, from), new Date(2026, 10, 25, 21, 22).getTime());
  assert.equal(retryAt('resets 1:40pm', null, from), new Date(2026, 10, 26, 13, 42).getTime());
  // renovação já passada não conta; sem nada, 1 h
  assert.equal(retryAt('nada', new Date(2026, 10, 25, 18, 0).toISOString(), from), from + 62 * 60_000);
});
