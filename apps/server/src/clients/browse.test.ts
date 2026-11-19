import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('apagar: arquivo e subpasta saem, pasta principal e caminho de fora não; fora do Drive vai para a lixeira do Office', async () => {
  const { deleteEntries } = await import('./browse.ts');
  const root = mkdtempSync(path.join(tmpdir(), 'office-apagar-'));
  const base = path.join(root, 'CLIENTE');
  mkdirSync(path.join(base, 'REDES SOCIAIS', '2026-11', 'velhas'), { recursive: true });
  writeFileSync(path.join(base, 'REDES SOCIAIS', '2026-11', 'post.png'), 'x');
  writeFileSync(path.join(base, 'REDES SOCIAIS', '2026-11', 'velhas', 'a.png'), 'x');
  const opts = (driveRoot: string | null) => ({ driveRoot, trashDir: path.join(root, 'lixeira'), logFile: path.join(root, 'apagados.jsonl'), by: 'Dona', client: 'Cliente' });
  const r = deleteEntries(base, ['REDES SOCIAIS/2026-11/post.png', 'REDES SOCIAIS', '../fora.txt', 'nao/existe.png'], opts(null));
  assert.deepEqual(r.deleted, ['REDES SOCIAIS/2026-11/post.png']);
  assert.equal(r.refused.length, 3);
  assert.equal(r.trash, 'office');
  assert.ok(!existsSync(path.join(base, 'REDES SOCIAIS', '2026-11', 'post.png')));
  assert.ok(existsSync(path.join(base, 'REDES SOCIAIS')));
  const day = new Date().toISOString().slice(0, 10);
  assert.ok(existsSync(path.join(root, 'lixeira', day, 'Cliente', 'REDES SOCIAIS', '2026-11', 'post.png')));
  // no Drive: apaga (o Google Drive guarda na lixeira dele)
  const d = deleteEntries(base, ['REDES SOCIAIS/2026-11/velhas'], opts(root));
  assert.equal(d.trash, 'drive');
  assert.ok(!existsSync(path.join(base, 'REDES SOCIAIS', '2026-11', 'velhas')));
  assert.equal(readFileSync(path.join(root, 'apagados.jsonl'), 'utf8').trim().split('\n').length, 2);
  rmSync(root, { recursive: true, force: true });
});
