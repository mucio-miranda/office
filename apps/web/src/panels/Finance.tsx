import { useEffect, useState } from 'react';
import type { Client, Transaction } from '@office/shared';
import { useStore } from '../lib/store';
import { api, brl } from '../lib/api';

interface Metrics {
  month: string;
  demandsByStatus: Record<string, number>;
  overdue: number;
  deliveredThisMonth: number;
  mrr: number;
  activeClients: number;
  revenueMonth: number;
  expenseMonth: number;
  profitMonth: number;
  receivablePending: number;
  aiCostMonth: number;
  hoursByClient: { client: string; hours: number }[];
  cashflow: { month: string; receita: number; despesa: number }[];
}

export function Finance() {
  const { office, clients, transactions, agents, open, notify } = useStore();
  const [m, setM] = useState<Metrics | null>(null);
  const [tab, setTab] = useState<'resumo' | 'clientes' | 'lancamentos'>('resumo');
  const base = `/api/offices/${office!.id}`;
  useEffect(() => { api(`${base}/metrics`).then(setM); }, [transactions, clients, base]);

  const askManager = async () => {
    const rafa = agents.find((a) => a.slug === 'gerente');
    if (!rafa) return;
    await api(`${base}/jobs`, { body: { agentId: rafa.id, prompt: 'Faça a análise financeira e operacional do mês: margem por cliente, inadimplência, demandas paradas ou atrasadas, e 3 ações prioritárias para esta semana.' } });
    notify(`📊 ${rafa.name} está analisando os números`);
    open('agente', rafa.id);
  };

  return (
    <div>
      <div className="tabs">
        {(['resumo', 'clientes', 'lancamentos'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{{ resumo: 'Resumo', clientes: 'Clientes', lancamentos: 'Lançamentos' }[t]}</button>
        ))}
        <span className="spacer" />
        <button className="primary" onClick={askManager}>📊 Pedir análise ao gerente</button>
      </div>

      {tab === 'resumo' && m && (
        <>
          <div className="kpis">
            <Kpi label="Recorrência (MRR)" value={brl(m.mrr)} hint={`${m.activeClients} clientes ativos`} />
            <Kpi label="Receita do mês" value={brl(m.revenueMonth)} />
            <Kpi label="Despesas do mês" value={brl(m.expenseMonth)} />
            <Kpi label="Resultado do mês" value={brl(m.profitMonth)} tone={m.profitMonth >= 0 ? 'good' : 'bad'} />
            <Kpi label="A receber" value={brl(m.receivablePending)} />
            <Kpi label="Custo de IA no mês" value={`US$ ${m.aiCostMonth.toFixed(2)}`} hint="estimativa do Claude Code" />
            <Kpi label="Entregues no mês" value={String(m.deliveredThisMonth)} />
            <Kpi label="Demandas atrasadas" value={String(m.overdue)} tone={m.overdue ? 'bad' : 'good'} />
          </div>
          <div className="grid2">
            <div className="card">
              <h4>Fluxo de caixa (6 meses)</h4>
              <Bars rows={[...m.cashflow].reverse()} />
            </div>
            <div className="card">
              <h4>Horas por cliente</h4>
              {m.hoursByClient.length === 0 && <p className="muted small">Use o ▶ nos cartões de demanda para contar horas.</p>}
              {m.hoursByClient.map((h) => {
                const max = Math.max(...m.hoursByClient.map((x) => x.hours), 1);
                return (
                  <div key={h.client} className="hbar">
                    <span>{h.client}</span>
                    <div><i style={{ width: `${(h.hours / max) * 100}%` }} /></div>
                    <b>{h.hours}h</b>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {tab === 'clientes' && <Clients clients={clients} base={base} />}
      {tab === 'lancamentos' && <Transactions transactions={transactions} clients={clients} base={base} />}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <small>{label}</small>
      <b>{value}</b>
      {hint && <span>{hint}</span>}
    </div>
  );
}

function Bars({ rows }: { rows: { month: string; receita: number; despesa: number }[] }) {
  if (!rows.length) return <p className="muted small">Sem lançamentos ainda.</p>;
  const max = Math.max(...rows.flatMap((r) => [r.receita, r.despesa]), 1);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.month} className="bar-group" title={`${r.month}: receita ${brl(r.receita)} · despesa ${brl(r.despesa)}`}>
          <div className="bar-pair">
            <i className="rec" style={{ height: `${(r.receita / max) * 100}%` }} />
            <i className="desp" style={{ height: `${(r.despesa / max) * 100}%` }} />
          </div>
          <small>{r.month.slice(5)}/{r.month.slice(2, 4)}</small>
        </div>
      ))}
      <div className="legend"><span><i className="rec" /> receita</span><span><i className="desp" /> despesa</span></div>
    </div>
  );
}

function Clients({ clients, base }: { clients: Client[]; base: string }) {
  const [f, setF] = useState({ name: '', folder: '', monthlyFee: '' });
  return (
    <div>
      <form className="row gap wrap" onSubmit={async (e) => {
        e.preventDefault();
        await api(`${base}/clients`, { body: { name: f.name, folder: f.folder || null, monthlyFee: Number(f.monthlyFee || 0) } });
        setF({ name: '', folder: '', monthlyFee: '' });
      }}>
        <input required placeholder="Nome do cliente" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input placeholder="Pasta (ex.: CLIENTES\BOLO DE MAE)" value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })} />
        <input type="number" min="0" step="0.01" placeholder="Mensalidade R$" value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value })} />
        <button className="primary">Adicionar</button>
      </form>
      <table className="table">
        <thead><tr><th>Cliente</th><th>Pasta</th><th>Mensalidade</th><th>Status</th></tr></thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td><span className="dot" style={{ background: c.color }} /> {c.name}</td>
              <td className="muted small">{c.folder ?? '—'}</td>
              <td><input className="inline" type="number" defaultValue={c.monthlyFee} onBlur={(e) => api(`${base}/clients/${c.id}`, { method: 'PATCH', body: { monthlyFee: Number(e.target.value) } })} /></td>
              <td><select value={c.status} onChange={(e) => api(`${base}/clients/${c.id}`, { method: 'PATCH', body: { status: e.target.value } })}>
                <option>ativo</option><option>pausado</option><option>encerrado</option></select></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Transactions({ transactions, clients, base }: { transactions: Transaction[]; clients: Client[]; base: string }) {
  const empty = { kind: 'receita' as Transaction['kind'], category: 'Mensalidade', description: '', amount: '', date: new Date().toISOString().slice(0, 10), clientId: '', paid: true };
  const [f, setF] = useState(empty);
  return (
    <div>
      <form className="row gap wrap" onSubmit={async (e) => {
        e.preventDefault();
        await api(`${base}/transactions`, { body: { ...f, amount: Number(f.amount), clientId: f.clientId || null } });
        setF({ ...empty, kind: f.kind });
      }}>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Transaction['kind'] })}><option value="receita">Receita</option><option value="despesa">Despesa</option></select>
        <input required placeholder="Categoria" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <input placeholder="Descrição" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <input required type="number" min="0.01" step="0.01" placeholder="Valor" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}><option value="">Sem cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <label className="check"><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> pago</label>
        <button className="primary">Lançar</button>
      </form>
      <table className="table">
        <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Cliente</th><th>Valor</th><th>Pago</th></tr></thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td>{t.date.split('-').reverse().join('/')}</td>
              <td>{t.kind === 'receita' ? '⬆️' : '⬇️'}</td>
              <td>{t.category}</td>
              <td className="muted">{t.description}</td>
              <td>{clients.find((c) => c.id === t.clientId)?.name ?? '—'}</td>
              <td className={t.kind === 'receita' ? 'pos' : 'neg'}>{brl(t.amount)}</td>
              <td><input type="checkbox" checked={t.paid} onChange={(e) => api(`${base}/transactions/${t.id}`, { method: 'PATCH', body: { paid: e.target.checked } })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
