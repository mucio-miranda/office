import { useEffect, useState } from 'react';
import { Bot, FileText, Film, FolderPlus, Image, Music, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { BRIEFING_FIELDS, type Briefing, type Client } from '@office/shared';
import { useStore } from '../lib/store';
import { api, brl } from '../lib/api';
import { PathField } from '../lib/PathPicker';
import { StageTrack } from './Demands';

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
  const { clients, panelArg } = useStore();
  const [sel, setSel] = useState<string | null>(panelArg ?? null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (panelArg) setSel(panelArg); }, [panelArg]);
  const current = clients.find((c) => c.id === sel) ?? clients[0];

  return (
    <div className="clients-page">
      <aside className="clients-list">
        <button className="primary" onClick={() => setCreating(true)}><Plus size={14} /> Novo cliente</button>
        {clients.map((c) => (
          <button key={c.id} className={`client-item ${current?.id === c.id ? 'active' : ''}`} onClick={() => setSel(c.id)}>
            <span className="dot" style={{ background: c.color }} />
            <span className="truncate">{c.name}</span>
            <span className={`badge ${c.briefing?.feitoEm ? '' : 'outline'}`}>{c.briefing?.feitoEm ? 'briefing ok' : 'sem briefing'}</span>
          </button>
        ))}
        {clients.length === 0 && <p className="muted small">Nenhum cliente ainda.</p>}
      </aside>
      {current ? <ClientDetail key={current.id} c={current} /> : (
        <div className="empty">
          <p>Cadastre o primeiro cliente: o Office cria a pasta no padrão da casa e a Rafa faz a entrevista de briefing.</p>
          <button className="primary" onClick={() => setCreating(true)}><Plus size={14} /> Novo cliente</button>
        </div>
      )}
      {creating && <NewClient onClose={(id) => { setCreating(false); if (id) setSel(id); }} />}
    </div>
  );
}

function ClientDetail({ c }: { c: Client }) {
  const { office, demands, agents, open, notify } = useStore();
  const base = `/api/offices/${office!.id}/clients/${c.id}`;
  const patch = (body: Partial<Client>) => api(base, { method: 'PATCH', body });
  const mine = demands.filter((d) => d.clientId === c.id);
  const rafa = agents.find((a) => a.slug === 'gerente');
  const interview = async () => {
    try {
      const r = await api(`${base}/briefing`, { body: {} });
      notify(`${rafa?.name ?? 'O gerente'} começou a entrevista de briefing`);
      if (r.agentId) open('agente', r.agentId);
    } catch (e) { notify((e as Error).message); }
  };
  const running = mine.some((d) => d.pipeline?.[0] === 'briefing' && d.status !== 'entregue');

  return (
    <section className="client-detail">
      <header className="client-head">
        <span className="dot big" style={{ background: c.color }} />
        <h2>{c.name}</h2>
        <select value={c.status} onChange={(e) => patch({ status: e.target.value as Client['status'] })}>
          <option value="ativo">ativo</option><option value="pausado">pausado</option><option value="encerrado">encerrado</option>
        </select>
        <span className="muted small">{brl(c.monthlyFee)}/mês</span>
      </header>

      <div className="client-settings">
        <div>
          <small className="muted">Aprovação das peças</small>
          <div className="seg">
            <button className={c.approvalMode !== 'ia' ? 'on' : ''} onClick={() => patch({ approvalMode: 'humano' })}>Uma pessoa</button>
            <button className={c.approvalMode === 'ia' ? 'on' : ''} onClick={() => patch({ approvalMode: 'ia' })}><Bot size={12} /> {rafa?.name ?? 'Gerente'} (IA)</button>
          </div>
        </div>
        <div className="grow">
          <small className="muted">Pasta do cliente</small>
          <div className="row gap">
            <code className="truncate">{c.folder ?? 'sem pasta'}</code>
            <button className="ghost small" title="Cria só as pastas que faltam (DOCUMENTOS, FOTOS, VIDEOS…); nada é movido nem apagado"
              onClick={async () => { const r = await api(`${base}/folder`, { body: {} }); notify(r.createdDirs.length ? `${r.createdDirs.length} pasta(s) criada(s)` : 'A estrutura já estava completa'); }}>
              <FolderPlus size={14} /> Estrutura padrão
            </button>
          </div>
        </div>
      </div>

      <div className="client-grid">
        <BriefingCard c={c} onInterview={interview} interviewing={running} save={(b) => patch({ briefing: b })} />
        <div className="card">
          <div className="card-head"><h4>Demandas</h4><button className="ghost small" onClick={() => open('demandas', 'nova')}><Plus size={13} /> Nova</button></div>
          {mine.length === 0 && <p className="muted small">Nenhuma demanda. Depois do briefing, a Rafa sugere as primeiras.</p>}
          {mine.map((d) => (
            <button key={d.id} className="client-demand" onClick={() => open('demandas', d.id)}>
              <span className="truncate">{d.title}</span>
              <StageTrack d={d} compact />
            </button>
          ))}
        </div>
        <FilesCard c={c} base={base} />
      </div>
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
      {idx?.exists && idx.total === 0 && <p className="muted small">A pasta está vazia. Coloque o ensaio em FOTOS\BRUTAS, os logos em DOCUMENTOS\LOGOS e os vídeos em VIDEOS\BRUTOS.</p>}
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
            <label>Mensalidade (R$)<input type="number" min={0} value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value })} /></label>
          </div>
          <div className="col gap-s">
            <small className="muted">Pasta</small>
            <label className="check"><input type="radio" checked={f.folderMode === 'nova'} onChange={() => setF({ ...f, folderMode: 'nova' })} /> Criar <code>{preview}</code> no padrão da casa</label>
            <label className="check"><input type="radio" checked={f.folderMode === 'existente'} onChange={() => setF({ ...f, folderMode: 'existente' })} /> Usar uma pasta que já existe</label>
            {f.folderMode === 'existente' && <PathField value={f.folder} onChange={(v) => setF({ ...f, folder: v })} scope="office" officeId={office!.id} placeholder="Pasta do cliente" title="Pasta do cliente" />}
            <span className="muted small">O Office só cria as pastas que faltam (DOCUMENTOS, FOTOS, VIDEOS…). Nada é movido nem apagado.</span>
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
