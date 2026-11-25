import { ClientDrive } from './ClientDrive';
import { canSeeFinance, canWork } from '@office/shared';
import { useEffect, useState } from 'react';
import { Archive as ArchiveIcon, Bot, ChevronRight, FolderInput, FolderOpen, FolderPlus, History, PanelLeftClose, Pencil, PanelLeftOpen, Plus, Settings2, Sparkles, Terminal, Users, X } from 'lucide-react';
import { BRIEFING_FIELDS, type Briefing, type Client, type ClientSession, type Worker } from '@office/shared';
import { useStore } from '../lib/store';
import { api, brl, parseMoney } from '../lib/api';
import { PathField } from '../lib/PathPicker';
import { StageTrack } from './Demands';
import { Conversa, when } from './Conversa';
import { desktop } from '../lib/desktop';
import { usePersisted } from '../lib/persisted';



/**
 * Clientes: cadastro com a pasta no padrão da casa, briefing (entrevista com o gerente de IA ou à mão),
 * índice dos arquivos da pasta e as demandas do cliente com a esteira.
 */
export function Clients() {
  const { clients, panelArg, office, jobs } = useStore();
  const working = new Set(jobs.filter((j) => j.status === 'rodando' || j.status === 'fila').map((j) => j.clientId));
  const [sel, setSel] = useState<string | null>(panelArg ?? null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sq, setSq] = useState<SquadInfo>({ squads: [], byClient: {} });
  useEffect(() => { if (panelArg) setSel(panelArg); }, [panelArg]);
  const sig = clients.map((c) => `${c.id}:${c.folder}:${c.name}`).join('|');
  useEffect(() => {
    if (office) api<SquadInfo>(`/api/offices/${office.id}/squads`).then(setSq).catch(() => setSq({ squads: [], byClient: {} }));
  }, [office?.id, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = clients.find((c) => c.id === sel) ?? clients[0];
  // com squads definidos, a lista vem agrupada: um bloco por squad e os sem squad no fim
  const [only, pick] = usePersisted<string>('office.clients.squad', '');
  // lista recolhida: vira uma coluna estreita só com a cor de cada cliente
  const [collapsed, setCollapsed] = usePersisted<boolean>('office.clients.collapsed', false);
  // pausados e encerrados saem dos grupos e vão para o bloco "Inativos", no fim (recolhido)
  const active = clients.filter((c) => c.status === 'ativo');
  const inactive = clients.filter((c) => c.status !== 'ativo');
  const [showInactive, setShowInactive] = usePersisted<boolean>('office.clients.inactive', false);
  const allGroups = sq.squads.length
    ? [...sq.squads.map((s) => ({ key: s.id, squad: s as Squad | null, items: active.filter((c) => sq.byClient[c.id] === s.id) })),
      { key: '-', squad: null, items: active.filter((c) => !sq.byClient[c.id]) }].filter((g) => g.items.length)
    : [{ key: '-', squad: null, items: active }];
  // filtro: só um squad (ou só os sem squad); um squad que sumiu do mapa volta a mostrar todos
  const filtering = !!only && allGroups.some((g) => g.key === only);
  const groups = filtering ? allGroups.filter((g) => g.key === only) : allGroups;
  const squadOf = (c: Client) => sq.squads.find((s) => s.id === sq.byClient[c.id]) ?? null;

  return (
    <div className={`clients-page ${collapsed ? 'list-collapsed' : ''}`}>
      {collapsed ? (
        <aside className="clients-rail" aria-label="Clientes">
          <button className="icon" onClick={() => setCollapsed(false)} aria-label="Expandir a lista de clientes" title="Expandir a lista de clientes"><PanelLeftOpen size={16} /></button>
          {groups.map((g) => g.items.map((c) => (
            <button key={c.id} className={`rail-client ${current?.id === c.id ? 'active' : ''}`} onClick={() => setSel(c.id)} title={c.name} aria-label={c.name}>
              <span className="dot" style={{ background: c.color }} />
              <span className="rail-initial">{c.name.replace(/^(Dra?\.?\s+)/i, '')[0]}</span>
              {working.has(c.id) && <span className="status-dot st-trabalhando" />}
            </button>
          )))}
        </aside>
      ) : (
      <aside className="clients-list">
        <div className="clients-list-head">
          <b>Clientes</b><span className="muted small">{clients.length}</span>
          <span className="spacer" />
          <button className="icon" onClick={() => setCollapsed(true)} aria-label="Recolher a lista de clientes" title="Recolher a lista de clientes"><PanelLeftClose size={16} /></button>
        </div>
        <button className="primary" onClick={() => setCreating(true)}><Plus size={14} /> Novo cliente</button>
        <button className="ghost" onClick={() => setImporting(true)}><FolderInput size={14} /> Importar da pasta</button>
        {sq.squads.length > 0 && (
          <select className="squad-filter" value={filtering ? only : ''} onChange={(e) => pick(e.target.value)} aria-label="Filtrar por squad">
            <option value="">Todos os squads</option>
            {sq.squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            {allGroups.some((g) => g.key === '-') && <option value="-">Sem squad</option>}
          </select>
        )}
        {groups.map((g) => (
          <div key={g.key} className="client-group">
            {sq.squads.length > 0 && (
              <div className="squad-head" title={g.squad ? squadRoles(g.squad) : 'Clientes que não estão em nenhum squad (squads.json)'}>
                <Users size={12} /> <b className="truncate">{g.squad?.nome ?? 'Sem squad'}</b> <span className="muted">{g.items.length}</span>
              </div>
            )}
            {g.items.map((c) => (
              <button key={c.id} className={`client-item ${current?.id === c.id ? 'active' : ''}`} onClick={() => setSel(c.id)}>
                <span className="dot" style={{ background: c.color }} />
                <span className="truncate">{c.name}</span>
                {working.has(c.id) && <span className="status-dot st-trabalhando" title="Trabalhando agora" />}
                {!c.briefing?.feitoEm && !BRIEFING_FIELDS.some((x) => c.briefing?.[x.key]) && <span className="alert-dot" title="Sem briefing" />}
              </button>
            ))}
          </div>
        ))}
        {inactive.length > 0 && (
          <div className="client-group inactive">
            <button className="squad-head squad-toggle" onClick={() => setShowInactive(!showInactive)} aria-expanded={showInactive}
              title={`${showInactive ? 'Esconder' : 'Mostrar'} os clientes pausados ou encerrados (a situação muda no topo do cliente)`}>
              <ChevronRight size={12} className={showInactive ? 'open' : ''} /> <b className="truncate">Inativos</b> <span className="muted">{inactive.length}</span>
            </button>
            {showInactive && inactive.map((c) => (
              <button key={c.id} className={`client-item ${current?.id === c.id ? 'active' : ''}`} onClick={() => setSel(c.id)}>
                <span className="dot" style={{ background: c.color, opacity: 0.5 }} />
                <span className="truncate muted">{c.name}</span>
                <span className="muted small">{c.status === 'pausado' ? 'pausado' : 'encerrado'}</span>
              </button>
            ))}
          </div>
        )}
        {clients.length === 0 && <p className="muted small">Nenhum cliente ainda.</p>}
      </aside>
      )}
      {current ? <ClientDetail key={current.id} c={current} squad={squadOf(current)} /> : (
        <div className="empty">
          <p>Cadastre o primeiro cliente: o Office cria a pasta no padrão da casa e a Rafa faz a entrevista de briefing. Se as pastas já existem, é só importar.</p>
          <div className="row gap">
            <button className="primary" onClick={() => setCreating(true)}><Plus size={14} /> Novo cliente</button>
            <button className="ghost" onClick={() => setImporting(true)}><FolderInput size={14} /> Importar da pasta</button>
          </div>
        </div>
      )}
      {creating && <NewClient onClose={(id) => { setCreating(false); if (id) setSel(id); }} />}
      {importing && <ImportClients onClose={() => setImporting(false)} />}
    </div>
  );
}

interface Squad { id: string; nome: string; socialMedia: string | null; designProducao: string | null }
interface SquadInfo { squads: Squad[]; byClient: Record<string, string | null> }
const squadRoles = (s: Squad) => [s.socialMedia && `Social media: ${s.socialMedia}`, s.designProducao && `Design/produção: ${s.designProducao}`].filter(Boolean).join(' · ');

type Tab = 'conversa' | 'sessoes' | 'briefing' | 'demandas' | 'arquivos';

/**
 * Tela do cliente: topo com o essencial (squad, situação, abrir pasta), ajustes raros num botão e abas para tudo o
 * que é do cliente. A conversa fica com a altura toda; as sessões têm aba própria.
 */
function ClientDetail({ c, squad }: { c: Client; squad: Squad | null }) {
  const { office, demands, agents, jobs, open, notify, workers } = useStore();
  const base = `/api/offices/${office!.id}/clients/${c.id}`;
  // a equipe deste cliente: o titular (a conversa contínua), ajudantes e quem já trabalhou aqui
  const team = workers.filter((w) => w.clientId === c.id);
  const helpers = team.filter((w) => w.role === 'ajudante' && !w.archivedAt);
  const patch = (body: Partial<Client>) => api(base, { method: 'PATCH', body });
  const mine = demands.filter((d) => d.clientId === c.id);
  const rafa = agents.find((a) => a.slug === 'gerente');
  const [tab, setTab] = useState<Tab>('conversa');
  const [settings, setSettings] = useState(false);
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  // null = a sessão escolhida; um id = uma conversa anterior (Office ou terminal), só para ler até alguém continuar nela
  const [view, setView] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // as sessões abertas do cliente (uma por demanda): quem espera você primeiro, depois quem está trabalhando
  const order = (w: Worker) => (w.state === 'aguardando' ? 0 : w.state === 'trabalhando' ? 1 : 2);
  const openSessions = team.filter((w) => w.role === 'titular' && !w.archivedAt)
    .sort((a, b) => order(a) - order(b) || (b.lastJobAt ?? b.createdAt).localeCompare(a.lastJobAt ?? a.createdAt));
  const [sel, setSel] = useState<string | null>(null);
  const session = openSessions.find((w) => w.id === sel) ?? openSessions[0] ?? null;
  // ao entrar no cliente, abre a que precisa de você (ou a última que andou)
  useEffect(() => { setSel(openSessions[0]?.id ?? null); setView(null); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [carry, setCarry] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const clientJobs = jobs.filter((j) => j.clientId === c.id);
  // rodando ou na fila = trabalhando de verdade; aguardando = parou e espera sua aprovação (nada roda)
  const jobRunning = clientJobs.some((j) => j.status === 'rodando' || j.status === 'fila');
  const jobWaiting = !jobRunning && clientJobs.some((j) => j.status === 'aguardando');
  useEffect(() => {
    api<ClientSession[]>(`${base}/sessoes`).then(setSessions).catch(() => setSessions([]));
  }, [base, c.sessionId, clientJobs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const interview = async () => {
    try {
      const r = await api(`${base}/briefing`, { body: {} });
      notify(`${rafa?.name ?? 'O gerente'} começou a entrevista de briefing`);
      if (r.agentId) open('agente', r.agentId);
    } catch (e) { notify((e as Error).message); }
  };
  const resume = async (id: string) => {
    try {
      const w = await api<Worker>(`${base}/sessoes/${id}/retomar`, { body: {} });
      setSel(w.id);
      setView(null);
      setTab('conversa');
      notify('A conversa virou uma sessão aberta do cliente');
    } catch (x) { notify((x as Error).message); }
  };
  const archive = async (id: string, archived: boolean) => {
    try {
      await api(`${base}/sessoes/${id}/arquivar`, { body: { archived } });
      setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, archivedAt: archived ? new Date().toISOString() : null } : s)));
      if (archived && view === id) setView(null);
      notify(archived ? 'Sessão arquivada. Fica em "Arquivadas", no fim da lista.' : 'Sessão de volta à lista');
    } catch (x) { notify((x as Error).message); }
  };
  const createSession = async (e?: React.FormEvent) => {
    e?.preventDefault();
    try {
      const w = await api<Worker>(`${base}/conversa/nova`, { body: { title: newTitle.trim() || null, levarResumo: carry } });
      setSel(w.id);
      setView(null);
      setCreating(false);
      setNewTitle('');
      setCarry(false);
    } catch (x) { notify((x as Error).message); }
  };
  const renameSession = async (w: Worker) => {
    try { await api(`/api/offices/${office!.id}/workers/${w.id}`, { method: 'PATCH', body: { title: renameText.trim() || null } }); }
    catch (x) { notify((x as Error).message); }
    setRenaming(null);
  };
  const archiveSession = async (w: Worker) => {
    try {
      const r = await api<{ closing: boolean }>(`/api/offices/${office!.id}/workers/${w.id}/arquivar`, { body: {} });
      if (!r.closing && sel === w.id) setSel(null);
      notify(r.closing ? 'Antes de arquivar, a sessão grava a memória do cliente e o resumo. Ela sai da lista quando terminar.' : 'Sessão arquivada. A conversa continua no Histórico.');
    } catch (x) { notify((x as Error).message); }
  };
  const running = mine.some((d) => d.pipeline?.[0] === 'briefing' && d.status !== 'entregue');
  const hasBriefing = !!c.briefing?.feitoEm || BRIEFING_FIELDS.some((x) => c.briefing?.[x.key]);
  const openDemands = mine.filter((d) => d.status !== 'entregue');
  const openFolder = () => {
    // a pasta no Drive é a de verdade; o `folder` antigo pode estar relativo à raiz do escritório (CLIENTES\NOME),
    // e o app só abre caminho completo
    const trim = (p: string) => p.replace(/[\\/]+$/, '');
    const abs = (p: string) => (/^([a-z]:[\\/]|[\\/]{2})/i.test(p) ? p : `${trim(office!.rootPath)}\\${p.replace(/^[\\/]+/, '')}`);
    const drive = office?.driveRoot && c.driveFolder ? `${trim(office.driveRoot)}\\${c.driveFolder.replace(/\//g, '\\')}` : null;
    const local = c.folder ? abs(c.folder) : null;
    const target = drive ?? local;
    if (!target) { notify('Cliente sem pasta definida'); return; }
    if (!desktop) { notify(target); return; }
    desktop.openPath(target).then((err) => {
      if (!err) return;
      // Drive fora do ar ou pasta renomeada: tenta a pasta do cadastro antes de desistir
      if (local && local !== target) desktop!.openPath(local).then((e2) => { if (e2) notify(`Não consegui abrir ${target}`); });
      else notify(`Não consegui abrir ${target}`);
    });
  };
  const tabs: { id: Tab; label: string; count?: number; alert?: boolean }[] = [
    { id: 'conversa', label: 'Conversa' },
    { id: 'sessoes', label: 'Histórico' },
    { id: 'briefing', label: 'Briefing', alert: !hasBriefing },
    { id: 'demandas', label: 'Demandas', count: openDemands.length },
    { id: 'arquivos', label: 'Arquivos' },
  ];

  return (
    <section className="client-detail">
      <header className="client-head">
        <span className="dot big" style={{ background: c.color }} />
        <div className="client-title">
          <h2 className="truncate">{c.name}</h2>
          <div className="client-facts">
            {squad && <span title={squadRoles(squad)}><Users size={12} /> {[squad.socialMedia, squad.designProducao].filter(Boolean).join(' · ') || squad.nome}</span>}
            <select className={`status-pill st-${c.status}`} value={c.status} aria-label="Situação do cliente" onChange={(e) => patch({ status: e.target.value as Client['status'] })}>
              <option value="ativo">Ativo</option><option value="pausado">Pausado</option><option value="encerrado">Encerrado</option>
            </select>
            {jobRunning && <span className="working"><span className="status-dot" /> trabalhando agora</span>}
            {jobWaiting && <span className="working waiting"><span className="status-dot" /> esperando você</span>}
            {canSeeFinance(office?.role) && c.monthlyFee > 0 && <span className="muted">{brl(c.monthlyFee)}/mês</span>}
          </div>
        </div>
        <span className="spacer" />
        <button className="ghost small" onClick={openFolder} title={c.folder ?? 'Sem pasta'}><FolderOpen size={14} /> Abrir pasta</button>
        <div className="popover-anchor">
          <button className={`icon ${settings ? 'active' : ''}`} onClick={() => setSettings((v) => !v)} aria-label="Ajustes do cliente" aria-expanded={settings} title="Ajustes do cliente"><Settings2 size={16} /></button>
          {settings && (
            <div className="popover client-settings" role="dialog" aria-label="Ajustes do cliente">
              <div>
                <small className="muted">Quem aprova as peças</small>
                <div className="seg">
                  <button className={c.approvalMode !== 'ia' ? 'on' : ''} onClick={() => patch({ approvalMode: 'humano' })}>Uma pessoa</button>
                  <button className={c.approvalMode === 'ia' ? 'on' : ''} onClick={() => patch({ approvalMode: 'ia' })}><Bot size={12} /> Revisão da IA</button>
                </div>
              </div>
              <div>
                <small className="muted">Tipo</small>
                <div className="seg">
                  <button className={c.kind !== 'projeto' ? 'on' : ''} onClick={() => patch({ kind: 'cliente' })}>Cliente</button>
                  <button className={c.kind === 'projeto' ? 'on' : ''} title="Projeto da casa: o site, o perfil da agência, uma campanha interna" onClick={() => patch({ kind: 'projeto' })}>Projeto</button>
                </div>
              </div>
              <SquadPicker clientId={c.id} />
              <div>
                <small className="muted">Pasta do cliente</small>
                <code className="truncate" title={c.folder ?? ''}>{c.folder ?? 'sem pasta'}</code>
                <button className="ghost small" title="Cria só as pastas que faltam (REDES SOCIAIS e ARQUIVOS no padrão novo); nada é movido nem apagado"
                  onClick={async () => { const r = await api(`${base}/folder`, { body: {} }); notify(r.createdDirs.length ? `${r.createdDirs.length} pasta(s) criada(s)` : 'A estrutura já estava completa'); }}>
                  <FolderPlus size={14} /> Completar a estrutura padrão
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <nav className="client-tabs" role="tablist" aria-label={`Seções de ${c.name}`}>
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}{t.count ? <span className="count">{t.count}</span> : null}{t.alert && <span className="alert-dot" title="Ainda não feito" />}
          </button>
        ))}
      </nav>

      {tab === 'conversa' && (
        <div className="conversa-split">
          <aside className="session-col" aria-label={`Sessões de ${c.name}`}>
            {canWork(office!.role) && (creating ? (
              <form className="session-new" onSubmit={createSession}>
                <input autoFocus value={newTitle} maxLength={60} placeholder="Nome da sessão (a demanda)" aria-label="Nome da sessão"
                  onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(false)} />
                <label className="small muted"><input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} /> levar o resumo da última conversa</label>
                <div className="row gap"><button type="submit" className="small">Abrir</button><button type="button" className="ghost small" onClick={() => setCreating(false)}>Cancelar</button></div>
              </form>
            ) : (
              <button type="button" className="small session-add" onClick={() => setCreating(true)}><Plus size={13} /> Nova sessão</button>
            ))}
            <div className="session-rows" role="list">
              {openSessions.map((w) => {
                const label = w.state === 'aguardando' ? 'esperando você' : w.state === 'trabalhando' ? 'rodando' : 'parada';
                return (
                  <div key={w.id} role="listitem" className={`session-row st-${w.state} ${session?.id === w.id && !view ? 'on' : ''}`}>
                    {renaming === w.id ? (
                      <form className="session-rename" onSubmit={(e) => { e.preventDefault(); renameSession(w); }}>
                        <input autoFocus value={renameText} maxLength={60} aria-label="Novo nome da sessão" onChange={(e) => setRenameText(e.target.value)}
                          onBlur={() => renameSession(w)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} />
                      </form>
                    ) : (
                      <button type="button" className="session-pick" onClick={() => { setSel(w.id); setView(null); }}>
                        <span className="row gap"><span className="status-dot" /><b className="truncate">{w.title ?? w.name}</b></span>
                        <span className="muted small">{label}{w.lastJobAt ? ` · ${when(w.lastJobAt)}` : ''}</span>
                      </button>
                    )}
                    {canWork(office!.role) && renaming !== w.id && (
                      <span className="session-tools">
                        <button type="button" className="icon" title="Renomear" aria-label={`Renomear ${w.title ?? w.name}`} onClick={() => { setRenaming(w.id); setRenameText(w.title ?? ''); }}><Pencil size={12} /></button>
                        <button type="button" className="icon" disabled={w.state !== 'copa'} title={w.state !== 'copa' ? 'Termine ou encerre o trabalho antes de arquivar' : 'Arquivar: antes grava a memória do cliente e o resumo; sai da lista (nada é apagado)'} aria-label={`Arquivar ${w.title ?? w.name}`} onClick={() => archiveSession(w)}><ArchiveIcon size={12} /></button>
                      </span>
                    )}
                  </div>
                );
              })}
              {openSessions.length === 0 && <p className="muted small">Nenhuma sessão aberta. O primeiro pedido abre uma, ou use "Nova sessão".</p>}
            </div>
          </aside>
          <Conversa c={c} session={session} view={view} setView={setView} sessions={sessions} resume={resume}
            onSessions={() => setTab('sessoes')} onInterview={interview} onBriefing={() => setTab('briefing')} />
        </div>
      )}
      {tab === 'sessoes' && (
        <div className="card">
          <div className="card-head">
            <h4>Histórico de {c.name}</h4>
            <span className="muted small">Conversas do Office e do terminal nesta pasta. "Continuar" abre a conversa como uma sessão do cliente.</span>
          </div>
          {helpers.length > 0 && <div className="team-list" role="list">{helpers.map((w) => <TeamRow key={w.id} w={w} label="Ajudante" />)}</div>}
          <div className="section-label" style={{ padding: '6px 0 0' }}>Sessões desta pasta (Office e terminal)</div>
          <div className="session-list" role="list">
            {sessions.filter((s) => !s.archivedAt && !openSessions.some((w) => w.sessionId === s.id)).map((s) => (
              <div key={s.id} role="listitem" className={`session-item row ${view === s.id ? 'on' : ''}`}>
                <button type="button" className="session-open" onClick={() => { setView(s.id); setTab('conversa'); }}>
                  <span className="row gap">{s.origin === 'terminal' ? <Terminal size={12} /> : <History size={12} />}<b className="truncate">{s.title}</b></span>
                  <span className="muted small">{s.origin === 'terminal' ? 'terminal' : 'Office'} · {when(s.startedAt)} até {when(s.updatedAt)}{s.people.length ? ` · ${s.people.join(', ')}` : ''}</span>
                </button>
                <button type="button" className="ghost small" title="Abre esta conversa como uma sessão do cliente" onClick={() => resume(s.id)}>Continuar</button>
                {canWork(office!.role) && <button type="button" className="icon" title="Arquivar: sai da lista (nada é apagado)" aria-label={`Arquivar ${s.title}`} onClick={() => archive(s.id, true)}><ArchiveIcon size={13} /></button>}
              </div>
            ))}
            {sessions.length === 0 && <p className="muted small">Nenhuma sessão ainda nesta pasta.</p>}
            {sessions.some((s) => s.archivedAt) && (
              <button type="button" className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowArchived((v) => !v)}>
                <ArchiveIcon size={12} /> Arquivadas ({sessions.filter((s) => s.archivedAt).length}) {showArchived ? '▴' : '▾'}
              </button>
            )}
            {showArchived && sessions.filter((s) => s.archivedAt).map((s) => (
              <div key={s.id} role="listitem" className={`session-item row archived ${view === s.id ? 'on' : ''}`}>
                <button type="button" className="session-open" onClick={() => { setView(s.id); setTab('conversa'); }}>
                  <span className="row gap">{s.origin === 'terminal' ? <Terminal size={12} /> : <History size={12} />}<b className="truncate">{s.title}</b></span>
                  <span className="muted small">{s.origin === 'terminal' ? 'terminal' : 'Office'} · {when(s.startedAt)} até {when(s.updatedAt)} · arquivada {when(s.archivedAt!)}</span>
                </button>
                {canWork(office!.role) && <button type="button" className="ghost small" onClick={() => archive(s.id, false)}>Desarquivar</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'briefing' && <BriefingCard c={c} onInterview={interview} interviewing={running} save={(b) => patch({ briefing: b })} />}
      {tab === 'demandas' && (
        <div className="card">
          <div className="card-head"><h4>Demandas</h4><button className="ghost small" onClick={() => open('demandas', 'nova')}><Plus size={13} /> Nova</button></div>
          {mine.length === 0 && <p className="muted small">Nenhuma demanda. Depois do briefing, {rafa?.name ?? 'o gerente'} sugere as primeiras.</p>}
          {mine.map((d) => (
            <button key={d.id} className="client-demand" onClick={() => open('demandas', d.id)}>
              <span className="truncate">{d.title}</span>
              <StageTrack d={d} compact />
            </button>
          ))}
        </div>
      )}
      {tab === 'arquivos' && <ClientDrive c={c} />}
    </section>
  );
}

function BriefingCard({ c, onInterview, interviewing, save }: { c: Client; onInterview: () => void; interviewing: boolean; save: (b: Briefing) => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<Briefing>(c.briefing ?? {});
  const has = !!c.briefing?.feitoEm || BRIEFING_FIELDS.some((x) => c.briefing?.[x.key]);
  return (
    <div className="card briefing">
      <div className="card-head">
        <h4>Briefing</h4>
        <div className="row gap">
          {!edit && <button className="ghost small" onClick={() => { setF(c.briefing ?? {}); setEdit(true); }}>Editar</button>}
          <button className="ghost small" onClick={onInterview} disabled={interviewing} title="O gerente de IA faz as perguntas pelo chat e grava o BRIEFING.md na pasta">
            <Sparkles size={13} /> {interviewing ? 'Entrevista em andamento' : has ? 'Refazer entrevista' : 'Fazer entrevista'}
          </button>
        </div>
      </div>
      {edit ? (
        <form className="col gap" onSubmit={(e) => { e.preventDefault(); save({ ...f, feitoEm: c.briefing?.feitoEm ?? new Date().toISOString() }); setEdit(false); }}>
          {BRIEFING_FIELDS.map((x) => (
            <label key={x.key}>{x.label}<textarea rows={2} value={f[x.key] ?? ''} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} /></label>
          ))}
          <div className="row gap end"><button type="button" className="ghost" onClick={() => setEdit(false)}>Cancelar</button><button className="primary">Salvar</button></div>
        </form>
      ) : has ? (
        <dl className="briefing-list">
          {BRIEFING_FIELDS.filter((x) => c.briefing?.[x.key]).map((x) => (
            <div key={x.key}><dt>{x.label}</dt><dd>{c.briefing[x.key]}</dd></div>
          ))}
        </dl>
      ) : (
        <p className="muted small">Sem briefing ainda. A entrevista é pelo chat: o gerente lê a pasta, pergunta o que falta e grava o BRIEFING.md.</p>
      )}
    </div>
  );
}

interface FoundClient { dir: string; name: string; standard: boolean; marca: boolean; idv: boolean }

/** Importar: cada pasta de CLIENTES que ainda não é cliente vira uma linha. A pasta não muda. */
function ImportClients({ onClose }: { onClose: () => void }) {
  const { office, agents, notify } = useStore();
  const rafa = agents.find((a) => a.slug === 'gerente')?.name ?? 'O gerente';
  const base = `/api/offices/${office!.id}/clients/importar`;
  const [root, setRoot] = useState('');
  const [rows, setRows] = useState<(FoundClient & { on: boolean })[] | null>(null);
  const [draft, setDraft] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ root: string; found: FoundClient[] }>(base)
      .then((r) => { setRoot(r.root); setRows(r.found.map((f) => ({ ...f, on: f.standard }))); })
      .catch((e) => setErr((e as Error).message));
  }, [base]);
  const set = (dir: string, change: Partial<FoundClient & { on: boolean }>) => setRows((rs) => rs!.map((x) => (x.dir === dir ? { ...x, ...change } : x)));
  const chosen = rows?.filter((x) => x.on) ?? [];
  const valid = chosen.length > 0 && chosen.every((x) => x.name.trim());
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api<{ created: Client[]; errors: string[] }>(base, { body: { items: chosen.map((x) => ({ dir: x.dir, name: x.name.trim() })), rascunho: draft } });
          notify(r.errors[0] ?? `${r.created.length} cliente(s) importado(s)${draft ? `. ${rafa} vai ler as pastas na fila` : ''}`);
          onClose();
        } catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        <header className="modal-head"><h3>Importar clientes da pasta</h3><button type="button" className="icon" onClick={onClose}><X size={16} /></button></header>
        <div className="modal-body">
          {rows === null && !err && <p className="muted small">Lendo as pastas...</p>}
          {rows?.length === 0 && <p className="muted small">Nenhuma pasta nova em <code>{root}</code>.</p>}
          {rows && rows.length > 0 && (
            <>
              <span className="muted small">Pastas em <code>{root}</code> que ainda não são clientes. Nada é criado, movido nem renomeado nelas. A mensalidade fica zerada até você preencher.</span>
              <div className="import-list">
                {rows.map((x) => (
                  <div key={x.dir} className="import-row">
                    <input type="checkbox" aria-label={`Importar ${x.dir}`} checked={x.on} onChange={(e) => set(x.dir, { on: e.target.checked })} />
                    <input type="text" aria-label={`Nome do cliente da pasta ${x.dir}`} value={x.name} disabled={!x.on} onChange={(e) => set(x.dir, { name: e.target.value })} />
                    <span className="muted small truncate" title={x.dir}>{x.dir}</span>
                    <span className="import-tags">
                      {x.marca && <span className="badge">marca</span>}
                      {x.idv && <span className="badge">IDV</span>}
                      {!x.standard && <span className="badge outline">fora do padrão</span>}
                    </span>
                  </div>
                ))}
              </div>
              <label className="check"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> {rafa} lê cada pasta e preenche um rascunho do briefing para você conferir. Consome uso do Claude por cliente, em fila.</label>
            </>
          )}
          {err && <div className="error">{err}</div>}
        </div>
        <footer className="modal-foot"><span /><div className="row gap"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !valid}>Importar {chosen.length || ''}</button></div></footer>
      </form>
    </div>
  );
}

function NewClient({ onClose }: { onClose: (id?: string) => void }) {
  const { office, agents, open, notify } = useStore();
  const rafa = agents.find((a) => a.slug === 'gerente');
  const [f, setF] = useState({ name: '', monthlyFee: '', folderMode: 'nova' as 'nova' | 'existente', folder: '', approvalMode: 'humano' as Client['approvalMode'], interview: true });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = f.name ? `CLIENTES\\${f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[<>:"/\\|?*]+/g, ' ').trim().toUpperCase()}` : 'CLIENTES\\<NOME>';
  return (
    <div className="modal-bg" onClick={() => onClose()}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api(`/api/offices/${office!.id}/clients`, { body: {
            name: f.name.trim(), monthlyFee: parseMoney(f.monthlyFee), approvalMode: f.approvalMode,
            folder: f.folderMode === 'existente' ? f.folder || null : null, createFolder: true, interview: f.interview,
          } });
          if (r.briefing?.error) notify(r.briefing.error);
          else if (r.briefing?.agentId) { notify(`${rafa?.name ?? 'O gerente'} começou a entrevista de briefing`); open('agente', r.briefing.agentId); }
          else notify(`${r.client.name} cadastrado`);
          onClose(r.client.id);
        } catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        <header className="modal-head"><h3>Novo cliente</h3><button type="button" className="icon" onClick={() => onClose()}><X size={16} /></button></header>
        <div className="modal-body">
          <div className="grid2">
            <label>Nome<input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            {canSeeFinance(useStore.getState().office?.role) && <label>Mensalidade (R$)<input inputMode="decimal" placeholder="0,00" value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value })} /></label>}
          </div>
          <div className="col gap-s">
            <small className="muted">Pasta</small>
            <label className="check"><input type="radio" checked={f.folderMode === 'nova'} onChange={() => setF({ ...f, folderMode: 'nova' })} /> Criar <code>{preview}</code> no padrão da casa</label>
            <label className="check"><input type="radio" checked={f.folderMode === 'existente'} onChange={() => setF({ ...f, folderMode: 'existente' })} /> Usar uma pasta que já existe</label>
            {f.folderMode === 'existente' && <PathField value={f.folder} onChange={(v) => setF({ ...f, folder: v })} scope="office" officeId={office!.id} placeholder="Pasta do cliente" title="Pasta do cliente" />}
            <span className="muted small">O Office só cria as pastas que faltam (REDES SOCIAIS, que o cliente vê, e ARQUIVOS, só da equipe). Nada é movido nem apagado.</span>
          </div>
          <div className="col gap-s">
            <small className="muted">Quem aprova as peças</small>
            <div className="seg">
              <button type="button" className={f.approvalMode === 'humano' ? 'on' : ''} onClick={() => setF({ ...f, approvalMode: 'humano' })}>Uma pessoa</button>
              <button type="button" className={f.approvalMode === 'ia' ? 'on' : ''} onClick={() => setF({ ...f, approvalMode: 'ia' })}><Bot size={12} /> Revisão da IA</button>
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={f.interview} onChange={(e) => setF({ ...f, interview: e.target.checked })} /> Começar a entrevista de briefing com {rafa?.name ?? 'o gerente'} agora</label>
          {err && <div className="error">{err}</div>}
        </div>
        <footer className="modal-foot"><span /><div className="row gap"><button type="button" className="ghost" onClick={() => onClose()}>Cancelar</button><button className="primary" disabled={busy}>Cadastrar</button></div></footer>
      </form>
    </div>
  );
}

const STATE_LABEL = { trabalhando: 'trabalhando', aguardando: 'precisa de você', copa: 'na copa' } as const;

/** Um funcionário de IA da equipe do cliente: nome, selo IA, papel e onde está. */
/** Squad do cliente: muda direto no squads.json, que as skills e o Office leem. */
function SquadPicker({ clientId }: { clientId: string }) {
  const { office, notify } = useStore();
  const [data, setData] = useState<{ squads: { id: string; nome: string }[]; byClient: Record<string, string | null> } | null>(null);
  const load = () => api(`/api/offices/${office!.id}/squads`).then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data?.squads.length) return null;
  const cur = data.byClient[clientId] ?? '';
  return (
    <div>
      <small className="muted">Squad</small>
      <select value={cur} disabled={!canWork(office!.role)} onChange={async (e) => {
        try {
          await api(`/api/offices/${office!.id}/clients/${clientId}/squad`, { method: 'PUT', body: { squad: e.target.value || null } });
          notify(e.target.value ? `Agora no squad ${data.squads.find((s) => s.id === e.target.value)?.nome}` : 'Sem squad');
          load();
        } catch (x) { notify((x as Error).message); }
      }}>
        <option value="">Sem squad</option>
        {data.squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
      </select>
    </div>
  );
}

function TeamRow({ w, label, onOpen }: { w: Worker; label: string; onOpen?: () => void }) {
  const { office, notify } = useStore();
  const [editing, setEditing] = useState(false);
  const st = w.archivedAt ? 'arquivado' : w.state === 'copa' ? 'livre' : w.state;
  const save = async (v: string) => {
    setEditing(false);
    const name = v.trim();
    if (name.length < 2 || name === w.name) return;
    try { await api(`/api/offices/${office!.id}/workers/${w.id}`, { method: 'PATCH', body: { name } }); notify(`Agora é ${name}`); }
    catch (x) { notify((x as Error).message); }
  };
  return (
    <div role="listitem" className={`team-row agent-row st-${st} ${w.archivedAt ? 'archived' : ''}`}>
      <span className="avatar" style={{ background: w.color }}>{w.name[0]}<span className="status-dot" /></span>
      <div className="truncate">
        {editing
          ? <input autoFocus defaultValue={w.name} maxLength={30} aria-label="Nome do funcionário" style={{ height: 26 }}
              onBlur={(e) => save(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }} />
          : <><b>{w.name}</b> <span className="who-badge">IA</span></>}
        <small className="muted truncate">{label}{w.archivedAt ? '' : ` · ${STATE_LABEL[w.state]}`}</small>
      </div>
      {!w.archivedAt && canWork(office!.role) && !editing && <button className="icon" title="Mudar o nome" aria-label={`Mudar o nome de ${w.name}`} onClick={() => setEditing(true)}><Pencil size={13} /></button>}
      {onOpen && <button className="ghost small" onClick={onOpen}>Conversar</button>}
    </div>
  );
}
