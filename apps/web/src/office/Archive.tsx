import { useState } from 'react';
import type { Client } from '@office/shared';
import { useStore } from '../lib/store';
import { usePixel, useWorldStyle, type ScenePalette } from '../lib/theme';
import { OutlineColor, PBox, canvasTexture, shade } from './pixel/kit';
import { ARCHIVE, ARCHIVE_SLOTS, type Furniture } from './layout';

/**
 * Arquivo dos clientes: uma fileira de arquivos de aço na parede do fundo da redação, um por cliente, com a
 * plaquinha do nome na gaveta de cima. Clicar abre o arquivo daquele cliente (documentos, fotos e vídeos da
 * pasta, com prévia). Sobrando cliente, o último armário vira "mais clientes" e abre a lista.
 */

const HOVER = '#ffe066';
/** Cores das etiquetas, na ordem em que os clientes foram cadastrados. */
const TAGS = ['#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#9b5cff', '#83c5be', '#e9c46a'];

/** Nome do cliente desenhado na plaquinha (canvas pequeno, pixel duro como o resto). */
const plate = (name: string, color: string) =>
  canvasTexture(`plaquinha:${name}:${color}`, 96, 24, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 96, 24);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 21, 96, 3);
    g.fillStyle = '#1d1d1f';
    g.font = 'bold 13px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const short = name.length > 11 ? `${name.slice(0, 10)}…` : name;
    g.fillText(short.toUpperCase(), 48, 12);
  });

export interface Cabinet { x: number; client: Client | null; more: number }

/** Os armários da fileira: um por cliente ativo; o último mostra quantos faltam quando não cabem todos. */
export function cabinets(clients: Client[]): Cabinet[] {
  const list = clients.filter((c) => c.status !== 'encerrado');
  const n = Math.min(ARCHIVE_SLOTS, Math.max(list.length, 1));
  const overflow = list.length > ARCHIVE_SLOTS;
  const step = ARCHIVE.w / ARCHIVE_SLOTS;
  const x0 = ARCHIVE.x - ARCHIVE.w / 2 + step / 2;
  return Array.from({ length: n }, (_, i) => ({
    x: x0 + i * step,
    client: overflow && i === n - 1 ? null : list[i] ?? null,
    more: overflow && i === n - 1 ? list.length - (n - 1) : 0,
  }));
}

export function openArchive(clientId?: string | null) {
  useStore.getState().open('arquivo', clientId ?? null);
}

export function ClientArchive({ f, p, onUse }: { f: Furniture; p: ScenePalette; onUse: (x: number, clientId: string | null) => void }) {
  const clients = useStore((s) => s.clients);
  const pixel = useWorldStyle((s) => s.style) === 'pixel';
  return (
    <group position={[0, 0, f.z]}>
      {cabinets(clients).map((c, i) => (
        <CabinetMesh key={c.client?.id ?? `livre${i}`} c={c} tag={c.client?.color || TAGS[i % TAGS.length]} pixel={pixel} sp={p} onUse={() => onUse(c.x, c.client?.id ?? null)} />
      ))}
    </group>
  );
}

function CabinetMesh({ c, tag, pixel, sp, onUse }: { c: Cabinet; tag: string; pixel: boolean; sp: ScenePalette; onUse: () => void }) {
  const p = usePixel();
  const [hover, setHover] = useState(false);
  const handlers = {
    onPointerOver: (e: any) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { setHover(false); document.body.style.cursor = ''; },
    onClick: (e: any) => { e.stopPropagation(); onUse(); },
  };
  const w = ARCHIVE.w / ARCHIVE_SLOTS - 0.12, d = ARCHIVE.d, h = 1.05;
  const name = c.client?.name ?? (c.more ? `+${c.more} clientes` : 'Arquivo');
  if (!pixel) {
    const col = hover ? sp.hover : sp.furniture;
    return (
      <group position={[c.x, 0, 0]} {...handlers}>
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow><boxGeometry args={[w, h, d]} /><meshStandardMaterial color={col} roughness={0.9} /></mesh>
        {[0.25, 0.55, 0.85].map((y) => (
          <mesh key={y} position={[0, y, d / 2 + 0.01]}><boxGeometry args={[w * 0.5, 0.03, 0.02]} /><meshStandardMaterial color={sp.furnitureDark} /></mesh>
        ))}
      </group>
    );
  }
  const steel = c.client ? '#8f9aa6' : '#a7b0b9';
  return (
    <group position={[c.x, 0, 0]} {...handlers}>
      <OutlineColor color={hover ? HOVER : null}>
        <PBox p={p} pos={[0, h / 2, 0]} size={[w, h, d]} color={steel} />
        <PBox p={p} pos={[0, h + 0.015, 0]} size={[w + 0.04, 0.03, d + 0.04]} color={shade(steel, 0.8)} />
        {[0, 1, 2].map((k) => {
          const y = 0.2 + k * 0.32;
          return (
            <group key={k}>
              <PBox p={p} pos={[0, y, d / 2 + 0.01]} size={[w - 0.1, 0.28, 0.02]} color={shade(steel, 1.08)} outline={false} />
              <PBox p={p} pos={[0, y - 0.06, d / 2 + 0.03]} size={[w * 0.36, 0.04, 0.03]} color={shade(steel, 0.65)} outline={false} />
            </group>
          );
        })}
        {/* plaquinha com o nome na gaveta de cima */}
        <PBox p={p} pos={[0, 0.88, d / 2 + 0.03]} size={[w - 0.2, (w - 0.2) / 4, 0.01]} color="#ffffff" map={plate(name, c.client ? tag : '#dcdcdc')} outline={false} cast={false} />
        {/* pastas aparecendo em cima de quem tem cliente */}
        {c.client && (
          <>
            <PBox p={p} pos={[-w * 0.22, h + 0.1, -0.05]} size={[0.06, 0.18, 0.26]} color={tag} />
            <PBox p={p} pos={[-w * 0.12, h + 0.09, -0.05]} size={[0.06, 0.16, 0.24]} color={p.paper} />
          </>
        )}
      </OutlineColor>
    </group>
  );
}
