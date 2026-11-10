import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectDirs, rootProblem } from './officeSetup.ts';

test('raiz do escritório: recusa a pasta das skills e acha o Drive pelos atalhos e pelo settings.json', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'office-setup-'));
  const root = path.join(base, 'AGENCIA');
  const skills = path.join(root, '.claude', 'skills');
  for (const s of ['arte', 'video']) { mkdirSync(path.join(skills, s), { recursive: true }); writeFileSync(path.join(skills, s, 'SKILL.md'), 'x'); }
  writeFileSync(path.join(root, 'CLAUDE.md'), '# agência');

  assert.match(rootProblem(skills)!, /pasta das skills/);
  assert.match(rootProblem(path.join(root, '.claude'))!, /pasta das skills/);
  assert.equal(rootProblem(root), null);
  // uma cópia solta das skills, sem CLAUDE.md, também não é raiz
  const loose = path.join(base, 'COPIA');
  for (const s of ['arte', 'video']) { mkdirSync(path.join(loose, s), { recursive: true }); writeFileSync(path.join(loose, s, 'SKILL.md'), 'x'); }
  assert.match(rootProblem(loose)!, /pasta das skills/);

  // material no "Drive", com atalhos no caminho antigo (junction, que não pede permissão especial no Windows)
  const drive = path.join(base, 'Meu Drive', 'AGENCIA');
  mkdirSync(path.join(drive, 'CLIENTES', 'SAUDE', 'CLIENTE A'), { recursive: true });
  mkdirSync(path.join(drive, 'MARCA'), { recursive: true });
  mkdirSync(path.join(root, 'CLIENTES'), { recursive: true });
  symlinkSync(path.join(drive, 'CLIENTES', 'SAUDE', 'CLIENTE A'), path.join(root, 'CLIENTES', 'CLIENTE A'), 'junction');
  symlinkSync(path.join(drive, 'MARCA'), path.join(root, 'MARCA'), 'junction');
  const temp = path.join(base, 'TEMP');
  mkdirSync(temp);
  writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { AGENCIA_TEMP: temp, NADA: 'C:\\nao-existe-123', TEXTO: 'oi' } }));

  const d = detectDirs(root);
  assert.deepEqual(d.extraDirs.map((p) => p.toLowerCase()), [drive, temp].map((p) => path.resolve(p).toLowerCase()));
  assert.equal(d.driveRoot?.toLowerCase(), path.resolve(drive).toLowerCase(), 'ancestral comum dos atalhos, com "Drive" no caminho');
  rmSync(base, { recursive: true, force: true });
});
