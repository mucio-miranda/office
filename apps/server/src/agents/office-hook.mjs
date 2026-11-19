// Gancho do Claude Code para os recursos que a máquina tem um só: o Chrome e o render de vídeo.
// - Chrome (PreToolUse nas ferramentas do navegador): pede a vez ao Office antes de cada uso.
// - Render (PreToolUse no Bash): só quando o comando renderiza ou transcreve (ffmpeg, Whisper, motor de vídeo);
//   devolve a vez no PostToolUse do mesmo comando. Roteiro, decupagem e leitura de arquivos seguem em paralelo.
// Enquanto outro cliente usa, espera. Se o Office não responder, libera o uso: sem o gancho o trabalho segue como
// antes, só sem a fila. JavaScript puro, sem dependências, para rodar igual no repositório e no app instalado.

const API = process.env.OFFICE_API;
const TOKEN = process.env.OFFICE_JOB_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Comandos que disputam a máquina inteira (CPU/GPU): render e transcrição. */
export const RENDER_RE = /\b(ffmpeg|whisper|faster[-_]whisper|remotion|hyperframes|video-engine|render\w*|editar[-_ ]?video|story[-_ ]?(reuniao|broll))\b/i;

async function call(tool) {
  const res = await fetch(`${API}/api/agente/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: '{}',
  });
  if (!res.ok) return true;
  return (await res.json()).ok === true;
}

async function wait(tool) {
  for (;;) {
    let ok = true;
    try { ok = await call(tool); } catch { ok = true; }
    if (ok) return;
    await sleep(3000);
  }
}

async function readEvent() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return {}; }
}

// nos testes o arquivo só é importado (para conferir o RENDER_RE), sem ler o stdin
if (!process.env.OFFICE_HOOK_TEST) {
  const ev = await readEvent();
  if (API && TOKEN) {
    const tool = String(ev.tool_name ?? '');
    const post = ev.hook_event_name === 'PostToolUse';
    if (tool.startsWith('mcp__claude-in-chrome')) { if (!post) await wait('navegador_pegar'); }
    else if (tool === 'Bash' && RENDER_RE.test(String(ev.tool_input?.command ?? ''))) {
      if (post) { try { await call('render_liberar'); } catch { /* o fim da tarefa libera */ } }
      else await wait('render_pegar');
    }
  }
  process.exit(0);
}
