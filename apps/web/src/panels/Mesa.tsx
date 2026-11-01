import { useState } from 'react';
import { FileText, Film, Workflow } from 'lucide-react';
import { STAGE_LABEL, processById, type Demand } from '@office/shared';
import { useStore } from '../lib/store';
import { mediaUrl } from '../lib/api';
import { ReviewDesk, versionsOf } from './ReviewDesk';

/**
 * Mesa de trabalho: o que os funcionários terminaram ou querem decidir com você, peça por peça, sem precisar procurar
 * nas pastas. Cada peça abre na mesa do diretor de arte, com os caminhos reais de cada arquivo.
 */

const IMG = /\.(png|jpe?g|webp|gif)$/i;
const VID = /\.(mp4|mov|webm)$/i;
const MAX_DONE = 12;

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
        <div className="empty"><Workflow size={22} /><p>Nada na mesa ainda. Comece uma demanda com um processo em Demandas, e as peças aparecem aqui.</p></div>
      )}
      {section('Esperando você', asking)}
      {section('Em produção', working)}
      {section('Paradas', stopped)}
      {section('Aprovadas', done)}
      {current && <ReviewDesk d={current} onClose={() => setOpenId(null)} />}
    </div>
  );
}
