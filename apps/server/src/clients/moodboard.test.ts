import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client, Office } from '@office/shared';
import { clientBoard, moodboardList, nicheBoard, nicheOf, themeFrom } from './moodboard.ts';

const root = mkdtempSync(path.join(tmpdir(), 'office-mood-'));
after(() => rmSync(root, { recursive: true, force: true }));
const office = { id: 'o', rootPath: root, extraDirs: [] } as unknown as Office;
const put = (rel: string, bytes = 40 * 1024) => { const f = path.join(root, ...rel.split('/')); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, Buffer.alloc(bytes)); return f; };
const client = (over: Partial<Client>) => ({ id: 'c', officeId: 'o', name: 'Cliente', folder: 'CLIENTES/X', color: '#ff5c8a', status: 'ativo', briefing: {}, ...over }) as Client;

put('REFERENCIAS/juridico/juridico-0001.jpg');
put('REFERENCIAS/juridico/juridico-0002.jpg');
writeFileSync(path.join(root, 'REFERENCIAS', 'indice.json'), JSON.stringify({ refs: [
  { id: 'juridico-0001', segmento: 'juridico', arquivo: 'juridico\\juridico-0001.jpg', tema: 'escuro', layout: 'retrato-palco', nota: null, paleta: ['#101418', '#c8a074', '#f4f1ec'], tags: ['criminal'], tamanho: [736, 920] },
  { id: 'juridico-0002', segmento: 'juridico', arquivo: 'juridico\\juridico-0002.jpg', tema: 'escuro', layout: 'frase-editorial', nota: 5, paleta: ['#101418', '#c8a074'], tags: [] },
  { id: 'fantasma', segmento: 'juridico', arquivo: 'juridico\\nao-existe.jpg', tema: 'claro', paleta: [], tags: [] },
  { id: 'fuga', segmento: 'juridico', arquivo: '..\\..\\segredo.jpg', tema: 'claro', paleta: [], tags: [] },
  { id: 'outro', segmento: 'imobiliario', arquivo: 'imobiliario\\nao-existe.jpg', paleta: [], tags: [] },
] }));
writeFileSync(path.join(root, 'segredo.jpg'), 'x');

test('nicho: mostra o que existe, a melhor nota primeiro, e não sai da pasta de referências', () => {
  const b = nicheBoard(office, 'juridico')!;
  assert.deepEqual(b.items.map((i) => i.id), ['juridico-0002', 'juridico-0001']);
  assert.ok(b.items[0].file.endsWith(path.join('REFERENCIAS', 'juridico', 'juridico-0002.jpg')));
  assert.equal(b.name, 'Jurídico');
  assert.equal(nicheBoard(office, 'imobiliario'), null);
});

test('o tema sai das referências, com fundo e destaque legíveis', () => {
  const t = themeFrom(['#101418', '#101418', '#c8a074', '#f4f1ec'], true, 'Playfair Display');
  assert.ok(t.bg.startsWith('#1'));
  assert.equal(t.fg, '#f6f2ec');
  assert.notEqual(t.accent, t.bg);
  assert.equal(themeFrom([], false, null).fg, '#1b1917');
});

test('cliente: pega qualquer pasta de referência, sem lixo de página salva, ícones nem o resto da pasta', () => {
  const good = put('CLIENTES/X/DOCUMENTOS/ARTES/REFERENCIAS - NICHO/ref1.jpg');
  const nested = put('CLIENTES/X/DOCUMENTOS/IDENTIDADE VISUAL/REFERENCIAS/perfil/post.png');
  put('CLIENTES/X/DOCUMENTOS/ARTES/REFERENCIAS - NICHO/pagina_files/lixo.jpg');
  put('CLIENTES/X/DOCUMENTOS/ARTES/REFERENCIAS - NICHO/icone.png', 2000);
  put('CLIENTES/X/DOCUMENTOS/ARTES/FEED/arte.png');
  put('CLIENTES/X/FOTOS/foto.jpg');
  put('CLIENTES/X/DOCUMENTOS/ARTES/TESTE ARTE-REFERENCIA/12a/12a.png');
  put('CLIENTES/X/DOCUMENTOS/ARTES/REFERENCIAS - NICHO/_trabalho/fundo.jpg');
  const b = clientBoard(office, client({ niche: 'juridico' }));
  assert.deepEqual(b.items.map((i) => i.file).sort(), [good, nested].sort());
  assert.equal(b.nicheItems.length, 2);
  assert.equal(b.items.find((i) => i.file === nested)!.group, 'perfil');
});

test('a marca do cliente veste o moodboard, e o nicho sai dela ou do nome', () => {
  const dir = 'CLIENTES/M/DOCUMENTOS/IDENTIDADE VISUAL';
  mkdirSync(path.join(root, ...dir.split('/')), { recursive: true });
  writeFileSync(path.join(root, ...dir.split('/'), 'marca.json'), JSON.stringify({ segmento: 'juridico', handle: '@m', cores: { escuro: '#1E140F', claro: '#F6F2ED', acento: '#C8A074' }, fontes: { titulo: 'Playfair Display', apoio: 'Proxima Nova' } }));
  const c = client({ id: 'm', folder: 'CLIENTES/M', name: 'Sem pista' });
  const b = clientBoard(office, c);
  assert.equal(b.theme.bg, '#1E140F');
  assert.equal(b.theme.titleFont, 'Playfair Display');
  assert.equal(b.niche, 'juridico');
  assert.equal(b.handle, '@m');
  assert.equal(nicheOf(office, client({ name: 'Gustavo Monteiro Advocacia', folder: null })), 'juridico');
  assert.equal(nicheOf(office, client({ name: 'Padaria', folder: null })), null);
  assert.equal(nicheOf(office, client({ name: 'Gustavo Advocacia', folder: null, niche: 'imobiliario' })), 'imobiliario');
});

test('a lista traz nichos e clientes com capas', () => {
  const r = moodboardList(office, [client({ niche: 'juridico' }), client({ id: 'fim', status: 'encerrado' })]);
  assert.equal(r.niches.find((n) => n.niche === 'juridico')!.count, 2);
  assert.equal(r.clients.length, 1);
  assert.ok(r.clients[0].covers.length >= 2);
});
