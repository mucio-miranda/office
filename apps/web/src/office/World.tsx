import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentProfile, Presence, Vec2 } from '@office/shared';
import { useStore, showEmote } from '../lib/store';
import { usePixel, useScene, useWorldStyle, type ScenePalette } from '../lib/theme';
import { PixelRoom } from './pixel/Room';
import { DecorLayer } from './decor/DecorLayer';
import { useDecor } from './decor/state';
import { Avatar } from './Avatar';
import { LabelProjector, registerAnchor } from './Labels';
import { FurnitureMesh } from './Furniture';
import { LiveScreens } from './LiveScreens';
import { DESKS, FURNITURE, HUMAN_DESKS, ROOMS, SPAWN, WALLS, WALL_H, deskSeat, findPath, freeSpotNear, roomAt, step, type Furniture, type HumanDesk } from './layout';

/** Estado do jogador fora do React: atualizado a cada quadro sem re-render. */
export const player = {
  x: SPAWN.x, z: SPAWN.z, dir: Math.PI, moving: false,
  /** próximo ponto do caminho e os que vêm depois (o clique desvia dos móveis) */
  target: null as Vec2 | null,
  path: [] as Vec2[],
  /** sentado na própria mesa (andar levanta) */
  seated: false,
  /** força o envio da posição no próximo quadro (sentar, aparecer na mesa) */
  dirty: false,
};
export const cam = {
  zoom: 38,
  angle: Math.PI / 4,
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
  player.path = findPath(player, p);
  player.target = player.path.shift() ?? null;
}

const stopWalking = () => { player.target = null; player.path = []; };

/** Farol pulsando no chão (o tour aponta para onde está falando). */
export const beacon = { on: false, x: 0, z: 0 };

/**
 * Altura da câmera em relação à distância horizontal. Maquete: 1,15. Pixel: isométrico 2:1 do Habbo
 * (elevação de 30°, altura = tan 30° × √2), em que as linhas do piso sobem 1 pixel a cada 2.
 */
const camHeight = () => (useWorldStyle.getState().style === 'pixel' ? Math.tan(Math.PI / 6) * Math.SQRT2 : 1.15);
/** Seno da elevação (para converter o arraste em pixels em metros no chão). */
const sinElev = () => camHeight() / Math.hypot(1, camHeight());
/** Tamanho do pixel da arte no tema Pixel, em pixels da tela (1:1, como nos quartos do Habbo). */
const PIXEL_SIZE = 1;

/** Modo drone ligado (Espaço segurado) ou arrastando: cliques não movem o personagem. */
export const droneBlocksClick = () => useStore.getState().drone || cam.justDragged || useDecor.getState().editing;

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
  const d = DESKS[a.room];
  goTo({ x: d.x + 1.5, z: d.z - 0.4 }, d);
}

/** Senta na cadeira de uma mesa, de frente para o monitor. */
function sitAt(d: HumanDesk) {
  const seat = deskSeat(d);
  player.x = seat.x; player.z = seat.z; player.dir = Math.PI;
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
  cam.tx = Math.max(-34, Math.min(34, cam.tx));
  cam.tz = Math.max(-26, Math.min(26, cam.tz));
}

const keys = new Set<string>();
const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export interface Nearby { label: string; action: () => void }

/** Cores de status (iguais aos tokens CSS) para os anéis no chão. */
const STATUS_RING: Record<AgentProfile['status'], string | null> = { livre: null, trabalhando: '#2563eb', aguardando: '#f59e0b', erro: '#dc2626' };

function Player({ onNearby, p, active }: { onNearby: (n: Nearby | null) => void; p: ScenePalette; active: boolean }) {
  const { camera } = useThree();
  const user = useStore((s) => s.user)!;
  const send = useStore((s) => s.send);
  const lastSent = useRef(0);
  const lastRoom = useRef<string | null>('recepcao');
  const lastNear = useRef<string | null>(null);
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
    const speed = 5.2 * (keys.has('shift') ? 1.8 : 1);
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
      if (dist < 0.08) player.target = player.path.shift() ?? null;
      else {
        const s = Math.min(dist, speed * dt);
        dx = (tx / dist) * s; dz = (tz / dist) * s;
      }
    }
    const moving = !!(dx || dz);
    if (moving) {
      const next = step(player, dx, dz);
      if (next.x === player.x && next.z === player.z) stopWalking();
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
      const d = Math.hypot(f.x - player.x, f.z - player.z);
      if (d < 2.4 && (!best || d < best.d)) best = { d, key: `f:${f.x}:${f.z}`, n: { label: f.label ?? '', action: () => useFurniture(f) } };
    }
    for (const hd of HUMAN_DESKS) {
      const seat = deskSeat(hd);
      const d = Math.hypot(seat.x - player.x, seat.z - player.z);
      if (d > 1.8 || (best && d >= best.d)) continue;
      const owner = st.members.find((m) => m.desk === hd.id);
      if (!owner) best = { d, key: `d:${hd.id}:livre`, n: { label: 'Ficar com esta mesa', action: () => { st.claimDesk(hd.id).then((ok) => ok && sitAt(hd)); } } };
      else if (owner.id === st.user?.id && !player.seated) best = { d, key: `d:${hd.id}:minha`, n: { label: 'Sentar na sua mesa', action: () => sitAt(hd) } };
    }
    for (const a of st.agents) {
      const desk = DESKS[a.room];
      const d = Math.hypot(desk.x - player.x, desk.z - player.z);
      if (d < 2.2 && (!best || d < best.d)) best = { d, key: `a:${a.id}`, n: { label: `Falar com ${a.name}`, action: () => st.open('agente', a.id) } };
    }
    if ((best?.key ?? null) !== lastNear.current) {
      lastNear.current = best?.key ?? null;
      onNearby(best?.n ?? null);
    }

    if (cam.follow) camTarget.current.lerp(tmp.set(player.x, 0, player.z), Math.min(1, dt * 6));
    else camTarget.current.lerp(tmp.set(cam.tx, 0, cam.tz), cam.dragging ? 1 : Math.min(1, dt * 10));
    cam.cx = camTarget.current.x;
    cam.cz = camTarget.current.z;
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

  return <Avatar anchorId={`user:${user.id}`} color={user.color} p={p} ring={p.screen} getState={() => player} />;
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
  return <Avatar anchorId={`user:${pr.userId}`} color={pr.color} p={p} getState={() => cur.current} />;
}

function AgentNPC({ a, p }: { a: AgentProfile; p: ScenePalette }) {
  const open = useStore((s) => s.open);
  const desk = DESKS[a.room];
  const state = useMemo(() => ({ x: desk.x, z: desk.z, dir: Math.PI, moving: false }), [desk.x, desk.z]);
  return (
    <Avatar anchorId={`agent:${a.id}`} seated typing={a.status === 'trabalhando'} color={a.color} p={p}
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
  walkTo({ x: e.point.x, z: e.point.z });
};

function Floor({ p }: { p: ScenePalette }) {
  const pixel = useWorldStyle((s) => s.style) === 'pixel';
  const px = usePixel();
  if (pixel) return <PixelRoom p={px} onWalk={walk} />;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.22, 0]} onClick={walk}>
        <planeGeometry args={[160, 160]} />
        <meshBasicMaterial color={p.ground} />
      </mesh>
      {/* base da maquete */}
      <mesh position={[0, -0.11, 0]} receiveShadow>
        <boxGeometry args={[36.6, 0.2, 24.6]} />
        <meshBasicMaterial color={p.wallTop} />
      </mesh>
      {ROOMS.map((r) => (
        <mesh key={r.id} rotation={[-Math.PI / 2, 0, 0]} position={[(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2]} receiveShadow onClick={walk}>
          <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
          <meshBasicMaterial color={r.id === 'video' || r.id === 'reuniao' ? p.floorAlt : p.floor} />
        </mesh>
      ))}
      {/* o piso não é iluminado (cor exata da paleta); este plano só recebe as sombras */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[36, 24]} />
        <shadowMaterial transparent opacity={p.shadow + 0.04} />
      </mesh>
      {WALLS.map((w, i) => (
        <mesh key={i} position={[w.x, WALL_H / 2, w.z]} castShadow receiveShadow>
          <boxGeometry args={[w.w, WALL_H, w.d]} />
          <meshStandardMaterial color={p.wall} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** Mundo 3D. Com `active=false` (uma página aberta por cima) o render só acontece sob demanda. */
export function World({ onNearby, active }: { onNearby: (n: Nearby | null) => void; active: boolean }) {
  const presences = useStore((s) => s.presences);
  const agents = useStore((s) => s.agents);
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
    const zoomBy = (k: number) => { cam.zoom = Math.min(110, Math.max(14, cam.zoom * k)); };
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

    // arrastar: Espaço + botão esquerdo, ou botão do meio a qualquer momento
    let last: { x: number; y: number } | null = null;
    let moved = 0;
    const pdown = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.tagName !== 'CANVAS') return;
      if (!(e.button === 1 || (e.button === 0 && useStore.getState().drone))) return;
      e.preventDefault();
      last = { x: e.clientX, y: e.clientY };
      moved = 0;
      cam.dragging = true;
      useStore.setState({ droneDragging: true });
    };
    const pmove = (e: PointerEvent) => {
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      panBy(dx, dy);
    };
    const pup = () => {
      if (!last) return;
      last = null;
      cam.dragging = false;
      useStore.setState({ droneDragging: false });
      if (moved > 3) { cam.justDragged = true; setTimeout(() => { cam.justDragged = false; }, 0); }
    };
    // o botão do meio no Windows abre a "rolagem automática"; aqui ele é arraste
    const aux = (e: MouseEvent) => { if (e.button === 1 && (e.target as HTMLElement)?.tagName === 'CANVAS') e.preventDefault(); };

    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    addEventListener('wheel', wheel, { passive: false });
    addEventListener('pointerdown', pdown);
    addEventListener('pointermove', pmove);
    addEventListener('pointerup', pup);
    addEventListener('mousedown', aux);
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
    };
  }, []);

  return (
    // Pixel: a cena sai em resolução menor e o CSS amplia sem suavizar (image-rendering: pixelated)
    <Canvas key={pixel ? 'pixel' : 'maquete'} flat shadows={pixel ? 'basic' : 'soft'} dpr={pixel ? window.devicePixelRatio / PIXEL_SIZE : [1, 2]}
      gl={{ antialias: !pixel }} className={`world ${pixel ? 'pixel' : ''}`} frameloop={active ? 'always' : 'demand'}>
      <color attach="background" args={[pixel ? px.void : p.background]} />
      <OrthographicCamera makeDefault zoom={cam.zoom} near={-100} far={200} position={[30, 34, 30]} />
      {pixel ? (
        <>
          {/* luz de cima e da esquerda: topo claro, face da esquerda média, face da direita escura (como no Habbo) */}
          <ambientLight intensity={1.1} />
          <directionalLight position={[-10, 26, 14]} intensity={1.6} castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0004}
            shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
        </>
      ) : (
        <>
          <ambientLight intensity={1.7} />
          <hemisphereLight args={['#ffffff', p.ground, 0.6]} />
          <directionalLight position={[14, 30, 18]} intensity={1.25} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
            shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
        </>
      )}
      <Floor p={p} />
      {FURNITURE.map((f, i) => (
        <FurnitureMesh key={i} f={f} p={p} onUse={(ff) => { if (droneBlocksClick()) return; walkTo({ x: ff.x, z: ff.z + 1.4 }); useFurniture(ff); }} />
      ))}
      <DecorLayer />
      <DeskMarkers />
      <LiveScreens />
      <Beacon p={p} />
      {agents.map((a) => <AgentNPC key={a.id} a={a} p={p} />)}
      {Object.values(presences).map((pr) => <Remote key={pr.userId} pr={pr} p={p} />)}
      {ready && <Player onNearby={onNearby} p={p} active={active} />}
      <LabelProjector />
    </Canvas>
  );
}
