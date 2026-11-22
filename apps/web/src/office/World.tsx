import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { type AgentProfile, type Presence, type Vec2, type Worker } from '@office/shared';
import { useStore, showEmote } from '../lib/store';
import { usePixel, useScene, useWorldStyle, type ScenePalette } from '../lib/theme';
import { PixelRoom } from './pixel/Room';
import { DecorLayer, grabItem } from './decor/DecorLayer';
import { usePlan } from './decor/plan';
import { commit, useDecor } from './decor/state';
import { seatWorkers, sittable } from './seats';
import { copaSpots, idleSpot, leisureSpots, releaseIdleSpot, workerPhase, type IdleSpot } from './npc';
import { busyState, holdView, quarterOf, rotateView, tiltView, useOnlyWorking, useView, viewRot } from './view';
import { HOLD_MS, pad, usePad } from '../lib/gamepad';
import { Avatar } from './Avatar';
import { LabelProjector, registerAnchor } from './Labels';
import { FurnitureMesh } from './Furniture';
import { LiveScreens } from './LiveScreens';
import { ClientArchive, cabinets, openArchive } from './Archive';
import { MoodboardWall } from './MoodboardWall';

const MAQUETE_WALL: Record<string, string> = { branca: '#f3f3f1', preta: '#1f2023', concreto: '#a3a29d', madeira: '#99693f', vidro: '#bfe6f5', 'vidro-fume': '#39444c' };
import { agentSeat, buildingRect, deskDir, deskItemFor, fixoItemFor, DESK_DIRS, isFixedAgent, roleOf, workerSpot, wallRuns, FURNITURE, HUMAN_DESKS, distToFurniture, ROOMS, SPAWN, WALL_H, blocked, deskSeat, findPath, freeSpotNear, roomAt, step, tileAt, type Furniture, type HumanDesk } from './layout';

/** Estado do jogador fora do React: atualizado a cada quadro sem re-render. */
export const player = {
  x: SPAWN.x, z: SPAWN.z, dir: Math.PI, moving: false,
  /** próximo ponto do caminho e os que vêm depois (o clique desvia dos móveis) */
  target: null as Vec2 | null,
  path: [] as Vec2[],
  /** destino do clique (para refazer a rota se o avatar esbarrar no caminho) */
  goal: null as Vec2 | null,
  replans: 0,
  /** sentado na própria mesa (andar levanta) */
  seated: false,
  /** clicou numa mesa ou cadeira: senta quando chegar */
  sitOnArrive: null as { x: number; z: number; dir: number } | null,
  /** força o envio da posição no próximo quadro (sentar, aparecer na mesa) */
  dirty: false,
};
export const cam = {
  zoom: 38,
  angle: viewRot.target,
  /** false = câmera solta (modo drone): fica em (tx, tz) em vez de seguir o jogador. */
  follow: true,
  tx: SPAWN.x,
  tz: SPAWN.z,
  /** posição e zoom reais da câmera neste quadro (o arraste parte daqui) */
  cx: SPAWN.x,
  cz: SPAWN.z,
  realZoom: 38,
  dragging: false,
  /** o soltar do arraste dispara um click no chão; isto impede o personagem de andar até lá */
  justDragged: false,
};

/** Anda até um ponto contornando paredes e móveis. */
export function walkTo(p: Vec2) {
  player.sitOnArrive = null;
  player.path = findPath(player, p);
  player.target = player.path.shift() ?? null;
  player.goal = player.target ? p : null;
  player.replans = 0;
  if (player.target) walkMark.show(player.path.at(-1) ?? player.target);
}

/** Ladrilho sob o mouse (o cursor quadrado do Habbo); `on` só enquanto o mouse está sobre o chão. */
export const tileHover = { on: false, x: 0, z: 0 };

const stopWalking = () => { player.target = null; player.path = []; player.goal = null; walkMark.on = false; };

/** Marca no chão onde o clique vai levar o avatar (some ao chegar). */
export const walkMark = { on: false, x: 0, z: 0, show(p: Vec2) { const t = tileAt(p); this.on = true; this.x = t.x; this.z = t.z; } };

/** Farol pulsando no chão (o tour aponta para onde está falando). */
export const beacon = { on: false, x: 0, z: 0 };

/**
 * Altura da câmera em relação à distância horizontal. Maquete: 1,15. Pixel: isométrico 2:1 do Habbo
 * (elevação de 30°, altura = tan 30° × √2), em que as linhas do piso sobem 1 pixel a cada 2.
 */
const camHeight = () => (useWorldStyle.getState().style === 'pixel' ? Math.tan(Math.PI / 6) * Math.SQRT2 : 1.15) * viewRot.elev;
/** Seno da elevação (para converter o arraste em pixels em metros no chão). */
const sinElev = () => camHeight() / Math.hypot(1, camHeight());
/** Tamanho do pixel da arte no tema Pixel, em pixels da tela (1:1, como nos quartos do Habbo). */
const PIXEL_SIZE = 1;

/** Modo drone ligado (Espaço segurado) ou arrastando: cliques não movem o personagem. */
export const droneBlocksClick = () => useStore.getState().drone || cam.dragging || cam.justDragged || useDecor.getState().editing;

/** Volta a câmera para o jogador. */
export function recenter() {
  cam.follow = true;
  if (useStore.getState().camDetached) useStore.setState({ camDetached: false });
}

/** Leva você até um ponto: fecha a página aberta, teletransporta (a câmera desliza junto) e vira de frente para `face`. */
export function goTo(target: Vec2, face?: Vec2) {
  const q = freeSpotNear(target);
  if (face) player.dir = Math.atan2(face.x - q.x, face.z - q.z);
  stopWalking();
  useStore.setState({ panel: null, panelArg: null, teleport: q });
}

/** Vai até a mesa de um funcionário de IA. Chega pela direita da tela, para os nomes não se encobrirem. */
export function goToAgent(a: AgentProfile) {
  const d = agentSeat(a);
  goTo({ x: d.x + 1.5, z: d.z - 0.4 }, d);
}

/** Senta na cadeira de uma mesa, de frente para o monitor. */
/** Senta onde estiver (mesa de trabalho, cadeira, sofá): de frente para a direção dada. */
export function sitHere(p: Vec2, dir: number) {
  player.x = p.x; player.z = p.z; player.dir = dir;
  stopWalking();
  player.sitOnArrive = null;
  player.seated = true;
  player.dirty = true;
  recenter();
}

/** Clique numa mesa ou cadeira: anda até ela e senta ao chegar (perto, senta na hora). */
export function walkAndSit(p: Vec2, dir: number) {
  if (Math.hypot(p.x - player.x, p.z - player.z) < 1.4) return sitHere(p, dir);
  walkTo(p);
  player.sitOnArrive = { x: p.x, z: p.z, dir };
}

/**
 * Clique numa mesa de pessoa: a sua, senta; livre, fica com ela e senta; de outra pessoa, só anda até perto.
 * Devolve se tratou o clique.
 */
function clickDesk(f: Furniture) {
  const st = useStore.getState();
  const hd = HUMAN_DESKS.find((d) => Math.abs(d.x - f.x) < 0.05 && Math.abs(d.z - f.z) < 0.05);
  if (!hd) return false;
  const seat = deskSeat(hd);
  const owner = st.members.find((m) => m.desk === hd.id);
  if (owner && owner.id !== st.user?.id) return false;
  if (owner) { walkAndSit(seat, deskDir(hd)); return true; }
  st.claimDesk(hd.id).then((ok) => { if (ok) walkAndSit(seat, deskDir(hd)); });
  return true;
}

function sitAt(d: HumanDesk) {
  const seat = deskSeat(d);
  player.x = seat.x; player.z = seat.z; player.dir = deskDir(d);
  stopWalking();
  player.seated = true;
  player.dirty = true;
  recenter();
}

/** A sua mesa neste escritório (ou undefined). */
export function myDesk() {
  const st = useStore.getState();
  const id = st.members.find((m) => m.id === st.user?.id)?.desk;
  return HUMAN_DESKS.find((d) => d.id === id);
}

/** "Ir para minha mesa" (M). Sem mesa, leva até a mesa livre mais próxima e explica como escolher. */
export function goToMyDesk() {
  const mine = myDesk();
  if (mine) {
    useStore.setState({ panel: null, panelArg: null });
    sitAt(mine);
    return;
  }
  const taken = new Set(useStore.getState().members.map((m) => m.desk));
  const free = HUMAN_DESKS.filter((d) => !taken.has(d.id))
    .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
  if (!free) return useStore.getState().notify('Todas as mesas estão ocupadas.');
  const seat = deskSeat(free);
  goTo({ x: seat.x + 1, z: seat.z + 0.4 }, seat);
  useStore.getState().notify('Você ainda não tem mesa. Aperte E perto desta para ficar com ela.');
}

/** Libera a sua mesa (ela volta a ficar livre para outra pessoa). */
export async function releaseMyDesk() {
  if (!myDesk()) return;
  if (await useStore.getState().claimDesk(null)) {
    if (player.seated) { player.seated = false; player.dirty = true; }
    useStore.getState().notify('Mesa liberada.');
  }
}

/** Vai até uma pessoa online (também pela direita da tela). */
export function goToPerson(p: Presence) {
  goTo({ x: p.pos.x + 1.1, z: p.pos.z - 1.1 }, p.pos);
}

/** Arrasta a câmera: o escritório acompanha o cursor, como no Figma. */
function panBy(dxPx: number, dyPx: number) {
  if (cam.follow) {
    cam.follow = false;
    cam.tx = cam.cx;
    cam.tz = cam.cz;
    useStore.setState({ camDetached: true });
  }
  const a = cam.angle;
  const k = 1 / cam.realZoom;
  // direita na tela = (sin a, -cos a) no chão; "para cima" na tela = (-cos a, -sin a)
  cam.tx += -Math.sin(a) * dxPx * k + -Math.cos(a) * (dyPx * k) / sinElev();
  cam.tz += Math.cos(a) * dxPx * k + -Math.sin(a) * (dyPx * k) / sinElev();
  cam.tx = Math.max(-50, Math.min(50, cam.tx));
  cam.tz = Math.max(-38, Math.min(38, cam.tz));
}

const keys = new Set<string>();
const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export interface Nearby { label: string; action: () => void; /** segunda ação (R no teclado, X/□ no controle): o menu da função do funcionário */ alt?: { label: string; action: () => void } }

/** Cores de status (iguais aos tokens CSS) para os anéis no chão. */
const STATUS_RING: Record<AgentProfile['status'], string | null> = { livre: null, trabalhando: '#2563eb', aguardando: '#f59e0b', erro: '#dc2626' };

function Player({ onNearby, p, active }: { onNearby: (n: Nearby | null) => void; p: ScenePalette; active: boolean }) {
  const { camera } = useThree();
  const user = useStore((s) => s.user)!;
  const send = useStore((s) => s.send);
  const lastSent = useRef(0);
  const lastRoom = useRef<string | null>('recepcao');
  const lastNear = useRef<string | null>(null);
  const padSpinning = useRef(false);
  const camTarget = useRef(new THREE.Vector3(player.x, 0, player.z));
  const tmp = useMemo(() => new THREE.Vector3(), []);

  // quem tem mesa entra no escritório já sentado nela
  useEffect(() => {
    const mine = myDesk();
    if (mine) {
      sitAt(mine);
      camTarget.current.set(player.x, 0, player.z);
    }
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useStore.getState();

    if (st.teleport) {
      const q = freeSpotNear(st.teleport);
      player.x = q.x; player.z = q.z; stopWalking();
      player.seated = false;
      player.dirty = true;
      useStore.setState({ teleport: null });
      recenter();
    }

    let ix = 0, iz = 0;
    if (active && !typing()) {
      if (keys.has('w') || keys.has('arrowup')) iz -= 1;
      if (keys.has('s') || keys.has('arrowdown')) iz += 1;
      if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
      if (keys.has('d') || keys.has('arrowright')) ix += 1;
    }
    // controle: o analógico esquerdo anda (devagar com pouca inclinação, corre no fundo ou com L3)
    let padMag = 1;
    // no modo mouse (e no Decorar) o analógico esquerdo move a seta, não o boneco
    const padMouse = usePad.getState().mouse || useDecor.getState().editing;
    if (active && !typing() && !padMouse && (pad.lx || pad.ly)) { ix += pad.lx; iz += pad.ly; padMag = Math.max(0.35, Math.min(1, Math.hypot(pad.lx, pad.ly))); }
    // controle: segurando LB/RB gira livre; RB + analógico direito gira e sobe/desce a câmera; sem RB, o analógico move a câmera
    const nowMs = performance.now();
    const holdL = pad.lbSince && nowMs - pad.lbSince > HOLD_MS, holdR = pad.rbSince && nowMs - pad.rbSince > HOLD_MS;
    if (active && (holdL || holdR || (pad.rbSince && (pad.rx || pad.ry)))) {
      viewRot.dragging = true;
      if (holdL && !pad.rbSince) cam.angle -= 1.6 * dt;
      if (holdR && !(pad.rx || pad.ry)) cam.angle += 1.6 * dt;
      if (pad.rbSince && (pad.rx || pad.ry)) {
        cam.angle += pad.rx * 2 * dt;
        viewRot.elevTarget = Math.min(2.6, Math.max(0.45, viewRot.elevTarget * Math.exp(-pad.ry * 1.4 * dt)));
        viewRot.elev = viewRot.elevTarget;
      }
      padSpinning.current = true;
    } else {
      if (padSpinning.current) { padSpinning.current = false; viewRot.dragging = false; holdView(cam.angle); tiltView(1); }
      if (active && (pad.rx || pad.ry)) panBy(-pad.rx * 900 * dt, -pad.ry * 900 * dt);
    }
    if (active && (pad.lt || pad.rt)) cam.zoom = Math.min(110, Math.max(9, cam.zoom * Math.exp((pad.rt - pad.lt) * dt * 1.8)));
    const speed = 5.2 * (keys.has('shift') || pad.run ? 1.8 : 1) * padMag;
    let dx = 0, dz = 0;
    if (ix || iz) {
      stopWalking();
      const len = Math.hypot(ix, iz);
      // com a câmera no ângulo padrão (45°), "direita" na tela = (1,-1) e "baixo" = (1,1) no mundo
      const bx = (ix + iz) / Math.SQRT2 / len;
      const bz = (iz - ix) / Math.SQRT2 / len;
      const a = cam.angle - Math.PI / 4;
      dx = (bx * Math.cos(a) - bz * Math.sin(a)) * speed * dt;
      dz = (bx * Math.sin(a) + bz * Math.cos(a)) * speed * dt;
    } else if (player.target) {
      const tx = player.target.x - player.x, tz = player.target.z - player.z;
      const dist = Math.hypot(tx, tz);
      if (dist < 0.08) {
        player.target = player.path.shift() ?? null;
        if (!player.target) { const s = player.sitOnArrive; stopWalking(); if (s) sitHere(s, s.dir); }
      } else {
        const s = Math.min(dist, speed * dt);
        dx = (tx / dist) * s; dz = (tz / dist) * s;
      }
    }
    const moving = !!(dx || dz);
    if (moving) {
      // levantando de uma cadeira ou sofá (o lugar fica dentro da peça): primeiro sai dela
      if (player.seated && blocked(player)) { const q = freeSpotNear(player); player.x = q.x; player.z = q.z; }
      if (ix || iz) player.sitOnArrive = null;
      const next = step(player, dx, dz);
      if (next.x === player.x && next.z === player.z) {
        // esbarrou (outra pessoa mexeu na decoração, ou a rota raspou uma quina): refaz o caminho algumas vezes antes de desistir
        const goal = player.goal;
        if (goal && player.replans < 3) {
          const replans = player.replans + 1;
          walkTo(goal);
          player.replans = replans;
        } else stopWalking();
      }
      player.x = next.x; player.z = next.z;
      player.dir = Math.atan2(dx, dz);
    }
    player.moving = moving;
    if (moving && player.seated) { player.seated = false; player.dirty = true; }
    // andar devolve a câmera para você
    if (moving && !cam.follow) recenter();

    const room = roomAt(player);
    if ((room?.id ?? null) !== lastRoom.current) {
      lastRoom.current = room?.id ?? null;
      useStore.setState({ myRoom: room?.id ?? null });
    }

    const now = performance.now();
    if ((moving && now - lastSent.current > 80) || (!moving && lastSent.current > 0) || player.dirty) {
      send({ t: 'move', pos: { x: +player.x.toFixed(2), z: +player.z.toFixed(2) }, dir: +player.dir.toFixed(2), moving, seated: player.seated, room: room?.id ?? null });
      lastSent.current = moving ? now : 0;
      player.dirty = false;
    }

    let best: { d: number; key: string; n: Nearby } | null = null;
    for (const f of FURNITURE) {
      if (!f.panel && !f.label) continue;
      const d = distToFurniture(f, player);
      if (d >= 2.4 || (best && d >= best.d)) continue;
      if (f.kind === 'arquivo') {
        // o armário mais perto de quem está na frente da fileira
        const c = cabinets(st.clients).reduce((a, b) => (Math.abs(b.x - player.x) < Math.abs(a.x - player.x) ? b : a));
        const id = c.client?.id ?? null;
        best = { d, key: `arq:${id}`, n: { label: c.client ? `Arquivo de ${c.client.name}` : f.label ?? '', action: () => openArchive(id) } };
      } else best = { d, key: `f:${f.x}:${f.z}`, n: { label: f.label ?? '', action: () => useFurniture(f) } };
    }
    for (const hd of HUMAN_DESKS) {
      const seat = deskSeat(hd);
      const d = Math.hypot(seat.x - player.x, seat.z - player.z);
      if (d > 1.8 || (best && d >= best.d)) continue;
      const owner = st.members.find((m) => m.desk === hd.id);
      if (!owner) best = { d, key: `d:${hd.id}:livre`, n: { label: 'Ficar com esta mesa', action: () => { st.claimDesk(hd.id).then((ok) => ok && sitAt(hd)); } } };
      else if (owner.id === st.user?.id && !player.seated) best = { d, key: `d:${hd.id}:minha`, n: { label: 'Sentar na sua mesa', action: () => sitAt(hd) } };
    }
    const spots = workerSpots(st.workers);
    // mesas de trabalho e peças de sentar (as ocupadas por funcionários ficam de fora)
    if (!player.seated) {
      for (const s of sittable(useDecor.getState().items)) {
        if (spots.some(([, w]) => Math.hypot(w.x - s.x, w.z - s.z) < 0.4)) continue;
        const d = Math.hypot(s.x - player.x, s.z - player.z);
        if (d < 1.6 && (!best || d < best.d)) best = { d, key: `s:${s.key}`, n: { label: 'Sentar', action: () => sitHere(s, s.dir) } };
      }
    }
    for (const [w, spot] of spots) {
      const d = Math.hypot(spot.x - player.x, spot.z - player.z);
      const client = st.clients.find((c) => c.id === w.clientId);
      if (d < 2.2 && (!best || d < best.d)) best = { d, key: `w:${w.id}`, n: { label: `Conversar com ${w.name}${client ? ` (${client.name})` : ''}`, action: () => st.open('clientes', w.clientId) } };
    }
    // funcionários de função, sempre na mesa: conversar ou abrir o menu da função
    for (const a of st.agents.filter(isFixedAgent)) {
      const seat = agentSeat(a);
      const d = Math.hypot(seat.x - player.x, seat.z - player.z);
      const role = roleOf(a);
      if (d < 2.4 && (!best || d < best.d)) best = { d, key: `a:${a.id}`, n: { label: `Conversar com ${a.name}`, action: () => st.open('agente', a.id), ...(role ? { alt: { label: `Abrir ${role.label}`, action: () => st.open(role.panel) } } : {}) } };
    }
    // outras pessoas do escritório: conversa direta
    for (const pr of Object.values(st.presences)) {
      const d = Math.hypot(pr.pos.x - player.x, pr.pos.z - player.z);
      if (d < 2.2 && (!best || d < best.d)) best = { d, key: `p:${pr.userId}`, n: { label: `Conversar com ${pr.name}`, action: () => st.open('pessoa', pr.userId) } };
    }
    if ((best?.key ?? null) !== lastNear.current) {
      lastNear.current = best?.key ?? null;
      onNearby(best?.n ?? null);
    }

    if (cam.follow) camTarget.current.lerp(tmp.set(player.x, 0, player.z), Math.min(1, dt * 6));
    else camTarget.current.lerp(tmp.set(cam.tx, 0, cam.tz), cam.dragging ? 1 : Math.min(1, dt * 10));
    cam.cx = camTarget.current.x;
    cam.cz = camTarget.current.z;
    if (!viewRot.dragging && Math.abs(viewRot.target - cam.angle) > 1e-4) cam.angle += (viewRot.target - cam.angle) * Math.min(1, dt * 9);
    if (Math.abs(viewRot.elevTarget - viewRot.elev) > 1e-4) viewRot.elev += (viewRot.elevTarget - viewRot.elev) * Math.min(1, dt * 9);
    const q = quarterOf(cam.angle);
    if (q !== useView.getState().quarter) useView.setState({ quarter: q });
    const d = 30;
    camera.position.set(camTarget.current.x + Math.cos(cam.angle) * d, d * camHeight(), camTarget.current.z + Math.sin(cam.angle) * d);
    camera.lookAt(camTarget.current);
    const ortho = camera as THREE.OrthographicCamera;
    if (Math.abs(ortho.zoom - cam.zoom) > 0.01) {
      ortho.zoom += (cam.zoom - ortho.zoom) * Math.min(1, dt * 10);
      ortho.updateProjectionMatrix();
    }
    cam.realZoom = ortho.zoom;
  });

  return <Avatar anchorId={`user:${user.id}`} color={user.color} look={user.look} p={p} ring={p.screen} getState={() => player} />;
}

export function useFurniture(f: Furniture) {
  const st = useStore.getState();
  if (f.panel) st.open(f.panel);
  else if (f.kind === 'cafeteira') {
    st.send({ t: 'emote', emoji: '☕' });
    showEmote(st.user!.id, '☕');
  }
}

function Remote({ pr, p }: { pr: Presence; p: ScenePalette }) {
  const cur = useRef({ x: pr.pos.x, z: pr.pos.z, dir: pr.dir, moving: pr.moving, seated: pr.seated });
  const target = useRef(pr);
  target.current = pr;
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 10);
    cur.current.x += (target.current.pos.x - cur.current.x) * k;
    cur.current.z += (target.current.pos.z - cur.current.z) * k;
    cur.current.dir = target.current.dir;
    cur.current.moving = target.current.moving;
    cur.current.seated = target.current.seated;
  });
  // clicar na pessoa abre a conversa direta com ela
  return <Avatar anchorId={`user:${pr.userId}`} color={pr.color} look={pr.look} p={p} getState={() => cur.current}
    onClick={() => { if (!droneBlocksClick()) useStore.getState().open('pessoa', pr.userId); }} />;
}

/**
 * Funcionários no mapa: só quem está trabalhando ou esperando você, na sala do trabalho. Os parados não andam pela copa
 * (viravam um amontoado): aparecem num contador só, em cima da mesa da copa, e na Equipe.
 */
export type WorkerSpot = Vec2 & { dir: number; seated: boolean; copa: boolean; play?: boolean };
/** Lugares para passar o tempo (objetos de qualquer sala e a copa), com quem está nas mesas de trabalho fora. */
const idleSpots = (): IdleSpot[] => [...leisureSpots(useDecor.getState().items), ...copaSpots()];
export function workerSpots(workers: Worker[]) {
  const now = Date.now();
  const atDesk = workers.filter((w) => workerPhase(w, now) === 'mesa');
  const inCopa = workers.filter((w) => workerPhase(w, now) === 'copa');
  // na mesa: a da sala ou uma mesa de trabalho do Decorar; as mesas dos funcionários de função não contam
  const fixed = useStore.getState().agents.filter(isFixedAgent).map(agentSeat);
  const seats = seatWorkers(atDesk, useDecor.getState().items, fixed);
  const count: Record<string, number> = {};
  const desk = atDesk.map((w) => {
    const s = seats.get(w.id);
    const spot: WorkerSpot = s
      ? { x: s.x, z: s.z, dir: s.dir, seated: true, copa: false }
      : { ...workerSpot(w.room, (count[w.room] = (count[w.room] ?? -1) + 1)), dir: Math.PI, seated: false, copa: false };
    return [w, spot] as const;
  });
  // passando o tempo: cada um no seu lugar (jogos, sofás, café ou um canto da copa), nunca dois no mesmo
  const spots = idleSpots();
  for (const w of workers) if (workerPhase(w, now) !== 'copa') releaseIdleSpot(w.id);
  const copa = inCopa.flatMap((w) => {
    const p = idleSpot(w.id, spots);
    return p ? [[w, { x: p.x, z: p.z, dir: p.dir, seated: p.seated, play: p.play, copa: true } as WorkerSpot] as const] : [];
  });
  return [...desk, ...copa];
}
const WORKER_RING: Record<Worker['state'], string | null> = { copa: null, trabalhando: '#2563eb', aguardando: '#f59e0b' };

/**
 * Funcionário de cliente no mapa: anda até o lugar dele (mesa ou copa) desviando dos móveis, senta na mesa e, na copa,
 * circula de tempos em tempos para outro canto livre.
 */
function WorkerNPC({ w, spot, p }: { w: Worker; spot: WorkerSpot; p: ScenePalette }) {
  const open = useStore((s) => s.open);
  const st = useRef({ x: spot.x, z: spot.z, dir: spot.dir, moving: false, seated: spot.seated, path: [] as Vec2[], target: null as Vec2 | null, goal: spot, next: performance.now() + 8000 + Math.random() * 20000 });
  const goTo = (to: Vec2) => {
    const s = st.current;
    s.path = findPath(s, to);
    s.target = s.path.shift() ?? null;
    s.seated = false;
  };
  // o lugar mudou (acabou o trabalho, chegou trabalho novo): vai andando até lá
  useEffect(() => {
    const s = st.current;
    s.goal = spot;
    if (Math.hypot(spot.x - s.x, spot.z - s.z) > 0.3) goTo(spot);
    else { s.seated = spot.seated; s.dir = spot.dir; }
  }, [spot.x, spot.z, spot.seated]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = st.current;
    if (s.target) {
      const dx = s.target.x - s.x, dz = s.target.z - s.z, d = Math.hypot(dx, dz);
      if (d < 0.06) {
        s.target = s.path.shift() ?? null;
        if (!s.target) { s.moving = false; s.x = s.goal.x; s.z = s.goal.z; s.seated = s.goal.seated; s.dir = s.goal.dir; }
      } else {
        const v = Math.min(d, 2.3 * dt);
        s.x += (dx / d) * v; s.z += (dz / d) * v;
        s.dir = Math.atan2(dx, dz);
        s.moving = true;
      }
    } else if (s.goal.copa && performance.now() > s.next) {
      // passando o tempo: depois de um tempo, outra atividade (jogo, sofá, café, canto da copa)
      s.next = performance.now() + 25000 + Math.random() * 45000;
      const to = idleSpot(w.id, idleSpots(), true);
      if (to) { s.goal = { x: to.x, z: to.z, dir: to.dir, seated: to.seated, play: to.play, copa: true }; goTo(to); }
    }
  });
  return (
    <Avatar anchorId={`worker:${w.id}`} seated={st.current.seated} typing={w.state === 'trabalhando' || !!spot.play} color={w.color} p={p}
      ring={WORKER_RING[w.state]} pulse={w.state === 'aguardando'} getState={() => st.current} onClick={() => { if (!droneBlocksClick()) open('clientes', w.clientId); }} />
  );
}

export function AgentNPC({ a, p }: { a: AgentProfile; p: ScenePalette }) {
  const open = useStore((s) => s.open);
  const desk = agentSeat(a);
  const dir = a.seat ? Math.PI : DESK_DIRS[a.room] ?? Math.PI;
  const state = useMemo(() => ({ x: desk.x, z: desk.z, dir, moving: false }), [desk.x, desk.z, dir]);
  return (
    <Avatar anchorId={`agent:${a.id}`} seated typing={a.status === 'trabalhando'} color={a.color} look={a.look} p={p}
      ring={STATUS_RING[a.status]} pulse={a.status === 'aguardando'} getState={() => state} onClick={() => { if (!droneBlocksClick()) open('agente', a.id); }} />
  );
}

/**
 * Mesas das pessoas: plaquinha na cor do dono em cima da mesa e âncora do rótulo com nome e status,
 * escondido enquanto o dono está sentado nela (aí vale o rótulo do próprio avatar).
 */
function DeskMarkers() {
  const members = useStore((s) => s.members);
  useEffect(() => {
    const offs = HUMAN_DESKS.map((d) => registerAnchor(`desk:${d.id}`, () => {
      const st = useStore.getState();
      const owner = st.members.find((m) => m.desk === d.id);
      const seat = deskSeat(d);
      let hidden = !owner;
      if (owner && owner.id === st.user?.id) hidden = player.seated && Math.hypot(player.x - seat.x, player.z - seat.z) < 0.3;
      else if (owner) {
        const pr = st.presences[owner.id];
        hidden = !!pr?.seated && Math.hypot(pr.pos.x - seat.x, pr.pos.z - seat.z) < 0.5;
      }
      return { x: d.x, z: d.z, y: 1.45, hidden };
    }));
    return () => offs.forEach((off) => off());
  }, []);
  return (
    <>
      {members.map((m) => {
        const d = HUMAN_DESKS.find((h) => h.id === m.desk);
        if (!d) return null;
        return (
          <mesh key={m.id} position={[d.x + 0.7, 0.765, d.z + 0.38]} castShadow>
            <boxGeometry args={[0.5, 0.03, 0.14]} />
            <meshStandardMaterial color={m.color} roughness={0.6} />
          </mesh>
        );
      })}
    </>
  );
}

/** Contorno de um ladrilho: linha clara por fora e escura por dentro, para aparecer em qualquer piso. */
const squareLine = (half: number) => new THREE.BufferGeometry().setFromPoints(
  [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
);
const SQ_OUT = squareLine(0.48), SQ_IN = squareLine(0.43);

/**
 * Cursor quadrado do Habbo: um ladrilho de 1 m contornado segue o mouse pelo chão (só onde dá para pisar) e o
 * ladrilho do destino fica marcado, com um preenchimento claro, até o avatar chegar.
 */
function TileCursor() {
  const hover = useRef<THREE.Group>(null);
  const dest = useRef<THREE.Group>(null);
  useFrame(() => {
    const h = hover.current, d = dest.current;
    if (!h || !d) return;
    h.visible = tileHover.on && !droneBlocksClick() && !blocked(tileHover);
    if (h.visible) h.position.set(tileHover.x, 0.02, tileHover.z);
    d.visible = walkMark.on;
    if (d.visible) d.position.set(walkMark.x, 0.018, walkMark.z);
  });
  const outline = (
    <>
      <lineLoop geometry={SQ_OUT}><lineBasicMaterial color="#ffffff" transparent opacity={0.95} depthWrite={false} /></lineLoop>
      <lineLoop geometry={SQ_IN}><lineBasicMaterial color="#1d1720" transparent opacity={0.35} depthWrite={false} /></lineLoop>
    </>
  );
  return (
    <>
      <group ref={hover} visible={false}>{outline}</group>
      <group ref={dest} visible={false}>
        {outline}
        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <planeGeometry args={[0.96, 0.96]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}

function Beacon({ p }: { p: ScenePalette }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    m.visible = beacon.on;
    if (!beacon.on) return;
    const t = (clock.elapsedTime % 1.6) / 1.6;
    m.position.set(beacon.x, 0.02, beacon.z);
    m.scale.setScalar(0.6 + t * 1.6);
    mat.current!.opacity = 0.7 * (1 - t);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={() => null}>
      <ringGeometry args={[0.9, 1.05, 48]} />
      <meshBasicMaterial ref={mat} color={p.screen} transparent depthWrite={false} />
    </mesh>
  );
}

const walk = (e: any) => {
  e.stopPropagation();
  if (droneBlocksClick()) return;
  walkTo(tileAt({ x: e.point.x, z: e.point.z }));
};
const hoverFloor = (e: any) => {
  const t = tileAt({ x: e.point.x, z: e.point.z });
  tileHover.on = true; tileHover.x = t.x; tileHover.z = t.z;
};
const leaveFloor = () => { tileHover.on = false; };

function Floor({ p }: { p: ScenePalette }) {
  const pixel = useWorldStyle((s) => s.style) === 'pixel';
  const px = usePixel();
  useStore((s) => s.walls);
  if (pixel) return <PixelRoom p={px} onWalk={walk} onHover={hoverFloor} onLeave={leaveFloor} />;
  const bld = buildingRect();
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.22, 0]} onClick={walk}>
        <planeGeometry args={[160, 160]} />
        <meshBasicMaterial color={p.ground} />
      </mesh>
      {/* base da maquete */}
      <mesh position={[(bld.x0 + bld.x1) / 2, -0.11, (bld.z0 + bld.z1) / 2]} receiveShadow>
        <boxGeometry args={[bld.x1 - bld.x0 + 0.6, 0.2, bld.z1 - bld.z0 + 0.6]} />
        <meshBasicMaterial color={p.wallTop} />
      </mesh>
      {ROOMS.map((r) => (
        <mesh key={r.id} rotation={[-Math.PI / 2, 0, 0]} position={[(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2]} receiveShadow onClick={walk} onPointerMove={hoverFloor} onPointerOut={leaveFloor}>
          <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
          <meshBasicMaterial color={r.id === 'video' || r.id === 'reuniao' ? p.floorAlt : p.floor} />
        </mesh>
      ))}
      {/* o piso não é iluminado (cor exata da paleta); este plano só recebe as sombras */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(bld.x0 + bld.x1) / 2, 0.003, (bld.z0 + bld.z1) / 2]} receiveShadow raycast={() => null}>
        <planeGeometry args={[bld.x1 - bld.x0, bld.z1 - bld.z0]} />
        <shadowMaterial transparent opacity={p.shadow + 0.04} />
      </mesh>
      {wallRuns().filter((w) => w.type !== 'removida').map((w) => {
        const type = w.type;
        return (
          <mesh key={`${w.key}:${type}`} position={[w.x, WALL_H / 2, w.z]} castShadow receiveShadow>
            <boxGeometry args={[w.w, WALL_H, w.d]} />
            <meshStandardMaterial color={MAQUETE_WALL[type] ?? p.wall} roughness={1} transparent={type.startsWith('vidro')} opacity={type.startsWith('vidro') ? 0.35 : 1} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Mundo 3D. Com `active=false` (uma página aberta por cima) o render só acontece sob demanda. */
export function World({ onNearby, active }: { onNearby: (n: Nearby | null) => void; active: boolean }) {
  const mapRev = useStore((s) => s.mapRev);
  // a sala em que a pessoa estava pode ter saído do mapa
  useEffect(() => { if (blocked(player)) { const q = freeSpotNear(SPAWN); player.x = q.x; player.z = q.z; player.dirty = true; } }, [mapRev]);
  const presences = useStore((s) => s.presences);
  const agents = useStore((s) => s.agents);
  const workers = useStore((s) => s.workers);
  // mesa nova no Decorar: quem estava sem mesa senta nela
  useDecor((s) => s.items);
  const onlyWorking = useOnlyWorking((s) => s.on);
  // a rotina muda com o tempo (3 h parado: vai para a copa; 12 h: sai do mapa): revê a cada minuto
  const [, setMinute] = useState(0);
  useEffect(() => { const t = setInterval(() => setMinute((m) => m + 1), 60_000); return () => clearInterval(t); }, []);
  const p = useScene();
  const px = usePixel();
  const pixel = useWorldStyle((s) => s.style) === 'pixel';
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const setDrone = (on: boolean) => { if (useStore.getState().drone !== on) useStore.setState({ drone: on }); };
    const down = (e: KeyboardEvent) => {
      if (typing()) return;
      // Espaço segurado = modo drone (e não rola a página)
      if (e.code === 'Space') {
        e.preventDefault();
        // um botão com foco seria "apertado" pelo Espaço
        if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        if (!e.repeat) setDrone(true);
        return;
      }
      if (e.key === 'Escape') recenter();
      // Q gira o escritório (Shift+Q para o outro lado); no Decorar ele fica no lado de sempre
      if (e.key.toLowerCase() === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey && !useDecor.getState().editing) { rotateView(e.shiftKey ? 1 : -1); return; }
      // PageUp / PageDown: sobe e desce a câmera
      if ((e.key === 'PageUp' || e.key === 'PageDown') && !useDecor.getState().editing) { e.preventDefault(); tiltView(e.key === 'PageUp' ? 1.15 : 1 / 1.15); return; }
      keys.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setDrone(false);
      keys.delete(e.key.toLowerCase());
    };
    const blur = () => { keys.clear(); setDrone(false); cam.dragging = false; };
    /**
     * Como no Figma: dois dedos no touchpad movem a câmera (lateral e vertical), pinça dá zoom (o navegador
     * manda pinça como roda com Ctrl). A roda do mouse continua dando zoom; Shift + roda move para os lados.
     */
    let lastPad = 0;
    const zoomBy = (k: number) => { cam.zoom = Math.min(110, Math.max(9, cam.zoom * k)); };
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement)?.tagName !== 'CANVAS') return;
      e.preventDefault();
      if (e.ctrlKey) return zoomBy(Math.exp(-e.deltaY * 0.01));
      const k = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * k, dy = e.deltaY * k;
      // roda de mouse: passos inteiros de 120 em wheelDelta, sem componente lateral
      const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0;
      const now = performance.now();
      const mouse = e.deltaX === 0 && wd !== 0 && wd % 120 === 0 && now - lastPad > 400;
      if (!mouse) {
        lastPad = now;
        panBy(-dx, -dy);
        return;
      }
      if (e.shiftKey) panBy(-dy, 0);
      else zoomBy(dy > 0 ? 0.9 : 1.1);
    };

    // arrastar: Espaço + botão esquerdo, ou botão direito ou do meio a qualquer momento (o avatar fica parado)
    let last: { x: number; y: number } | null = null;
    let moved = 0;
    // Ctrl (ou Alt) + arrastar com o botão esquerdo: para os lados gira livre, para cima e para baixo sobe e desce a câmera
    let spin: { x: number; y: number; angle: number; elev: number } | null = null;
    const pdown = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.tagName !== 'CANVAS') return;
      if (e.button === 0 && (e.ctrlKey || e.altKey) && !useDecor.getState().editing) {
        e.preventDefault();
        e.stopPropagation();
        spin = { x: e.clientX, y: e.clientY, angle: cam.angle, elev: viewRot.elevTarget };
        viewRot.dragging = true;
        cam.dragging = true;
        document.body.style.cursor = 'grabbing';
        return;
      }
      if (!(e.button === 1 || e.button === 2 || (e.button === 0 && useStore.getState().drone))) return;
      e.preventDefault();
      last = { x: e.clientX, y: e.clientY };
      moved = 0;
      cam.dragging = true;
      useStore.setState({ droneDragging: true });
    };
    const pmove = (e: PointerEvent) => {
      if (spin) {
        cam.angle = spin.angle + (e.clientX - spin.x) * 0.008;
        viewRot.elevTarget = Math.min(2.6, Math.max(0.45, spin.elev * Math.exp((e.clientY - spin.y) * 0.006)));
        viewRot.elev = viewRot.elevTarget;
        return;
      }
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      panBy(dx, dy);
    };
    const pup = () => {
      if (spin) {
        spin = null;
        viewRot.dragging = false;
        holdView(cam.angle);
        tiltView(1);
        document.body.style.cursor = '';
        cam.justDragged = true;
        setTimeout(() => { cam.dragging = false; cam.justDragged = false; }, 0);
        return;
      }
      if (!last) return;
      last = null;
      cam.dragging = false;
      useStore.setState({ droneDragging: false });
      if (moved > 3) { cam.justDragged = true; setTimeout(() => { cam.justDragged = false; }, 0); }
    };
    // o botão do meio no Windows abre a "rolagem automática"; aqui ele é arraste
    const aux = (e: MouseEvent) => { if (e.button === 1 && (e.target as HTMLElement)?.tagName === 'CANVAS') e.preventDefault(); };
    // o botão direito arrasta o mapa: sem o menu do navegador em cima do mundo
    const menu = (e: MouseEvent) => { if ((e.target as HTMLElement)?.tagName === 'CANVAS') e.preventDefault(); };

    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    addEventListener('wheel', wheel, { passive: false });
    addEventListener('pointerdown', pdown);
    addEventListener('pointermove', pmove);
    addEventListener('pointerup', pup);
    addEventListener('mousedown', aux);
    addEventListener('contextmenu', menu);
    setReady(true);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', blur);
      removeEventListener('wheel', wheel);
      removeEventListener('pointerdown', pdown);
      removeEventListener('pointermove', pmove);
      removeEventListener('pointerup', pup);
      removeEventListener('mousedown', aux);
      removeEventListener('contextmenu', menu);
    };
  }, []);

  return (
    // Pixel: a cena sai em resolução menor e o CSS amplia sem suavizar (image-rendering: pixelated)
    <Canvas key={`${pixel ? 'pixel' : 'maquete'}:${mapRev}`} flat shadows={pixel ? 'basic' : 'soft'} dpr={pixel ? window.devicePixelRatio / PIXEL_SIZE : [1, 2]}
      gl={{ antialias: !pixel }} className={`world ${pixel ? 'pixel' : ''}`} frameloop={active ? 'always' : 'demand'}>
      <color attach="background" args={[pixel ? px.void : p.background]} />
      <OrthographicCamera makeDefault zoom={cam.zoom} near={-100} far={200} position={[30, 34, 30]} />
      {pixel ? (
        <>
          {/* luz de cima e da esquerda: topo claro, face da esquerda média, face da direita escura (como no Habbo) */}
          <ambientLight intensity={1.1} />
          <directionalLight position={[-10, 26, 14]} intensity={1.6} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0004}
            shadow-camera-left={-42} shadow-camera-right={42} shadow-camera-top={42} shadow-camera-bottom={-42} />
        </>
      ) : (
        <>
          <ambientLight intensity={1.7} />
          <hemisphereLight args={['#ffffff', p.ground, 0.6]} />
          <directionalLight position={[14, 30, 18]} intensity={1.25} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
            shadow-camera-left={-42} shadow-camera-right={42} shadow-camera-top={42} shadow-camera-bottom={-42} />
        </>
      )}
      <Floor p={p} />
      {agents.filter((a) => a.seat).map((a) => <FurnitureMesh key={`mesa-${a.id}`} f={{ kind: 'mesa', x: a.seat!.x, z: a.seat!.z - 1.1, solid: true }} p={p} onUse={() => {}} />)}
      {FURNITURE.map((f, i) => f.kind === 'arquivo' ? (
        <ClientArchive key={i} f={f} p={p} onUse={(x, id) => { if (droneBlocksClick()) return; walkTo({ x, z: f.z + 1.3 }); openArchive(id); }} />
      ) : f.kind === 'moodboard' ? (
        <MoodboardWall key={i} f={f} p={p} />
      ) : (
        <FurnitureMesh key={i} f={f} p={p} onGrab={(ff, e) => {
          // no Decorar, segurar e arrastar uma mesa (ou móvel fixo) já a move, sem precisar clicar antes
          const ds = useDecor.getState();
          if (!ds.editing || ds.placing || e.button !== 0 || useStore.getState().drone || usePlan.getState().on) return;
          const it = deskItemFor(ff) ?? fixoItemFor(ff);
          if (!it) return;
          e.stopPropagation();
          if (!ds.items.some((x) => x.id === it.id)) commit([...ds.items, it]);
          useDecor.setState({ sel: it.id });
          grabItem(it.id);
        }} onUse={(ff) => {
          // no Decorar, a mesa fixa vira peça editável (mover e girar) e já fica selecionada
          if (useDecor.getState().editing) {
            // mesa ou qualquer móvel fixo: vira peça editável (ou seleciona a que já existe)
            const it = deskItemFor(ff) ?? fixoItemFor(ff);
            if (!it) return;
            if (!useDecor.getState().items.some((x) => x.id === it.id)) commit([...useDecor.getState().items, it]);
            useDecor.setState({ sel: it.id });
            return;
          }
          if (droneBlocksClick()) return; if (ff.kind === 'mesa' && clickDesk(ff)) return; walkTo({ x: ff.x, z: ff.z + 1.4 }); useFurniture(ff);
        }} />
      ))}
      <DecorLayer />
      <DeskMarkers />
      <LiveScreens />
      <Beacon p={p} />
      <TileCursor />
      {workerSpots(workers).filter(([w]) => !onlyWorking || busyState(w.state)).map(([w, spot]) => <WorkerNPC key={w.id} w={w} spot={spot} p={p} />)}
      {agents.filter(isFixedAgent).filter((a) => !onlyWorking || busyState(a.status)).map((a) => <AgentNPC key={a.id} a={a} p={p} />)}
      {Object.values(presences).map((pr) => <Remote key={pr.userId} pr={pr} p={p} />)}
      {ready && <Player onNearby={onNearby} p={p} active={active} />}
      <LabelProjector />
    </Canvas>
  );
}
