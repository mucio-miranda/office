import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { hostname } from 'node:os';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@office/shared';
import { db, one, now } from './db.ts';

export const MIN_PIN = 8;
const SESSION_DAYS = 30;
const RESET_HOURS = 24;

export function hashPin(pin: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function checkPin(pin: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pin, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** O banco guarda só o hash: quem ler uma cópia dele não consegue usar as sessões. */
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(userId: string) {
  const token = randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(digest(token), userId, now(), expires);
  return token;
}

export function userFromToken(token: string | undefined) {
  if (!token) return undefined;
  return one<User>(
    'SELECT u.id, u.name, u.color, u.must_change_pin, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?',
    digest(token), now(),
  );
}

export const revokeSession = (token: string) => db.prepare('DELETE FROM sessions WHERE token = ?').run(digest(token));

/** Encerra as sessões da pessoa; `except` mantém a do aparelho que pediu. */
export function revokeSessions(userId: string, except?: string) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, except ? digest(except) : '');
}

export const purgeSessions = () => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());

// ---------------- redefinição de senha ----------------

/** Código de uso único que o dono passa para a pessoa; vale 24 h e o banco guarda só o hash. */
export function createResetCode(userId: string) {
  const code = randomBytes(6).toString('hex').toUpperCase();
  const expires = new Date(Date.now() + RESET_HOURS * 3_600_000).toISOString();
  db.prepare('INSERT INTO pin_resets (user_id, code_hash, expires_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at')
    .run(userId, digest(code), expires);
  return code;
}

export function checkResetCode(userId: string, code: string) {
  return !!one('SELECT user_id FROM pin_resets WHERE user_id = ? AND code_hash = ? AND expires_at > ?', userId, digest(code.trim().toUpperCase()), now());
}

export function setPin(userId: string, pin: string) {
  db.prepare('UPDATE users SET pin_hash = ?, must_change_pin = 0 WHERE id = ?').run(hashPin(pin), userId);
  db.prepare('DELETE FROM pin_resets WHERE user_id = ?').run(userId);
}

// ---------------- tentativas erradas ----------------

const WINDOW_MS = 15 * 60_000;
const fails = new Map<string, { n: number; until: number }>();
const limitOf = (key: string) => (key.startsWith('ip:') ? 30 : 5);

/** Chaves de contagem: o endereço e a combinação nome + endereço (assim um estranho não trava a conta de alguém). */
export const attemptKeys = (req: FastifyRequest, name?: string) => {
  const ip = clientIp(req);
  return [`ip:${ip}`, ...(name ? [`nome:${name.toLowerCase()}@${ip}`] : [])];
};

export function blocked(keys: string[]) {
  const t = Date.now();
  return keys.some((k) => {
    const f = fails.get(k);
    if (f && f.until <= t) fails.delete(k);
    return !!f && f.until > t && f.n >= limitOf(k);
  });
}

export function noteFail(keys: string[]) {
  const t = Date.now();
  for (const k of keys) {
    const f = fails.get(k);
    fails.set(k, { n: f && f.until > t ? f.n + 1 : 1, until: t + WINDOW_MS });
  }
}

/** O contador do endereço só zera sozinho: entrar na própria conta não libera mais tentativas nas outras. */
export const clearFails = (keys: string[]) => { for (const k of keys) if (!k.startsWith('ip:')) fails.delete(k); };

export const resetAttempts = () => fails.clear();

// ---------------- origem da requisição ----------------

const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

export function clientIp(req: FastifyRequest) {
  const socketIp = req.socket.remoteAddress ?? '';
  // atrás do proxy do Vite (dev) a conexão vem de 127.0.0.1; o IP real chega no X-Forwarded-For
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return LOOPBACK.includes(socketIp) && fwd ? fwd : socketIp;
}

/** Quem está no próprio computador que roda o Office. */
export const isLocal = (req: FastifyRequest) => LOOPBACK.includes(clientIp(req));

/**
 * Só atende por endereço IP, pelo nome desta máquina ou por nomes da VPN. Sem isso, um site malicioso aberto
 * neste computador poderia apontar o próprio domínio para 127.0.0.1 (DNS rebinding) e falar com o Office como se fosse local.
 */
export function hostAllowed(header: string | undefined) {
  if (!header) return false;
  const h = header.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  const me = hostname().toLowerCase();
  const extra = (process.env.OFFICE_HOSTS ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return isIP(h) !== 0 || h === 'localhost' || h === me || h === `${me}.local` || h.endsWith('.netbird.cloud') || extra.includes(h);
}

export async function guardHost(req: FastifyRequest, reply: FastifyReply) {
  if (!hostAllowed(req.headers.host)) return reply.code(403).send({ error: 'Endereço não permitido.' });
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-Content-Type-Options', 'nosniff');
}

// ---------------- sessão e papéis ----------------

export function membership(officeId: string, userId: string) {
  return one<{ role: string }>('SELECT role FROM office_members WHERE office_id = ? AND user_id = ?', officeId, userId);
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
    token: string;
  }
}

export const SESSION_COOKIE = 'office_session';

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * SESSION_DAYS}`;
}

function cookieToken(req: FastifyRequest) {
  const m = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m?.[1];
}

/** O que continua liberado para quem ainda precisa trocar a senha. */
const WHILE_CHANGING_PIN = ['/api/me', '/api/auth/senha', '/api/auth/sair'];

/**
 * preHandler: exige sessão válida. Aceita `Authorization: Bearer <token>` (chamadas da UI)
 * ou o cookie de sessão (necessário para <video>/<img>, que não mandam cabeçalho).
 */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : cookieToken(req);
  const user = userFromToken(token);
  if (!user) return reply.code(401).send({ error: 'Faça login de novo.' });
  if (user.mustChangePin && !WHILE_CHANGING_PIN.includes(req.url.split('?')[0])) return reply.code(403).send({ error: 'Troque sua senha para continuar.' });
  req.user = user;
  req.token = token!;
}

/** Garante que o usuário é membro do escritório da rota (:officeId). */
export function requireMember(req: FastifyRequest, reply: FastifyReply) {
  const { officeId } = req.params as { officeId?: string };
  if (!officeId || !membership(officeId, req.user.id)) {
    reply.code(403).send({ error: 'Você não faz parte deste escritório.' });
    return false;
  }
  return true;
}

/** Para o que mexe em pastas, permissões e contas: só o dono do escritório da rota. */
export function requireOwner(req: FastifyRequest, reply: FastifyReply) {
  const { officeId } = req.params as { officeId?: string };
  if (!officeId || membership(officeId, req.user.id)?.role !== 'dono') {
    reply.code(403).send({ error: 'Só o dono do escritório pode fazer isso.' });
    return false;
  }
  return true;
}
