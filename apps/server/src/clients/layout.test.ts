import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientPaths, isNewLayout } from './layout.ts';
import { ensureStructure } from './folder.ts';
import { driveSubdir } from './drive.ts';

test('pasta antiga continua no padrão DOCUMENTOS/FOTOS/VIDEOS', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cli-'));
  mkdirSync(path.join(dir, 'DOCUMENTOS', 'IDENTIDADE VISUAL'), { recursive: true });
  const p = clientPaths(dir);
  assert.equal(p.estrutura, 'antigo');
  assert.equal(p.marca, path.join(dir, 'DOCUMENTOS', 'IDENTIDADE VISUAL', 'marca.json'));
  assert.equal(p.rel('videos_brutos', { captacao: 'VISITA 1' }), 'VIDEOS/BRUTOS/VISITA 1');
});

test('pasta nova: IDV em ARQUIVOS, mês com o nome do marca.json e brutos por captação', () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'cli-')), 'MARIA EXEMPLO');
  mkdirSync(path.join(dir, 'REDES SOCIAIS'), { recursive: true });
  mkdirSync(path.join(dir, 'ARQUIVOS – MARIA EXEMPLO', 'DOCUMENTOS', 'IDENTIDADE VISUAL'), { recursive: true });
  writeFileSync(path.join(dir, 'ARQUIVOS – MARIA EXEMPLO', 'DOCUMENTOS', 'IDENTIDADE VISUAL', 'marca.json'), '{"nome":"Maria Exemplo"}');
  const p = clientPaths(dir);
  assert.equal(p.estrutura, 'novo');
  assert.equal(p.rel('mes', { mes: '2026-11' }), 'REDES SOCIAIS/2026-11 Novembro – Maria Exemplo');
  assert.equal(p.rel('fotos_editadas', { mes: '2026-10' }), 'REDES SOCIAIS/2026-10 Outubro – Maria Exemplo/ENSAIOS – Outubro/Fotos Editadas – Outubro');
  assert.equal(p.rel('videos_brutos', { captacao: '2026-11-08 Gravação' }), 'ARQUIVOS – MARIA EXEMPLO/BRUTOS/2026-11-08 Gravação/VIDEOS BRUTOS');
  assert.ok(p.marca.endsWith(path.join('ARQUIVOS – MARIA EXEMPLO', 'DOCUMENTOS', 'IDENTIDADE VISUAL', 'marca.json')));
});

test('cliente novo (pasta vazia) nasce na estrutura nova; pasta antiga não ganha a nova', () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'cli-')), 'CLINICA TESTE');
  mkdirSync(dir);
  const created = ensureStructure(dir);
  assert.ok(isNewLayout(dir));
  assert.ok(created.includes('ARQUIVOS – CLINICA TESTE/TRABALHOS'));
  const velha = mkdtempSync(path.join(tmpdir(), 'cli-'));
  mkdirSync(path.join(velha, 'FOTOS'));
  ensureStructure(velha);
  assert.equal(isNewLayout(velha), false);
});

test('envio ao Drive na estrutura nova: arte vai para o mês, PSD para PROJETOS', () => {
  const drive = path.join(mkdtempSync(path.join(tmpdir(), 'drv-')), 'BURGER EXEMPLO');
  mkdirSync(path.join(drive, 'REDES SOCIAIS'), { recursive: true });
  const mes = clientPaths(drive).rel('mes');
  assert.equal(driveSubdir(null, 'C:/tmp/arte.png', drive), mes);
  assert.equal(driveSubdir(null, 'C:/tmp/arte.psd', drive), 'ARQUIVOS – BURGER EXEMPLO/PROJETOS');
  assert.equal(driveSubdir(null, 'C:/tmp/arte.png', null), 'DOCUMENTOS/ARTES');
});
