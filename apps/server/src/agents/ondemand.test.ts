import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onDemandFor } from './ondemand.ts';

const installed = { rea: { type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', 'rea-agents@latest', 'mcp'] } };

test('liga o REA só quando o pedido cita', () => {
  assert.deepEqual(onDemandFor('usa o REA para analisar esse app', installed).map((d) => d.id), ['rea']);
  assert.deepEqual(onDemandFor('faz uma engenharia reversa desse site', installed).map((d) => d.id), ['rea']);
  assert.equal(onDemandFor('faz o carrossel da Black Friday', installed).length, 0);
});

test('não confunde com pedaço de palavra', () => {
  assert.equal(onDemandFor('qual a área de atuação dela?', installed).length, 0);
  assert.equal(onDemandFor('a reação do público foi boa', installed).length, 0);
  assert.equal(onDemandFor('real e área', installed).length, 0);
});

test('não liga o que não está instalado na máquina', () => {
  assert.equal(onDemandFor('usa o rea', {}).length, 0);
});

test('a dica vai junto', () => {
  const [d] = onDemandFor('rea', installed);
  assert.match(d.hint, /REA/);
  assert.deepEqual(d.server, installed.rea);
});
