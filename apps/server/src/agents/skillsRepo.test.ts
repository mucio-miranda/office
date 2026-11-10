import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanRemote, importSkills, setRemote, skillsState, startHistory } from './skillsRepo.ts';

const skill = (dir: string, name: string, body = `---\nname: ${name}\ndescription: x\n---\n`) => {
  mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(path.join(dir, name, 'SKILL.md'), body);
};

test('setup das skills: histórico ligado, importação sem sobrescrever e cópia remota sem credencial', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'office-skills-repo-'));
  const office = { rootPath: path.join(base, 'AGENCIA') };
  mkdirSync(office.rootPath);

  assert.equal(skillsState(office).exists, false);
  assert.ok(startHistory(office), 'primeiro registro');
  let st = skillsState(office);
  assert.equal(st.history, true);
  assert.match(st.last!.subject, /começo do histórico/);

  // outra pasta com skills: uma nova e uma com o mesmo nome de uma que já existe aqui
  const dir = path.join(office.rootPath, '.claude', 'skills');
  skill(dir, 'arte', 'a nossa');
  const other = path.join(base, 'OUTRA', '.claude', 'skills');
  skill(other, 'arte', 'a de fora');
  skill(other, 'video');
  mkdirSync(path.join(other, '.git'));
  writeFileSync(path.join(other, '.git', 'config'), 'x');
  const r = importSkills(office, path.join(base, 'OUTRA'));
  assert.deepEqual([r.copied, r.skipped], [['video'], ['arte']]);
  assert.equal(readFileSync(path.join(dir, 'arte', 'SKILL.md'), 'utf8'), 'a nossa', 'não sobrescreve');
  assert.ok(!existsSync(path.join(dir, 'video', '.git')));
  st = skillsState(office);
  assert.deepEqual(st.skills.sort(), ['arte', 'video']);
  assert.match(st.last!.subject, /importada/);
  assert.throws(() => importSkills(office, path.join(base, 'NADA')), /não existe/);

  // cópia remota: token na URL é recusado
  assert.throws(() => cleanRemote('https://usuario:ghp_abc@github.com/agencia/skills.git'), /token/);
  assert.throws(() => cleanRemote('http://github.com/agencia/skills.git'), /https/);
  assert.equal(cleanRemote('git@github.com:agencia/skills.git'), 'git@github.com:agencia/skills.git');
  setRemote(office, 'https://github.com/agencia/skills.git');
  assert.equal(skillsState(office).remote, 'https://github.com/agencia/skills.git');
  setRemote(office, null);
  assert.equal(skillsState(office).remote, null);
  rmSync(base, { recursive: true, force: true });
});
