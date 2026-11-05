import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Sessões do Claude Code de um cliente. O funcionário roda na pasta do cliente, a mesma em que a pessoa abre o
 * terminal, então as conversas do terminal e as do Office moram na mesma pasta de projetos do Claude Code e uma
 * pode continuar na outra. Só lê os arquivos: nada é apagado nem reescrito.
 */
export interface SessionInfo {
  id: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  sizeMb: number;
}

export interface SessionLine {
  role: 'usuario' | 'agente';
  text: string;
  at: string;
}

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOISE = /^\s*(<(system-reminder|local-command|command-name|command-message|command-args|bash-|task-notification)|Caveat:|This session is being continued|\[Request interrupted|--resume)/;

export const projectsRoot = () => process.env.CLAUDE_PROJECTS_DIR ?? path.join(homedir(), '.claude', 'projects');

/** O Claude Code troca tudo que não é letra ou número por hífen; a letra do disco pode vir maiúscula ou minúscula. */
export function projectDirs(cwd: string, root = projectsRoot()) {
  const want = path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.toLowerCase() === want)
    .map((e) => path.join(root, e.name));
}

function readSlice(file: string, from: number, bytes: number) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, from);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n');
};

/** Linhas de conversa (pedido da pessoa e texto do agente) de um trecho do arquivo, sem ferramentas nem avisos. */
function parseLines(chunk: string): SessionLine[] {
  const out: SessionLine[] = [];
  for (const raw of chunk.split('\n')) {
    // linhas enormes são imagens ou saídas de ferramenta
    if (!raw.startsWith('{') || raw.length > 400_000) continue;
    let ev: any;
    try { ev = JSON.parse(raw); } catch { continue; }
    if (ev.isMeta || ev.isCompactSummary || !ev.message) continue;
    const at = String(ev.timestamp ?? '');
    if (ev.type === 'user') {
      const text = textOf(ev.message.content).trim();
      if (text && !NOISE.test(text)) out.push({ role: 'usuario', text, at });
    } else if (ev.type === 'assistant') {
      const text = textOf(ev.message.content).trim();
      if (text) out.push({ role: 'agente', text, at });
    }
  }
  return out;
}

export function sessionFile(cwd: string, id: string) {
  if (!SESSION_ID.test(id)) return null;
  for (const dir of projectDirs(cwd)) {
    const f = path.join(dir, `${id}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

/** Sessões da pasta, da mais recente para a mais antiga, com o primeiro pedido como título. */
export function listSessions(cwd: string, limit = 40): SessionInfo[] {
  const files = projectDirs(cwd).flatMap((dir) =>
    readdirSync(dir).filter((f) => f.endsWith('.jsonl') && SESSION_ID.test(f.slice(0, -6))).map((f) => path.join(dir, f)));
  return files
    .map((f) => ({ f, st: statSync(f) }))
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    .slice(0, limit)
    .map(({ f, st }) => {
      const head = parseLines(readSlice(f, 0, Math.min(st.size, 512 * 1024)));
      const first = head.find((l) => l.role === 'usuario');
      return {
        id: path.basename(f, '.jsonl'),
        title: (first?.text ?? '(sessão retomada de outra)').replace(/^#+\s*Demanda:\s*/, '').replace(/\s+/g, ' ').slice(0, 140),
        startedAt: head[0]?.at || st.birthtime.toISOString(),
        updatedAt: st.mtime.toISOString(),
        sizeMb: Math.round((st.size / 1048576) * 10) / 10,
      };
    });
}

/** O fim da conversa: as últimas falas, lidas só do final do arquivo (sessões longas passam de 100 MB). */
export function sessionTail(file: string, max = 60): SessionLine[] {
  const size = statSync(file).size;
  const bytes = Math.min(size, 4 * 1024 * 1024);
  let chunk = readSlice(file, size - bytes, bytes);
  if (bytes < size) chunk = chunk.slice(chunk.indexOf('\n') + 1);
  return parseLines(chunk).slice(-max).map((l) => ({ ...l, text: l.text.slice(0, 4000) }));
}
