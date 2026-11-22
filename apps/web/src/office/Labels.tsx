import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { useStore } from '../lib/store';
import { useWorldStyle } from '../lib/theme';
import { isWorkerVisible } from '@office/shared';
import { DESKS, FURNITURE, OBJECT_TAG, ROOMS, isFixedAgent, roomAt } from './layout';
import { workerPhase } from './npc';
import { busyState, useLabelMode, useOnlyWorking } from './view';

/**
 * Rótulos (nomes, balões de status e nomes das salas) em DOM puro, fora do Canvas.
 * Cada avatar registra uma âncora 3D; um único useFrame projeta todas na tela.
 */
type Anchor = () => { x: number; z: number; y?: number; hidden?: boolean };
const anchors = new Map<string, Anchor>();
const elements = new Map<string, HTMLDivElement>();

export const registerAnchor = (id: string, a: Anchor) => {
  anchors.set(id, a);
  return () => { anchors.delete(id); };
};

/** Móvel sob o mouse (o nome dele aparece mesmo com os nomes escondidos). */
let hoverId: string | null = null;
export const objLabelId = (f: { kind: string; x: number; z: number }) => `obj:${f.kind}:${f.x}:${f.z}`;
export const setObjHover = (id: string | null) => { hoverId = id; };

/** Altura do rótulo acima do chão: o avatar em pixel art é maior que o peão da maquete. */
const head = () => (useWorldStyle.getState().style === 'pixel' ? 2.1 : 1.75);
const v = new Vector3();

/** Fica dentro do Canvas: projeta as âncoras e move os elementos. */
export function LabelProjector({ viewer }: { viewer: () => { x: number; z: number } }) {
  const { camera, size } = useThree();
  useFrame(() => {
    const mode = useLabelMode.getState().mode;
    for (const [id, el] of elements) {
      const a = anchors.get(id);
      if (!a) { el.style.display = 'none'; continue; }
      const p = a();
      if (p.hidden) { el.style.display = 'none'; continue; }
      // nomes de móveis e salas: conforme o modo (sempre, só perto e sob o mouse, ou só sob o mouse)
      const room = id.startsWith('room:');
      if (mode !== 'todos' && (room || id.startsWith('obj:'))) {
        const me = viewer();
        const show = id === hoverId || (mode === 'perto' && (room ? roomAt(me)?.id === id.slice(5) : Math.hypot(p.x - me.x, p.z - me.z) < 5));
        if (!show) { el.style.display = 'none'; continue; }
      }
      v.set(p.x, p.y ?? head(), p.z).project(camera);
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
  const workers = useStore((s) => s.workers);
  const clients = useStore((s) => s.clients);
  const presences = useStore((s) => s.presences);
  const emotes = useStore((s) => s.emotes);
  const open = useStore((s) => s.open);

  const members = useStore((s) => s.members);
  const agents = useStore((s) => s.agents);
  const onlyWorking = useOnlyWorking((s) => s.on);
  useStore((s) => s.mapRev);
  // salas: âncora fixa no chão, perto da parede do fundo
  for (const r of ROOMS) anchors.set(`room:${r.id}`, () => ({ x: (r.x0 + r.x1) / 2, z: r.z0 + 1.2, y: 0.02 }));
  type Item = {
    id: string; name: string; sub?: string; color: string; status?: string | null; statusClass?: string; emoji?: string;
    onClick?: () => void; me?: boolean; desk?: boolean; away?: boolean; copa?: boolean; title?: string; object?: boolean;
  };
  const items: Item[] = [];
  if (user) items.push({ id: `user:${user.id}`, name: user.name, color: user.color, emoji: emotes[user.id]?.emoji, me: true });
  for (const p of Object.values(presences))
    items.push({ id: `user:${p.userId}`, name: p.name, color: p.color, emoji: emotes[p.userId]?.emoji, status: PRESENCE_STATUS[p.status], statusClass: 'st-livre' });
  for (const w of workers) {
    const phase = workerPhase(w);
    if (phase === 'fora' || (onlyWorking && !busyState(w.state))) continue;
    const st = w.state;
    const client = clients.find((c) => c.id === w.clientId)?.name;
    items.push({ id: `worker:${w.id}`, name: `${w.name} · IA`, sub: phase === 'copa' ? `${client ?? ''} · na copa` : client, color: w.color, status: st === 'copa' ? null : AGENT_STATUS[st], statusClass: `st-${st === 'copa' ? 'livre' : st}`, onClick: () => open('clientes', w.clientId) });
  }
  // quem fica sempre na mesa (o gerente): nome, função e status em cima dele
  for (const a of agents.filter(isFixedAgent).filter((x) => !onlyWorking || busyState(x.status))) {
    items.push({ id: `agent:${a.id}`, name: `${a.name} · IA`, sub: a.role.split(/ e |,/)[0], color: a.color, status: AGENT_STATUS[a.status], statusClass: `st-${a.status}`, onClick: () => open('agente', a.id) });
  }
  // móveis que abrem alguma coisa: plaquinha com ícone e nome em cima (clicar abre, como chegar perto e apertar E)
  for (const f of FURNITURE) {
    if (!f.label || f.kind === 'mesa') continue;
    const id = `obj:${f.kind}:${f.x}:${f.z}`;
    const tall = f.kind === 'quadro' || f.kind === 'calendario' || f.kind === 'tv';
    anchors.set(id, () => ({ x: f.x, z: f.z + (tall ? 0.3 : 0), y: tall ? 2.35 : f.kind === 'moodboard' ? 2.1 : 1.7 }));
    const tag = OBJECT_TAG[(f.panel ?? (f.kind === 'cafeteira' ? 'cafe' : '')) as keyof typeof OBJECT_TAG] ?? '✨';
    items.push({ id, name: `${tag} ${f.label}`, color: 'transparent', object: true, onClick: f.panel ? () => open(f.panel!) : undefined });
  }
  // parados na copa: um contador só, em vez de um amontoado de avatares
  const idle = workers.filter((w) => isWorkerVisible(w) && workerPhase(w) === 'fora');
  const copa = DESKS.copa;
  if (idle.length && copa) {
    anchors.set('copa:parados', () => ({ x: copa.x, z: copa.z - 1.1, y: 1.3 }));
    items.push({
      id: 'copa:parados', name: `☕ ${idle.length} na copa`, sub: 'sem trabalho agora', color: 'transparent', copa: true,
      title: idle.map((w) => `${w.name} · ${clients.find((c) => c.id === w.clientId)?.name ?? ''}`).join('\n'),
    });
  }
  // plaquinha das mesas com dono (o mundo esconde quando o dono está sentado nela)
  for (const m of members) {
    if (!m.desk) continue;
    const pr = presences[m.id];
    const sub = m.id === user?.id ? 'sua mesa' : !pr ? 'fora' : PRESENCE_STATUS[pr.status] ?? 'online';
    items.push({ id: `desk:${m.desk}`, name: m.name, sub, color: m.color, desk: true, away: m.id !== user?.id && (!pr || pr.status === 'ausente') });
  }

  return (
    <div className="labels">
      {ROOMS.map((r) => (
        <div key={r.id} ref={(el) => { if (el) elements.set(`room:${r.id}`, el); else elements.delete(`room:${r.id}`); }} style={{ display: 'none' }}>
          <span className="room-label">{r.label}</span>
        </div>
      ))}
      {items.map((it) => (
        <div key={it.id} ref={(el) => { if (el) elements.set(it.id, el); else elements.delete(it.id); }} style={{ display: 'none' }}>
          <div className={`nametag ${it.me ? 'me' : ''} ${it.onClick ? 'clickable' : ''} ${it.desk ? 'desk' : ''} ${it.away ? 'away' : ''} ${it.copa ? 'copa' : ''} ${it.object ? 'object' : ''}`} onClick={it.onClick} title={it.title}>
            {it.emoji ? <div className="bubble emoji">{it.emoji}</div> : it.status && <div className={`bubble ${it.statusClass}`}>{it.status}</div>}
            {!it.me && !it.copa && !it.object && <span className="dot" style={{ background: it.color }} />}
            {it.name}
            {it.sub && <small>{it.sub}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}
