import type { WebSocket } from 'ws';
import type { ClientMsg, Presence, ServerMsg } from '@office/shared';
import { membership, userFromToken } from './auth.ts';

interface Conn {
  ws: WebSocket;
  officeId: string;
  presence: Presence;
}

const conns = new Set<Conn>();

export function broadcast(officeId: string, msg: ServerMsg, except?: Conn) {
  const data = JSON.stringify(msg);
  for (const c of conns) if (c.officeId === officeId && c !== except && c.ws.readyState === 1) c.ws.send(data);
}

export const invalidate = (officeId: string, what: Extract<ServerMsg, { t: 'invalidate' }>['what']) =>
  broadcast(officeId, { t: 'invalidate', what });

export function onlineUsers(officeId: string) {
  return [...conns].filter((c) => c.officeId === officeId).map((c) => c.presence);
}

/** Ponto de entrada de cada aba aberta. A primeira mensagem precisa ser `join`. */
export function handleSocket(ws: WebSocket) {
  let conn: Conn | null = null;
  const send = (m: ServerMsg) => ws.readyState === 1 && ws.send(JSON.stringify(m));

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!conn) {
      if (msg.t !== 'join') return;
      const user = userFromToken(msg.token);
      if (!user || !membership(msg.officeId, user.id)) return ws.close(4003, 'sem acesso');
      // mesma pessoa em outra aba: a aba antiga sai
      for (const c of conns) if (c.officeId === msg.officeId && c.presence.userId === user.id) c.ws.close(4000, 'aberto em outra aba');
      conn = {
        ws,
        officeId: msg.officeId,
        presence: { userId: user.id, name: user.name, color: user.color, pos: { x: 0, z: 9 }, dir: Math.PI, moving: false, room: 'recepcao', status: 'disponivel' },
      };
      conns.add(conn);
      send({ t: 'welcome', you: user.id, presences: onlineUsers(msg.officeId) });
      broadcast(conn.officeId, { t: 'presence', presence: conn.presence }, conn);
      return;
    }
    const c = conn;
    switch (msg.t) {
      case 'move':
        Object.assign(c.presence, { pos: msg.pos, dir: msg.dir, moving: msg.moving, seated: !!msg.seated, room: msg.room });
        broadcast(c.officeId, { t: 'presence', presence: c.presence }, c);
        break;
      case 'status':
        c.presence.status = msg.status;
        broadcast(c.officeId, { t: 'presence', presence: c.presence });
        break;
      case 'chat':
        if (msg.text.trim())
          broadcast(c.officeId, { t: 'chat', from: c.presence.userId, name: c.presence.name, text: msg.text.slice(0, 2000), room: msg.room, at: new Date().toISOString() });
        break;
      case 'emote':
        broadcast(c.officeId, { t: 'emote', from: c.presence.userId, emoji: msg.emoji.slice(0, 8) });
        break;
    }
  });

  ws.on('close', () => {
    if (!conn) return;
    conns.delete(conn);
    broadcast(conn.officeId, { t: 'leave', userId: conn.presence.userId });
  });
}
