import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import { registerAnchor } from '../Labels';
import { usePixel } from '../../lib/theme';
import type { AvatarProps } from '../Avatar';
import { PBox } from './kit';

/** Tons de cabelo e pele variando pela cor da pessoa, para os avatares não saírem iguais. */
const HAIRS = ['#4a2f1e', '#1f1a17', '#c98b3c', '#8a3b1d', '#e3c27a', '#5a5a66'];
const SKINS = ['#f2c49b', '#e0a878', '#c68a5e', '#8d5a3b', '#f5d3b3'];
const pick = (list: string[], seed: string, salt: number) => {
  let h = salt;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
};

/**
 * Avatar em blocos, no espírito do Habbo: cabeça grande, cabelo, olhos, camiseta na cor da pessoa,
 * braços e pernas que balançam ao andar e postura sentada na mesa.
 */
export function PixelAvatar({ anchorId, color, getState, ring, pulse, typing, seated, onClick }: AvatarProps) {
  const p = usePixel();
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const t = useRef(0);
  const stateRef = useRef(getState);
  stateRef.current = getState;
  useEffect(() => registerAnchor(anchorId, () => stateRef.current()), [anchorId]);
  const hair = pick(HAIRS, anchorId, 7);
  const skin = pick(SKINS, anchorId, 3);

  useFrame((_, dt) => {
    const s = stateRef.current();
    const g = root.current;
    if (!g) return;
    g.position.x = s.x;
    g.position.z = s.z;
    let diff = s.dir - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * Math.min(1, dt * 12);
    const sit = s.seated ?? seated;
    t.current += dt * (s.moving ? 10 : 0);
    const swing = s.moving ? Math.sin(t.current) * 0.6 : 0;
    if (legL.current && legR.current) {
      legL.current.rotation.x = sit ? -Math.PI / 2 : swing;
      legR.current.rotation.x = sit ? -Math.PI / 2 : -swing;
    }
    if (armL.current && armR.current) {
      // digitando: braços para a frente batucando no teclado
      const tap = typing ? Math.sin(performance.now() / 90) * 0.12 : 0;
      armL.current.rotation.x = typing ? -1.1 + tap : -swing * 0.8;
      armR.current.rotation.x = typing ? -1.1 - tap : swing * 0.8;
    }
    if (body.current) {
      const bob = s.moving ? Math.abs(Math.sin(t.current)) * 0.05 : 0;
      body.current.position.y = bob + (sit ? -0.3 : 0);
    }
    if (ringRef.current && pulse) {
      const k = 1 + ((performance.now() / 900) % 1) * 0.5;
      ringRef.current.scale.set(k, k, k);
      (ringRef.current.material as any).opacity = 1.4 - k;
    }
  });

  return (
    <group
      ref={root}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onPointerOver={onClick ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={onClick ? () => (document.body.style.cursor = '') : undefined}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.34, 8]} />
        <meshBasicMaterial color="#000" transparent opacity={p.shadow} depthWrite={false} />
      </mesh>
      {ring && (
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
          <ringGeometry args={[0.42, 0.5, 8]} />
          <meshBasicMaterial color={ring} transparent opacity={1} depthWrite={false} />
        </mesh>
      )}
      {/* um pouco maior que a escala real, como no Habbo: a pessoa é o destaque da cena */}
      <group ref={body} scale={1.18}>
        {/* pernas (giram no quadril) */}
        <group ref={legL} position={[-0.11, 0.6, 0]}>
          <PBox p={p} out={0.022} pos={[0, -0.27, 0]} size={[0.16, 0.5, 0.18]} color={p.pants} />
          <PBox p={p} out={0.022} pos={[0, -0.54, 0.03]} size={[0.17, 0.08, 0.24]} color={p.shoes} />
        </group>
        <group ref={legR} position={[0.11, 0.6, 0]}>
          <PBox p={p} out={0.022} pos={[0, -0.27, 0]} size={[0.16, 0.5, 0.18]} color={p.pants} />
          <PBox p={p} out={0.022} pos={[0, -0.54, 0.03]} size={[0.17, 0.08, 0.24]} color={p.shoes} />
        </group>
        {/* tronco com a camiseta na cor da pessoa */}
        <PBox p={p} out={0.022} pos={[0, 0.86, 0]} size={[0.46, 0.52, 0.26]} color={color} />
        <PBox p={p} out={0.022} pos={[0, 0.63, 0]} size={[0.46, 0.06, 0.27]} color={p.pants} outline={false} />
        {/* braços (giram no ombro), mãos na cor da pele */}
        <group ref={armL} position={[-0.3, 1.08, 0]}>
          <PBox p={p} out={0.022} pos={[0, -0.2, 0]} size={[0.13, 0.4, 0.15]} color={color} />
          <PBox p={p} out={0.022} pos={[0, -0.44, 0]} size={[0.12, 0.1, 0.13]} color={skin} />
        </group>
        <group ref={armR} position={[0.3, 1.08, 0]}>
          <PBox p={p} out={0.022} pos={[0, -0.2, 0]} size={[0.13, 0.4, 0.15]} color={color} />
          <PBox p={p} out={0.022} pos={[0, -0.44, 0]} size={[0.12, 0.1, 0.13]} color={skin} />
        </group>
        {/* cabeça grande, cabelo e olhos */}
        <PBox p={p} out={0.022} pos={[0, 1.33, 0]} size={[0.4, 0.38, 0.36]} color={skin} />
        <PBox p={p} out={0.022} pos={[0, 1.54, -0.02]} size={[0.44, 0.12, 0.4]} color={hair} />
        <PBox p={p} out={0.022} pos={[0, 1.38, -0.17]} size={[0.44, 0.3, 0.08]} color={hair} />
        <PBox p={p} out={0.022} pos={[-0.09, 1.35, 0.185]} size={[0.06, 0.08, 0.01]} color="#1d1720" outline={false} cast={false} />
        <PBox p={p} out={0.022} pos={[0.09, 1.35, 0.185]} size={[0.06, 0.08, 0.01]} color="#1d1720" outline={false} cast={false} />
        <PBox p={p} out={0.022} pos={[0, 1.24, 0.185]} size={[0.1, 0.03, 0.01]} color="#a8503c" outline={false} cast={false} />
      </group>
    </group>
  );
}
