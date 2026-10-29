import { useState } from 'react';
import type { Furniture } from '../layout';
import { usePixel, type PixelPalette } from '../../lib/theme';
import { OutlineColor, PBlob, PBox, PCyl, leafTexture, screenTexture, shade, woodTexture } from './kit';

/** Contorno de destaque quando o mouse passa por algo que dá para usar. */
const HOVER = '#ffe066';

type V3 = [number, number, number];

/** Cadeira de escritório: base de 5 pés, coluna, assento e encosto estofados. */
export function OfficeChair({ p, pos, rot = 0, color }: { p: PixelPalette; pos: V3; rot?: number; color: string }) {
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <PBox p={p} pos={[0, 0.05, 0]} size={[0.5, 0.06, 0.08]} color={p.metal} />
      <PBox p={p} pos={[0, 0.05, 0]} size={[0.08, 0.06, 0.5]} color={p.metal} />
      <PCyl p={p} pos={[0, 0.24, 0]} r={0.04} h={0.36} color={p.metal} sides={6} />
      <PBox p={p} pos={[0, 0.46, 0]} size={[0.5, 0.1, 0.48]} color={color} />
      <PBox p={p} pos={[0, 0.8, 0.22]} size={[0.48, 0.56, 0.08]} color={color} />
    </group>
  );
}

/** Moita: volume arredondado com textura de folhas miúdas e contorno verde-escuro (as moitas do Habbo). */
export function Bush({ p, pos, size, rot, flowers, tint = 1 }: { p: PixelPalette; pos: V3; size: V3; rot?: V3; flowers?: string; tint?: number }) {
  return <PBlob p={p} pos={pos} size={size} rot={rot} color="#ffffff" map={leafTexture(shade(p.plant, tint), shade(p.plantDark, tint), flowers)} edge={shade(p.plantDark, 0.45)} />;
}

/** Planta em vaso: folhagem em camadas, do escuro (embaixo) ao claro (em cima). */
export function Plant({ p, pos, scale = 1 }: { p: PixelPalette; pos: V3; scale?: number }) {
  return (
    <group position={pos} scale={scale}>
      <PCyl p={p} pos={[0, 0.22, 0]} r={0.22} rTop={0.27} h={0.44} color={p.pot} sides={10} />
      <PCyl p={p} pos={[0, 0.43, 0]} r={0.28} h={0.04} color={shade(p.pot, 1.15)} sides={10} outline={false} />
      <Bush p={p} pos={[0, 0.68, 0]} size={[0.66, 0.42, 0.66]} rot={[0, 0.4, 0]} tint={0.92} />
      <Bush p={p} pos={[0.05, 0.94, -0.03]} size={[0.5, 0.32, 0.5]} rot={[0, -0.3, 0]} tint={1.08} />
      <Bush p={p} pos={[-0.04, 1.16, 0.04]} size={[0.32, 0.22, 0.32]} rot={[0, 0.7, 0]} tint={1.18} />
    </group>
  );
}

/**
 * Móveis fixos em pixel art, no mesmo lugar e com o mesmo clique da maquete: mesas com monitor, teclado e
 * caneca, cadeiras de escritório, quadros, TVs, balcões e cofre. A decoração editável fica em decor/catalog.
 */
export function PixelFurniture({ f, onUse }: { f: Furniture; onUse?: (f: Furniture) => void }) {
  const p = usePixel();
  const [hover, setHover] = useState(false);
  const interactive = !!(f.panel || f.label);
  const handlers = interactive
    ? {
        onPointerOver: (e: any) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; },
        onPointerOut: () => { setHover(false); document.body.style.cursor = ''; },
        onClick: (e: any) => { e.stopPropagation(); onUse?.(f); },
      }
    : {};

  const body = (() => {
    switch (f.kind) {
      case 'mesa': {
        const w = f.w ?? 2.2, d = f.d ?? 1.1;
        return (
          <group>
            <PBox p={p} pos={[0, 0.72, 0]} size={[w, 0.08, d]} color={p.wood} />
            <PBox p={p} pos={[-w / 2 + 0.08, 0.34, 0]} size={[0.08, 0.68, d - 0.12]} color={p.woodDark} />
            <PBox p={p} pos={[w / 2 - 0.08, 0.34, 0]} size={[0.08, 0.68, d - 0.12]} color={p.woodDark} />
            <PBox p={p} pos={[0, 0.45, -d / 2 + 0.08]} size={[w - 0.2, 0.46, 0.04]} color={p.woodDark} />
            {/* gaveteiro */}
            <PBox p={p} pos={[w / 2 - 0.42, 0.42, 0.05]} size={[0.5, 0.56, d - 0.3]} color={p.wood} />
            <PBox p={p} pos={[w / 2 - 0.42, 0.52, 0.36]} size={[0.16, 0.03, 0.02]} color={p.metal} outline={false} />
            {/* monitor, teclado, caneca e papéis */}
            <PBox p={p} pos={[0, 0.8, -0.3]} size={[0.24, 0.04, 0.16]} color={p.metal} />
            <PBox p={p} pos={[0, 0.9, -0.3]} size={[0.06, 0.18, 0.05]} color={p.metal} />
            <PBox p={p} pos={[0, 1.08, -0.32]} size={[0.86, 0.52, 0.06]} color="#1c1f26" />
            <PBox p={p} pos={[0, 1.08, -0.287]} size={[0.78, 0.44, 0.01]} color="#ffffff" map={screenTexture(p.screenGlow)} glow outline={false} cast={false} />
            <PBox p={p} pos={[0, 0.775, 0.05]} size={[0.6, 0.03, 0.2]} color="#e8e4dc" />
            <PBox p={p} pos={[0.45, 0.775, 0.08]} size={[0.1, 0.03, 0.14]} color="#e8e4dc" />
            <PCyl p={p} pos={[-0.7, 0.82, 0.1]} r={0.07} h={0.13} color={p.fabric} sides={8} />
            <PBox p={p} pos={[-0.62, 0.77, -0.25]} size={[0.32, 0.02, 0.24]} color={p.paper} rot={[0, 0.25, 0]} />
            <OfficeChair p={p} pos={[0, 0, 0.95]} color={p.fabricAlt} />
          </group>
        );
      }
      case 'mesa-reuniao': {
        const w = f.w ?? 6, d = f.d ?? 2.6;
        return (
          <group>
            <PBox p={p} pos={[0, 0.72, 0]} size={[w, 0.1, d]} color={p.wood} />
            <PBox p={p} pos={[0, 0.74, 0]} size={[w - 0.6, 0.1, d - 0.6]} color={p.woodDark} outline={false} />
            <PBox p={p} pos={[-w / 2 + 0.6, 0.34, 0]} size={[0.3, 0.68, d - 0.8]} color={p.woodDark} />
            <PBox p={p} pos={[w / 2 - 0.6, 0.34, 0]} size={[0.3, 0.68, d - 0.8]} color={p.woodDark} />
            {[-1.8, 0, 1.8].map((x) => <PCyl key={`m${x}`} p={p} pos={[x, 0.82, 0]} r={0.08} h={0.1} color={p.paper} sides={8} />)}
            {Array.from({ length: 6 }).map((_, i) => (
              <OfficeChair key={i} p={p} pos={[((i % 3) - 1) * 1.8, 0, (i < 3 ? -1 : 1) * (d / 2 + 0.45)]} rot={i < 3 ? Math.PI : 0} color={p.fabric} />
            ))}
          </group>
        );
      }
      case 'quadro': {
        const w = f.w ?? 3;
        const notes = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#ffd166', '#f78c6b'];
        return (
          <group position={[0, 1.45, 0]}>
            <PBox p={p} pos={[0, 0, 0]} size={[w, 1.3, 0.06]} color={p.metal} />
            <PBox p={p} pos={[0, 0, 0.035]} size={[w - 0.12, 1.18, 0.01]} color="#fbfbf8" outline={false} />
            {notes.map((c, i) => (
              <PBox key={i} p={p} pos={[((i % 3) - 1) * (w / 3.4), i < 3 ? 0.26 : -0.22, 0.045]} size={[0.32, 0.3, 0.01]} color={c} outline={false} rot={[0, 0, ((i * 37) % 10 - 5) / 60]} />
            ))}
            <PBox p={p} pos={[0, -0.7, 0.08]} size={[w * 0.6, 0.05, 0.1]} color={p.metal} />
          </group>
        );
      }
      case 'calendario':
        return (
          <group position={[0, 1.5, 0]}>
            <PBox p={p} pos={[0, 0, 0]} size={[1.1, 1.1, 0.04]} color={p.paper} />
            <PBox p={p} pos={[0, 0.44, 0.025]} size={[1.1, 0.22, 0.01]} color={p.fabric} outline={false} />
            {Array.from({ length: 12 }).map((_, i) => (
              <PBox key={i} p={p} pos={[((i % 4) - 1.5) * 0.24, 0.18 - Math.floor(i / 4) * 0.22, 0.025]} size={[0.16, 0.14, 0.01]} color={i === 6 ? '#f1c40f' : '#ddd6c8'} outline={false} />
            ))}
          </group>
        );
      case 'tv': {
        const w = f.w ?? 3;
        return (
          <group position={[0, 1.5, 0]}>
            <PBox p={p} pos={[0, 0, 0]} size={[w, w * 0.56, 0.08]} color="#15171c" />
            <PBox p={p} pos={[0, 0, 0.045]} size={[w - 0.14, w * 0.56 - 0.14, 0.01]} color={p.screen} glow outline={false} cast={false} />
            <PBox p={p} pos={[0, -w * 0.28 - 0.1, 0.05]} size={[0.4, 0.06, 0.12]} color="#15171c" />
          </group>
        );
      }
      case 'balcao': {
        const w = f.w ?? 5, d = f.d ?? 1.1;
        return (
          <group>
            <PBox p={p} pos={[0, 0.5, 0]} size={[w, 1, d]} color={shade(p.wood, 0.8)} />
            {/* ripas verticais na frente, com rodapé recuado */}
            {Array.from({ length: Math.floor(w / 0.16) }).map((_, i, a) => (
              <PBox key={i} p={p} pos={[(i - (a.length - 1) / 2) * 0.16, 0.54, d / 2 + 0.02]} size={[0.1, 0.84, 0.04]} color="#ffffff" map={woodTexture(shade(p.wood, i % 2 ? 1.2 : 1.12))} outline={false} />
            ))}
            <PBox p={p} pos={[0, 0.05, d / 2 - 0.02]} size={[w - 0.04, 0.1, 0.04]} color={shade(p.woodDark, 0.8)} outline={false} />
            <PBox p={p} pos={[0, 1.03, 0]} size={[w + 0.1, 0.06, d + 0.1]} color="#ffffff" map={woodTexture('#eadcc6')} />
            {/* jardineira embutida na ponta do tampo */}
            <PBox p={p} pos={[-w / 2 + 0.45, 1.1, 0]} size={[0.7, 0.1, d - 0.3]} color={shade(p.woodDark, 0.9)} />
            <Bush p={p} pos={[-w / 2 + 0.45, 1.3, 0]} size={[0.66, 0.3, d - 0.36]} rot={[0, 0.06, 0]} />
            <Bush p={p} pos={[-w / 2 + 0.52, 1.5, 0.05]} size={[0.4, 0.22, 0.42]} rot={[0, 0.5, 0]} tint={1.15} />
          </group>
        );
      }
      case 'cafeteira':
        return (
          <group>
            <PBox p={p} pos={[0, 1.27, 0]} size={[0.42, 0.42, 0.36]} color={p.metal} />
            <PBox p={p} pos={[0, 1.5, 0]} size={[0.44, 0.06, 0.38]} color="#22252c" />
            <PBox p={p} pos={[0, 1.22, 0.19]} size={[0.2, 0.14, 0.02]} color="#22252c" outline={false} />
            <PBox p={p} pos={[0.13, 1.4, 0.185]} size={[0.05, 0.05, 0.01]} color="#ff4d4d" glow outline={false} />
            <PCyl p={p} pos={[0, 1.12, 0.12]} r={0.05} h={0.08} color={p.paper} sides={8} />
          </group>
        );
      case 'cofre':
        return (
          <group>
            <PBox p={p} pos={[0, 0.5, 0]} size={[0.9, 1, 0.9]} color="#5d6873" />
            <PBox p={p} pos={[0, 0.5, 0.455]} size={[0.7, 0.8, 0.02]} color="#4a545e" outline={false} />
            <PCyl p={p} pos={[0.12, 0.55, 0.47]} r={0.1} h={0.03} color="#c9ced4" sides={10} />
            <PBox p={p} pos={[-0.18, 0.55, 0.47]} size={[0.05, 0.22, 0.03]} color="#c9ced4" outline={false} />
          </group>
        );
      default:
        return null;
    }
  })();

  return (
    <group position={[f.x, 0, f.z]} rotation={[0, f.rot ?? 0, 0]} {...handlers}>
      <OutlineColor color={hover && interactive ? HOVER : null}>{body}</OutlineColor>
    </group>
  );
}
