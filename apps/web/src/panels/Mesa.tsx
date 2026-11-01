import { useEffect, useState } from 'react';
import { Check, FileText, Film, Workflow, X } from 'lucide-react';
import { STAGE_LABEL, processById, type Demand, type Learning } from '@office/shared';
import { useStore } from '../lib/store';
import { api, mediaUrl } from '../lib/api';
import { ReviewDesk, versionsOf } from './ReviewDesk';

/**
 * Mesa de trabalho: o que os funcionários terminaram ou querem decidir com você, peça por peça, sem precisar procurar
 * nas pastas. Cada peça abre na mesa do diretor de arte, com os caminhos reais de cada arquivo.
 */

const IMG = /\.(png|jpe?g|webp|gif)$/i;
const VID = /\.(mp4|mov|webm)$/i;
const MAX_DONE = 12;

function Learnings() {
  const { office, clients, jobs, notify } = useStore();
  const [items, setItems] = useState<Learning[]>([]);
  const base = `/api/offices/${office!.id}/aprendizados`;
  const load = () => api<Learning[]>(base).then(setItems).catch(() => setItems([]));
  // uma tarefa que termina pode ter trazido novos
  const finished = jobs.filter((j) => j.status === 'concluido' || j.status === 'aguardando').length;
  useEffect(() => { load(); }, [base, finished]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = async (id: string, approve: boolean) => {
    try { await api(`${base}/${id}`, { body: { approve } }); await load(); } catch (e) { notify((e as Error).message); }
  };
  if (!items.length) return null;
  return (
    <section>
      <div className="section-label" style={{ padding: 0, marginBottom: 8 }}>Aprendizados para aprovar · {items.length}</div>
      <p className="muted small" style={{ marginTop: 0 }}>Aprovado, entra em INSIGHTS-PRODUCAO.md, a caixa de entrada das skills.</p>
      <div className="learnings">
        {items.map((l) => (
          <div key={l.id} className="learning">
            <span className="grow">{l.text}<small className="muted"> · {clients.find((c) => c.id === l.clientId)?.name ?? 'sem cliente'}</small></span>
            <button className="ghost small" onClick={() => decide(l.id, false)}><X size={13} /> Descartar</button>
            <button className="small" onClick={() => decide(l.id, true)}><Check size={13} /> Aprovar</button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Mesa() {
  const { demands, jobs, clients, agents, office } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const activeJob = (d: Demand) => jobs.find((j) => j.demandId === d.id && ['fila', 'rodando', 'aguardando'].includes(j.status));
  const started = demands.filter((d) => d.stage && (!filter || d.clientId === filter));

  const asking = started.filter((d) => activeJob(d)?.status === 'aguardando' || (d.stage === 'aprovacao' && d.status === 'aprovacao' && !activeJob(d)));
  const working = started.filter((d) => ['fila', 'rodando'].includes(activeJob(d)?.status ?? ''));
  const stopped = started.filter((d) => !activeJob(d) && d.stage !== 'aprovacao' && d.stage !== 'agendado');
  const done = started.filter((d) => d.stage === 'agendado').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_DONE);

  const status = (d: Demand) => {
    const j = activeJob(d);
    const name = j ? agents.find((a) => a.id === j.agentId)?.name ?? 'O funcionário' : '';
    if (j?.status === 'aguardando') return `${name} pede uma decisão`;
    if (j?.status === 'rodando') return `${name} está trabalhando`;
    if (j?.status === 'fila') return `${name} está na fila`;
    if (d.stage === 'aprovacao') return 'Esperando sua aprovação';
    if (d.stage === 'agendado') return d.publish?.status === 'publicado' ? 'Publicada' : 'Aprovada';
    return 'Parada';
  };

  const card = (d: Demand) => {
    const client = clients.find((c) => c.id === d.clientId);
    const files = versionsOf(d).at(-1)?.files ?? [];
    const thumb = files.find((f) => IMG.test(f));
    const video = files.some((f) => VID.test(f));
    return (
      <button key={d.id} type="button" className="mesa-card" onClick={() => setOpenId(d.id)}>
        <span className="mesa-thumb">
          {thumb ? <img src={mediaUrl(office!.id, thumb)} alt="" loading="lazy" /> : video ? <Film size={26} /> : <FileText size={26} />}
        </span>
        <span className="mesa-info">
          <b className="truncate">{d.title}</b>
          <span className="muted small truncate">{client?.name ?? 'Sem cliente'} · {processById(d.process)?.label ?? (d.stage ? STAGE_LABEL[d.stage] : '')}</span>
          <span className="small">{status(d)}</span>
          {files.length > 0 && <span className="muted small">{files.length} {files.length === 1 ? 'arquivo' : 'arquivos'}</span>}
        </span>
      </button>
    );
  };
  const section = (title: string, list: Demand[]) => list.length > 0 && (
    <section>
      <div className="section-label" style={{ padding: 0, marginBottom: 8 }}>{title} · {list.length}</div>
      <div className="mesa-grid">{list.map(card)}</div>
    </section>
  );
  const current = openId ? demands.find((d) => d.id === openId) : null;

  return (
    <div className="stack">
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {!asking.length && !working.length && !stopped.length && !done.length && (
        <div className="empty"><Workflow size={22} /><p>Nada na mesa ainda. Peça algo na conversa do cliente, em Clientes, e as peças aparecem aqui.</p></div>
      )}
      <Learnings />
      {section('Esperando você', asking)}
      {section('Em produção', working)}
      {section('Paradas', stopped)}
      {section('Aprovadas', done)}
      {current && <ReviewDesk d={current} onClose={() => setOpenId(null)} />}
    </div>
  );
}
