// Tipos e protocolo compartilhados entre servidor e UI.

export type ID = string;

export interface User {
  id: ID;
  name: string;
  color: string;
  createdAt: string;
  /** Precisa escolher uma senha nova antes de continuar (conta antiga sem senha ou com PIN curto). */
  mustChangePin?: boolean;
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
  /** Pasta do Drive montada no computador, para onde vai o trabalho aprovado. */
  driveRoot: string | null;
  /** Pasta que recebe uma segunda cópia do backup do banco. */
  backupDir: string | null;
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
  /** Pasta do cliente no Drive (relativa a driveRoot), lembrada do último envio. */
  driveFolder: string | null;
  monthlyFee: number;
  status: 'ativo' | 'pausado' | 'encerrado';
  color: string;
  /** Briefing do cliente (preenchido pela entrevista com o gerente ou à mão). */
  briefing: Briefing;
  /** Quem aprova as peças na esteira: uma pessoa ou o gerente de IA. */
  approvalMode: 'humano' | 'ia';
}

export interface Briefing {
  segmento?: string;
  publico?: string;
  objetivos?: string;
  tomDeVoz?: string;
  cores?: string;
  concorrentes?: string;
  redes?: string;
  frequencia?: string;
  diferenciais?: string;
  observacoes?: string;
  /** Quando a entrevista terminou (ISO). */
  feitoEm?: string;
}

export const BRIEFING_FIELDS: { key: Exclude<keyof Briefing, 'feitoEm'>; label: string }[] = [
  { key: 'segmento', label: 'Segmento e oferta' },
  { key: 'publico', label: 'Público' },
  { key: 'objetivos', label: 'Objetivos' },
  { key: 'tomDeVoz', label: 'Tom de voz' },
  { key: 'cores', label: 'Cores e identidade' },
  { key: 'diferenciais', label: 'Diferenciais' },
  { key: 'concorrentes', label: 'Concorrentes e referências' },
  { key: 'redes', label: 'Redes e perfis' },
  { key: 'frequencia', label: 'Frequência de postagem' },
  { key: 'observacoes', label: 'Observações' },
];

/**
 * Etapas da esteira de uma demanda. Cada etapa de produção tem um funcionário de IA (pelo slug);
 * `aprovacao` é de uma pessoa ou do gerente (conforme o cliente) e `agendado` é o fim (pronto para publicar).
 */
export type Stage = 'briefing' | 'pauta' | 'copy' | 'arte' | 'video' | 'aprovacao' | 'agendado';
export const STAGE_LABEL: Record<Stage, string> = {
  briefing: 'Briefing', pauta: 'Pauta', copy: 'Copy', arte: 'Arte', video: 'Vídeo', aprovacao: 'Aprovação', agendado: 'Pronto para agendar',
};
export const STAGE_AGENT: Partial<Record<Stage, string>> = {
  briefing: 'gerente', pauta: 'copywriter', copy: 'copywriter', arte: 'designer', video: 'editor-de-video',
};

export interface StageLogEntry {
  stage: Stage;
  /** agent:<id> ou user:<id> */
  by: string;
  jobId: string | null;
  /** Resumo do que foi feito (ou o pedido de ajuste / a aprovação). */
  text: string;
  result: 'feito' | 'aprovado' | 'ajustes' | 'erro';
  at: string;
  /** Arquivos que a etapa produziu (caminhos completos), para a mesa do diretor de arte. */
  files?: string[];
  /** Versão das peças desta etapa (1 na primeira vez, 2 depois do primeiro ajuste...). */
  version?: number;
  /** Áreas marcadas nas peças junto com o pedido de ajuste. */
  marks?: ReviewMark[];
  /** Pasta do Drive para onde esta entrada enviou as peças. */
  drive?: string;
}

/**
 * Área marcada numa peça pelo diretor de arte: retângulo em frações da imagem (0 a 1, a partir do canto
 * superior esquerdo) e o que mudar ali.
 */
export interface ReviewMark {
  file: string;
  x: number; y: number; w: number; h: number;
  note: string;
}

/** Redes em que um post pode sair. */
export const NETWORKS = ['instagram-feed', 'instagram-reels', 'instagram-stories', 'tiktok', 'facebook', 'linkedin', 'youtube-shorts'] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_LABEL: Record<Network, string> = {
  'instagram-feed': 'Instagram (feed)', 'instagram-reels': 'Instagram (Reels)', 'instagram-stories': 'Instagram (stories)',
  tiktok: 'TikTok', facebook: 'Facebook', linkedin: 'LinkedIn', 'youtube-shorts': 'YouTube Shorts',
};

/** Publicação agendada de uma demanda pronta: data, redes, legenda e o pacote gravado na pasta do cliente. */
export interface Publish {
  /** Data e hora locais (AAAA-MM-DDTHH:MM). */
  at: string;
  networks: Network[];
  caption: string;
  files: string[];
  /** Pasta do pacote (PUBLICAR/...) com o POST.md. */
  folder: string | null;
  eventId: string | null;
  status: 'agendado' | 'publicado';
  publishedAt?: string;
  /** O lembrete de "hora de publicar" já foi dado. */
  reminded?: boolean;
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
  /** Etapas da esteira desta demanda (vazio = sem esteira). */
  pipeline: Stage[];
  /** Etapa atual (null antes de começar). */
  stage: Stage | null;
  /** A esteira está ligada: ao terminar uma etapa, a próxima começa sozinha. */
  auto: boolean;
  stageLog: StageLogEntry[];
  /** Voltas de ajuste já feitas (limita o vai e volta da aprovação por IA). */
  reviewRounds: number;
  /** Publicação agendada (depois da aprovação). */
  publish: Publish | null;
}

export interface CalendarEvent {
  id: ID;
  officeId: ID;
  title: string;
  start: string;
  end: string;
  kind: 'reuniao' | 'gravacao' | 'entrega' | 'publicacao' | 'pessoal' | 'outro';
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
  /** Etapa da esteira que esta tarefa faz (null = tarefa avulsa). */
  stage: Stage | null;
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
  /** Aviso para todo mundo do escritório (ex.: peça esperando aprovação). */
  | { t: 'notice'; text: string; demandId?: ID; agentId?: ID }
  | { t: 'job'; job: AgentJob }
  | { t: 'jobMessage'; message: JobMessage }
  /** Progresso de render; `preview` = prévia rápida (não muda o status da timeline). */
  | { t: 'render'; timelineId: ID; progress: number; status: 'rodando' | 'concluido' | 'erro'; output?: string; error?: string; preview?: boolean };

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
