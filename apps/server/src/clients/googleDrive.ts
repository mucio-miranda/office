import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

/**
 * Office ligado à API do Google Drive, pela conta da agência. Serve para o que o Drive para computador não faz: pasta só
 * "compartilhada comigo" não aparece no H:. Com a API, o Office põe um atalho dela no Meu Drive ou copia de Drive para Drive,
 * sem baixar nada. Nunca apaga, move nem compartilha: só cria atalho, pasta e cópia.
 *
 * A credencial é do próprio dono (um app OAuth "para computador" no Google Cloud dele), guardada só nesta máquina.
 */

const FILE = () => path.join(config.dataDir, 'google-drive.json');
const SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

interface Saved { clientId?: string; clientSecret?: string; refreshToken?: string; email?: string }
let access: { token: string; until: number } | null = null;

const load = (): Saved => { try { return existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), 'utf8')) : {}; } catch { return {}; } };
const save = (s: Saved) => writeFileSync(FILE(), JSON.stringify(s, null, 1), { encoding: 'utf8', mode: 0o600 });

export function driveApiStatus() {
  const s = load();
  return { configurado: !!(s.clientId && s.clientSecret), conectado: !!s.refreshToken, conta: s.email ?? null };
}

export function setDriveApiClient(clientId: string, clientSecret: string) {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId.trim())) throw new Error('O ID do cliente termina em .apps.googleusercontent.com.');
  if (clientSecret.trim().length < 10) throw new Error('Cole a chave secreta do cliente.');
  access = null;
  save({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
}

export function disconnectDriveApi() {
  const s = load();
  access = null;
  save({ clientId: s.clientId, clientSecret: s.clientSecret });
}

// ---------------------------------------------------------------- login (OAuth de app para computador, com PKCE)

const pending = new Map<string, { verifier: string; redirect: string; at: number }>();
export const redirectUri = () => `http://127.0.0.1:${config.port}/api/google-drive/retorno`;

export function driveLoginUrl() {
  const s = load();
  if (!s.clientId) throw new Error('Cole antes o ID e a chave do cliente OAuth.');
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  pending.set(state, { verifier, redirect: redirectUri(), at: Date.now() });
  const q = new URLSearchParams({
    client_id: s.clientId, redirect_uri: redirectUri(), response_type: 'code', scope: `${SCOPE} email`, access_type: 'offline',
    prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function finishDriveLogin(code: string, state: string) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p) throw new Error('Login expirado. Clique em Conectar de novo no Office.');
  const s = load();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: s.clientId!, client_secret: s.clientSecret!, redirect_uri: p.redirect, grant_type: 'authorization_code', code_verifier: p.verifier }),
  });
  const j = await r.json() as { refresh_token?: string; access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!r.ok || !j.refresh_token) throw new Error(j.error_description ?? j.error ?? 'O Google não devolveu a autorização.');
  access = { token: j.access_token!, until: Date.now() + (j.expires_in ?? 3000) * 1000 - 60_000 };
  save({ ...s, refreshToken: j.refresh_token });
  const about = await call<{ user?: { emailAddress?: string } }>('GET', '/about?fields=user(emailAddress)');
  save({ ...load(), email: about.user?.emailAddress });
  return about.user?.emailAddress ?? '';
}

async function token() {
  if (access && Date.now() < access.until) return access.token;
  const s = load();
  if (!s.refreshToken) throw new Error('O Office não está ligado à API do Drive. O dono conecta em Equipe > Google Drive.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.clientId!, client_secret: s.clientSecret!, refresh_token: s.refreshToken, grant_type: 'refresh_token' }),
  });
  const j = await r.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) {
    if (j.error === 'invalid_grant') disconnectDriveApi();
    throw new Error(j.error === 'invalid_grant' ? 'A autorização do Google expirou ou foi revogada. O dono conecta de novo em Equipe > Google Drive.' : 'O Google recusou a autorização.');
  }
  access = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3000) * 1000 - 60_000 };
  return access.token;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const sep = url.includes('?') ? '&' : '?';
  const r = await fetch(`${API}${url}${sep}supportsAllDrives=true`, {
    method, headers: { authorization: `Bearer ${await token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({})) as T & { error?: { message?: string; code?: number } };
  if (!r.ok) {
    const msg = j.error?.message ?? `HTTP ${r.status}`;
    throw new Error(r.status === 404 ? `O Drive não achou o item (a conta ${load().email ?? ''} tem acesso a ele?)` : msg);
  }
  return j;
}

// ---------------------------------------------------------------- operações

export interface DriveItem { id: string; name: string; mimeType: string; size?: string; shortcutDetails?: { targetId: string } }
const FIELDS = 'id,name,mimeType,size,shortcutDetails';
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const driveItem = (id: string) => call<DriveItem>('GET', `/files/${encodeURIComponent(id)}?fields=${FIELDS}`);

async function children(folderId: string) {
  const out: DriveItem[] = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({ q: `'${q(folderId)}' in parents and trashed = false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', includeItemsFromAllDrives: 'true' });
    if (pageToken) p.set('pageToken', pageToken);
    const r = await call<{ files: DriveItem[]; nextPageToken?: string }>('GET', `/files?${p}`);
    out.push(...r.files);
    pageToken = r.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Atalho do item dentro da pasta (no Meu Drive), para ele aparecer no H:. Se já houver um atalho igual ali, devolve esse. */
export async function makeShortcut(targetId: string, parentId: string) {
  const target = await driveItem(targetId);
  const real = target.shortcutDetails?.targetId ?? target.id;
  const there = (await children(parentId)).find((c) => c.mimeType === SHORTCUT && c.shortcutDetails?.targetId === real);
  if (there) return { criado: false, id: there.id, nome: there.name };
  const r = await call<DriveItem>('POST', `/files?fields=${FIELDS}`, { name: target.name, mimeType: SHORTCUT, shortcutDetails: { targetId: real }, parents: [parentId] });
  return { criado: true, id: r.id, nome: r.name };
}

export interface DriveCopy { id: string; jobId: string; source: string; done: boolean; copied: number; skipped: string[]; bytes: number; folders: number; error: string | null; startedAt: number; name: string }
const copies = new Map<string, DriveCopy>();
export const getDriveCopy = (id: string, jobId: string) => { const c = copies.get(id); return c && c.jobId === jobId ? c : undefined; };

/**
 * Copia o item (arquivo ou pasta inteira) para dentro da pasta de destino, de Drive para Drive. Nunca sobrescreve: o que já
 * existe no destino com o mesmo nome fica como está e entra na lista de pulados. Pasta que já existe é aproveitada.
 */
export function startDriveCopy(jobId: string, sourceId: string, destId: string) {
  const id = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const c: DriveCopy = { id, jobId, source: sourceId, done: false, copied: 0, skipped: [], bytes: 0, folders: 0, error: null, startedAt: Date.now(), name: '' };
  copies.set(id, c);
  const copyInto = async (item: DriveItem, parent: string, where: string, existing?: DriveItem[]): Promise<void> => {
    const here = existing ?? await children(parent);
    if (item.mimeType === SHORTCUT) { c.skipped.push(`${where}${item.name} (atalho)`); return; }
    const same = here.find((h) => h.name === item.name && (h.mimeType === FOLDER) === (item.mimeType === FOLDER));
    if (item.mimeType === FOLDER) {
      const folder = same ?? await call<DriveItem>('POST', `/files?fields=${FIELDS}`, { name: item.name, mimeType: FOLDER, parents: [parent] });
      if (!same) c.folders++;
      const inside = same ? await children(folder.id) : [];
      for (const k of await children(item.id)) await copyInto(k, folder.id, `${where}${item.name}/`, inside);
      return;
    }
    if (same) { c.skipped.push(`${where}${item.name}`); return; }
    await call('POST', `/files/${encodeURIComponent(item.id)}/copy?fields=id`, { name: item.name, parents: [parent] });
    c.copied++;
    c.bytes += Number(item.size ?? 0);
  };
  void (async () => {
    try {
      const src = await driveItem(sourceId);
      const real = src.shortcutDetails ? await driveItem(src.shortcutDetails.targetId) : src;
      c.name = real.name;
      const dest = await driveItem(destId);
      if (dest.mimeType !== FOLDER) throw new Error('O destino precisa ser uma pasta.');
      await copyInto(real, destId, '');
    } catch (e) { c.error = (e as Error).message; }
    c.done = true;
  })();
  return c;
}

const mb = (n: number) => `${(n / 1e6).toFixed(1).replace('.', ',')} MB`;
export function driveCopyStatus(c: DriveCopy) {
  const base = { id: c.id, copiados: c.copied, pastas_criadas: c.folders, tamanho: mb(c.bytes), pulados: c.skipped.slice(0, 50), total_pulados: c.skipped.length };
  if (c.error) return { ...base, pronto: false, erro: true, texto: `A cópia parou: ${c.error}. O que já foi copiado fica; repetir pula o que já existe.` };
  if (c.done) return { ...base, pronto: true, texto: `Pronto: ${c.copied} arquivo(s), ${mb(c.bytes)}, de "${c.name}". ${c.skipped.length ? `${c.skipped.length} já existiam e ficaram como estavam.` : ''} No H: aparece em alguns segundos.` };
  return { ...base, pronto: false, texto: `Copiando "${c.name}": ${c.copied} arquivo(s) até agora. Chame drive_copia_status com este id para esperar mais.` };
}

export async function waitDriveCopy(c: DriveCopy, ms = 240_000) {
  const end = Date.now() + ms;
  while (!c.done && Date.now() < end) await new Promise((r) => setTimeout(r, 2000));
  return driveCopyStatus(c);
}
