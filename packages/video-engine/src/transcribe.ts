import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { cpus, homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { FFMPEG } from './render.ts';
import { layout, type Caption, type Timeline } from './schema.ts';

/**
 * Legendas automáticas com whisper.cpp (MIT): extrai o áudio com o ffmpeg, transcreve com tempo por
 * palavra e agrupa as palavras em legendas curtas, no ritmo de Reels.
 */

export interface Word { start: number; end: number; text: string }
export interface WhisperPaths { bin: string; model: string; vad: string | null }

/** Pasta das ferramentas do Office (a mesma do servidor). */
const toolsDir = () => process.env.OFFICE_TOOLS_DIR
  ?? (process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Office', 'tools') : path.join(homedir(), '.office', 'tools'));

const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

function findFile(dir: string, test: (name: string) => boolean, depth = 3): string | null {
  if (!existsSync(dir)) return null;
  // versões lado a lado: a mais nova primeiro
  const entries = readdirSync(dir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const e of entries) if (test(e) && statSync(path.join(dir, e)).isFile()) return path.join(dir, e);
  if (depth === 0) return null;
  for (const e of entries) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { const hit = findFile(p, test, depth - 1); if (hit) return hit; }
  }
  return null;
}

/**
 * Onde estão o whisper-cli, o modelo e o VAD: variáveis OFFICE_WHISPER_BIN / _MODEL / _VAD, ou a pasta
 * `<ferramentas>/whisper` (instalada pelo Office), preferindo o large-v3-turbo.
 */
export function findWhisper(): WhisperPaths | null {
  const base = path.join(toolsDir(), 'whisper');
  const bin = process.env.OFFICE_WHISPER_BIN ?? findFile(base, (n) => n === exe);
  const models = path.join(base, 'models');
  const model = process.env.OFFICE_WHISPER_MODEL
    ?? findFile(models, (n) => /^ggml-large-v3-turbo.*\.bin$/.test(n), 0)
    ?? findFile(models, (n) => /^ggml-.*\.bin$/.test(n) && !n.includes('silero'), 0);
  const vad = process.env.OFFICE_WHISPER_VAD ?? findFile(models, (n) => /^ggml-silero.*\.bin$/.test(n), 0);
  return bin && model ? { bin, model, vad } : null;
}

function run(bin: string, args: string[], signal?: AbortSignal) {
  return new Promise<void>((ok, fail) => {
    const p = spawn(bin, args, { windowsHide: true, signal });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${path.basename(bin)} saiu com código ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`))));
  });
}

interface WhisperToken { text: string; offsets: { from: number; to: number } }
interface WhisperSegment { text: string; offsets: { from: number; to: number }; tokens?: WhisperToken[] }

/**
 * Palavras de um segmento com tempo. Com o VAD ligado, o whisper.cpp devolve o segmento no tempo do
 * arquivo e os tokens no tempo do áudio sem os silêncios: os tokens são realinhados ao segmento.
 */
export function segmentWords(seg: WhisperSegment): Word[] {
  const toks = (seg.tokens ?? []).filter((t) => !/^\[_|^\[\w+\]$/.test(t.text) && t.text.length);
  const s0 = seg.offsets.from / 1000;
  const s1 = seg.offsets.to / 1000;
  if (!toks.length) {
    // sem tokens: divide o segmento igualmente entre as palavras
    const ws = seg.text.trim().split(/\s+/).filter(Boolean);
    return ws.map((text, i) => ({ text, start: s0 + ((s1 - s0) * i) / ws.length, end: s0 + ((s1 - s0) * (i + 1)) / ws.length }));
  }
  const t0 = toks[0].offsets.from / 1000;
  const t1 = Math.max(t0 + 0.01, toks[toks.length - 1].offsets.to / 1000);
  const map = (t: number) => s0 + ((t - t0) * (s1 - s0)) / (t1 - t0);
  const words: Word[] = [];
  for (const t of toks) {
    const a = map(t.offsets.from / 1000);
    const b = map(t.offsets.to / 1000);
    // token que começa com espaço abre palavra nova; pontuação e pedaços colam na anterior
    if (/^\s/.test(t.text) || !words.length) words.push({ text: t.text.trim(), start: a, end: b });
    else { words[words.length - 1].text += t.text; words[words.length - 1].end = b; }
  }
  const clean = words.filter((w) => w.text);
  // um token pode quebrar um caractere acentuado ao meio: o texto do segmento manda quando a contagem bate
  const segWords = seg.text.trim().split(/\s+/).filter(Boolean);
  if (segWords.length === clean.length) clean.forEach((w, i) => { w.text = segWords[i]; });
  return clean;
}

export interface TranscribeOptions {
  /** Trecho do arquivo, em segundos. */
  from?: number;
  to?: number;
  language?: string;
  paths?: WhisperPaths;
  signal?: AbortSignal;
}

/** Transcreve um trecho de um arquivo de áudio ou vídeo. Tempos no relógio do arquivo de origem. */
export async function transcribe(file: string, opts: TranscribeOptions = {}): Promise<Word[]> {
  const paths = opts.paths ?? findWhisper();
  if (!paths) throw new Error('Whisper não está instalado. Instale em Equipe → Ferramentas criativas.');
  const work = await mkdtemp(path.join(tmpdir(), 'office-whisper-'));
  try {
    const wav = path.join(work, 'audio.wav');
    await run(FFMPEG, [
      '-v', 'error', '-y',
      ...(opts.from ? ['-ss', String(opts.from)] : []),
      ...(opts.to !== undefined ? ['-to', String(opts.to)] : []),
      '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav,
    ], opts.signal);
    const out = path.join(work, 'whisper');
    await run(paths.bin, [
      '-m', paths.model, '-f', wav, '-l', opts.language ?? 'pt', '-ojf', '-of', out, '-np',
      '-t', String(Math.max(1, cpus().length)),
      ...(paths.vad ? ['--vad', '-vm', paths.vad] : []),
    ], opts.signal);
    const json = JSON.parse(await readFile(`${out}.json`, 'utf8')) as { transcription: WhisperSegment[] };
    const offset = opts.from ?? 0;
    return json.transcription.flatMap(segmentWords).map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export interface GroupOptions {
  /** Máximo de palavras por legenda. */
  maxWords?: number;
  /** Máximo de caracteres por legenda. */
  maxChars?: number;
  /** Pausa (s) que sempre quebra a legenda. */
  maxGap?: number;
  /** Duração mínima na tela (s). */
  minDuration?: number;
}

/** Agrupa palavras em legendas curtas: quebra em pausa, pontuação final ou limite de tamanho. */
export function groupCaptions(words: Word[], o: GroupOptions = {}): Caption[] {
  const { maxWords = 4, maxChars = 22, maxGap = 0.45, minDuration = 0.5 } = o;
  const out: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' ') });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const len = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (prev && (w.start - prev.end > maxGap || cur.length >= maxWords || len > maxChars)) flush();
    cur.push(w);
    // ponto sempre fecha a legenda; vírgula fecha quando já tem duas palavras
    if (/[.!?…]$/.test(w.text) || (/[,;:]$/.test(w.text) && cur.length >= 2)) flush();
  }
  flush();
  // tempo mínimo na tela, sem invadir a próxima legenda
  const r = (n: number) => Math.round(n * 100) / 100;
  return out.map((c, i) => {
    const next = out[i + 1]?.start ?? Infinity;
    const end = Math.min(Math.max(c.end, c.start + minDuration), next);
    return { start: r(c.start), end: r(Math.max(end, c.start + 0.1)), text: c.text };
  });
}

/**
 * Legendas da timeline inteira: transcreve a fala de cada clipe com "manter áudio" (ou, se nenhum
 * clipe tem fala, as trilhas de áudio) e converte para o tempo da timeline.
 */
export async function captionTimeline(t: Timeline, baseDir: string, opts: Omit<TranscribeOptions, 'from' | 'to'> & { group?: GroupOptions; onProgress?: (f: number) => void } = {}) {
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p));
  const { starts, duration } = layout(t);
  const words: Word[] = [];
  const speech = t.video.map((c, i) => ({ c, i })).filter(({ c }) => c.keepAudio && !c.reverse);
  const jobs = speech.length
    ? speech.map(({ c, i }) => ({ src: abs(c.src), from: c.in, to: c.out, map: (s: number) => starts[i] + (s - c.in) / c.speed, lo: starts[i], hi: starts[i] + (c.out - c.in) / c.speed }))
    : t.audio.map((a) => ({ src: abs(a.src), from: a.in, to: a.out ?? a.in + (duration - a.start), map: (s: number) => a.start + (s - a.in), lo: a.start, hi: duration }));
  for (const [k, j] of jobs.entries()) {
    const ws = await transcribe(j.src, { ...opts, from: j.from, to: j.to });
    for (const w of ws) {
      const start = j.map(w.start);
      const end = j.map(w.end);
      // palavras cortadas pela transição ou fora do trecho usado ficam de fora
      if (start >= j.lo - 0.05 && start < Math.min(j.hi, duration)) words.push({ text: w.text, start, end: Math.min(end, j.hi, duration) });
    }
    opts.onProgress?.((k + 1) / jobs.length);
  }
  words.sort((a, b) => a.start - b.start);
  return groupCaptions(words, opts.group);
}
