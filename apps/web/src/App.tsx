import { useEffect, useState } from 'react';
import { ArrowRight, LogOut } from 'lucide-react';
import { useStore } from './lib/store';
import { api } from './lib/api';
import { Brand, ThemeToggle, UpdateBanner } from './lib/ui';
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
  return <>{!user || !office || user.mustChangePin ? <Gate /> : <OfficeView />}<UpdateBanner /></>;
}

/** Tela de entrada no estilo do login do Paperclip: formulário à esquerda, arte ASCII à direita. */
function Gate() {
  const user = useStore((s) => s.user);
  return (
    <div className="auth">
      <div className="auth-theme"><ThemeToggle up={false} /></div>
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

type LocalInfo = { local: boolean; first: boolean; accounts: { name: string; hasPassword: boolean; offices: { name: string; role: string }[] }[] };

function Login() {
  const login = useStore((s) => s.login);
  const [mode, setMode] = useState<'entrar' | 'convite' | 'redefinir' | 'criar'>('entrar');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  // no computador que roda o Office: as contas que existem, para ninguém ficar preso sem lembrar o nome
  const [local, setLocal] = useState<LocalInfo | null>(null);
  useEffect(() => { api('/api/auth/local').then(setLocal).catch(() => setLocal(null)); }, []);
  const here = !!local?.local;
  const first = !!local?.first;
  const go = (m: typeof mode) => { setMode(m); setErr(''); setInfo(''); setCode(''); setPin(''); };
  const submit = async () => {
    if (first || mode !== 'redefinir') return login(name.trim(), pin, mode === 'convite' ? code.trim() : undefined, first || mode === 'criar');
    await api('/api/auth/redefinir', { body: { name: name.trim(), code: code.trim() || undefined, pin } });
    go('entrar');
    setInfo('Senha trocada. Agora é só entrar com a senha nova.');
  };
  const title = first ? 'Criar a primeira conta' : mode === 'convite' ? 'Entrar com convite' : mode === 'redefinir' ? 'Trocar a senha' : mode === 'criar' ? 'Criar conta nova' : 'Entrar no Office';
  const sub = first ? `Você é a primeira pessoa aqui. Escolha seu nome e uma senha de pelo menos ${MIN_PASSWORD} caracteres; depois você cria o escritório.`
    : mode === 'convite' ? `Escolha seu nome e uma senha de pelo menos ${MIN_PASSWORD} caracteres. O código vem de quem criou o escritório.`
    : mode === 'redefinir' ? (here ? 'Você está no computador que roda o Office: escolha a conta e defina a senha nova, sem código.' : 'Peça o código de redefinição ao dono do escritório (na tela Equipe).')
    : mode === 'criar' ? 'Uma conta nova começa sem escritório. Se você já tem conta, volte e escolha o seu nome na lista.'
    : here ? 'Escolha sua conta e digite a senha. Esqueceu? Neste computador dá para trocar sem código.' : 'Use seu nome e sua senha. Primeira vez aqui? Entre com o convite.';
  const showList = here && !first && (mode === 'entrar' || mode === 'redefinir') && !!local?.accounts.length;
  return (
    <>
      <h1 className="auth-title">{title}</h1>
      <p className="auth-sub">{sub}</p>
      {showList && (
        <div className="auth-accounts" aria-label="Contas neste computador">
          {local!.accounts.map((a) => (
            <button type="button" key={a.name} className={`auth-account${a.name === name ? ' on' : ''}`} onClick={() => { if (!a.hasPassword && mode === 'entrar') go('redefinir'); setName(a.name); setErr(''); }}>
              <b>{a.name}</b>
              <span className="muted small">{a.offices.length ? a.offices.map((o) => `${o.name} (${o.role})`).join(', ') : 'sem escritório'}{a.hasPassword ? '' : ' · sem senha'}</span>
            </button>
          ))}
        </div>
      )}
      <form className="auth-fields" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        setInfo('');
        setBusy(true);
        try { await submit(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}>
        <label>Nome<input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {!first && (mode === 'convite' || (mode === 'redefinir' && !here)) && <label>{mode === 'convite' ? 'Código do convite' : 'Código de redefinição'}<input className="mono" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>}
        <label>{mode === 'redefinir' && !first ? 'Senha nova' : 'Senha'}<input type="password" autoComplete={mode === 'entrar' && !first ? 'current-password' : 'new-password'} value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        {err && <p className="auth-error" role="alert">{err}</p>}
        {info && <p className="muted small" role="status">{info}</p>}
        <button className="primary wide" disabled={busy || name.trim().length < 2}>{busy ? 'Aguarde…' : first || mode === 'criar' ? 'Criar conta' : mode === 'redefinir' ? 'Trocar a senha' : 'Entrar'}</button>
      </form>
      {!first && (
        <div className="auth-links">
          {mode !== 'entrar' && <button className="link" onClick={() => go('entrar')}>Já tenho conta</button>}
          {mode !== 'convite' && <button className="link" onClick={() => go('convite')}>Tenho um convite</button>}
          {mode !== 'redefinir' && <button className="link" onClick={() => go('redefinir')}>Esqueci a senha</button>}
          {here && mode !== 'criar' && <button className="link" onClick={() => go('criar')}>Criar conta nova</button>}
        </div>
      )}
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
  const [skillsFrom, setSkillsFrom] = useState('');
  const [skillsRemote, setSkillsRemote] = useState('');
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
          const o = await api('/api/offices', { body: { name, rootPath: root, extraDirs: extra, skills: { from: skillsFrom || null, remote: skillsRemote.trim() || null } } });
          if (o.skillsSetup?.error) useStore.getState().notify(`Escritório criado, mas as skills: ${o.skillsSetup.error}`);
          await enterOffice(o.id);
        })}>
          <label>Nome<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="REZZU" /></label>
          <label><span>Pasta raiz <span className="muted">· a da agência, com o CLAUDE.md e os clientes (não a .claude\skills). Atalhos para o Drive entram sozinhos</span></span><PathField value={root} onChange={setRoot} placeholder="C:\Users\voce\Documents\AGENCIA" title="Pasta raiz do escritório" /></label>
          <label><span>Pastas extras <span className="muted">· opcional</span></span><PathList values={extra} onChange={setExtra} /></label>
          <label><span>Trazer skills de uma pasta <span className="muted">· opcional; sem isso começa vazio</span></span><PathField value={skillsFrom} onChange={setSkillsFrom} placeholder="Pasta com .claude\skills de outro projeto" title="Skills para importar" /></label>
          <label><span>Repositório privado das skills <span className="muted">· opcional</span></span><input value={skillsRemote} onChange={(e) => setSkillsRemote(e.target.value)} placeholder="https://github.com/agencia/skills.git" /></label>
          <p className="muted small" style={{ margin: 0 }}>As skills deste escritório ficam em .claude\skills da pasta raiz, com histórico: toda mudança aprovada na Mesa pode ser desfeita.</p>
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
