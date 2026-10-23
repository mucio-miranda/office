import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTimeline, type Timeline } from './schema.ts';
import { compile, type ProbeInfo } from './compile.ts';

export const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_BIN || 'ffprobe';

function run(bin: string, args: string[], opts: { cwd?: string; onStdout?: (s: string) => void; signal?: AbortSignal } = {}) {
  return new Promise<{ code: number; stderr: string; stdout: string }>((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd, windowsHide: true, signal: opts.signal });
    let stderr = '';
    let stdout = '';
    p.stdout.on('data', (d) => { const s = d.toString(); stdout += s; opts.onStdout?.(s); });
    p.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-20000); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? -1, stderr, stdout }));
  });
}

export async function probe(file: string): Promise<ProbeInfo> {
  const { code, stdout, stderr } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (code !== 0) throw new Error(`ffprobe falhou em ${file}: ${stderr.trim()}`);
  const j = JSON.parse(stdout);
  const v = j.streams?.find((s: any) => s.codec_type === 'video');
  return {
    duration: Number(j.format?.duration ?? v?.duration ?? 0),
    hasAudio: !!j.streams?.some((s: any) => s.codec_type === 'audio'),
    hasVideo: !!v,
    width: v?.width,
    height: v?.height,
  };
}

export interface RenderOptions {
  /** Pasta base para resolver `src` relativos. */
  baseDir?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export async function render(input: unknown, output: string, opts: RenderOptions = {}) {
  const raw = parseTimeline(input);
  const base = opts.baseDir ?? process.cwd();
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.resolve(base, p));
  const t: Timeline = {
    ...raw,
    video: raw.video.map((c) => ({ ...c, src: abs(c.src) })),
    audio: raw.audio.map((a) => ({ ...a, src: abs(a.src) })),
    overlays: raw.overlays.map((o) => ({ ...o, src: abs(o.src) })),
  };

  const probes: Record<string, ProbeInfo> = {};
  for (const src of new Set([...t.video.map((c) => c.src), ...t.audio.map((a) => a.src)])) probes[src] = await probe(src);
  for (const c of t.video) {
    const d = probes[c.src].duration;
    if (d && c.out > d + 0.05) throw new Error(`Clipe ${c.id}: out=${c.out}s passa da duração do arquivo (${d.toFixed(2)}s)`);
  }

  const outAbs = path.resolve(output);
  await mkdir(path.dirname(outAbs), { recursive: true });
  const { args, files, duration, outputs } = compile(t, probes, outAbs);
  const work = await mkdtemp(path.join(tmpdir(), 'office-render-'));
  try {
    for (const f of files) await writeFile(path.join(work, f.name), f.content, 'utf8');
    const full = ['-progress', 'pipe:1', '-nostats', ...args];
    const res = await run(FFMPEG, full, {
      cwd: work,
      signal: opts.signal,
      onStdout: (s) => {
        const m = [...s.matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop();
        if (m && duration > 0) opts.onProgress?.(Math.min(0.999, Number(m[1]) / 1e6 / duration));
      },
    });
    if (res.code !== 0) throw new Error(`ffmpeg saiu com código ${res.code}:\n${res.stderr.split('\n').slice(-15).join('\n')}`);
    opts.onProgress?.(1);
    return { outputs, duration, args: full };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
