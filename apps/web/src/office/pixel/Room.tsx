import { useMemo } from 'react';
import { useTheme, type PixelPalette } from '../../lib/theme';
import { useStore } from '../../lib/store';
import { BOUNDS, ROOMS, WALLS, WALL_T } from '../layout';
import { applyWall, useWallTool } from '../decor/walls';
import { roomFloors, useDecor } from '../decor/state';
import { FLOOR_MATERIAL_M, GLASS_FLOORS, floorMaterialTexture } from './floors';
import { PBox, tiled, useFloorTextures, wallpaperTexture } from './kit';

/** As paredes do fundo (vistas de frente pela câmera) sobem inteiras; as internas ficam baixas. */
const BACK_H = 2.6;
const LOW_H = 1.05;
const isBack = (w: { x: number; z: number; w: number; d: number }) =>
  Math.abs(w.z - BOUNDS.z0) < 0.2 || Math.abs(w.x - BOUNDS.x0) < 0.2;
/** A laje principal; os anexos têm laje própria, para o vazio entre eles continuar vazio. */
const MAIN_W = 54, MAIN_D = 36, MAIN_X1 = 27;
const SOLID_WALL: Record<string, string> = { branca: '#f3f3f1', preta: '#1f2023', concreto: '#a3a29d', madeira: '#99693f' };
const GLASS_WALL: Record<string, { color: string; opacity: number; frame: string }> = {
  vidro: { color: '#bfe6f5', opacity: 0.28, frame: '#8d99a3' },
  'vidro-fume': { color: '#39444c', opacity: 0.5, frame: '#1b2024' },
};

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
  const styles = useStore((s) => s.walls);
  const tool = useWallTool((s) => s.tool);
  const wallClick = (key: string) => (tool ? { onClick: (e: any) => { e.stopPropagation(); applyWall([key], tool); } } : {});
  const walls = useMemo(() => WALLS.map((w) => {
    const h = isBack(w) ? BACK_H : LOW_H;
    const t = wallpaperTexture(p).clone();
    // 1 repetição por metro de comprimento e a cada 2 m de altura
    t.repeat.set(Math.max(w.w, w.d), h / 2);
    t.needsUpdate = true;
    return { ...w, h, t };
  }), [p]);

  return (
    <group>
      {/* chão infinito escuro, onde também dá para clicar e andar */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.62, 0]} onClick={onWalk}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial color={p.void} />
      </mesh>
      {/* laje do prédio: a borda grossa aparece na frente e à direita */}
      {/* o topo da laje fica 3 cm abaixo do piso: sem disputa de profundidade entre os dois */}
      <PBox p={p} pos={[0, -0.33, 0]} size={[MAIN_W + 0.6, 0.6, MAIN_D + 0.6]} color={p.slab} cast={false} />
      <PBox p={p} pos={[0, -0.59, 0]} size={[MAIN_W + 0.9, 0.1, MAIN_D + 0.9]} color={p.slabEdge} cast={false} />
      {ROOMS.filter((r) => r.x0 >= MAIN_X1).map((r) => (
        <group key={`laje-${r.id}`}>
          <PBox p={p} pos={[(r.x0 + r.x1) / 2, -0.33, (r.z0 + r.z1) / 2]} size={[r.x1 - r.x0 + 0.6, 0.6, r.z1 - r.z0 + 0.6]} color={p.slab} cast={false} />
          <PBox p={p} pos={[(r.x0 + r.x1) / 2, -0.59, (r.z0 + r.z1) / 2]} size={[r.x1 - r.x0 + 0.9, 0.1, r.z1 - r.z0 + 0.9]} color={p.slabEdge} cast={false} />
        </group>
      ))}
      {ROOMS.map((r) => {
        const mat = chosen[r.id] ? floorMaterialTexture(chosen[r.id]) : null;
        const map = mat ? tiled(mat, (r.x1 - r.x0) / FLOOR_MATERIAL_M, (r.z1 - r.z0) / FLOOR_MATERIAL_M) : floors[r.id];
        const glass = GLASS_FLOORS.has(chosen[r.id] ?? '');
        return (
          <mesh key={`${r.id}:${glass}`} rotation={[-Math.PI / 2, 0, 0]} position={[(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2]} receiveShadow onClick={onWalk} onPointerMove={onHover} onPointerOut={onLeave}>
            <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
            {/* os pisos escolhidos têm cores fixas: à noite o material escurece */}
            <meshLambertMaterial map={map} color={mat && night ? '#8a8a96' : '#ffffff'} transparent={glass} opacity={glass ? 0.72 : 1} />
          </mesh>
        );
      })}
      {walls.map((w) => {
        const type = styles[w.key] ?? 'alvenaria';
        if (type === 'removida') {
          // sem parede: só aparece com a ferramenta aberta, para dar para colocar de volta
          if (!tool) return null;
          return (
            <mesh key={w.key} position={[w.x, 0.5, w.z]} {...wallClick(w.key)}>
              <boxGeometry args={[Math.max(w.w, 0.14), 1, Math.max(w.d, 0.14)]} />
              <meshBasicMaterial color="#ff5c8a" transparent opacity={0.18} depthWrite={false} />
            </mesh>
          );
        }
        const glass = GLASS_WALL[type];
        if (glass) return (
          <group key={w.key} {...wallClick(w.key)}>
            <mesh position={[w.x, w.h / 2, w.z]}>
              <boxGeometry args={[w.w, w.h, w.d]} />
              <meshStandardMaterial color={glass.color} transparent opacity={glass.opacity} roughness={0.08} metalness={0.2} depthWrite={false} />
            </mesh>
            <PBox p={p} pos={[w.x, w.h + 0.02, w.z]} size={[w.w, 0.04, w.d + 0.02]} color={glass.frame} outline={false} />
            <PBox p={p} pos={[w.x, 0.02, w.z]} size={[w.w, 0.04, w.d + 0.02]} color={glass.frame} outline={false} cast={false} />
          </group>
        );
        return (
          <group key={w.key} {...wallClick(w.key)}>
            <PBox p={p} pos={[w.x, w.h / 2, w.z]} size={[w.w, w.h, w.d]} color={SOLID_WALL[type] ?? '#ffffff'} map={SOLID_WALL[type] ? undefined : w.t} />
            {/* acabamento no topo, um pouco mais largo que a parede */}
            <PBox p={p} pos={[w.x, w.h + 0.04, w.z]} size={[w.w + (w.w > w.d ? 0 : 0.1), 0.08, w.d + (w.d > w.w ? 0 : 0.1)]} color={SOLID_WALL[type] ? SOLID_WALL[type] : p.wallTop} />
          </group>
        );
      })}
      {/* rodapé das paredes do fundo */}
      {walls.filter((w) => w.h === BACK_H && (styles[w.key] ?? 'alvenaria') === 'alvenaria').map((w, i) => (
        <PBox key={`r${i}`} p={p} pos={[w.x + (w.w > w.d ? 0 : WALL_T), 0.08, w.z + (w.w > w.d ? WALL_T : 0)]} size={[w.w > w.d ? w.w : 0.04, 0.16, w.w > w.d ? 0.04 : w.d]} color={p.baseboard} outline={false} />
      ))}
    </group>
  );
}
