import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useStore } from '../lib/store';
import { DESKS, ROOMS } from './layout';

/**
 * Rótulos (nomes, balões de status e nomes das salas) em DOM puro, fora do Canvas.
 * Cada avatar registra uma âncora 3D; um único useFrame projeta todas na tela.
 */
type Anchor = () => { x: number; z: number; y?: number };
const anchors = new Map<string, Anchor>();
const elements = new Map<string, HTMLDivElement>();

export const registerAnchor = (id: string, a: Anchor) => {
  anchors.set(id, a);
  return () => { anchors.delete(id); };
};

// salas: âncora fixa no chão, perto da parede do fundo
for (const r of ROOMS) anchors.set(`room:${r.id}`, () => ({ x: (r.x0 + r.x1) / 2, z: r.z0 + 1.2, y: 0.02 }));

const HEAD = 1.75;
const v = new Vector3();

/** Fica dentro do Canvas: projeta as âncoras e move os elementos. */
export function LabelProjector() {
  const { camera, size } = useThree();
  useFrame(() => {
    for (const [id, el] of elements) {
      const a = anchors.get(id);
      if (!a) { el.style.display = 'none'; continue; }
      const p = a();
      v.set(p.x, p.y ?? HEAD, p.z).project(camera);
      if (v.z > 1) { el.style.display = 'none'; continue; }
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.display = '';
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${id.startsWith('room:') ? '-50%' : '-100%'})`;
    }
  });
  return null;
}

const AGENT_STATUS = { livre: null, trabalhando: 'trabalhando', aguardando: 'precisa de você', erro: 'erro' } as const;
const PRESENCE_STATUS = { disponivel: null, ocupado: 'ocupado', foco: 'foco', ausente: 'ausente' } as const;

/** Fica fora do Canvas: desenha os rótulos com dados do store. */
export function LabelLayer() {
  const user = useStore((s) => s.user);
  const agents = useStore((s) => s.agents);
  const presences = useStore((s) => s.presences);
  const emotes = useStore((s) => s.emotes);
  const open = useStore((s) => s.open);

  type Item = { id: string; name: string; sub?: string; color: string; status?: string | null; statusClass?: string; emoji?: string; onClick?: () => void; me?: boolean };
  const items: Item[] = [];
  if (user) items.push({ id: `user:${user.id}`, name: user.name, color: user.color, emoji: emotes[user.id]?.emoji, me: true });
  for (const p of Object.values(presences))
    items.push({ id: `user:${p.userId}`, name: p.name, color: p.color, emoji: emotes[p.userId]?.emoji, status: PRESENCE_STATUS[p.status], statusClass: 'st-livre' });
  for (const a of agents)
    if (DESKS[a.room])
      items.push({ id: `agent:${a.id}`, name: a.name, sub: a.role, color: a.color, status: AGENT_STATUS[a.status], statusClass: `st-${a.status}`, onClick: () => open('agente', a.id) });

  return (
    <div className="labels">
      {ROOMS.map((r) => (
        <div key={r.id} ref={(el) => { if (el) elements.set(`room:${r.id}`, el); else elements.delete(`room:${r.id}`); }} style={{ display: 'none' }}>
          <span className="room-label">{r.label}</span>
        </div>
      ))}
      {items.map((it) => (
        <div key={it.id} ref={(el) => { if (el) elements.set(it.id, el); else elements.delete(it.id); }} style={{ display: 'none' }}>
          <div className={`nametag ${it.me ? 'me' : ''} ${it.onClick ? 'clickable' : ''}`} onClick={it.onClick}>
            {it.emoji ? <div className="bubble emoji">{it.emoji}</div> : it.status && <div className={`bubble ${it.statusClass}`}>{it.status}</div>}
            {!it.me && <span className="dot" style={{ background: it.color }} />}
            {it.name}
            {it.sub && <small>{it.sub}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}
