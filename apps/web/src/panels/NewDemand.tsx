import { useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { PROCESSES, canWork } from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

/**
 * Demanda nova direto do mapa: escolhe o cliente, escreve o pedido e o funcionário já começa, na conversa do cliente
 * (a mesma sessão do Claude Code que continua de um pedido para o outro).
 */
export function NewDemand({ agentId, clientId, onClose }: { agentId?: string | null; clientId?: string | null; onClose: () => void }) {
  const { office, clients, agents, open, notify } = useStore();
  const active = clients.filter((c) => c.status === 'ativo');
  const [f, setF] = useState({
    clientId: clientId ?? (active.length === 1 ? active[0].id : ''), agentId: agentId ?? '', text: '', process: '', dueDate: '', priority: 'media',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const agent = agents.find((a) => a.id === f.agentId);
  const client = clients.find((c) => c.id === f.clientId);
  if (!canWork(office?.role)) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <header className="modal-head"><h3>Nova demanda</h3><button type="button" className="icon" onClick={onClose}><X size={16} /></button></header>
          <div className="modal-body"><p className="muted">Convidados acompanham o escritório, mas quem abre demandas é um membro.</p></div>
        </div>
      </div>
    );
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try {
          await api(`/api/offices/${office!.id}/clients/${f.clientId}/conversa`, {
            body: {
              text: f.text,
              demand: { agentId: f.agentId || null, process: f.process || null, dueDate: f.dueDate || null, priority: f.priority },
            },
          });
          notify(`${agent?.name ?? 'O funcionário'} começou a demanda de ${client?.name}`);
          onClose();
          open('clientes', f.clientId);
        } catch (x) { setErr((x as Error).message); }
        setBusy(false);
      }}>
        <header className="modal-head">
          <h3>Nova demanda{agent ? ` com ${agent.name}` : ''}</h3>
          <button type="button" className="icon" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="modal-body">
          <div className="grid2">
            <label>Cliente
              <select required autoFocus={!f.clientId} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}>
                <option value="">Escolha</option>
                {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Quem faz
              <select value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}>
                <option value="">Quem estiver livre</option>
                {agents.filter((a) => a.slug !== 'gerente' || a.id === f.agentId).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}
              </select>
            </label>
          </div>
          <label>Pedido
            <textarea required rows={4} autoFocus={!!f.clientId} value={f.text} maxLength={20000}
              placeholder="Ex.: /start-conteudo novembro, ou: capa do reels do TEA com outra foto dela, mande 3 opções antes"
              onChange={(e) => setF({ ...f, text: e.target.value })} />
          </label>
          <div className="grid2">
            <label>Processo
              <select value={f.process} onChange={(e) => setF({ ...f, process: e.target.value })}>
                <option value="">O funcionário decide pelo pedido</option>
                {PROCESSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <div className="grid2">
              <label>Prazo<input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></label>
              <label>Prioridade
                <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
                  <option value="baixa">baixa</option><option value="media">média</option><option value="alta">alta</option><option value="urgente">urgente</option>
                </select>
              </label>
            </div>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            A demanda entra no quadro e a sessão começa na conversa de {client?.name ?? 'cliente'}, que continua de onde parou. Se já houver um trabalho rodando para ela, este espera a vez.
          </p>
          {err && <div className="error">{err}</div>}
        </div>
        <footer className="modal-foot">
          {agent ? <button type="button" className="ghost small" onClick={() => { onClose(); open('agente', agent.id); }}><MessageSquare size={13} /> Ver o histórico de {agent.name}</button> : <span />}
          <div className="row gap"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy || !f.clientId || !f.text.trim()}>Começar</button></div>
        </footer>
      </form>
    </div>
  );
}
