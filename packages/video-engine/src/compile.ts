import { XFADE, effectiveTransition, layout, clipDuration, type Timeline, type VideoClip } from './schema.ts';
import { buildAss } from './captions.ts';

export interface ProbeInfo {
  duration: number;
  hasAudio: boolean;
  hasVideo: boolean;
  width?: number;
  height?: number;
}

export interface CompiledRender {
  /** Argumentos do ffmpeg (sem o executável). Os arquivos de `files` são gravados no `cwd` antes de rodar. */
  args: string[];
  files: { name: string; content: string }[];
  duration: number;
  outputs: string[];
}

const n = (v: number) => Number(v.toFixed(4)).toString();

/** atempo só aceita 0.5..2 por instância; encadeia para velocidades maiores ou menores. */
export function atempoChain(speed: number): string[] {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) parts.push(`atempo=${n(s)}`);
  return parts;
}

function colorFilter(c: VideoClip['color']) {
  if (!c) return [];
  const { brightness = 0, contrast = 1, saturation = 1, gamma = 1 } = c;
  if (brightness === 0 && contrast === 1 && saturation === 1 && gamma === 1) return [];
  return [`eq=brightness=${n(brightness)}:contrast=${n(contrast)}:saturation=${n(saturation)}:gamma=${n(gamma)}`];
}

/**
 * Compila a timeline num único comando ffmpeg (filter_complex).
 * Função pura: não toca em disco nem roda processo, o que facilita testar.
 */
export function compile(t: Timeline, probes: Record<string, ProbeInfo>, output: string): CompiledRender {
  const W = t.width;
  const H = t.height;
  const { starts, duration } = layout(t);
  const inputs: string[] = [];
  const filters: string[] = [];
  const files: CompiledRender['files'] = [];
  let idx = 0;
  const addInput = (...a: string[]) => { inputs.push(...a); return idx++; };

  // ---- vídeo: cada clipe normalizado no mesmo tamanho/fps/timebase ----
  const vLabels: string[] = [];
  const voiceLabels: string[] = [];
  t.video.forEach((c, i) => {
    const k = addInput('-i', c.src);
    const chain = [
      `trim=start=${n(c.in)}:end=${n(c.out)}`,
      'setpts=PTS-STARTPTS',
      ...(c.reverse ? ['reverse'] : []),
      ...(c.speed !== 1 ? [`setpts=PTS/${n(c.speed)}`] : []),
      `scale=${W}:${H}:force_original_aspect_ratio=increase`,
      `crop=${W}:${H}`,
      ...colorFilter(c.color),
    ];
    if (c.zoom && (c.zoom.from !== 1 || c.zoom.to !== 1)) {
      const frames = Math.max(1, Math.round(clipDuration(c) * t.fps));
      chain.push(
        `zoompan=z='${n(c.zoom.from)}+(${n(c.zoom.to - c.zoom.from)})*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${n(t.fps)}`,
        // zoompan deixa timestamps que travam o xfade seguinte; regera a partir do número do quadro
        `setpts=N/${n(t.fps)}/TB`,
      );
    }
    chain.push(`fps=${n(t.fps)}`, 'setsar=1', 'format=yuv420p', 'settb=AVTB');
    filters.push(`[${k}:v]${chain.join(',')}[v${i}]`);
    vLabels.push(`v${i}`);

    if (c.keepAudio && probes[c.src]?.hasAudio) {
      const delay = Math.round(starts[i] * 1000);
      const a = [
        `atrim=start=${n(c.in)}:end=${n(c.out)}`,
        'asetpts=PTS-STARTPTS',
        ...(c.reverse ? ['areverse'] : []),
        ...atempoChain(c.speed),
        `volume=${n(c.volume)}`,
        'aformat=sample_rates=48000:channel_layouts=stereo',
        `adelay=delays=${delay}:all=1`,
      ];
      filters.push(`[${k}:a]${a.join(',')}[va${i}]`);
      voiceLabels.push(`va${i}`);
    }
  });

  // ---- transições (xfade) encadeadas ----
  let last = vLabels[0];
  for (let i = 1; i < vLabels.length; i++) {
    const c = t.video[i];
    const d = effectiveTransition(t, i);
    const out = `x${i}`;
    if (d > 0 && c.transition && c.transition.type !== 'corte') {
      filters.push(`[${last}][${vLabels[i]}]xfade=transition=${XFADE[c.transition.type]}:duration=${n(d)}:offset=${n(starts[i])}[${out}]`);
    } else {
      filters.push(`[${last}][${vLabels[i]}]concat=n=2:v=1:a=0[${out}]`);
    }
    last = out;
  }

  // ---- sobreposições (logo, figurinhas) ----
  t.overlays.forEach((o, j) => {
    const k = addInput('-loop', '1', '-t', n(o.end), '-i', o.src);
    const fades = o.fade > 0
      ? `,fade=t=in:st=${n(o.start)}:d=${n(o.fade)}:alpha=1,fade=t=out:st=${n(Math.max(o.start, o.end - o.fade))}:d=${n(o.fade)}:alpha=1`
      : '';
    filters.push(`[${k}:v]scale=${Math.round(W * o.width)}:-1,format=rgba${fades}[ov${j}]`);
    const out = `o${j}`;
    filters.push(
      `[${last}][ov${j}]overlay=x='main_w*${n(o.x)}-overlay_w/2':y='main_h*${n(o.y)}-overlay_h/2':enable='between(t,${n(o.start)},${n(o.end)})'[${out}]`,
    );
    last = out;
  });

  // ---- legendas (ASS queimado) ----
  if (t.captions && t.captions.items.length) {
    files.push({ name: 'legendas.ass', content: buildAss(t, t.captions) });
    filters.push(`[${last}]subtitles=legendas.ass[subs]`);
    last = 'subs';
  }

  // ---- áudio: voz dos clipes + trilhas ----
  const musicLabels: string[] = [];
  t.audio.forEach((a, j) => {
    const k = addInput('-i', a.src);
    const srcDur = probes[a.src]?.duration ?? duration;
    const end = Math.min(a.out ?? srcDur, a.in + (duration - a.start));
    const len = Math.max(0.01, end - a.in);
    const chain = [
      `atrim=start=${n(a.in)}:end=${n(end)}`,
      'asetpts=PTS-STARTPTS',
      ...(a.fadeIn > 0 ? [`afade=t=in:st=0:d=${n(a.fadeIn)}`] : []),
      ...(a.fadeOut > 0 ? [`afade=t=out:st=${n(Math.max(0, len - a.fadeOut))}:d=${n(a.fadeOut)}`] : []),
      `volume=${n(a.volume)}`,
      'aformat=sample_rates=48000:channel_layouts=stereo',
      `adelay=delays=${Math.round(a.start * 1000)}:all=1`,
    ];
    filters.push(`[${k}:a]${chain.join(',')}[m${j}]`);
    musicLabels.push(`m${j}`);
  });

  const mix = (labels: string[], out: string) => {
    if (labels.length === 0) {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=end=${n(duration)}[${out}]`);
    } else {
      const ins = labels.map((l) => `[${l}]`).join('');
      filters.push(
        `${ins}amix=inputs=${labels.length}:normalize=0:duration=longest,apad,atrim=end=${n(duration)},alimiter=limit=0.95[${out}]`,
      );
    }
  };

  const outputs = [output];
  const wantVoice = t.output.voiceOnly && voiceLabels.length > 0;
  if (wantVoice) {
    // a voz entra nas duas mixagens; asplit evita consumir o mesmo rótulo duas vezes
    const forMain: string[] = [];
    const forVoice: string[] = [];
    voiceLabels.forEach((l) => {
      filters.push(`[${l}]asplit=2[${l}a][${l}b]`);
      forMain.push(`${l}a`);
      forVoice.push(`${l}b`);
    });
    mix([...forMain, ...musicLabels], 'aout');
    mix(forVoice, 'avoice');
    filters.push(`[${last}]split=2[vmain][vvoice]`);
  } else {
    mix([...voiceLabels, ...musicLabels], 'aout');
  }

  const enc = (v: string, a: string, file: string) => [
    '-map', `[${v}]`, '-map', `[${a}]`,
    '-c:v', 'libx264', '-preset', t.output.preset, '-crf', String(t.output.crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', t.output.audioBitrate,
    '-t', n(duration), '-movflags', '+faststart', file,
  ];

  const args = ['-y', '-hide_banner', ...inputs, '-filter_complex', filters.join(';')];
  if (wantVoice) {
    const voiceFile = output.replace(/(\.[a-z0-9]+)?$/i, '_so-voz$1');
    outputs.push(voiceFile);
    args.push(...enc('vmain', 'aout', output), ...enc('vvoice', 'avoice', voiceFile));
  } else {
    args.push(...enc(last, 'aout', output));
  }
  return { args, files, duration, outputs };
}
