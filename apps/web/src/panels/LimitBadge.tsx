import { useStore } from '../lib/store';

/** Limite da assinatura do Claude: a equipe usa o plano, não a API, então o que importa é o quanto da semana já foi. */
export const pctOf = (v?: number | null) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

export const resetText = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

/** Janela de 5 h com a hora em que renova ("12% até 14h30", com o dia se for outro dia). Se já renovou, o número é velho. */
const fiveHourText = (v?: number | null, iso?: string | null) => {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return `5 h ${pctOf(v)}`;
  if (t.getTime() <= Date.now()) return '5 h renovou';
  const hm = t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  const day = t.toDateString() === new Date().toDateString() ? '' : `${t.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} `;
  return `5 h ${pctOf(v)} até ${day}${hm}`;
};

export function LimitBadge() {
  const limite = useStore((s) => s.limite);
  if (limite?.sevenDay == null) return null;
  const high = limite.sevenDay >= 0.8;
  return (
    <span className={`muted small mono ${high ? 'ctx-high' : ''}`}
      title={`Limite da assinatura do Claude. Semana: ${pctOf(limite.sevenDay)} usado, renova ${resetText(limite.sevenDayResets)}. Janela de 5 h: ${pctOf(limite.fiveHour)}, renova ${resetText(limite.fiveHourResets)}.`}>
      semana {pctOf(limite.sevenDay)} · {fiveHourText(limite.fiveHour, limite.fiveHourResets)}
    </span>
  );
}
