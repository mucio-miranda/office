import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { DemandKind } from '@office/shared';
import { config } from '../config.ts';

/**
 * Triagem de pedido com IA, para quando as palavras-chave não decidem: uma chamada mínima ao Haiku (sem ferramentas,
 * sem MCP, sem configurações, fora da pasta do projeto, sem gravar sessão). Mediu ~830 tokens e ~1,3 s. Qualquer falha
 * (limite, erro, demora) devolve null e quem chamou segue com o tipo do último pedido do cliente: nunca trava o pedido.
 */
const PROMPT = 'Classifique o pedido de uma agência de marketing em UMA palavra: copy (textos, legendas, roteiros, pautas), '
  + 'design (artes, posts, carrosséis, sites, landing pages, páginas, layout, 3D, identidade visual), video (vídeos, reels, '
  + 'stories, edição), foto (tratar ou retocar fotos). Responda só a palavra.';
const KINDS: Record<string, DemandKind> = { copy: 'copy', design: 'design', video: 'video', foto: 'foto' };
const TIMEOUT_MS = 20_000;

/** A resposta do Claude Code (json ou linhas de stream) vira um tipo de demanda, ou null se não for um dos previstos. */
export function parseTriage(out: string): DemandKind | null {
  for (const line of out.split(/\r?\n/).reverse()) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type !== 'result' || typeof ev.result !== 'string') continue;
    // sem acento e sem pontuação: "Vídeo." vira "video"
    const word = ev.result.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    return KINDS[word] ?? null;
  }
  return null;
}

export function triageKind(text: string): Promise<DemandKind | null> {
  return new Promise((resolve) => {
    const [bin, pre] = /\.m?js$/.test(config.claudeBin) ? [process.execPath, [config.claudeBin]] : [config.claudeBin, []];
    const args = [...pre, '-p', '--model', 'haiku', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands',
      '--no-session-persistence', '--output-format', 'json', '--system-prompt', PROMPT];
    let out = '';
    let done = false;
    const finish = (k: DemandKind | null) => { if (!done) { done = true; resolve(k); } };
    try {
      const child = spawn(bin, args, { cwd: tmpdir(), windowsHide: true, env: process.env });
      const timer = setTimeout(() => { child.kill(); finish(null); }, TIMEOUT_MS);
      child.stdout.on('data', (d) => { out += d; });
      child.on('error', () => { clearTimeout(timer); finish(null); });
      child.on('close', () => { clearTimeout(timer); finish(parseTriage(out)); });
      child.stdin.end(`Pedido: ${JSON.stringify(text.slice(0, 2000))}`);
    } catch {
      finish(null);
    }
  });
}
