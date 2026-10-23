import { useEffect, useState } from 'react';
import { useStore } from './lib/store';
import { api } from './lib/api';
import { OfficeView } from './OfficeView';

export function App() {
  const user = useStore((s) => s.user);
  const office = useStore((s) => s.office);
  const [booted, setBooted] = useState(false);
  useEffect(() => { useStore.getState().boot().finally(() => setBooted(true)); }, []);
  if (!booted) return <div className="splash">🏢</div>;
  if (!user) return <Login />;
  if (!office) return <OfficePicker />;
  return <OfficeView />;
}

function Login() {
  const login = useStore((s) => s.login);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="gate">
      <form className="card gate-card" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        try { await login(name.trim(), pin); } catch (x) { setErr((x as Error).message); }
      }}>
        <div className="logo">🏢 <b>Office</b></div>
        <p className="muted">Seu escritório virtual com funcionários de IA. Entre com seu nome. Se for a primeira vez, você pode criar um PIN.</p>
        <label>Seu nome<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Mucio" /></label>
        <label>PIN (opcional)<input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4+ dígitos" /></label>
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={name.trim().length < 2}>Entrar</button>
      </form>
    </div>
  );
}

function OfficePicker() {
  const { offices, enterOffice, user, logout } = useStore();
  const [name, setName] = useState('');
  const [root, setRoot] = useState('');
  const [extra, setExtra] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const run = (fn: () => Promise<unknown>) => async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try { await fn(); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <div className="gate">
      <div className="card gate-card wide">
        <div className="row between">
          <div className="logo">🏢 <b>Office</b></div>
          <button className="ghost" onClick={logout}>Sair ({user?.name})</button>
        </div>
        {offices.length > 0 && (
          <>
            <h3>Seus escritórios</h3>
            <div className="office-list">
              {offices.map((o) => (
                <button key={o.id} className="office-item" onClick={() => enterOffice(o.id)}>
                  <b>{o.name}</b>
                  <small>{o.rootPath}</small>
                  <span className="tag">{o.role}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="grid2">
          <form onSubmit={run(async () => {
            const o = await api('/api/offices', { body: { name, rootPath: root, extraDirs: extra.split(';').map((s) => s.trim()).filter(Boolean) } });
            await enterOffice(o.id);
          })}>
            <h3>Criar escritório</h3>
            <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="REZZU" /></label>
            <label>Pasta raiz (onde a IA trabalha)<input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="C:\Users\voce\Documents\REZZU" /></label>
            <label>Pastas extras (separe com ;)<input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="D:\CLAUDE" /></label>
            <button className="primary" disabled={!name || !root}>Criar</button>
          </form>
          <form onSubmit={run(async () => {
            const o = await api('/api/offices/join', { body: { code } });
            await enterOffice(o.id);
          })}>
            <h3>Entrar com convite</h3>
            <label>Código<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3D4" /></label>
            <button className="primary" disabled={code.length < 4}>Entrar</button>
            <p className="muted small">Peça o código para quem criou o escritório (fica no balcão da recepção).</p>
          </form>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
    </div>
  );
}
