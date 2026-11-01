import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MoodboardSummary } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import type { ScenePalette } from '../lib/theme';
import { MOODBOARD, MOODBOARD_SLOTS, type Furniture } from './layout';

/**
 * Cavaletes de moodboard no estúdio de design: cada um mostra as imagens de verdade de um nicho ou cliente, nas cores
 * da marca. Clicar abre aquele moodboard. Quando há mais moodboards que cavaletes, eles vão se revezando.
 */

const TURN_MS = 20_000;
const W = 640, H = 400;

/** O quadro inteiro numa textura só, em tamanho pequeno: pesa pouco e carrega as imagens uma a uma. */
function boardTexture(s: MoodboardSummary, officeId: string, onChange: () => void) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const head = 64, pad = 12, cols = 3, rows = 2;
  const cw = (W - pad * (cols + 1)) / cols, ch = (H - head - pad * (rows + 1)) / rows;
  g.fillStyle = s.theme.bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = s.theme.fg;
  g.font = `600 30px ${s.theme.titleFont ? `"${s.theme.titleFont}", ` : ''}Georgia, serif`;
  g.textBaseline = 'middle';
  g.fillText(s.name.length > 30 ? `${s.name.slice(0, 29)}…` : s.name, pad + 4, head / 2);
  s.theme.swatches.slice(0, 5).forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(W - pad - 24 * (5 - i), head / 2 - 9, 20, 18);
  });
  for (let i = 0; i < cols * rows; i++) {
    const x = pad + (i % cols) * (cw + pad), y = head + pad + Math.floor(i / cols) * (ch + pad);
    g.fillStyle = s.theme.accent;
    g.globalAlpha = 0.14;
    g.fillRect(x, y, cw, ch);
    g.globalAlpha = 1;
    const file = s.covers[i];
    if (!file) continue;
    const img = new Image();
    img.onload = () => {
      const scale = Math.max(cw / img.width, ch / img.height);
      const sw = cw / scale, sh = ch / scale;
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, cw, ch);
      tex.needsUpdate = true;
      onChange();
    };
    img.src = mediaUrl(officeId, file);
  }
  tex.needsUpdate = true;
  return tex;
}

function Easel({ s, x, officeId, p }: { s: MoodboardSummary; x: number; officeId: string; p: ScenePalette }) {
  const invalidate = useThree((st) => st.invalidate);
  const [hover, setHover] = useState(false);
  const tex = useMemo(() => boardTexture(s, officeId, () => invalidate()), [s.key, s.covers.join('|'), s.name, officeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { invalidate(); return () => tex.dispose(); }, [tex, invalidate]);
  const w = MOODBOARD.w / MOODBOARD_SLOTS - 0.3, h = w * (H / W);
  const wood = hover ? p.hover : '#8a6a4a';
  return (
    <group position={[x, 0, 0]}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
      onClick={(e) => { e.stopPropagation(); useStore.getState().open('moodboard', s.key); }}>
      <mesh position={[0, 0.62 + h / 2, 0]} castShadow><boxGeometry args={[w + 0.14, h + 0.14, 0.08]} /><meshStandardMaterial color={wood} roughness={0.85} /></mesh>
      <mesh position={[0, 0.62 + h / 2, 0.045]}><planeGeometry args={[w, h]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
      {[-1, 1].map((k) => (
        <mesh key={k} position={[k * (w / 2 - 0.2), 0.34, 0.02]} rotation={[0.1, 0, 0]} castShadow><boxGeometry args={[0.07, 0.72, 0.07]} /><meshStandardMaterial color={wood} roughness={0.85} /></mesh>
      ))}
      <mesh position={[0, 0.58, 0.05]}><boxGeometry args={[w * 0.9, 0.05, 0.16]} /><meshStandardMaterial color={wood} roughness={0.85} /></mesh>
    </group>
  );
}

export function MoodboardWall({ f, p }: { f: Furniture; p: ScenePalette }) {
  const officeId = useStore((s) => s.office?.id);
  const clients = useStore((s) => s.clients);
  const [boards, setBoards] = useState<MoodboardSummary[]>([]);
  const [page, setPage] = useState(0);
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => {
    if (!officeId) return;
    let alive = true;
    api<{ niches: MoodboardSummary[]; clients: MoodboardSummary[] }>(`/api/offices/${officeId}/moodboards`)
      .then((r) => { if (alive) setBoards([...r.niches, ...r.clients.filter((c) => c.covers.length)]); })
      .catch(() => { /* sem quadro, o estúdio segue normal */ });
    return () => { alive = false; };
  }, [officeId, clients.length]);
  useEffect(() => {
    if (boards.length <= MOODBOARD_SLOTS) return;
    const id = setInterval(() => { setPage((n) => n + 1); invalidate(); }, TURN_MS);
    return () => clearInterval(id);
  }, [boards.length, invalidate]);
  if (!officeId || !boards.length) return null;
  const step = MOODBOARD.w / MOODBOARD_SLOTS;
  const shown = Array.from({ length: Math.min(MOODBOARD_SLOTS, boards.length) }, (_, i) => boards[(page * MOODBOARD_SLOTS + i) % boards.length]);
  return (
    <group position={[0, 0, f.z]}>
      {shown.map((s, i) => <Easel key={s.key} s={s} x={f.x - MOODBOARD.w / 2 + step / 2 + i * step} officeId={officeId} p={p} />)}
    </group>
  );
}
