import { existsSync } from 'node:fs';
import path from 'node:path';

/** Nunca liberado, mesmo que um modelo de funcionário peça. */
export const ALWAYS_DENIED = [
  'Bash(rm:*)', 'Bash(rmdir:*)', 'Bash(del:*)', 'Bash(rd:*)', 'Bash(format:*)', 'Bash(git push:*)',
  'Bash(mv:*)', 'Bash(move:*)', 'Bash(ren:*)',
  'PowerShell(Remove-Item:*)', 'PowerShell(Move-Item:*)', 'PowerShell(Rename-Item:*)', 'PowerShell(Clear-Content:*)',
  'mcp__claude_ai_Google_Drive__trash_file', 'mcp__claude_ai_Google_Drive__share_file',
  'mcp__claude_ai_Notion__notion-delete-pages', 'mcp__claude_ai_Notion__notion-delete-databases',
];

/** Caminho absoluto no formato das regras de permissão do Claude Code: C:\Pasta vira //c/Pasta. */
export function ruleRoot(dir: string) {
  const abs = path.resolve(dir).replaceAll('\\', '/');
  const drive = abs.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? `//${drive[1].toLowerCase()}/${drive[2]}` : `/${abs}`;
}

/**
 * As skills ficam na raiz do escritório, que o funcionário precisa enxergar, e valem para todos os clientes na hora.
 * Ele lê e usa, mas não altera: o que aprendeu vai no resumo da tarefa, e quem decide é o diretor de arte.
 */
export function deniedTools(rootPath: string) {
  const skills = `${ruleRoot(rootPath)}/.claude/skills/**`;
  return [...ALWAYS_DENIED, `Edit(${skills})`, `Write(${skills})`, `NotebookEdit(${skills})`];
}

/** Pastas extras que existem agora. Um HD desconectado não pode impedir o funcionário de começar. */
export function availableDirs(dirs: string[], exists: (p: string) => boolean = existsSync) {
  const ok = dirs.filter((d) => exists(d));
  return { ok, missing: dirs.filter((d) => !ok.includes(d)) };
}
