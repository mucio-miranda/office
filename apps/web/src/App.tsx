import { useEffect, useState } from 'react';
import { ArrowRight, LogOut } from 'lucide-react';
import { useStore } from './lib/store';
import { api } from './lib/api';
import { Brand, ThemeToggle } from './lib/ui';
import { AsciiOffice } from './lib/AsciiOffice';
import { PathField, PathList } from './lib/PathPicker';
import { OfficeView } from './OfficeView';

const MIN_PASSWORD = 8;

export function App() {
  const user = useStore((s) => s.user);
  const office = useStore((s) => s.office);
  const [booted, setBooted] = useState(false);
  useEffect(() => { useStore.getState().boot().finally(() => setBooted(true)); }, []);
  if (!booted) return <div className="splash"><Brand /></div>;
  if (!user || !office || user.mustChangePin) return <Gate />;
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
          {!user ? <Login /> : user.mustChangePin ? <ForceNewPassword /> : <OfficeChooser />}
        </div>
      </div>
      <div className="auth-art"><AsciiOffice /></div>
    </div>
  );
}

function Login() {
  const login = useStore((s) => s.login);
  const [mode, setMode] = useState<'entrar' | 'convite' | 'redefinir'>('entrar');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const go = (m: typeof mode) => { setMode(m); setErr(''); setInfo(''); setCode(''); setPin(''); };
  const submit = async () => {
    if (mode !== 'redefinir') return login(name.trim(), pin, mode === 'convite' ? code.trim() : undefined);
    await api('/api/auth/redefinir', { body: { name: name.trim(), code: code.trim() || undefined, pin } });
    go('entrar');
    setInfo('Senha trocada. Agora é só entrar com a senha nova.');
  };
  return (
    <>
      <h1 className="auth-title">{mode === 'convite' ? 'Entrar com convite' : mode === 'redefinir' ? 'Trocar a senha' : 'Entrar no Office'}</h1>
      <p className="auth-sub">
        {mode === 'convite' ? `Escolha seu nome e uma senha de pelo menos ${MIN_PASSWORD} caracteres. O código vem de quem criou o escritório.`
          : mode === 'redefinir' ? 'Peça o código ao dono do escritório. No computador que roda o Office, o código não é necessário.'
          : 'Use seu nome e sua senha. Primeira vez aqui? Entre com o convite.'}
      </p>
      <form className="auth-fields" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        setInfo('');
        setBusy(true);
        try { await submit(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}>
        <label>Nome<input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {mode !== 'entrar' && <label>{mode === 'convite' ? 'Código do convite' : 'Código de redefinição'}<input className="mono" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>}
        <label>{mode === 'redefinir' ? 'Senha nova' : 'Senha'}<input type="password" autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'} value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        {err && <p className="auth-error" role="alert">{err}</p>}
        {info && <p className="muted small" role="status">{info}</p>}
        <button className="primary wide" disabled={busy || name.trim().length < 2}>{busy ? 'Aguarde…' : mode === 'redefinir' ? 'Trocar a senha' : 'Entrar'}</button>
      </form>
      <div className="auth-links">
        {mode !== 'entrar' && <button className="link" onClick={() => go('entrar')}>Já tenho conta</button>}
        {mode !== 'convite' && <button className="link" onClick={() => go('convite')}>Tenho um convite</button>}
        {mode !== 'redefinir' && <button className="link" onClick={() => go('redefinir')}>Esqueci a senha</button>}
      </div>
    </>
  );
}

/** Conta antiga, sem senha ou com PIN curto: agora o Office pode ser aberto de fora, então a troca é obrigatória. */
function ForceNewPassword() {
  const { user, logout, boot } = useStore();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  return (
    <>
      <h1 className="auth-title">Crie uma senha</h1>
      <p className="auth-sub">{user?.name}, o Office agora pede uma senha de pelo menos {MIN_PASSWORD} caracteres. Seus dados continuam todos aqui.</p>
      <form className="auth-fields" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        if (pin !== again) return setErr('As duas senhas estão diferentes.');
        try {
          await api('/api/auth/senha', { body: { pin } });
          await boot();
        } catch (x) { setErr((x as Error).message); }
      }}>
        <label>Senha nova<input autoFocus type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        <label>Repita a senha<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
        {err && <p className="auth-error" role="alert">{err}</p>}
        <button className="primary wide" disabled={pin.length < MIN_PASSWORD}>Salvar e entrar</button>
      </form>
      <div className="auth-links"><span className="spacer" /><button className="link muted" onClick={logout}><LogOut size={13} /> Sair</button></div>
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
          <label>Código<input autoFocus className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3D4E5F6" /></label>
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
