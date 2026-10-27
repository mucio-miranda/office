import { useState } from 'react';
import type { Furniture } from './layout';
import { useWorldStyle, type ScenePalette } from '../lib/theme';
import { PixelFurniture } from './pixel/Furniture';

/**
 * Móveis em estilo "maquete de arquitetura": volumes simples, tons neutros,
 * sem texturas. A cor de destaque só aparece no hover de algo interativo.
 */
export function FurnitureMesh(props: { f: Furniture; p: ScenePalette; onUse?: (f: Furniture) => void }) {
  return useWorldStyle((s) => s.style) === 'pixel' ? <PixelFurniture f={props.f} onUse={props.onUse} /> : <MaqueteFurniture {...props} />;
}

function MaqueteFurniture({ f, p, onUse }: { f: Furniture; p: ScenePalette; onUse?: (f: Furniture) => void }) {
  const [hover, setHover] = useState(false);
  const interactive = !!(f.panel || f.label);
  const handlers = interactive
    ? {
        onPointerOver: (e: any) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; },
        onPointerOut: () => { setHover(false); document.body.style.cursor = ''; },
        onClick: (e: any) => { e.stopPropagation(); onUse?.(f); },
      }
    : {};
  const mat = (c: string) => <meshStandardMaterial color={hover && interactive ? p.hover : c} roughness={0.9} metalness={0} />;
  const box = (pos: [number, number, number], size: [number, number, number], c: string, key?: string | number) => (
    <mesh key={key} position={pos} castShadow receiveShadow>
      <boxGeometry args={size} />
      {mat(c)}
    </mesh>
  );

  const body = (() => {
    switch (f.kind) {
      case 'mesa': {
        const w = f.w ?? 2.2, d = f.d ?? 1.1;
        return (
          <group>
            {box([0, 0.72, 0], [w, 0.06, d], p.furniture)}
            {box([-w / 2 + 0.05, 0.36, 0], [0.05, 0.72, d - 0.1], p.furnitureDark)}
            {box([w / 2 - 0.05, 0.36, 0], [0.05, 0.72, d - 0.1], p.furnitureDark)}
            {box([0, 1.02, -0.3], [0.8, 0.48, 0.03], p.screen)}
            {box([0, 0.8, -0.3], [0.06, 0.14, 0.06], p.furnitureDark)}
            {box([0, 0.46, 0.95], [0.5, 0.06, 0.5], p.furnitureDark)}
          </group>
        );
      }
      case 'mesa-reuniao': {
        const w = f.w ?? 6, d = f.d ?? 2.6;
        return (
          <group>
            {box([0, 0.72, 0], [w, 0.06, d], p.furniture)}
            {box([0, 0.36, 0], [w * 0.6, 0.72, 0.2], p.furnitureDark)}
            {Array.from({ length: 6 }).map((_, i) =>
              box([((i % 3) - 1) * 1.8, 0.24, (i < 3 ? -1 : 1) * (d / 2 + 0.45)], [0.5, 0.48, 0.5], p.furnitureDark, i))}
          </group>
        );
      }
      case 'sofa':
        return (
          <group>
            {box([0, 0.22, 0], [2.6, 0.44, 1], p.furniture)}
            {box([0, 0.55, 0.4], [2.6, 0.5, 0.2], p.furniture)}
          </group>
        );
      case 'planta':
        return (
          <group>
            <mesh position={[0, 0.22, 0]} castShadow>
              <cylinderGeometry args={[0.24, 0.2, 0.44, 16]} />
              {mat(p.furniture)}
            </mesh>
            <mesh position={[0, 0.78, 0]} castShadow>
              <sphereGeometry args={[0.42, 20, 14]} />
              {mat(p.plant)}
            </mesh>
          </group>
        );
      case 'quadro':
        return (
          <group position={[0, 1.4, 0]}>
            {box([0, 0, 0], [f.w ?? 3, 1.3, 0.05], p.floor)}
            {Array.from({ length: 5 }).map((_, i) =>
              box([((i - 2) * (f.w ?? 3)) / 5.6, 0.05, 0.03], [(f.w ?? 3) / 7, 0.9, 0.01], p.furniture, i))}
          </group>
        );
      case 'calendario':
        return (
          <group position={[0, 1.5, 0]}>
            {box([0, 0, 0], [1.1, 1.1, 0.04], p.floor)}
            {box([0, 0.45, 0.025], [1.1, 0.2, 0.01], p.furnitureDark)}
          </group>
        );
      case 'tv': {
        const w = f.w ?? 3;
        return <group position={[0, 1.5, 0]}>{box([0, 0, 0], [w, w * 0.56, 0.05], p.screen)}</group>;
      }
      case 'balcao':
        return box([0, 0.5, 0], [f.w ?? 5, 1, f.d ?? 1.1], p.furniture);
      case 'cafeteira':
        return box([0, 1.2, 0], [0.4, 0.42, 0.36], p.screen);
      case 'cofre':
        return box([0, 0.5, 0], [0.9, 1, 0.9], p.furnitureDark);
      case 'estante':
        return (
          <group>
            {box([0, 0.9, 0], [2.4, 1.8, 0.5], p.furniture)}
            {[0.45, 1.05, 1.6].map((y, i) => box([0, y, 0.2], [2.2, 0.04, 0.2], p.furnitureDark, i))}
          </group>
        );
      case 'tapete':
        return (
          <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[f.w ?? 4, f.d ?? 3]} />
            <meshBasicMaterial color={p.floorAlt} />
          </mesh>
        );
      case 'luminaria':
        return (
          <group>
            {box([0, 0.9, 0], [0.04, 1.8, 0.04], p.furnitureDark)}
            <mesh position={[0, 1.85, 0]}>
              <sphereGeometry args={[0.16, 16, 12]} />
              <meshBasicMaterial color="#fff7e0" />
            </mesh>
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
