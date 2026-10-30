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

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}
