import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'office.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const MIGRATIONS: string[] = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT NOT NULL,
     pin_hash TEXT, created_at TEXT NOT NULL);
   CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
   CREATE TABLE offices (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL, extra_dirs TEXT NOT NULL DEFAULT '[]',
     theme TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
   CREATE TABLE office_members (
     office_id TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL, PRIMARY KEY (office_id, user_id));
   CREATE TABLE clients (
     id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
     name TEXT NOT NULL, folder TEXT, monthly_fee REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ativo', color TEXT NOT NULL);
   CREATE TABLE demands (
     id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
     client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, assignee TEXT, due_date TEXT,
     tracked_seconds INTEGER NOT NULL DEFAULT 0, timer_started_at TEXT, position REAL NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE events (
     id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
     title TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL, kind TEXT NOT NULL,
     client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, demand_id TEXT REFERENCES demands(id) ON DELETE SET NULL, room TEXT);
   CREATE TABLE transactions (
     id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
     client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, kind TEXT NOT NULL, category TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '', amount REAL NOT NULL, date TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE agents (
     id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
     slug TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, room TEXT NOT NULL, color TEXT NOT NULL,
     skills TEXT NOT NULL, tools TEXT NOT NULL, persona TEXT NOT NULL, allowed_tools TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'livre', UNIQUE (office_id, slug));
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
     agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, demand_id TEXT REFERENCES demands(id) ON DELETE SET NULL,
     prompt TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT, cost_usd REAL NOT NULL DEFAULT 0,
     created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE job_messages (
     id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
     role TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE timelines (
     id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
     demand_id TEXT REFERENCES demands(id) ON DELETE SET NULL, name TEXT NOT NULL, json TEXT NOT NULL,
     base_dir TEXT NOT NULL, output TEXT, render_status TEXT, updated_at TEXT NOT NULL);
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT, office_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
   CREATE INDEX demands_office ON demands(office_id, status);
   CREATE INDEX jobs_office ON jobs(office_id, status);
   CREATE INDEX job_messages_job ON job_messages(job_id, created_at);`,
  // v0.2.5: mesa própria por pessoa (uma mesa tem um dono só por escritório)
  `ALTER TABLE office_members ADD COLUMN desk TEXT;
   CREATE UNIQUE INDEX office_members_desk ON office_members(office_id, desk) WHERE desk IS NOT NULL;`,
  // v0.3.0: ferramentas criativas (servidores MCP) por funcionário
  `ALTER TABLE agents ADD COLUMN mcp TEXT NOT NULL DEFAULT '[]';`,
  // v0.3.1: ferramentas que o funcionário usa ao vivo (o app abre na tela)
  `ALTER TABLE agents ADD COLUMN live TEXT NOT NULL DEFAULT '[]';
   UPDATE agents SET live = '["photocraft"]' WHERE slug = 'designer';
   UPDATE agents SET live = '["filmcraft"]' WHERE slug = 'editor-de-video';`,
  // v0.3.4: decoração do mapa editável (sem linha = decoração padrão)
  `CREATE TABLE office_layout (
     office_id TEXT PRIMARY KEY REFERENCES offices(id) ON DELETE CASCADE,
     json TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL);`,
];

db.exec('CREATE TABLE IF NOT EXISTS _migrations (n INTEGER PRIMARY KEY)');
const done = (db.prepare('SELECT COALESCE(MAX(n), 0) AS n FROM _migrations').get() as { n: number }).n;
MIGRATIONS.slice(done).forEach((sql, i) => {
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (n) VALUES (?)').run(done + i + 1);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

export const now = () => new Date().toISOString();

type Row = Record<string, unknown>;
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Colunas guardadas como JSON e booleanos guardados como 0/1. */
const JSON_COLS = new Set(['extra_dirs', 'theme', 'skills', 'tools', 'allowed_tools', 'mcp', 'live', 'json']);
const BOOL_COLS = new Set(['paid']);

export function fromRow<T>(row: Row | undefined): T | undefined {
  if (!row) return undefined;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[camel(k)] = JSON_COLS.has(k) && typeof v === 'string' ? JSON.parse(v) : BOOL_COLS.has(k) ? !!v : v;
  }
  return out as T;
}

function toCols(obj: Row) {
  const cols: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const c = snake(k);
    cols.push(c === 'end' ? '"end"' : c);
    vals.push(JSON_COLS.has(c) ? JSON.stringify(v) : typeof v === 'boolean' ? Number(v) : (v as string | number | null));
  }
  return { cols, vals };
}

export function insert(table: string, obj: Row) {
  const { cols, vals } = toCols(obj);
  db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
}

export function update(table: string, id: string, patch: Row) {
  const { cols, vals } = toCols(patch);
  if (!cols.length) return;
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
}

export function all<T>(sql: string, ...params: (string | number | null)[]): T[] {
  return (db.prepare(sql).all(...params) as Row[]).map((r) => fromRow<T>(r)!);
}

export function one<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
  return fromRow<T>(db.prepare(sql).get(...params) as Row | undefined);
}

export function logActivity(officeId: string, actor: string, action: string, detail = '') {
  db.prepare('INSERT INTO activity (office_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)').run(officeId, actor, action, detail, now());
}
