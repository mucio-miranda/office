import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { AgentJob, Office } from '@office/shared';
import { config } from '../config.ts';
import { all, one } from '../db.ts';
import { projectsRoot, SESSION_ID } from './sessions.ts';
import { enqueueJob } from './runtime.ts';
import { latestUsage, pct, usageBetween } from './usage.ts';

/**
 * Daily report: o que a equipe fez com os funcionários de IA no dia, no Office e no terminal (Warp, Claude Code puro).
 * O levantamento é feito aqui, por script e sem IA: pedidos digitados, a resposta final de cada um, arquivos mexidos,
 * custo e mudanças nas skills. A IA só organiza esse material curto em tópicos, então o resumo custa centavos.
 * Só lê: nenhuma sessão é alterada.
 */

export const DAILY_MARK = '# Daily report';
const NOISE = /^\s*(<(system-reminder|local-command|command-name|command-message|command-args|bash-|task-notification)|Caveat:|This session is being continued|\[Request interrupted|--resume)/;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
/** Teto do material enviado à IA (caracteres): um dia cheio cabe; acima disso os trechos encurtam. */
const BUDGET = 140_000;

export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayRange = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y, m - 1, d).getTime();
  return { start, end: start + 86_400_000 };
};
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

interface Turn { at: number; asked: string; answer: string; files: Set<string>; tools: number }
export interface SessionDigest { id: string; cwd: string; turns: Turn[]; first: number; last: number }

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text').map((b) => String(b.text ?? '')).join('\n');
};

/** Lê uma sessão do Claude Code e devolve só o que aconteceu no dia: pedido, resposta final, arquivos, nº de ações. */
export async function readSessionDay(file: string, day: string): Promise<SessionDigest | null> {
  const { start, end } = dayRange(day);
  // o arquivo guarda o horário em UTC: o dia local pode cair em duas datas UTC
  const keys = [new Date(start).toISOString().slice(0, 10), new Date(end - 1).toISOString().slice(0, 10)].map((d) => `"timestamp":"${d}`);
  const turns: Turn[] = [];
  let cwd = '';
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (raw.length > 400_000 || !keys.some((k) => raw.includes(k))) continue;
    let ev: any;
    try { ev = JSON.parse(raw); } catch { continue; }
    const at = Date.parse(ev.timestamp ?? '');
    if (!(at >= start && at < end) || ev.isMeta || ev.isCompactSummary || !ev.message) continue;
    if (ev.cwd) cwd = ev.cwd;
    const content = ev.message.content;
    if (ev.type === 'user') {
      const text = textOf(content).trim();
      if (text && !NOISE.test(text)) turns.push({ at, asked: text, answer: '', files: new Set(), tools: 0 });
    } else if (ev.type === 'assistant' && Array.isArray(content)) {
      const t = turns.at(-1);
      if (!t) continue;
      for (const b of content) {
        if (b?.type === 'text' && String(b.text ?? '').trim()) t.answer = String(b.text).trim();
        else if (b?.type === 'tool_use') {
          t.tools++;
          const f = b.input?.file_path ?? b.input?.notebook_path;
          if (WRITE_TOOLS.has(b.name) && f) t.files.add(String(f));
        }
      }
    }
  }
  if (!turns.length) return null;
  return { id: path.basename(file, '.jsonl'), cwd, turns, first: turns[0].at, last: turns.at(-1)!.at };
}

/** Todas as sessões do Claude Code desta máquina que tiveram conversa no dia. */
export async function sessionsOfDay(day: string, root = projectsRoot()) {
  const { start } = dayRange(day);
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = path.join(root, dir.name);
    for (const f of readdirSync(full)) {
      if (!f.endsWith('.jsonl') || !SESSION_ID.test(f.slice(0, -6))) continue;
      try { if (statSync(path.join(full, f)).mtimeMs >= start) files.push(path.join(full, f)); } catch { /* sumiu */ }
    }
  }
  const out: SessionDigest[] = [];
  for (const f of files) {
    const s = await readSessionDay(f, day).catch(() => null);
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.first - b.first);
}

/** Trecho citado (com > na frente, para um título dentro do pedido não virar seção do levantamento). */
const clip = (s: string, n: number) => {
  const one = s.replace(/\s+\n/g, '\n').trim();
  const cut = one.length > n ? `${one.slice(0, n)}… [+${one.length - n} caracteres]` : one;
  return cut.split('\n').map((l) => `> ${l}`).join('\n');
};

/** O material do dia, em Markdown curto, pronto para a IA organizar. Devolve null se não houve nada. */
export async function dailyDigest(office: Office, day: string, root = projectsRoot()) {
  const { start, end } = dayRange(day);
  const iso = (ms: number) => new Date(ms).toISOString();
  const jobs = all<AgentJob & { createdBy: string }>(
    'SELECT * FROM jobs WHERE office_id = ? AND updated_at >= ? AND created_at < ? ORDER BY created_at', office.id, iso(start), iso(end))
    .filter((j) => !j.prompt.startsWith(DAILY_MARK));
  const name = (table: string, id?: string | null) => (id ? one<{ name: string }>(`SELECT name FROM ${table} WHERE id = ?`, id)?.name : undefined);
  const bySession = new Map<string, (AgentJob & { createdBy: string })[]>();
  for (const j of jobs) if (j.sessionId) bySession.set(j.sessionId, [...(bySession.get(j.sessionId) ?? []), j]);
  const dailySessions = new Set(all<{ sessionId: string }>('SELECT session_id FROM jobs WHERE office_id = ? AND prompt LIKE ? AND session_id IS NOT NULL', office.id, `${DAILY_MARK}%`).map((r) => r.sessionId));
  const sessions = (await sessionsOfDay(day, root)).filter((s) => !dailySessions.has(s.id));
  if (!sessions.length && !jobs.length) return null;

  // quanto cabe por trecho: dia cheio encurta pedido e resposta
  const nTurns = sessions.reduce((n, s) => n + s.turns.length, 0) || 1;
  const per = Math.max(250, Math.min(1500, Math.floor(BUDGET / nTurns / 2)));

  const lines: string[] = [];
  lines.push(`Dia: ${day} · ${sessions.length} sessões do Claude Code nesta máquina · ${jobs.length} tarefas no Office`);
  // assinatura, não API: o que importa é o limite consumido, não o custo em dólar
  const reads = usageBetween(iso(start), iso(end));
  const last = reads.at(-1) ?? latestUsage();
  if (last) {
    const renova = last.sevenDayResets ? new Date(last.sevenDayResets).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?';
    const subiu = reads.length > 1 && reads[0].sevenDayResets === last.sevenDayResets ? ` (no começo do dia estava em ${pct(reads[0].sevenDay)})` : '';
    lines.push(`Limite semanal da assinatura do Claude: ${pct(last.sevenDay)} usado${subiu}, renova ${renova}. Janela de 5 h: ${pct(last.fiveHour)}.`);
  }

  if (jobs.length) {
    lines.push('', '## Tarefas do Office');
    for (const j of jobs) {
      lines.push(`- ${hhmm(Date.parse(j.createdAt))} · ${name('agents', j.agentId) ?? 'funcionário'} · ${name('clients', j.clientId) ?? 'sem cliente'} · ${j.status} · pedido por ${name('users', j.createdBy.replace(/^user:/, '')) ?? j.createdBy}`);
    }
  }

  for (const s of sessions) {
    const linked = bySession.get(s.id);
    const origin = linked ? `Office (${[...new Set(linked.map((j) => name('clients', j.clientId) ?? 'sem cliente'))].join(', ')})` : 'terminal (Warp/Claude Code)';
    lines.push('', `## Sessão ${s.id.slice(0, 8)} · ${origin} · pasta ${s.cwd || '?'} · ${hhmm(s.first)}–${hhmm(s.last)}`);
    for (const t of s.turns) {
      lines.push(`### ${hhmm(t.at)} pedido`, clip(t.asked, per));
      if (t.answer) lines.push(`**resposta final** (${t.tools} ações):`, clip(t.answer, per));
      else if (t.tools) lines.push(`(${t.tools} ações, sem resposta em texto)`);
      if (t.files.size) lines.push(`arquivos mexidos: ${[...t.files].slice(0, 12).join(' · ')}${t.files.size > 12 ? ` (+${t.files.size - 12})` : ''}`);
    }
  }

  // mudanças nas skills (regras da casa) no dia
  const skills = path.join(office.rootPath, '.claude', 'skills');
  if (existsSync(path.join(skills, '.git'))) {
    try {
      const log = execFileSync('git', ['-C', skills, 'log', `--since=${iso(start)}`, `--until=${iso(end)}`, '--format=%h %s'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).trim();
      if (log) lines.push('', '## Mudanças nas skills', ...log.split('\n').map((l) => `- ${l}`));
    } catch { /* sem git */ }
  }
  return lines.join('\n');
}

/** Onde o relatório fica: no Drive da agência quando existe, senão na pasta de dados do Office. */
export function dailyDir(office: Office) {
  const drive = office.driveRoot && path.join(office.driveRoot, 'AGENCIA', '_SISTEMA');
  const dir = drive && existsSync(drive) ? path.join(drive, 'DAILY') : path.join(config.dataDir, 'daily');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dailyPrompt(day: string, digest: string, file: string) {
  const [y, m, d] = day.split('-');
  return `${DAILY_MARK} ${day}

Monte o daily report de ${d}/${m}/${y}: o que a equipe fez com os funcionários de IA hoje, no Office e no terminal.
O levantamento abaixo foi feito por script (pedidos, resposta final de cada um, arquivos mexidos, limite consumido). Não abra as
sessões nem varra pastas: trabalhe só com este material. Se algo estiver cortado, resuma pelo que há.

Formato: mensagem pronta para colar no WhatsApp (texto puro, em português, direto). Siga este modelo:

*📋 Daily · DD/MM*

*Nome do cliente*
✅ o que foi concluído ou entregue
🚫 o que está bloqueado e o motivo (só se houver)

*Agência / Office*
✅ …

*📌 Amanhã*
• próxima ação, uma por linha

📊 Limite semanal do Claude: X% (renova DIA HH:MM)

Regras do formato:
- Um bloco por cliente ou projeto, com o nome em *negrito de WhatsApp* (um asterisco de cada lado). Trabalho da agência e do
  Office/sistema em blocos próprios; atividade de fora da agência num bloco *Outros*.
- Uma linha por item, curta (até uns 90 caracteres), começando pelo emoji. Ordem dentro do bloco: ✅, depois 🚫.
- Sem itens pendentes nos blocos: o que ainda falta fazer ou aprovar vai só no *📌 Amanhã*. Cliente sem nada concluído
  nem bloqueado no dia fica de fora.
- O emoji diz a situação de agora, no fim do dia: o que já foi resolvido é ✅ (mesmo que tenha dado problema no caminho);
  🚫 só para o que segue travado e não anda sem outra pessoa ou recurso.
- Sem títulos com #, sem tabelas, sem **, sem links em Markdown e sem caminho completo de pasta: cite só o nome da peça.
- Agrupe pedidos repetidos e correções do mesmo trabalho num item só. Não invente o que não está no levantamento.
- A equipe usa a assinatura do Claude, não a API: nunca fale em custo nem em dólar. Se o levantamento não trouxer o limite,
  tire a linha do 📊.
- Nada antes nem depois da mensagem: a resposta inteira é o texto para colar.

Grave a mensagem em \`${file}\` (Write) e responda com o mesmo texto.

---

${digest}`;
}

/** Funcionário que faz o daily: o gerente (Rafa); sem ele, o primeiro do escritório. */
const dailyAgent = (officeId: string) =>
  one<{ id: string }>("SELECT id FROM agents WHERE office_id = ? AND slug = 'gerente'", officeId)
  ?? one<{ id: string }>('SELECT id FROM agents WHERE office_id = ? ORDER BY rowid LIMIT 1', officeId);

/** Pede o daily do dia. Devolve a tarefa (a que já está rodando para o mesmo dia, se houver). */
export async function startDaily(office: Office, day: string, by: string) {
  const busy = one<AgentJob>("SELECT * FROM jobs WHERE office_id = ? AND prompt LIKE ? AND status IN ('fila','rodando')", office.id, `${DAILY_MARK} ${day}%`);
  if (busy) return busy;
  const agent = dailyAgent(office.id);
  if (!agent) throw new Error('Nenhum funcionário neste escritório.');
  const digest = await dailyDigest(office, day);
  if (!digest) throw new Error('Nada registrado nesse dia, nem no Office nem no terminal desta máquina.');
  const file = path.join(dailyDir(office), `${day}.txt`);
  const [y, m, d] = day.split('-');
  return enqueueJob({
    officeId: office.id, agentId: agent.id, demandId: null, clientId: null, workerId: null, cwd: office.rootPath,
    prompt: dailyPrompt(day, digest, file), display: `Daily report de ${d}/${m}/${y}`, createdBy: by,
    // juntar o dia em formato de WhatsApp é resumo: o Haiku dá conta
    model: process.env.OFFICE_DAILY_MODEL || 'haiku',
  });
}

/** Todo dia, a partir das 19h (OFFICE_DAILY_HOUR), sai o daily de quem trabalhou. OFFICE_DAILY=0 desliga. */
const tried = new Set<string>();
export async function dailyTick() {
  if (process.env.OFFICE_DAILY === '0') return;
  if (new Date().getHours() < Number(process.env.OFFICE_DAILY_HOUR ?? 19)) return;
  const day = localDay();
  for (const office of all<Office>('SELECT * FROM offices')) {
    const key = `${office.id}:${day}`;
    if (tried.has(key)) continue;
    tried.add(key);
    if (one('SELECT id FROM jobs WHERE office_id = ? AND prompt LIKE ?', office.id, `${DAILY_MARK} ${day}%`)) continue;
    const owner = one<{ userId: string }>("SELECT user_id FROM office_members WHERE office_id = ? AND role = 'dono' LIMIT 1", office.id);
    if (!owner) continue;
    await startDaily(office, day, `user:${owner.userId}`).catch(() => { /* dia sem nada */ });
  }
}
