import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFolder } from './browse.ts';

test('pastas do cliente: subpastas primeiro, meses do mais novo ao mais antigo, sem arquivo de sistema e sem sair da pasta', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'browse-'));
  const redes = path.join(base, 'REDES SOCIAIS');
  for (const d of ['2026-10 Outubro – Cliente', '2026-12 Dezembro – Cliente', '2026-11 Novembro – Cliente', 'IDENTIDADE VISUAL']) mkdirSync(path.join(redes, d), { recursive: true });
  writeFileSync(path.join(redes, '2026-11 Novembro – Cliente', '01 post.png'), 'x');
  writeFileSync(path.join(redes, 'desktop.ini'), 'x');
  writeFileSync(path.join(redes, 'legendas.pdf'), 'x');

  const r = listFolder(base, 'REDES SOCIAIS')!;
  assert.deepEqual(r.entries.map((e) => e.name), ['2026-12 Dezembro – Cliente', '2026-11 Novembro – Cliente', '2026-10 Outubro – Cliente', 'IDENTIDADE VISUAL', 'legendas.pdf']);
  assert.equal(r.entries.find((e) => e.name.startsWith('2026-11'))!.items, 1);
  assert.deepEqual(r.crumbs, [{ name: 'REDES SOCIAIS', rel: 'REDES SOCIAIS' }]);
  assert.equal(r.entries.at(-1)!.kind, 'doc');
  assert.equal(listFolder(base, '../..'), null);
  assert.equal(listFolder(base, 'C:/Windows'), null);
});
