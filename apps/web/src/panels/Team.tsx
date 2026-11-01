import { useEffect, useState } from 'react';
import { Copy, Palette, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { MAX_CUSTOM_ROOMS, WALL_TYPES, type AgentProfile, type Member, type WallType } from '@office/shared';
import { AvatarEditor } from './AvatarEditor';
import { DESKS, findDeskSpot } from '../office/layout';
import { WALL_LABEL, applyWall, wallsOfRoom } from '../office/decor/walls';
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
  const { office, members, presences, agents, user, notify, enterOffice, logout } = useStore();
  const isOwner = office!.role === 'dono';
  const online = new Set([user!.id, ...Object.keys(presences)]);
  const [urls, setUrls] = useState<{ lan: string[]; vpn: string[] }>({ lan: [], vpn: [] });
  const [autoStart, setAutoStart] = useState(false);
  const [resetCode, setResetCode] = useState<{ name: string; code: string } | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [editingAgent, setEditingAgent] = useState<AgentProfile | 'novo' | null>(null);
  useEffect(() => {
    desktop?.info().then((i) => setAutoStart(i.autoStart));
    api(`/api/offices/${office!.id}/enderecos`).then(setUrls).catch(() => { /* só deixa os endereços de fora */ });
  }, [office]);
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); } catch (e) { notify((e as Error).message); } };
  const [root, setRoot] = useState(office!.rootPath);
  const [extra, setExtra] = useState<string[]>(office!.extraDirs);
  const [drive, setDrive] = useState(office!.driveRoot ?? '');
  const [backup, setBackup] = useState(office!.backupDir ?? '');
  const dirty = root !== office!.rootPath || JSON.stringify(extra) !== JSON.stringify(office!.extraDirs) || drive !== (office!.driveRoot ?? '') || backup !== (office!.backupDir ?? '');

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <section className="card stack">
        <div>
          <h3>{isOwner ? 'Convide a equipe' : 'Endereços do escritório'}</h3>
          <p className="muted" style={{ margin: '4px 0 0' }}>O Office precisa estar aberto no computador do escritório. A pessoa abre um destes endereços no navegador:</p>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          {urls.lan.map((u) => <span key={u} className="small">Na mesma rede: <code>{u}</code></span>)}
          {urls.vpn.map((u) => <span key={u} className="small">De outro lugar, pela VPN: <code>{u}</code></span>)}
        </div>
        {isOwner && (
          <>
            <div className="row gap">
              <div className="invite-code">{office!.inviteCode}</div>
              <button className="icon" title="Copiar" onClick={() => { navigator.clipboard?.writeText(office!.inviteCode); notify('Código copiado'); }}><Copy size={15} /></button>
              <button className="small" title="O código antigo para de funcionar; quem já entrou continua" onClick={act(async () => {
                await api(`/api/offices/${office!.id}/convite`, { body: {} });
                await enterOffice(office!.id);
                notify('Código de convite trocado');
              })}><RefreshCw size={13} /> Trocar código</button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Convide só quem é de confiança: membros pedem tarefas aos funcionários de IA, que rodam neste computador.</p>
            {urls.vpn.length === 0 && (
              <div className="stack" style={{ gap: 4 }}>
                <b className="small">Para quem está em outro lugar</b>
                <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Crie uma conta grátis no NetBird (netbird.io) e instale o programa neste computador.</li>
                  <li>Cada pessoa instala o NetBird e entra na mesma rede, com o convite que você manda por lá.</li>
                  <li>Quando a VPN conectar, o endereço de fora aparece aqui.</li>
                </ol>
                <p className="small muted" style={{ margin: 0 }}>Nunca libere a porta do Office no roteador nem use um túnel público: a VPN é o que mantém estranhos fora.</p>
              </div>
            )}
          </>
        )}
      </section>

      <AccountCard onLogout={logout} />

      {desktop && (
        <section className="card stack">
          <h3>Aplicativo</h3>
          <label className="check"><input type="checkbox" checked={autoStart} onChange={(e) => { setAutoStart(e.target.checked); desktop?.setAutoStart(e.target.checked); }} /> Iniciar o Office com o Windows (fica na bandeja)</label>
          <p className="muted small" style={{ margin: 0 }}>Atalho global: <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd> abre ou esconde o Office. <kbd>F11</kbd> alterna a tela cheia.</p>
        </section>
      )}

      {isOwner && <section className="card stack">
        <div className="row between">
          <h3>Pastas do escritório</h3>
          {desktop && <button className="small" onClick={() => desktop?.openPath(office!.rootPath)}><FolderOpen size={13} /> Abrir no Explorer</button>}
        </div>
        <label>Pasta raiz <span className="muted">(onde os funcionários de IA trabalham)</span><PathField value={root} onChange={setRoot} title="Pasta raiz do escritório" /></label>
        <label>Pastas extras liberadas<PathList values={extra} onChange={setExtra} /></label>
        <label>Pasta do Drive <span className="muted">(a pasta da agência no Google Drive para computador; recebe o trabalho aprovado)</span><PathField value={drive} onChange={setDrive} title="Pasta do Drive" placeholder="G:\Meu Drive\AGENCIA" /></label>
        <label>Segunda cópia do backup <span className="muted">(opcional; use uma pasta só sua, porque o banco tem o financeiro)</span><PathField value={backup} onChange={setBackup} title="Pasta da segunda cópia do backup" /></label>
        <div className="row end">
          <button className="primary" disabled={!dirty} onClick={async () => {
            await api(`/api/offices/${office!.id}`, { method: 'PATCH', body: { rootPath: root, extraDirs: extra, driveRoot: drive.trim() || null, backupDir: backup.trim() || null } });
            await enterOffice(office!.id);
            notify('Pastas atualizadas');
          }}>Salvar pastas</button>
        </div>
      </section>}

      {isOwner && <BackupCard />}

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
            {(isOwner || m.id === user!.id) && <button className="icon" title="Mudar nome e aparência" onClick={() => setEditing(m)}><Palette size={14} /></button>}
            {isOwner && m.id !== user!.id && (
              <span className="row gap" style={{ marginLeft: 'auto' }}>
                <button className="small" onClick={act(async () => {
                  const r = await api(`/api/offices/${office!.id}/members/${m.id}/redefinir`, { body: {} });
                  setResetCode({ name: m.name, code: r.code });
                })}>Redefinir senha</button>
                {m.role !== 'dono' && <button className="small" onClick={act(async () => {
                  if (!window.confirm(`Remover ${m.name} do escritório? O acesso acaba na hora.`)) return;
                  await api(`/api/offices/${office!.id}/members/${m.id}`, { method: 'DELETE' });
                  await useStore.getState().reload('members');
                  notify(`${m.name} saiu do escritório`);
                })}>Remover</button>}
              </span>
            )}
          </div>
        ))}
        {resetCode && (
          <p className="small" role="status">Passe para {resetCode.name}, vale uma vez por 24 horas: <code>{resetCode.code}</code>. Em "Esqueci a senha", a pessoa usa esse código e escolhe a senha nova.</p>
        )}
      </section>

      {isOwner && <RoomsCard />}

      <section>
        <div className="row between" style={{ marginBottom: 4 }}>
          <div className="section-label" style={{ padding: 0 }}>Funcionários de IA</div>
          {isOwner && <button className="ghost small" onClick={() => setEditingAgent('novo')}><Plus size={13} /> Novo funcionário</button>}
        </div>
        {agents.map((a) => (
          <div key={a.id} className="member">
            <span className="avatar" style={{ background: a.color }}>{a.name[0]}</span>
            <b>{a.name}</b>
            <span className="muted small">{a.role}</span>
            <span className={`row gap small st-${a.status}`}><span className="status-dot" />{a.status}</span>
            {isOwner && <button className="icon" title="Mudar nome, sala e aparência" onClick={() => setEditingAgent(a)}><Pencil size={14} /></button>}
          </div>
        ))}
      </section>
      {editing && (
        <AvatarEditor title={editing.id === user!.id ? 'Meu avatar' : `Avatar de ${editing.name}`} seed={`user:${editing.id}`} initial={editing}
          note="O nome também é o que a pessoa usa para entrar." onClose={() => setEditing(null)}
          onSave={async (v) => {
            await api(editing.id === user!.id ? '/api/me' : `/api/offices/${office!.id}/members/${editing.id}`, { method: 'PATCH', body: v });
            if (editing.id === user!.id) useStore.setState({ user: { ...user!, ...v } });
            await useStore.getState().reload('members');
            notify('Avatar atualizado');
          }} />
      )}
      {editingAgent && <AgentEditor agent={editingAgent === 'novo' ? null : editingAgent} onClose={() => setEditingAgent(null)} />}
    </div>
  );
}

const BASES: [string, string][] = [['designer', 'Design (como a Duda)'], ['editor-de-video', 'Vídeo (como o Vic)'], ['copywriter', 'Copy (como o Theo)'], ['gerente', 'Gerência (como o Rafa)']];

/** Funcionário novo ou existente: nome, cargo, sala, aparência e, nos novos, o modelo de que herda o trabalho. */
function AgentEditor({ agent, onClose }: { agent: AgentProfile | null; onClose: () => void }) {
  const { office, agents, rooms, notify } = useStore();
  const [role, setRole] = useState(agent?.role ?? '');
  const [room, setRoom] = useState(agent?.room ?? 'design');
  const [base, setBase] = useState('designer');
  useStore((s) => s.mapRev);
  const url = `/api/offices/${office!.id}/agents`;
  /** A mesa padrão da sala, se estiver livre; senão, um espaço livre nela. */
  const seatFor = (target: string) => {
    if (agent && target === agent.room) return agent.seat ?? null;
    const defaultFree = DESKS[target] && !agents.some((a) => a.id !== agent?.id && a.room === target && !a.seat);
    if (defaultFree) return null;
    const spot = findDeskSpot(target);
    if (!spot) throw new Error('Não há espaço para mais uma mesa nessa sala. Tire algo da decoração ou escolha outra.');
    return spot;
  };
  return (
    <AvatarEditor title={agent ? `Editar ${agent.name}` : 'Novo funcionário de IA'} seed={agent ? `agent:${agent.id}` : `novo:${agents.length}`} saveLabel={agent ? 'Salvar' : 'Contratar'}
      initial={agent ?? { name: '', color: '#7c5cff' }} onClose={onClose}
      onSave={async (v) => {
        const seat = seatFor(room);
        if (agent) await api(`${url}/${agent.id}`, { method: 'PATCH', body: { ...v, role, room, seat } });
        else await api(url, { body: { ...v, role, room, seat, base } });
        await useStore.getState().reload('agents');
        notify(agent ? `${v.name} atualizado` : `${v.name} começou no escritório`);
      }}>
      <label>Cargo<input value={role} maxLength={80} placeholder={agent ? '' : 'Vem do modelo, se ficar em branco'} onChange={(e) => setRole(e.target.value)} /></label>
      {!agent && (
        <label>Trabalha como <span className="muted">(herda as skills e as permissões, e pega os mesmos processos)</span>
          <select value={base} onChange={(e) => setBase(e.target.value)}>{BASES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
      )}
      <label>Sala
        <select value={room} onChange={(e) => setRoom(e.target.value)}>
          {ROOMS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          {rooms.length === 0 && null}
        </select>
      </label>
      {agent?.base && (
        <button type="button" className="ghost small danger self-start" onClick={async () => {
          if (!confirm(`Desligar ${agent.name}? O histórico de conversas dele sai junto; os arquivos que ele fez ficam nas pastas.`)) return;
          try { await api(`${url}/${agent.id}`, { method: 'DELETE' }); await useStore.getState().reload('agents'); onClose(); } catch (e) { notify((e as Error).message); }
        }}><Trash2 size={13} /> Desligar</button>
      )}
    </AvatarEditor>
  );
}

const FLOORS = ['#e8e4dc', '#f4f4f2', '#1f2023', '#9aa0a6', '#e3e9f2', '#e4f3ee', '#f3e4e4', '#efe6f6'];

/** Salas novas: anexos a leste do prédio, com porta para o vizinho e duas mesas para pessoas. */
function RoomsCard() {
  const { office, rooms, notify, layout } = useStore();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🚪');
  const [floor, setFloor] = useState(FLOORS[0]);
  const [wall, setWall] = useState<WallType>('alvenaria');
  const url = `/api/offices/${office!.id}/rooms`;
  const reload = () => useStore.getState().reload('rooms');
  return (
    <section className="card stack">
      <div>
        <h3>Salas</h3>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Salas novas entram a leste do prédio, com porta para a área vizinha. Paredes e pisos de qualquer sala mudam no modo Decorar (<kbd>X</kbd>).</p>
      </div>
      {rooms.map((r) => (
        <div key={r.id} className="member">
          <span className="avatar" style={{ background: r.floor, color: '#111' }}>{r.emoji}</span>
          <input aria-label="Nome da sala" defaultValue={r.name} maxLength={40} onBlur={async (e) => {
            const v = e.target.value.trim();
            if (v.length < 2 || v === r.name) return;
            try { await api(`${url}/${r.id}`, { method: 'PATCH', body: { name: v } }); await reload(); } catch (x) { notify((x as Error).message); }
          }} />
          <button className="icon" title="Remover a sala" onClick={async () => {
            const room = ROOMS.find((x) => x.id === r.id);
            if (!confirm(`Remover ${r.name}? A decoração de dentro sai junto.`)) return;
            try {
              await api(`${url}/${r.id}`, { method: 'DELETE' });
              if (room && layout?.length) await api(`/api/offices/${office!.id}/layout`, { method: 'PUT', body: { items: layout.filter((i) => !(i.x >= room.x0 && i.x < room.x1 && i.z >= room.z0 && i.z < room.z1)) } });
              await reload();
            } catch (x) { notify((x as Error).message); }
          }}><Trash2 size={14} /></button>
        </div>
      ))}
      {rooms.length < MAX_CUSTOM_ROOMS && (
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api(url, { body: { name, emoji, floor } });
            await reload();
            if (wall !== 'alvenaria') await applyWall(wallsOfRoom(r.id), wall);
            setName('');
            notify(`${r.name} pronta`);
          } catch (x) { notify((x as Error).message); }
        }}>
          <div className="row gap">
            <label style={{ width: 70 }}>Ícone<input value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} /></label>
            <label style={{ flex: 1 }}>Nova sala<input value={name} minLength={2} maxLength={40} placeholder="Estúdio de podcast" onChange={(e) => setName(e.target.value)} /></label>
            <label>Paredes<select value={wall} onChange={(e) => setWall(e.target.value as WallType)}>{WALL_TYPES.map((t) => <option key={t} value={t}>{WALL_LABEL[t]}</option>)}</select></label>
          </div>
          <div className="row between">
            <div className="av-swatches">{FLOORS.map((c) => <button type="button" key={c} className={floor === c ? 'on' : ''} style={{ background: c }} title="Cor do piso" onClick={() => setFloor(c)} />)}</div>
            <button className="primary small" disabled={name.trim().length < 2}><Plus size={13} /> Criar sala</button>
          </div>
        </form>
      )}
    </section>
  );
}

function AccountCard({ onLogout }: { onLogout(): void }) {
  const notify = useStore((s) => s.notify);
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  return (
    <section className="card stack">
      <h3>Minha conta</h3>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api('/api/auth/senha', { body: { current, pin } });
          setCurrent('');
          setPin('');
          notify('Senha trocada. Os outros aparelhos saíram da conta.');
        } catch (x) { notify((x as Error).message); }
      }}>
        <div className="row gap">
          <label style={{ flex: 1 }}>Senha atual<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
          <label style={{ flex: 1 }}>Senha nova<input type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        </div>
        <div className="row between">
          <button type="button" className="small" onClick={async () => {
            try {
              await api('/api/auth/sair-de-todos', { body: {} });
            } finally {
              onLogout();
            }
          }}>Sair de todos os aparelhos</button>
          <button className="primary" disabled={!current || pin.length < 8}>Trocar senha</button>
        </div>
      </form>
    </section>
  );
}

interface BackupInfo { dir: string; items: { name: string; size: number; at: string }[]; error: string | null }

function BackupCard() {
  const office = useStore((s) => s.office)!;
  const notify = useStore((s) => s.notify);
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<BackupInfo>(`/api/offices/${office.id}/backups`).then(setInfo);
  useEffect(() => { load().catch(() => { /* o cartão fica sem a lista */ }); }, [office.id]);
  const last = info?.items[0];
  return (
    <section className="card stack">
      <div className="row between">
        <h3>Backup do banco</h3>
        <button className="small" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const r = await api(`/api/offices/${office.id}/backups`, { body: {} });
            notify(r.errors.length ? 'Backup feito, mas a segunda cópia falhou' : 'Backup feito');
            await load();
          } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? 'Fazendo…' : 'Fazer backup agora'}</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Sai sozinho uma vez por dia com o Office aberto e guarda os últimos 14. Inclui demandas, clientes, financeiro e contas. Os arquivos dos clientes ficam nas pastas deles.
      </p>
      <p className="small" style={{ margin: 0 }}>{last ? `Último: ${new Date(last.at).toLocaleString('pt-BR')} · ${(last.size / 1048576).toFixed(1)} MB · ${info!.items.length} ${info!.items.length === 1 ? 'guardado' : 'guardados'}` : 'Nenhum backup ainda.'}</p>
      {info && <code className="small truncate">{info.dir}</code>}
      {info?.error && <p className="auth-error" role="alert">{info.error}</p>}
    </section>
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
