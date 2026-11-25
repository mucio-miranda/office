import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, realpath, rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const run = promisify(execFile);
export async function conferirAudio(file, signal) {
  const opts = { windowsHide: true, signal, maxBuffer: 2 * 1024 * 1024 };
  const probe = await run(process.env.FFPROBE_BIN || 'ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-f','mov','-show_streams','-show_format','-of','json',file], opts);
  const info = JSON.parse(probe.stdout);
  const tracks = info.streams.filter(s => s.codec_type === 'audio');
  const duration = Number(info.format.duration);
  const levels = [];
  for (const track of tracks) {
    const result = await run(process.env.FFMPEG_BIN || 'ffmpeg', ['-hide_banner','-nostats','-protocol_whitelist','file,pipe','-f','mov','-i',file,'-map','0:' + track.index,'-af','astats=metadata=0:measure_perchannel=none:measure_overall=Peak_level,loudnorm=print_format=json','-f','null','-'], opts);
    const peak = /Peak level dB:\s*([-+\d.inf]+)/i.exec(result.stderr)?.[1];
    const lufs = /"input_i"\s*:\s*"([^"]+)"/.exec(result.stderr)?.[1];
    if (!peak || !lufs) throw Error('O FFmpeg não retornou as medições de áudio.');
    levels.push({ indice: track.index, lufs: Number.isFinite(Number(lufs)) ? Number(lufs) : null, picoDb: Number.isFinite(Number(peak)) ? Number(peak) : null, silenciosa: peak.toLowerCase() === '-inf' });
  }
  return { duracaoSegundos: duration, faixas: tracks.length, medicao: levels, muda: !levels.length || levels.every(l => l.silenciosa) };
}

export async function miniatura(file, signal) {
  const format = { '.png': 'png_pipe', '.jpg': 'jpeg_pipe', '.jpeg': 'jpeg_pipe', '.webp': 'webp_pipe' }[path.extname(file).toLowerCase()];
  if (!format) throw Error('Formato de foto incompatível.');
  const result = await run(process.env.FFMPEG_BIN || 'ffmpeg', ['-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-f',format,'-i',file,'-frames:v','1','-vf',"scale=480:480:force_original_aspect_ratio=decrease",'-f','image2pipe','-c:v','mjpeg','pipe:1'], { signal, windowsHide: true, encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 });
  return { type: 'image', mimeType: 'image/jpeg', data: result.stdout.toString('base64') };
}

export async function copiarLocal(root, bits, temp, op) {
  const src = await realpath(path.join(root, ...bits));
  const relative = path.relative(root, src);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) throw Error('Origem fora da pasta autorizada.');
  const within = path.relative(src, temp);
  if (!within || !path.isAbsolute(within) && within !== '..' && !within.startsWith('..' + path.sep)) throw Error('O destino ficaria dentro da origem.');
  const stage = await mkdtemp(path.join(temp, 'copia-'));
  const dest = path.join(stage, path.basename(src));
  let bytes = 0, arquivos = 0;
  async function copy(from, to) {
    op.signal.throwIfAborted();
    const info = await lstat(from);
    if (info.isSymbolicLink()) throw Error('A pasta contém um atalho: ' + path.basename(from));
    if (info.isDirectory()) {
      await mkdir(to);
      for (const entry of await readdir(from)) await copy(path.join(from, entry), path.join(to, entry));
    } else if (info.isFile()) {
      op.progresso = 'Copiando ' + path.basename(from);
      const stream = createReadStream(from);
      stream.on('data', chunk => { bytes += chunk.length; op.bytes = bytes; });
      await pipeline(stream, createWriteStream(to, { flags: 'wx' }), { signal: op.signal });
      arquivos++;
    } else throw Error('Tipo de arquivo incompatível.');
  }
  const partial = path.join(stage, '.parcial');
  await copy(src, partial);
  op.signal.throwIfAborted();
  await rename(partial, dest);
  return { absoluto: dest, relativo: path.relative(temp, dest), bytes, arquivos };
}
