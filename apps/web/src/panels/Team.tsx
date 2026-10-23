import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { PathField, PathList } from '../lib/PathPicker';

export function Team() {
  const { office, members, presences, agents, user, notify, enterOffice } = useStore();
  const online = new Set([user!.id, ...Object.keys(presences)]);
  const lan = `${location.protocol}//${location.hostname}:${location.port}`;
  const [root, setRoot] = useState(office!.rootPath);
  const [extra, setExtra] = useState<string[]>(office!.extraDirs);
  const dirty = root !== office!.rootPath || JSON.stringify(extra) !== JSON.stringify(office!.extraDirs);

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <section className="card stack">
        <div>
          <h3>Convide a equipe</h3>
          <p className="muted" style={{ margin: '4px 0 0' }}>Quem estiver na mesma rede abre <code>{lan}</code>, entra com o nome e usa o código:</p>
        </div>
        <div className="row gap">
          <div className="invite-code">{office?.inviteCode}</div>
          <button className="icon" title="Copiar" onClick={() => { navigator.clipboard?.writeText(office!.inviteCode); notify('Código copiado'); }}><Copy size={15} /></button>
        </div>
      </section>

      <section className="card stack">
        <h3>Pastas do escritório</h3>
        <label>Pasta raiz <span className="muted">(onde os funcionários de IA trabalham)</span><PathField value={root} onChange={setRoot} title="Pasta raiz do escritório" /></label>
        <label>Pastas extras liberadas<PathList values={extra} onChange={setExtra} /></label>
        <div className="row end">
          <button className="primary" disabled={!dirty} onClick={async () => {
            await api(`/api/offices/${office!.id}`, { method: 'PATCH', body: { rootPath: root, extraDirs: extra } });
            await enterOffice(office!.id);
            notify('Pastas atualizadas');
          }}>Salvar pastas</button>
        </div>
      </section>

      <section>
        <div className="section-label" style={{ padding: 0, marginBottom: 4 }}>Pessoas</div>
        {members.map((m) => (
          <div key={m.id} className="member">
            <span className="avatar" style={{ background: m.color }}>{m.name[0]}</span>
            <b>{m.name}</b>
            <span className="badge">{m.role}</span>
            <span className={`row gap small ${online.has(m.id) ? 'st-concluido' : 'st-livre'}`}><span className="status-dot" />{online.has(m.id) ? 'online' : 'offline'}</span>
          </div>
        ))}
      </section>

      <section>
        <div className="section-label" style={{ padding: 0, marginBottom: 4 }}>Funcionários de IA</div>
        {agents.map((a) => (
          <div key={a.id} className="member">
            <span className="avatar" style={{ background: a.color }}>{a.name[0]}</span>
            <b>{a.name}</b>
            <span className="muted small">{a.role}</span>
            <span className={`row gap small st-${a.status}`}><span className="status-dot" />{a.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

export function Activity() {
  const office = useStore((s) => s.office);
  const jobs = useStore((s) => s.jobs);
  const demands = useStore((s) => s.demands);
  const { members, agents } = useStore();
  const [items, setItems] = useState<{ id: number; actor: string; action: string; detail: string; at: string }[]>([]);
  useEffect(() => { api(`/api/offices/${office!.id}/activity`).then(setItems); }, [office, jobs, demands]);
  const who = (actor: string) => {
    const [k, id] = actor.split(':');
    if (k === 'user') return members.find((m) => m.id === id)?.name ?? 'alguém';
    if (k === 'agent') return agents.find((a) => a.slug === id)?.name ?? id;
    return actor === 'engine' ? 'Engine de vídeo' : actor;
  };
  return (
    <div style={{ maxWidth: 760 }}>
      {items.length === 0 && <div className="empty">Ainda nada por aqui.</div>}
      {items.map((i) => (
        <div key={i.id} className="act">
          <small>{new Date(i.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
          <span><b>{who(i.actor)}</b> {i.action} {i.detail && <em>{i.detail}</em>}</span>
        </div>
      ))}
    </div>
  );
}
