import { existsSync, readdirSync } from 'node:fs';
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
