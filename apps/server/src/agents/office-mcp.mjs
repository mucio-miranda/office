// Servidor MCP `office`: o funcionário de IA lê e atualiza o calendário de conteúdo do cliente da tarefa.
// Roda como processo filho do Claude Code (stdio, JSON-RPC por linha) e fala com o Office por HTTP,
// com o token da tarefa: só alcança o cliente dela. JavaScript puro, sem dependências, para rodar igual
// no repositório e no app instalado.
import { createInterface } from 'node:readline';

const API = process.env.OFFICE_API;
const TOKEN = process.env.OFFICE_JOB_TOKEN;

const POST = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id de um post que já existe (para atualizar); sem id cria um novo' },
    date: { type: 'string', description: 'AAAA-MM-DD' },
    format: { type: 'string', enum: ['estatico', 'carrossel', 'reels', 'capa-reels', 'story'] },
    theme: { type: 'string', description: 'tema ou título do post' },
    caption: { type: 'string', description: 'legenda' },
    notes: { type: 'string', description: 'referência escolhida, foto, observações' },
    number: { type: 'number', description: 'ordem de postagem no lote (01, 02…)' },
    status: { type: 'string', enum: ['planejado', 'referencia', 'composicao', 'tunning', 'conferencia', 'aprovado', 'drive', 'postado', 'cancelado'] },
    tunning: { type: 'string', enum: ['feito'], description: 'marque "feito" depois do tunning. Dispensar o tunning é decisão de uma pessoa, pela tela' },
    files: { type: 'array', items: { type: 'string' }, description: 'caminhos completos das peças finais' },
    workDir: { type: 'string', description: 'pasta da peça em TRABALHOS (a que tem FINAL/ e _trabalho/). Registre ao começar a produzir a peça' },
    finals: { type: 'array', items: { type: 'string' }, description: 'arquivos finais na ordem de postagem (lâminas do carrossel). Sem isso, o Office usa a pasta FINAL/ da peça. Quem entrega na pasta do mês, com o nome padrão, é o Office ao aprovar: não copie você' },
  },
};

const TOOLS = [
  {
    name: 'calendario_listar',
    description: 'Lista o calendário de conteúdo do cliente desta tarefa (posts com data, formato, tema, etapa e tunning). Use antes de planejar ou produzir, para saber o que já existe e o que falta.',
    inputSchema: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM (opcional)' } } },
  },
  {
    name: 'calendario_salvar',
    description: 'Cria ou atualiza posts do calendário do cliente desta tarefa, ligados à demanda atual. Use para registrar o calendário do mês quando ele for definido ou aprovado, e para mover cada peça de etapa (referencia > composicao > tunning > conferencia > aprovado > drive > postado). Arte só passa de conferência com tunning "feito" (ou dispensado por uma pessoa na tela). Nunca apaga: para tirar um post, use status "cancelado".',
    inputSchema: { type: 'object', properties: { posts: { type: 'array', items: POST, maxItems: 60 } }, required: ['posts'] },
  },
  {
    name: 'posts_do_mes',
    description: 'Lista as peças do mês do cliente desta tarefa que estão prontas, agendadas ou postadas (da pasta do mês no Drive e do calendário do Office), com a chave, o número, o tema, o dia e os arquivos de cada uma. Use para conferir o que já foi ao ar.',
    inputSchema: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM (padrão: o mês atual)' } } },
  },
  {
    name: 'posts_marcar_postado',
    description: 'Marca peças como postadas, pela chave de posts_do_mes e o dia em que foram ao ar. O Office move os arquivos para POSTADOS com o nome de postado (nunca sobrescreve; dá para desfazer pela página Posts). Só marque o que você conferiu no perfil.',
    inputSchema: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM das peças' }, itens: { type: 'array', maxItems: 60, items: { type: 'object', properties: { chave: { type: 'string' }, data: { type: 'string', description: 'AAAA-MM-DD em que foi ao ar' } }, required: ['chave', 'data'] } } }, required: ['itens'] },
  },
  {
    name: 'pedir_ajudante',
    description: 'Pede outra sessão (um ajudante) para fazer uma parte do trabalho em paralelo, no mesmo cliente. Uma pessoa precisa aprovar antes de começar; siga com o resto enquanto isso. Quando o ajudante terminar, o resumo dele chega nesta conversa. Use só quando agiliza de verdade.',
    inputSchema: { type: 'object', properties: { tarefa: { type: 'string', description: 'o que o ajudante deve fazer, com as pastas e arquivos de entrada e onde salvar' }, motivo: { type: 'string', description: 'por que vale a pena em paralelo' } }, required: ['tarefa', 'motivo'] },
  },
  {
    name: 'navegador_liberar',
    description: 'Devolve a vez do navegador (Chrome e pasta Downloads, que servem a todos os clientes). Chame quando terminar o tunning e os arquivos baixados já estiverem na pasta do trabalho. Se usar o Chrome de novo, a vez é pedida sozinha.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function call(name, args) {
  const res = await fetch(`${API}/api/agente/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(JSON.parse(text || '{}').error ?? `O Office respondeu ${res.status}`);
  return text;
}

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notificações (initialized, cancelled)
  try {
    if (method === 'initialize') {
      send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'office', version: '1' } } });
    } else if (method === 'tools/list') {
      send({ id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      if (!TOOLS.some((t) => t.name === params?.name)) throw new Error(`Ferramenta desconhecida: ${params?.name}`);
      try {
        send({ id, result: { content: [{ type: 'text', text: await call(params.name, params.arguments) }] } });
      } catch (e) {
        send({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    } else if (method === 'ping') {
      send({ id, result: {} });
    } else {
      send({ id, error: { code: -32601, message: `Método não suportado: ${method}` } });
    }
  } catch (e) {
    send({ id, error: { code: -32603, message: e.message } });
  }
});
