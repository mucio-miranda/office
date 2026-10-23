import { z } from 'zod';

/**
 * Timeline do Office: um JSON que descreve a edição inteira.
 * Quem escreve pode ser a UI (arrastando clipes) ou um funcionário de IA.
 * Tempos em segundos. `in`/`out` são relativos ao arquivo de origem.
 */

export const TRANSITIONS = [
  'corte', 'fade', 'fadeblack', 'flash', 'blur', 'zoom', 'whip-esquerda', 'whip-direita',
  'slide-cima', 'slide-baixo', 'circulo', 'pixel', 'radial', 'dissolve',
] as const;
export type TransitionName = (typeof TRANSITIONS)[number];

/** Tradução das transições da casa (estilo CapCut) para os nomes do filtro xfade do ffmpeg. */
export const XFADE: Record<Exclude<TransitionName, 'corte'>, string> = {
  fade: 'fade',
  fadeblack: 'fadeblack',
  flash: 'fadewhite',
  blur: 'hblur',
  zoom: 'zoomin',
  'whip-esquerda': 'smoothleft',
  'whip-direita': 'smoothright',
  'slide-cima': 'slideup',
  'slide-baixo': 'slidedown',
  circulo: 'circleopen',
  pixel: 'pixelize',
  radial: 'radial',
  dissolve: 'dissolve',
};

const color = z.object({
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(0).max(3).default(1),
  saturation: z.number().min(0).max(3).default(1),
  gamma: z.number().min(0.1).max(3).default(1),
});

export const VideoClip = z.object({
  id: z.string(),
  src: z.string(),
  in: z.number().min(0).default(0),
  out: z.number().positive(),
  speed: z.number().min(0.1).max(8).default(1),
  reverse: z.boolean().default(false),
  /** Zoom suave (Ken Burns): escala no início e no fim do clipe. */
  zoom: z.object({ from: z.number().min(1).max(3), to: z.number().min(1).max(3) }).optional(),
  color: color.optional(),
  /** Mantém o áudio original do clipe (fala). */
  keepAudio: z.boolean().default(false),
  volume: z.number().min(0).max(4).default(1),
  /** Transição de entrada (do clipe anterior para este). */
  transition: z.object({ type: z.enum(TRANSITIONS), duration: z.number().min(0.05).max(3) }).optional(),
});
export type VideoClip = z.infer<typeof VideoClip>;

export const AudioClip = z.object({
  id: z.string(),
  src: z.string(),
  /** Onde o áudio começa na timeline. */
  start: z.number().min(0).default(0),
  in: z.number().min(0).default(0),
  out: z.number().positive().optional(),
  volume: z.number().min(0).max(4).default(1),
  fadeIn: z.number().min(0).default(0),
  fadeOut: z.number().min(0).default(0),
});
export type AudioClip = z.infer<typeof AudioClip>;

export const Overlay = z.object({
  id: z.string(),
  src: z.string(),
  start: z.number().min(0),
  end: z.number().positive(),
  /** Posição do centro em fração da tela (0..1). */
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  /** Largura em fração da tela. */
  width: z.number().min(0.01).max(1).default(0.4),
  fade: z.number().min(0).default(0.3),
});
export type Overlay = z.infer<typeof Overlay>;

export const CAPTION_STYLES = ['rezzu', 'classica', 'karaoke', 'caixa'] as const;

export const Caption = z.object({
  start: z.number().min(0),
  end: z.number().positive(),
  text: z.string(),
});
export type Caption = z.infer<typeof Caption>;

export const Timeline = z.object({
  version: z.literal(1).default(1),
  name: z.string().default('sem título'),
  width: z.number().int().min(16).default(1080),
  height: z.number().int().min(16).default(1920),
  fps: z.number().min(1).max(120).default(30),
  background: z.string().default('black'),
  video: z.array(VideoClip).min(1),
  audio: z.array(AudioClip).default([]),
  overlays: z.array(Overlay).default([]),
  captions: z
    .object({
      style: z.enum(CAPTION_STYLES).default('rezzu'),
      font: z.string().default('Montserrat'),
      size: z.number().default(72),
      primary: z.string().default('#FFFFFF'),
      highlight: z.string().default('#FFD400'),
      /** Altura do texto em fração da tela (0 = topo, 1 = base). */
      y: z.number().min(0).max(1).default(0.72),
      items: z.array(Caption).default([]),
    })
    .optional(),
  output: z
    .object({
      crf: z.number().min(0).max(51).default(18),
      preset: z.string().default('medium'),
      audioBitrate: z.string().default('192k'),
      /** Exporta também um MP4 só com a voz (sem música). */
      voiceOnly: z.boolean().default(false),
    })
    .default({}),
});
export type Timeline = z.infer<typeof Timeline>;
export type TimelineInput = z.input<typeof Timeline>;

export function parseTimeline(input: unknown): Timeline {
  return Timeline.parse(input);
}

/** Duração de um clipe na timeline (depois de aplicar a velocidade). */
export const clipDuration = (c: VideoClip) => (c.out - c.in) / c.speed;

/** Início de cada clipe na timeline, descontando a sobreposição das transições. */
export function layout(t: Timeline) {
  const starts: number[] = [];
  let cursor = 0;
  t.video.forEach((c, i) => {
    const overlap = i > 0 && c.transition && c.transition.type !== 'corte' ? effectiveTransition(t, i) : 0;
    cursor -= overlap;
    starts.push(cursor);
    cursor += clipDuration(c);
  });
  return { starts, duration: cursor };
}

/** A transição não pode ser maior que metade de qualquer um dos dois clipes. */
export function effectiveTransition(t: Timeline, i: number) {
  const c = t.video[i];
  if (!c.transition || c.transition.type === 'corte' || i === 0) return 0;
  const max = Math.min(clipDuration(t.video[i - 1]), clipDuration(c)) / 2;
  return Math.min(c.transition.duration, max);
}
