// Tipos e protocolo compartilhados entre servidor e UI.

export type ID = string;

export interface User {
  id: ID;
  name: string;
  color: string;
  createdAt: string;
}

export type OfficeRole = 'dono' | 'membro' | 'convidado';

/** Pessoa do escritório, com a mesa que escolheu (id de um lugar da planta, ou null). */
export interface Member extends User {
  role: OfficeRole;
  desk: string | null;
}

export interface Office {
  id: ID;
  name: string;
  /** Pasta raiz onde os funcionários de IA trabalham (CLAUDE.md e .claude/skills são lidos daqui). */
  rootPath: string;
  /** Pastas extras liberadas para os agentes (ex.: D:\CLAUDE). */
  extraDirs: string[];
  theme: OfficeTheme;
  createdAt: string;
}

export interface OfficeTheme {
  primary: string;
  floor: string;
  wall: string;
}

export interface Client {
  id: ID;
  officeId: ID;
  name: string;
  /** Pasta do cliente, relativa ao rootPath do escritório ou absoluta. */
  folder: string | null;
  monthlyFee: number;
  status: 'ativo' | 'pausado' | 'encerrado';
  color: string;
}

export const DEMAND_COLUMNS = ['backlog', 'a_fazer', 'em_producao', 'aprovacao', 'entregue'] as const;
export type DemandStatus = (typeof DEMAND_COLUMNS)[number];
export const DEMAND_COLUMN_LABEL: Record<DemandStatus, string> = {
  backlog: 'Backlog',
  a_fazer: 'A fazer',
  em_producao: 'Em produção',
  aprovacao: 'Aprovação',
  entregue: 'Entregue',
};

export type DemandKind = 'video' | 'design' | 'copy' | 'estrategia' | 'foto' | 'outro';
export type Priority = 'baixa' | 'media' | 'alta' | 'urgente';

export interface Demand {
  id: ID;
  officeId: ID;
  clientId: ID | null;
  title: string;
  description: string;
  kind: DemandKind;
  status: DemandStatus;
  priority: Priority;
  /** user:<id> ou agent:<id> */
  assignee: string | null;
  dueDate: string | null;
  /** Segundos acumulados no cronômetro. */
  trackedSeconds: number;
  /** Início do cronômetro em andamento (ISO) ou null. */
  timerStartedAt: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: ID;
  officeId: ID;
  title: string;
  start: string;
  end: string;
  kind: 'reuniao' | 'gravacao' | 'entrega' | 'pessoal' | 'outro';
  clientId: ID | null;
  demandId: ID | null;
  room: string | null;
}

export interface Transaction {
  id: ID;
  officeId: ID;
  clientId: ID | null;
  kind: 'receita' | 'despesa';
  category: string;
  description: string;
  amount: number;
  date: string;
  paid: boolean;
}

export type AgentStatus = 'livre' | 'trabalhando' | 'aguardando' | 'erro';

export interface AgentProfile {
  id: ID;
  officeId: ID;
  slug: string;
  name: string;
  role: string;
  /** Mesa/sala do escritório onde o avatar fica. */
  room: RoomId;
  color: string;
  skills: string[];
  tools: string[];
  persona: string;
  allowedTools: string[];
  /** Ferramentas criativas (servidores MCP) deste funcionário: ids do catálogo; `!id` = desligada pela equipe. */
  mcp: string[];
  /** Ferramentas que este funcionário usa ao vivo: o app abre na tela e a IA opera a janela. */
  live: string[];
  status: AgentStatus;
}

/** Ferramenta criativa com servidor MCP (PhotoCraft, FilmCraft, OfficeCLI...). */
export interface ToolInfo {
  id: string;
  name: string;
  /** O programa comercial que ela substitui. */
  replaces: string;
  summary: string;
  url: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  /** Instalação automática pelo Office (hoje só no Windows). */
  canInstall: boolean;
  /** Tem modo ao vivo: o app abre na tela e a IA opera a janela pela ponte MCP. */
  live: boolean;
  /** `mcp`: um funcionário opera por MCP; `programa`: o próprio Office usa (ex.: Whisper no estúdio). */
  kind: 'mcp' | 'programa';
  /** Quem usa, para os programas que não são de um funcionário. */
  usedBy?: string;
}

/** Um app criativo aberto na tela, operado por um funcionário de IA (modo ao vivo). */
export interface LiveSession {
  id: ID;
  officeId: ID;
  jobId: ID;
  agentId: ID;
  toolId: string;
  toolName: string;
  /** `abrindo` até o canal de controle responder; `livre` quando a tarefa parou e o app segue aberto. */
  status: 'abrindo' | 'ativa' | 'livre' | 'erro';
  error: string | null;
  startedAt: string;
  /** Último print da janela (ISO) ou null. */
  frameAt: string | null;
}

export type JobStatus = 'fila' | 'rodando' | 'aguardando' | 'concluido' | 'erro' | 'cancelado';

export interface AgentJob {
  id: ID;
  officeId: ID;
  agentId: ID;
  demandId: ID | null;
  prompt: string;
  status: JobStatus;
  sessionId: string | null;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobMessage {
  id: ID;
  jobId: ID;
  role: 'usuario' | 'agente' | 'ferramenta' | 'sistema';
  text: string;
  createdAt: string;
}

/** Marcador que o agente escreve quando para num checkpoint e precisa de aprovação humana. */
export const APPROVAL_MARKER = '[[AGUARDANDO_APROVACAO]]';

// ---------- mundo 3D ----------

export type RoomId = 'recepcao' | 'reuniao' | 'video' | 'design' | 'copy' | 'gerencia' | 'copa';

/**
 * Item de decoração do mapa (editável no modo Decorar). `rot` é o giro em quartos de volta (0–3), como no Habbo.
 * Itens de parede guardam a parede em `wall` e ficam rentes a ela.
 */
export interface DecorItem {
  id: ID;
  kind: string;
  x: number;
  z: number;
  rot: number;
  color?: string;
  wall?: 'fundo' | 'esquerda';
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface Presence {
  userId: ID;
  name: string;
  color: string;
  pos: Vec2;
  /** Direção em radianos. */
  dir: number;
  moving: boolean;
  /** Sentado na própria mesa. */
  seated?: boolean;
  room: RoomId | null;
  status: 'disponivel' | 'ocupado' | 'foco' | 'ausente';
}

// ---------- protocolo WebSocket ----------

export type ClientMsg =
  | { t: 'join'; officeId: ID; token: string }
  | { t: 'move'; pos: Vec2; dir: number; moving: boolean; seated?: boolean; room: RoomId | null }
  | { t: 'status'; status: Presence['status'] }
  | { t: 'chat'; text: string; room: RoomId | null }
  | { t: 'emote'; emoji: string };

export type ServerMsg =
  | { t: 'welcome'; you: ID; presences: Presence[] }
  | { t: 'presence'; presence: Presence }
  | { t: 'leave'; userId: ID }
  | { t: 'chat'; from: ID; name: string; text: string; room: RoomId | null; at: string }
  | { t: 'emote'; from: ID; emoji: string }
  /** Algo mudou no banco; a UI recarrega a coleção. */
  | { t: 'invalidate'; what: 'demands' | 'events' | 'transactions' | 'clients' | 'agents' | 'jobs' | 'timelines' | 'members' | 'live' | 'layout' }
  | { t: 'job'; job: AgentJob }
  | { t: 'jobMessage'; message: JobMessage }
  /** Progresso de render; `preview` = prévia rápida (não muda o status da timeline). */
  | { t: 'render'; timelineId: ID; progress: number; status: 'rodando' | 'concluido' | 'erro'; output?: string; error?: string; preview?: boolean };

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
