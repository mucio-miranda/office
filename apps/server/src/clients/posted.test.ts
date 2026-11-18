import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postedName, postedPlan } from './month.ts';

test('postado: nome no padrão do squad, data quando faltava, reels e nome solto', () => {
  assert.equal(postedName('X/01 2026-11-20 Carrossel – Férias – 02.png', '2026-11-21'), '01_postado 2026-11-20 Carrossel – Férias – 02.png');
  assert.equal(postedName('X/03 Estático – Influenciador.png', '2026-11-21'), '03_postado 2026-11-21 Estático – Influenciador.png');
  assert.equal(postedName('X/02 sem data Carrossel – Tema – 01.png', '2026-11-21'), '02_postado 2026-11-21 Carrossel – Tema – 01.png');
  assert.equal(postedName('X/Reels – Bastidor – capa.jpg', '2026-11-21'), 'Reels – postado 2026-11-21 – Bastidor – capa.jpg');
  assert.equal(postedName('X/04_postado 2026-11-02 Estático – Já foi.png', '2026-11-21'), '04_postado 2026-11-02 Estático – Já foi.png');
  assert.equal(postedName('X/arte final solta.png', '2026-11-21'), 'arte final solta.png');
});

test('postado: vai para POSTADOS da mesma pasta, pula o que já está lá e nunca sobrescreve', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'postado-'));
  const videos = path.join(dir, 'VÍDEOS – Novembro');
  mkdirSync(path.join(dir, 'POSTADOS'), { recursive: true });
  mkdirSync(videos, { recursive: true });
  const a = path.join(dir, '01 Carrossel – Férias – 01.png');
  const b = path.join(dir, '01 Carrossel – Férias – 02.png');
  const v = path.join(videos, 'Reels – Bastidor.mp4');
  const ja = path.join(dir, 'POSTADOS', '02_postado 2026-11-03 Estático – Antigo.png');
  const ocupado = path.join(dir, '05 Estático – Repetido.png');
  for (const f of [a, b, v, ja, ocupado]) writeFileSync(f, 'x');
  writeFileSync(path.join(dir, 'POSTADOS', '05_postado 2026-11-21 Estático – Repetido.png'), 'outro');

  const { plan, skipped } = postedPlan([a, b, v, ja, ocupado], '2026-11-21');
  assert.deepEqual(plan.map((r) => path.relative(dir, r.to)), [
    path.join('POSTADOS', '01_postado 2026-11-21 Carrossel – Férias – 01.png'),
    path.join('POSTADOS', '01_postado 2026-11-21 Carrossel – Férias – 02.png'),
    path.join('VÍDEOS – Novembro', 'POSTADOS', 'Reels – postado 2026-11-21 – Bastidor.mp4'),
  ]);
  assert.equal(skipped.length, 1, 'o nome já ocupado em POSTADOS fica de fora');
  assert.ok(existsSync(ocupado));
});
