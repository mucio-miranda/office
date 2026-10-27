import { useEffect, useState } from 'react';
import { AppWindow, Download, ExternalLink, Radio, X } from 'lucide-react';
import type { AgentProfile, LiveSession } from '@office/shared';
import { useStore } from '../lib/store';
import { api, liveFrameUrl } from '../lib/api';


/** Página Equipe: as ferramentas criativas desta máquina, quem usa cada uma e o botão de instalar. */
export function ToolsCard() {
  const { tools, agents, office, loadTools, notify } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { loadTools(); }, []);
  const owner = office?.role === 'dono';

  const install = async (id: string, name: string) => {
    setBusy(id);
    try {
      const t = await api(`/api/offices/${office!.id}/tools/${id}/install`, { method: 'POST', body: {} });
      notify(`${name} ${t.version ?? ''} instalado`);
      await loadTools();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card stack">
      <div>
        <h3>Ferramentas criativas</h3>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Programas open source que os funcionários de IA operam por MCP, só dentro das pastas do escritório.
        </p>
      </div>
      {tools.length === 0 && <div className="muted small">Procurando…</div>}
      {tools.map((t) => {
        const users = agents.filter((a) => a.mcp.includes(t.id));
        return (
          <div key={t.id} className="tool-row">
            <div className="tool-main">
              <div className="row gap">
                <b>{t.name}</b>
                <span className="muted small">no lugar do {t.replaces}</span>
              </div>
              <div className="muted small">{t.summary}</div>
              <div className="chips">
                {users.map((a) => <span key={a.id} className="badge"><span className="status-dot" style={{ background: a.color }} />{a.name}</span>)}
              </div>
            </div>
            <div className="tool-side">
              <span className={`row gap small ${t.installed ? 'st-concluido' : 'st-livre'}`}>
                <span className="status-dot" />{t.installed ? `instalado${t.version ? ` · v${t.version}` : ''}` : 'não instalado'}
              </span>
              {!t.installed && t.canInstall && owner && (
                <button className="small primary" disabled={busy !== null} onClick={() => install(t.id, t.name)}>
                  <Download size={13} /> {busy === t.id ? 'Baixando…' : 'Instalar'}
                </button>
              )}
              {/* no app de Windows o link abre no navegador padrão */}
              <a className="ghost-link small" href={t.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Projeto</a>
            </div>
          </div>
        );
      })}
      {!owner && tools.some((t) => !t.installed) && <p className="muted small" style={{ margin: 0 }}>Só o dono do escritório instala ferramentas.</p>}
    </section>
  );
}

/** Painel do funcionário: liga e desliga cada ferramenta para ele e o modo ao vivo de cada uma. */
export function AgentTools({ agent }: { agent: AgentProfile }) {
  const { tools, loadTools, toggleAgentTool, toggleAgentLive, open } = useStore();
  useEffect(() => { if (!tools.length) loadTools(); }, []);
  const relevant = tools.filter((t) => agent.mcp.includes(t.id) || agent.mcp.includes(`!${t.id}`));
  if (!relevant.length) return null;
  return (
    <div className="agent-tools">
      <div className="section-label" style={{ padding: 0 }}>Ferramentas criativas</div>
      {relevant.map((t) => {
        const on = agent.mcp.includes(t.id);
        return (
          <div key={t.id} className="agent-tool">
            <label className="check small" title={t.summary}>
              <input type="checkbox" checked={on} onChange={(e) => toggleAgentTool(agent.id, t.id, e.target.checked)} />
              <span>{t.name}</span>
              {t.installed
                ? <span className="muted">v{t.version}</span>
                : <button type="button" className="link small" onClick={() => open('equipe')}>instalar</button>}
            </label>
            {t.live && on && (
              <label className="check small live-toggle" title="O app abre na tela do computador do servidor e a IA opera a janela; a equipe assiste pelo espelho">
                <input type="checkbox" checked={agent.live.includes(t.id)} onChange={(e) => toggleAgentLive(agent.id, t.id, e.target.checked)} />
                <Radio size={12} /> ao vivo
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Recarrega o print da janela sem piscar: troca só quando o próximo já carregou. */
export function useLiveFrame(s: LiveSession | undefined, big: boolean, every = 1000) {
  const officeId = useStore((st) => st.office?.id);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!s || !officeId) { setSrc(null); return; }
    let alive = true;
    const load = () => {
      const url = liveFrameUrl(officeId, s.id, big);
      const img = new Image();
      img.onload = () => { if (alive) setSrc(url); };
      img.src = url;
    };
    load();
    const t = setInterval(load, every);
    return () => { alive = false; clearInterval(t); };
  }, [s?.id, officeId, big, every]);
  return src;
}

const LIVE_STATUS: Record<LiveSession['status'], string> = {
  abrindo: 'abrindo o app…', ativa: 'trabalhando ao vivo', livre: 'app aberto, esperando revisão', erro: 'erro',
};

/** Espelho ao vivo de um app criativo aberto: o print da janela, atualizado a cada segundo. */
export function LiveMirror({ s }: { s: LiveSession }) {
  const { office, agents, notify } = useStore();
  const [full, setFull] = useState(false);
  const src = useLiveFrame(s, true);
  const agent = agents.find((a) => a.id === s.agentId);
  const act = async (what: 'focus' | 'close') => {
    try {
      await api(`/api/offices/${office!.id}/live/${s.id}/${what}`, { body: {} });
      if (what === 'focus') notify(`${s.toolName} na frente, no computador do servidor`);
    } catch (e) { notify((e as Error).message); }
  };
  return (
    <div className={`live-mirror ${full ? 'full' : ''}`}>
      <div className="live-head">
        <span className={`live-dot ${s.status}`} />
        <b>{s.toolName}</b>
        <span className="muted small">{agent?.name} · {LIVE_STATUS[s.status]}</span>
        <span className="spacer" />
        <button className="small ghost" title="Trazer a janela para a frente no computador do servidor" onClick={() => act('focus')}><AppWindow size={13} /> Assumir</button>
        <button className="small ghost" onClick={() => setFull(!full)}>{full ? 'Reduzir' : 'Ampliar'}</button>
        {s.status !== 'ativa' && <button className="small ghost" title="Fechar o app (o que não foi salvo fica na recuperação do app)" onClick={() => act('close')}><X size={13} /> Fechar app</button>}
      </div>
      <div className="live-screen" onDoubleClick={() => setFull(!full)}>
        {src ? <img src={src} alt={`Tela do ${s.toolName}`} /> : <div className="muted small">Esperando o primeiro print da janela…</div>}
      </div>
      {s.error && <div className="muted small live-error">{s.error}</div>}
    </div>
  );
}
