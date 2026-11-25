import { existsSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const origin = 'https://composicao.office.invalid';
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };
function browserPath() {
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [process.env.OFFICE_CHROME_BIN, ...bases.flatMap(dir => ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].map(p => path.join(dir, p))), '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const exe = candidates.find(p => p && existsSync(p));
  if (!exe) throw Error('Chrome ou Edge indisponível. Configure OFFICE_CHROME_BIN com o executável da máquina do Office.');
  return exe;
}

export async function exportarComposicao(html, roots, width, height, type) {
  if (![width, height].every(v => Number.isInteger(v) && v >= 16 && v <= 8192) || width * height > 32000000) throw Error('Dimensões inválidas. Use 16 a 8192 px por lado, até 32 megapixels.');
  const executablePath = browserPath();
  const env = { ...process.env };
  delete env.OFFICE_JOB_TOKEN;
  const browser = await puppeteer.launch({ executablePath, env, headless: true, pipe: true, timeout: 25000, args: ['--disable-background-networking', '--disable-extensions', '--no-first-run', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND'] }).catch(e => { throw Error(e.message + '\nDiagnóstico de versão: "' + executablePath + '" --version'); });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    const entry = origin + pathToFileURL(html).pathname;
    const failures = new Set();
    const csp = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    page.on('request', async req => {
      if (req.url().startsWith('data:')) { await req.continue().catch(() => {}); return; }
      try {
        const url = new URL(req.url());
        if (url.origin !== origin || req.method() !== 'GET') throw Error('Recurso externo: ' + url.origin);
        if (url.pathname === '/favicon.ico' && req.resourceType() === 'other') { await req.respond({ status: 204 }); return; }
        const file = await realpath(fileURLToPath('file://' + url.pathname));
        if (!roots.some(root => { const rel = path.relative(root, file); return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); })) throw Error('Recurso fora das pastas da demanda.');
        const main = file === html && req.isNavigationRequest() && req.frame() === page.mainFrame();
        const contentType = main ? 'text/html' : mime[path.extname(file).toLowerCase()];
        if (!contentType || (!main && req.isNavigationRequest())) throw Error('Tipo de recurso incompatível: ' + path.basename(file));
        if ((await stat(file)).size > 96 * 1024 * 1024) throw Error('Recurso maior que 96 MiB: ' + path.basename(file));
        let body = await readFile(file);
        if (main || contentType === 'text/css') body = Buffer.from(body.toString('utf8').replace(/file:\/\/\//gi, origin + '/'));
        await req.respond({ status: 200, contentType, headers: { 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' }, body });
      } catch (e) {
        failures.add(req.resourceType() + ' ' + req.url().slice(0, 300) + ' — ' + e.message);
        await req.abort().catch(() => {});
      }
    });
    await page.goto(entry, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => {
      document.documentElement.classList.add('modo-tudo');
      await Promise.all(Array.from(document.images).filter(i => i.getAttribute('src')).map(i => i.decode()));
      await document.fonts.ready;
    });
    await page.waitForNetworkIdle({ timeout: 30000 });
    if (failures.size) throw Error([...failures].join('\n'));
    const data = await page.screenshot({ type, ...(type === 'jpeg' ? { quality: 95 } : {}) });
    const preview = await page.screenshot({ type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width, height, scale: Math.min(1, 480 / Math.max(width, height)) } });
    return { data, preview };
  } finally { await browser.close(); }
}
