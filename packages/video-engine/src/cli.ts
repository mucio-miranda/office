#!/usr/bin/env -S npx tsx
// Os funcionários de IA usam esta CLI: escrevem o JSON da timeline e mandam renderizar.
//   office-render timeline.json saida.mp4              render final
//   office-render previa timeline.json previa.mp4      prévia rápida (540p, ultrarrápida)
//   office-render legendas timeline.json               legendas automáticas (Whisper) gravadas no próprio JSON
//   office-render exportar timeline.json otio|fcp7|mlt|srt [saida]
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { render, exportTimeline } from './render.ts';
import { captionTimeline } from './transcribe.ts';
import { EXPORT_EXT, EXPORT_FORMATS, type ExportFormat } from './exporters.ts';
import { CAPTION_STYLES, parseTimeline } from './schema.ts';

const USO = `uso:
  office-render <timeline.json> <saida.mp4>
  office-render previa <timeline.json> <saida.mp4>
  office-render legendas <timeline.json> [--estilo ${CAPTION_STYLES.join('|')}]
  office-render exportar <timeline.json> <${EXPORT_FORMATS.join('|')}> [saida]`;

const args = process.argv.slice(2);
const cmd = ['previa', 'legendas', 'exportar'].includes(args[0]) ? args.shift()! : 'render';
const timelinePath = args[0];
if (!timelinePath) { console.error(USO); process.exit(2); }
const baseDir = path.dirname(path.resolve(timelinePath));
const json = JSON.parse(await readFile(timelinePath, 'utf8'));

/** Nunca sobrescreve: nome.ext, nome_v2.ext, ... */
const free = (file: string) => {
  const ext = path.extname(file);
  for (let v = 1; ; v++) {
    const f = v === 1 ? file : `${file.slice(0, -ext.length)}_v${v}${ext}`;
    if (!existsSync(f)) return f;
  }
};

if (cmd === 'legendas') {
  const i = args.indexOf('--estilo');
  const style = i >= 0 ? args[i + 1] : undefined;
  if (style && !(CAPTION_STYLES as readonly string[]).includes(style)) { console.error(USO); process.exit(2); }
  const items = await captionTimeline(parseTimeline(json), baseDir, { onProgress: (f) => process.stdout.write(`transcrição ${Math.round(f * 100)}%\n`) });
  json.captions = { ...(json.captions ?? {}), ...(style ? { style } : {}), items };
  await writeFile(timelinePath, JSON.stringify(json, null, 2), 'utf8');
  console.log(`pronto: ${items.length} legendas gravadas em ${timelinePath}`);
} else if (cmd === 'exportar') {
  const format = args[1] as ExportFormat;
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) { console.error(USO); process.exit(2); }
  const name = String(json.name ?? path.basename(timelinePath, '.json')).replace(/[^\w.-]+/g, '-');
  const out = args[2] ?? free(path.join(baseDir, name + EXPORT_EXT[format]));
  console.log(`pronto: ${await exportTimeline(json, format, out, { baseDir })}`);
} else {
  const out = args[1];
  if (!out) { console.error(USO); process.exit(2); }
  let lastPct = -1;
  const res = await render(json, out, {
    baseDir,
    preview: cmd === 'previa',
    onProgress: (f) => {
      const pct = Math.floor(f * 100);
      if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; process.stdout.write(`progresso ${pct}%\n`); }
    },
  });
  console.log(`pronto: ${res.outputs.join(', ')} (${res.duration.toFixed(2)}s)`);
}
