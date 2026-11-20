import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addPreviews, mediaPaths, previewFileOf, previewsOf } from './previews.ts';

test('prévia ao vivo: acha os caminhos de mídia no comando e na saída', () => {
  const cmd = 'ffmpeg -y -i "H:/Meu Drive/bruto 1.MOV" -vf scale=540:-2 C:/REZZU-TEMP/x/previa.mp4 && echo pronto: out/folha.jpg';
  const got = mediaPaths(cmd, 'C:/trab');
  assert.ok(got.includes('H:/Meu Drive/bruto 1.MOV'));
  assert.ok(got.includes('C:/REZZU-TEMP/x/previa.mp4'));
  assert.ok(got.includes(path.resolve('C:/trab', 'out/folha.jpg')));
  assert.equal(mediaPaths('python editar.py --estilo rezzu').length, 0);
});

test('prévia ao vivo: só entra o que existe e mudou nesta rodada; só serve o que entrou', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'previa-'));
  const novo = path.join(dir, 'previa.mp4');
  const velho = path.join(dir, 'bruto.mp4');
  writeFileSync(novo, 'x');
  writeFileSync(velho, 'x');
  const antes = Date.now() - 3600_000;
  utimesSync(velho, antes / 1000, antes / 1000);
  assert.equal(addPreviews('j1', [novo, velho, path.join(dir, 'nao-existe.mp4')], Date.now() - 60_000), 1);
  assert.equal(previewsOf('j1')[0].kind, 'video');
  assert.equal(addPreviews('j1', [novo], 0), 0, 'sem mudança não repete');
  assert.equal(previewFileOf('j1', novo), path.resolve(novo));
  assert.equal(previewFileOf('j1', velho), null);
  assert.equal(previewFileOf('j2', novo), null);
});

test('prévia ao vivo: acha a mídia nova na pasta que o script cita', async () => {
  const { mediaInDirs } = await import('./previews.ts');
  const dir = mkdtempSync(path.join(tmpdir(), 'saida-'));
  writeFileSync(path.join(dir, 'video - FINAL.mp4'), 'x');
  writeFileSync(path.join(dir, 'video.srt'), 'x');
  const velho = path.join(dir, 'antigo.mp4');
  writeFileSync(velho, 'x');
  const antes = (Date.now() - 3600_000) / 1000;
  utimesSync(velho, antes, antes);
  const got = mediaInDirs(`pronto: 40.00s em ${dir}`, undefined, Date.now() - 60_000);
  assert.deepEqual(got.map((f) => path.basename(f)), ['video - FINAL.mp4']);
});
