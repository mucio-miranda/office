import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  APPROVAL_MARKER, BRIEFING_FIELDS, NETWORK_LABEL, STAGE_AGENT, STAGE_LABEL, uid,
  type AgentJob, type AgentProfile, type Briefing, type CalendarEvent, type Client, type Demand, type DemandKind, type Network, type Office,
  type Publish, type ReviewMark, type Stage, type StageLogEntry,
} from '@office/shared';
import { all, insert, logActivity, now, one, update } from '../db.ts';
import { broadcast, invalidate } from '../realtime.ts';
import { clientDir, folderName, indexClient, indexSummary, writeNew } from '../clients/folder.ts';
import { clientDriveFolder, driveInfo, driveSubdir, sendToDrive, type DriveItem } from '../clients/drive.ts';
import { enqueueJob } from './runtime.ts';
import { captionFrom, isInsideAny, latestFiles, marksText, producedFiles, slug, stageOutput } from './outputs.ts';

/**
 * Esteira de produção: cada demanda passa por etapas (pauta → copy → arte/vídeo → aprovação → pronto para
 * agendar). Quando o funcionário de uma etapa termina, a próxima começa sozinha com o resumo das anteriores.
 * A aprovação é de uma pessoa ou do gerente de IA, conforme o cliente.
 */

/** Tarefas de IA por demanda antes de a esteira parar e pedir uma pessoa (evita vai e volta sem fim). */
const MAX_JOBS_PER_DEMAND = 12;
/** Voltas de ajuste que a aprovação por IA pode pedir antes de chamar uma pessoa. */
const MAX_AI_ROUNDS = 2;

export function defaultPipeline(kind: DemandKind): Stage[] {
  switch (kind) {
    case 'video': return ['pauta', 'copy', 'video', 'aprovacao', 'agendado'];
    case 'design': case 'foto': return ['pauta', 'copy', 'arte', 'aprovacao', 'agendado'];
    case 'copy': return ['pauta', 'copy', 'aprovacao', 'agendado'];
    case 'estrategia': return ['pauta', 'aprovacao', 'agendado'];
    default: return ['copy', 'aprovacao', 'agendado'];
  }
}

const statusFor = (stage: Stage) => (stage === 'aprovacao' ? 'aprovacao' : stage === 'agendado' ? 'entregue' : 'em_producao');

function notice(officeId: string, text: string, extra: { demandId?: string; agentId?: string } = {}) {
  broadcast(officeId, { t: 'notice', text, ...extra });
}

const getDemand = (id: string) => one<Demand>('SELECT * FROM demands WHERE id = ?', id);
const getOffice = (id: string) => one<Office>('SELECT * FROM offices WHERE id = ?', id)!;
const getClient = (id: string | null) => (id ? one<Client>('SELECT * FROM clients WHERE id = ?', id) : undefined);
const agentBySlug = (officeId: string, s: string) => one<AgentProfile>('SELECT * FROM agents WHERE office_id = ? AND slug = ?', officeId, s);

function patchDemand(d: Demand, patch: Partial<Demand>) {
  update('demands', d.id, { ...patch, updatedAt: now() });
  invalidate(d.officeId, 'demands');
  return getDemand(d.id)!;
}

function addLog(d: Demand, entry: Omit<StageLogEntry, 'at'>, patch: Partial<Demand> = {}) {
  return patchDemand(d, { ...patch, stageLog: [...(d.stageLog ?? []), { ...entry, at: now() }] });
}

/** Pasta do cliente (ou onde ela vai ficar). */
function outDir(office: Office, client?: Client) {
  if (!client) return path.join(office.rootPath, 'CLIENTES', 'SEM CLIENTE');
  return clientDir(office, client) ?? path.join(office.rootPath, 'CLIENTES', folderName(client.name));
}

export function briefingText(b: Briefing | undefined) {
  const lines = BRIEFING_FIELDS.filter((f) => b?.[f.key]).map((f) => `- **${f.label}**: ${b![f.key]}`);
  return lines.length ? lines.join('\n') : 'Ainda sem briefing registrado: use o que houver na pasta do cliente.';
}

/** Contexto que todo funcionário da esteira recebe: demanda, briefing, arquivos e o que as etapas anteriores fizeram. */
function context(d: Demand, stage: Stage, office: Office, client?: Client) {
  const dir = outDir(office, client);
  const idx = client ? indexSummary(indexClient(dir)) : 'Demanda sem cliente.';
  const done = (d.stageLog ?? []).filter((e) => e.text).map((e) => `### ${STAGE_LABEL[e.stage]} (${e.result})\n${e.text}`).join('\n\n');
  const steps = d.pipeline.map((s) => (s === stage ? `**${STAGE_LABEL[s]}**` : STAGE_LABEL[s])).join(' → ');
  return `## Demanda: ${d.title}
Cliente: ${client?.name ?? '—'} · Tipo: ${d.kind} · Prioridade: ${d.priority} · Prazo: ${d.dueDate ?? '—'}
Esteira: ${steps}

${d.description || '(sem descrição)'}

## Briefing do cliente
${briefingText(client?.briefing)}

## Arquivos do cliente
${idx}

## O que já foi feito nesta demanda
${done || 'Nada ainda: esta é a primeira etapa.'}`;
}

function stageTask(stage: Stage, d: Demand, dir: string, version: number) {
  const out = stageOutput(stage, d, dir)?.path ?? dir;
  const v = version > 1
    ? `\nEsta é a **versão ${version}**: grave os arquivos novos com o sufixo \`-v${version}\` no nome (por exemplo \`${path.basename(out, path.extname(out))}-v${version}${path.extname(out) || '.png'}\`), na mesma pasta, sem apagar nem sobrescrever as versões anteriores.`
    : '';
  switch (stage) {
    case 'pauta':
      return `Crie a **pauta** da peça: objetivo, ideia central, formato (Reels, carrossel, post, story), gancho, mensagem principal e referências da pasta que vale usar. Salve em \`${out}\`.${v}`;
    case 'copy':
      return d.kind === 'video'
        ? `Escreva o **roteiro** a partir da pauta (falas, takes e textos na tela), seguindo o guia de roteiro da casa, e a legenda do post com CTA numa seção \`## Legenda\`. Salve em \`${out}\`.${v}`
        : `Escreva a **copy** a partir da pauta: os textos que vão na arte (título, apoio, CTA) e a legenda do post com CTA e hashtags numa seção \`## Legenda\`. Salve em \`${out}\`.${v}`;
    case 'arte':
      return `Produza a **arte** a partir da copy, na identidade do cliente, usando as skills de arte da casa e as suas ferramentas criativas. Use fotos do ensaio da pasta quando fizer sentido, sem alterar os originais. Salve os arquivos (PNG para a prévia e o PSD com camadas, ou equivalentes) em \`${out}\`.${v}`;
    case 'video':
      return `**Edite o vídeo** a partir do roteiro, com os brutos da pasta (skill editar-video e as suas ferramentas). Resultado em \`${out}\`.${v}`;
    default:
      return '';
  }
}

/** Versão que a próxima tarefa desta etapa vai produzir. */
const nextVersion = (d: Demand, stage: Stage) => (d.stageLog ?? []).filter((e) => e.stage === stage && e.result === 'feito').length + 1;

const AUTO_RULES = `Esta tarefa está na **esteira automática**: não pare nos checkpoints intermediários das skills. Decida pelo briefing e pelas etapas anteriores, e só pare (com a linha \`${APPROVAL_MARKER}\`) se faltar algo essencial, como um arquivo que não existe. Ao terminar, responda com um resumo curto: o que fez e os caminhos completos dos arquivos.`;

function reviewPrompt(d: Demand, office: Office, client?: Client) {
  return `${context(d, 'aprovacao', office, client)}

## Sua tarefa: aprovar ou pedir ajustes
O cliente deixou a aprovação das peças com a IA, e você é o aprovador. Abra os arquivos produzidos (os caminhos estão nas etapas acima) e compare com o briefing e a pauta: aderência ao briefing, identidade (cores, tom de voz), português, clareza do CTA e qualidade técnica. Não edite nada.
Termine com uma linha exata, sozinha:
\`VEREDITO: APROVADO\`
ou
\`VEREDITO: AJUSTAR — <o que mudar, em tópicos curtos>\``;
}

function briefingPrompt(client: Client, office: Office) {
  const dir = outDir(office, client);
  return `## Entrevista de briefing: ${client.name}
Você vai conduzir a entrevista de briefing deste cliente com a equipe, pelo chat do escritório.

1. Antes de perguntar, veja o que já existe na pasta do cliente (\`${dir}\`): identidade visual, documentos, nomes dos arquivos. Não pergunte o que já está lá; só confirme.
${indexSummary(indexClient(dir))}
2. Pergunte em blocos curtos (no máximo 4 perguntas por vez), em linguagem simples, e termine cada bloco com a linha \`${APPROVAL_MARKER}\` para esperar a resposta. Assuntos: ${BRIEFING_FIELDS.map((f) => f.label.toLowerCase()).join(', ')}.
3. Quando tiver o suficiente, mostre o resumo e pergunte se está certo (também com a linha do marcador).
4. Depois da confirmação, responda **só** com o bloco abaixo, em JSON válido. O Office grava o BRIEFING.md na pasta e cria as demandas sugeridas:
\`\`\`briefing
{"segmento": "", "publico": "", "objetivos": "", "tomDeVoz": "", "cores": "", "diferenciais": "", "concorrentes": "", "redes": "", "frequencia": "", "observacoes": "",
 "demandas": [{"titulo": "", "tipo": "design|video|copy|estrategia|foto", "descricao": ""}]}
\`\`\`
Sugira de 3 a 6 demandas para o primeiro mês.`;
}

// ---------------------------------------------------------------- andar da esteira

function runStage(d: Demand, stage: Stage, by: string, feedback?: string): string | null {
  const office = getOffice(d.officeId);
  const client = getClient(d.clientId);
  if (stage === 'aprovacao') return approvalStage(d, by);
  if (stage === 'agendado') {
    addLog(d, { stage, by, jobId: null, text: 'Pronta para agendar a publicação.', result: 'feito' }, { stage, status: 'entregue', auto: false });
    notice(d.officeId, `"${d.title}" está pronta para agendar`, { demandId: d.id });
    logActivity(d.officeId, by, 'concluiu a esteira de', d.title);
    return null;
  }
  const agentSlug = STAGE_AGENT[stage];
  const agent = agentSlug ? agentBySlug(d.officeId, agentSlug) : undefined;
  if (!agent) {
    patchDemand(d, { stage, auto: false });
    return `Nenhum funcionário de IA faz a etapa ${STAGE_LABEL[stage]}.`;
  }
  const jobs = (all<{ id: string }>('SELECT id FROM jobs WHERE demand_id = ?', d.id)).length;
  if (jobs >= MAX_JOBS_PER_DEMAND) {
    patchDemand(d, { auto: false });
    notice(d.officeId, `A esteira de "${d.title}" parou: já foram ${jobs} tarefas de IA. Veja o que está travando.`, { demandId: d.id });
    return 'Limite de tarefas desta demanda.';
  }
  const fresh = patchDemand(d, { stage, status: statusFor(stage), assignee: `agent:${agent.id}`, auto: true });
  const prompt = stage === 'briefing' && client
    ? briefingPrompt(client, office)
    : `${context(fresh, stage, office, client)}

## Sua tarefa nesta etapa (${STAGE_LABEL[stage]})
${stageTask(stage, fresh, outDir(office, client), nextVersion(fresh, stage))}
${feedback ? `\n## Ajustes pedidos\n${feedback}\nRefaça só o que foi pedido, mantendo o resto.\n` : ''}
${AUTO_RULES}`;
  enqueueJob({ officeId: d.officeId, agentId: agent.id, demandId: d.id, prompt, createdBy: by, stage });
  return null;
}

function approvalStage(d: Demand, by: string): string | null {
  const client = getClient(d.clientId);
  const fresh = patchDemand(d, { stage: 'aprovacao', status: 'aprovacao' });
  if (client?.approvalMode === 'ia' && fresh.reviewRounds <= MAX_AI_ROUNDS) {
    const rafa = agentBySlug(d.officeId, 'gerente');
    if (rafa) {
      patchDemand(fresh, { assignee: `agent:${rafa.id}` });
      enqueueJob({ officeId: d.officeId, agentId: rafa.id, demandId: d.id, prompt: reviewPrompt(fresh, getOffice(d.officeId), client), createdBy: by, stage: 'aprovacao' });
      return null;
    }
  }
  patchDemand(fresh, { assignee: null });
  notice(d.officeId, `"${d.title}" está esperando a sua aprovação`, { demandId: d.id });
  logActivity(d.officeId, 'sistema', 'pediu aprovação de', d.title);
  return null;
}

/** Próxima etapa depois da atual (a atual já terminou). */
function nextAfter(d: Demand, stage: Stage | null): Stage | null {
  const i = stage ? d.pipeline.indexOf(stage) : -1;
  return d.pipeline[i + 1] ?? null;
}

/** Última etapa de produção antes da aprovação (para onde vão os ajustes). */
function productionStage(d: Demand): Stage | null {
  const i = d.pipeline.indexOf('aprovacao');
  const before = (i >= 0 ? d.pipeline.slice(0, i) : d.pipeline).filter((s) => STAGE_AGENT[s] && s !== 'briefing');
  return before.at(-1) ?? null;
}

// ---------------------------------------------------------------- ações (rotas)

/** Liga a esteira: começa na etapa atual (ou na primeira) ou segue da que já terminou. */
export function startPipeline(demandId: string, by: string) {
  let d = getDemand(demandId);
  if (!d) return 'Demanda não encontrada.';
  if (!d.pipeline?.length) d = patchDemand(d, { pipeline: defaultPipeline(d.kind) });
  if (all<AgentJob>("SELECT id FROM jobs WHERE demand_id = ? AND status IN ('fila','rodando','aguardando')", d.id).length)
    return 'Um funcionário já está nesta demanda. Espere ele terminar (ou cancele a tarefa).';
  let stage = d.stage ?? d.pipeline[0];
  const last = d.stageLog?.at(-1);
  if (last && last.stage === stage && last.result === 'feito' && stage !== 'agendado') stage = nextAfter(d, stage) ?? stage;
  if (stage === 'agendado' && d.status === 'entregue') return 'Esta demanda já terminou a esteira.';
  logActivity(d.officeId, by, 'ligou a esteira de', d.title);
  return runStage(d, stage, by);
}

export function pausePipeline(demandId: string) {
  const d = getDemand(demandId);
  if (d) patchDemand(d, { auto: false });
}

export function approveDemand(demandId: string, by: string) {
  const d = getDemand(demandId);
  if (!d) return 'Demanda não encontrada.';
  if (d.stage !== 'aprovacao' || d.status !== 'aprovacao') return 'Esta demanda não está esperando aprovação.';
  if (all<AgentJob>("SELECT id FROM jobs WHERE demand_id = ? AND status IN ('fila','rodando','aguardando')", d.id).length)
    return 'A revisão ainda está em andamento. Espere ela terminar.';
  const fresh = addLog(d, { stage: 'aprovacao', by, jobId: null, text: 'Aprovado.', result: 'aprovado' });
  return runStage(fresh, nextAfter(fresh, 'aprovacao') ?? 'agendado', by);
}

export function requestChanges(demandId: string, text: string, by: string, marks: ReviewMark[] = []) {
  const d = getDemand(demandId);
  if (!d) return 'Demanda não encontrada.';
  if (d.stage !== 'aprovacao') return 'Esta demanda não está esperando aprovação.';
  if (all<AgentJob>("SELECT id FROM jobs WHERE demand_id = ? AND status IN ('fila','rodando','aguardando')", d.id).length)
    return 'Um funcionário ainda está nesta demanda. Espere ele terminar.';
  const back = productionStage(d);
  if (!back) return 'Não há etapa de produção para refazer.';
  const fresh = addLog(d, { stage: 'aprovacao', by, jobId: null, text, result: 'ajustes', ...(marks.length ? { marks } : {}) }, { reviewRounds: d.reviewRounds + 1 });
  return runStage(fresh, back, by, [text, marksText(marks)].filter(Boolean).join('\n\n'));
}

/** Cliente novo: abre a demanda de briefing e o gerente começa a entrevista. */
export function startBriefing(client: Client, by: string) {
  const d: Demand = {
    id: uid(), officeId: client.officeId, clientId: client.id, title: `Briefing: ${client.name}`,
    description: 'Entrevista de briefing com a equipe. As respostas vão para o BRIEFING.md da pasta do cliente.',
    kind: 'estrategia', status: 'em_producao', priority: 'alta', assignee: null, dueDate: null, trackedSeconds: 0, timerStartedAt: null,
    position: Date.now(), createdAt: now(), updatedAt: now(), pipeline: ['briefing'], stage: null, auto: true, stageLog: [], reviewRounds: 0, publish: null,
  };
  insert('demands', d as never);
  invalidate(client.officeId, 'demands');
  const err = runStage(d, 'briefing', by);
  return { demandId: d.id, agentId: agentBySlug(client.officeId, 'gerente')?.id ?? null, error: err };
}

// ---------------------------------------------------------------- fim de cada tarefa

/** Chamado pelo runtime quando a tarefa de um funcionário termina (sem pedir aprovação no meio). */
export function onJobFinished(job: AgentJob, finalText: string, ok: boolean) {
  if (!job.demandId) return;
  const d = getDemand(job.demandId);
  if (!d) return;
  // tarefa avulsa (delegada à mão): o cartão vai para Aprovação, como antes
  if (!job.stage) {
    if (ok) patchDemand(d, { status: 'aprovacao' });
    return;
  }
  const by = `agent:${job.agentId}`;
  const summary = finalText.replace(APPROVAL_MARKER, '').trim().slice(0, 2500);
  if (!ok) {
    addLog(d, { stage: job.stage, by, jobId: job.id, text: summary || 'A tarefa parou com erro.', result: 'erro' }, { auto: false });
    notice(d.officeId, `A esteira de "${d.title}" parou com erro na etapa ${STAGE_LABEL[job.stage]}`, { demandId: d.id, agentId: job.agentId });
    return;
  }
  if (job.stage === 'briefing') return finishBriefing(job, d, finalText);
  if (job.stage === 'aprovacao') {
    const m = finalText.match(/VEREDITO:\s*(APROVADO|AJUSTAR)\s*[—–-]?\s*([\s\S]*)$/i);
    if (m && m[1].toUpperCase() === 'APROVADO') {
      const fresh = addLog(d, { stage: 'aprovacao', by, jobId: job.id, text: summary, result: 'aprovado' });
      if (fresh.auto) runStage(fresh, nextAfter(fresh, 'aprovacao') ?? 'agendado', by);
      return;
    }
    const back = productionStage(d);
    if (m && back && d.reviewRounds < MAX_AI_ROUNDS) {
      const fresh = addLog(d, { stage: 'aprovacao', by, jobId: job.id, text: summary, result: 'ajustes' }, { reviewRounds: d.reviewRounds + 1 });
      if (fresh.auto) runStage(fresh, back, by, m[2].trim() || summary);
      return;
    }
    // sem veredito claro ou voltas demais: chama uma pessoa
    addLog(d, { stage: 'aprovacao', by, jobId: job.id, text: summary, result: 'feito' }, { assignee: null });
    notice(d.officeId, `"${d.title}" precisa da sua aprovação (a revisão da IA não fechou)`, { demandId: d.id });
    return;
  }
  const office = getOffice(d.officeId);
  const files = producedFiles({ finalText, since: job.createdAt, stage: job.stage, d, clientDir: outDir(office, getClient(d.clientId)), inside: isInsideAny(office) });
  const fresh = addLog(d, { stage: job.stage, by, jobId: job.id, text: summary, result: 'feito', files, version: nextVersion(d, job.stage) });
  if (!fresh.auto) return;
  const next = nextAfter(fresh, job.stage);
  if (next) runStage(fresh, next, by);
}

/** Lê o bloco ```briefing``` da resposta final, grava o BRIEFING.md e cria as demandas sugeridas. */
function finishBriefing(job: AgentJob, d: Demand, finalText: string) {
  const client = getClient(d.clientId);
  const by = `agent:${job.agentId}`;
  const raw = finalText.match(/```briefing\s*([\s\S]*?)```/)?.[1] ?? finalText.match(/```json\s*([\s\S]*?)```/)?.[1];
  let data: (Briefing & { demandas?: { titulo?: string; tipo?: string; descricao?: string }[] }) | null = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!client || !data) {
    addLog(d, { stage: 'briefing', by, jobId: job.id, text: 'Não encontrei o bloco do briefing na resposta. Peça ao gerente para mandar o bloco ```briefing``` de novo.', result: 'erro' }, { auto: false });
    notice(d.officeId, `O briefing de ${client?.name ?? 'cliente'} não veio no formato esperado`, { demandId: d.id, agentId: job.agentId });
    return;
  }
  const office = getOffice(d.officeId);
  const briefing: Briefing = { feitoEm: now() };
  for (const f of BRIEFING_FIELDS) if (typeof data[f.key] === 'string' && data[f.key]!.trim()) briefing[f.key] = data[f.key]!.trim();
  update('clients', client.id, { briefing });
  invalidate(d.officeId, 'clients');

  let file = '';
  try {
    const md = `# Briefing: ${client.name}\n\nEntrevista feita no Office em ${new Date().toLocaleDateString('pt-BR')}.\n\n${BRIEFING_FIELDS.filter((f) => briefing[f.key]).map((f) => `## ${f.label}\n${briefing[f.key]}`).join('\n\n')}\n`;
    file = writeNew(path.join(outDir(office, client), 'DOCUMENTOS'), 'BRIEFING.md', md);
  } catch (e) {
    file = `(não consegui gravar o arquivo: ${(e as Error).message})`;
  }

  const kinds: DemandKind[] = ['video', 'design', 'copy', 'estrategia', 'foto', 'outro'];
  const sugg = (data.demandas ?? []).filter((x) => x?.titulo).slice(0, 8);
  for (const [i, s] of sugg.entries()) {
    const kind = (kinds.includes(s.tipo as DemandKind) ? s.tipo : 'outro') as DemandKind;
    insert('demands', {
      id: uid(), officeId: d.officeId, clientId: client.id, title: String(s.titulo).slice(0, 140), description: String(s.descricao ?? ''),
      kind, status: 'backlog', priority: 'media', assignee: null, dueDate: null, trackedSeconds: 0, timerStartedAt: null,
      position: Date.now() + i, createdAt: now(), updatedAt: now(), pipeline: defaultPipeline(kind), stage: null, auto: false, stageLog: [], reviewRounds: 0, publish: null,
    } as never);
  }
  addLog(d, { stage: 'briefing', by, jobId: job.id, text: `Briefing gravado em ${file}. ${sugg.length} demanda(s) sugerida(s) no Backlog.`, result: 'feito' },
    { status: 'entregue', auto: false });
  logActivity(d.officeId, by, 'fechou o briefing de', client.name);
  notice(d.officeId, `Briefing de ${client.name} pronto: ${sugg.length} demanda(s) sugerida(s) no Backlog`, { demandId: d.id });
}

// ---------------------------------------------------------------- publicação

/** Peças finais e legenda sugerida para o pacote de publicação (a legenda sai da seção "Legenda" da copy). */
export function publishDraft(demandId: string) {
  const d = getDemand(demandId);
  if (!d) return null;
  const { byStage, final } = latestFiles(d);
  const copy = byStage.copy?.find((f) => f.toLowerCase().endsWith('.md'));
  return { files: final, caption: d.publish?.caption ?? captionFrom(copy) };
}

const pad = (n: number) => String(n).padStart(2, '0');
const localStamp = (t: Date) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;

/**
 * Agenda a publicação de uma demanda pronta: evento no calendário e pacote na pasta do cliente
 * (PUBLICAR/<data> <peça>/POST.md com a legenda, as redes, o horário e os caminhos das peças).
 */
export function schedulePublish(demandId: string, input: { at: string; networks: Network[]; caption: string; files?: string[] }, by: string): string | null {
  const d = getDemand(demandId);
  if (!d) return 'Demanda não encontrada.';
  if (d.stage !== 'agendado' || d.status !== 'entregue') return 'A demanda ainda não foi aprovada.';
  if (d.publish?.status === 'publicado') return 'Esta peça já foi publicada.';
  const when = new Date(input.at);
  if (Number.isNaN(when.getTime())) return 'Data inválida.';
  const office = getOffice(d.officeId);
  const client = getClient(d.clientId);
  const files = input.files?.length ? input.files : latestFiles(d).final;

  // evento no calendário (o mesmo, se for um reagendamento)
  const ev: CalendarEvent = {
    id: d.publish?.eventId ?? uid(), officeId: d.officeId, title: `Publicar: ${d.title}`, start: localStamp(when),
    end: localStamp(new Date(when.getTime() + 30 * 60_000)), kind: 'publicacao', clientId: d.clientId, demandId: d.id, room: null,
  };
  if (d.publish?.eventId && one('SELECT id FROM events WHERE id = ?', d.publish.eventId)) update('events', ev.id, { title: ev.title, start: ev.start, end: ev.end });
  else insert('events', ev as never);
  invalidate(d.officeId, 'events');

  // pacote na pasta do cliente (o mesmo POST.md é reescrito ao reagendar)
  let folder = d.publish?.folder ?? null;
  try {
    folder ??= path.join(outDir(office, client), 'PUBLICAR', `${ev.start.slice(0, 10)} ${slug(d.title)}`);
    const md = `# ${d.title}

- **Cliente**: ${client?.name ?? '—'}
- **Quando**: ${when.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}
- **Onde**: ${input.networks.map((n) => NETWORK_LABEL[n]).join(', ') || '—'}

## Legenda
${input.caption.trim() || '(sem legenda)'}

## Peças
${files.map((f) => `- ${f}`).join('\n') || '- (nenhum arquivo registrado)'}

Pacote gerado pelo Office. Depois de postar, marque como publicado na demanda.
`;
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'POST.md'), md, 'utf8');
  } catch (e) {
    folder = null;
    notice(d.officeId, `Agendei "${d.title}", mas não consegui gravar o pacote: ${(e as Error).message}`, { demandId: d.id });
  }

  const publish: Publish = { at: ev.start, networks: input.networks, caption: input.caption, files, folder, eventId: ev.id, status: 'agendado', reminded: false };
  addLog(d, { stage: 'agendado', by, jobId: null, text: `Publicação agendada para ${when.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} (${input.networks.map((n) => NETWORK_LABEL[n]).join(', ')}).`, result: 'feito' }, { publish });
  logActivity(d.officeId, by, 'agendou a publicação de', d.title);
  return null;
}

// ---------------------------------------------------------------- envio para o Drive

/** Peças da versão aprovada de cada etapa: é só isso que pode ir para o Drive. */
const approvedFiles = (d: Demand) => [...new Set(Object.values(latestFiles(d).byStage).flat())].filter((f) => existsSync(f));

/** O que o botão de envio mostra: a pasta sugerida e cada peça com a subpasta dela (a mesma da pasta local). */
export function driveDraft(demandId: string) {
  const d = getDemand(demandId);
  if (!d) return null;
  const office = getOffice(d.officeId);
  const client = getClient(d.clientId);
  const info = driveInfo(office.driveRoot);
  const local = client ? clientDir(office, client) : null;
  return {
    ...info,
    folder: info.ok ? clientDriveFolder(office.driveRoot!, client) : '',
    files: approvedFiles(d).map((file) => ({ file, sub: driveSubdir(local, file), size: statSync(file).size })),
  };
}

export async function sendDemandToDrive(demandId: string, input: { folder: string; items: DriveItem[] }, by: string) {
  const d = getDemand(demandId);
  if (!d) return 'Demanda não encontrada.';
  if (d.stage !== 'agendado' || d.status !== 'entregue') return 'Só o trabalho aprovado vai para o Drive.';
  const office = getOffice(d.officeId);
  if (!office.driveRoot) return 'Defina a pasta do Drive em Equipe > Pastas do escritório.';
  const allowed = new Set(approvedFiles(d));
  const strange = input.items.find((it) => !allowed.has(it.file));
  if (strange) return `${path.basename(strange.file)} não é uma peça aprovada desta demanda.`;
  const res = await sendToDrive(office.driveRoot, input.folder, input.items);
  if (typeof res === 'string') return res;
  const fresh = getDemand(demandId)!;
  if (res.sent.length || res.skipped.length) {
    const parts = [`${res.sent.length} arquivo(s) enviado(s)`, res.skipped.length && `${res.skipped.length} já estava(m) lá`, res.failed.length && `${res.failed.length} com erro`].filter(Boolean);
    addLog(fresh, { stage: 'agendado', by, jobId: null, text: `Drive (${input.folder}): ${parts.join(', ')}.`, result: 'feito', drive: input.folder });
    if (d.clientId) { update('clients', d.clientId, { driveFolder: input.folder }); invalidate(d.officeId, 'clients'); }
    logActivity(d.officeId, by, `enviou ${res.sent.length} arquivo(s) ao Drive de`, d.title);
  }
  return res;
}

export function markPublished(demandId: string, by: string): string | null {
  const d = getDemand(demandId);
  if (!d?.publish) return 'Esta demanda não tem publicação agendada.';
  if (d.publish.status === 'publicado') return null;
  addLog(d, { stage: 'agendado', by, jobId: null, text: 'Publicado.', result: 'feito' }, { publish: { ...d.publish, status: 'publicado', publishedAt: now() } });
  logActivity(d.officeId, by, 'publicou', d.title);
  return null;
}

/** Avisa no escritório quando chega a hora de uma publicação agendada (roda a cada minuto). */
export function publishReminders() {
  const stamp = localStamp(new Date());
  for (const d of all<Demand>("SELECT * FROM demands WHERE publish IS NOT NULL")) {
    const p = d.publish;
    if (!p || p.status !== 'agendado' || p.reminded || p.at > stamp) continue;
    patchDemand(d, { publish: { ...p, reminded: true } });
    notice(d.officeId, `Hora de publicar "${d.title}" (${p.networks.map((n) => NETWORK_LABEL[n]).join(', ')}). O pacote está na pasta do cliente.`, { demandId: d.id });
  }
}
