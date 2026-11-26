/**
 * Limite de 5 h da assinatura: quando o Claude Code para com "You've hit your 5-hour limit · resets 9:20pm", o pedido não
 * vira erro. Ele volta sozinho quando a janela renova (mais 2 min de folga). O limite da semana não entra aqui: esperar
 * dias não faz sentido sem alguém decidir.
 */

const HIT = /hit your (?:5-hour|session) limit/i;
const MARGIN = 2 * 60_000;
export const MAX_LIMIT_RETRIES = 3;

export const hitFiveHourLimit = (text: string) => HIT.test(text);

/** Próxima vez que o relógio marca "9:20pm" (no fuso deste computador) depois de `from`. */
function nextClock(text: string, from: number): number | null {
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  const t = new Date(from);
  t.setHours(h, Number(m[2] ?? 0), 0, 0);
  if (t.getTime() <= from) t.setDate(t.getDate() + 1);
  return t.getTime();
}

/** Quando tentar de novo: a renovação que o Claude Code informou por último; senão a hora da mensagem; senão em 1 h. */
export function retryAt(text: string, fiveHourResets: string | null | undefined, from = Date.now()): number {
  const known = fiveHourResets ? Date.parse(fiveHourResets) : NaN;
  const base = Number.isFinite(known) && known > from ? known : nextClock(text, from) ?? from + 60 * 60_000;
  return base + MARGIN;
}

export const clockText = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
