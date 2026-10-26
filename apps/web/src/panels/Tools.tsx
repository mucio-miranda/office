import { useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { AgentProfile } from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';


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

/** Painel do funcionário: liga e desliga cada ferramenta para ele. */
export function AgentTools({ agent }: { agent: AgentProfile }) {
  const { tools, loadTools, toggleAgentTool, open } = useStore();
  useEffect(() => { if (!tools.length) loadTools(); }, []);
  const relevant = tools.filter((t) => agent.mcp.includes(t.id) || agent.mcp.includes(`!${t.id}`));
  if (!relevant.length) return null;
  return (
    <div className="agent-tools">
      <div className="section-label" style={{ padding: 0 }}>Ferramentas criativas</div>
      {relevant.map((t) => (
        <label key={t.id} className="check small" title={t.summary}>
          <input type="checkbox" checked={agent.mcp.includes(t.id)} onChange={(e) => toggleAgentTool(agent.id, t.id, e.target.checked)} />
          <span>{t.name}</span>
          {t.installed
            ? <span className="muted">v{t.version}</span>
            : <button type="button" className="link small" onClick={() => open('equipe')}>instalar</button>}
        </label>
      ))}
    </div>
  );
}
