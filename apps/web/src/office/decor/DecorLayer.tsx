import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DecorItem } from '@office/shared';
import { usePixel, useScene, useWorldStyle, type ScenePalette } from '../../lib/theme';
import { useStore } from '../../lib/store';
import { BOUNDS, type FurnitureKind } from '../layout';
import { FurnitureMesh } from '../Furniture';
import { OutlineColor } from '../pixel/kit';
import { DEF, footprint, type DecorDef } from './catalog';
import { BACK_Z, LEFT_X, WALL_TOP, fits, placeGhost, useDecor, commit } from './state';

const C_HOVER = '#ffe066';
const C_SEL = '#4dd2ff';
const C_OK = '#7cfc8a';
const C_BAD = '#ff4d4d';

const snap = (v: number, step = 0.25) => Math.round(v / step) * step;

/** Posição e giro de uma peça no mundo (itens de parede ficam rentes à parede, de frente para a sala). */
function placement(it: DecorItem): { pos: [number, number, number]; rotY: number } {
  const d = DEF[it.kind];
  if (d?.place === 'parede') {
    const y = d.y ?? 1.5;
    return it.wall === 'esquerda' ? { pos: [LEFT_X, y, it.z], rotY: Math.PI / 2 } : { pos: [it.x, y, BACK_Z], rotY: 0 };
  }
  return { pos: [it.x, 0, it.z], rotY: (it.rot * Math.PI) / 2 };
}

/** Versão simples para o tema maquete: volumes neutros na pegada da peça. */
/** Peças que a maquete já desenha do jeito dela. */
const MAQUETE_KINDS = new Set(['sofa', 'planta', 'estante', 'tapete', 'luminaria']);

function MaqueteDecor({ d, it, p }: { d: DecorDef; it: DecorItem; p: ScenePalette }) {
  if (MAQUETE_KINDS.has(it.kind)) return <FurnitureMesh f={{ kind: it.kind as FurnitureKind, x: 0, z: 0 }} p={p} />;
  if (d.place === 'piso') {
    const [w, dd] = d.size;
    return <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[w, dd]} /><meshBasicMaterial color={p.floorAlt} /></mesh>;
  }
  if (d.place === 'parede') {
    return <mesh position={[0, 0, 0.02]}><boxGeometry args={[d.size[0], d.size[1], 0.04]} /><meshStandardMaterial color={p.wall} roughness={1} /></mesh>;
  }
  const h = d.place === 'alto' ? 0.2 : Math.min(d.h, 1.6) * 0.7;
  const y = d.place === 'alto' ? 2.4 : h / 2;
  return (
    <mesh position={[0, y, 0]} castShadow receiveShadow>
      <boxGeometry args={[d.size[0] * 0.92, h, d.size[1] * 0.92]} />
      <meshStandardMaterial color={it.color && d.place === 'chao' ? p.furniture : p.furnitureDark} roughness={0.9} />
    </mesh>
  );
}

function DecorPiece({ it, outline, onDown, onOver, onOut }: {
  it: DecorItem; outline: string | null; onDown?: (e: any) => void; onOver?: (e: any) => void; onOut?: () => void;
}) {
  const p = usePixel();
  const scene = useScene();
  const pixel = useWorldStyle((s) => s.style) === 'pixel';
  const d = DEF[it.kind];
  if (!d) return null;
  const { pos, rotY } = placement(it);
  return (
    <group position={pos} rotation={[0, rotY, 0]} onPointerDown={onDown} onPointerOver={onOver} onPointerOut={onOut}>
      <OutlineColor color={outline}>{pixel ? d.render(p, it.color) : <MaqueteDecor d={d} it={it} p={scene} />}</OutlineColor>
    </group>
  );
}

/** Marca da pegada da prévia: verde se cabe, vermelha se não. */
function Footprint({ it, ok }: { it: DecorItem; ok: boolean }) {
  const d = DEF[it.kind];
  if (!d) return null;
  const color = ok ? C_OK : C_BAD;
  if (d.place === 'parede') {
    const { pos, rotY } = placement(it);
    return (
      <mesh position={[pos[0], pos[1], pos[2]]} rotation={[0, rotY, 0]} raycast={() => null}>
        <planeGeometry args={[d.size[0] + 0.1, d.size[1] + 0.1]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
    );
  }
  const [w, dd] = footprint(d, it.rot);
  return (
    <mesh position={[it.x, 0.015, it.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <planeGeometry args={[w + 0.3, dd + 0.3]} />
      <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
    </mesh>
  );
}

/** Grade de 1 m no chão enquanto decora (como os ladrilhos do Habbo no modo de mobiliar). */
function Grid() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (let x = BOUNDS.x0; x <= BOUNDS.x1; x++) pts.push(x, 0.012, BOUNDS.z0, x, 0.012, BOUNDS.z1);
    for (let z = BOUNDS.z0; z <= BOUNDS.z1; z++) pts.push(BOUNDS.x0, 0.012, z, BOUNDS.x1, 0.012, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo} raycast={() => null}>
      <lineBasicMaterial color="#000000" transparent opacity={0.18} depthWrite={false} />
    </lineSegments>
  );
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const BACK = new THREE.Plane(new THREE.Vector3(0, 0, 1), -BACK_Z);
const LEFT = new THREE.Plane(new THREE.Vector3(1, 0, 0), -LEFT_X);

/**
 * Decoração do mapa e o modo Decorar: clicar seleciona, arrastar move, a peça do catálogo segue o
 * cursor até o clique. Itens de parede deslizam pelas paredes do fundo.
 */
export function DecorLayer() {
  const items = useDecor((s) => s.items);
  const editing = useDecor((s) => s.editing);
  const sel = useDecor((s) => s.sel);
  const ghost = useDecor((s) => s.ghost);
  const ghostOk = useDecor((s) => s.ghostOk);
  const dragId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const { camera, gl } = useThree();
  const hitItem = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const toRay = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const floorPoint = () => (ray.ray.intersectPlane(FLOOR, hit) ? { x: hit.x, z: hit.z } : null);
    /** Ponto na parede do fundo mais próxima do cursor. */
    const wallPoint = (d: DecorDef) => {
      const opts: { wall: 'fundo' | 'esquerda'; along: number; t: number }[] = [];
      if (ray.ray.intersectPlane(BACK, hit) && hit.y > -0.2 && hit.y < WALL_TOP + 0.6 && hit.x > BOUNDS.x0 && hit.x < BOUNDS.x1)
        opts.push({ wall: 'fundo', along: hit.x, t: ray.ray.origin.distanceTo(hit) });
      if (ray.ray.intersectPlane(LEFT, hit) && hit.y > -0.2 && hit.y < WALL_TOP + 0.6 && hit.z > BOUNDS.z0 && hit.z < BOUNDS.z1)
        opts.push({ wall: 'esquerda', along: hit.z, t: ray.ray.origin.distanceTo(hit) });
      let best = opts.sort((a, b) => a.t - b.t)[0];
      if (!best) {
        const f = floorPoint();
        if (!f) return null;
        best = f.z - BOUNDS.z0 < f.x - BOUNDS.x0 ? { wall: 'fundo', along: f.x, t: 0 } : { wall: 'esquerda', along: f.z, t: 0 };
      }
      const half = d.size[0] / 2;
      const [lo, hi] = best.wall === 'fundo' ? [BOUNDS.x0, BOUNDS.x1] : [BOUNDS.z0, BOUNDS.z1];
      const along = Math.min(hi - half - 0.1, Math.max(lo + half + 0.1, snap(best.along)));
      return best.wall === 'fundo' ? { wall: best.wall, x: along, z: BACK_Z } : { wall: best.wall, x: LEFT_X, z: along };
    };
    /** Prévia na posição do cursor: peça nova (placing) ou a que está sendo arrastada. */
    const preview = (base: DecorItem) => {
      const d = DEF[base.kind];
      if (!d) return null;
      if (d.place === 'parede') {
        const w = wallPoint(d);
        return w ? { ...base, ...w, rot: 0 } : null;
      }
      const f = floorPoint();
      if (!f) return null;
      const [w, dd] = footprint(d, base.rot);
      // o canto da peça encaixa na grade de meio metro
      return { ...base, wall: undefined, x: snap(f.x - w / 2, 0.5) + w / 2, z: snap(f.z - dd / 2, 0.5) + dd / 2 };
    };
    let downAt: { x: number; y: number } | null = null;

    const move = (e: PointerEvent) => {
      const s = useDecor.getState();
      toRay(e);
      if (s.placing) {
        const g = preview({ id: 'ghost', kind: s.placing.kind, x: 0, z: 0, rot: s.placing.rot, color: s.placing.color });
        useDecor.setState({ ghost: g, ghostOk: !!g && fits(g, s.items) });
        return;
      }
      if (dragId.current && downAt && (draggingRef.current || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4)) {
        const orig = s.items.find((i) => i.id === dragId.current);
        if (!orig) return;
        if (!draggingRef.current) { draggingRef.current = orig.id; setDragging(orig.id); document.body.style.cursor = 'grabbing'; }
        const g = preview(orig);
        useDecor.setState({ ghost: g, ghostOk: !!g && fits(g, s.items) });
      }
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement)?.tagName !== 'CANVAS' || useStore.getState().drone) return;
      const s = useDecor.getState();
      downAt = { x: e.clientX, y: e.clientY };
      if (s.placing) {
        toRay(e);
        move(e);
        if (!placeGhost(e.shiftKey) && useDecor.getState().ghost) useStore.getState().notify('Não cabe aí: procure um lugar verde.');
        return;
      }
      if (!hitItem.current) useDecor.setState({ sel: null });
      hitItem.current = false;
    };
    const up = () => {
      const s = useDecor.getState();
      const id = dragId.current;
      dragId.current = null;
      downAt = null;
      if (!id || !draggingRef.current) return;
      draggingRef.current = null;
      setDragging(null);
      document.body.style.cursor = '';
      if (s.ghost && s.ghostOk) commit(s.items.map((i) => (i.id === id ? { ...s.ghost!, id } : i)));
      useDecor.setState({ ghost: null });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerdown', down);
    addEventListener('pointerup', up);
    return () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerdown', down);
      removeEventListener('pointerup', up);
    };
  }, [editing, camera, gl]);

  useEffect(() => { if (!editing) { setHover(null); setDragging(null); draggingRef.current = null; dragId.current = null; } }, [editing]);

  const handlers = (it: DecorItem) => editing ? {
    onDown: (e: any) => {
      if (e.button !== 0 || useDecor.getState().placing || useStore.getState().drone) return;
      e.stopPropagation();
      hitItem.current = true;
      dragId.current = it.id;
      useDecor.setState({ sel: it.id });
    },
    onOver: (e: any) => { e.stopPropagation(); setHover(it.id); document.body.style.cursor = 'grab'; },
    onOut: () => { setHover((h) => (h === it.id ? null : h)); document.body.style.cursor = ''; },
  } : {};

  return (
    <group>
      {items.map((it) => (it.id === dragging ? null : (
        <DecorPiece key={it.id} it={it} outline={editing ? (sel === it.id ? C_SEL : hover === it.id ? C_HOVER : null) : null} {...handlers(it)} />
      )))}
      {editing && <Grid />}
      {editing && ghost && (
        <>
          <Footprint it={ghost} ok={ghostOk} />
          <DecorPiece it={ghost} outline={ghostOk ? C_OK : C_BAD} />
        </>
      )}
    </group>
  );
}
