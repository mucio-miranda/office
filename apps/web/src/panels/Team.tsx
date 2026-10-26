import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { PathField, PathList } from '../lib/PathPicker';
import { desktop } from '../lib/desktop';
import { FolderOpen } from 'lucide-react';
import { HUMAN_DESKS, ROOMS } from '../office/layout';
import { ToolsCard } from './Tools';

/** "mesa na Redação" (ou "sem mesa"). */
function deskLabel(desk: string | null) {
  const d = HUMAN_DESKS.find((h) => h.id === desk);
  return d ? `mesa: ${ROOMS.find((r) => r.id === d.room)?.label}` : 'sem mesa';
}

export function Team() {
  const { office, members, presences, agents, user, notify, enterOffice } = useStore();
  const online = new Set([user!.id, ...Object.keys(presences)]);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [autoStart, setAutoStart] = useState(false);
  useEffect(() => { desktop?.info().then((i) => { setLanUrls(i.lanUrls); setAutoStart(i.autoStart); }); }, []);
  // no app, localhost não serve para a equipe: mostra o IP real da rede
  const lan = lanUrls[0] ?? `${location.protocol}//${location.hostname}:${location.port}`;
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

      {desktop && (
        <section className="card stack">
          <h3>Aplicativo</h3>
          <label className="check"><input type="checkbox" checked={autoStart} onChange={(e) => { setAutoStart(e.target.checked); desktop?.setAutoStart(e.target.checked); }} /> Iniciar o Office com o Windows (fica na bandeja)</label>
          <p className="muted small" style={{ margin: 0 }}>Atalho global: <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd> abre ou esconde o Office. <kbd>F11</kbd> alterna a tela cheia.</p>
        </section>
      )}

      <section className="card stack">
        <div className="row between">
          <h3>Pastas do escritório</h3>
          {desktop && <button className="small" onClick={() => desktop?.openPath(office!.rootPath)}><FolderOpen size={13} /> Abrir no Explorer</button>}
        </div>
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

      <ToolsCard />

      <section>
        <div className="section-label" style={{ padding: 0, marginBottom: 4 }}>Pessoas</div>
        {members.map((m) => (
          <div key={m.id} className="member">
            <span className="avatar" style={{ background: m.color }}>{m.name[0]}</span>
            <b>{m.name}</b>
            <span className="badge">{m.role}</span>
            <span className="muted small">{deskLabel(m.desk)}</span>
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
