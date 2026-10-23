import { useEffect, useState } from 'react';
import { ArrowRight, LogOut } from 'lucide-react';
import { useStore } from './lib/store';
import { api } from './lib/api';
import { Brand, ThemeToggle } from './lib/ui';
import { AsciiOffice } from './lib/AsciiOffice';
import { PathField, PathList } from './lib/PathPicker';
import { OfficeView } from './OfficeView';

export function App() {
  const user = useStore((s) => s.user);
  const office = useStore((s) => s.office);
  const [booted, setBooted] = useState(false);
  useEffect(() => { useStore.getState().boot().finally(() => setBooted(true)); }, []);
  if (!booted) return <div className="splash"><Brand /></div>;
  if (!user || !office) return <Gate />;
  return <OfficeView />;
}

/** Tela de entrada no estilo do login do Paperclip: formulário à esquerda, arte ASCII à direita. */
function Gate() {
  const user = useStore((s) => s.user);
  return (
    <div className="auth">
      <div className="auth-theme"><ThemeToggle /></div>
      <div className="auth-form">
        <div className="auth-inner">
          <div className="auth-brand"><Brand /></div>
          {user ? <OfficeChooser /> : <Login />}
        </div>
      </div>
      <div className="auth-art"><AsciiOffice /></div>
    </div>
  );
}

function Login() {
  const login = useStore((s) => s.login);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="auth-title">Entrar no Office</h1>
      <p className="auth-sub">Use seu nome para entrar neste servidor. Se for a primeira vez, a conta é criada na hora e o PIN é opcional.</p>
      <form className="auth-fields" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        setBusy(true);
        try { await login(name.trim(), pin); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}>
        <label>Nome<input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>PIN<input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="opcional" /></label>
        {err && <p className="auth-error" role="alert">{err}</p>}
        <button className="primary wide" disabled={busy || name.trim().length < 2}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </>
  );
}

function OfficeChooser() {
  const { offices, enterOffice, user, logout } = useStore();
  const [mode, setMode] = useState<'list' | 'create' | 'join'>(offices.length ? 'list' : 'create');
  const [name, setName] = useState('');
  const [root, setRoot] = useState('');
  const [extra, setExtra] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const run = (fn: () => Promise<unknown>) => async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try { await fn(); } catch (x) { setErr((x as Error).message); }
  };

  return (
    <>
      <h1 className="auth-title">{mode === 'create' ? 'Criar escritório' : mode === 'join' ? 'Entrar com convite' : `Olá, ${user?.name}`}</h1>
      <p className="auth-sub">
        {mode === 'create' ? 'A pasta raiz é onde os funcionários de IA trabalham. O CLAUDE.md e as skills dela valem para todos.'
          : mode === 'join' ? 'Peça o código para quem criou o escritório.'
          : 'Escolha um escritório para entrar.'}
      </p>

      {mode === 'list' && (
        <div className="office-list">
          {offices.map((o) => (
            <button key={o.id} className="office-item" onClick={() => enterOffice(o.id)}>
              <div>
                <b className="truncate">{o.name}</b>
                <small className="muted mono truncate">{o.rootPath}</small>
              </div>
              <ArrowRight size={15} className="muted" />
            </button>
          ))}
        </div>
      )}

      {mode === 'create' && (
        <form className="auth-fields" onSubmit={run(async () => {
          const o = await api('/api/offices', { body: { name, rootPath: root, extraDirs: extra } });
          await enterOffice(o.id);
        })}>
          <label>Nome<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="REZZU" /></label>
          <label>Pasta raiz<PathField value={root} onChange={setRoot} placeholder="C:\Users\voce\Documents\AGENCIA" title="Pasta raiz do escritório" /></label>
          <label><span>Pastas extras <span className="muted">· opcional</span></span><PathList values={extra} onChange={setExtra} /></label>
          {err && <p className="auth-error" role="alert">{err}</p>}
          <button className="primary wide" disabled={!name || !root}>Criar escritório</button>
        </form>
      )}

      {mode === 'join' && (
        <form className="auth-fields" onSubmit={run(async () => {
          const o = await api('/api/offices/join', { body: { code } });
          await enterOffice(o.id);
        })}>
          <label>Código<input autoFocus className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3D4" /></label>
          {err && <p className="auth-error" role="alert">{err}</p>}
          <button className="primary wide" disabled={code.length < 4}>Entrar</button>
        </form>
      )}

      <div className="auth-links">
        {mode !== 'list' && offices.length > 0 && <button className="link" onClick={() => setMode('list')}>Meus escritórios</button>}
        {mode !== 'create' && <button className="link" onClick={() => setMode('create')}>Criar escritório</button>}
        {mode !== 'join' && <button className="link" onClick={() => setMode('join')}>Tenho um convite</button>}
        <span className="spacer" />
        <button className="link muted" onClick={logout}><LogOut size={13} /> Sair</button>
      </div>
    </>
  );
}
