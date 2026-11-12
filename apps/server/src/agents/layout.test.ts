import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CustomRoom } from '@office/shared';
import { wallsOfRoomIn } from '../../../web/src/office/decor/wallsOfRoom.ts';
import { BOUNDS, HUMAN_DESKS, ROOMS, SPAWN, WALLS, agentSeat, styleOf, canSetPiece, lineKeys, normalizeWalls, wallRuns, blocked, deskSeat, findDeskSpot, findPath, freeSpotNear, setAgentDesks, setCustomRooms, setWallStyles } from '../../../web/src/office/layout.ts';

/** A planta é do cliente, mas é lógica pura e sem teste própria na web: rotas e colisão se testam aqui. */
const room = (slot: number): CustomRoom => ({ id: `sala-${slot}`, officeId: 'o', name: `Sala ${slot}`, emoji: '🚪', floor: '#eeeeee', slot });
const reset = () => { setWallStyles({}); setAgentDesks([]); setCustomRooms([]); };
const center = (id: string) => { const r = ROOMS.find((x) => x.id === id)!; return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }; };
const arrives = (to: { x: number; z: number }) => {
  const path = findPath(SPAWN, to);
  return path.length > 0 && Math.hypot(path.at(-1)!.x - to.x, path.at(-1)!.z - to.z) < 1;
};

test('sala nova: dá para andar até ela, e a planta volta ao normal sem ela', () => {
  reset();
  const walls0 = WALLS.length;
  setCustomRooms([room(0), room(1), room(2), room(3)]);
  assert.equal(BOUNDS.x1, 27 + 28);
  assert.equal(ROOMS.length, 11);
  for (const id of ['sala-0', 'sala-1', 'sala-2', 'sala-3']) assert.ok(arrives(center(id)), id);
  assert.ok(HUMAN_DESKS.some((d) => d.id === 'sala-0-1'));
  setCustomRooms([]);
  assert.equal(BOUNDS.x1, 27);
  assert.equal(ROOMS.length, 7);
  assert.equal(WALLS.length, walls0);
  assert.ok(blocked({ x: 30, z: -12 }));
});

test('o vazio entre anexos não é chão: sala solta fica sem passagem pelo vazio', () => {
  reset();
  setCustomRooms([room(3)]);
  assert.ok(!blocked(center('sala-3')));
  assert.ok(blocked({ x: 34, z: -12 }), 'a coluna do meio não existe');
  assert.ok(blocked({ x: 48, z: 12 }), 'nem as linhas sem sala');
  reset();
});

test('as mesas das salas novas ficam livres para sentar', () => {
  reset();
  setCustomRooms([room(0)]);
  for (const d of HUMAN_DESKS.filter((x) => x.room === 'sala-0')) assert.ok(!blocked(deskSeat(d)), d.id);
  reset();
});

test('parede removida deixa passar; a de vidro continua bloqueando', () => {
  reset();
  // o trecho entre redação e reunião, à esquerda da porta (chave das versões antigas, que vale para todos os pedaços dele)
  const across = { x: -23, z: -3 };
  assert.ok(blocked(across));
  setWallStyles({ '-23.1:-3': 'vidro' });
  assert.ok(blocked(across), 'vidro é parede');
  setWallStyles({ '-23.1:-3': 'removida' });
  assert.ok(!blocked(across), 'sem parede');
  setWallStyles({});
  assert.ok(blocked(across));
});

test('salas do andar aberto: começam sem parede e podem ser fechadas (vidro), com porta', () => {
  reset();
  const gerencia = ROOMS.find((r) => r.id === 'gerencia')!;
  const keys = wallsOfRoomIn(gerencia, WALLS);
  const divisa = WALLS.find((w) => w.w > w.d && w.z === -3 && w.x > -6 && w.x < -4)!;
  assert.ok(divisa, 'a divisa gerência/recepção existe');
  assert.ok(keys.includes(divisa.key));
  assert.equal(styleOf({}, divisa.key), 'removida');
  assert.equal(styleOf({ padrao: 'tijolo', divisorias: 'vidro' }, divisa.key), 'removida', 'os padrões não fecham a sala sozinhos');
  assert.ok(!blocked({ x: divisa.x, z: divisa.z }), 'aberta deixa passar');
  setWallStyles(Object.fromEntries(keys.map((k) => [k, 'vidro'])));
  assert.equal(styleOf(Object.fromEntries(keys.map((k) => [k, 'vidro'])), divisa.key), 'vidro');
  assert.ok(blocked({ x: divisa.x, z: divisa.z }), 'vidro fecha');
  assert.ok(arrives(center('gerencia')), 'fechada continua alcançável pela porta');
  setWallStyles(Object.fromEntries(WALLS.map((w) => [w.key, 'vidro'])));
  for (const id of ['gerencia', 'copa', 'copy', 'design', 'video', 'reuniao']) assert.ok(arrives(freeSpotNear(center(id))), `${id} com tudo em vidro`);
  reset();
});

test('paredes em pedaços: desenhar no meio do salão bloqueia, apagar um pedaço abre só ele', () => {
  reset();
  // divisória solta de 4 m no meio da recepção
  const keys = lineKeys({ x: -2, z: 9 }, { x: 2, z: 9.2 });
  assert.equal(keys.length, 8, 'meio em meio metro');
  assert.ok(keys.every((k) => k.startsWith('h:') && k.endsWith(':9')));
  assert.ok(!blocked({ x: 0, z: 9 }));
  setWallStyles(Object.fromEntries(keys.map((k) => [k, 'vidro'])));
  assert.ok(blocked({ x: 0, z: 9 }), 'parede desenhada bloqueia');
  assert.equal(wallRuns().filter((r) => r.keys.includes(keys[0])).length, 1);
  assert.equal(wallRuns().find((r) => r.keys.includes(keys[0]))!.keys.length, 8, 'os pedaços viram um trecho só');
  // apagar um pedaço da parede da sala de reunião
  const gap = lineKeys({ x: -24, z: -3 }, { x: -22, z: -3 });
  assert.equal(gap.length, 4);
  setWallStyles(Object.fromEntries(gap.map((k) => [k, 'removida'])));
  assert.ok(!blocked({ x: -23, z: -3 }), 'os pedaços apagados deixam passar');
  assert.ok(blocked({ x: -25.5, z: -3 }), 'o resto da parede continua');
  reset();
});

test('paredes em pedaços: fora do prédio não desenha e parede de fora não some', () => {
  reset();
  const outside = lineKeys({ x: -40, z: 0 }, { x: -38, z: 0 })[0];
  assert.ok(!canSetPiece(outside, 'vidro'));
  const exterior = WALLS.find((w) => w.w > w.d && w.z === -18 && w.x > 0 && w.x < 1)!;
  assert.ok(canSetPiece(exterior.key, 'tijolo'), 'troca o acabamento');
  assert.ok(!canSetPiece(exterior.key, 'removida'), 'mas não some');
  assert.ok(canSetPiece(lineKeys({ x: -2, z: 9 }, { x: 2, z: 9 })[0], 'removida'));
});

test('escolhas salvas pelas versões antigas (por trecho) continuam valendo e viram pedaços', () => {
  reset();
  // trecho antigo da parede entre redação e reunião, à esquerda da porta (centro em x=-23.15, chave -23.1)
  const legacy = { '-23.1:-3': 'vidro' } as const;
  const piece = WALLS.find((w) => w.w > w.d && w.z === -3 && w.x > -26 && w.x < -24)!;
  assert.equal(styleOf(legacy, piece.key), 'vidro');
  const norm = normalizeWalls(legacy);
  assert.ok(!('-23.1:-3' in norm), 'a chave antiga sai');
  assert.equal(norm[piece.key], 'vidro');
  assert.ok(Object.keys(norm).length >= 6, 'todos os pedaços do trecho');
  assert.deepEqual(normalizeWalls({ [piece.key]: 'alvenaria', padrao: 'alvenaria' }), { padrao: 'alvenaria' }, 'igual à planta-base sai do mapa');
});

test('todos os funcionários de uma sala cheia ganham lugares diferentes, sem bater em nada', () => {
  reset();
  setCustomRooms([room(0)]);
  const seats: { x: number; z: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const s = findDeskSpot('sala-0');
    if (!s) break;
    seats.push(s);
    setAgentDesks(seats.map((seat) => ({ seat })));
    assert.ok(!blocked(s), 'a cadeira fica livre');
  }
  assert.ok(seats.length >= 2);
  assert.equal(new Set(seats.map((s) => `${s.x}:${s.z}`)).size, seats.length);
  assert.ok(arrives(center('sala-0')), 'a sala continua alcançável');
  reset();
  assert.equal(findDeskSpot('nao-existe'), null);
});

test('funcionário senta no lugar dele, na mesa padrão ou no meio da sala', () => {
  reset();
  setCustomRooms([room(0)]);
  assert.deepEqual(agentSeat({ room: 'design', seat: { x: 1, z: 2 } }), { x: 1, z: 2 });
  assert.deepEqual(agentSeat({ room: 'design' }), { x: 21.75, z: 13.85 });
  assert.ok(agentSeat({ room: 'sala-0' }).x > 27);
  reset();
});

test('sala inteira: pega todas as paredes em volta, e só as dela', () => {
  reset();
  const design = ROOMS.find((r) => r.id === 'design')!;
  const keys = wallsOfRoomIn(design, WALLS);
  const walls = WALLS.filter((w) => keys.includes(w.key));
  assert.ok(walls.some((w) => w.x === 27), 'parede leste');
  assert.ok(walls.some((w) => w.z === 18), 'parede da frente');
  // as divisas com a recepção e a ilha de vídeo também contam (começam abertas, mas dá para fechar a sala)
  assert.ok(walls.some((w) => w.x === 9), 'divisa com a recepção');
  assert.ok(walls.some((w) => w.z === 7.5), 'divisa com a ilha de vídeo');
  assert.ok(walls.every((w) => (w.w > w.d ? w.x > 9 && w.x < 27 : w.z > 7.5 && w.z < 18)), 'nenhuma passa da divisa');
  const reuniao = wallsOfRoomIn(ROOMS.find((r) => r.id === 'reuniao')!, WALLS);
  assert.ok(reuniao.length >= 4);
  assert.ok(!reuniao.some((k) => keys.includes(k)));
});

