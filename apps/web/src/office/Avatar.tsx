import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import { registerAnchor } from './Labels';
import { useWorldStyle, type ScenePalette } from '../lib/theme';
import { PixelAvatar } from './pixel/Avatar';

export interface AvatarProps {
  /** Chave do rótulo em LabelLayer (user:<id> ou agent:<id>). */
  anchorId: string;
  color: string;
  p: ScenePalette;
  /** Lido a cada quadro: posição e direção atuais. */
  getState: () => { x: number; z: number; dir: number; moving: boolean; seated?: boolean };
  /** Cor do anel de status no chão (agentes) ou destaque do próprio jogador. */
  ring?: string | null;
  pulse?: boolean;
  typing?: boolean;
  seated?: boolean;
  onClick?: () => void;
}

/** Avatar no estilo do mundo escolhido: blocos em pixel art ou o peão da maquete. */
export function Avatar(props: AvatarProps) {
  return useWorldStyle((s) => s.style) === 'pixel' ? <PixelAvatar {...props} /> : <PawnAvatar {...props} />;
}

/** Peão minimalista: cápsula na cor da pessoa, cabeça neutra, um ponto indicando a frente. */
function PawnAvatar({ anchorId, color, p, getState, ring, pulse, typing, seated, onClick }: AvatarProps) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const t = useRef(0);
  const stateRef = useRef(getState);
  stateRef.current = getState;
  useEffect(() => registerAnchor(anchorId, () => stateRef.current()), [anchorId]);

  useFrame((_, dt) => {
    const s = stateRef.current();
    const g = root.current;
    if (!g) return;
    g.position.x = s.x;
    g.position.z = s.z;
    let diff = s.dir - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * Math.min(1, dt * 12);
    t.current += dt * (s.moving ? 11 : 0);
    if (body.current) {
      const bob = s.moving ? Math.abs(Math.sin(t.current)) * 0.07 : Math.sin(performance.now() / (typing ? 140 : 700)) * (typing ? 0.02 : 0.008);
      body.current.position.y = bob + ((s.seated ?? seated) ? -0.12 : 0);
      body.current.rotation.z = s.moving ? Math.sin(t.current) * 0.05 : 0;
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
        <circleGeometry args={[0.36, 32]} />
        <meshBasicMaterial color="#000" transparent opacity={p.shadow} depthWrite={false} />
      </mesh>
      {ring && (
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
          <ringGeometry args={[0.44, 0.5, 48]} />
          <meshBasicMaterial color={ring} transparent opacity={1} depthWrite={false} />
        </mesh>
      )}
      <group ref={body}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <capsuleGeometry args={[0.24, 0.42, 8, 20]} />
          <meshStandardMaterial color={color} roughness={0.75} />
        </mesh>
        <mesh position={[0, 1.13, 0]} castShadow>
          <sphereGeometry args={[0.2, 24, 16]} />
          <meshStandardMaterial color={p.skin} roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.13, 0.19]}>
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshBasicMaterial color={p.screen} />
        </mesh>
      </group>
    </group>
  );
}
