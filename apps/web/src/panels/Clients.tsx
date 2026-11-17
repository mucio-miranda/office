import { canSeeFinance } from '@office/shared';
import { useEffect, useState } from 'react';
import { Bot, FileText, Film, FolderInput, FolderOpen, FolderPlus, History, Image, MessageSquarePlus, Music, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Settings2, Sparkles, Terminal, Users, X } from 'lucide-react';
import { BRIEFING_FIELDS, type Briefing, type Client, type ClientSession } from '@office/shared';
import { useStore } from '../lib/store';
import { api, brl } from '../lib/api';
import { PathField } from '../lib/PathPicker';
import { StageTrack } from './Demands';
import { Conversa, when } from './Conversa';
import { desktop } from '../lib/desktop';
import { usePersisted } from '../lib/persisted';

interface IndexedFile { rel: string; size: number; mtime: string; kind: 'imagem' | 'video' | 'audio' | 'doc' | 'design' | 'outro' }
interface FileGroup { key: string; label: string; count: number; size: number; files: IndexedFile[] }
interface ClientIndex { root: string | null; exists: boolean; total: number; truncated: boolean; groups: FileGroup[] }

const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const WEB_IMG = /\.(jpe?g|png|webp|gif)$/i;

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
  const allGroups = sq.squads.length
    ? [...sq.squads.map((s) => ({ key: s.id, squad: s as Squad | null, items: clients.filter((c) => sq.byClient[c.id] === s.id) })),
      { key: '-', squad: null, items: clients.filter((c) => !sq.byClient[c.id]) }].filter((g) => g.items.length)
    : [{ key: '-', squad: null, items: clients }];
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
  const { office, demands, agents, jobs, open, notify } = useStore();
  const base = `/api/offices/${office!.id}/clients/${c.id}`;
  const patch = (body: Partial<Client>) => api(base, { method: 'PATCH', body });
  const mine = demands.filter((d) => d.clientId === c.id);
  const rafa = agents.find((a) => a.slug === 'gerente');
  const [tab, setTab] = useState<Tab>('conversa');
  const [settings, setSettings] = useState(false);
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  // null = a sessão atual; um id = uma sessão anterior, só para ler até alguém continuar nela
  const [view, setView] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const clientJobs = jobs.filter((j) => j.clientId === c.id);
  const busy = clientJobs.some((j) => j.status === 'rodando' || j.status === 'fila' || j.status === 'aguardando');
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
      await api(`${base}/sessoes/${id}/retomar`, { body: {} });
      setView(null);
      setTab('conversa');
      notify('A próxima mensagem continua essa sessão');
    } catch (x) { notify((x as Error).message); }
  };
  const reset = async () => {
    try {
      await api(`${base}/conversa/nova`, { body: {} });
      setView(null);
      setTab('conversa');
      notify('O próximo pedido começa uma conversa nova');
    } catch (x) { notify((x as Error).message); }
    setConfirmReset(false);
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
    { id: 'sessoes', label: 'Sessões', count: sessions.length },
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
            {busy && <span className="working"><span className="status-dot" /> trabalhando agora</span>}
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
                  <button className={c.approvalMode === 'ia' ? 'on' : ''} onClick={() => patch({ approvalMode: 'ia' })}><Bot size={12} /> {rafa?.name ?? 'Gerente'} (IA)</button>
                </div>
              </div>
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
        <Conversa c={c} view={view} setView={setView} sessions={sessions} resume={resume}
          onSessions={() => setTab('sessoes')} onInterview={interview} onBriefing={() => setTab('briefing')} />
      )}
      {tab === 'sessoes' && (
        <div className="card">
          <div className="card-head">
            <h4>Sessões de {c.name}</h4>
            {confirmReset ? (
              <div className="row gap">
                <span className="muted small">O funcionário deixa de lembrar a conversa atual.</span>
                <button className="ghost small" onClick={() => setConfirmReset(false)}>Manter</button>
                <button className="small" onClick={reset}>Começar nova</button>
              </div>
            ) : (
              <button className="ghost small" disabled={!c.sessionId || busy} onClick={() => setConfirmReset(true)}><MessageSquarePlus size={13} /> Começar conversa nova</button>
            )}
          </div>
          <div className="session-list" role="list">
            <button type="button" role="listitem" className={`session-item ${view === null ? 'on' : ''}`} onClick={() => { setView(null); setTab('conversa'); }}>
              <b>Sessão atual</b><span className="muted small">{c.sessionId ? 'o funcionário lembra desta conversa' : 'o próximo pedido começa uma sessão nova'}</span>
            </button>
            {sessions.filter((s) => !s.current).map((s) => (
              <div key={s.id} role="listitem" className={`session-item row ${view === s.id ? 'on' : ''}`}>
                <button type="button" className="session-open" onClick={() => { setView(s.id); setTab('conversa'); }}>
                  <span className="row gap">{s.origin === 'terminal' ? <Terminal size={12} /> : <History size={12} />}<b className="truncate">{s.title}</b></span>
                  <span className="muted small">{s.origin === 'terminal' ? 'terminal' : 'Office'} · {when(s.startedAt)} até {when(s.updatedAt)}{s.costUsd > 0 ? ` · US$ ${s.costUsd.toFixed(2)}` : ''}{s.people.length ? ` · ${s.people.join(', ')}` : ''}</span>
                </button>
                <button type="button" className="ghost small" disabled={busy} title={busy ? 'Espere o trabalho atual terminar' : 'A próxima mensagem continua nesta sessão'} onClick={() => resume(s.id)}>Continuar</button>
              </div>
            ))}
            {sessions.length === 0 && <p className="muted small">Nenhuma sessão ainda nesta pasta.</p>}
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
      {tab === 'arquivos' && <FilesCard c={c} base={base} />}
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

function FileIcon({ kind }: { kind: IndexedFile['kind'] }) {
  if (kind === 'video') return <Film size={14} />;
  if (kind === 'audio') return <Music size={14} />;
  if (kind === 'imagem' || kind === 'design') return <Image size={14} />;
  return <FileText size={14} />;
}

function FilesCard({ c, base }: { c: Client; base: string }) {
  const [idx, setIdx] = useState<ClientIndex | null>(null);
  const [err, setErr] = useState('');
  const load = () => api<ClientIndex>(`${base}/files`).then((r) => { setIdx(r); setErr(''); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, [c.folder]); // eslint-disable-line react-hooks/exhaustive-deps
  // <img> não manda o cabeçalho de login: a miniatura usa o cookie de sessão
  const thumb = (rel: string) => `${base}/file?rel=${encodeURIComponent(rel)}`;
  return (
    <div className="card files">
      <div className="card-head">
        <h4>Arquivos {idx?.total ? <span className="muted small">· {idx.total}{idx.truncated ? '+' : ''}</span> : null}</h4>
        <button className="icon" onClick={load} title="Atualizar o índice"><RefreshCw size={14} /></button>
      </div>
      {err && <div className="error">{err}</div>}
      {idx && !idx.root && <p className="muted small">Sem pasta definida. Use "Estrutura padrão" para criar uma.</p>}
      {idx?.root && !idx.exists && <p className="muted small">A pasta {idx.root} não existe.</p>}
      {idx?.exists && idx.total === 0 && <p className="muted small">A pasta está vazia. Coloque os brutos em ARQUIVOS – CLIENTE\BRUTOS\&lt;captação&gt; e o kit da marca em REDES SOCIAIS\IDENTIDADE VISUAL.</p>}
      {idx?.groups.map((g) => {
        const imgs = g.files.filter((f) => WEB_IMG.test(f.rel)).slice(0, 8);
        const others = g.files.filter((f) => !WEB_IMG.test(f.rel)).slice(0, imgs.length ? 3 : 6);
        return (
          <div key={g.key} className="file-group">
            <div className="row between"><b>{g.label}</b><span className="muted small">{g.count} · {mb(g.size)}</span></div>
            {imgs.length > 0 && (
              <div className="thumbs">{imgs.map((f) => <img key={f.rel} src={thumb(f.rel)} alt={f.rel} title={f.rel} loading="lazy" />)}</div>
            )}
            {others.map((f) => <div key={f.rel} className="file-row truncate" title={f.rel}><FileIcon kind={f.kind} /> {f.rel}</div>)}
          </div>
        );
      })}
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
            name: f.name.trim(), monthlyFee: Number(f.monthlyFee || 0), approvalMode: f.approvalMode,
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
            {canSeeFinance(useStore.getState().office?.role) && <label>Mensalidade (R$)<input type="number" min={0} value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value })} /></label>}
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
              <button type="button" className={f.approvalMode === 'ia' ? 'on' : ''} onClick={() => setF({ ...f, approvalMode: 'ia' })}><Bot size={12} /> {rafa?.name ?? 'Gerente'} (IA)</button>
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
