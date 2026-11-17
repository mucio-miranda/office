import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Client, Office } from '@office/shared';
import { clientDir, isFolder } from './folder.ts';
import { clientPaths, isNewLayout } from './layout.ts';

/**
 * Importação: as pastas de CLIENTES que ainda não viraram cliente no Office. Só lê: nada é criado, movido nem renomeado.
 */
export interface FoundClient {
  /** Nome da pasta dentro de CLIENTES. */
  dir: string;
  name: string;
  /** Tem REDES SOCIAIS/ARQUIVOS (estrutura nova) ou DOCUMENTOS, FOTOS, VIDEOS. As outras podem ser projeto, não cliente. */
  standard: boolean;
  marca: boolean;
  idv: boolean;
}

const SMALL_WORD = /^(de|da|do|das|dos|e)$/;

/** DOCERIA DA ANA JP vira Doceria da Ana JP. Pasta que já tem minúsculas foi escrita por alguém e fica como está. */
export function prettyName(dir: string) {
  if (dir !== dir.toUpperCase()) return dir;
  return dir.toLowerCase().split(/\s+/).map((w, i) => {
    if (i > 0 && SMALL_WORD.test(w)) return w;
    return /[aeiouáéíóúâêôãõ.]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase();
  }).join(' ');
}

function brandName(file: string) {
  try {
    const nome = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')).nome;
    return typeof nome === 'string' && nome.trim() ? nome.trim().slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** Caminho de verdade: `CLIENTES\NOME` costuma ser atalho para a pasta no Drive, e os dois são a mesma pasta. */
const real = (p: string) => {
  try { return realpathSync.native(p); } catch { return path.resolve(p); }
};
const key = (p: string) => real(p).replace(/[\\/]+$/, '').toLowerCase();

export function discoverClients(office: Office, clients: Pick<Client, 'folder' | 'driveFolder'>[]): FoundClient[] {
  const root = path.join(office.rootPath, 'CLIENTES');
  if (!existsSync(root)) return [];
  // já é cliente quem tem a mesma pasta, pelo cadastro ou pela pasta no Drive, mesmo escrita por outro caminho
  const taken = new Set(clients.flatMap((c) => [
    clientDir(office, c),
    office.driveRoot && c.driveFolder ? path.join(office.driveRoot, c.driveFolder) : null,
  ]).filter((d): d is string => !!d).map(key));
  // sobra antiga no C: com o mesmo nome da pasta do cliente no Drive (ex.: CLIENTES\DANIELLE AZEVEDO vazia) também não é cliente novo
  const nameKey = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toUpperCase();
  const driveNames = new Set(clients.map((c) => c.driveFolder?.split('/').filter(Boolean).pop()).filter((n): n is string => !!n).map(nameKey));
  const found: FoundClient[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (/^[._$]/.test(e.name)) continue;
    const abs = path.join(root, e.name);
    if (!isFolder(e, abs) || taken.has(key(abs)) || driveNames.has(nameKey(e.name))) continue;
    const paths = clientPaths(abs);
    const marca = paths.marca;
    found.push({
      dir: e.name,
      name: brandName(marca) ?? prettyName(e.name),
      standard: isNewLayout(abs) || ['DOCUMENTOS', 'FOTOS', 'VIDEOS'].some((d) => existsSync(path.join(abs, d))),
      marca: existsSync(marca),
      idv: existsSync(paths.idvMd),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
