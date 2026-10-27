import { create } from 'zustand';
import type {
  AgentJob, AgentProfile, CalendarEvent, Client, ClientMsg, Demand, JobMessage, LiveSession, Member, Office, Presence, RoomId, ServerMsg, ToolInfo, Transaction, User, Vec2,
} from '@office/shared';
import { api, getToken, setToken } from './api';
import { desktop } from './desktop';

export type PanelId = 'demandas' | 'calendario' | 'financeiro' | 'video' | 'agente' | 'equipe' | 'atividade' | null;

export interface ChatLine { from: string; name: string; text: string; at: string; room: RoomId | null }
export interface RenderState { progress: number; status: 'rodando' | 'concluido' | 'erro'; output?: string; error?: string }
export type OfficeWithRole = Office & { role: string; inviteCode: string };
/** Aviso no canto da tela; `go` mostra o botão "Ir até" (funcionário ou pessoa). */
export interface Toast { text: string; go?: { agentId?: string; userId?: string } }

interface State {
  user: User | null;
  offices: OfficeWithRole[];
  office: OfficeWithRole | null;
  members: Member[];

  demands: Demand[];
  events: CalendarEvent[];
  transactions: Transaction[];
  clients: Client[];
  agents: AgentProfile[];
  jobs: AgentJob[];
  messages: Record<string, JobMessage[]>;
  timelines: any[];
  /** Ferramentas criativas (MCP) desta máquina. */
  tools: ToolInfo[];
  /** Apps criativos abertos ao vivo na máquina do servidor. */
  live: LiveSession[];
  renders: Record<string, RenderState>;
  /** Prévias rápidas por timeline (não mexem no status do render final). */
  previews: Record<string, RenderState>;

  presences: Record<string, Presence>;
  chat: ChatLine[];
  emotes: Record<string, { emoji: string; at: number }>;

  panel: PanelId;
  panelArg: string | null;
  /** Destino de teletransporte pedido pela UI (atalhos, minimapa, paleta). */
  teleport: Vec2 | null;
  myRoom: RoomId | null;
  toast: Toast | null;
  /** Espaço segurado: modo drone (arrastar a câmera). */
  drone: boolean;
  droneDragging: boolean;
  /** Câmera solta, longe do jogador (mostra "Voltar para mim"). */
  camDetached: boolean;
  /** Passo do tour guiado (null = fechado). */
  tour: number | null;

  boot(): Promise<void>;
  login(name: string, pin?: string): Promise<void>;
  logout(): void;
  enterOffice(id: string): Promise<void>;
  leaveOffice(): void;
  reload(what: 'demands' | 'events' | 'transactions' | 'clients' | 'agents' | 'jobs' | 'timelines' | 'members' | 'live'): Promise<void>;
  loadTools(): Promise<void>;
  /** Liga ou desliga uma ferramenta de um funcionário. */
  toggleAgentTool(agentId: string, toolId: string, on: boolean): Promise<void>;
  /** Liga ou desliga o modo ao vivo (app aberto na tela) de uma ferramenta do funcionário. */
  toggleAgentLive(agentId: string, toolId: string, on: boolean): Promise<void>;
  /** Escolhe (ou libera, com null) a sua mesa. */
  claimDesk(desk: string | null): Promise<boolean>;
  loadMessages(jobId: string): Promise<void>;
  open(panel: PanelId, arg?: string | null): void;
  send(msg: ClientMsg): void;
  notify(text: string, go?: Toast['go']): void;
}

let ws: WebSocket | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  user: null, offices: [], office: null, members: [],
  demands: [], events: [], transactions: [], clients: [], agents: [], jobs: [], messages: {}, timelines: [], tools: [], live: [], renders: {}, previews: {},
  presences: {}, chat: [], emotes: {},
  panel: null, panelArg: null, teleport: null, myRoom: 'recepcao', toast: null,
  drone: false, droneDragging: false, camDetached: false, tour: null,

  async boot() {
    if (!getToken()) return;
    try {
      const me = await api('/api/me');
      set({ user: me.user, offices: me.offices });
      const last = (() => { try { return localStorage.getItem('office.last'); } catch { return null; } })();
      if (last && me.offices.some((o: Office) => o.id === last)) await get().enterOffice(last);
    } catch {
      setToken(null);
    }
  },

  async login(name, pin) {
    const r = await api('/api/auth/enter', { body: { name, pin: pin || undefined } });
    setToken(r.token);
    await get().boot();
  },

  logout() {
    ws?.close();
    setToken(null);
    set({ user: null, office: null, offices: [] });
  },

  async enterOffice(id) {
    const info = await api(`/api/offices/${id}`);
    const me = await api('/api/me');
    const office = me.offices.find((o: OfficeWithRole) => o.id === id) ?? info.office;
    try { localStorage.setItem('office.last', id); } catch { /* ok */ }
    set({ office, offices: me.offices, members: info.members, presences: {}, chat: [], messages: {} });
    await Promise.all((['demands', 'events', 'transactions', 'clients', 'agents', 'jobs', 'timelines', 'live'] as const).map((w) => get().reload(w)));
    connect(id);
  },

  leaveOffice() {
    ws?.close();
    ws = null;
    try { localStorage.removeItem('office.last'); } catch { /* ok */ }
    set({ office: null, panel: null, tour: null });
  },

  async reload(what) {
    const o = get().office;
    if (!o) return;
    const data = await api(`/api/offices/${o.id}/${what}`);
    set({ [what]: data } as Partial<State>);
  },

  async loadTools() {
    const o = get().office;
    if (o) set({ tools: await api(`/api/offices/${o.id}/tools`) });
  },

  async toggleAgentTool(agentId, toolId, on) {
    const o = get().office;
    const a = get().agents.find((x) => x.id === agentId);
    if (!o || !a) return;
    const mcp = [...a.mcp.filter((x) => x !== toolId && x !== `!${toolId}`), on ? toolId : `!${toolId}`];
    await api(`/api/offices/${o.id}/agents/${agentId}`, { method: 'PATCH', body: { mcp } });
    await get().reload('agents');
  },

  async toggleAgentLive(agentId, toolId, on) {
    const o = get().office;
    const a = get().agents.find((x) => x.id === agentId);
    if (!o || !a) return;
    const live = [...a.live.filter((x) => x !== toolId), ...(on ? [toolId] : [])];
    await api(`/api/offices/${o.id}/agents/${agentId}`, { method: 'PATCH', body: { live } });
    await get().reload('agents');
  },

  async claimDesk(desk) {
    const o = get().office;
    if (!o) return false;
    try {
      await api(`/api/offices/${o.id}/desk`, { method: 'PUT', body: { desk } });
      await get().reload('members');
      return true;
    } catch (e) {
      get().notify((e as Error).message);
      return false;
    }
  },

  async loadMessages(jobId) {
    const o = get().office;
    if (!o) return;
    const msgs = await api(`/api/offices/${o.id}/jobs/${jobId}/messages`);
    set((s) => ({ messages: { ...s.messages, [jobId]: msgs } }));
  },

  open(panel, arg = null) {
    set({ panel, panelArg: arg });
  },

  send(msg) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  },

  notify(text, go) {
    clearTimeout(toastTimer);
    set({ toast: { text, go } });
    // com ação o aviso fica mais tempo, para dar tempo de clicar
    toastTimer = setTimeout(() => set({ toast: null }), go ? 8000 : 3500);
  },
}));

function connect(officeId: string) {
  ws?.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ t: 'join', officeId, token: getToken() ?? '' } satisfies ClientMsg));
  sock.onmessage = (e) => handle(JSON.parse(e.data) as ServerMsg);
  sock.onclose = (e) => {
    if (ws !== sock) return;
    if (e.code === 4000) return useStore.getState().notify('O escritório foi aberto em outra aba.');
    setTimeout(() => useStore.getState().office?.id === officeId && connect(officeId), 1500);
  };
}

/** Mostra o emoji em cima do avatar e some sozinho depois de 4 s. */
export function showEmote(userId: string, emoji: string) {
  const at = Date.now();
  useStore.setState((st) => ({ emotes: { ...st.emotes, [userId]: { emoji, at } } }));
  setTimeout(() => useStore.setState((st) => {
    if (st.emotes[userId]?.at !== at) return st;
    const e = { ...st.emotes };
    delete e[userId];
    return { emotes: e };
  }), 4000);
}

function handle(m: ServerMsg) {
  const s = useStore.getState();
  switch (m.t) {
    case 'welcome':
      useStore.setState({ presences: Object.fromEntries(m.presences.filter((p) => p.userId !== m.you).map((p) => [p.userId, p])) });
      break;
    case 'presence':
      if (m.presence.userId === s.user?.id) return;
      if (!s.presences[m.presence.userId]) s.notify(`${m.presence.name} entrou no escritório`, { userId: m.presence.userId });
      useStore.setState((st) => ({ presences: { ...st.presences, [m.presence.userId]: m.presence } }));
      break;
    case 'leave':
      useStore.setState((st) => {
        const p = { ...st.presences };
        delete p[m.userId];
        return { presences: p };
      });
      break;
    case 'chat':
      useStore.setState((st) => ({ chat: [...st.chat.slice(-199), { from: m.from, name: m.name, text: m.text, at: m.at, room: m.room }] }));
      break;
    case 'emote':
      showEmote(m.from, m.emoji);
      break;
    case 'invalidate':
      s.reload(m.what);
      break;
    case 'job': {
      const prev = s.jobs.find((j) => j.id === m.job.id);
      useStore.setState((st) => ({ jobs: prev ? st.jobs.map((j) => (j.id === m.job.id ? m.job : j)) : [m.job, ...st.jobs] }));
      if (prev && prev.status !== m.job.status) {
        const a = s.agents.find((x) => x.id === m.job.agentId);
        const name = a?.name ?? 'Um funcionário';
        const task = m.job.prompt.replace(/^## Demanda: /, '').split(/\r?\n/)[0].slice(0, 120);
        if (m.job.status === 'aguardando') {
          s.notify(`${name} precisa da sua aprovação`, { agentId: m.job.agentId });
          desktop?.notify({ title: `${name} precisa de você`, body: task, panel: 'agente', arg: m.job.agentId });
        } else if (m.job.status === 'concluido') {
          s.notify(`${name} terminou`, { agentId: m.job.agentId });
          desktop?.notify({ title: `${name} terminou`, body: task, panel: 'agente', arg: m.job.agentId });
        }
      }
      break;
    }
    case 'jobMessage':
      useStore.setState((st) => ({
        messages: st.messages[m.message.jobId] ? { ...st.messages, [m.message.jobId]: [...st.messages[m.message.jobId], m.message] } : st.messages,
      }));
      break;
    case 'render':
      if (m.preview) {
        useStore.setState((st) => ({ previews: { ...st.previews, [m.timelineId]: { progress: m.progress, status: m.status, output: m.output, error: m.error } } }));
        break;
      }
      useStore.setState((st) => ({ renders: { ...st.renders, [m.timelineId]: { progress: m.progress, status: m.status, output: m.output, error: m.error } } }));
      if (m.status === 'concluido') {
        s.notify('Vídeo renderizado');
        desktop?.notify({ title: 'Vídeo renderizado', body: m.output ?? '', panel: 'video' });
      }
      if (m.status === 'erro') s.notify('A renderização falhou');
      break;
  }
}
