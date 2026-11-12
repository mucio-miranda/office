import { useEffect, useMemo } from 'react';
import { baseOf, useTheme, type PixelPalette } from '../../lib/theme';
import { useStore } from '../../lib/store';
import { BOUNDS, PIECE, ROOMS, WALL_T, pieceOf, wallRuns } from '../layout';
import { applyWall, dragKeys, useWallDrag, useWallTool } from '../decor/walls';
import { roomFloors, useDecor } from '../decor/state';
import { FLOOR_MATERIAL_M, GLASS_FLOORS, floorMaterialTexture } from './floors';
import { PBox, tiled, useFloorTextures, wallFinishTexture, wallpaperTexture } from './kit';

/** As paredes do fundo (vistas de frente pela câmera) sobem inteiras; as internas ficam baixas. */
const BACK_H = 2.6;
const LOW_H = 1.05;
const isBack = (w: { x: number; z: number; w: number; d: number }) =>
  Math.abs(w.z - BOUNDS.z0) < 0.2 || Math.abs(w.x - BOUNDS.x0) < 0.2;
/** A laje principal; os anexos têm laje própria, para o vazio entre eles continuar vazio. */
const MAIN_W = 54, MAIN_D = 36, MAIN_X1 = 27;
/** Cor do arremate no topo de cada acabamento (a alvenaria usa a madeira da paleta). */
const WALL_TOP: Record<string, string> = {
  reboco: '#d9d1c4', branca: '#e4e4e0', preta: '#141518', verde: '#83977e', terracota: '#a95c3e', concreto: '#8f8e89', tijolo: '#8a4430', azulejo: '#b9c2c7', madeira: '#7a5233',
};
/** Textura com a repetição certa para o tamanho do trecho (cache por acabamento e tamanho). */
const finishCache = new Map<string, import('three').Texture>();
function finishFor(kind: string, len: number, h: number) {
  const key = `${kind}:${len}:${h}`;
  let t = finishCache.get(key);
  if (!t) { t = wallFinishTexture(kind).clone(); t.repeat.set(len, h / 2); t.needsUpdate = true; finishCache.set(key, t); }
  return t;
}
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
  const night = baseOf(useTheme((s) => s.theme)) === 'dark';
  const styles = useStore((s) => s.walls);
  const mapRev = useStore((s) => s.mapRev);
  const tool = useWallTool((s) => s.tool);
  const mode = useWallTool((s) => s.mode);
  // pintar: o clique troca o trecho inteiro (pedaços vizinhos do mesmo acabamento)
  const wallClick = (keys: string[]) => (tool && mode === 'pintar' ? { onClick: (e: any) => { e.stopPropagation(); applyWall(keys, tool); } } : {});
  const walls = useMemo(() => wallRuns(styles).map((w) => {
    const h = isBack(w) ? BACK_H : LOW_H;
    const t = wallpaperTexture(p).clone();
    // 1 repetição por metro de comprimento e a cada 2 m de altura
    t.repeat.set(Math.max(w.w, w.d), h / 2);
    t.needsUpdate = true;
    return { ...w, h, t };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [p, styles, mapRev]);

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
        const type = w.type;
        if (type === 'removida') {
          // sem parede: só aparece com a ferramenta aberta, para dar para colocar de volta
          if (!tool) return null;
          return (
            <mesh key={w.key} position={[w.x, 0.5, w.z]} {...wallClick(w.keys)}>
              <boxGeometry args={[Math.max(w.w, 0.14), 1, Math.max(w.d, 0.14)]} />
              <meshBasicMaterial color="#ff5c8a" transparent opacity={0.18} depthWrite={false} />
            </mesh>
          );
        }
        const glass = GLASS_WALL[type];
        if (glass) return (
          <group key={w.key} {...wallClick(w.keys)}>
            <mesh position={[w.x, w.h / 2, w.z]}>
              <boxGeometry args={[w.w, w.h, w.d]} />
              <meshStandardMaterial color={glass.color} transparent opacity={glass.opacity} roughness={0.08} metalness={0.2} depthWrite={false} />
            </mesh>
            <PBox p={p} pos={[w.x, w.h + 0.02, w.z]} size={[w.w, 0.04, w.d + 0.02]} color={glass.frame} outline={false} />
            <PBox p={p} pos={[w.x, 0.02, w.z]} size={[w.w, 0.04, w.d + 0.02]} color={glass.frame} outline={false} cast={false} />
          </group>
        );
        return (
          <group key={w.key} {...wallClick(w.keys)}>
            <PBox p={p} pos={[w.x, w.h / 2, w.z]} size={[w.w, w.h, w.d]} color={night && type !== 'alvenaria' ? '#9a9aa6' : '#ffffff'} map={type === 'alvenaria' ? w.t : finishFor(type, Math.max(w.w, w.d), w.h)} />
            {/* acabamento no topo, um pouco mais largo que a parede */}
            <PBox p={p} pos={[w.x, w.h + 0.04, w.z]} size={[w.w + (w.w > w.d ? 0 : 0.1), 0.08, w.d + (w.d > w.w ? 0 : 0.1)]} color={WALL_TOP[type] ?? p.wallTop} />
          </group>
        );
      })}
      {/* rodapé das paredes do fundo */}
      {walls.filter((w) => w.h === BACK_H && w.type === 'alvenaria').map((w, i) => (
        <PBox key={`r${i}`} p={p} pos={[w.x + (w.w > w.d ? 0 : WALL_T), 0.08, w.z + (w.w > w.d ? WALL_T : 0)]} size={[w.w > w.d ? w.w : 0.04, 0.16, w.w > w.d ? 0.04 : w.d]} color={p.baseboard} outline={false} />
      ))}
      {tool && mode !== 'pintar' && <WallDrawLayer erase={mode === 'apagar'} />}
    </group>
  );
}

/**
 * Desenhar e apagar paredes arrastando pelo chão: grade de meio metro por cima do prédio, prévia verde (nova) ou
 * vermelha (sai) e, ao soltar, os pedaços mudam de uma vez.
 */
function WallDrawLayer({ erase }: { erase: boolean }) {
  const start = useWallDrag((s) => s.start);
  const keys = useWallDrag((s) => s.keys);
  const x0 = BOUNDS.x0, x1 = BOUNDS.x1, z0 = BOUNDS.z0, z1 = BOUNDS.z1;
  const grid = useMemo(() => {
    const pts: number[] = [];
    for (let x = x0; x <= x1 + 1e-6; x += PIECE) pts.push(x, 0.015, z0, x, 0.015, z1);
    for (let z = z0; z <= z1 + 1e-6; z += PIECE) pts.push(x0, 0.015, z, x1, 0.015, z);
    return new Float32Array(pts);
  }, [x0, x1, z0, z1]);
  const at = (e: any) => ({ x: e.point.x, z: e.point.z });
  const finish = () => {
    const { start: s, keys: k } = useWallDrag.getState();
    if (!s) return;
    useWallDrag.setState({ start: null, keys: [] });
    const { tool, mode } = useWallTool.getState();
    if (tool && k.length) applyWall(k, mode === 'apagar' ? 'removida' : tool);
  };
  // soltar o botão fora do prédio também termina o arraste
  useEffect(() => {
    addEventListener('pointerup', finish);
    return () => { removeEventListener('pointerup', finish); useWallDrag.setState({ start: null, keys: [] }); };
  }, []);
  const move = (e: any) => {
    const s = useWallDrag.getState().start;
    if (!s) return;
    const { tool, mode } = useWallTool.getState();
    if (tool) useWallDrag.setState({ keys: dragKeys(s, at(e), mode, tool) });
  };
  return (
    <group>
      <lineSegments raycast={() => null}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[grid, 3]} /></bufferGeometry>
        <lineBasicMaterial color={erase ? '#ff5c8a' : '#4dd2ff'} transparent opacity={0.22} depthWrite={false} />
      </lineSegments>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, 0.02, (z0 + z1) / 2]}
        onPointerDown={(e: any) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const { tool, mode } = useWallTool.getState();
          if (tool) useWallDrag.setState({ start: at(e), keys: dragKeys(at(e), at(e), mode, tool) });
        }}
        onPointerMove={move}
        onClick={(e: any) => e.stopPropagation()}>
        <planeGeometry args={[x1 - x0, z1 - z0]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {start && keys.map((k) => {
        const w = pieceOf(k)!;
        return (
          <mesh key={k} position={[w.x, 0.5, w.z]} raycast={() => null}>
            <boxGeometry args={[Math.max(w.w, 0.16), 1, Math.max(w.d, 0.16)]} />
            <meshBasicMaterial color={erase ? '#ff4d4d' : '#7cfc8a'} transparent opacity={0.55} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}
