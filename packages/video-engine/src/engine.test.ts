import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTimeline, layout, compile, atempoChain, assTime, assColor, render, probe, FFMPEG, segmentWords, groupCaptions, cuts, buildExport } from './index.ts';

const base = {
  width: 360,
  height: 640,
  fps: 30,
  video: [
    { id: 'a', src: 'a.mp4', in: 0, out: 3 },
    { id: 'b', src: 'b.mp4', in: 1, out: 4, transition: { type: 'flash', duration: 0.5 } },
    { id: 'c', src: 'c.mp4', in: 0, out: 2, speed: 2, transition: { type: 'corte', duration: 0.1 } },
  ],
};

test('layout desconta a sobreposição das transições', () => {
  const t = parseTimeline(base);
  const { starts, duration } = layout(t);
  assert.deepEqual(starts, [0, 2.5, 5.5]);
  assert.equal(duration, 6.5);
});

test('atempo encadeia fora de 0.5..2', () => {
  assert.deepEqual(atempoChain(1), []);
  assert.deepEqual(atempoChain(4), ['atempo=2', 'atempo=2']);
  assert.deepEqual(atempoChain(0.25), ['atempo=0.5', 'atempo=0.5']);
});

test('compile gera xfade com o nome certo e concat no corte', () => {
  const t = parseTimeline(base);
  const probes = Object.fromEntries(['a.mp4', 'b.mp4', 'c.mp4'].map((s) => [s, { duration: 10, hasAudio: false, hasVideo: true }]));
  const { args, duration } = compile(t, probes, 'out.mp4');
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.match(fc, /xfade=transition=fadewhite:duration=0.5:offset=2.5/);
  assert.match(fc, /concat=n=2:v=1:a=0/);
  assert.match(fc, /anullsrc/);
  assert.equal(duration, 6.5);
});

test('helpers de ASS', () => {
  assert.equal(assTime(61.234), '0:01:01.23');
  assert.equal(assColor('#FFD400'), '&H0000D4FF');
});

const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;

test('render de verdade com ffmpeg (clipes sintéticos)', { skip: !hasFfmpeg && 'ffmpeg não encontrado' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-test-'));
  const mk = (name: string, src: string) =>
    spawnSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `${src}=size=640x360:rate=30:duration=3`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', path.join(dir, name)]);
  mk('a.mp4', 'testsrc2');
  mk('b.mp4', 'smptebars');
  const out = path.join(dir, 'saida.mp4');
  const res = await render(
    {
      width: 360, height: 640, fps: 30,
      video: [
        { id: 'a', src: 'a.mp4', in: 0, out: 2, keepAudio: true, zoom: { from: 1, to: 1.15 } },
        { id: 'b', src: 'b.mp4', in: 0, out: 2, transition: { type: 'whip-esquerda', duration: 0.4 }, color: { saturation: 1.2 } },
      ],
      captions: { style: 'karaoke', items: [{ start: 0.2, end: 1.8, text: 'Olá escritório virtual' }] },
      output: { preset: 'ultrafast', voiceOnly: true },
    },
    out,
    { baseDir: dir },
  );
  assert.ok(existsSync(out));
  assert.equal(res.outputs.length, 2);
  const info = await probe(out);
  assert.ok(Math.abs(info.duration - 3.6) < 0.15, `duração ${info.duration}`);
  assert.equal(info.width, 360);
});

test('legendas: tokens do whisper com VAD voltam para o tempo do segmento', () => {
  const words = segmentWords({
    text: ' O segredo está no forno.',
    offsets: { from: 1570, to: 3070 },
    tokens: [
      { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
      { text: ' O', offsets: { from: 30, to: 90 } },
      { text: ' seg', offsets: { from: 90, to: 340 } },
      { text: 'redo', offsets: { from: 340, to: 630 } },
      { text: ' est\uFFFD', offsets: { from: 720, to: 1090 } },
      { text: ' no', offsets: { from: 1090, to: 1260 } },
      { text: ' forno', offsets: { from: 1260, to: 1500 } },
      { text: '.', offsets: { from: 1500, to: 1530 } },
    ],
  });
  assert.deepEqual(words.map((w) => w.text), ['O', 'segredo', 'está', 'no', 'forno.']);
  assert.ok(Math.abs(words[0].start - 1.57) < 0.001);
  assert.ok(Math.abs(words[4].end - 3.07) < 0.001);
});

test('legendas: agrupa em pausa, pontuação e tamanho', () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end });
  const caps = groupCaptions([
    w('Oi,', 0, 0.3), w('pessoal,', 0.3, 0.8), w('hoje', 0.9, 1.1), w('eu', 1.1, 1.2), w('vou', 1.2, 1.4),
    w('mostrar', 1.4, 1.8), w('tudo.', 1.8, 2.2), w('Depois', 3.5, 3.9),
  ]);
  assert.deepEqual(caps.map((c) => c.text), ['Oi, pessoal,', 'hoje eu vou mostrar', 'tudo.', 'Depois']);
  assert.ok(caps.every((c, i) => !caps[i + 1] || c.end <= caps[i + 1].start));
});

test('exportações: cortes no meio da transição e formatos válidos', () => {
  const t = parseTimeline({
    width: 1080, height: 1920, fps: 30,
    video: [
      { id: 'a', src: 'C:/v/a.mp4', in: 0, out: 4, keepAudio: true },
      { id: 'b', src: 'C:/v/b.mp4', in: 1, out: 4, speed: 1.5, transition: { type: 'fade', duration: 0.6 } },
    ],
    audio: [{ id: 'm', src: 'C:/v/trilha.mp3', start: 0, volume: 0.3 }],
    captions: { items: [{ start: 0, end: 1.2, text: 'olá' }] },
  });
  const probes = { 'C:/v/a.mp4': { duration: 10, hasAudio: true, hasVideo: true }, 'C:/v/b.mp4': { duration: 10, hasAudio: true, hasVideo: true }, 'C:/v/trilha.mp3': { duration: 60, hasAudio: true, hasVideo: false } };
  const cs = cuts(t);
  assert.equal(cs[0].end, cs[1].start);
  assert.ok(Math.abs(cs[0].end - 3.7) < 1e-9);
  assert.ok(Math.abs(cs[1].srcIn - 1.45) < 1e-9);
  const otio = JSON.parse(buildExport('otio', t, probes));
  const v1 = otio.tracks.children[0].children;
  assert.equal(v1[1].OTIO_SCHEMA, 'Transition.1');
  const total = v1.filter((c: any) => c.source_range).reduce((n: number, c: any) => n + c.source_range.duration.value, 0);
  assert.equal(total, Math.round(layout(t).duration * 30));
  const xml = buildExport('fcp7', t, probes);
  assert.match(xml, /<xmeml version="5">/);
  assert.match(xml, /<transitionitem><start>102<\/start><end>120<\/end>/);
  assert.match(xml, /file:\/\/localhost\/C:\/v\/a\.mp4/);
  assert.match(buildExport('mlt', t, probes), /mlt_service">timewarp/);
  assert.equal(buildExport('srt', t, probes), '1\n00:00:00,000 --> 00:00:01,200\nolá\n');
});
