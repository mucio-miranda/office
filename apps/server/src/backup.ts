import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { all, db } from './db.ts';

/** Cópias do banco (demandas, clientes, financeiro, contas). Os arquivos dos clientes ficam nas pastas deles. */
const KEEP = 14;
const NAME = /^office-\d{8}-\d{6}\.db$/;
const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

export const backupDir = () => path.join(config.dataDir, 'backups');

let lastError: string | null = null;
export const lastBackupError = () => lastError;

export function listBackups() {
  if (!existsSync(backupDir())) return [];
  return readdirSync(backupDir()).filter((f) => NAME.test(f)).sort().reverse().map((name) => {
    const file = path.join(backupDir(), name);
    const st = statSync(file);
    return { name, file, size: st.size, at: st.mtime.toISOString() };
  });
}

const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Faz a cópia, confere se ela abre íntegra e mantém as 14 mais recentes na pasta do Office. */
export function runBackup() {
  mkdirSync(backupDir(), { recursive: true });
  const at = new Date();
  const file = path.join(backupDir(), `office-${stamp(at)}.db`);
  try {
    // VACUUM INTO gera um arquivo só e consistente, mesmo com o banco em uso
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const copy = new DatabaseSync(file, { readOnly: true });
    const check = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    copy.close();
    if (check !== 'ok') throw new Error(`a cópia saiu com defeito: ${check}`);
  } catch (e) {
    rmSync(file, { force: true });
    lastError = (e as Error).message;
    throw e;
  }
  for (const old of listBackups().slice(KEEP)) rmSync(old.file, { force: true });

  // segunda cópia em outra pasta: um arquivo por dia da semana, substituído na semana seguinte; nada mais é apagado lá
  const copies: string[] = [];
  const errors: string[] = [];
  for (const { backupDir: dir } of all<{ backupDir: string }>('SELECT DISTINCT backup_dir FROM offices WHERE backup_dir IS NOT NULL')) {
    const to = path.join(dir, `office-backup-${WEEKDAY[at.getDay()]}.db`);
    try {
      copyFileSync(file, `${to}.tmp`);
      renameSync(`${to}.tmp`, to);
      copies.push(to);
    } catch (e) {
      rmSync(`${to}.tmp`, { force: true });
      errors.push(`${dir}: ${(e as Error).message}`);
    }
  }
  lastError = errors.length ? `A segunda cópia falhou em ${errors.join('; ')}` : null;
  return { file, size: statSync(file).size, at: at.toISOString(), copies, errors };
}

/** Um backup por dia enquanto o Office estiver aberto; o primeiro sai ao abrir, se o último tiver mais de 20 h. */
export function scheduleBackups() {
  const due = () => {
    const last = listBackups()[0];
    if (last && Date.now() - Date.parse(last.at) < 20 * 3_600_000) return;
    try { runBackup(); } catch (e) { console.error('Backup falhou:', (e as Error).message); }
  };
  due();
  setInterval(due, 3_600_000).unref();
}
