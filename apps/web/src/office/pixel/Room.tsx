import { useMemo } from 'react';
import { useTheme, type PixelPalette } from '../../lib/theme';
import { BOUNDS, ROOMS, WALLS, WALL_T } from '../layout';
import { roomFloors, useDecor } from '../decor/state';
import { FLOOR_MATERIAL_M, floorMaterialTexture } from './floors';
import { PBox, tiled, useFloorTextures, wallpaperTexture } from './kit';

/** As paredes do fundo (vistas de frente pela câmera) sobem inteiras; as internas ficam baixas. */
const BACK_H = 2.6;
const LOW_H = 1.05;
const isBack = (w: { x: number; z: number; w: number; d: number }) =>
  Math.abs(w.z - BOUNDS.z0) < 0.2 || Math.abs(w.x - BOUNDS.x0) < 0.2;

/**
 * Chão e paredes em pixel art: a laje do prédio com borda grossa (como a base dos quartos do Habbo),
 * o piso de cada sala com a sua textura e as paredes com papel de parede, lambri e acabamento no topo.
 */
export function PixelRoom({ p, onWalk, onHover, onLeave }: { p: PixelPalette; onWalk: (e: any) => void; onHover: (e: any) => void; onLeave: () => void }) {
  const floors = useFloorTextures(p, ROOMS);
  const items = useDecor((s) => s.items);
  const ghost = useDecor((s) => s.ghost);
  const chosen = useMemo(() => roomFloors(items, ghost), [items, ghost]);
  const night = useTheme((s) => s.theme) === 'dark';
  const walls = useMemo(() => WALLS.map((w) => {
    const h = isBack(w) ? BACK_H : LOW_H;
    const t = wallpaperTexture(p).clone();
    // 1 repetição por metro de comprimento e a cada 2 m de altura
    t.repeat.set(Math.max(w.w, w.d), h / 2);
    t.needsUpdate = true;
    return { ...w, h, t };
  }), [p]);
  const W = BOUNDS.x1 - BOUNDS.x0;
  const D = BOUNDS.z1 - BOUNDS.z0;

  return (
    <group>
      {/* chão infinito escuro, onde também dá para clicar e andar */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.62, 0]} onClick={onWalk}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial color={p.void} />
      </mesh>
      {/* laje do prédio: a borda grossa aparece na frente e à direita */}
      {/* o topo da laje fica 3 cm abaixo do piso: sem disputa de profundidade entre os dois */}
      <PBox p={p} pos={[0, -0.33, 0]} size={[W + 0.6, 0.6, D + 0.6]} color={p.slab} cast={false} />
      <PBox p={p} pos={[0, -0.59, 0]} size={[W + 0.9, 0.1, D + 0.9]} color={p.slabEdge} cast={false} />
      {ROOMS.map((r) => {
        const mat = chosen[r.id] ? floorMaterialTexture(chosen[r.id]) : null;
        const map = mat ? tiled(mat, (r.x1 - r.x0) / FLOOR_MATERIAL_M, (r.z1 - r.z0) / FLOOR_MATERIAL_M) : floors[r.id];
        return (
          <mesh key={r.id} rotation={[-Math.PI / 2, 0, 0]} position={[(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2]} receiveShadow onClick={onWalk} onPointerMove={onHover} onPointerOut={onLeave}>
            <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
            {/* os pisos escolhidos têm cores fixas: à noite o material escurece */}
            <meshLambertMaterial map={map} color={mat && night ? '#8a8a96' : '#ffffff'} />
          </mesh>
        );
      })}
      {walls.map((w, i) => (
        <group key={i}>
          <PBox p={p} pos={[w.x, w.h / 2, w.z]} size={[w.w, w.h, w.d]} color="#ffffff" map={w.t} />
          {/* acabamento no topo, um pouco mais largo que a parede */}
          <PBox p={p} pos={[w.x, w.h + 0.04, w.z]} size={[w.w + (w.w > w.d ? 0 : 0.1), 0.08, w.d + (w.d > w.w ? 0 : 0.1)]} color={p.wallTop} />
        </group>
      ))}
      {/* rodapé das paredes do fundo */}
      {walls.filter((w) => w.h === BACK_H).map((w, i) => (
        <PBox key={`r${i}`} p={p} pos={[w.x + (w.w > w.d ? 0 : WALL_T), 0.08, w.z + (w.w > w.d ? WALL_T : 0)]} size={[w.w > w.d ? w.w : 0.04, 0.16, w.w > w.d ? 0.04 : w.d]} color={p.baseboard} outline={false} />
      ))}
    </group>
  );
}
