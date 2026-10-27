import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { LiveSession } from '@office/shared';
import { useStore } from '../lib/store';
import { useWorldStyle } from '../lib/theme';
import { useLiveFrame } from '../panels/Tools';
import { DESKS } from './layout';

/** Ferramentas de vídeo e áudio também aparecem na TV grande da ilha de edição. */
const VIDEO_TOOLS = new Set(['filmcraft', 'effectcraft', 'soundcraft']);
/** A TV da ilha de vídeo (mesmo lugar do móvel `tv` do layout). */
const ISLAND_TV = { x: 12, y: 1.5, z: -1.85 + 0.03, w: 3.9, h: 4 * 0.56 - 0.1 };

/** Textura que troca quando o próximo print termina de carregar (sem piscar). */
function useFrameTexture(s: LiveSession) {
  const url = useLiveFrame(s, false, 3000);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const current = useRef<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    new THREE.TextureLoader().load(url, (t) => {
      if (!alive) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace;
      current.current?.dispose();
      current.current = t;
      setTex(t);
    });
    return () => { alive = false; };
  }, [url]);
  useEffect(() => () => current.current?.dispose(), []);
  return tex;
}

function Screen({ s, pos, size, island }: { s: LiveSession; pos: [number, number, number]; size: [number, number]; island?: boolean }) {
  const open = useStore((st) => st.open);
  const tex = useFrameTexture(s);
  if (!tex) return null;
  // encaixa o print na tela sem distorcer (faixas pretas sobram nas bordas)
  const img = tex.image as HTMLImageElement;
  const ratio = img.width / img.height;
  const [w, h] = ratio > size[0] / size[1] ? [size[0], size[0] / ratio] : [size[1] * ratio, size[1]];
  return (
    <group position={pos}>
      <mesh position={[0, 0, -0.001]}>
        <planeGeometry args={size} />
        <meshBasicMaterial color="#000" />
      </mesh>
      <mesh
        onClick={(e) => { e.stopPropagation(); if (island) open('video', `live:${s.id}`); else open('agente', s.agentId); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = ''; }}
      >
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Espelho no mapa: o monitor da mesa de cada funcionário mostra o app que ele opera ao vivo,
 * e a TV da ilha de vídeo mostra a edição de vídeo em andamento. Clicar abre o painel dele.
 */
export function LiveScreens() {
  const { live, agents } = useStore();
  // no tema Pixel o monitor da mesa fica um pouco mais alto
  const monitorY = useWorldStyle((s) => s.style) === 'pixel' ? 1.08 : 1.02;
  const shown = live.filter((s) => s.status === 'ativa' || s.status === 'livre');
  // um monitor por funcionário: o app mais recente dele
  const byAgent = new Map<string, LiveSession>();
  for (const s of shown) if (!byAgent.has(s.agentId) || byAgent.get(s.agentId)!.startedAt < s.startedAt) byAgent.set(s.agentId, s);
  const tv = shown.filter((s) => VIDEO_TOOLS.has(s.toolId)).sort((a, b) => Number(b.status === 'ativa') - Number(a.status === 'ativa'))[0];
  return (
    <>
      {[...byAgent.values()].map((s) => {
        const a = agents.find((x) => x.id === s.agentId);
        if (!a) return null;
        const desk = DESKS[a.room];
        // o monitor da mesa fica 1,1 atrás da cadeira e 0,3 para dentro da mesa
        return <Screen key={s.id} s={s} pos={[desk.x, monitorY, desk.z - 1.1 - 0.3 + 0.017]} size={[0.76, 0.44]} />;
      })}
      {tv && <Screen key={`tv-${tv.id}`} s={tv} island pos={[ISLAND_TV.x, ISLAND_TV.y, ISLAND_TV.z]} size={[ISLAND_TV.w, ISLAND_TV.h]} />}
    </>
  );
}
