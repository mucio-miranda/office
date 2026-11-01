import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client, Office } from '@office/shared';
import { clientDir, isFolder } from './folder.ts';

/**
 * Importação: as pastas de CLIENTES que ainda não viraram cliente no Office. Só lê: nada é criado, movido nem renomeado.
 */
export interface FoundClient {
  /** Nome da pasta dentro de CLIENTES. */
  dir: string;
  name: string;
  /** Tem DOCUMENTOS, FOTOS ou VIDEOS. As outras podem ser projeto, não cliente. */
  standard: boolean;
  marca: boolean;
  idv: boolean;
}

const SMALL_WORD = /^(de|da|do|das|dos|e)$/;

/** BOLO DE MAE JP vira Bolo de Mae JP. Pasta que já tem minúsculas foi escrita por alguém e fica como está. */
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

const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function discoverClients(office: Office, clients: Pick<Client, 'folder'>[]): FoundClient[] {
  const root = path.join(office.rootPath, 'CLIENTES');
  if (!existsSync(root)) return [];
  const taken = clients.map((c) => clientDir(office, c)).filter((d): d is string => !!d);
  const found: FoundClient[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (/^[._$]/.test(e.name)) continue;
    const abs = path.join(root, e.name);
    if (!isFolder(e, abs) || taken.some((t) => samePath(t, abs))) continue;
    const idv = path.join(abs, 'DOCUMENTOS', 'IDENTIDADE VISUAL');
    const marca = path.join(idv, 'marca.json');
    found.push({
      dir: e.name,
      name: brandName(marca) ?? prettyName(e.name),
      standard: ['DOCUMENTOS', 'FOTOS', 'VIDEOS'].some((d) => existsSync(path.join(abs, d))),
      marca: existsSync(marca),
      idv: existsSync(path.join(idv, 'IDV.md')),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
