import { useEffect } from 'react';
import { FOOTPRINT, GROW, PLAN, type Rect } from '@office/shared';
import { useStore } from '../../lib/store';
import { BASE_ROOM_IDS, BOUNDS, customRects } from '../layout';
import { endDrag, hitRoom, moveDrag, rectOf, startDrag, usePlan } from './plan';

/** Moldura de uma sala no chão (quatro faixas finas). */
function Frame({ r, color, y = 0.05, t = 0.18 }: { r: Rect; color: string; y?: number; t?: number }) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const bars: [number, number, number, number][] = [[cx, r.z0, w, t], [cx, r.z1, w, t], [r.x0, cz, t, d], [r.x1, cz, t, d]];
  return (
    <group raycast={() => null}>
      {bars.map(([x, z, bw, bd], i) => (
        <mesh key={i} position={[x, y, z]} raycast={() => null}>
          <boxGeometry args={[bw, 0.06, bd]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Camada da Planta por cima do chão a leste do prédio: arrastar dentro de uma sala nova move, arrastar a borda
 * aumenta ou diminui, arrastar no vazio desenha uma sala nova. Prévia verde se cabe, vermelha se não.
 */
export function PlanLayer() {
  useStore((s) => s.rooms);
  useStore((s) => s.baseRooms);
  const drag = usePlan((s) => s.drag);
  const sel = usePlan((s) => s.sel);
  const problem = usePlan((s) => s.problem);
  // o prédio (salas originais) e a área a leste dele (salas novas)
  // inclui a faixa da frente e da direita para onde o prédio pode crescer
  const x0 = Math.max(GROW.x0, Math.min(BOUNDS.x0, FOOTPRINT.x0) - 20), x1 = Math.min(GROW.x1 + 20, Math.max(BOUNDS.x1, PLAN.x0) + 30);
  const z0 = Math.max(GROW.z0, Math.min(BOUNDS.z0, FOOTPRINT.z0) - 20), z1 = Math.min(GROW.z1, Math.max(BOUNDS.z1, PLAN.z1) + 20);
  useEffect(() => {
    const up = () => { if (usePlan.getState().drag) endDrag(); };
    addEventListener('pointerup', up);
    return () => { removeEventListener('pointerup', up); usePlan.setState({ drag: null }); document.body.style.cursor = ''; };
  }, []);
  const at = (e: any) => ({ x: e.point.x, z: e.point.z });
  const cursor = (e: any) => {
    if (usePlan.getState().drag) return;
    const h = hitRoom(at(e));
    document.body.style.cursor = !h ? 'crosshair' : !h.onEdge ? 'move'
      : (h.edges.l || h.edges.r) && (h.edges.t || h.edges.b) ? ((h.edges.l && h.edges.t) || (h.edges.r && h.edges.b) ? 'nwse-resize' : 'nesw-resize')
      : h.edges.l || h.edges.r ? 'ew-resize' : 'ns-resize';
  };
  const ok = !problem;
  return (
    <group>
      {/* área livre para salas novas: grade de 1 m */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, 0.035, (z0 + z1) / 2]}
        onPointerDown={(e: any) => { if (e.button !== 0) return; e.stopPropagation(); startDrag(at(e)); }}
        onPointerMove={(e: any) => { if (usePlan.getState().drag) moveDrag(at(e)); else cursor(e); }}
        onPointerOut={() => { if (!usePlan.getState().drag) document.body.style.cursor = ''; }}
        onClick={(e: any) => e.stopPropagation()}>
        <planeGeometry args={[x1 - x0, z1 - z0]} />
        <meshBasicMaterial color="#4dd2ff" transparent opacity={0.06} depthWrite={false} />
      </mesh>
      {[...customRects.entries()].map(([id, r]) => (
        drag && drag.mode !== 'novo' && drag.id === id ? null : <Frame key={id} r={r} color={sel === id ? '#ffd23f' : '#4dd2ff'} />
      ))}
      {/* salas originais: moldura laranja (ficam dentro do prédio) */}
      {BASE_ROOM_IDS.map((id) => {
        const r = rectOf(id);
        return !r || (drag && drag.mode !== 'novo' && drag.id === id) ? null : <Frame key={id} r={r} color={sel === id ? '#ffd23f' : '#ff9f43'} t={0.14} />;
      })}
      {drag && drag.rect.x1 - drag.rect.x0 >= 1 && drag.rect.z1 - drag.rect.z0 >= 1 && (
        <group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(drag.rect.x0 + drag.rect.x1) / 2, 0.06, (drag.rect.z0 + drag.rect.z1) / 2]} raycast={() => null}>
            <planeGeometry args={[drag.rect.x1 - drag.rect.x0, drag.rect.z1 - drag.rect.z0]} />
            <meshBasicMaterial color={ok ? '#7cfc8a' : '#ff4d4d'} transparent opacity={0.28} depthWrite={false} />
          </mesh>
          <Frame r={drag.rect} color={ok ? '#3fcf5a' : '#ff4d4d'} y={0.08} t={0.24} />
        </group>
      )}
    </group>
  );
}
