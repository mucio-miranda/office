import { useState } from 'react';
import type { Furniture } from './layout';

/** Móveis low-poly feitos só com primitivas: leve, sem assets externos, fácil de recolorir pelo tema. */
export function FurnitureMesh({ f, accent, onUse }: { f: Furniture; accent: string; onUse?: (f: Furniture) => void }) {
  const [hover, setHover] = useState(false);
  const interactive = !!(f.panel || f.label);
  const glow = hover && interactive ? 0.35 : 0;
  const handlers = interactive
    ? {
        onPointerOver: (e: any) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; },
        onPointerOut: () => { setHover(false); document.body.style.cursor = ''; },
        onClick: (e: any) => { e.stopPropagation(); onUse?.(f); },
      }
    : {};
  const mat = (color: string, extra: Record<string, unknown> = {}) => (
    <meshStandardMaterial color={color} emissive={accent} emissiveIntensity={glow} roughness={0.8} {...extra} />
  );

  const body = (() => {
    switch (f.kind) {
      case 'mesa':
        return (
          <group>
            <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
              <boxGeometry args={[f.w ?? 2.2, 0.08, f.d ?? 1.1]} />
              {mat('#c8a27a')}
            </mesh>
            {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
              <mesh key={i} position={[sx * ((f.w ?? 2.2) / 2 - 0.08), 0.37, sz * ((f.d ?? 1.1) / 2 - 0.08)]} castShadow>
                <boxGeometry args={[0.07, 0.74, 0.07]} />
                {mat('#3b3b45')}
              </mesh>
            ))}
            {/* monitor */}
            <mesh position={[0, 1.08, -0.3]} castShadow>
              <boxGeometry args={[0.9, 0.55, 0.05]} />
              {mat('#1d1d26')}
            </mesh>
            <mesh position={[0, 1.08, -0.27]}>
              <planeGeometry args={[0.82, 0.47]} />
              <meshBasicMaterial color={accent} transparent opacity={0.55} />
            </mesh>
            <mesh position={[0, 0.82, -0.3]}>
              <boxGeometry args={[0.1, 0.12, 0.1]} />
              {mat('#1d1d26')}
            </mesh>
            {/* cadeira */}
            <mesh position={[0, 0.48, 0.95]} castShadow>
              <boxGeometry args={[0.55, 0.08, 0.55]} />
              {mat('#3b3b45')}
            </mesh>
            <mesh position={[0, 0.8, 1.2]} castShadow>
              <boxGeometry args={[0.55, 0.6, 0.08]} />
              {mat('#3b3b45')}
            </mesh>
          </group>
        );
      case 'mesa-reuniao':
        return (
          <group>
            <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
              <boxGeometry args={[f.w ?? 6, 0.1, f.d ?? 2.6]} />
              {mat('#f4f1ea')}
            </mesh>
            <mesh position={[0, 0.37, 0]}>
              <boxGeometry args={[(f.w ?? 6) * 0.7, 0.74, 0.3]} />
              {mat('#3b3b45')}
            </mesh>
            {Array.from({ length: 6 }).map((_, i) => {
              const side = i < 3 ? -1 : 1;
              const x = ((i % 3) - 1) * 1.8;
              return (
                <mesh key={i} position={[x, 0.5, side * ((f.d ?? 2.6) / 2 + 0.45)]} castShadow>
                  <boxGeometry args={[0.55, 0.5, 0.55]} />
                  {mat(accent)}
                </mesh>
              );
            })}
          </group>
        );
      case 'sofa':
        return (
          <group>
            <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
              <boxGeometry args={[2.6, 0.45, 1]} />
              {mat(accent)}
            </mesh>
            <mesh position={[0, 0.7, 0.4]} castShadow>
              <boxGeometry args={[2.6, 0.6, 0.25]} />
              {mat(accent)}
            </mesh>
          </group>
        );
      case 'planta':
        return (
          <group>
            <mesh position={[0, 0.25, 0]} castShadow>
              <cylinderGeometry args={[0.28, 0.22, 0.5, 8]} />
              {mat('#d9d2c5')}
            </mesh>
            <mesh position={[0, 0.95, 0]} castShadow>
              <icosahedronGeometry args={[0.55, 0]} />
              {mat('#4caf6a', { flatShading: true })}
            </mesh>
          </group>
        );
      case 'quadro':
        return (
          <group position={[0, 1.6, 0]}>
            <mesh castShadow>
              <boxGeometry args={[f.w ?? 3, 1.6, 0.08]} />
              {mat('#ffffff')}
            </mesh>
            {Array.from({ length: 5 }).map((_, i) => (
              <mesh key={i} position={[((i - 2) * (f.w ?? 3)) / 5.6, 0.1, 0.05]}>
                <planeGeometry args={[(f.w ?? 3) / 6.5, 1.1]} />
                <meshBasicMaterial color={['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#c3c3c3'][i]} transparent opacity={0.7} />
              </mesh>
            ))}
          </group>
        );
      case 'calendario':
        return (
          <group position={[0, 1.7, 0]}>
            <mesh castShadow>
              <boxGeometry args={[1.2, 1.3, 0.06]} />
              {mat('#ffffff')}
            </mesh>
            <mesh position={[0, 0.5, 0.04]}>
              <planeGeometry args={[1.2, 0.3]} />
              <meshBasicMaterial color={accent} />
            </mesh>
          </group>
        );
      case 'tv':
        return (
          <group position={[0, 1.7, 0]}>
            <mesh castShadow>
              <boxGeometry args={[f.w ?? 3, (f.w ?? 3) * 0.56, 0.08]} />
              {mat('#111118')}
            </mesh>
            <mesh position={[0, 0, 0.05]}>
              <planeGeometry args={[(f.w ?? 3) * 0.94, (f.w ?? 3) * 0.5]} />
              <meshBasicMaterial color={hover ? accent : '#2b2f55'} />
            </mesh>
          </group>
        );
      case 'balcao':
        return (
          <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
            <boxGeometry args={[f.w ?? 5, 1.1, f.d ?? 1.1]} />
            {mat('#f8f6f2')}
          </mesh>
        );
      case 'cafeteira':
        return (
          <mesh position={[0, 1.35, 0]} castShadow>
            <boxGeometry args={[0.45, 0.5, 0.4]} />
            {mat('#2d2d33')}
          </mesh>
        );
      case 'cofre':
        return (
          <group>
            <mesh position={[0, 0.55, 0]} castShadow>
              <boxGeometry args={[1, 1.1, 1]} />
              {mat('#5a6270', { metalness: 0.5 })}
            </mesh>
            <mesh position={[0, 0.6, 0.51]}>
              <circleGeometry args={[0.18, 16]} />
              <meshBasicMaterial color="#ffd166" />
            </mesh>
          </group>
        );
      case 'estante':
        return (
          <group>
            <mesh position={[0, 1, 0]} castShadow>
              <boxGeometry args={[2.4, 2, 0.6]} />
              {mat('#b8946b')}
            </mesh>
            {[0.5, 1.1, 1.7].map((y, i) => (
              <mesh key={i} position={[0, y, 0.31]}>
                <planeGeometry args={[2.2, 0.4]} />
                <meshBasicMaterial color={['#ef476f', '#118ab2', '#06d6a0'][i]} />
              </mesh>
            ))}
          </group>
        );
      case 'tapete':
        return (
          <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[f.w ?? 4, f.d ?? 3]} />
            <meshStandardMaterial color={f.color ?? '#d9c7b0'} />
          </mesh>
        );
      case 'luminaria':
        return (
          <group>
            <mesh position={[0, 1, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 2]} />
              {mat('#222')}
            </mesh>
            <mesh position={[0, 2, 0]}>
              <coneGeometry args={[0.3, 0.35, 12, 1, true]} />
              <meshBasicMaterial color="#fff3c4" />
            </mesh>
            <pointLight position={[0, 1.8, 0]} intensity={4} distance={6} color="#ffd9a0" />
          </group>
        );
      default:
        return null;
    }
  })();

  return (
    <group position={[f.x, 0, f.z]} rotation={[0, f.rot ?? 0, 0]} {...handlers}>
      {body}
    </group>
  );
}
