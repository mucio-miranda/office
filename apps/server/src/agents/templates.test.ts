import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplates, parseFrontmatter } from './templates.ts';

test('listas do modelo: as aspas não fazem parte do valor', () => {
  const { data } = parseFrontmatter('---\nallowedTools: [Read, "Bash(python:*)", \'PowerShell(py:*)\', mcp__x]\n---\ncorpo');
  assert.deepEqual(data.allowedTools, ['Read', 'Bash(python:*)', 'PowerShell(py:*)', 'mcp__x']);
});

test('os funcionários têm as permissões do método da casa', () => {
  const by = new Map(loadTemplates().map((t) => [t.slug, t]));
  for (const t of by.values()) for (const tool of t.allowedTools) assert.ok(!/^["']|["']$/.test(tool), tool);
  const duda = by.get('designer')!;
  for (const tool of ['PowerShell(python:*)', 'Bash(python:*)', 'mcp__claude-in-chrome']) assert.ok(duda.allowedTools.includes(tool), tool);
  assert.ok(duda.skills.includes('arte-referencia'));
  const vic = by.get('editor-de-video')!;
  for (const tool of ['PowerShell(ffmpeg:*)', 'PowerShell(python:*)']) assert.ok(vic.allowedTools.includes(tool), tool);
});
