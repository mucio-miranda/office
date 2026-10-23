import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@office/video-engine';
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
function nextVersion(dir: string, base: string) {
  for (let v = 1; ; v++) {
    const file = path.join(dir, `${base}_v${v}.mp4`);
    if (!existsSync(file)) return file;
  }
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
