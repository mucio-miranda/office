// Tipos e protocolo compartilhados entre servidor e UI.

export type ID = string;

/** Aparência do avatar; o que não for escolhido sai do id da pessoa, para ninguém ficar igual. */
export interface AvatarLook {
  skin?: string;
  hair?: string;
  hairStyle?: 'curto' | 'topete' | 'longo' | 'coque' | 'careca' | 'black';
  beard?: boolean;
  glasses?: boolean;
  outfit?: 'camiseta' | 'blazer' | 'jaleco';
  pants?: string;
  shoes?: string;
}

/** Tipos de parede; `removida` tira a parede e a colisão. Sem registro no mapa, vale a `alvenaria` do prédio. */
export const WALL_TYPES = ['alvenaria', 'branca', 'preta', 'concreto', 'madeira', 'vidro', 'vidro-fume', 'removida'] as const;
export type WallType = (typeof WALL_TYPES)[number];

/** Sala criada no escritório: um anexo a leste do prédio, com porta para o vizinho. */
export interface CustomRoom {
  id: string;
  officeId: ID;
  name: string;
  emoji: string;
  floor: string;
  /** Posição na grade de anexos: 3 salas por coluna. */
  slot: number;
}
export const MAX_CUSTOM_ROOMS = 12;

export interface User {
  id: ID;
  name: string;
  color: string;
  look?: AvatarLook | null;
  createdAt: string;
  /** Precisa escolher uma senha nova antes de continuar (conta antiga sem senha ou com PIN curto). */
  mustChangePin?: boolean;
}

/**
 * Papéis: o dono abre o escritório e cuida de pastas e contas; o ADM (CEO e comercial) também vê o financeiro;
 * o membro pede trabalho aos funcionários de IA; o convidado só acompanha.
 */
export type OfficeRole = 'dono' | 'adm' | 'membro' | 'convidado';
export const ROLE_LABEL: Record<OfficeRole, string> = { dono: 'dono', adm: 'ADM', membro: 'membro', convidado: 'convidado' };
export const canSeeFinance = (role: OfficeRole | string | undefined) => role === 'dono' || role === 'adm';
export const canWork = (role: OfficeRole | string | undefined) => !!role && role !== 'convidado';

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
  /** Nicho na biblioteca de referências da agência (REFERENCIAS\\<nicho>); sem valor, é deduzido da marca. */
  niche?: string | null;
  monthlyFee: number;
  status: 'ativo' | 'pausado' | 'encerrado';
  color: string;
  /** Briefing do cliente (preenchido pela entrevista com o gerente ou à mão). */
  briefing: Briefing;
  /** Quem aprova as peças na esteira: uma pessoa ou o gerente de IA. */
  approvalMode: 'humano' | 'ia';
  /** A conversa contínua do cliente: a sessão do Claude Code que passa de um pedido para o outro. */
  sessionId?: string | null;
  sessionCost?: number;
  /** Pastas fora do escritório que o dono citou nesta conversa (um cartão de memória, por exemplo). */
  sessionDirs?: string[];
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

/** Cores e tipografia que um moodboard veste: as da marca do cliente ou as medidas nas referências do nicho. */
export interface MoodboardTheme {
  bg: string;
  fg: string;
  accent: string;
  swatches: string[];
  titleFont: string | null;
  bodyFont: string | null;
}

export interface MoodboardSummary {
  /** `nicho:<id>` ou `cliente:<id>` */
  key: string;
  name: string;
  count: number;
  theme: MoodboardTheme;
  covers: string[];
  niche: string | null;
}

export interface MoodboardItem {
  id: string;
  file: string;
  layout: string | null;
  tema: string | null;
  tags: string[];
  paleta: string[];
  nota: number | null;
  obs: string;
  origem: string;
  width: number | null;
  height: number | null;
  /** Subpasta de onde veio, nas referências do cliente. */
  group: string | null;
}

/**
 * Processo: um método validado da casa. O funcionário abre dentro da pasta do cliente, usa a skill e para nas decisões
 * dela, numa sessão só por peça. `needs` é o que a pasta do cliente deveria ter (caminho relativo, em regex).
 */
export interface ProcessDef {
  id: string;
  label: string;
  kind: DemandKind;
  stage: Stage;
  agent: string;
  skill: string;
  needs: { label: string; test: string }[];
}
const NEEDS_BRUTOS = { label: 'Vídeos brutos', test: '(^|/)BRUTOS/' };
export const PROCESSES: ProcessDef[] = [
  {
    id: 'arte-feed', label: 'Arte de feed ou carrossel', kind: 'design', stage: 'arte', agent: 'designer', skill: 'arte-referencia',
    needs: [
      { label: 'Tokens de marca (marca.json)', test: 'marca\\.json$' },
      { label: 'Identidade visual', test: '(^|/)IDENTIDADE VISUAL/' },
      { label: 'Fotos editadas', test: '(^|/)FOTOS/.*EDITADAS?/' },
    ],
  },
  {
    id: 'reels', label: 'Reels falado', kind: 'video', stage: 'video', agent: 'editor-de-video', skill: 'editar-video',
    needs: [{ label: 'Padrão de edição (PADRAO-EDICAO.md)', test: 'PADRAO-EDICAO' }, NEEDS_BRUTOS],
  },
  { id: 'story-broll', label: 'Story de b-roll', kind: 'video', stage: 'video', agent: 'editor-de-video', skill: 'story-broll', needs: [NEEDS_BRUTOS] },
  { id: 'story-reuniao', label: 'Story de reunião', kind: 'video', stage: 'video', agent: 'editor-de-video', skill: 'story-reuniao', needs: [NEEDS_BRUTOS] },
  { id: 'fotos-ensaio', label: 'Tratar ensaio', kind: 'foto', stage: 'arte', agent: 'designer', skill: 'editar-ensaio', needs: [{ label: 'Fotos do ensaio', test: '(^|/)FOTOS/' }] },
  { id: 'fotos-comida', label: 'Tratar fotos de comida', kind: 'foto', stage: 'arte', agent: 'designer', skill: 'editar-comida', needs: [{ label: 'Fotos', test: '(^|/)FOTOS/' }] },
  { id: 'retoque', label: 'Retoque de retrato', kind: 'foto', stage: 'arte', agent: 'designer', skill: 'retoque-retrato', needs: [{ label: 'Fotos', test: '(^|/)FOTOS/' }] },
  { id: 'roteiro', label: 'Roteiro de Reels', kind: 'copy', stage: 'copy', agent: 'copywriter', skill: 'guia-de-roteiro', needs: [] },
];
export const processById = (id: string | null | undefined) => PROCESSES.find((p) => p.id === id);

export interface StageLogEntry {
  stage: Stage;
  /** agent:<id> ou user:<id> */
  by: string;
  jobId: string | null;
  /** Resumo do que foi feito (ou o pedido de ajuste / a aprovação). */
  text: string;
  /** `parcial`: o que já existia quando o funcionário parou para pedir uma decisão. */
  result: 'feito' | 'parcial' | 'aprovado' | 'ajustes' | 'erro';
  at: string;
  /** Arquivos que a etapa produziu (caminhos completos), para a mesa do diretor de arte. */
  files?: string[];
  /** Versão das peças desta etapa (1 na primeira vez, 2 depois do primeiro ajuste...). */
  version?: number;
  /** Áreas marcadas nas peças junto com o pedido de ajuste. */
  marks?: ReviewMark[];
  /** Pasta do Drive para onde esta entrada enviou as peças. */
  drive?: string;
  /** Arquivos que uma pessoa editou à mão e adotou nesta versão. */
  manual?: string[];
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
  /** Método da casa que esta demanda segue (null = esteira por etapas). */
  process?: string | null;
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

/** Formatos do calendário de conteúdo. */
export const POST_FORMATS = ['estatico', 'carrossel', 'reels', 'capa-reels', 'story'] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
export const POST_FORMAT_LABEL: Record<PostFormat, string> = { estatico: 'estático', carrossel: 'carrossel', reels: 'reels', 'capa-reels': 'capa de reels', story: 'story' };
/** Etapas de cada peça, na ordem do método da casa: referência, composição, tunning, conferência, aprovação e Drive. */
export const POST_STATUSES = ['planejado', 'referencia', 'composicao', 'tunning', 'conferencia', 'aprovado', 'drive', 'postado', 'cancelado'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  planejado: 'planejado', referencia: 'referência', composicao: 'composição', tunning: 'tunning', conferencia: 'conferência',
  aprovado: 'aprovado', drive: 'no Drive', postado: 'postado', cancelado: 'cancelado',
};
/** Arte passa pelo tunning; o reels editado não. */
export const needsTunning = (f: PostFormat) => f !== 'reels';

/** Um post do calendário de conteúdo de um cliente, ligado à demanda que o produz. */
export interface ContentPost {
  id: ID;
  officeId: ID;
  clientId: ID;
  demandId: ID | null;
  date: string;
  format: PostFormat;
  theme: string;
  caption: string;
  notes: string;
  /** Ordem de postagem no lote (o 01, 02… do nome dos arquivos). */
  number: number | null;
  status: PostStatus;
  /** `feito` quando passou pelo tunning; `dispensado` quando alguém decidiu que fica sem. */
  tunning: 'feito' | 'dispensado' | null;
  files: string[];
  updatedAt: string;
  updatedBy: string | null;
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
  /** Onde ele senta quando não é a mesa padrão da sala (funcionários criados ou mudados de sala). */
  seat?: Vec2 | null;
  /** Modelo de que veio, nos funcionários criados no escritório: dá as permissões e as skills. */
  base?: string | null;
  look?: AvatarLook | null;
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

/** O que um funcionário aprendeu e sugeriu guardar: só vale para todos depois que uma pessoa aprova. */
export interface Learning {
  id: ID;
  officeId: ID;
  clientId: ID | null;
  demandId: ID | null;
  agentId: ID;
  text: string;
  /** `na-skill` depois que uma mudança aprovada pelo dono gravou o aprendizado nas skills. */
  status: 'pendente' | 'aprovado' | 'recusado' | 'na-skill';
  createdAt: string;
}

/** A pasta de skills de um escritório: o que tem, o histórico e a cópia remota. */
export interface SkillsState {
  dir: string;
  exists: boolean;
  skills: string[];
  /** Histórico local (git) ligado. */
  history: boolean;
  last: { ref: string; at: string; subject: string } | null;
  remote: string | null;
  /** Arquivos mudados fora do Office e ainda sem registro. */
  pending: number;
  /** Registros que ainda não foram para a cópia remota. */
  unpushed: number;
}

/** Uma troca exata num arquivo das skills (caminho relativo a .claude/skills); `find` vazio acrescenta no fim. */
export interface SkillEdit { file: string; find: string; replace: string }

/** Proposta do curador para guardar aprendizados aprovados nas skills. Só vale depois que o dono aplica. */
export interface SkillChange {
  id: ID;
  officeId: ID;
  learningIds: ID[];
  status: 'gerando' | 'pronta' | 'aplicada' | 'recusada' | 'erro';
  summary: string;
  edits: SkillEdit[];
  error: string | null;
  commitRef: string | null;
  createdAt: string;
  decidedBy: string | null;
}

export interface AgentJob {
  id: ID;
  officeId: ID;
  agentId: ID;
  demandId: ID | null;
  /** Etapa da esteira que esta tarefa faz (null = tarefa avulsa). */
  stage: Stage | null;
  /** Cliente cuja conversa esta tarefa continua (null = tarefa avulsa, com sessão própria). */
  clientId?: ID | null;
  prompt: string;
  status: JobStatus;
  sessionId: string | null;
  costUsd: number;
  /** Total que o Claude Code informou para a sessão na última rodada. */
  sessionCost?: number;
  /** Pasta onde o funcionário roda: a do cliente, quando existe. */
  cwd?: string | null;
  /** Início da rodada atual (cada resposta a um checkpoint abre uma rodada na mesma sessão). */
  turnStartedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobMessage {
  id: ID;
  jobId: ID;
  role: 'usuario' | 'agente' | 'ferramenta' | 'sistema';
  text: string;
  /** Nome de quem escreveu, nas mensagens de pessoas. */
  author?: string | null;
  createdAt: string;
}

/** Uma sessão do Claude Code na pasta do cliente: aberta pelo Office ou no terminal. */
export interface ClientSession {
  id: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  sizeMb: number;
  origin: 'office' | 'terminal';
  current: boolean;
  costUsd: number;
  people: string[];
}

/** Marcador que o agente escreve quando para num checkpoint e precisa de aprovação humana. */
export const APPROVAL_MARKER = '[[AGUARDANDO_APROVACAO]]';

// ---------- mundo 3D ----------

export type RoomId = string;

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
  look?: AvatarLook | null;
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
  | { t: 'invalidate'; what: 'posts' | 'demands' | 'events' | 'transactions' | 'clients' | 'agents' | 'jobs' | 'timelines' | 'members' | 'live' | 'layout' | 'rooms' | 'walls' }
  /** Aviso para todo mundo do escritório (ex.: peça esperando aprovação). */
  | { t: 'notice'; text: string; demandId?: ID; agentId?: ID }
  | { t: 'job'; job: AgentJob }
  | { t: 'jobMessage'; message: JobMessage }
  /** Progresso de render; `preview` = prévia rápida (não muda o status da timeline). */
  | { t: 'render'; timelineId: ID; progress: number; status: 'rodando' | 'concluido' | 'erro'; output?: string; error?: string; preview?: boolean };

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
