import { NewDemand } from './panels/NewDemand';
import { MAX_WORKERS, WORKER_IDLE_HOURS, canSeeFinance, isWorkerVisible } from '@office/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Bot, Box, Calendar, ChevronsUpDown, Clapperboard, CircleDollarSign, KanbanSquare, Menu, Search, Users, Hand, Clock, Keyboard, Circle,
  LocateFixed, Navigation, RotateCcw, RotateCw, ChevronUp, ChevronDown, Map as MapIcon, Minus, Armchair, Compass, Palette as PaletteIcon,
  Paintbrush, Briefcase, Archive as ArchiveIcon, Inbox, SwatchBook,
  Plus, PanelLeftClose, PanelLeftOpen, ListChecks, Download, Send,
} from 'lucide-react';
import { usePersisted } from './lib/persisted';
import { useStore, type PanelId } from './lib/store';
import { World, workerSpots, cam, player, recenter, goTo, goToAgent, goToPerson, goToMyDesk, releaseMyDesk, myDesk, type Nearby } from './office/World';
import { LabelLayer } from './office/Labels';
import { resetView, rotateView, tiltView } from './office/view';
import { clickPadCursor, closeTopLayer, hidePadCursor, movePadCursor, moveFocus, pad, padCursorOn, rumble, scrollFocusArea, sendKey, startGamepad, stepSelect, usePad, type PadButton } from './lib/gamepad';
import { PadHints } from './lib/PadHints';
import { Tour, startTour, tourSeen } from './office/Tour';
import { HUMAN_DESKS, ROOMS, BOUNDS, isFixedAgent, roomCenter } from './office/layout';
import { Pages, PAGE_TITLE } from './panels/Panels';
import { ThemeToggle } from './lib/ui';
import { DecorUI, enterDecorate } from './office/decor/DecorUI';
import { canDecorate, setEditing, useDecor } from './office/decor/state';
import { THEMES, useTheme } from './lib/theme';
import { defaultWall, useWallTool } from './office/decor/walls';
import { desktop, type UpdateState } from './lib/desktop';

type NavId = Exclude<PanelId, 'agente'>;
const NAV: { id: NavId; icon: typeof Box; label: string; key: string }[] = [
  { id: null, icon: Box, label: 'Escritório', key: 'O' },
  { id: 'mesa', icon: Inbox, label: 'Mesa', key: 'N' },
  { id: 'moodboard', icon: SwatchBook, label: 'Moodboards', key: 'L' },
  { id: 'clientes', icon: Briefcase, label: 'Clientes', key: 'K' },
  { id: 'arquivo', icon: ArchiveIcon, label: 'Arquivo', key: 'J' },
  { id: 'demandas', icon: KanbanSquare, label: 'Demandas', key: 'B' },
  { id: 'calendario', icon: Calendar, label: 'Calendário', key: 'C' },
  { id: 'posts', icon: Send, label: 'Posts', key: 'P' },
  { id: 'mes', icon: ListChecks, label: 'Gestão do mês', key: 'M' },
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
  // barra lateral recolhida: fica só com os ícones (Ctrl+B alterna)
  const [navCollapsed, setNavCollapsed] = usePersisted<boolean>('office.nav.collapsed', false);
  const chatRef = useRef<HTMLInputElement>(null);
  const { panel, open } = useStore();
  const toast = useStore((s) => s.toast);
  const inWorld = panel === null;
  const waiting = useStore((s) => s.jobs.filter((j) => j.status === 'aguardando').length);
  const drone = useStore((s) => s.drone);
  // páginas de tela cheia (funcionário, estúdio): o mapa abre pelo cabeçalho para não cobrir a caixa de mensagem nem a timeline
  const flush = panel === 'agente' || panel === 'clientes' || panel === 'video' || panel === 'arquivo' || panel === 'moodboard';
  const [peek, setPeek] = useState(false);
  const droneDragging = useStore((s) => s.droneDragging);
  const touring = useStore((s) => s.tour !== null);
  const decorating = useDecor((s) => s.editing);
  const ready = useStore((s) => s.agents.length > 0);

  // primeiro acesso: a gerente apresenta o escritório
  useEffect(() => {
    const uid = useStore.getState().user?.id;
    if (!ready || !uid || tourSeen(uid)) return;
    const t = setTimeout(startTour, 900);
    return () => clearTimeout(t);
  }, [ready]);

  // app de Windows: clicar numa notificação abre o painel certo; a bandeja mostra quantos esperam aprovação
  useEffect(() => desktop?.onNavigate((to) => open(to.panel as PanelId, to.arg)), [open]);
  useEffect(() => { desktop?.setAttention(waiting); }, [waiting]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // tecla já tratada (ex.: Enter que escolheu um item da busca)
      if (e.defaultPrevented) return;
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
      if (k === 'e' && nearby && !useDecor.getState().editing) { nearby.action(); return; }
      if (k === 'r' && nearby?.alt && !useDecor.getState().editing) { nearby.alt.action(); return; }
      if (k === 't' || k === 'enter') { e.preventDefault(); chatRef.current?.focus(); return; }
      if (k === '[') rotateView(-1);
      if (k === ']') rotateView(1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [nearby, palette, open, inWorld]);
  // controle de videogame: o que cada botão faz depende de onde você está (mapa, painel aberto ou busca)
  const padCtx = useRef({ nearby, palette, inWorld });
  padCtx.current = { nearby, palette, inWorld };
  useEffect(() => startGamepad((b: PadButton) => {
    const { nearby: near, palette: searching, inWorld: world } = padCtx.current;
    const st = useStore.getState();
    const dir = ({ UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' } as const)[b as 'UP'];
    if (searching) {
      if (b === 'UP' || b === 'DOWN') sendKey(b === 'UP' ? 'ArrowUp' : 'ArrowDown');
      else if (b === 'A') sendKey('Enter');
      else if (b === 'B' || b === 'Y') setPalette(false);
      return;
    }
    if (b === 'Y') { setPalette(true); return; }
    if (b === 'START') { const rafa = st.agents.find(isFixedAgent); if (rafa) open('agente', rafa.id); return; }
    if (useDecor.getState().editing) { if (b === 'B') setEditing(false); return; }
    if (!world || document.querySelector('.modal-bg')) {
      const el = document.activeElement as HTMLElement | null;
      const typingNow = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type);
      // B: sai do campo; senão fecha a janela de cima; senão volta para o mapa
      if (b === 'B') { if (typingNow) el!.blur(); else if (!closeTopLayer()) open(null); return; }
      if ((b === 'LEFT' || b === 'RIGHT') && stepSelect(b === 'LEFT' ? -1 : 1)) return;
      if (dir) { hidePadCursor(); moveFocus(dir); return; }
      if (b === 'A' && clickPadCursor()) return;
      if (b === 'A' && el && el !== document.body && !typingNow) el.click();
      return;
    }
    if (b === 'A') { near?.action(); return; }
    if (b === 'X' && near?.alt) { near.alt.action(); return; }
    if (b === 'B' || b === 'X') { recenter(); return; }
    if (b === 'RS') { resetView(); return; }
    if (b === 'LB') { rotateView(-1); return; }
    if (b === 'RB') { rotateView(1); return; }
    if (b === 'UP') { goToMyDesk(); return; }
    if (b === 'LEFT' || b === 'RIGHT') {
      // de sala em sala, na ordem das teclas de atalho
      const list = ROOMS.filter((r) => r.key).sort((x, y) => Number(x.key) - Number(y.key));
      const here = list.findIndex((r) => r.id === st.myRoom);
      const next = list[((here < 0 ? 0 : here + (b === 'RIGHT' ? 1 : -1)) + list.length) % list.length];
      if (next) goTo(roomCenter(next));
    }
  }), [open]);
  // analógico direito com um painel aberto: rola a página
  useEffect(() => {
    let raf = 0, last = performance.now();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const menus = !padCtx.current.inWorld || !!document.querySelector('.modal-bg');
      if (menus && Math.abs(pad.ry) > 0) scrollFocusArea(pad.ry * 1100 * dt);
      // analógico esquerdo nos menus: a seta do controle (mais rápida quanto mais inclina)
      if (menus && (pad.lx || pad.ly)) {
        const k = 900 * dt * (0.35 + 0.65 * Math.min(1, Math.hypot(pad.lx, pad.ly)));
        movePadCursor(pad.lx * k, pad.ly * k);
      } else if (!menus || !padCursorOn()) hidePadCursor();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  // funcionário que passa a precisar de você: o controle vibra
  useEffect(() => useStore.subscribe((s, prev) => {
    if (!usePad.getState().active || s.workers === prev.workers) return;
    if (s.workers.some((w) => w.state === 'aguardando' && prev.workers.find((p) => p.id === w.id)?.state !== 'aguardando')) rumble(220, 0.6);
  }), []);
  const padItems: { b: PadButton[]; label: string }[] = palette
    ? [{ b: ['UP', 'DOWN'], label: 'Escolher' }, { b: ['A'], label: 'Abrir' }, { b: ['B'], label: 'Fechar' }]
    : !inWorld
      ? [{ b: ['UP', 'DOWN', 'LEFT', 'RIGHT'], label: 'Navegar' }, { b: ['LS'], label: 'Cursor' }, { b: ['A'], label: 'Selecionar' }, { b: ['B'], label: 'Voltar' }, { b: ['RS'], label: 'Rolar' }, { b: ['Y'], label: 'Buscar' }]
      : [
        ...(nearby ? [{ b: ['A'] as PadButton[], label: nearby.label }] : []),
        ...(nearby?.alt ? [{ b: ['X'] as PadButton[], label: nearby.alt.label }] : []),
        { b: ['LS'], label: 'Andar' }, { b: ['RS'], label: 'Câmera' }, { b: ['LB', 'RB'], label: 'Girar' }, { b: ['LT', 'RT'], label: 'Zoom' },
        { b: ['LEFT', 'RIGHT'], label: 'Salas' }, { b: ['Y'], label: 'Menu' }, { b: ['START'], label: 'Daily' },
      ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); setNavCollapsed(!navCollapsed); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [navCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''} ${navCollapsed ? 'nav-collapsed' : ''}`}>
      <Sidebar onNavigate={() => setNavOpen(false)} onSearch={() => setPalette(true)} />
      <main className="main">
        <header className="page-head">
          <button className="icon menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="Menu"><Menu size={16} /></button>
          <button className="icon nav-toggle" onClick={() => setNavCollapsed(!navCollapsed)} aria-label={navCollapsed ? 'Expandir a barra lateral' : 'Recolher a barra lateral'} title={`${navCollapsed ? 'Expandir' : 'Recolher'} a barra lateral (Ctrl+B)`}>
            {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <PageTitle />
          <span className="spacer" />
          {!inWorld && flush && (
            <button className={`ghost small ${peek ? 'active' : ''}`} onClick={() => setPeek((v) => !v)} title="Mapa do escritório">
              <span className="live-dot" /> Escritório ao vivo
            </button>
          )}
          <button className="small" onClick={() => useStore.getState().askDemand({})} title="Abrir uma demanda e já começar a sessão do cliente"><Plus size={14} /> Nova demanda</button>
          <button className="ghost small" onClick={() => setPalette(true)}><Search size={14} /> Buscar <kbd>Ctrl K</kbd></button>
        </header>
        <div className="world-page">
          <div className={`world-wrap ${inWorld ? '' : 'hidden'} ${drone ? 'drone' : ''} ${droneDragging ? 'dragging' : ''}`}>
            <World onNearby={setNearby} active={inWorld} />
            {inWorld && (
              <>
                <LabelLayer />
                {!decorating && <WorldHud />}
                {!decorating && <MiniMap />}
                {!decorating && <Chat inputRef={chatRef} />}
                {nearby && !drone && !touring && !decorating && (
                  <div className="prompt-row">
                    <div className="prompt" onClick={nearby.action}><kbd>E</kbd> {nearby.label}</div>
                    {nearby.alt && <div className="prompt" onClick={nearby.alt.action}><kbd>R</kbd> {nearby.alt.label}</div>}
                  </div>
                )}
                <DroneOverlay />
                <Tour />
                <DecorUI />
                {!touring && !decorating && <div className="hint">WASD andar · botão direito ou <kbd>Espaço</kbd> + arrastar: sobrevoar · <kbd>M</kbd> minha mesa · <kbd>X</kbd> decorar · 1–7 salas · dois dedos: mover · pinça ou roda: zoom</div>}
              </>
            )}
          </div>
          {!inWorld && <Pages />}
          {!inWorld && !flush && <MiniMap floating />}
          {!inWorld && flush && peek && <MiniMap floating onClose={() => setPeek(false)} />}
        </div>
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
      <PadHints items={padItems} />
      <NewDemandHost />
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
      {toast.go?.demandId && <button className="toast-btn" onClick={() => { useStore.getState().open('demandas', toast.go!.demandId!); close(); }}><KanbanSquare size={12} /> Abrir</button>}
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
  const { panel, open, demands, jobs, user, office, leaveOffice, send } = useStore();
  const [status, setStatus] = useState<'disponivel' | 'ocupado' | 'foco' | 'ausente'>('disponivel');
  const openCount = demands.filter((d) => d.status !== 'entregue').length;
  // o que está parado esperando uma pessoa: decisão pedida no meio ou aprovação
  const deskCount = demands.filter((d) => jobs.some((j) => j.demandId === d.id && j.status === 'aguardando') || (d.stage === 'aprovacao' && d.status === 'aprovacao' && !jobs.some((j) => j.demandId === d.id && ['fila', 'rodando'].includes(j.status)))).length;
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
          <button className="nav-item" onClick={onSearch} title="Buscar (Ctrl K)"><Search size={16} /> Buscar <kbd>Ctrl K</kbd></button>
        </nav>
        <nav className="nav">
          {NAV.filter((n) => n.id !== 'financeiro' || canSeeFinance(office?.role)).map((n) => (
            <button key={n.label} className={`nav-item ${panel === n.id ? 'active' : ''}`} onClick={() => go(n.id)} title={n.label}>
              <n.icon size={16} /> {n.label}
              {n.id === 'demandas' && openCount > 0 && <span className="count">{openCount}</span>}
              {n.id === 'mesa' && deskCount > 0 && <span className="count">{deskCount}</span>}
            </button>
          ))}
        </nav>
        <TeamList onNavigate={onNavigate} />
        {waiting > 0 && <div className="section-label" style={{ color: 'var(--waiting)' }}>{waiting} {waiting === 1 ? 'tarefa espera' : 'tarefas esperam'} aprovação</div>}
      </div>
      <UpdateCard />
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

/**
 * Atualização do app sem procurar a bandeja: aparece quando a versão nova termina de baixar. Instala em silêncio e o
 * Office abre de novo; as tarefas que estavam rodando voltam para a fila sozinhas.
 */
function UpdateCard() {
  const jobs = useStore((s) => s.jobs);
  const [u, setU] = useState<UpdateState>({ state: 'nenhuma' });
  const [confirm, setConfirm] = useState(false);
  const [going, setGoing] = useState(false);
  useEffect(() => {
    if (!desktop?.updateState) return;
    desktop.updateState().then(setU).catch(() => {});
    return desktop.onUpdate?.(setU);
  }, []);
  if (u.state === 'nenhuma') return null;
  const running = jobs.filter((j) => j.status === 'rodando').length;
  if (u.state === 'baixando') {
    return <div className="update-card muted small" title={`Baixando a versão ${u.version}`}><Download size={14} /><span>Baixando a {u.version}… {u.percent ?? 0}%</span></div>;
  }
  const go = () => {
    if (running && !confirm) { setConfirm(true); return; }
    setGoing(true);
    desktop?.installUpdate?.();
  };
  return (
    <div className="update-card ready" title={`Office ${u.version} pronto para instalar`}>
      <div className="update-text">
        <b>Versão {u.version} pronta</b>
        <small>{going ? 'Instalando, o Office abre de novo em instantes…' : confirm ? `${running} ${running === 1 ? 'tarefa para' : 'tarefas param'} e ${running === 1 ? 'volta' : 'voltam'} sozinha${running === 1 ? '' : 's'} depois.` : 'Leva alguns segundos e reabre sozinho.'}</small>
      </div>
      <button className="primary small" disabled={going} onClick={go} aria-label="Atualizar agora"><Download size={13} /><span>{confirm ? 'Atualizar mesmo assim' : 'Atualizar agora'}</span></button>
    </div>
  );
}

/**
 * Equipe: as pessoas e os funcionários de IA numa lista só. Pessoa: selo Humano e onde está; clicar abre a conversa
 * direta com ela. IA: selo IA e o cliente ou projeto dele; clicar abre a conversa daquele cliente.
 */
function TeamList({ onNavigate }: { onNavigate: () => void }) {
  const { members, workers, clients, presences, user, open, panel, panelArg, dmUnread, agents } = useStore();
  const fixed = agents.filter(isFixedAgent);
  const people = members.filter((m) => m.id !== user?.id);
  const active = workers.filter((w) => !w.archivedAt);
  const shown = active.filter((w) => isWorkerVisible(w));
  const idle = active.length - shown.length;
  const rank = { aguardando: 0, trabalhando: 1, copa: 2 } as const;
  const ai = [...shown].sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
  const LABEL = { trabalhando: 'trabalhando', aguardando: 'precisa de você', copa: '' } as const;
  return (
    <div className="nav">
      <div className="section-label">Equipe <span className="team-count" title="Funcionários de IA ativos (sessões abertas)">IA {active.length}/{MAX_WORKERS}</span></div>
      {people.map((m) => {
        const pr = presences[m.id];
        return (
          <button key={m.id} className={`nav-item agent-row person-row ${panel === 'pessoa' && panelArg === m.id ? 'active' : ''}`} onClick={() => { open('pessoa', m.id); onNavigate(); }} title={`Conversar com ${m.name}`}>
            <span className={`avatar ${pr ? `ps-${pr.status}` : 'ps-ausente'}`} style={{ background: m.color }}>{m.name[0]}<span className="status-dot" /></span>
            <div className="truncate"><span className="truncate">{m.name} <span className="who-badge human">Humano</span></span><small className="truncate">{pr ? ROOMS.find((r) => r.id === pr.room)?.label ?? 'Área externa' : 'fora'}</small></div>
            {dmUnread[m.id] ? <span className="count alert" title="Mensagens não lidas">{dmUnread[m.id]}</span> : null}
          </button>
        );
      })}
      {fixed.map((a) => (
        <button key={a.id} className={`nav-item agent-row st-${a.status} ${panel === 'agente' && panelArg === a.id ? 'active' : ''}`} onClick={() => { open('agente', a.id); onNavigate(); }} title={`${a.name} · IA · ${a.role}`}>
          <span className="avatar" style={{ background: a.color }}>{a.name[0]}<span className="status-dot" /></span>
          <div className="truncate"><span className="truncate">{a.name} <span className="who-badge">IA</span></span><small className="truncate">{a.role}</small></div>
          {a.status === 'trabalhando' && <span className="count">trabalhando</span>}
          {a.status === 'aguardando' && <span className="count alert">precisa de você</span>}
        </button>
      ))}
      {ai.map((w) => {
        const c = clients.find((x) => x.id === w.clientId);
        const st = w.state === 'copa' ? 'livre' : w.state;
        return (
          <button key={w.id} className={`nav-item agent-row st-${st} ${panel === 'clientes' && panelArg === w.clientId ? 'active' : ''}`} onClick={() => { open('clientes', w.clientId); onNavigate(); }} title={`${w.name} · IA · ${c?.name ?? ''}${w.role === 'ajudante' ? ' (ajudante)' : ''}`}>
            <span className="avatar" style={{ background: w.color }}>{w.name[0]}<span className="status-dot" /></span>
            <div className="truncate"><span className="truncate">{w.name} <span className="who-badge">IA</span></span><small className="truncate">{c?.name ?? '—'}{w.role === 'ajudante' ? ' · ajudante' : ''}</small></div>
            {w.state !== 'copa' && <span className={`count ${w.state === 'aguardando' ? 'alert' : ''}`}>{LABEL[w.state]}</span>}
          </button>
        );
      })}
      {idle > 0 && <p className="muted small team-idle" title="Continuam com a memória do cliente e voltam quando ele tiver trabalho; a lista completa fica na aba Equipe de cada cliente">+{idle} sem trabalho há mais de {WORKER_IDLE_HOURS} h</p>}
      {people.length + ai.length + fixed.length === 0 && <p className="muted small" style={{ padding: '0 8px' }}>Os funcionários de IA aparecem quando um cliente começa uma conversa.</p>}
    </div>
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
      {canDecorate() && <button className="pill decor-btn" onClick={enterDecorate} title="Decorar o escritório (X)"><Paintbrush size={13} /> Decorar</button>}
      <span className="pill view-rot">
        <button className="icon tiny" onClick={() => rotateView(-1)} title="Girar o escritório (Q) · ou Ctrl + arrastar"><RotateCcw size={13} /></button>
        <button className="icon tiny" onClick={() => rotateView(1)} title="Girar para o outro lado (Shift+Q) · ou Ctrl + arrastar"><RotateCw size={13} /></button>
        <button className="icon tiny" onClick={() => tiltView(1.18)} title="Subir a câmera (PageUp) · ou Ctrl + arrastar para cima/baixo"><ChevronUp size={13} /></button>
        <button className="icon tiny" onClick={() => tiltView(1 / 1.18)} title="Descer a câmera (PageDown)"><ChevronDown size={13} /></button>
        <button className="icon tiny" onClick={resetView} title="Vista padrão (ângulo e altura de sempre)"><Compass size={13} /></button>
      </span>
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
  const user = useStore((s) => s.user);
  const [, force] = useState(0);
  const members = useStore((s) => s.members);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('office.mmCollapsed') === '1'; } catch { return false; } });
  useEffect(() => { const id = setInterval(() => force((x) => x + 1), 200); return () => clearInterval(id); }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('office.mmCollapsed', c ? '0' : '1'); } catch { /* ok */ } return !c; });
  useStore((s) => s.mapRev);
  const W = BOUNDS.x1 - BOUNDS.x0, H = BOUNDS.z1 - BOUNDS.z0;
  const workers = useStore((s) => s.workers);
  const waiting = workers.filter((w) => !w.archivedAt && w.state === 'aguardando').length;

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
      {workerSpots(workers).map(([w, spot]) => {
        const st = w.state === 'copa' ? 'livre' : w.state;
        return (
          <g key={w.id} className={`mm-dot st-${st}`} onClick={() => goTo(spot)}>
            <title>Ir até {w.name} (IA) · {AGENT_LABEL[st]}</title>
            {st !== 'livre' && <circle className="mm-ring" cx={spot.x} cy={spot.z} r={1.3} />}
            <circle cx={spot.x} cy={spot.z} r={0.7} fill={w.color} />
          </g>
        );
      })}
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
  const { workers, demands, clients, open, presences, members, user } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const all: { icon: typeof Box; label: string; hint: string; run: () => void }[] = [
      ...NAV.map((d) => ({ icon: d.icon, label: d.label, hint: d.key, run: () => open(d.id) })),
      { icon: Armchair, label: 'Ir para minha mesa', hint: 'M', run: goToMyDesk },
      { icon: Compass, label: 'Tour do escritório', hint: 'ajuda', run: startTour },
      ...(canDecorate() ? [{ icon: Paintbrush, label: 'Decorar o escritório', hint: 'X', run: enterDecorate }] : []),
      ...(canDecorate() ? [{ icon: Paintbrush, label: 'Trocar as paredes (acabamento e padrão do escritório)', hint: 'paredes', run: () => { enterDecorate(); setTimeout(() => useWallTool.getState().setTool(defaultWall() === 'alvenaria' ? 'reboco' : defaultWall()), 50); } }] : []),
      ...THEMES.map((t) => ({ icon: PaletteIcon, label: `Tema: ${t.label}`, hint: 'visual', run: () => useTheme.getState().set(t.id) })),
      ...(myDesk() ? [{ icon: Armchair, label: 'Liberar minha mesa', hint: 'mesa', run: () => { releaseMyDesk(); } }] : []),
      ...members.filter((m) => m.desk && m.id !== user?.id && !presences[m.id]).map((m) => {
        const d = HUMAN_DESKS.find((h) => h.id === m.desk)!;
        return { icon: Armchair, label: `Ir até a mesa de ${m.name}`, hint: 'fora', run: () => goTo({ x: d.x + 1.6, z: d.z + 1.1 }, d) };
      }),
      ...ROOMS.map((r) => ({ icon: Box, label: `Ir para ${r.label}`, hint: r.key, run: () => goTo(roomCenter(r)) })),
      ...workers.filter((w) => isWorkerVisible(w)).map((w) => ({ icon: Bot, label: `${w.name} · IA · ${clients.find((c) => c.id === w.clientId)?.name ?? ''}`, hint: 'funcionário de IA', run: () => open('clientes', w.clientId) })),
      ...Object.values(presences).map((p) => ({ icon: Navigation, label: `Ir até ${p.name}`, hint: 'online', run: () => goToPerson(p) })),
      ...demands.filter((d) => d.status !== 'entregue').map((d) => ({ icon: KanbanSquare, label: d.title, hint: 'demanda', run: () => open('demandas', d.id) })),
      ...clients.map((c) => ({ icon: Users, label: c.name, hint: 'cliente', run: () => open('clientes', c.id) })),
    ];
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return all.filter((i) => norm(i.label).includes(norm(q))).slice(0, 12);
  }, [q, workers, demands, clients, open, presences, members, user]);
  return (
    <div className="palette-bg" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} placeholder="Ir para, abrir, falar com…" onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && items[sel]) { e.preventDefault(); items[sel].run(); onClose(); }
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


function NewDemandHost() {
  const { newDemand, askDemand } = useStore();
  return newDemand ? <NewDemand agentId={newDemand.agentId} clientId={newDemand.clientId} onClose={() => askDemand(null)} /> : null;
}
