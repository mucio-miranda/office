// Empacota tudo que o app de desktop precisa em apps/desktop/build:
//   main.cjs / preload.cjs   processo principal e ponte segura com a UI
//   server.mjs               o servidor do Office inteiro num arquivo (roda num utilityProcess)
//   office-render.mjs        a CLI da engine de vídeo (usada pelos funcionários de IA)
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '../..');
const out = path.join(desktop, 'build');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// bundles ESM de Node ainda carregam dependências CommonJS que usam require()
const requireShim = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);";
const nodeEsm = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: { js: requireShim },
  // dependências opcionais do ws (aceleradores nativos); sem elas ele usa JS puro
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
};

await build({ ...nodeEsm, entryPoints: [path.join(repo, 'apps/server/src/index.ts')], outfile: path.join(out, 'server.mjs') });
await build({ ...nodeEsm, entryPoints: [path.join(repo, 'packages/video-engine/src/cli.ts')], outfile: path.join(out, 'office-render.mjs') });

const electronCjs = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], logLevel: 'warning' };
await build({ ...electronCjs, entryPoints: [path.join(desktop, 'src/main.ts')], outfile: path.join(out, 'main.cjs') });
await build({ ...electronCjs, entryPoints: [path.join(desktop, 'src/preload.ts')], outfile: path.join(out, 'preload.cjs') });

// recursos que o servidor lê em tempo de execução
const webDist = path.join(repo, 'apps/web/dist');
if (!existsSync(webDist)) throw new Error('Rode antes o build da UI: npm run build -w @office/web');
await cp(webDist, path.join(out, 'web'), { recursive: true });
await cp(path.join(repo, 'agents'), path.join(out, 'agents'), { recursive: true });
await cp(path.join(desktop, 'assets'), path.join(out, 'assets'), { recursive: true });

console.log('build do desktop pronto em', out);
