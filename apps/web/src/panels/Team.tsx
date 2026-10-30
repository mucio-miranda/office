import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
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
