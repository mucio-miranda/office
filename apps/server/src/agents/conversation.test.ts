import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mentionedDirs } from './permissions.ts';
import { pickRunnable, queueRank, turnCost, type QueueEntry } from './queue.ts';
import { expandCommand, guessKind, listSkills, parseLearnings } from './skills.ts';

const job = (id: string, clientId: string | null, lane: QueueEntry['lane'] = null, rank = 4): QueueEntry => ({ id, clientId, lane, rank });

test('fila: um cliente por vez, um vídeo e um tunning por vez, e o limite vale', () => {
  assert.deepEqual(pickRunnable([job('a', 'x'), job('b', 'x'), job('c', 'y')], [], 4), ['a', 'c']);
  assert.deepEqual(pickRunnable([job('a', 'x')], [{ clientId: 'x', lane: null }], 4), []);
  assert.deepEqual(pickRunnable([job('a', 'x', 'video'), job('b', 'y', 'video'), job('c', 'z', 'navegador'), job('d', 'w', 'navegador')], [], 4), ['a', 'c']);
  assert.deepEqual(pickRunnable([job('a', 'x'), job('b', 'y')], [{ clientId: 'z', lane: null }], 2), ['a']);
  assert.deepEqual(pickRunnable([job('sem', null), job('sem2', null)], [], 4), ['sem', 'sem2'], 'sem cliente não disputa conversa');
});

test('fila: prioridade passa na frente, e resposta sua vem antes de tarefa nova da mesma prioridade', () => {
  const baixa = job('baixa', 'a', null, queueRank('baixa', false));
  const urgente = job('urgente', 'b', null, queueRank('urgente', false));
  const nova = job('nova', 'c', null, queueRank('media', false));
  const resposta = job('resposta', 'd', null, queueRank('media', true));
  assert.deepEqual(pickRunnable([baixa, nova, resposta, urgente], [], 3), ['urgente', 'resposta', 'nova']);
});

test('custo: numa sessão retomada conta só a rodada; total menor é sessão nova', () => {
  assert.equal(turnCost(0.25, 0), 0.25);
  assert.ok(Math.abs(turnCost(0.266, 0.25) - 0.016) < 1e-9);
  assert.equal(turnCost(0.1, 0.25), 0.1);
});

test('comando vira pedido da skill, com barra no fim ou argumentos; o resto passa igual', () => {
  const skills = ['start-conteudo', 'editar-video'];
  assert.equal(expandCommand('/start-conteudo/', skills), 'Use a skill `start-conteudo`.');
  assert.equal(expandCommand('/start-conteudo Sara novembro', skills), 'Use a skill `start-conteudo`.\n\nPedido: Sara novembro');
  assert.equal(expandCommand('/nao-existe x', skills), '/nao-existe x');
  assert.equal(expandCommand('mude apenas o 18', skills), 'mude apenas o 18');
});

test('lista as skills da pasta do escritório', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-skills-'));
  mkdirSync(path.join(dir, '.claude', 'skills', 'start-conteudo'), { recursive: true });
  mkdirSync(path.join(dir, '.claude', 'skills', 'sem-arquivo'), { recursive: true });
  writeFileSync(path.join(dir, '.claude', 'skills', 'start-conteudo', 'SKILL.md'), '---\nname: start-conteudo\ndescription: Dá o start\n---\ncorpo');
  assert.deepEqual(listSkills(dir), [{ name: 'start-conteudo', description: 'Dá o start' }]);
  assert.deepEqual(listSkills(path.join(dir, 'nao-existe')), []);
  rmSync(dir, { recursive: true, force: true });
});

test('tipo do pedido: capa de reels é arte, e reels sem capa é vídeo', () => {
  assert.equal(guessKind('faça a capa desse reels'), 'design');
  assert.equal(guessKind('edite esses vídeos'), 'video');
  assert.equal(guessKind('use a skill de remover papada'), 'foto');
  assert.equal(guessKind('escreva o roteiro'), 'copy');
  assert.equal(guessKind('qual o status?'), 'outro');
});

test('aprendizados: lê o bloco do fim da resposta, com ou sem negrito', () => {
  assert.deepEqual(parseLearnings('Pronto.\n\nAprendizados:\n- Indicador na direita quando a pessoa está centralizada\n- Fundo claro usa o estilo antigo'),
    ['Indicador na direita quando a pessoa está centralizada', 'Fundo claro usa o estilo antigo']);
  assert.deepEqual(parseLearnings('Fim.\n\n**Aprendizados:**\n1. Regra um aqui'), ['Regra um aqui']);
  assert.deepEqual(parseLearnings('Sem nada disso aqui, aprendizados não citados como bloco.'), []);
});

test('caminho citado: acha pasta com espaço, arquivo vira a pasta dele, e raiz de disco não vale', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-cartao-'));
  const pasta = path.join(dir, 'Videos Fernanda - 29.10');
  mkdirSync(pasta);
  const arquivo = path.join(pasta, 'roteiro.pdf');
  writeFileSync(arquivo, 'x');
  assert.deepEqual(mentionedDirs(`Edite esses vídeos, seguindo o padrão. "${pasta}"`), [pasta]);
  assert.deepEqual(mentionedDirs(`tem roteiro sim: ${arquivo}`), [pasta]);
  assert.deepEqual(mentionedDirs(`veja ${pasta} e me diga o que acha`), [pasta]);
  assert.deepEqual(mentionedDirs(`usa ${pasta.replaceAll(' ', '` ')}`), [pasta], 'cópia do PowerShell com crase');
  assert.deepEqual(mentionedDirs(`olha ${path.parse(dir).root}`), []);
  assert.deepEqual(mentionedDirs('nenhum caminho aqui'), []);
  rmSync(dir, { recursive: true, force: true });
});
