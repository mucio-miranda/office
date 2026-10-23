import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Bot, Box, Calendar, ChevronsUpDown, Clapperboard, CircleDollarSign, KanbanSquare, Menu, Search, Users, Hand, Clock, Keyboard, Circle,
} from 'lucide-react';
import { useStore, type PanelId } from './lib/store';
import { World, cam, player, type Nearby } from './office/World';
import { LabelLayer } from './office/Labels';
import { DESKS, ROOMS, BOUNDS, roomCenter } from './office/layout';
import { Pages, PAGE_TITLE } from './panels/Panels';
import { ThemeToggle } from './lib/ui';

type NavId = Exclude<PanelId, 'agente'>;
const NAV: { id: NavId; icon: typeof Box; label: string; key: string }[] = [
  { id: null, icon: Box, label: 'Escritório', key: 'O' },
  { id: 'demandas', icon: KanbanSquare, label: 'Demandas', key: 'B' },
  { id: 'calendario', icon: Calendar, label: 'Calendário', key: 'C' },
  { id: 'financeiro', icon: CircleDollarSign, label: 'Financeiro', key: 'F' },
  { id: 'video', icon: Clapperboard, label: 'Estúdio de vídeo', key: 'V' },
  { id: 'equipe', icon: Users, label: 'Equipe', key: 'G' },
  { id: 'atividade', icon: Activity, label: 'Atividade', key: 'H' },
];
const AGENT_LABEL = { livre: 'livre', trabalhando: 'trabalhando', aguardando: 'precisa de você', erro: 'erro' } as const;

export function OfficeView() {
  const [nearby, setNearby] = useState<Nearby | null>(null);
  const [palette, setPalette] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const chatRef = useRef<HTMLInputElement>(null);
  const { panel, open } = useStore();
  const toast = useStore((s) => s.toast);
  const inWorld = panel === null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.key === 'Escape') { setPalette(false); if (typing) el!.blur(); else open(null); return; }
      if (typing || palette || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const nav = NAV.find((d) => d.key.toLowerCase() === k);
      if (nav) { open(nav.id); return; }
      if (!inWorld) return;
      const room = ROOMS.find((r) => r.key === k);
      if (room) { useStore.setState({ teleport: roomCenter(room) }); return; }
      if (k === 'e' && nearby) { nearby.action(); return; }
      if (k === 't' || k === 'enter') { e.preventDefault(); chatRef.current?.focus(); return; }
      if (k === '[') cam.angle -= Math.PI / 2;
      if (k === ']') cam.angle += Math.PI / 2;
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [nearby, palette, open, inWorld]);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar onNavigate={() => setNavOpen(false)} onSearch={() => setPalette(true)} />
      <main className="main">
        <header className="page-head">
          <button className="icon menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="Menu"><Menu size={16} /></button>
          <PageTitle />
          <span className="spacer" />
          <button className="ghost small" onClick={() => setPalette(true)}><Search size={14} /> Buscar <kbd>Ctrl K</kbd></button>
        </header>
        <div className="world-page">
          <div className={`world-wrap ${inWorld ? '' : 'hidden'}`}>
            <World onNearby={setNearby} active={inWorld} />
            {inWorld && (
              <>
                <LabelLayer />
                <WorldHud />
                <MiniMap />
                <Chat inputRef={chatRef} />
                {nearby && <div className="prompt" onClick={nearby.action}><kbd>E</kbd> {nearby.label}</div>}
                <div className="hint">WASD para andar · clique para ir · 1–7 salas · [ ] girar · roda: zoom</div>
              </>
            )}
          </div>
          {!inWorld && <Pages />}
        </div>
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function PageTitle() {
  const { panel, panelArg, agents, office } = useStore();
  const agent = panel === 'agente' ? agents.find((a) => a.id === panelArg) : null;
  return (
    <div className="crumbs truncate">
      <span className="truncate">{office?.name}</span>
      <span>/</span>
      <b className="truncate">{agent ? agent.name : PAGE_TITLE[panel ?? 'escritorio']}</b>
    </div>
  );
}

function Sidebar({ onNavigate, onSearch }: { onNavigate: () => void; onSearch: () => void }) {
  const { panel, panelArg, open, agents, demands, jobs, user, office, leaveOffice, send } = useStore();
  const [status, setStatus] = useState<'disponivel' | 'ocupado' | 'foco' | 'ausente'>('disponivel');
  const openCount = demands.filter((d) => d.status !== 'entregue').length;
  const waiting = jobs.filter((j) => j.status === 'aguardando').length;
  const go = (id: PanelId, arg?: string) => { open(id, arg); onNavigate(); };
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="office-switch" onClick={leaveOffice} title="Trocar de escritório">
          <span className="brand-mark" style={{ width: 22, height: 22 }}>{office?.name?.[0]}</span>
          <span className="truncate">{office?.name}</span>
          <ChevronsUpDown size={14} className="muted" style={{ marginLeft: 'auto' }} />
        </button>
      </div>
      <div className="sidebar-scroll">
        <nav className="nav">
          <button className="nav-item" onClick={onSearch}><Search size={16} /> Buscar <kbd>Ctrl K</kbd></button>
        </nav>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.label} className={`nav-item ${panel === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
              <n.icon size={16} /> {n.label}
              {n.id === 'demandas' && openCount > 0 && <span className="count">{openCount}</span>}
            </button>
          ))}
        </nav>
        <div className="nav">
          <div className="section-label">Funcionários de IA</div>
          {agents.map((a) => (
            <button key={a.id} className={`nav-item agent-row st-${a.status} ${panel === 'agente' && panelArg === a.id ? 'active' : ''}`} onClick={() => go('agente', a.id)}>
              <span className="avatar" style={{ background: a.color }}>{a.name[0]}<span className="status-dot" /></span>
              <div className="truncate"><span className="truncate">{a.name}</span><small className="truncate">{a.role}</small></div>
              {a.status !== 'livre' && <span className={`count ${a.status === 'aguardando' ? 'alert' : ''}`}>{AGENT_LABEL[a.status]}</span>}
            </button>
          ))}
          {waiting > 0 && <div className="section-label" style={{ color: 'var(--waiting)' }}>{waiting} {waiting === 1 ? 'tarefa espera' : 'tarefas esperam'} aprovação</div>}
        </div>
      </div>
      <div className="sidebar-foot">
        <div className="me">
          <span className="avatar" style={{ background: user?.color }}>{user?.name[0]}</span>
          <span className="truncate">{user?.name}</span>
        </div>
        <select value={status} onChange={(e) => { const s = e.target.value as typeof status; setStatus(s); send({ t: 'status', status: s }); }} title="Seu status">
          <option value="disponivel">Disponível</option>
          <option value="ocupado">Ocupado</option>
          <option value="foco">Foco</option>
          <option value="ausente">Ausente</option>
        </select>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function WorldHud() {
  const { demands, jobs, myRoom } = useStore();
  const presences = useStore((s) => s.presences);
  const today = new Date().toISOString().slice(0, 10);
  const late = demands.filter((d) => d.status !== 'entregue' && d.dueDate && d.dueDate < today).length;
  const waiting = jobs.filter((j) => j.status === 'aguardando').length;
  const running = jobs.filter((j) => j.status === 'rodando').length;
  const room = ROOMS.find((r) => r.id === myRoom);
  return (
    <div className="hud-top">
      <span className="pill"><Circle size={8} fill="currentColor" /> {room ? room.label : 'Área externa'}</span>
      <span className="spacer" />
      <span className="pill stats">
        <span title="Pessoas online"><Users size={13} /><b>{Object.keys(presences).length + 1}</b></span>
        <span title="Funcionários trabalhando"><Keyboard size={13} /><b>{running}</b></span>
        <span title="Esperando aprovação" style={waiting ? { color: 'var(--waiting)' } : undefined}><Hand size={13} /><b>{waiting}</b></span>
        <span title="Demandas atrasadas" style={late ? { color: 'var(--error)' } : undefined}><Clock size={13} /><b>{late}</b></span>
      </span>
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
          <rect x={r.x0} y={r.z0} width={r.x1 - r.x0} height={r.z1 - r.z0} />
          <text x={(r.x0 + r.x1) / 2} y={(r.z0 + r.z1) / 2} fontSize={1.6} textAnchor="middle" dominantBaseline="middle">{r.key}</text>
        </g>
      ))}
      {agents.map((a) => <circle key={a.id} cx={DESKS[a.room].x} cy={DESKS[a.room].z} r={0.6} fill={a.color} />)}
      {Object.values(presences).map((p) => <circle key={p.userId} cx={p.pos.x} cy={p.pos.z} r={0.7} fill={p.color} />)}
      <circle cx={player.x} cy={player.z} r={0.9} fill={user?.color} stroke="var(--foreground)" strokeWidth={0.3} />
    </svg>
  );
}

function Chat({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const { chat, send, myRoom } = useStore();
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'sala' | 'todos'>('todos');
  const list = useRef<HTMLDivElement>(null);
  const visible = chat.filter((c) => (scope === 'todos' ? c.room === null : c.room === myRoom));
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [visible.length]);
  return (
    <div className="chat">
      <div className="chat-list" ref={list}>
        {visible.slice(-40).map((c, i) => <div key={i}><b>{c.name}</b> <span className="muted">{c.text}</span></div>)}
      </div>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const room = scope === 'sala' ? myRoom : null;
        send({ t: 'chat', text, room });
        const me = useStore.getState().user!;
        useStore.setState((s) => ({ chat: [...s.chat, { from: me.id, name: me.name, text, at: new Date().toISOString(), room }] }));
        setText('');
      }}>
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensagem… (T)" />
        <select value={scope} onChange={(e) => setScope(e.target.value as 'sala' | 'todos')}>
          <option value="todos">todos</option>
          <option value="sala">esta sala</option>
        </select>
      </form>
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const { agents, demands, clients, open } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const all: { icon: typeof Box; label: string; hint: string; run: () => void }[] = [
      ...NAV.map((d) => ({ icon: d.icon, label: d.label, hint: d.key, run: () => open(d.id) })),
      ...ROOMS.map((r) => ({ icon: Box, label: `Ir para ${r.label}`, hint: r.key, run: () => { open(null); useStore.setState({ teleport: roomCenter(r) }); } })),
      ...agents.map((a) => ({ icon: Bot, label: `${a.name} · ${a.role}`, hint: 'funcionário', run: () => open('agente', a.id) })),
      ...demands.filter((d) => d.status !== 'entregue').map((d) => ({ icon: KanbanSquare, label: d.title, hint: 'demanda', run: () => open('demandas', d.id) })),
      ...clients.map((c) => ({ icon: Users, label: c.name, hint: 'cliente', run: () => open('financeiro', c.id) })),
    ];
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return all.filter((i) => norm(i.label).includes(norm(q))).slice(0, 12);
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
        <div className="palette-list">
          {items.map((it, i) => (
            <div key={i} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { it.run(); onClose(); }}>
              <it.icon size={15} /><span className="truncate">{it.label}</span><small>{it.hint}</small>
            </div>
          ))}
          {items.length === 0 && <div className="empty small">Nada encontrado</div>}
        </div>
      </div>
    </div>
  );
}

