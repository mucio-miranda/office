import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client, Office } from '@office/shared';
import { clientDir, insideDir, isFolder } from './folder.ts';
import { clientPaths, layoutMap } from './layout.ts';

/**
 * Referências editáveis pelo Office: adicionar (arquivo ou link de imagem) e remover. Remover nunca apaga: o arquivo vai
 * para `_apagados`, na raiz do Drive da agência (ou da pasta do escritório), FORA das pastas que as skills leem
 * (REFERENCIAS e as pastas dos clientes). O registro `_apagados/apagados.json` guarda o caminho original e, na biblioteca,
 * a entrada do indice.json, para dar para trazer de volta.
 */
export const TRASH = '_apagados';
export const trashRoot = (office: Office) => path.join(office.driveRoot && existsSync(office.driveRoot) ? office.driveRoot : office.rootPath, TRASH);

/** Move para a lixeira do Office. No mesmo disco é renomear; entre discos, copia, confere o tamanho e só então tira do lugar. */
function toTrash(office: Office, abs: string, group: string, by: string, extra: Record<string, unknown> = {}) {
  const dir = path.join(trashRoot(office), new Date().toISOString().slice(0, 10), ...group.split('/').map((g) => g.replace(/[<>:"\|?*]+/g, ' ').trim()).filter(Boolean));
  mkdirSync(dir, { recursive: true });
  const to = freeName(dir, path.basename(abs));
  try {
    renameSync(abs, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw new Error('Não consegui mover o arquivo (está aberto em outro programa?).');
    copyFileSync(abs, to);
    if (statSync(to).size !== statSync(abs).size) throw new Error('A cópia para _apagados não conferiu; o original ficou no lugar.');
    unlinkSync(abs);
  }
  const log = path.join(trashRoot(office), 'apagados.json');
  let kept: unknown[] = [];
  try { kept = JSON.parse(readFileSync(log, 'utf8')); } catch { /* primeiro */ }
  kept.push({ original: abs, movidoPara: to, apagadoEm: new Date().toISOString(), por: by, ...extra });
  writeFileSync(log, JSON.stringify(kept, null, 1), 'utf8');
  return to;
}
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MAX_BYTES = 25 * 1024 * 1024;

const refsRoot = (office: Office) => path.join(office.rootPath, 'REFERENCIAS');
const indexFile = (office: Office) => path.join(refsRoot(office), 'indice.json');
const slug = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ref';

function readIndex(office: Office): { refs: Record<string, unknown>[] } & Record<string, unknown> {
  try { return JSON.parse(readFileSync(indexFile(office), 'utf8').replace(/^﻿/, '')); } catch { return { refs: [] }; }
}
function writeIndex(office: Office, ind: unknown) {
  mkdirSync(refsRoot(office), { recursive: true });
  const tmp = `${indexFile(office)}.tmp`;
  writeFileSync(tmp, JSON.stringify(ind, null, 1), 'utf8');
  renameSync(tmp, indexFile(office));
}

/** Nome livre na pasta: se existir, ganha um número. Nunca sobrescreve. */
function freeName(dir: string, name: string) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let out = path.join(dir, name);
  for (let i = 2; existsSync(out); i++) out = path.join(dir, `${base} (${i})${ext}`);
  return out;
}

/** Baixa a imagem de um link (só http/https e só imagem). */
export async function fetchImage(url: string): Promise<{ data: Buffer; name: string }> {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('Link inválido.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Use um link http(s) de imagem.');
  const res = await fetch(u, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`O link respondeu ${res.status}.`);
  const type = res.headers.get('content-type') ?? '';
  const ext = /png/.test(type) ? '.png' : /webp/.test(type) ? '.webp' : /jpe?g/.test(type) ? '.jpg' : null;
  if (!ext) throw new Error('Esse link não é de uma imagem (PNG, JPG ou WebP). Abra a imagem e copie o endereço dela.');
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error('Imagem grande demais (máximo 25 MB).');
  return { data, name: `${slug(path.basename(u.pathname, path.extname(u.pathname)) || u.hostname)}${ext}` };
}

// ---------------------------------------------------------------- biblioteca por nicho

/** Motor da agência (skill arte-referencia): mede paleta e tema e ignora duplicadas. Sem ele, entra só o básico. */
const refsScript = (office: Office) => path.join(office.rootPath, '.claude', 'skills', 'arte-referencia', 'scripts', 'refs.py');

function runRefs(office: Office, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile('python', [refsScript(office), ...args], {
      windowsHide: true, timeout: 120_000, encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', REZZU_REFERENCIAS: refsRoot(office) },
    }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).split('\n').filter(Boolean).pop())) : resolve(stdout)));
  });
}

export async function addNicheRef(office: Office, niche: string, input: { data: Buffer; name: string; origem?: string; obs?: string; tags?: string[] }) {
  if (!/^[\w-]{2,40}$/.test(niche)) throw new Error('Nicho inválido.');
  if (!IMAGE.test(input.name)) throw new Error('Só PNG, JPG ou WebP.');
  const before = new Set(readIndex(office).refs.map((r) => r.id as string));
  if (existsSync(refsScript(office))) {
    const tmpDir = path.join(process.env.REZZU_TEMP && existsSync(process.env.REZZU_TEMP) ? process.env.REZZU_TEMP : tmpdir(), 'office-refs');
    mkdirSync(tmpDir, { recursive: true });
    const tmp = freeName(tmpDir, `${slug(path.basename(input.name, path.extname(input.name)))}${path.extname(input.name).toLowerCase()}`);
    writeFileSync(tmp, input.data);
    const out = await runRefs(office, ['add', tmp, '--segmento', niche, '--origem', input.origem || 'Office',
      ...(input.tags?.length ? ['--tags', input.tags.join(',')] : []), ...(input.obs ? ['--obs', input.obs] : [])]);
    const added = readIndex(office).refs.find((r) => !before.has(r.id as string));
    if (!added) throw new Error(/duplic|j[aá] existe|igual/i.test(out) ? 'Essa referência já está na biblioteca.' : `Não entrou na biblioteca: ${out.trim().split('\n').pop()}`);
    return { id: added.id as string, file: path.join(refsRoot(office), ...String(added.arquivo).split(/[\\/]/)) };
  }
  // sem o motor: copia e registra o mínimo, no mesmo formato do indice.json
  const dir = path.join(refsRoot(office), niche);
  mkdirSync(dir, { recursive: true });
  const file = freeName(dir, `${niche}-${Date.now().toString(36)}${path.extname(input.name).toLowerCase()}`);
  writeFileSync(file, input.data);
  const ind = readIndex(office);
  const id = path.basename(file, path.extname(file));
  ind.refs.push({ id, segmento: niche, arquivo: path.relative(refsRoot(office), file).split(path.sep).join('/'), origem: input.origem || 'Office', layout: 'a-classificar', tags: input.tags ?? [], nota: null, obs: input.obs ?? '', adicionado: new Date().toISOString().slice(0, 10) });
  writeIndex(office, ind);
  return { id, file };
}

export function removeNicheRef(office: Office, niche: string, id: string, by: string) {
  const ind = readIndex(office);
  const entry = ind.refs.find((r) => r.id === id && r.segmento === niche);
  if (!entry) throw new Error('Referência não encontrada.');
  const rel = String(entry.arquivo);
  const file = insideDir(refsRoot(office), rel);
  if (!file) throw new Error('Caminho inválido.');
  // a entrada sai do índice (as skills só usam o que está nele) e fica guardada no registro da lixeira
  const moved = existsSync(file) ? toTrash(office, file, `REFERENCIAS/${niche}`, by, { indice: entry }) : null;
  ind.refs = ind.refs.filter((r) => r !== entry);
  writeIndex(office, ind);
  return { moved };
}

/** Tipografia escolhida para o nicho: fica no indice.json (o refs.py preserva as chaves que não conhece). */
export function setNicheFont(office: Office, niche: string, font: { titulo: string | null; texto: string | null }) {
  if (!/^[\w-]{2,40}$/.test(niche)) throw new Error('Nicho inválido.');
  const clean = (f: string | null) => (f && /^[A-Za-z0-9 ]{2,40}$/.test(f.trim()) ? f.trim() : null);
  const ind = readIndex(office) as { nichos?: Record<string, unknown> } & ReturnType<typeof readIndex>;
  const nichos = (ind.nichos && typeof ind.nichos === 'object' ? ind.nichos : {}) as Record<string, unknown>;
  const titulo = clean(font.titulo), texto = clean(font.texto);
  if (!titulo && !texto) delete nichos[niche]; else nichos[niche] = { ...(titulo ? { titulo } : {}), ...(texto ? { texto } : {}) };
  writeIndex(office, { ...ind, nichos });
}

// ---------------------------------------------------------------- por cliente

/**
 * A pasta de referências do cliente: na estrutura nova, ARQUIVOS – CLIENTE\REFERENCIAS; na antiga, a primeira que já
 * existe (nome começando com REFERENCIA), ou DOCUMENTOS\REFERENCIAS.
 */
export function clientRefDir(office: Office, client: Client) {
  const dir = clientDir(office, client);
  if (!dir) throw new Error('Este cliente não tem pasta.');
  const paths = clientPaths(dir, layoutMap(office.rootPath));
  if (paths.estrutura === 'novo') return paths.abs('referencias');
  const find = (abs: string, depth: number): string | null => {
    if (depth > 3) return null;
    let entries: Dirent[] = [];
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return null; }
    const dirs = entries.filter((e) => !e.name.startsWith('.') && !e.name.startsWith('_') && isFolder(e, path.join(abs, e.name)));
    const hit = dirs.find((e) => /^REFER[EÊ]NCIAS?\b/i.test(e.name));
    if (hit) return path.join(abs, hit.name);
    for (const e of dirs) { const r = find(path.join(abs, e.name), depth + 1); if (r) return r; }
    return null;
  };
  return find(dir, 0) ?? path.join(dir, 'DOCUMENTOS', 'REFERENCIAS');
}

export function addClientRef(office: Office, client: Client, input: { data: Buffer; name: string }) {
  if (!IMAGE.test(input.name)) throw new Error('Só PNG, JPG ou WebP.');
  const dir = clientRefDir(office, client);
  mkdirSync(dir, { recursive: true });
  const file = freeName(dir, path.basename(input.name).replace(/[<>:"/\\|?*]+/g, ' ').trim());
  writeFileSync(file, input.data);
  return { file };
}

export function removeClientRef(office: Office, client: Client, file: string, by: string) {
  const dir = clientDir(office, client);
  if (!dir) throw new Error('Este cliente não tem pasta.');
  const abs = path.resolve(file);
  const rel = path.relative(dir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Esse arquivo não é da pasta do cliente.');
  // só imagem dentro de uma pasta de referência (o moodboard do cliente só mostra essas)
  const parts = rel.split(path.sep);
  if (!IMAGE.test(abs) || !parts.slice(0, -1).some((p) => /^REFER[EÊ]NCIAS?\b/i.test(p)) || parts.includes(TRASH)) throw new Error('Esse arquivo não é uma referência do cliente.');
  if (!existsSync(abs)) throw new Error('O arquivo não existe mais.');
  return { moved: toTrash(office, abs, `CLIENTES/${client.name}`, by) };
}
