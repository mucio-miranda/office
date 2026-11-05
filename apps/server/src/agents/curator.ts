import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Learning, Office, SkillChange, SkillEdit } from '@office/shared';
import { uid } from '@office/shared';
import { config } from '../config.ts';
import { all, insert, logActivity, now, one, update } from '../db.ts';
import { broadcast } from '../realtime.ts';
import { insideDir } from '../clients/folder.ts';

/**
 * O único caminho para mudar as skills a partir do Office: aprendizado aprovado > curador (só lê) propõe a troca
 * exata > o dono vê o antes e depois e aplica > o Office grava e registra no git das skills. Os funcionários
 * nunca escrevem nas skills.
 */
const skillsDir = (office: Office) => path.join(office.rootPath, '.claude', 'skills');

function curatorPrompt(items: Learning[], names: (string | null)[]) {
  return `Você é o curador das skills da agência. Leia \`.claude/skills/README.md\` (onde salvar cada aprendizado e como) e as skills envolvidas, e proponha a menor mudança que guarda estes aprendizados aprovados para todos os clientes:

${items.map((l, i) => `${i + 1}. (${names[i] ?? 'sem cliente'}) ${l.text}`).join('\n')}

Regras:
- Você só lê. Não tente editar nada: quem aplica é o Office, depois que o dono aprovar.
- Regra geral vai para a skill certa; o que é de um cliente só vai para a pasta dele, não para a skill (nesse caso, diga isso no resumo e não proponha edição).
- Não repita o que a skill já diz. Escreva em português, no tom da skill.
- Cada edição troca um trecho que aparece exatamente uma vez no arquivo (copie-o exatamente, com quebras de linha). Para acrescentar no fim, use "trocar": "".

Termine com um bloco \`\`\`json no formato:
{"resumo": "o que muda e por quê, em uma frase", "edicoes": [{"arquivo": ".claude/skills/<skill>/SKILL.md", "trocar": "trecho exato atual", "por": "trecho novo"}]}`;
}

/** Lê o bloco JSON do fim da resposta e confere cada edição contra os arquivos reais. */
export function parseProposal(text: string, root: string): { summary: string; edits: SkillEdit[] } {
  const m = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].at(-1);
  if (!m) throw new Error('O curador não devolveu a proposta no formato combinado.');
  const raw = JSON.parse(m[1]);
  const dir = path.join(root, '.claude', 'skills');
  const edits: SkillEdit[] = [];
  for (const e of raw.edicoes ?? []) {
    const rel = String(e.arquivo ?? '').replaceAll('\\', '/').replace(/^\.claude\/skills\//, '');
    const abs = insideDir(dir, rel);
    if (!abs || !/\.md$/i.test(abs)) throw new Error(`Fora das skills ou não é .md: ${e.arquivo}`);
    if (!existsSync(abs)) throw new Error(`Arquivo não existe: ${rel}`);
    const find = String(e.trocar ?? '');
    const body = readFileSync(abs, 'utf8');
    if (find && body.split(find).length !== 2) throw new Error(`O trecho a trocar em ${rel} não aparece exatamente uma vez.`);
    edits.push({ file: rel, find, replace: String(e.por ?? '') });
  }
  return { summary: String(raw.resumo ?? '').slice(0, 400), edits };
}

/** Pede a proposta ao curador. Roda em segundo plano; a Mesa recebe o resultado. */
export function proposeSkillChange(office: Office, learningIds: string[], by: string): SkillChange | string {
  const items = learningIds.map((id) => one<Learning>("SELECT * FROM learnings WHERE id = ? AND office_id = ? AND status = 'aprovado'", id, office.id)).filter(Boolean) as Learning[];
  if (!items.length) return 'Escolha aprendizados já aprovados.';
  if (!existsSync(skillsDir(office))) return 'Este escritório não tem a pasta .claude/skills.';
  const names = items.map((l) => (l.clientId ? one<{ name: string }>('SELECT name FROM clients WHERE id = ?', l.clientId)?.name ?? null : null));
  const change: SkillChange = { id: uid(), officeId: office.id, learningIds: items.map((l) => l.id), status: 'gerando', summary: '', edits: [], error: null, commitRef: null, createdAt: now(), decidedBy: null };
  insert('skill_changes', change as never);
  const [bin, pre] = /\.m?js$/.test(config.claudeBin) ? [process.execPath, [config.claudeBin]] : [config.claudeBin, []];
  execFile(bin, [...pre, '-p', curatorPrompt(items, names), '--output-format', 'json', '--allowedTools', 'Read', 'Glob', 'Grep', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell'],
    { cwd: office.rootPath, windowsHide: true, maxBuffer: 20 * 1024 * 1024, timeout: 15 * 60_000 }, (err, stdout) => {
      try {
        if (err && !stdout) throw err;
        const out = JSON.parse(stdout);
        const p = parseProposal(String(out.result ?? ''), office.rootPath);
        update('skill_changes', change.id, { status: 'pronta', summary: p.summary, edits: p.edits });
      } catch (e) {
        update('skill_changes', change.id, { status: 'erro', error: (e as Error).message.slice(0, 400) });
      }
      broadcast(office.id, { t: 'notice', text: 'A proposta de mudança nas skills está na Mesa' });
    });
  logActivity(office.id, by, 'pediu proposta de mudança nas skills', items.map((l) => l.text).join(' | ').slice(0, 200));
  return change;
}

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { windowsHide: true, encoding: 'utf8', timeout: 60_000 });

/** Aplica a proposta aprovada: confere de novo cada trecho, grava e registra no git das skills (sem coautor). */
export function applySkillChange(office: Office, changeId: string, by: string) {
  const ch = one<SkillChange>("SELECT * FROM skill_changes WHERE id = ? AND office_id = ? AND status = 'pronta'", changeId, office.id);
  if (!ch) return 'Proposta não encontrada ou já decidida.';
  const dir = skillsDir(office);
  const next = new Map<string, string>();
  for (const e of ch.edits) {
    const abs = insideDir(dir, e.file);
    if (!abs || !existsSync(abs)) return `Arquivo sumiu: ${e.file}`;
    const body = next.get(abs) ?? readFileSync(abs, 'utf8');
    if (e.find && body.split(e.find).length !== 2) return `${e.file} mudou depois da proposta: peça uma nova.`;
    next.set(abs, e.find ? body.replace(e.find, e.replace) : `${body.replace(/\s*$/, '')}\n\n${e.replace.trim()}\n`);
  }
  for (const [abs, body] of next) writeFileSync(abs, body, 'utf8');
  let commitRef: string | null = null;
  if (next.size && existsSync(path.join(dir, '.git'))) {
    try {
      git(dir, 'add', '--', ...[...next.keys()].map((f) => path.relative(dir, f)));
      git(dir, 'commit', '-m', `Office: ${ch.summary || 'aprendizados aprovados'}`);
      commitRef = git(dir, 'rev-parse', '--short', 'HEAD').trim();
      if (git(dir, 'remote').trim()) git(dir, 'push');
    } catch (e) {
      commitRef = commitRef ?? `sem commit: ${(e as Error).message.split('\n')[0].slice(0, 160)}`;
    }
  }
  update('skill_changes', ch.id, { status: 'aplicada', commitRef, decidedBy: by });
  for (const id of ch.learningIds) update('learnings', id, { status: 'na-skill' });
  logActivity(office.id, by, 'aplicou mudança nas skills', ch.summary.slice(0, 200));
  return null;
}

export function rejectSkillChange(officeId: string, changeId: string, by: string) {
  if (!one("SELECT id FROM skill_changes WHERE id = ? AND office_id = ? AND status IN ('pronta','erro')", changeId, officeId)) return 'Proposta não encontrada ou já decidida.';
  update('skill_changes', changeId, { status: 'recusada', decidedBy: by });
  return null;
}

export const skillChanges = (officeId: string) =>
  all<SkillChange>("SELECT * FROM skill_changes WHERE office_id = ? AND (status IN ('gerando','pronta','erro') OR created_at >= date('now','-7 day')) ORDER BY created_at DESC LIMIT 20", officeId);

/** Retrato das skills antes da tarefa: se mudarem durante ela, alguém precisa conferir. */
export function skillsFingerprint(office: Office) {
  const dir = skillsDir(office);
  if (!existsSync(path.join(dir, '.git'))) return null;
  try { return `${git(dir, 'rev-parse', 'HEAD').trim()}\n${git(dir, 'status', '--porcelain')}`; } catch { return null; }
}
export function changedSkillFiles(before: string, after: string) {
  const files = (s: string) => new Set(s.split('\n').slice(1).filter(Boolean));
  const a = files(before);
  return [...files(after)].filter((f) => !a.has(f)).map((f) => f.slice(3));
}
