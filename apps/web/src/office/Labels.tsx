import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useStore } from '../lib/store';
import { DESKS } from './layout';

/**
 * Rótulos (nome + balão) dos avatares em DOM puro, fora do Canvas.
 * Cada avatar registra uma âncora 3D; um único useFrame projeta todas na tela.
 * Mais leve que um <Html> por avatar e sem os problemas de montagem do React 19.
 */
type Anchor = () => { x: number; z: number };
const anchors = new Map<string, Anchor>();
const elements = new Map<string, HTMLDivElement>();

export const registerAnchor = (id: string, a: Anchor) => {
  anchors.set(id, a);
  return () => { anchors.delete(id); };
};

const HEAD = 2.25;
const v = new Vector3();

/** Fica dentro do Canvas: projeta as âncoras e move os elementos. */
export function LabelProjector() {
  const { camera, size } = useThree();
  useFrame(() => {
    for (const [id, el] of elements) {
      const a = anchors.get(id);
      if (!a) { el.style.display = 'none'; continue; }
      const p = a();
      v.set(p.x, HEAD, p.z).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.display = '';
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}

const AGENT_BUBBLE = { livre: null, trabalhando: '⌨️', aguardando: '✋', erro: '⚠️' } as const;
const STATUS_BUBBLE = { disponivel: null, ocupado: '⛔', foco: '🎧', ausente: '💤' } as const;

/** Fica fora do Canvas: desenha os rótulos com dados do store. */
export function LabelLayer() {
  const user = useStore((s) => s.user);
  const agents = useStore((s) => s.agents);
  const presences = useStore((s) => s.presences);
  const emotes = useStore((s) => s.emotes);
  const open = useStore((s) => s.open);

  const items: { id: string; name: string; sub?: string; color: string; bubble: string | null; pulse?: boolean; onClick?: () => void; me?: boolean }[] = [];
  if (user) items.push({ id: `user:${user.id}`, name: user.name, sub: 'você', color: user.color, bubble: emotes[user.id]?.emoji ?? null, me: true });
  for (const p of Object.values(presences))
    items.push({ id: `user:${p.userId}`, name: p.name, color: p.color, bubble: emotes[p.userId]?.emoji ?? STATUS_BUBBLE[p.status] });
  for (const a of agents)
    if (DESKS[a.room])
      items.push({ id: `agent:${a.id}`, name: a.name, sub: a.role, color: a.color, bubble: AGENT_BUBBLE[a.status], pulse: a.status === 'aguardando', onClick: () => open('agente', a.id) });

  return (
    <div className="labels">
      {items.map((it) => (
        <div
          key={it.id}
          ref={(el) => { if (el) elements.set(it.id, el); else elements.delete(it.id); }}
          className={`nametag ${it.me ? 'me' : ''} ${it.onClick ? 'clickable' : ''}`}
          style={{ display: 'none' }}
          onClick={it.onClick}
        >
          {it.bubble && <div className={`bubble ${it.pulse ? 'pulse' : ''}`}>{it.bubble}</div>}
          <span className="dot" style={{ background: it.color }} />
          {it.name}
          {it.sub && <small>{it.sub}</small>}
        </div>
      ))}
    </div>
  );
}
