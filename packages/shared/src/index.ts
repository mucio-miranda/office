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
export const WALL_TYPES = ['alvenaria', 'reboco', 'branca', 'preta', 'verde', 'terracota', 'concreto', 'tijolo', 'azulejo', 'madeira', 'vidro', 'vidro-fume', 'removida'] as const;
/** Chave do mapa de paredes com o acabamento padrão do escritório (vale para toda parede sem escolha própria, inclusive de salas novas). */
export const WALL_DEFAULT_KEY = 'padrao';
/** Chave com o acabamento das divisórias entre as salas (vence o padrão do escritório nessas paredes). */
export const WALL_DIVIDER_KEY = 'divisorias';
/** Escritório aberto: com `removida` nessa chave, as paredes entre as salas somem (as de fora ficam). Os acabamentos escolhidos continuam salvos e voltam ao desligar. */
export const WALL_OPEN_KEY = 'aberto';
export type WallType = (typeof WALL_TYPES)[number];

/** Sala criada no escritório: um anexo a leste do prédio, com porta para o vizinho. */
export interface CustomRoom {
  id: string;
  officeId: ID;
  name: string;
  emoji: string;
  floor: string;
  /** Posição na grade de anexos: 3 salas por coluna (usada quando a sala não tem retângulo próprio). */
  slot: number;
  /** Retângulo da sala no mapa (metros), desde a ferramenta Planta; vazio = a posição do slot. */
  x0?: number | null;
  z0?: number | null;
  x1?: number | null;
  z1?: number | null;
}
export const MAX_CUSTOM_ROOMS = 12;

/**
 * Planta das salas novas: ficam a leste do prédio (x a partir de 27), entre o fundo e a frente dele (z de -18 a 18),
 * para as paredes do fundo e da esquerda, onde vai a decoração de parede, continuarem no lugar. Uma sala não passa
 * por cima de outra e precisa encostar no prédio ou numa sala que encoste, com espaço para uma porta.
 */
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export const PLAN = { x0: 27, z0: -18, z1: 18, annexW: 14, annexD: 12, rows: 3, minW: 6, minD: 6, maxW: 60, maxD: 36, door: 2.6, grid: 0.5 };
export const annexRect = (slot: number): Rect => {
  const col = Math.floor(slot / PLAN.rows), row = slot % PLAN.rows;
  const x0 = PLAN.x0 + col * PLAN.annexW, z0 = PLAN.z0 + row * PLAN.annexD;
  return { x0, z0, x1: x0 + PLAN.annexW, z1: z0 + PLAN.annexD };
};
export const roomRect = (r: Pick<CustomRoom, 'slot' | 'x0' | 'z0' | 'x1' | 'z1'>): Rect =>
  r.x0 != null && r.z0 != null && r.x1 != null && r.z1 != null ? { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 } : annexRect(r.slot);
export const rectsOverlap = (a: Rect, b: Rect) => a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.z0 < b.z1 - 1e-6 && a.z1 > b.z0 + 1e-6;
/** Trecho em comum de duas bordas encostadas (onde cabe a porta), ou null. */
export function sharedEdge(a: Rect, b: Rect): { vertical: boolean; line: number; from: number; to: number } | null {
  const ov = (p0: number, p1: number, q0: number, q1: number) => [Math.max(p0, q0), Math.min(p1, q1)] as const;
  if (Math.abs(a.x1 - b.x0) < 1e-6 || Math.abs(a.x0 - b.x1) < 1e-6) {
    const [f, t] = ov(a.z0, a.z1, b.z0, b.z1);
    if (t - f > 1e-6) return { vertical: true, line: Math.abs(a.x1 - b.x0) < 1e-6 ? a.x1 : a.x0, from: f, to: t };
  }
  if (Math.abs(a.z1 - b.z0) < 1e-6 || Math.abs(a.z0 - b.z1) < 1e-6) {
    const [f, t] = ov(a.x0, a.x1, b.x0, b.x1);
    if (t - f > 1e-6) return { vertical: false, line: Math.abs(a.z1 - b.z0) < 1e-6 ? a.z1 : a.z0, from: f, to: t };
  }
  return null;
}
/** Encostadas com espaço para porta (a porta mais um respiro de cada lado). */
export const roomsJoin = (a: Rect, b: Rect) => { const e = sharedEdge(a, b); return !!e && e.to - e.from >= PLAN.door + 1; };
const BUILDING: Rect = { x0: -27, z0: -18, x1: PLAN.x0, z1: 18 };
/**
 * Salas originais (Recepção, Gerência, Vídeo…): mudam de lugar e de tamanho dentro do contorno do prédio, que fica
 * igual (as paredes do fundo e da esquerda, com a decoração de parede, não saem do lugar). O que sobra vira área livre.
 */
export const FOOTPRINT: Rect = { x0: -27, z0: -18, x1: 27, z1: 18 };
/** Até onde o prédio cresce, para qualquer lado (a decoração de parede acompanha as paredes do fundo e da esquerda). */
export const GROW = { x0: -70, z0: -50, x1: 70, z1: 40 };
export interface BaseRoomRect extends Rect { roomId: string }
/** O prédio: o contorno original, aumentado até onde as salas originais chegam (para qualquer lado). */
export function buildingOf(rooms: Rect[]): Rect {
  return rooms.reduce((b, r) => ({ x0: Math.min(b.x0, r.x0), z0: Math.min(b.z0, r.z0), x1: Math.max(b.x1, r.x1), z1: Math.max(b.z1, r.z1) }), { ...FOOTPRINT });
}
/** Confere a planta das salas originais (`annexes` = as salas novas, que ficam fora do prédio). */
export function basePlanProblem(rooms: { id: string; name: string; rect: Rect }[], annexes: { name: string; rect: Rect }[] = []): string | null {
  const g = PLAN.grid;
  for (const { name, rect: r } of rooms) {
    if ([r.x0, r.z0, r.x1, r.z1].some((v) => !Number.isFinite(v) || Math.abs(v / g - Math.round(v / g)) > 1e-6)) return `${name}: medidas fora da grade de meio metro.`;
    if (r.x0 < GROW.x0 - 1e-6 || r.z0 < GROW.z0 - 1e-6 || r.x1 > GROW.x1 + 1e-6 || r.z1 > GROW.z1 + 1e-6) return `${name} passou do limite do terreno.`;
    if (r.x1 - r.x0 < PLAN.minW || r.z1 - r.z0 < PLAN.minD) return `${name} ficou pequena demais (mínimo de ${PLAN.minW} × ${PLAN.minD} m).`;
  }
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++)
      if (rectsOverlap(rooms[i].rect, rooms[j].rect)) return `${rooms[i].name} e ${rooms[j].name} ficariam uma em cima da outra.`;
  // o prédio maior não pode engolir uma sala nova
  const b = buildingOf(rooms.map((r) => r.rect));
  const hit = annexes.find((a) => rectsOverlap(a.rect, b));
  if (hit) return `O prédio cresceria por cima de ${hit.name}. Mude ${hit.name} de lugar antes (ela fica do lado de fora, à direita).`;
  return null;
}

/** Confere a planta inteira das salas novas: devolve o problema, em português, ou null se está tudo certo. */
export function planProblem(rooms: { id: string; name: string; rect: Rect }[], building: Rect = BUILDING): string | null {
  const g = PLAN.grid;
  for (const { name, rect: r } of rooms) {
    if ([r.x0, r.z0, r.x1, r.z1].some((v) => !Number.isFinite(v) || Math.abs(v / g - Math.round(v / g)) > 1e-6)) return `${name}: medidas fora da grade de meio metro.`;
    if (r.x0 < building.x1 - 1e-6 || r.z0 < building.z0 - 1e-6 || r.z1 > building.z1 + 1e-6) return `${name} precisa ficar a leste do prédio, entre o fundo e a frente dele.`;
    if (r.x1 - r.x0 < PLAN.minW || r.z1 - r.z0 < PLAN.minD) return `${name} ficou pequena demais (mínimo de ${PLAN.minW} × ${PLAN.minD} m).`;
    if (r.x1 - r.x0 > PLAN.maxW || r.z1 - r.z0 > PLAN.maxD) return `${name} ficou grande demais (máximo de ${PLAN.maxW} × ${PLAN.maxD} m).`;
  }
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++)
      if (rectsOverlap(rooms[i].rect, rooms[j].rect)) return `${rooms[i].name} e ${rooms[j].name} ficariam uma em cima da outra.`;
  // todas precisam ter caminho até o prédio: encostando nele ou numa sala que chegue lá
  const reach = new Set<number>();
  const queue = rooms.map((r, i) => (roomsJoin(r.rect, building) ? i : -1)).filter((i) => i >= 0);
  queue.forEach((i) => reach.add(i));
  while (queue.length) {
    const i = queue.shift()!;
    rooms.forEach((r, j) => { if (!reach.has(j) && roomsJoin(rooms[i].rect, r.rect)) { reach.add(j); queue.push(j); } });
  }
  const lost = rooms.find((_, i) => !reach.has(i));
  return lost ? `${lost.name} ficaria sem porta: encoste no prédio ou em outra sala, com pelo menos ${PLAN.door + 1} m em comum.` : null;
}

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

/** Modelos que dá para escolher na conversa (os apelidos do Claude Code, que sempre apontam para o mais novo de cada família). */
export const MODEL_CHOICES = [
  { id: 'haiku', label: 'Haiku', hint: 'O mais leve e rápido: perguntas, listas, organizar pastas. Gasta pouquíssimo limite.' },
  { id: 'sonnet', label: 'Sonnet', hint: 'Equilibrado: dá conta da maior parte do trabalho gastando bem menos limite.' },
  { id: 'opus', label: 'Opus', hint: 'O mais capaz: estratégia, direção de arte e trabalhos difíceis. Gasta mais limite.' },
] as const;

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
  /** Modelo dos funcionários (sonnet gasta menos limite da assinatura); vazio = o padrão do Claude Code. */
  defaultModel?: string | null;
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
  /** Cliente de conteúdo ou projeto da casa (o site, o perfil da agência). Os dois têm equipe e pasta. */
  kind?: 'cliente' | 'projeto';
  /** Pasta do cliente, relativa ao rootPath do escritório ou absoluta. */
  folder: string | null;
  /** Pasta do cliente no Drive (relativa a driveRoot), lembrada do último envio. */
  driveFolder: string | null;
  /** Nicho na biblioteca de referências da agência (REFERENCIAS\\<nicho>); sem valor, é deduzido da marca. */
  niche?: string | null;
  monthlyFee: number;
  /** Dias da semana em que o cliente posta (0 = domingo … 6 = sábado). Padrão: segunda, quarta e sexta. */
  postDays?: number[];
  status: 'ativo' | 'pausado' | 'encerrado';
  color: string;
  /** Briefing do cliente (preenchido pela entrevista com o gerente ou à mão). */
  briefing: Briefing;
  /** Quem aprova as peças na esteira: uma pessoa ou o gerente de IA. */
  approvalMode: 'humano' | 'ia';
  /** Modelo desta conversa (haiku, sonnet, opus); vazio = o do escritório. */
  model?: 'haiku' | 'sonnet' | 'opus' | null;
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
      { label: 'Fotos editadas', test: '(^|/)FOTOS/.*EDITADAS?/|/Fotos Editadas[^/]*/' },
    ],
  },
  {
    id: 'reels', label: 'Reels falado', kind: 'video', stage: 'video', agent: 'editor-de-video', skill: 'editar-video',
    needs: [{ label: 'Padrão de edição (PADRAO-EDICAO.md)', test: 'PADRAO-EDICAO' }, NEEDS_BRUTOS],
  },
  { id: 'story-broll', label: 'Story de b-roll', kind: 'video', stage: 'video', agent: 'editor-de-video', skill: 'story-broll', needs: [NEEDS_BRUTOS] },
  { id: 'story-reuniao', label: 'Story de reunião', kind: 'video', stage: 'video', agent: 'editor-de-video', skill: 'story-reuniao', needs: [NEEDS_BRUTOS] },
  { id: 'fotos-ensaio', label: 'Tratar ensaio', kind: 'foto', stage: 'arte', agent: 'designer', skill: 'editar-ensaio', needs: [{ label: 'Fotos do ensaio', test: '(^|/)FOTOS/|/FOTOS BRUTAS/|/Fotos Editadas[^/]*/' }] },
  { id: 'fotos-comida', label: 'Tratar fotos de comida', kind: 'foto', stage: 'arte', agent: 'designer', skill: 'editar-comida', needs: [{ label: 'Fotos', test: '(^|/)FOTOS/|/FOTOS BRUTAS/|/Fotos Editadas[^/]*/' }] },
  { id: 'retoque', label: 'Retoque de retrato', kind: 'foto', stage: 'arte', agent: 'designer', skill: 'retoque-retrato', needs: [{ label: 'Fotos', test: '(^|/)FOTOS/|/FOTOS BRUTAS/|/Fotos Editadas[^/]*/' }] },
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
export const POST_STATUSES = ['planejado', 'referencia', 'composicao', 'tunning', 'conferencia', 'aprovado', 'drive', 'programado', 'postado', 'cancelado'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  planejado: 'planejado', referencia: 'referência', composicao: 'composição', tunning: 'tunning', conferencia: 'conferência',
  aprovado: 'aprovado', drive: 'no Drive', programado: 'programado', postado: 'postado', cancelado: 'cancelado',
};
/** Arte passa pelo tunning; o reels editado não. */
export const needsTunning = (f: PostFormat) => f !== 'reels';

/** Um post do calendário de conteúdo de um cliente, ligado à demanda que o produz. */
export interface PostDelivery {
  from: string;
  to: string;
  sha256: string;
  /** 1 na primeira entrega; cada reentrega com conteúdo novo soma 1 e guarda a anterior em _versoes. */
  version: number;
  at: string;
  by: string;
  /** Link do Drive (https://drive.google.com/file/d/…/view); null enquanto o Drive não terminou de subir. */
  link: string | null;
  /** Onde ficou a versão anterior, numa reentrega. */
  previous?: string | null;
}

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
  /** Pasta da peça em TRABALHOS (onde ficam FINAL/ e _trabalho/). */
  workDir: string | null;
  /** Arquivos finais na ordem de postagem (as lâminas do carrossel). Vazio: os da pasta FINAL/ da peça. */
  finals: string[];
  /** Cada arquivo entregue na pasta do mês, com o link do Drive quando o upload termina. */
  deliveries: PostDelivery[];
  /** Quando a social media agendou (AAAA-MM-DDTHH:MM). */
  scheduledAt?: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

// ---------- gestão mensal dos clientes (squad) ----------

/** As etapas que o squad acompanha em cada cliente, todo mês. */
export const MONTH_STEPS = ['ensaio', 'feito', 'aprovado', 'programado'] as const;
export type MonthStep = (typeof MONTH_STEPS)[number];
export const MONTH_STEP_LABEL: Record<MonthStep, string> = { ensaio: 'Ensaio do mês', feito: 'Conteúdo feito', aprovado: 'Conteúdo aprovado', programado: 'Programado' };
/** `na`: não se aplica neste mês (ex.: cliente sem ensaio). */
export const CHECK_STATES = ['pendente', 'andamento', 'ok', 'na'] as const;
export type CheckState = (typeof CHECK_STATES)[number];
export const CHECK_STATE_LABEL: Record<CheckState, string> = { pendente: 'pendente', andamento: 'em andamento', ok: 'ok', na: 'não se aplica' };

export interface MonthCheck { state: CheckState; note: string; by: string | null; at: string | null }

/** A checklist de um cliente num mês (AAAA-MM). */
export interface ClientMonth {
  clientId: ID;
  month: string;
  checks: Partial<Record<MonthStep, MonthCheck>>;
  note: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Contagem automática do mês, lida do calendário de posts e da pasta do mês. */
export interface MonthAuto {
  /** Posts do calendário no mês (sem os cancelados). */
  posts: number;
  /** Posts com arquivo (peça feita). */
  feitos: number;
  aprovados: number;
  programados: number;
  postados: number;
  /** Peças encontradas na pasta do mês do Drive (agrupando as lâminas). */
  pecas: number;
  /** Arquivos na pasta ENSAIOS do mês. */
  fotosEnsaio: number;
  /** A pasta do mês existe. */
  pasta: string | null;
}

export interface MonthRow {
  client: Client;
  squad: string | null;
  month: ClientMonth;
  auto: MonthAuto;
}

/** Uma peça da pasta do mês: as lâminas de um carrossel viram uma peça só. */
export interface MonthPiece {
  key: string;
  number: number | null;
  date: string | null;
  format: PostFormat | null;
  theme: string;
  files: string[];
  /** Está em POSTADOS (ou com _postado no nome). */
  posted: boolean;
  /** Post do calendário ligado a estes arquivos. */
  postId: ID | null;
  /** O nome não segue o padrão: veio solto na pasta. */
  loose: boolean;
}

/** Uma troca de nome proposta pelo "Aplicar na pasta". */
export interface RenamePlan { from: string; to: string }

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
  /** Funcionário de IA (a sessão) que faz esta tarefa. Revisão pela IA e tarefas antigas ficam sem. */
  workerId?: ID | null;
  prompt: string;
  status: JobStatus;
  sessionId: string | null;
  costUsd: number;
  /** Total que o Claude Code informou para a sessão na última rodada. */
  sessionCost?: number;
  /** tamanho da conversa (tokens relidos a cada passo) no último passo do funcionário */
  contextTokens?: number | null;
  /** modelo próprio da tarefa (ex.: sonnet); vazio = o padrão do Claude Code */
  model?: string | null;
  /** Pasta onde o funcionário roda: a do cliente, quando existe. */
  cwd?: string | null;
  /** Início da rodada atual (cada resposta a um checkpoint abre uma rodada na mesma sessão). */
  turnStartedAt?: string | null;
  /** Arquivada no painel do funcionário (some da lista; nada é apagado). */
  archivedAt?: string | null;
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
  /** arquivada: sai da lista principal (o arquivo da sessão não é apagado) */
  archivedAt?: string | null;
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
  /** Só na mesa fixa: tipo da mesa do catálogo que ficou no lugar dela (visual, tamanho e cadeiras). */
  as?: string;
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
  /** Mensagem direta entre duas pessoas: só chega para as duas. */
  | { t: 'dm'; message: DirectMessage }
  | { t: 'emote'; from: ID; emoji: string }
  /** Algo mudou no banco; a UI recarrega a coleção. */
  | { t: 'invalidate'; what: 'helpers' | 'workers' | 'months' | 'posts' | 'demands' | 'events' | 'transactions' | 'clients' | 'agents' | 'jobs' | 'timelines' | 'members' | 'live' | 'layout' | 'rooms' | 'walls' | 'limite' | 'baseRooms' }
  /** Aviso para todo mundo do escritório (ex.: peça esperando aprovação). */
  | { t: 'notice'; text: string; demandId?: ID; agentId?: ID }
  | { t: 'job'; job: AgentJob }
  | { t: 'jobMessage'; message: JobMessage }
  /** Progresso de render; `preview` = prévia rápida (não muda o status da timeline). */
  | { t: 'render'; timelineId: ID; progress: number; status: 'rodando' | 'concluido' | 'erro'; output?: string; error?: string; preview?: boolean };

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------- funcionários de IA: uma sessão = um funcionário, sempre de um cliente ou projeto ----------

/** Nomes dos funcionários, na ordem em que entram. Um nome não se repete entre os ativos. */
export const WORKER_NAMES = [
  'Vic', 'Duda', 'Theo', 'Rafa', 'Luna', 'Nico', 'Iris', 'Otto', 'Maya', 'Bento',
  'Lis', 'Davi', 'Nina', 'Enzo', 'Clara', 'Joca', 'Bela', 'Leo', 'Malu', 'Tito',
  'Cora', 'Ravi', 'Zoe', 'Ian', 'Lara', 'Gael', 'Mel', 'Kiko', 'Aurora', 'Dante',
  'Teca', 'Noah', 'Jade', 'Rui', 'Flora', 'Lino', 'Tai', 'Hugo', 'Vera', 'Benji',
  'Sol', 'Tom', 'Isa', 'Zeca', 'Nara', 'Igor', 'Pipa', 'Yuri', 'Cacá', 'Dora',
] as const;
/** Quantos funcionários podem estar ativos ao mesmo tempo (as sessões abertas). */
export const MAX_WORKERS = 50;

export type WorkerState = 'trabalhando' | 'aguardando' | 'copa';
export interface Worker {
  id: ID;
  officeId: ID;
  /** O cliente ou projeto dele: nasce, trabalha e é arquivado ali. */
  clientId: ID;
  name: string;
  color: string;
  /** Titular é a conversa contínua do cliente; ajudante faz uma tarefa em paralelo e devolve ao titular. */
  role: 'titular' | 'ajudante';
  parentId: ID | null;
  state: WorkerState;
  /** Sala onde está agora (a do tipo de trabalho, ou a copa). */
  room: string;
  createdAt: string;
  archivedAt: string | null;
  /** Passagem de bastão do funcionário anterior (virada de mês), lida antes de começar. */
  handoff?: string | null;
  /** Última vez que um trabalho dele andou (calculado pelo servidor). */
  lastJobAt?: string | null;
}

/** Horas sem trabalho depois das quais um funcionário parado some da Equipe e do mapa (continua na aba Equipe do cliente). */
export const WORKER_IDLE_HOURS = 24;

/** Funcionário que aparece na Equipe e no mapa: ativo e trabalhando, esperando você ou com trabalho nas últimas 24 h. */
export function isWorkerVisible(w: Worker, now = Date.now()) {
  if (w.archivedAt) return false;
  if (w.state !== 'copa') return true;
  const last = Date.parse(w.lastJobAt ?? w.createdAt);
  return !(now - last > WORKER_IDLE_HOURS * 3_600_000);
}

/** Conversa direta entre duas pessoas da equipe (a chamada de vídeo entra depois, no mesmo lugar). */
export interface DirectMessage {
  id: ID;
  officeId: ID;
  fromUser: ID;
  toUser: ID;
  text: string;
  createdAt: string;
  readAt: string | null;
}

/** Pedido de ajudante: um funcionário quer outra sessão para uma tarefa em paralelo; uma pessoa aprova. */
export interface HelperRequest {
  id: ID;
  officeId: ID;
  clientId: ID;
  /** Quem pediu. */
  workerId: ID;
  /** A tarefa de onde saiu o pedido: o resultado do ajudante volta para ela. */
  jobId: ID;
  task: string;
  reason: string;
  status: 'pendente' | 'aprovado' | 'recusado';
  helperId: ID | null;
  createdAt: string;
  decidedBy: string | null;
}

/** Limite da assinatura do Claude (fração usada, 0 a 1), como o Claude Code informou na última rodada. */
export interface ClaudeLimit { at?: string; fiveHour?: number | null; sevenDay?: number | null; fiveHourResets?: string | null; sevenDayResets?: string | null }
