import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Demand } from '@office/shared';
import { baseCheck, captionFrom, changedFiles, latestFiles, marksText, newerFiles, pathsInText, processFiles, producedFiles } from './outputs.ts';

const demand = (patch: Partial<Demand> = {}) => ({ title: 'Post de Lançamento', kind: 'design', stageLog: [], ...patch }) as unknown as Demand;

test('acha caminhos do Windows no resumo, com e sem crases', () => {
  const text = 'Arte pronta em `C:\\Clientes\\ACME\\DOCUMENTOS\\ARTES\\post 1\\capa.png` e o PSD em C:\\Clientes\\ACME\\capa.psd.';
  assert.deepEqual(pathsInText(text).sort(), ['C:\\Clientes\\ACME\\DOCUMENTOS\\ARTES\\post 1\\capa.png', 'C:\\Clientes\\ACME\\capa.psd'].sort());
});

test('legenda sai da seção "Legenda" da copy', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-'));
  const f = path.join(dir, 'copy.md');
  writeFileSync(f, '# Copy\n\n## Textos da arte\nTítulo\n\n## Legenda\nCompre já! #promo\n\n## Notas\nnada');
  assert.equal(captionFrom(f), 'Compre já! #promo');
  writeFileSync(f, 'Só um texto');
  assert.equal(captionFrom(f), 'Só um texto');
  assert.equal(captionFrom(undefined), '');
});

test('áreas marcadas viram instruções em porcentagem', () => {
  const t = marksText([{ file: 'C:\\a.png', x: 0.1, y: 0.2, w: 0.3, h: 0.25, note: 'Logo maior' }]);
  assert.match(t, /de 10% a 40% da largura e de 20% a 45% da altura\. Logo maior/);
  assert.equal(marksText([]), '');
});

test('arquivos produzidos: citados no resumo e os que mudaram na pasta da etapa', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-'));
  const arte = path.join(root, 'DOCUMENTOS', 'ARTES', 'post-de-lancamento');
  mkdirSync(arte, { recursive: true });
  const velho = path.join(arte, 'antigo.png');
  writeFileSync(velho, 'x');
  const passado = new Date(Date.now() - 3600_000);
  utimesSync(velho, passado, passado);
  const novo = path.join(arte, 'capa-v2.png');
  writeFileSync(novo, 'x');
  const citado = path.join(root, 'extra.psd');
  writeFileSync(citado, 'x');
  const fora = path.join(tmpdir(), 'fora-do-escritorio.png');
  const files = producedFiles({
    finalText: `Feito: ${citado} e ${fora}`, since: new Date(Date.now() - 60_000).toISOString(), stage: 'arte', d: demand(), clientDir: root,
    inside: (p) => p.startsWith(root),
  });
  assert.deepEqual(files, [novo, citado].sort());
});

test('peças finais: a última versão da arte vence a copy', () => {
  const d = demand({
    stageLog: [
      { stage: 'copy', by: 'a', jobId: null, text: '', result: 'feito', at: '', files: ['copy.md'] },
      { stage: 'arte', by: 'a', jobId: null, text: '', result: 'feito', at: '', files: ['v1.png'], version: 1 },
      { stage: 'arte', by: 'a', jobId: null, text: '', result: 'feito', at: '', files: ['v2.png'], version: 2 },
    ],
  });
  assert.deepEqual(latestFiles(d).final, ['v2.png']);
  assert.deepEqual(latestFiles(d).byStage.copy, ['copy.md']);
});

test('a mesa vê o que mudou nas pastas reais e deixa de fora intermediários e originais', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-mudou-'));
  const put = (rel: string, age = 0) => {
    const f = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, 'x');
    const t = new Date(Date.now() - age);
    utimesSync(f, t, t);
    return f;
  };
  const arte = put('DOCUMENTOS/ARTES/FEED NOVEMBRO/01 - Tema/01-tunning.png');
  const prancha = put('DOCUMENTOS/ARTES/FEED NOVEMBRO/01 - Tema/_PRANCHA-ref-composicao-tunning.jpg');
  const cmp = put('DOCUMENTOS/ARTES/FEED NOVEMBRO/01 - Tema/_trabalho/comparacao.jpg');
  put('DOCUMENTOS/ARTES/FEED NOVEMBRO/01 - Tema/_trabalho/para-tunning.jpg');
  put('DOCUMENTOS/ARTES/FEED NOVEMBRO/01 - Tema/VERSAO ANTERIOR (ombro)/01-tunning.png');
  put('VIDEOS/BRUTOS/IMG_1.MOV');
  put('DOCUMENTOS/ARTES/FEED NOVEMBRO/01 - Tema/script.py');
  put('DOCUMENTOS/ARTES/antiga.png', 3_600_000);
  const since = Date.now() - 60_000;
  assert.deepEqual(changedFiles(dir, since).sort(), [arte, prancha, cmp].sort());
  rmSync(dir, { recursive: true, force: true });
});

test('peças de uma rodada: junta a pasta do cliente e o que foi citado em outra pasta liberada', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-rodada-'));
  const cli = path.join(dir, 'cliente');
  const hd = path.join(dir, 'hd', 'trabalho');
  mkdirSync(cli, { recursive: true });
  mkdirSync(hd, { recursive: true });
  const local = path.join(cli, 'arte.png');
  const fora = path.join(hd, 'reel.mp4');
  writeFileSync(local, 'x');
  writeFileSync(fora, 'x');
  const proibido = path.join(dir, 'senhas.txt');
  writeFileSync(proibido, 'x');
  const files = processFiles({ finalText: `Pronto: \`${fora}\` e \`${proibido}\``, since: new Date(Date.now() - 60_000).toISOString(), clientDir: cli, inside: (p) => p.startsWith(cli) || p.startsWith(hd) });
  assert.deepEqual(files.sort(), [local, fora].sort());
  rmSync(dir, { recursive: true, force: true });
});

test('edição à mão: aparece o que mudou na pasta da peça depois da entrega', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-manual-'));
  const arte = path.join(dir, 'arte.png');
  const ajustada = path.join(dir, 'arte-ajustada.png');
  writeFileSync(arte, 'x');
  const at = new Date(Date.now() - 600_000);
  utimesSync(arte, at, at);
  const d = { stageLog: [{ stage: 'arte', by: 'agent:a', jobId: 'j', text: '', result: 'feito', files: [arte], at: at.toISOString() }] } as unknown as Demand;
  assert.deepEqual(newerFiles(d), []);
  writeFileSync(ajustada, 'y');
  assert.deepEqual(newerFiles(d), [ajustada]);
  rmSync(dir, { recursive: true, force: true });
});

test('base do cliente: aponta o que falta para o processo', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-base-'));
  mkdirSync(path.join(dir, 'VIDEOS', 'BRUTOS'), { recursive: true });
  writeFileSync(path.join(dir, 'VIDEOS', 'BRUTOS', 'a.mov'), 'x');
  const r = baseCheck(dir, [{ label: 'Padrão', test: 'PADRAO-EDICAO' }, { label: 'Brutos', test: '(^|/)BRUTOS/' }]);
  assert.deepEqual(r, [{ label: 'Padrão', ok: false }, { label: 'Brutos', ok: true }]);
  rmSync(dir, { recursive: true, force: true });
});

