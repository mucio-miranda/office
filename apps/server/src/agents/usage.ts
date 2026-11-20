import { all, db, now, one } from '../db.ts';

/**
 * Limite da assinatura do Claude (Pro/Max): o quanto já foi usado da janela de 5 horas e da semana. O próprio Claude
 * Code informa a cada rodada (evento `rate_limit_event` do stream), então não precisa de chave nem de chamada extra.
 * Quem usa a assinatura, e não a API, não paga por token: o número que importa é esse, não o custo em dólar.
 */

export interface UsageNow {
  at: string;
  /** fração usada (0 a 1) */
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResets: string | null;
  sevenDayResets: string | null;
}

const iso = (s: unknown) => (typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null);
const frac = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);

/** Guarda a leitura nova se mudou (ou a cada 30 min, para o histórico do dia). Devolve a leitura. */
export function recordUsage(info: any): UsageNow | null {
  const w = info?.unifiedWindows;
  if (!w) return null;
  const u: UsageNow = {
    at: now(),
    fiveHour: frac(w.five_hour?.utilization), sevenDay: frac(w.seven_day?.utilization),
    fiveHourResets: iso(w.five_hour?.resetsAt), sevenDayResets: iso(w.seven_day?.resetsAt),
  };
  if (u.fiveHour === null && u.sevenDay === null) return null;
  const last = latestUsage();
  const same = last && last.fiveHour === u.fiveHour && last.sevenDay === u.sevenDay && last.sevenDayResets === u.sevenDayResets;
  if (!same || Date.parse(u.at) - Date.parse(last!.at) > 30 * 60_000) {
    db.prepare('INSERT INTO usage_snapshots (at, five_hour, seven_day, five_hour_resets, seven_day_resets) VALUES (?, ?, ?, ?, ?)')
      .run(u.at, u.fiveHour, u.sevenDay, u.fiveHourResets, u.sevenDayResets);
  }
  return u;
}

const row = (r: any): UsageNow => ({ at: r.at, fiveHour: r.fiveHour, sevenDay: r.sevenDay, fiveHourResets: r.fiveHourResets, sevenDayResets: r.sevenDayResets });

export function latestUsage(): UsageNow | null {
  const r = one<any>('SELECT * FROM usage_snapshots ORDER BY at DESC LIMIT 1');
  return r ? row(r) : null;
}

/** Leituras de um intervalo (o dia do daily report), da mais velha para a mais nova. */
export function usageBetween(fromIso: string, toIso: string): UsageNow[] {
  return all<any>('SELECT * FROM usage_snapshots WHERE at >= ? AND at < ? ORDER BY at', fromIso, toIso).map(row);
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '?' : `${Math.round(v * 100)}%`);
