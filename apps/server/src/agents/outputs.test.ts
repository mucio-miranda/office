import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Demand } from '@office/shared';
import { captionFrom, latestFiles, marksText, pathsInText, producedFiles } from './outputs.ts';

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
