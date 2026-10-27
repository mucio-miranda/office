import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { effectiveTransition, layout, type Caption, type Timeline } from './schema.ts';
import type { ProbeInfo } from './compile.ts';

/**
 * Exporta a timeline para editores abertos e comerciais, para o ajuste fino fora do Office:
 *  - otio: OpenTimelineIO (Academy Software Foundation), abre no Kdenlive e no DaVinci Resolve
 *  - fcp7: XML do Final Cut Pro 7 (xmeml), abre no Premiere e no DaVinci Resolve
 *  - mlt: projeto do Shotcut (MLT XML)
 *  - srt: legendas, para o CapCut e qualquer editor
 * Vão os cortes, a velocidade, as transições (como dissolve), as trilhas e as imagens. Zoom, cor e o
 * estilo das legendas ficam só no render do Office.
 */

export const EXPORT_FORMATS = ['otio', 'fcp7', 'mlt', 'srt'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_EXT: Record<ExportFormat, string> = { otio: '.otio', fcp7: '.xml', mlt: '.mlt', srt: '.srt' };
export const EXPORT_LABEL: Record<ExportFormat, string> = {
  otio: 'OpenTimelineIO (Kdenlive, DaVinci)',
  fcp7: 'XML (Premiere, DaVinci)',
  mlt: 'Shotcut (MLT)',
  srt: 'Legendas SRT (CapCut)',
};

/** Um corte na faixa principal, já com metade de cada transição descontada (o encontro fica no meio). */
interface Cut {
  i: number;
  src: string;
  /** Trecho do arquivo usado, em segundos. */
  srcIn: number;
  srcOut: number;
  /** Posição na timeline, em segundos. */
  start: number;
  end: number;
  speed: number;
  reverse: boolean;
  keepAudio: boolean;
  volume: number;
  /** Transição de entrada (duração total, centrada no corte). */
  trans: number;
}

export function cuts(t: Timeline): Cut[] {
  const { starts, duration } = layout(t);
  // o ponto de corte é um número só: o fim de um clipe é exatamente o início do seguinte
  const cutAt = t.video.map((_, i) => starts[i] + effectiveTransition(t, i) / 2);
  return t.video.map((c, i) => {
    const dIn = effectiveTransition(t, i);
    const dOut = i + 1 < t.video.length ? effectiveTransition(t, i + 1) : 0;
    return {
      i, src: c.src, speed: c.speed, reverse: c.reverse, keepAudio: c.keepAudio, volume: c.volume, trans: dIn,
      srcIn: c.in + (dIn / 2) * c.speed, srcOut: c.out - (dOut / 2) * c.speed,
      start: cutAt[i], end: i + 1 < t.video.length ? cutAt[i + 1] : duration,
    };
  });
}

/** Imagens dentro da duração do vídeo (uma que passa do fim é cortada no fim). */
const overlays = (t: Timeline) => {
  const { duration } = layout(t);
  return t.overlays.filter((o) => o.start < duration).map((o) => ({ ...o, end: Math.min(o.end, duration) }));
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const base = (p: string) => path.basename(p);

// ------------------------------------------------------------------ SRT
const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
export function toSrt(items: Caption[]) {
  return items.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

// ------------------------------------------------------------------ OpenTimelineIO
export function toOtio(t: Timeline, probes: Record<string, ProbeInfo>) {
  const rate = t.fps;
  const fr = (sec: number) => Math.round(sec * rate);
  const rt = (sec: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: fr(sec) });
  const rtf = (frames: number) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: frames });
  const tr = (start: number, dur: number) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rt(start), duration: rt(dur) });
  /** Duração pelas bordas na timeline: a soma dos clipes bate com o total, sem sobra de arredondamento. */
  const span = (start: number, end: number) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rtf(0), duration: rtf(fr(end) - fr(start)) });
  const ref = (src: string) => ({
    OTIO_SCHEMA: 'ExternalReference.1', name: base(src), target_url: pathToFileURL(src).href, metadata: {},
    available_range: probes[src]?.duration ? tr(0, probes[src].duration) : null,
  });
  const clip = (name: string, src: string, srcIn: number, start: number, end: number, effects: unknown[] = []) => ({
    OTIO_SCHEMA: 'Clip.2', name, source_range: { ...span(start, end), start_time: rt(srcIn) },
    media_references: { DEFAULT_MEDIA: ref(src) }, active_media_reference_key: 'DEFAULT_MEDIA',
    effects, markers: [], metadata: {}, enabled: true,
  });
  const gap = (start: number, end: number) => ({ OTIO_SCHEMA: 'Gap.1', name: '', source_range: span(start, end), effects: [], markers: [], metadata: {}, enabled: true });
  const track = (name: string, kind: 'Video' | 'Audio', children: unknown[]) =>
    ({ OTIO_SCHEMA: 'Track.1', name, kind, children, effects: [], markers: [], metadata: {}, source_range: null });
  const warp = (c: Cut) => (c.speed !== 1 || c.reverse
    ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', name: '', effect_name: 'LinearTimeWarp', time_scalar: c.reverse ? -c.speed : c.speed, metadata: {} }]
    : []);

  const cs = cuts(t);
  const v1: unknown[] = [];
  for (const c of cs) {
    if (c.trans > 0) {
      v1.push({ OTIO_SCHEMA: 'Transition.1', name: '', transition_type: 'SMPTE_Dissolve', in_offset: rt(c.trans / 2), out_offset: rt(c.trans / 2), metadata: {} });
    }
    // na OTIO a duração do clipe é a da timeline; a velocidade vai no LinearTimeWarp
    v1.push(clip(base(c.src), c.src, c.srcIn, c.start, c.end, warp(c)));
  }
  const tracks = [track('V1', 'Video', v1)];

  const lay = (items: { start: number; end: number; node: unknown }[]) => {
    const out: unknown[] = [];
    let cur = 0;
    for (const it of [...items].sort((a, b) => a.start - b.start)) {
      if (fr(it.start) > fr(cur)) out.push(gap(cur, it.start));
      out.push(it.node);
      cur = it.end;
    }
    return out;
  };
  if (t.overlays.length) {
    tracks.push(track('V2', 'Video', lay(overlays(t).map((o) => ({ start: o.start, end: o.end, node: clip(base(o.src), o.src, 0, o.start, o.end) })))));
  }
  const voice = cs.filter((c) => c.keepAudio && probes[c.src]?.hasAudio);
  if (voice.length) tracks.push(track('A1', 'Audio', lay(voice.map((c) => ({ start: c.start, end: c.end, node: clip(base(c.src), c.src, c.srcIn, c.start, c.end, warp(c)) })))));
  const { duration } = layout(t);
  t.audio.forEach((a, k) => {
    const end = Math.min(a.out ?? probes[a.src]?.duration ?? duration, a.in + (duration - a.start));
    tracks.push(track(`A${k + 2}`, 'Audio', lay([{ start: a.start, end: a.start + (end - a.in), node: clip(base(a.src), a.src, a.in, a.start, a.start + (end - a.in)) }])));
  });

  return JSON.stringify({
    OTIO_SCHEMA: 'Timeline.1', name: t.name, global_start_time: null,
    metadata: { office: { width: t.width, height: t.height, captions: t.captions?.items ?? [] } },
    tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: tracks, effects: [], markers: [], metadata: {}, source_range: null },
  }, null, 2);
}

// ------------------------------------------------------------------ Final Cut Pro 7 XML (Premiere)
export function toFcp7(t: Timeline, probes: Record<string, ProbeInfo>) {
  const tb = Math.round(t.fps);
  const f = (sec: number) => Math.round(sec * tb);
  const rate = `<rate><timebase>${tb}</timebase><ntsc>FALSE</ntsc></rate>`;
  const fileIds = new Map<string, string>();
  const file = (src: string) => {
    const known = fileIds.get(src);
    if (known) return `<file id="${known}"/>`;
    const id = `file-${fileIds.size + 1}`;
    fileIds.set(src, id);
    const p = probes[src];
    const url = 'file://localhost/' + encodeURI(src.replace(/\\/g, '/').replace(/^\//, ''));
    const video = p?.hasVideo !== false ? `<video><samplecharacteristics>${rate}<width>${p?.width ?? t.width}</width><height>${p?.height ?? t.height}</height></samplecharacteristics></video>` : '';
    const audio = p?.hasAudio ? '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>' : '';
    return `<file id="${id}"><name>${esc(base(src))}</name><pathurl>${esc(url)}</pathurl>${rate}<duration>${f(p?.duration ?? 0)}</duration><media>${video}${audio}</media></file>`;
  };
  let n = 0;
  const speedFilter = (c: Cut) => (c.speed !== 1 || c.reverse
    ? `<filter><effect><name>Time Remap</name><effectid>timeremap</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>`
      + `<parameter><parameterid>speed</parameterid><name>speed</name><value>${Math.round(c.speed * 100)}</value></parameter>`
      + `<parameter><parameterid>reverse</parameterid><name>reverse</name><value>${c.reverse ? 'TRUE' : 'FALSE'}</value></parameter></effect></filter>`
    : '');
  const item = (name: string, src: string, start: number, end: number, srcIn: number, srcOut: number, extra = '', audioVolume?: number) => {
    const vol = audioVolume !== undefined && audioVolume !== 1
      ? `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><value>${audioVolume}</value></parameter></effect></filter>`
      : '';
    return `<clipitem id="clipitem-${++n}"><name>${esc(name)}</name><enabled>TRUE</enabled><duration>${f(probes[src]?.duration ?? srcOut)}</duration>${rate}`
      + `<start>${f(start)}</start><end>${f(end)}</end><in>${f(srcIn)}</in><out>${f(srcOut)}</out>${file(src)}${extra}${vol}</clipitem>`;
  };

  const cs = cuts(t);
  const v1: string[] = [];
  for (const c of cs) {
    if (c.trans > 0) {
      v1.push(`<transitionitem><start>${f(c.start - c.trans / 2)}</start><end>${f(c.start + c.trans / 2)}</end><alignment>center</alignment>${rate}`
        + '<effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype></effect></transitionitem>');
    }
    v1.push(item(base(c.src), c.src, c.start, c.end, c.srcIn, c.srcOut, speedFilter(c)));
  }
  const videoTracks = [`<track>${v1.join('')}</track>`];
  if (t.overlays.length) {
    videoTracks.push(`<track>${overlays(t).map((o) => item(base(o.src), o.src, o.start, o.end, 0, o.end - o.start)).join('')}</track>`);
  }
  const { duration } = layout(t);
  const audioTracks: string[] = [];
  const voice = cs.filter((c) => c.keepAudio && probes[c.src]?.hasAudio);
  if (voice.length) audioTracks.push(`<track>${voice.map((c) => item(base(c.src), c.src, c.start, c.end, c.srcIn, c.srcOut, '', c.volume)).join('')}</track>`);
  for (const a of t.audio) {
    const end = Math.min(a.out ?? probes[a.src]?.duration ?? duration, a.in + (duration - a.start));
    audioTracks.push(`<track>${item(base(a.src), a.src, a.start, a.start + (end - a.in), a.in, end, '', a.volume)}</track>`);
  }

  const fmt = `<format><samplecharacteristics>${rate}<width>${t.width}</width><height>${t.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>`;
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5">'
    + `<sequence id="sequence-1"><name>${esc(t.name)}</name><duration>${f(duration)}</duration>${rate}`
    + `<media><video>${fmt}${videoTracks.join('')}</video><audio>${audioTracks.join('')}</audio></media></sequence></xmeml>\n`;
}

// ------------------------------------------------------------------ Shotcut (MLT XML)
export function toMlt(t: Timeline, probes: Record<string, ProbeInfo>) {
  const fps = t.fps;
  const f = (sec: number) => Math.round(sec * fps);
  const { duration } = layout(t);
  const total = Math.max(1, f(duration));
  const prop = (k: string, v: string | number) => `<property name="${k}">${esc(String(v))}</property>`;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(t.width, t.height);
  const producers: string[] = [];
  let n = 0;
  /** Um produtor por uso: velocidade e áudio desligado são propriedades do produtor no MLT. */
  const producer = (src: string, speed = 1, reverse = false, mute = false, still = false) => {
    const id = `producer${n++}`;
    const p = probes[src];
    const s = reverse ? -speed : speed;
    const len = Math.max(1, still ? total : f((p?.duration ?? duration) / speed));
    const warp = speed !== 1 || reverse;
    producers.push(`<producer id="${id}" in="0" out="${len - 1}">${prop('length', len)}`
      + (warp ? prop('resource', `${s}:${src}`) + prop('mlt_service', 'timewarp') + prop('warp_speed', s) + prop('warp_resource', src)
        : prop('resource', src) + prop('mlt_service', still ? 'qimage' : 'avformat-novalidate'))
      + (mute ? prop('audio_index', -1) : '') + prop('shotcut:caption', base(src)) + '</producer>');
    return id;
  };
  const entries = (items: { start: number; end: number; xml: string }[]) => {
    let cur = 0;
    return [...items].sort((a, b) => a.start - b.start).map((it) => {
      const blank = f(it.start) - cur;
      cur = f(it.end);
      return (blank > 0 ? `<blank length="${blank}"/>` : '') + it.xml;
    }).join('');
  };
  // o Shotcut representa transições com faixas cruzadas; aqui elas viram corte no meio da transição
  const cs = cuts(t);
  const v1 = cs.map((c) => {
    const id = producer(c.src, c.speed, c.reverse, !c.keepAudio);
    const a = f(c.srcIn / c.speed);
    return { start: c.start, end: c.end, xml: `<entry producer="${id}" in="${a}" out="${a + Math.max(1, f(c.end) - f(c.start)) - 1}"/>` };
  });
  const playlists: { id: string; name: string; audio: boolean; body: string }[] = [
    { id: 'playlist0', name: 'V1', audio: false, body: entries(v1) },
  ];
  if (t.overlays.length) {
    playlists.push({ id: 'playlist1', name: 'V2', audio: false, body: entries(overlays(t).map((o) => {
      const id = producer(o.src, 1, false, true, true);
      return { start: o.start, end: o.end, xml: `<entry producer="${id}" in="0" out="${Math.max(1, f(o.end - o.start)) - 1}"/>` };
    })) });
  }
  t.audio.forEach((a, k) => {
    const end = Math.min(a.out ?? probes[a.src]?.duration ?? duration, a.in + (duration - a.start));
    const id = producer(a.src);
    playlists.push({ id: `audio${k}`, name: `A${k + 1}`, audio: true, body: entries([{ start: a.start, end: a.start + (end - a.in), xml: `<entry producer="${id}" in="${f(a.in)}" out="${Math.max(f(a.in), f(end) - 1)}"/>` }]) });
  });

  const tracks = playlists.map((p) => `<track producer="${p.id}"${p.audio ? ' hide="video"' : ''}/>`).join('');
  const transitions = playlists.map((p, k) => `<transition id="mix${k}">${prop('a_track', 0)}${prop('b_track', k + 1)}${prop('mlt_service', 'mix')}${prop('always_active', 1)}${prop('sum', 1)}</transition>`
    + (p.audio ? '' : `<transition id="blend${k}">${prop('a_track', 0)}${prop('b_track', k + 1)}${prop('version', '0.1')}${prop('mlt_service', 'frei0r.cairoblend')}${prop('threads', 0)}${prop('disable', k === 0 ? 1 : 0)}</transition>`)).join('');
  return '<?xml version="1.0" encoding="utf-8"?>\n'
    + `<mlt LC_NUMERIC="C" version="7.0.0" title="${esc(t.name)}" producer="main_bin">`
    + `<profile description="${t.width}x${t.height} ${fps}fps" width="${t.width}" height="${t.height}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${t.width / g}" display_aspect_den="${t.height / g}" frame_rate_num="${Math.round(fps * 1000)}" frame_rate_den="1000" colorspace="709"/>`
    + `<playlist id="main_bin">${prop('xml_retain', 1)}</playlist>`
    + `<producer id="black" in="0" out="${total - 1}">${prop('length', total)}${prop('eof', 'pause')}${prop('resource', '0')}${prop('aspect_ratio', 1)}${prop('mlt_service', 'color')}${prop('mlt_image_format', 'rgba')}${prop('set.test_audio', 0)}</producer>`
    + `<playlist id="background"><entry producer="black" in="0" out="${total - 1}"/></playlist>`
    + producers.join('')
    + playlists.map((p) => `<playlist id="${p.id}">${prop(p.audio ? 'shotcut:audio' : 'shotcut:video', 1)}${prop('shotcut:name', p.name)}${p.body}</playlist>`).join('')
    + `<tractor id="tractor0" title="${esc(t.name)}" in="0" out="${total - 1}">${prop('shotcut', 1)}<track producer="background"/>${tracks}${transitions}</tractor>`
    + '</mlt>\n';
}

export function buildExport(format: ExportFormat, t: Timeline, probes: Record<string, ProbeInfo>) {
  if (format === 'srt') return toSrt(t.captions?.items ?? []);
  if (format === 'otio') return toOtio(t, probes);
  if (format === 'fcp7') return toFcp7(t, probes);
  return toMlt(t, probes);
}
