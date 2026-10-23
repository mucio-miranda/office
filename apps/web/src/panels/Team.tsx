import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

export function Team() {
  const { office, members, presences, agents, user } = useStore();
  const online = new Set([user!.id, ...Object.keys(presences)]);
  const lan = `${location.protocol}//${location.hostname}:${location.port}`;
  return (
    <div className="team">
      <div className="card invite">
        <h4>Convide a equipe</h4>
        <p>Quem estiver na mesma rede abre <code>{lan}</code>, entra com o nome e usa o código:</p>
        <div className="code">{office?.inviteCode}</div>
        <p className="muted small">Pasta raiz deste escritório: <code>{office?.rootPath}</code></p>
      </div>
      <h4>Pessoas</h4>
      {members.map((m) => (
        <div key={m.id} className="member">
          <span className="dot" style={{ background: m.color }} />
          <b>{m.name}</b>
          <span className="tag">{m.role}</span>
          <span className={online.has(m.id) ? 'on' : 'off'}>{online.has(m.id) ? 'online' : 'offline'}</span>
        </div>
      ))}
      <h4>Funcionários de IA</h4>
      {agents.map((a) => (
        <div key={a.id} className="member">
          <span className="dot" style={{ background: a.color }} />
          <b>{a.name}</b>
          <span className="tag">{a.role}</span>
          <span>{a.status}</span>
        </div>
      ))}
    </div>
  );
}

export function Activity() {
  const office = useStore((s) => s.office);
  const jobs = useStore((s) => s.jobs);
  const demands = useStore((s) => s.demands);
  const [items, setItems] = useState<{ id: number; actor: string; action: string; detail: string; at: string }[]>([]);
  useEffect(() => { api(`/api/offices/${office!.id}/activity`).then(setItems); }, [office, jobs, demands]);
  const { members, agents } = useStore();
  const who = (actor: string) => {
    const [k, id] = actor.split(':');
    if (k === 'user') return members.find((m) => m.id === id)?.name ?? 'alguém';
    if (k === 'agent') return `🤖 ${agents.find((a) => a.slug === id)?.name ?? id}`;
    return actor === 'engine' ? '🎬 Engine' : actor;
  };
  return (
    <div className="activity">
      {items.length === 0 && <p className="muted">Ainda nada por aqui.</p>}
      {items.map((i) => (
        <div key={i.id} className="act">
          <small>{new Date(i.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
          <span><b>{who(i.actor)}</b> {i.action} {i.detail && <em>“{i.detail}”</em>}</span>
        </div>
      ))}
    </div>
  );
}
