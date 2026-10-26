import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import type { RoomId } from '@office/shared';

export interface AgentTemplate {
  slug: string;
  name: string;
  role: string;
  room: RoomId;
  color: string;
  skills: string[];
  tools: string[];
  allowedTools: string[];
  mcp: string[];
  persona: string;
}

/** Frontmatter simples: `chave: valor`, listas em `[a, "b c"]`. Sem dependência de YAML. */
export function parseFrontmatter(src: string) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {} as Record<string, unknown>, body: src };
  const data: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const raw = kv[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      data[kv[1]] = [...raw.slice(1, -1).matchAll(/"([^"]*)"|'([^']*)'|([^,]+)/g)]
        .map((x) => (x[1] ?? x[2] ?? x[3]).trim())
        .filter(Boolean);
    } else {
      data[kv[1]] = raw.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: m[2].trim() };
}

export function loadTemplates(dir = config.agentTemplatesDir): AgentTemplate[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md')
    .map((f) => {
      const { data, body } = parseFrontmatter(readFileSync(path.join(dir, f), 'utf8'));
      return {
        slug: String(data.slug ?? path.basename(f, '.md')),
        name: String(data.name ?? data.slug),
        role: String(data.role ?? ''),
        room: (data.room ?? 'recepcao') as RoomId,
        color: String(data.color ?? '#888888'),
        skills: (data.skills as string[]) ?? [],
        tools: (data.tools as string[]) ?? [],
        allowedTools: (data.allowedTools as string[]) ?? ['Read', 'Glob', 'Grep'],
        mcp: (data.mcp as string[]) ?? [],
        persona: body,
      };
    });
}

export function houseRules(dir = config.agentTemplatesDir) {
  try {
    return readFileSync(path.join(dir, '_regras-da-casa.md'), 'utf8');
  } catch {
    return '';
  }
}
