import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client, ContentPost, Office } from '@office/shared';
import { deliverPost, finalName, finalsOf, loteDir } from './deliver.ts';
import { driveFileId } from './driveId.ts';

const post = (over: Partial<ContentPost> = {}): ContentPost => ({
  id: 'p1', officeId: 'o', clientId: 'c', demandId: null, date: '2026-12-02', format: 'carrossel', theme: 'Prisão preventiva x temporária?',
  caption: '', notes: '', number: 1, status: 'aprovado', tunning: 'feito', files: [], workDir: null, finals: [], deliveries: [], updatedAt: '', updatedBy: null, ...over,
});

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'drv-'));
  const cli = path.join(root, 'CLIENTES', 'ADVOCACIA', 'MARIA EXEMPLO');
  mkdirSync(path.join(cli, 'REDES SOCIAIS'), { recursive: true });
  const idv = path.join(cli, 'ARQUIVOS – MARIA EXEMPLO', 'DOCUMENTOS', 'IDENTIDADE VISUAL');
  mkdirSync(idv, { recursive: true });
  writeFileSync(path.join(idv, 'marca.json'), '{"nome":"Maria Exemplo"}');
  const work = path.join(cli, 'ARQUIVOS – MARIA EXEMPLO', 'TRABALHOS', '2026-11-15 artes dezembro', 'saida', '01-1 prisao');
  mkdirSync(path.join(work, 'FINAL'), { recursive: true });
  writeFileSync(path.join(work, 'FINAL', 'slide-02.png'), 'dois');
  writeFileSync(path.join(work, 'FINAL', 'slide-01.png'), 'um');
  writeFileSync(path.join(work, 'FINAL', 'slide-10.png'), 'dez');
  const office = { id: 'o', rootPath: mkdtempSync(path.join(tmpdir(), 'raiz-')), extraDirs: [], driveRoot: root } as unknown as Office;
  const client = { id: 'c', name: 'Maria Exemplo', folder: null, driveFolder: 'CLIENTES/ADVOCACIA/MARIA EXEMPLO' } as unknown as Client;
  return { root, cli, work, office, client };
}

test('nome final: data, formato, tema sem caracteres proibidos e NN só com mais de um arquivo', () => {
  assert.equal(finalName(post(), 0, 5, '.PNG'), '2026-12-02 Carrossel – Prisão preventiva x temporária – 01.png');
  assert.equal(finalName(post({ format: 'estatico', theme: 'A/B: teste.' }), 0, 1, '.jpg'), '2026-12-02 Estático – A B teste.jpg');
});

test('finais: os da pasta FINAL em ordem numérica; lote é a pasta logo abaixo de TRABALHOS', () => {
  const { work } = setup();
  assert.deepEqual(finalsOf(post({ workDir: work })).map((f) => path.basename(f)), ['slide-01.png', 'slide-02.png', 'slide-10.png']);
  assert.equal(path.basename(loteDir(work)!), '2026-11-15 artes dezembro');
  assert.equal(loteDir(path.join(tmpdir(), 'sem', 'trabalho')), null);
});

test('entrega na pasta do mês da POSTAGEM, confere o hash e reentrega guarda a versão anterior em _versoes', async () => {
  const { cli, work, office, client } = setup();
  const p = post({ workDir: work });
  const r = await deliverPost(office, client, p, 'user:u');
  if (typeof r === 'string') return assert.fail(r);
  const mes = path.join(cli, 'REDES SOCIAIS', '2026-12 Dezembro – Maria Exemplo');
  assert.equal(r.dir, mes);
  assert.deepEqual(readdirSync(mes).sort(), [1, 2, 3].map((n) => `2026-12-02 Carrossel – Prisão preventiva x temporária – 0${n}.png`));
  assert.equal(r.delivered[0].version, 1);

  // mesmo conteúdo: não copia de novo
  const again = await deliverPost(office, client, { ...p, deliveries: r.delivered }, 'user:u');
  if (typeof again === 'string') return assert.fail(again);
  assert.equal(again.delivered.length, 0);
  assert.equal(again.same.length, 3);

  // correção na lâmina 2
  writeFileSync(path.join(work, 'FINAL', 'slide-02.png'), 'dois corrigido');
  const fix = await deliverPost(office, client, { ...p, deliveries: r.delivered }, 'user:u');
  if (typeof fix === 'string') return assert.fail(fix);
  assert.equal(fix.delivered.length, 1);
  assert.equal(fix.delivered[0].version, 2);
  assert.equal(readFileSync(path.join(mes, '2026-12-02 Carrossel – Prisão preventiva x temporária – 02.png'), 'utf8'), 'dois corrigido');
  assert.ok(fix.delivered[0].previous!.includes(path.join('2026-11-15 artes dezembro', '_versoes')));
  assert.equal(readFileSync(fix.delivered[0].previous!, 'utf8'), 'dois');
});

test('recusa arquivo fora da pasta do cliente e peça sem finais', async () => {
  const { office, client } = setup();
  const fora = path.join(mkdtempSync(path.join(tmpdir(), 'fora-')), 'x.png');
  writeFileSync(fora, 'x');
  assert.match(String(await deliverPost(office, client, post({ finals: [fora] }), 'u')), /fora da pasta/);
  assert.match(String(await deliverPost(office, client, post(), 'u')), /não tem arquivos finais/);
});

test('link do Drive: confere as pastas acima e espera o upload terminar (código local-)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dfs-'));
  const file = path.join(dir, 'metadata_sqlite_db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE items (stable_id INTEGER, id TEXT, local_title TEXT, is_folder INTEGER, trashed INTEGER, is_tombstone INTEGER);
    CREATE TABLE stable_parents (item_stable_id INTEGER, parent_stable_id INTEGER, local_title_hash TEXT);
    INSERT INTO items VALUES (1, 'pastaMesAAAAAAAAAAAAAAAAAAA', '2026-12 Dezembro', 1, 0, 0), (2, 'redesAAAAAAAAAAAAAAAAAAAAAA', 'REDES SOCIAIS', 1, 0, 0),
      (3, '1AbCdEfGhIjKlMnOpQrStUvWxYz', 'arte.png', 0, 0, 0), (4, 'outraPastaAAAAAAAAAAAAAAAAA', 'OUTRA', 1, 0, 0),
      (5, '1ZzzzzzzzzzzzzzzzzzzzzzzzzZ', 'arte.png', 0, 0, 0), (6, 'local-30135', 'nova.png', 0, 0, 0);
    INSERT INTO stable_parents VALUES (1, 2, ''), (3, 1, ''), (5, 4, ''), (6, 1, '');`);
  db.close();
  assert.equal(driveFileId('H:/Meu Drive/REDES SOCIAIS/2026-12 Dezembro/arte.png', [file]), '1AbCdEfGhIjKlMnOpQrStUvWxYz');
  assert.equal(driveFileId('H:/Meu Drive/REDES SOCIAIS/2026-12 Dezembro/nova.png', [file]), null);
  assert.equal(driveFileId('H:/Meu Drive/X/sumiu.png', [file]), null);
});
