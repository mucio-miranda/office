import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Link do Drive de um arquivo que está na pasta do Drive montada no computador. O Google Drive para computador guarda
 * localmente, num banco SQLite por conta, o código de cada arquivo no Drive: com ele o link sai sem login nem API.
 * Só leitura: o banco é aberto em modo somente leitura e nunca é alterado.
 *
 * Enquanto o arquivo ainda está subindo, o código é provisório (`local-123`) e o link fica para depois.
 */

/** Pastas de dados do Drive para computador, no Windows e no Mac. */
const DRIVEFS_DIRS = [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'DriveFS'),
  path.join(homedir(), 'Library', 'Application Support', 'Google', 'DriveFS'),
].filter(Boolean) as string[];

/** Bancos de metadados de cada conta conectada ao Drive para computador. */
export function driveMetadataDbs(dirs = DRIVEFS_DIRS) {
  const out: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const db = path.join(dir, e.name, 'metadata_sqlite_db');
      if (e.isDirectory() && /^\d+$/.test(e.name) && existsSync(db)) out.push(db);
    }
  }
  return out;
}

const REAL_ID = /^[A-Za-z0-9_-]{20,}$/;
const norm = (s: string) => s.normalize('NFC');

interface Row { id: string; stableId: number }

/**
 * Código do arquivo no Drive, conferindo o nome e as duas pastas acima, para não confundir dois
 * arquivos com o mesmo nome em pastas diferentes. Sem achar ou ainda subindo, devolve null.
 */
export function driveFileId(file: string, dbs = driveMetadataDbs(), folder = false): string | null {
  const parts = path.resolve(file).split(/[\\/]+/).filter(Boolean).map(norm);
  const name = parts.at(-1);
  if (!name) return null;
  const wantParents = parts.slice(0, -1).reverse().slice(0, 2);
  for (const file of dbs) {
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const rows = db.prepare('SELECT id, stable_id AS stableId FROM items WHERE local_title = ? AND is_folder = ? AND trashed = 0 AND is_tombstone = 0').all(name, folder ? 1 : 0) as unknown as Row[];
      const parent = db.prepare('SELECT p.stable_id AS stableId, p.local_title AS title FROM stable_parents sp JOIN items p ON p.stable_id = sp.parent_stable_id WHERE sp.item_stable_id = ?');
      const matches = rows.filter((r) => {
        let sid = r.stableId;
        for (const want of wantParents) {
          const ps = parent.all(sid) as unknown as { stableId: number; title: string }[];
          const hit = ps.find((p) => norm(p.title) === want);
          if (!hit) return false;
          sid = hit.stableId;
        }
        return true;
      });
      if (matches.length === 1) return REAL_ID.test(matches[0].id) && !matches[0].id.startsWith('local') ? matches[0].id : null;
    } catch {
      // banco em uso, formato diferente numa versão nova do Drive ou sem permissão: fica sem link
    } finally {
      try { db?.close(); } catch { /* já fechado */ }
    }
  }
  return null;
}

export const driveLinkOf = (id: string | null) => (id ? `https://drive.google.com/file/d/${id}/view` : null);

export const driveLink = (file: string, dbs?: string[]) => driveLinkOf(driveFileId(file, dbs));

/** Link da pasta no Drive (a pasta do mês do cliente, por exemplo). */
export const driveFolderLink = (dir: string, dbs?: string[]) => {
  const id = driveFileId(dir, dbs, true);
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
};

/* ---------------- do link para o caminho no computador ---------------- */

/** O código de um link do Drive (`/file/d/<id>`, `/drive/folders/<id>`, `?id=<id>`, docs/sheets) ou o próprio código. */
export function driveIdFromLink(s: string): string | null {
  const t = s.trim();
  const m = /\/(?:file\/d|folders|document\/d|spreadsheets\/d|presentation\/d)\/([A-Za-z0-9_-]{20,})/.exec(t) ?? /[?&]id=([A-Za-z0-9_-]{20,})/.exec(t);
  if (m) return m[1];
  return REAL_ID.test(t) ? t : null;
}

const MY_DRIVE = /^(Meu Drive|My Drive)$/i;

/** Onde o "Meu Drive" está montado (H:\Meu Drive): pela pasta do Drive do escritório e, sem ela, procurando nas letras. */
export function myDriveMounts(hint?: string | null): string[] {
  const out: string[] = [];
  if (hint) {
    const parts = path.resolve(hint).split(/[\\/]+/);
    const i = parts.findIndex((p) => MY_DRIVE.test(p));
    if (i > 0) out.push(path.join(`${parts[0]}${path.sep}`, ...parts.slice(1, i + 1)));
  }
  if (process.platform === 'win32') {
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') for (const n of ['Meu Drive', 'My Drive']) {
      const p = path.join(`${l}:${path.sep}`, n);
      if (!out.includes(p) && existsSync(p)) out.push(p);
    }
  }
  return out;
}

export interface DrivePath { id: string; nome: string; pasta: boolean; caminho: string | null; motivo?: string }

/**
 * Caminho no computador de um link do Drive: sobe pelas pastas no banco local do Drive para computador (só leitura) até o
 * "Meu Drive" e junta com onde ele está montado. Item que não está no Meu Drive (compartilhado comigo sem atalho, drive
 * compartilhado) não tem caminho garantido: devolve o motivo.
 */
export function drivePathOf(link: string, hint?: string | null, dbs = driveMetadataDbs()): DrivePath | null {
  const id = driveIdFromLink(link);
  if (!id) return null;
  let found: DrivePath | null = null;
  for (const file of dbs) {
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const item = db.prepare('SELECT stable_id AS sid, local_title AS title, is_folder AS folder FROM items WHERE id = ? AND trashed = 0 AND is_tombstone = 0').get(id) as { sid: number; title: string; folder: number } | undefined;
      if (!item) continue;
      const parent = db.prepare('SELECT p.stable_id AS sid, p.local_title AS title FROM stable_parents sp JOIN items p ON p.stable_id = sp.parent_stable_id WHERE sp.item_stable_id = ? AND p.trashed = 0');
      const names = [item.title];
      let sid = item.sid;
      let root = false;
      for (let i = 0; i < 40; i++) {
        const ps = parent.all(sid) as unknown as { sid: number; title: string }[];
        if (!ps.length) break;
        const p = ps[0];
        if (MY_DRIVE.test(p.title)) { root = true; break; }
        names.unshift(p.title);
        sid = p.sid;
      }
      const base = { id, nome: item.title, pasta: item.folder === 1 };
      if (!root) { found ??= { ...base, caminho: null, motivo: 'Está compartilhado com a conta, mas fora do Meu Drive (sem atalho): não aparece no H:. Peça para adicionar um atalho no Meu Drive ou use o conector do Drive.' }; continue; }
      for (const mount of myDriveMounts(hint)) {
        const p = path.join(mount, ...names);
        if (existsSync(p)) return { ...base, caminho: p };
      }
      found ??= { ...base, caminho: null, motivo: `Achei no Drive (${names.join(' / ')}), mas não no computador: o Google Drive para computador está aberto?` };
    } catch {
      // banco em uso ou formato novo: tenta a próxima conta
    } finally {
      try { db?.close(); } catch { /* já fechado */ }
    }
  }
  return found ?? { id, nome: '', pasta: false, caminho: null, motivo: 'Este código não está no banco do Drive para computador: o link pode ser de outra conta, estar na lixeira ou ainda não ter sincronizado.' };
}

/** O arquivo está no Meu Drive montado (pelo caminho real: os atalhos de Documents\REZZU apontam para lá)? */
export function inDrive(file: string, hint?: string | null) {
  let real = path.resolve(file);
  try { real = realpathSync.native(file); } catch { /* sem resolver, vale o caminho como veio */ }
  const k = real.toLowerCase();
  return myDriveMounts(hint).some((m) => { const r = m.toLowerCase(); return k === r || k.startsWith(r + path.sep); });
}
