import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentProfile, Presence, Vec2 } from '@office/shared';
import { useStore, showEmote } from '../lib/store';
import { Avatar } from './Avatar';
import { LabelProjector } from './Labels';
import { FurnitureMesh } from './Furniture';
import { DESKS, FURNITURE, ROOMS, SPAWN, WALLS, WALL_H, freeSpotNear, roomAt, step, type Furniture } from './layout';

/** Estado do jogador fora do React: atualizado a cada quadro sem re-render. */
export const player = { x: SPAWN.x, z: SPAWN.z, dir: Math.PI, moving: false, target: null as Vec2 | null };
export const cam = { zoom: 42, angle: Math.PI / 4 };

const keys = new Set<string>();
const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export interface Nearby { label: string; action: () => void }


function Player({ onNearby }: { onNearby: (n: Nearby | null) => void }) {
  const { camera } = useThree();
  const user = useStore((s) => s.user)!;
  const send = useStore((s) => s.send);
  const lastSent = useRef(0);
  const lastRoom = useRef<string | null>('recepcao');
  const lastNear = useRef<string | null>(null);
  const camTarget = useRef(new THREE.Vector3(player.x, 0, player.z));

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useStore.getState();

    if (st.teleport) {
      const p = freeSpotNear(st.teleport);
      player.x = p.x; player.z = p.z; player.target = null;
      useStore.setState({ teleport: null });
    }

    // entrada: WASD/setas relativas à câmera
    let ix = 0, iz = 0;
    if (!typing() && !st.panel) {
      if (keys.has('w') || keys.has('arrowup')) iz -= 1;
      if (keys.has('s') || keys.has('arrowdown')) iz += 1;
      if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
      if (keys.has('d') || keys.has('arrowright')) ix += 1;
    }
    const run = keys.has('shift') ? 1.8 : 1;
    const speed = 5.2 * run;
    let dx = 0, dz = 0;
    if (ix || iz) {
      player.target = null;
      const len = Math.hypot(ix, iz);
      // com a câmera no ângulo padrão (45°), "direita" na tela = (1,-1) e "baixo" = (1,1) no mundo
      const bx = (ix + iz) / Math.SQRT2 / len;
      const bz = (iz - ix) / Math.SQRT2 / len;
      // e giramos junto com a câmera
      const a = cam.angle - Math.PI / 4;
      dx = (bx * Math.cos(a) - bz * Math.sin(a)) * speed * dt;
      dz = (bx * Math.sin(a) + bz * Math.cos(a)) * speed * dt;
    } else if (player.target) {
      const tx = player.target.x - player.x, tz = player.target.z - player.z;
      const dist = Math.hypot(tx, tz);
      if (dist < 0.08) player.target = null;
      else {
        const s = Math.min(dist, speed * dt);
        dx = (tx / dist) * s; dz = (tz / dist) * s;
      }
    }
    const moving = !!(dx || dz);
    if (moving) {
      const next = step(player, dx, dz);
      if (next.x === player.x && next.z === player.z) player.target = null;
      player.x = next.x; player.z = next.z;
      player.dir = Math.atan2(dx, dz);
    }
    player.moving = moving;

    // sala atual
    const room = roomAt(player);
    if ((room?.id ?? null) !== lastRoom.current) {
      lastRoom.current = room?.id ?? null;
      useStore.setState({ myRoom: room?.id ?? null });
    }

    // presença em ~12 Hz enquanto anda, e um último pacote ao parar
    const now = performance.now();
    if ((moving && now - lastSent.current > 80) || (!moving && lastSent.current > 0)) {
      send({ t: 'move', pos: { x: +player.x.toFixed(2), z: +player.z.toFixed(2) }, dir: +player.dir.toFixed(2), moving, room: room?.id ?? null });
      lastSent.current = moving ? now : 0;
    }

    // interação mais próxima
    let best: { d: number; key: string; n: Nearby } | null = null;
    for (const f of FURNITURE) {
      if (!f.panel && !f.label) continue;
      const d = Math.hypot(f.x - player.x, f.z - player.z);
      if (d < 2.4 && (!best || d < best.d)) best = { d, key: `f:${f.x}:${f.z}`, n: { label: f.label ?? '', action: () => useFurniture(f) } };
    }
    for (const a of st.agents) {
      const desk = DESKS[a.room];
      const d = Math.hypot(desk.x - player.x, desk.z - player.z);
      if (d < 2.2 && (!best || d < best.d)) best = { d, key: `a:${a.id}`, n: { label: `Falar com ${a.name} (${a.role})`, action: () => st.open('agente', a.id) } };
    }
    if ((best?.key ?? null) !== lastNear.current) {
      lastNear.current = best?.key ?? null;
      onNearby(best?.n ?? null);
    }

    // câmera isométrica seguindo com suavização
    camTarget.current.lerp(new THREE.Vector3(player.x, 0, player.z), Math.min(1, dt * 6));
    const d = 30;
    camera.position.set(camTarget.current.x + Math.cos(cam.angle) * d, d * 1.15, camTarget.current.z + Math.sin(cam.angle) * d);
    camera.lookAt(camTarget.current);
    const ortho = camera as THREE.OrthographicCamera;
    if (Math.abs(ortho.zoom - cam.zoom) > 0.01) {
      ortho.zoom += (cam.zoom - ortho.zoom) * Math.min(1, dt * 10);
      ortho.updateProjectionMatrix();
    }
  });

  return (
    <Avatar anchorId={`user:${user.id}`} color={user.color} highlight getState={() => player} />
  );
}

export function useFurniture(f: Furniture) {
  const st = useStore.getState();
  if (f.panel) st.open(f.panel);
  else if (f.kind === 'cafeteira') {
    st.send({ t: 'emote', emoji: '☕' });
    showEmote(st.user!.id, '☕');
  }
}

function Remote({ p }: { p: Presence }) {
  const cur = useRef({ x: p.pos.x, z: p.pos.z, dir: p.dir, moving: p.moving });
  const target = useRef(p);
  target.current = p;
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 10);
    cur.current.x += (target.current.pos.x - cur.current.x) * k;
    cur.current.z += (target.current.pos.z - cur.current.z) * k;
    cur.current.dir = target.current.dir;
    cur.current.moving = target.current.moving;
  });
  return <Avatar anchorId={`user:${p.userId}`} color={p.color} getState={() => cur.current} />;
}

function AgentNPC({ a }: { a: AgentProfile }) {
  const open = useStore((s) => s.open);
  const desk = DESKS[a.room];
  const state = useMemo(() => ({ x: desk.x, z: desk.z, dir: Math.PI, moving: false }), [desk.x, desk.z]);
  return (
    <Avatar anchorId={`agent:${a.id}`} isAgent seated typing={a.status === 'trabalhando'} color={a.color} getState={() => state} onClick={() => open('agente', a.id)} />
  );
}

function Floor() {
  const office = useStore((s) => s.office);
  return (
    <group>
      {/* área externa */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow
        onClick={(e) => { e.stopPropagation(); player.target = { x: e.point.x, z: e.point.z }; }}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#a8c99a" />
      </mesh>
      {ROOMS.map((r) => (
        <mesh key={r.id} rotation={[-Math.PI / 2, 0, 0]} position={[(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2]} receiveShadow
          onClick={(e) => { e.stopPropagation(); player.target = { x: e.point.x, z: e.point.z }; }}>
          <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
          <meshStandardMaterial color={r.id === 'recepcao' && office ? office.theme.floor : r.floor} />
        </mesh>
      ))}
      {/* caminho até a porta */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 16]} receiveShadow>
        <planeGeometry args={[2.6, 8]} />
        <meshStandardMaterial color="#d8d2c4" />
      </mesh>
      {WALLS.map((w, i) => (
        <mesh key={i} position={[w.x, WALL_H / 2, w.z]} castShadow receiveShadow>
          <boxGeometry args={[w.w, WALL_H, w.d]} />
          <meshStandardMaterial color={office?.theme.wall ?? '#f6f3ee'} />
        </mesh>
      ))}
    </group>
  );
}

export function World({ onNearby }: { onNearby: (n: Nearby | null) => void }) {
  const presences = useStore((s) => s.presences);
  const agents = useStore((s) => s.agents);
  const accent = useStore((s) => s.office?.theme.primary ?? '#ff5c8a');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (!typing()) keys.add(e.key.toLowerCase()); };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const blur = () => keys.clear();
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement)?.tagName !== 'CANVAS') return;
      cam.zoom = Math.min(110, Math.max(14, cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    addEventListener('wheel', wheel, { passive: true });
    setReady(true);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', blur);
      removeEventListener('wheel', wheel);
    };
  }, []);

  return (
    <Canvas shadows dpr={[1, 2]} className="world">
      <color attach="background" args={['#9cc28e']} />
      <OrthographicCamera makeDefault zoom={cam.zoom} near={-100} far={200} position={[30, 34, 30]} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#ffffff', '#b5a48a', 0.6]} />
      <directionalLight position={[18, 30, 12]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <Floor />
      {FURNITURE.map((f, i) => (
        <FurnitureMesh key={i} f={f} accent={accent} onUse={(ff) => { player.target = freeSpotNear({ x: ff.x, z: ff.z + 1.4 }); useFurniture(ff); }} />
      ))}
      {agents.map((a) => <AgentNPC key={a.id} a={a} />)}
      {Object.values(presences).map((p) => <Remote key={p.userId} p={p} />)}
      {ready && <Player onNearby={onNearby} />}
      <LabelProjector />
    </Canvas>
  );
}
