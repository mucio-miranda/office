import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

const dataDir = mkdtempSync(path.join(tmpdir(), 'office-cerebro-'));
process.env.OFFICE_DATA = dataDir;
const { api } = await import('./api.ts');
const { db } = await import('../db.ts');
const { parseNote, setFrontmatter } = await import('../cerebro/vault.ts');

const vault = path.join(dataDir, 'CEREBRO');
let app: FastifyInstance;
let owner: string, member: string, O: string;
const call = async (method: string, url: string, token?: string, body?: unknown, remote = '127.0.0.1') => {
  const res = await app.inject({ method: method as 'GET', url, remoteAddress: remote, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: res.statusCode, json: res.body && res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : {}, raw: res };
};

before(async () => {
  mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
  mkdirSync(path.join(vault, 'Ideias da DM'));
  mkdirSync(path.join(vault, '_anexos', 'dm'), { recursive: true });
  writeFileSync(path.join(vault, '.obsidian', 'graph.json'), JSON.stringify({ colorGroups: [{ query: 'path:"Ideias da DM"', color: { a: 1, rgb: 16711680 } }] }));
  writeFileSync(path.join(vault, '_anexos', 'dm', '001_0.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writeFileSync(path.join(vault, 'DM · Ferramentas.md'), '# Ferramentas\n\n- [[001 · repo bom]]\n');
  writeFileSync(path.join(vault, 'Ideias da DM', '001 · repo bom.md'),
    '---\ntipo: ideia-dm\ncategoria: IA\nstatus: revisada\ndestino: ferramenta\n---\n# Repo bom\n\n![[001_0.jpg|320]]\n\n**Categoria:** [[DM · Ferramentas]]\n\n> legenda do post https://github.com/x/y\n\n## Como usar\n- Testar no Office.\n- Ver licença.\n');
  writeFileSync(path.join(vault, 'Ideias da DM', '002 · post.md'), '---\nstatus: nova\n---\n# post\n\n## Como usar\n- \n');
  app = Fastify();
  await app.register(api);
  owner = (await call('POST', '/api/auth/enter', undefined, { name: 'Dona', pin: 'senha-forte-1' })).json.token;
  const o = (await call('POST', '/api/offices', owner, { name: 'REZZU', rootPath: dataDir })).json;
  O = `/api/offices/${o.id}`;
  member = (await call('POST', '/api/auth/enter', undefined, { name: 'Convidada', pin: 'senha-forte-1', invite: o.inviteCode })).json.token;
});
after(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('nota: frontmatter, título, como usar, links e anexos', () => {
  const n = parseNote(readFileSync(path.join(vault, 'Ideias da DM', '001 · repo bom.md'), 'utf8'));
  assert.equal(n.title, 'Repo bom');
  assert.equal(n.fm.status, 'revisada');
  assert.deepEqual(n.comoUsar, ['Testar no Office.', 'Ver licença.']);
  assert.deepEqual(n.links, ['DM · Ferramentas']);
  assert.deepEqual(n.embeds, ['001_0.jpg']);
  assert.equal(n.url, 'https://github.com/x/y');
  assert.deepEqual(parseNote('---\nstatus: nova\n---\n# x\n\n## Como usar\n- \n').comoUsar, []);
});

test('frontmatter: troca só as chaves pedidas e preserva o resto', () => {
  const t = '---\ntipo: ideia\nstatus: nova\n---\n# Título\ncorpo\n';
  assert.equal(setFrontmatter(t, { status: 'aprovada', destino: 'pauta' }), '---\ntipo: ideia\nstatus: aprovada\ndestino: pauta\n---\n# Título\ncorpo\n');
  assert.equal(setFrontmatter('# sem\n', { status: 'adiada' }), '---\nstatus: adiada\n---\n# sem\n');
  assert.equal(setFrontmatter('---\r\na: 1\r\n---\r\nx', { a: '2' }), '---\r\na: 2\r\n---\r\nx');
});

test('ligar pasta: só no computador do Office e só pasta com notas', async () => {
  assert.equal((await call('POST', `${O}/cerebros`, owner, { path: vault }, '192.168.0.9')).status, 403);
  assert.equal((await call('POST', `${O}/cerebros`, owner, { path: path.join(vault, '_anexos') })).status, 400);
  const c = (await call('POST', `${O}/cerebros`, owner, { path: vault })).json;
  assert.equal(c.name, 'CEREBRO');
  assert.equal((await call('POST', `${O}/cerebros`, owner, { path: vault })).json.id, c.id, 'a mesma pasta não duplica');
  assert.equal((await call('GET', `${O}/cerebros`, member)).json.length, 1);
});

test('índice, nota, imagem e triagem gravada no frontmatter', async () => {
  const c = (await call('GET', `${O}/cerebros`, owner)).json[0];
  const B = `${O}/cerebros/${c.id}`;
  const idx = (await call('GET', `${B}/indice`, owner)).json;
  const repo = idx.notes.find((n: any) => n.id === 'Ideias da DM/001 · repo bom.md');
  assert.equal(repo.cover, '_anexos/dm/001_0.jpg');
  assert.deepEqual(repo.links, ['DM · Ferramentas.md']);
  assert.equal(repo.group, 0);
  assert.equal(idx.groups[0].color, '#ff0000');
  const nota = (await call('GET', `${B}/nota?id=${encodeURIComponent('DM · Ferramentas.md')}`, owner)).json;
  assert.deepEqual(nota.backlinks.map((b: any) => b.id), ['Ideias da DM/001 · repo bom.md']);
  assert.equal((await call('GET', `${B}/arquivo?p=${encodeURIComponent('_anexos/dm/001_0.jpg')}`, owner)).status, 200);
  assert.equal((await call('GET', `${B}/arquivo?p=${encodeURIComponent('../../x.jpg')}`, owner)).status, 404, 'não sai da pasta');
  assert.equal((await call('GET', `${B}/nota?id=${encodeURIComponent('../segredo.md')}`, owner)).status, 404);
  assert.equal((await call('POST', `${B}/decidir`, owner, { ids: [repo.id], status: 'apagar' })).status, 400);
  const r = (await call('POST', `${B}/decidir`, owner, { ids: [repo.id, 'Ideias da DM/002 · post.md'], status: 'aprovada', destino: 'pauta' })).json;
  assert.equal(r.notes[0].fm.status, 'aprovada');
  const text = readFileSync(path.join(vault, 'Ideias da DM', '001 · repo bom.md'), 'utf8');
  assert.match(text, /^---\ntipo: ideia-dm\ncategoria: IA\nstatus: aprovada\ndestino: pauta\ndecidido: \d{4}-\d{2}-\d{2}\n---\n# Repo bom/);
  assert.match(text, /- Ver licença\.\n$/, 'o corpo fica igual');
  // remover: vai para _apagados (com a capa, que só ela usa), some do índice e o desfazer devolve
  writeFileSync(path.join(vault, '_anexos', 'dm', '001_1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writeFileSync(path.join(vault, 'Ideias da DM', '001 · repo bom.md'), readFileSync(path.join(vault, 'Ideias da DM', '001 · repo bom.md'), 'utf8') + '\n## Lâminas\n![[001_1.jpg|200]]\n');
  const again = (await call('GET', `${B}/indice`, owner)).json.notes.find((n: any) => n.id === repo.id);
  assert.deepEqual(again.slides, ['_anexos/dm/001_0.jpg', '_anexos/dm/001_1.jpg']);
  assert.equal((await call('POST', `${B}/remover`, member, { ids: ['../fora.md'] })).status, 400);
  const rm = (await call('POST', `${B}/remover`, owner, { ids: [repo.id] })).json;
  assert.deepEqual(rm.moved.map((m: any) => m.to), ['_apagados/Ideias da DM/001 · repo bom.md', '_apagados/_anexos/dm/001_0.jpg']);
  assert.ok(existsSync(path.join(vault, '_apagados', 'Ideias da DM', '001 · repo bom.md')));
  assert.ok(!(await call('GET', `${B}/indice`, owner)).json.notes.some((n: any) => n.id.includes('001 ·')), 'some do índice, inclusive do _apagados');
  assert.equal((await call('POST', `${B}/restaurar`, owner, { moved: rm.moved })).status, 200);
  assert.ok(existsSync(path.join(vault, 'Ideias da DM', '001 · repo bom.md')) && existsSync(path.join(vault, '_anexos', 'dm', '001_0.jpg')));
  assert.equal((await call('POST', `${B}/restaurar`, owner, { moved: [{ from: '../../fora.md', to: '_apagados/x.md' }] })).status, 200, 'restaurar ignora caminho de fora');
  assert.equal((await call('DELETE', B, owner)).status, 200);
  assert.ok(readFileSync(path.join(vault, 'DM · Ferramentas.md'), 'utf8'), 'desligar não mexe na pasta');
});
