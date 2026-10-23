import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type PanelId } from './lib/store';
import { World, cam, player, type Nearby } from './office/World';
import { DESKS, ROOMS, BOUNDS, roomCenter } from './office/layout';
import { Panels } from './panels/Panels';
import { LabelLayer } from './office/Labels';

const DOCK: { id: Exclude<PanelId, null | 'agente'>; icon: string; label: string; key: string }[] = [
  { id: 'demandas', icon: '🗂️', label: 'Demandas', key: 'B' },
  { id: 'calendario', icon: '📅', label: 'Calendário', key: 'C' },
  { id: 'financeiro', icon: '💰', label: 'Financeiro', key: 'F' },
  { id: 'video', icon: '🎬', label: 'Vídeo', key: 'V' },
  { id: 'equipe', icon: '👥', label: 'Equipe', key: 'G' },
  { id: 'atividade', icon: '📰', label: 'Atividade', key: 'H' },
];

export function OfficeView() {
  const [nearby, setNearby] = useState<Nearby | null>(null);
  const [palette, setPalette] = useState(false);
  const chatRef = useRef<HTMLInputElement>(null);
  const { panel, open } = useStore();
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.key === 'Escape') { setPalette(false); if (typing) el!.blur(); else useStore.getState().open(null); return; }
      if (typing || palette) return;
      const k = e.key.toLowerCase();
      const room = ROOMS.find((r) => r.key === k);
      if (room) { useStore.setState({ teleport: roomCenter(room) }); return; }
      const dock = DOCK.find((d) => d.key.toLowerCase() === k);
      if (dock) { open(useStore.getState().panel === dock.id ? null : dock.id); return; }
      if (k === 'e' && nearby) { nearby.action(); return; }
      if (k === 't' || k === 'enter') { e.preventDefault(); chatRef.current?.focus(); return; }
      if (k === '[') cam.angle -= Math.PI / 2;
      if (k === ']') cam.angle += Math.PI / 2;
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [nearby, palette, open]);

  return (
    <div className="office">
      <World onNearby={setNearby} />
      <LabelLayer />
      <TopBar />
      <nav className="dock">
        {DOCK.map((d) => (
          <button key={d.id} className={panel === d.id ? 'active' : ''} onClick={() => open(panel === d.id ? null : d.id)} title={`${d.label} (${d.key})`}>
            <span>{d.icon}</span>
            <small>{d.label}</small>
            <kbd>{d.key}</kbd>
          </button>
        ))}
      </nav>
      <AgentStrip />
      <MiniMap />
      <Chat inputRef={chatRef} />
      {nearby && !panel && (
        <div className="prompt" onClick={nearby.action}>
          <kbd>E</kbd> {nearby.label}
        </div>
      )}
      <Panels />
      {palette && <Palette onClose={() => setPalette(false)} />}
      {toast && <div className="toast">{toast}</div>}
      <div className="hint">WASD/setas para andar · clique para ir · 1–7 salas · Ctrl+K busca · [ ] girar · roda do mouse: zoom</div>
    </div>
  );
}

function TopBar() {
  const { office, leaveOffice, demands, jobs, myRoom, user, send } = useStore();
  const presences = useStore((s) => s.presences);
  const [status, setStatus] = useState<'disponivel' | 'ocupado' | 'foco' | 'ausente'>('disponivel');
  const today = new Date().toISOString().slice(0, 10);
  const open = demands.filter((d) => d.status !== 'entregue').length;
  const late = demands.filter((d) => d.status !== 'entregue' && d.dueDate && d.dueDate < today).length;
  const waiting = jobs.filter((j) => j.status === 'aguardando').length;
  const running = jobs.filter((j) => j.status === 'rodando').length;
  const room = ROOMS.find((r) => r.id === myRoom);
  return (
    <header className="topbar">
      <button className="ghost" onClick={leaveOffice} title="Trocar de escritório">⟵</button>
      <b className="office-name">{office?.name}</b>
      <span className="room-pill">{room ? `${room.emoji} ${room.label}` : '🌳 Lá fora'}</span>
      <div className="counters">
        <span title="Demandas abertas">🗂️ {open}</span>
        <span title="Atrasadas" className={late ? 'warn' : ''}>⏰ {late}</span>
        <span title="Funcionários de IA trabalhando">⌨️ {running}</span>
        <span title="Esperando sua aprovação" className={waiting ? 'alert' : ''}>✋ {waiting}</span>
        <span title="Pessoas online">🟢 {Object.keys(presences).length + 1}</span>
      </div>
      <select value={status} onChange={(e) => { const s = e.target.value as typeof status; setStatus(s); send({ t: 'status', status: s }); }}>
        <option value="disponivel">🟢 Disponível</option>
        <option value="ocupado">⛔ Ocupado</option>
        <option value="foco">🎧 Foco</option>
        <option value="ausente">💤 Ausente</option>
      </select>
      <span className="me"><span className="dot" style={{ background: user?.color }} />{user?.name}</span>
    </header>
  );
}

function AgentStrip() {
  const { agents, open } = useStore();
  const label = { livre: 'livre', trabalhando: 'trabalhando', aguardando: 'precisa de você', erro: 'com erro' };
  return (
    <div className="agent-strip">
      {agents.map((a) => (
        <button key={a.id} className={`agent-chip ${a.status}`} onClick={() => { useStore.setState({ teleport: { x: DESKS[a.room].x, z: DESKS[a.room].z + 1.6 } }); open('agente', a.id); }}>
          <span className="dot" style={{ background: a.color }} />
          <b>{a.name}</b>
          <small>{label[a.status]}</small>
        </button>
      ))}
    </div>
  );
}

function MiniMap() {
  const presences = useStore((s) => s.presences);
  const agents = useStore((s) => s.agents);
  const user = useStore((s) => s.user);
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((x) => x + 1), 200); return () => clearInterval(id); }, []);
  const W = BOUNDS.x1 - BOUNDS.x0, H = BOUNDS.z1 - BOUNDS.z0;
  return (
    <svg className="minimap" viewBox={`${BOUNDS.x0 - 1} ${BOUNDS.z0 - 1} ${W + 2} ${H + 2}`}>
      {ROOMS.map((r) => (
        <g key={r.id} onClick={() => useStore.setState({ teleport: roomCenter(r) })} className="mm-room">
          <rect x={r.x0} y={r.z0} width={r.x1 - r.x0} height={r.z1 - r.z0} fill={r.floor} stroke="#0003" strokeWidth={0.2} />
          <text x={(r.x0 + r.x1) / 2} y={(r.z0 + r.z1) / 2} fontSize={2.2} textAnchor="middle" dominantBaseline="middle">{r.emoji}</text>
        </g>
      ))}
      {agents.map((a) => <circle key={a.id} cx={DESKS[a.room].x} cy={DESKS[a.room].z} r={0.7} fill={a.color} stroke="#fff" strokeWidth={0.2} />)}
      {Object.values(presences).map((p) => <circle key={p.userId} cx={p.pos.x} cy={p.pos.z} r={0.8} fill={p.color} />)}
      <circle cx={player.x} cy={player.z} r={1} fill={user?.color} stroke="#000" strokeWidth={0.3} />
    </svg>
  );
}

function Chat({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const { chat, send, myRoom } = useStore();
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'sala' | 'todos'>('todos');
  const list = useRef<HTMLDivElement>(null);
  const visible = chat.filter((c) => scope === 'todos' ? c.room === null : c.room === myRoom);
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [visible.length]);
  return (
    <div className="chat">
      <div className="chat-tabs">
        <button className={scope === 'todos' ? 'active' : ''} onClick={() => setScope('todos')}>Todos</button>
        <button className={scope === 'sala' ? 'active' : ''} onClick={() => setScope('sala')}>Esta sala</button>
      </div>
      <div className="chat-list" ref={list}>
        {visible.slice(-40).map((c, i) => <div key={i}><b>{c.name}:</b> {c.text}</div>)}
      </div>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        send({ t: 'chat', text, room: scope === 'sala' ? myRoom : null });
        const me = useStore.getState().user!;
        useStore.setState((s) => ({ chat: [...s.chat, { from: me.id, name: me.name, text, at: new Date().toISOString(), room: scope === 'sala' ? myRoom : null }] }));
        setText('');
      }}>
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="T para conversar…" />
      </form>
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const { agents, demands, clients, open } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const all: { label: string; hint: string; run: () => void }[] = [
      ...ROOMS.map((r) => ({ label: `${r.emoji} Ir para ${r.label}`, hint: `sala · ${r.key}`, run: () => useStore.setState({ teleport: roomCenter(r) }) })),
      ...DOCK.map((d) => ({ label: `${d.icon} Abrir ${d.label}`, hint: `painel · ${d.key}`, run: () => open(d.id) })),
      ...agents.map((a) => ({ label: `🤖 ${a.name}, ${a.role}`, hint: 'funcionário de IA', run: () => { useStore.setState({ teleport: { x: DESKS[a.room].x, z: DESKS[a.room].z + 1.6 } }); open('agente', a.id); } })),
      ...demands.filter((d) => d.status !== 'entregue').map((d) => ({ label: `🗂️ ${d.title}`, hint: 'demanda', run: () => open('demandas', d.id) })),
      ...clients.map((c) => ({ label: `🏷️ ${c.name}`, hint: 'cliente', run: () => open('financeiro', c.id) })),
    ];
    const n = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return all.filter((i) => i.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(n)).slice(0, 12);
  }, [q, agents, demands, clients, open]);
  return (
    <div className="palette-bg" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} placeholder="Ir para, abrir, falar com…" onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && items[sel]) { items[sel].run(); onClose(); }
          }} />
        {items.map((it, i) => (
          <div key={i} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { it.run(); onClose(); }}>
            <span>{it.label}</span><small>{it.hint}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
