import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './templates.ts';

/** Skills do escritório, que na conversa do cliente viram comandos: `/start-conteudo Sara novembro`. */
export function listSkills(rootPath: string) {
  const dir = path.join(rootPath, '.claude', 'skills');
  if (!existsSync(dir)) return [];
  const out: { name: string; description: string }[] = [];
  for (const e of readdirSync(dir)) {
    const file = path.join(dir, e, 'SKILL.md');
    if (!existsSync(file)) continue;
    try {
      const { data } = parseFrontmatter(readFileSync(file, 'utf8'));
      out.push({ name: String(data.name ?? e), description: String(data.description ?? '').slice(0, 180) });
    } catch { /* skill com arquivo ilegível fica de fora da lista */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** `/skill argumentos` vira um pedido claro para usar a skill. O resto passa como foi escrito. */
export function expandCommand(text: string, skills: string[]) {
  const m = text.trim().match(/^\/([\w-]+)\/?(?:\s+([\s\S]*))?$/);
  if (!m || !skills.includes(m[1])) return text;
  return `Use a skill \`${m[1]}\`.${m[2]?.trim() ? `\n\nPedido: ${m[2].trim()}` : ''}`;
}

/** Tipo do pedido escrito na conversa: só define o rótulo e quem atende, porque todos têm as mesmas skills. */
export function guessKind(text: string) {
  if (/capa|arte|carross|mosaico|\bfeed\b|est[aá]tic|conte[uú]do|\bpost/i.test(text)) return 'design';
  if (/v[ií]deo|reels?\b|stor(y|ies)|brutos?\b|legendas? no/i.test(text)) return 'video';
  if (/foto|ensaio|retoque|retrato|papada/i.test(text)) return 'foto';
  if (/roteiro|legenda|copy|pauta|texto/i.test(text)) return 'copy';
  return 'outro';
}

const LEARNINGS = /(?:^|\n)[#*\s]*Aprendizados[*\s]*:?[*\s]*\n?([\s\S]*)$/i;

/** O bloco `Aprendizados:` que o funcionário escreve no fim da resposta, um item por linha. */
export function parseLearnings(text: string) {
  const block = text.match(LEARNINGS)?.[1];
  if (!block) return [];
  return block.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.length > 3).slice(0, 10).map((l) => l.slice(0, 1000));
}
