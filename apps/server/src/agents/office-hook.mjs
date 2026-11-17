// Gancho do Claude Code (PreToolUse) para as ferramentas do Chrome: o navegador é um só para todos os clientes.
// Antes de cada uso, pede a vez ao Office e espera enquanto outro cliente estiver usando. Assim só o trecho do
// navegador (tunning, downloads) roda um por vez, e o resto do trabalho dos clientes segue em paralelo.
// Se o Office não responder, libera o uso: sem o gancho o trabalho segue como antes, só sem a fila.
// JavaScript puro, sem dependências, para rodar igual no repositório e no app instalado.

const API = process.env.OFFICE_API;
const TOKEN = process.env.OFFICE_JOB_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function take() {
  const res = await fetch(`${API}/api/agente/navegador_pegar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: '{}',
  });
  if (!res.ok) return true;
  return (await res.json()).ok === true;
}

// o Claude Code manda o evento pelo stdin; não precisamos dele, mas é preciso consumir
process.stdin.resume();
process.stdin.on('data', () => {});

if (API && TOKEN) {
  for (;;) {
    let ok = true;
    try { ok = await take(); } catch { ok = true; }
    if (ok) break;
    await sleep(3000);
  }
}
process.exit(0);
