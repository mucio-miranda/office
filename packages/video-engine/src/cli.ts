#!/usr/bin/env -S npx tsx
// Uso: office-render timeline.json saida.mp4
// Os funcionários de IA usam esta CLI: escrevem o JSON da timeline e mandam renderizar.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render } from './render.ts';

const [, , timelinePath, out] = process.argv;
if (!timelinePath || !out) {
  console.error('uso: office-render <timeline.json> <saida.mp4>');
  process.exit(2);
}
const json = JSON.parse(await readFile(timelinePath, 'utf8'));
let lastPct = -1;
const res = await render(json, out, {
  baseDir: path.dirname(path.resolve(timelinePath)),
  onProgress: (f) => {
    const pct = Math.floor(f * 100);
    if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; process.stdout.write(`progresso ${pct}%\n`); }
  },
});
console.log(`pronto: ${res.outputs.join(', ')} (${res.duration.toFixed(2)}s)`);
