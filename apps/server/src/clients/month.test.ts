import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// month.ts usa o banco: aponta a pasta de dados para um lugar descartável antes de importar
process.env.OFFICE_DATA = mkdtempSync(path.join(tmpdir(), 'office-mes-db-'));
const { groupPieces, monthFiles, parseName, renamePlan, runRenames, squadName } = await import('./month.ts');

test('lê os nomes do padrão do squad, da entrega da Mesa e da pasta de vídeos', () => {
  assert.deepEqual(parseName('06 2026-11-16 Carrossel – Clareamento mitos e verdades – 02.png'),
    { number: 6, posted: false, date: '2026-11-16', format: 'carrossel', theme: 'Clareamento mitos e verdades', slide: 2 });
  assert.deepEqual(parseName('01_postado 2026-11-02 Carrossel – Sorriso Gengival – 05.png'),
    { number: 1, posted: true, date: '2026-11-02', format: 'carrossel', theme: 'Sorriso Gengival', slide: 5 });
  assert.equal(parseName('08 Estático – Por que um dentista faz harmonizacao.png')?.date, null);
  assert.equal(parseName('99 sem data Carrossel – Como funciona a consulta – 01.png')?.theme, 'Como funciona a consulta');
  assert.deepEqual(parseName('2026-12-02 Carrossel – Prisão preventiva – 03.png'),
    { number: null, posted: false, date: '2026-12-02', format: 'carrossel', theme: 'Prisão preventiva', slide: 3 });
  assert.deepEqual(parseName('Reels – postado 2026-11-12 – VIDEO 03 - Familiar preso – capa.jpg'),
    { number: null, posted: true, date: '2026-11-12', format: 'reels', theme: 'VIDEO 03 - Familiar preso', slide: 0 });
  assert.equal(parseName('10 v2.png'), null);
  assert.equal(parseName('IMG_7151.png'), null);
});

test('agrupa as lâminas em peças, marca as postadas e liga ao post do calendário', () => {
  const d = 'X:/mes';
  const files = [
    `${d}/06 2026-11-16 Carrossel – Mitos – 01.png`, `${d}/06 2026-11-16 Carrossel – Mitos – 02.png`,
    `${d}/POSTADOS/01_postado 2026-11-02 Estático – Gengiva.png`,
    `${d}/4- Como funciona a consulta – 1.png`, `${d}/4- Como funciona a consulta – 2.png`,
    `${d}/VÍDEOS – Novembro/Reels – VIDEO 01 - Juri.mp4`, `${d}/VÍDEOS – Novembro/Reels – VIDEO 01 - Juri – capa.jpg`,
  ];
  const posts = [{ id: 'p9', files: [`${d}/4- Como funciona a consulta – 2.png`], date: '2026-11-27', format: 'carrossel' as const, theme: 'Consulta', number: null, status: 'drive' as const }];
  const pieces = groupPieces(files, posts);
  assert.equal(pieces.length, 4);
  const mitos = pieces.find((p) => p.theme === 'Mitos')!;
  assert.equal(mitos.files.length, 2);
  assert.equal(pieces[0].posted, true, 'postadas vêm primeiro');
  const solta = pieces.find((p) => p.loose)!;
  assert.equal(solta.postId, 'p9');
  assert.equal(solta.date, '2026-11-27', 'a data vem do post ligado');
  // peça com data no nome arrastada para outro dia: vale a data do calendário
  const movida = groupPieces([`${d}/06 2026-11-16 Carrossel – Mitos – 01.png`], [{ id: 'p2', files: [`${d}/06 2026-11-16 Carrossel – Mitos – 01.png`], date: '2026-11-18', format: 'carrossel', theme: 'Mitos', number: 6, status: 'drive' }]);
  assert.equal(movida[0].date, '2026-11-18');
  const reels = pieces.find((p) => p.format === 'reels')!;
  assert.match(reels.files[0], /\.mp4$/, 'o vídeo vem antes da capa');
});

test('o plano numera pela data, mantém as postadas e não troca vídeos', () => {
  const d = 'X:/mes';
  const pieces = groupPieces([
    `${d}/POSTADOS/01_postado 2026-11-02 Estático – Gengiva.png`,
    `${d}/09 2026-11-25 Estático – Por tras.png`,
    `${d}/07 2026-11-18 Carrossel – Limpeza – 01.png`, `${d}/07 2026-11-18 Carrossel – Limpeza – 02.png`,
    `${d}/VÍDEOS – Novembro/Reels – VIDEO 01 - Juri.mp4`,
  ]);
  pieces.find((p) => p.format === 'reels')!.date = '2026-11-20';
  const { plan, skipped } = renamePlan(pieces);
  const names = plan.map((r) => path.basename(r.to));
  // números existentes ficam; nada a trocar nessas três
  assert.deepEqual(names, []);
  assert.equal(skipped.length, 1);
  // sem número e sem data no nome: ganha a data do post e o próximo número livre; postada sem _postado ganha o sufixo
  const more = groupPieces([`${d}/09 Estático – Por tras.png`, `${d}/consulta-1.png`, `${d}/consulta-2.png`, `${d}/POSTADOS/04 2026-11-03 Estático – Gengiva.png`],
    [{ id: 'p1', files: [`${d}/consulta-1.png`], date: '2026-11-27', format: 'carrossel', theme: 'Consulta', number: null, status: 'drive' }]);
  more.find((p) => p.theme === 'Por tras')!.date = '2026-11-25';
  assert.deepEqual(renamePlan(more).plan.map((r) => path.basename(r.to)), [
    '04_postado 2026-11-03 Estático – Gengiva.png', '09 2026-11-25 Estático – Por tras.png',
    '10 2026-11-27 Carrossel – consulta – 01.png', '10 2026-11-27 Carrossel – consulta – 02.png',
  ]);
  assert.equal(squadName({ number: 4, date: '2026-11-30', format: 'estatico', theme: 'A/B: teste?' }, 0, 1, '.PNG', true), '04_postado 2026-11-30 Estático – A B teste.png');
});

test('renomeia em duas fases (troca em cadeia) sem perder arquivo', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-mes-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'a.png'), 'A');
  writeFileSync(path.join(dir, 'b.png'), 'B');
  runRenames([{ from: path.join(dir, 'a.png'), to: path.join(dir, 'b.png') }, { from: path.join(dir, 'b.png'), to: path.join(dir, 'c.png') }]);
  assert.deepEqual(readdirSync(dir).sort(), ['b.png', 'c.png']);
  assert.throws(() => runRenames([{ from: path.join(dir, 'b.png'), to: path.join(dir, 'x.png') }, { from: path.join(dir, 'sumiu.png'), to: path.join(dir, 'y.png') }]));
  assert.ok(existsSync(path.join(dir, 'b.png')), 'falha no meio: o que já tinha mudado volta');
});

test('a pasta do mês: raiz, POSTADOS e vídeos; reservas, descartadas e mosaico ficam de fora', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-mes-'));
  for (const sub of ['POSTADOS', 'RESERVAS', 'DESCARTADAS', 'VÍDEOS – Novembro/POSTADOS', 'ENSAIOS – Novembro']) mkdirSync(path.join(dir, sub), { recursive: true });
  for (const f of ['01 2026-11-03 Estático – A.png', '00 Mosaico – Novembro.jpg', 'LEGENDAS – Novembro.pdf', 'POSTADOS/x.png', 'RESERVAS/r.png', 'DESCARTADAS/d.png',
    'VÍDEOS – Novembro/Reels – V.mp4', 'VÍDEOS – Novembro/POSTADOS/Reels – postado 2026-11-12 – W.mp4', 'ENSAIOS – Novembro/f.jpg']) writeFileSync(path.join(dir, f), '.');
  const got = monthFiles(dir).map((f) => path.relative(dir, f).replaceAll('\\', '/')).sort();
  assert.deepEqual(got, ['01 2026-11-03 Estático – A.png', 'POSTADOS/x.png', 'VÍDEOS – Novembro/POSTADOS/Reels – postado 2026-11-12 – W.mp4', 'VÍDEOS – Novembro/Reels – V.mp4']);
});
