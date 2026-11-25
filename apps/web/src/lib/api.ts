const TOKEN_KEY = 'office.token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t: string | null) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* modo privado */ }
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // sessão vencida ou encerrada: volta para a tela de entrada
  if (res.status === 401 && token && !path.startsWith('/api/auth/')) {
    setToken(null);
    location.reload();
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`);
  return data as T;
}

export const mediaUrl = (officeId: string, file: string) => `/api/offices/${officeId}/media?path=${encodeURIComponent(file)}`;

/** Print da janela de um app ao vivo; `big` pede prints mais frequentes enquanto alguém assiste. */
export const liveFrameUrl = (officeId: string, id: string, big: boolean) =>
  `/api/offices/${officeId}/live/${id}/frame?${big ? 'big=1&' : ''}t=${Date.now()}`;

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/**
 * Valor em reais digitado do jeito brasileiro ("1.500,50", "1500,5", "R$ 800") ou com ponto decimal ("1500.50").
 * Campo de dinheiro é texto com teclado numérico, não `type="number"`: as setinhas de +1 não fazem sentido para valor.
 */
export function parseMoney(s: string | number | null | undefined) {
  if (typeof s === 'number') return s;
  const t = String(s ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  // "1.500" sem vírgula é mil e quinhentos (ponto de milhar), não 1,5
  const n = Number(t.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
}
/** O valor no campo de dinheiro: 1500.5 vira "1.500,50"; zero fica vazio para não atrapalhar a digitação. */
export const moneyText = (v: number) => (v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
/** Cliente que não aparece em listas de dinheiro: encerrado (inclui o que foi unificado em outro). */
export const isClosedClient = (c: { status?: string; name: string }) => c.status === 'encerrado' || /\(unificado em /i.test(c.name);

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}
