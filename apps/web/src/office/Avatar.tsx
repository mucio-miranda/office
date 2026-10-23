import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { registerAnchor } from './Labels';

export interface AvatarProps {
  /** Chave do rótulo em LabelLayer (user:<id> ou agent:<id>). */
  anchorId: string;
  color: string;
  /** Lido a cada quadro: posição e direção atuais. */
  getState: () => { x: number; z: number; dir: number; moving: boolean };
  /** Usado só para a animação de digitação. */
  typing?: boolean;
  isAgent?: boolean;
  seated?: boolean;
  onClick?: () => void;
  highlight?: boolean;
}

/** Avatar low-poly: corpo, cabeça, cabelo e pernas que balançam ao andar. */
export function Avatar({ anchorId, color, getState, typing, isAgent, seated, onClick, highlight }: AvatarProps) {
  const root = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const body = useRef<Group>(null);
  const t = useRef(0);
  const stateRef = useRef(getState);
  stateRef.current = getState;
  useEffect(() => registerAnchor(anchorId, () => stateRef.current()), [anchorId]);

  useFrame((_, dt) => {
    const s = getState();
    const g = root.current;
    if (!g) return;
    g.position.x = s.x;
    g.position.z = s.z;
    // gira suavemente para a direção do movimento
    let diff = s.dir - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * Math.min(1, dt * 12);
    t.current += dt * (s.moving ? 10 : 0);
    const swing = s.moving ? Math.sin(t.current) * 0.6 : 0;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (body.current) {
      // respiração / digitação
      const idle = Math.sin(performance.now() / (isAgent ? 180 : 600)) * (typing ? 0.025 : 0.012);
      body.current.position.y = (s.moving ? Math.abs(Math.sin(t.current)) * 0.06 : idle) + (seated ? -0.25 : 0);
    }
  });

  return (
    <group
      ref={root}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onPointerOver={onClick ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={onClick ? () => (document.body.style.cursor = '') : undefined}
    >
      {/* sombra falsa */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.42, 20]} />
        <meshBasicMaterial color="#000" transparent opacity={0.18} />
      </mesh>
      {highlight && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <ringGeometry args={[0.5, 0.6, 32]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
      <group ref={body}>
        <group ref={legL} position={[-0.13, 0.42, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <boxGeometry args={[0.16, 0.42, 0.18]} />
            <meshStandardMaterial color="#2f3140" />
          </mesh>
        </group>
        <group ref={legR} position={[0.13, 0.42, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <boxGeometry args={[0.16, 0.42, 0.18]} />
            <meshStandardMaterial color="#2f3140" />
          </mesh>
        </group>
        <mesh position={[0, 0.78, 0]} castShadow>
          <cylinderGeometry args={[0.27, 0.31, 0.72, 10]} />
          <meshStandardMaterial color={color} flatShading />
        </mesh>
        <mesh position={[0, 1.36, 0]} castShadow>
          <icosahedronGeometry args={[0.27, 1]} />
          <meshStandardMaterial color="#f1c7a5" flatShading />
        </mesh>
        <mesh position={[0, 1.5, -0.03]} castShadow>
          <icosahedronGeometry args={[0.25, 0]} />
          <meshStandardMaterial color={isAgent ? '#1f1f2b' : '#5a3d2b'} flatShading />
        </mesh>
        {/* olhos, para saber para onde está virado */}
        {[-0.09, 0.09].map((x) => (
          <mesh key={x} position={[x, 1.38, 0.24]}>
            <sphereGeometry args={[0.035, 6, 6]} />
            <meshBasicMaterial color="#1b1b1b" />
          </mesh>
        ))}
        {isAgent && (
          <mesh position={[0, 1.82, 0]}>
            <octahedronGeometry args={[0.09, 0]} />
            <meshBasicMaterial color={color} />
          </mesh>
        )}
      </group>
    </group>
  );
}
