import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@office/shared';
import { db, one, now } from './db.ts';

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

export function createSession(userId: string) {
  const token = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now());
  return token;
}

export function userFromToken(token: string | undefined) {
  if (!token) return undefined;
  return one<User>('SELECT u.id, u.name, u.color, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', token);
}

export function membership(officeId: string, userId: string) {
  return one<{ role: string }>('SELECT role FROM office_members WHERE office_id = ? AND user_id = ?', officeId, userId);
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

export const SESSION_COOKIE = 'office_session';

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 90}`;
}

function cookieToken(req: FastifyRequest) {
  const m = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return m?.[1];
}

/**
 * preHandler: exige sessão válida. Aceita `Authorization: Bearer <token>` (chamadas da UI)
 * ou o cookie de sessão (necessário para <video>/<img>, que não mandam cabeçalho).
 */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  const user = userFromToken(h?.startsWith('Bearer ') ? h.slice(7) : cookieToken(req));
  if (!user) return reply.code(401).send({ error: 'Faça login de novo.' });
  req.user = user;
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
