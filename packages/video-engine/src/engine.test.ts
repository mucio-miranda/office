import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTimeline, layout, compile, atempoChain, assTime, assColor, render, probe, FFMPEG } from './index.ts';

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
