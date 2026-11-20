import { useStore } from '../lib/store';

/** Limite da assinatura do Claude: a equipe usa o plano, não a API, então o que importa é o quanto da semana já foi. */
export const pctOf = (v?: number | null) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

export const resetText = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function LimitBadge() {
  const limite = useStore((s) => s.limite);
  if (limite?.sevenDay == null) return null;
  const high = limite.sevenDay >= 0.8;
  return (
    <span className={`muted small mono ${high ? 'ctx-high' : ''}`}
      title={`Limite da assinatura do Claude. Semana: ${pctOf(limite.sevenDay)} usado, renova ${resetText(limite.sevenDayResets)}. Janela de 5 h: ${pctOf(limite.fiveHour)}, renova ${resetText(limite.fiveHourResets)}.`}>
      semana {pctOf(limite.sevenDay)} · 5 h {pctOf(limite.fiveHour)}
    </span>
  );
}
