import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { captionTimeline, EXPORT_EXT, exportTimeline, parseTimeline, render, type ExportFormat } from '@office/video-engine';
import { config } from '../config.ts';
import { one, update, now, logActivity } from '../db.ts';
import { broadcast, invalidate } from '../realtime.ts';

interface TimelineRow {
  id: string;
  officeId: string;
  name: string;
  json: unknown;
  baseDir: string;
  output: string | null;
  renderStatus: string | null;
}

const rendering = new Set<string>();

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'video';

/** Nunca sobrescreve: nome_v1.mp4, nome_v2.mp4, ... */
function nextVersion(dir: string, base: string, ext = '.mp4') {
  for (let v = 1; ; v++) {
    const file = path.join(dir, `${base}_v${v}${ext}`);
    if (!existsSync(file)) return file;
  }
}

const getRow = (officeId: string, id: string) => {
  const t = one<TimelineRow>('SELECT * FROM timelines WHERE id = ? AND office_id = ?', id, officeId);
  if (!t) throw new Error('Timeline não encontrada');
  return t;
};

/** Prévia rápida: fica na pasta de dados do Office (não suja a pasta do cliente) e é sempre substituída. */
export const previewFile = (id: string) => path.join(config.dataDir, 'previews', `${id}.mp4`);

export function previewTimeline(officeId: string, id: string) {
  const t = getRow(officeId, id);
  const key = `previa:${id}`;
  if (rendering.has(key)) throw new Error('A prévia desta timeline já está sendo gerada.');
  const output = previewFile(id);
  mkdirSync(path.dirname(output), { recursive: true });
  rendering.add(key);
  broadcast(officeId, { t: 'render', timelineId: id, progress: 0, status: 'rodando', preview: true });
  let last = 0;
  // grava ao lado e troca no fim: quem pede a prévia nunca recebe um arquivo pela metade
  const partial = output.replace(/\.mp4$/, '.gerando.mp4');
  render(t.json, partial, {
    baseDir: t.baseDir,
    preview: true,
    onProgress: (p) => {
      if (p - last >= 0.05 || p === 1) { last = p; broadcast(officeId, { t: 'render', timelineId: id, progress: p, status: 'rodando', preview: true }); }
    },
  })
    .then(() => {
      renameSync(partial, output);
      broadcast(officeId, { t: 'render', timelineId: id, progress: 1, status: 'concluido', output, preview: true });
    })
    .catch((e: Error) => broadcast(officeId, { t: 'render', timelineId: id, progress: 0, status: 'erro', error: e.message, preview: true }))
    .finally(() => rendering.delete(key));
  return { output };
}

/** Legendas automáticas (Whisper) gravadas na timeline; o estilo que já estava escolhido continua. */
export async function captionRow(officeId: string, id: string) {
  const t = getRow(officeId, id);
  const key = `legendas:${id}`;
  if (rendering.has(key)) throw new Error('As legendas desta timeline já estão sendo geradas.');
  rendering.add(key);
  try {
    const items = await captionTimeline(parseTimeline(t.json), t.baseDir);
    const json = { ...(t.json as Record<string, any>) };
    json.captions = { ...(json.captions ?? {}), items };
    update('timelines', id, { json, updatedAt: now() });
    logActivity(officeId, 'engine', 'gerou legendas', `${t.name}: ${items.length} legendas`);
    invalidate(officeId, 'timelines');
    return { items };
  } finally {
    rendering.delete(key);
  }
}

/** Exporta para OTIO, XML do Premiere, Shotcut ou SRT, ao lado dos renders, sem sobrescrever. */
export async function exportRow(officeId: string, id: string, format: ExportFormat) {
  const t = getRow(officeId, id);
  const out = await exportTimeline(t.json, format, nextVersion(t.baseDir, slug(t.name), EXPORT_EXT[format]), { baseDir: t.baseDir });
  logActivity(officeId, 'engine', 'exportou', out);
  return { output: out };
}

export function renderTimeline(officeId: string, id: string) {
  const t = one<TimelineRow>('SELECT * FROM timelines WHERE id = ? AND office_id = ?', id, officeId);
  if (!t) throw new Error('Timeline não encontrada');
  if (rendering.has(id)) throw new Error('Esta timeline já está renderizando.');
  const output = nextVersion(t.baseDir, slug(t.name));
  rendering.add(id);
  update('timelines', id, { renderStatus: 'rodando', updatedAt: now() });
  broadcast(officeId, { t: 'render', timelineId: id, progress: 0, status: 'rodando' });

  let last = 0;
  render(t.json, output, {
    baseDir: t.baseDir,
    onProgress: (p) => {
      if (p - last >= 0.02 || p === 1) {
        last = p;
        broadcast(officeId, { t: 'render', timelineId: id, progress: p, status: 'rodando' });
      }
    },
  })
    .then((res) => {
      // a timeline vai junto do vídeo: é o "projeto" que permite reabrir e ajustar
      writeFileSync(output.replace(/\.mp4$/, '.timeline.json'), JSON.stringify(t.json, null, 2), 'utf8');
      update('timelines', id, { renderStatus: 'concluido', output: res.outputs[0], updatedAt: now() });
      logActivity(officeId, 'engine', 'renderizou', res.outputs.join(', '));
      broadcast(officeId, { t: 'render', timelineId: id, progress: 1, status: 'concluido', output: res.outputs[0] });
    })
    .catch((e: Error) => {
      update('timelines', id, { renderStatus: 'erro', updatedAt: now() });
      broadcast(officeId, { t: 'render', timelineId: id, progress: 0, status: 'erro', error: e.message });
    })
    .finally(() => {
      rendering.delete(id);
      invalidate(officeId, 'timelines');
    });

  return { output };
}
