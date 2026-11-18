import { useState } from 'react';
import { Check, UserPlus, X } from 'lucide-react';
import type { HelperRequest } from '@office/shared';
import { useStore } from '../lib/store';
import { api } from '../lib/api';

/**
 * Pedidos de ajudante esperando aprovação: quem pediu, a tarefa e o motivo. Qualquer pessoa da equipe permite ou recusa.
 * `clientId` mostra só os de um cliente (na conversa dele); sem ele, todos (na Mesa).
 */
export function HelperRequests({ clientId }: { clientId?: string }) {
  const { helpers, workers, clients, office, notify, open } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = helpers.filter((h) => h.status === 'pendente' && (!clientId || h.clientId === clientId));
  if (!pending.length) return null;
  const decide = async (h: HelperRequest, approve: boolean) => {
    setBusy(h.id);
    try {
      const r = await api<{ helper: { name: string } | null }>(`/api/offices/${office!.id}/helpers/${h.id}`, { body: { approve } });
      notify(approve ? `${r.helper?.name ?? 'O ajudante'} começou a tarefa` : 'Pedido recusado');
    } catch (e) { notify((e as Error).message); }
    setBusy(null);
  };
  return (
    <div className="helper-requests">
      {pending.map((h) => {
        const who = workers.find((w) => w.id === h.workerId);
        const c = clients.find((x) => x.id === h.clientId);
        return (
          <div key={h.id} className="helper-request">
            <UserPlus size={16} />
            <div className="helper-text">
              <b>{who?.name ?? 'O funcionário'} pede um ajudante{!clientId && c ? <> · <button className="link" onClick={() => open('clientes', c.id)}>{c.name}</button></> : null}</b>
              <span>{h.task}</span>
              {h.reason && <small className="muted">Motivo: {h.reason}</small>}
            </div>
            <div className="row gap-s">
              <button className="ghost small" disabled={busy === h.id} onClick={() => decide(h, false)}><X size={13} /> Recusar</button>
              <button className="primary small" disabled={busy === h.id} onClick={() => decide(h, true)}><Check size={13} /> Permitir</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
