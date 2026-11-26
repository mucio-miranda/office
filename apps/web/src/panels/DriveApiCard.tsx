import { useEffect, useState } from 'react';
import { Cloud, ExternalLink } from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

interface Status { configurado: boolean; conectado: boolean; conta: string | null; retorno: string }

/**
 * Equipe (só o dono): liga o Office à API do Google Drive da agência. Com ela os funcionários copiam de Drive para Drive e
 * põem atalho de pasta só compartilhada, que não aparece no H:.
 */
export function DriveApiCard() {
  const { office, notify } = useStore();
  const [st, setSt] = useState<Status | null>(null);
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/offices/${office!.id}/google-drive`;
  const load = () => api<Status>(base).then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  // o login acontece no navegador: confere de novo quando a pessoa volta para o Office
  useEffect(() => { const f = () => load(); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { notify((e as Error).message); }
    setBusy(false);
  };
  const saveClient = () => run(async () => { setSt({ ...(await api<Status>(base, { method: 'PUT', body: { clientId: id, clientSecret: secret } })), retorno: st?.retorno ?? '' }); setSecret(''); });
  const connect = () => run(async () => { const r = await api<{ url: string }>(`${base}/conectar`, { method: 'POST', body: {} }); window.open(r.url, '_blank'); });
  const disconnect = () => run(async () => { await api(`${base}/desconectar`, { method: 'POST', body: {} }); await load(); });

  if (!st) return null;
  return (
    <section className="card stack">
      <div>
        <h3 className="row gap-s"><Cloud size={16} /> Google Drive (API)</h3>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Para os funcionários copiarem de Drive para Drive e trazerem pastas só compartilhadas com a conta, que não aparecem no H:.
          Só cria atalho, pasta e cópia: nunca apaga, move nem compartilha.
        </p>
      </div>
      {st.conectado ? (
        <div className="row gap">
          <span className="row gap small st-concluido"><span className="status-dot" />conectado{st.conta ? ` · ${st.conta}` : ''}</span>
          <button className="ghost small" disabled={busy} onClick={disconnect}>Desconectar</button>
        </div>
      ) : st.configurado ? (
        <div className="row gap">
          <button className="primary small" disabled={busy} onClick={connect}>Conectar com a conta da agência</button>
          <button className="ghost small" disabled={busy} onClick={() => setSt({ ...st, configurado: false })}>Trocar credencial</button>
        </div>
      ) : (
        <div className="stack">
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>No Google Cloud, com a conta da agência: crie um projeto e ative a <b>Google Drive API</b>.</li>
            <li>Tela de consentimento: tipo Externo, adicione a conta da agência como usuário de teste e depois <b>Publique o app</b> (em teste a autorização vence em 7 dias).</li>
            <li>Credenciais &gt; Criar ID do cliente OAuth &gt; tipo <b>App para computador</b>. Cole o ID e a chave aqui.</li>
          </ol>
          <a className="ghost-link small" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir o Google Cloud</a>
          <input placeholder="ID do cliente (…apps.googleusercontent.com)" value={id} onChange={(e) => setId(e.target.value)} />
          <input placeholder="Chave secreta do cliente" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          <div><button className="primary small" disabled={busy || !id || !secret} onClick={saveClient}>Salvar</button></div>
        </div>
      )}
    </section>
  );
}
