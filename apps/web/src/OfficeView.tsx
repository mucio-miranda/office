import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Bot, Box, Calendar, ChevronsUpDown, Clapperboard, CircleDollarSign, KanbanSquare, Menu, Search, Users, Hand, Clock, Keyboard, Circle,
  LocateFixed, Navigation, Map as MapIcon, Minus, Armchair,
} from 'lucide-react';
import { useStore, type PanelId } from './lib/store';
import { World, cam, player, recenter, goTo, goToAgent, goToPerson, goToMyDesk, releaseMyDesk, myDesk, type Nearby } from './office/World';
import { LabelLayer } from './office/Labels';
import { DESKS, HUMAN_DESKS, ROOMS, BOUNDS, roomCenter } from './office/layout';
import { Pages, PAGE_TITLE } from './panels/Panels';
import { ThemeToggle } from './lib/ui';
import { desktop } from './lib/desktop';

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
  const waiting = useStore((s) => s.jobs.filter((j) => j.status === 'aguardando').length);
  const drone = useStore((s) => s.drone);
  // páginas de tela cheia (funcionário, estúdio): o mapa abre pelo cabeçalho para não cobrir a caixa de mensagem nem a timeline
  const flush = panel === 'agente' || panel === 'video';
  const [peek, setPeek] = useState(false);
  const droneDragging = useStore((s) => s.droneDragging);

  // app de Windows: clicar numa notificação abre o painel certo; a bandeja mostra quantos esperam aprovação
  useEffect(() => desktop?.onNavigate((to) => open(to.panel as PanelId, to.arg)), [open]);
  useEffect(() => { desktop?.setAttention(waiting); }, [waiting]);

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
      if (k === 'm') { goToMyDesk(); return; }
      if (!inWorld) return;
      const room = ROOMS.find((r) => r.key === k);
      if (room) { goTo(roomCenter(room)); return; }
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
          {!inWorld && flush && (
            <button className={`ghost small ${peek ? 'active' : ''}`} onClick={() => setPeek((v) => !v)} title="Mapa do escritório">
              <span className="live-dot" /> Escritório ao vivo
            </button>
          )}
          <button className="ghost small" onClick={() => setPalette(true)}><Search size={14} /> Buscar <kbd>Ctrl K</kbd></button>
        </header>
        <div className="world-page">
          <div className={`world-wrap ${inWorld ? '' : 'hidden'} ${drone ? 'drone' : ''} ${droneDragging ? 'dragging' : ''}`}>
            <World onNearby={setNearby} active={inWorld} />
            {inWorld && (
              <>
                <LabelLayer />
                <WorldHud />
                <MiniMap />
                <Chat inputRef={chatRef} />
                {nearby && !drone && <div className="prompt" onClick={nearby.action}><kbd>E</kbd> {nearby.label}</div>}
                <DroneOverlay />
                <div className="hint">WASD andar · <kbd>Espaço</kbd> + arrastar: sobrevoar · <kbd>M</kbd> minha mesa · 1–7 salas · roda: zoom</div>
              </>
            )}
          </div>
          {!inWorld && <Pages />}
          {!inWorld && !flush && <MiniMap floating />}
          {!inWorld && flush && peek && <MiniMap floating onClose={() => setPeek(false)} />}
        </div>
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
      {toast && <ToastView />}
    </div>
  );
}

function ToastView() {
  const toast = useStore((s) => s.toast)!;
  const agents = useStore((s) => s.agents);
  const presences = useStore((s) => s.presences);
  const agent = toast.go?.agentId ? agents.find((a) => a.id === toast.go!.agentId) : undefined;
  const person = toast.go?.userId ? presences[toast.go.userId] : undefined;
  const close = () => useStore.setState({ toast: null });
  return (
    <div className="toast">
      <span>{toast.text}</span>
      {agent && <button className="toast-btn" onClick={() => { goToAgent(agent); close(); }}><Navigation size={12} /> Ir até</button>}
      {agent && <button className="toast-btn ghost" onClick={() => { useStore.getState().open('agente', agent.id); close(); }}>Abrir</button>}
      {person && <button className="toast-btn" onClick={() => { goToPerson(person); close(); }}><Navigation size={12} /> Ir até</button>}
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
  const { panel, panelArg, open, agents, demands, jobs, user, office, leaveOffice, send, presences } = useStore();
  const online = Object.values(presences);
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
        {online.length > 0 && (
          <div className="nav">
            <div className="section-label">Online · {online.length}</div>
            {online.map((p) => (
              <button key={p.userId} className="nav-item agent-row person-row" onClick={() => { goToPerson(p); onNavigate(); }} title={`Ir até ${p.name}`}>
                <span className={`avatar ps-${p.status}`} style={{ background: p.color }}>{p.name[0]}<span className="status-dot" /></span>
                <div className="truncate"><span className="truncate">{p.name}</span><small className="truncate">{ROOMS.find((r) => r.id === p.room)?.label ?? 'Área externa'}</small></div>
                <Navigation size={13} className="go" />
              </button>
            ))}
          </div>
        )}
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

/** Modo drone: visor com cantoneiras enquanto o Espaço está segurado; "Voltar para mim" quando a câmera está solta. */
function DroneOverlay() {
  const drone = useStore((s) => s.drone);
  const detached = useStore((s) => s.camDetached);
  return (
    <>
      {drone && (
        <div className="drone-frame" aria-hidden>
          <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
          <span className="drone-badge"><Navigation size={12} /> Modo drone · arraste para sobrevoar</span>
        </div>
      )}
      {detached && !drone && (
        <button className="recenter" onClick={recenter} title="Voltar a câmera para você (Esc)">
          <LocateFixed size={14} /> Voltar para mim <kbd>Esc</kbd>
        </button>
      )}
    </>
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

/** Mapa do escritório. No mundo fica no canto; com uma página aberta flutua por cima (como o mini-mapa do Gather). */
function MiniMap({ floating = false, onClose }: { floating?: boolean; onClose?: () => void }) {
  const presences = useStore((s) => s.presences);
  const agents = useStore((s) => s.agents);
  const user = useStore((s) => s.user);
  const [, force] = useState(0);
  const members = useStore((s) => s.members);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('office.mmCollapsed') === '1'; } catch { return false; } });
  useEffect(() => { const id = setInterval(() => force((x) => x + 1), 200); return () => clearInterval(id); }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('office.mmCollapsed', c ? '0' : '1'); } catch { /* ok */ } return !c; });
  const W = BOUNDS.x1 - BOUNDS.x0, H = BOUNDS.z1 - BOUNDS.z0;
  const waiting = agents.filter((a) => a.status === 'aguardando').length;

  if (floating && collapsed && !onClose) {
    return (
      <button className="minimap-pill" onClick={toggle} title="Mostrar o mapa do escritório">
        <MapIcon size={14} /> Escritório{waiting > 0 && <span className="count alert">{waiting}</span>}
      </button>
    );
  }
  const map = (
    <svg className={floating ? undefined : 'minimap'} viewBox={`${BOUNDS.x0 - 1} ${BOUNDS.z0 - 1} ${W + 2} ${H + 2}`}>
      {ROOMS.map((r) => (
        <g key={r.id} onClick={() => goTo(roomCenter(r))} className="mm-room">
          <title>Ir para {r.label}</title>
          <rect x={r.x0} y={r.z0} width={r.x1 - r.x0} height={r.z1 - r.z0} />
          <text x={(r.x0 + r.x1) / 2} y={(r.z0 + r.z1) / 2} fontSize={1.6} textAnchor="middle" dominantBaseline="middle">{r.key}</text>
        </g>
      ))}
      {agents.map((a) => (
        <g key={a.id} className={`mm-dot st-${a.status}`} onClick={() => goToAgent(a)}>
          <title>Ir até {a.name} · {AGENT_LABEL[a.status]}</title>
          {a.status !== 'livre' && <circle className="mm-ring" cx={DESKS[a.room].x} cy={DESKS[a.room].z} r={1.3} />}
          <circle cx={DESKS[a.room].x} cy={DESKS[a.room].z} r={0.7} fill={a.color} />
        </g>
      ))}
      {members.map((m) => {
        const d = HUMAN_DESKS.find((h) => h.id === m.desk);
        return d && (
          <rect key={m.id} className="mm-desk" x={d.x - 1.1} y={d.z - 0.55} width={2.2} height={1.1} rx={0.2} fill={m.color}>
            <title>Mesa de {m.name}</title>
          </rect>
        );
      })}
      {Object.values(presences).map((p) => (
        <g key={p.userId} className="mm-dot" onClick={() => goToPerson(p)}>
          <title>Ir até {p.name}</title>
          <circle cx={p.pos.x} cy={p.pos.z} r={0.8} fill={p.color} />
        </g>
      ))}
      <circle cx={player.x} cy={player.z} r={0.9} fill={user?.color} stroke="var(--foreground)" strokeWidth={0.3} pointerEvents="none" />
      {!cam.follow && !floating && (
        <g className="mm-view">
          <circle cx={cam.cx} cy={cam.cz} r={2.2} />
          <path d={`M${cam.cx - 3.4} ${cam.cz}h2M${cam.cx + 1.4} ${cam.cz}h2M${cam.cx} ${cam.cz - 3.4}v2M${cam.cx} ${cam.cz + 1.4}v2`} />
        </g>
      )}
    </svg>
  );
  if (!floating) return map;
  return (
    <div className={`minimap floating ${onClose ? 'top' : ''}`}>
      <div className="mm-head">
        <button className="mm-back" onClick={() => useStore.getState().open(null)} title="Voltar para o escritório (O)">
          <span className="live-dot" /> Escritório ao vivo
        </button>
        <span className="spacer" />
        <button className="icon tiny" onClick={onClose ?? toggle} title="Recolher"><Minus size={13} /></button>
      </div>
      {map}
    </div>
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
  const { agents, demands, clients, open, presences, members, user } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const all: { icon: typeof Box; label: string; hint: string; run: () => void }[] = [
      ...NAV.map((d) => ({ icon: d.icon, label: d.label, hint: d.key, run: () => open(d.id) })),
      { icon: Armchair, label: 'Ir para minha mesa', hint: 'M', run: goToMyDesk },
      ...(myDesk() ? [{ icon: Armchair, label: 'Liberar minha mesa', hint: 'mesa', run: () => { releaseMyDesk(); } }] : []),
      ...members.filter((m) => m.desk && m.id !== user?.id && !presences[m.id]).map((m) => {
        const d = HUMAN_DESKS.find((h) => h.id === m.desk)!;
        return { icon: Armchair, label: `Ir até a mesa de ${m.name}`, hint: 'fora', run: () => goTo({ x: d.x + 1.6, z: d.z + 1.1 }, d) };
      }),
      ...ROOMS.map((r) => ({ icon: Box, label: `Ir para ${r.label}`, hint: r.key, run: () => goTo(roomCenter(r)) })),
      ...agents.map((a) => ({ icon: Bot, label: `${a.name} · ${a.role}`, hint: 'funcionário', run: () => open('agente', a.id) })),
      ...agents.map((a) => ({ icon: Navigation, label: `Ir até ${a.name}`, hint: 'mesa', run: () => goToAgent(a) })),
      ...Object.values(presences).map((p) => ({ icon: Navigation, label: `Ir até ${p.name}`, hint: 'online', run: () => goToPerson(p) })),
      ...demands.filter((d) => d.status !== 'entregue').map((d) => ({ icon: KanbanSquare, label: d.title, hint: 'demanda', run: () => open('demandas', d.id) })),
      ...clients.map((c) => ({ icon: Users, label: c.name, hint: 'cliente', run: () => open('financeiro', c.id) })),
    ];
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return all.filter((i) => norm(i.label).includes(norm(q))).slice(0, 12);
  }, [q, agents, demands, clients, open, presences, members, user]);
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

