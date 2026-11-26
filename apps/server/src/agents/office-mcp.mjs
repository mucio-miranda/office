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
    name: 'pedir_comando',
    description: 'Pede para o Office rodar um comando que sai do computador e que você não pode rodar aqui: enviar ao GitHub (git_push) ou criar o repositório no GitHub (gh_repo_create, já ligando a pasta e enviando). Uma pessoa vê o comando exato na tela e aprova; a saída chega nesta conversa. Faça antes o git local (init, add, commit). Para gh_repo_create, pergunte antes à pessoa se o repositório é privado ou público.',
    inputSchema: { type: 'object', properties: { acao: { type: 'string', enum: ['git_push', 'gh_repo_create'] }, pasta: { type: 'string', description: 'caminho completo do repositório local' }, remoto: { type: 'string', description: 'git_push: remoto (padrão origin)' }, branch: { type: 'string', description: 'git_push: branch (padrão main)' }, nome: { type: 'string', description: 'gh_repo_create: dono/repositorio' }, visibilidade: { type: 'string', enum: ['privado', 'publico'], description: 'gh_repo_create: a pessoa decide' }, motivo: { type: 'string', description: 'por que, em uma linha' } }, required: ['acao', 'pasta', 'motivo'] },
  },
  {
    name: 'git_local',
    description: 'Roda git local na pasta de um repositório (você não troca de pasta aqui): init, status, add, commit, log, diff, show, branch, remote, config (só user.name e user.email deste repositório), rev-parse, ls-files. Sem shell: mande o subcomando e os argumentos separados, ex.: comando "commit", args ["-m", "mensagem"]. Enviar ao GitHub: pedir_comando.',
    inputSchema: { type: 'object', properties: { pasta: { type: 'string', description: 'caminho completo do repositório' }, comando: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['pasta', 'comando'] },
  },
  {
    name: 'drive_atalho',
    description: 'Põe no Meu Drive um atalho de uma pasta ou arquivo do Drive que está só "compartilhado com a conta" (fora do H:), pela API do Drive da agência. Depois de alguns segundos ele aparece no H: dentro da pasta indicada. Use quando drive_caminho disser que o link está fora do Meu Drive e a equipe precisa dele por perto.',
    inputSchema: { type: 'object', properties: { link: { type: 'string', description: 'link do Drive do item compartilhado' }, pasta: { type: 'string', description: 'pasta do H: (caminho completo, já existente) onde fica o atalho' } }, required: ['link', 'pasta'] },
  },
  {
    name: 'drive_copiar',
    description: 'Copia um arquivo ou uma pasta inteira do Drive (inclusive de link só compartilhado, fora do H:) para uma pasta da agência, de Drive para Drive, sem baixar nada. Nunca sobrescreve: o que já existe com o mesmo nome fica e é listado como pulado. Espera até ~4 min; se não terminar, devolve o id para drive_copia_status. Confira a contagem no fim.',
    inputSchema: { type: 'object', properties: { link: { type: 'string', description: 'link do Drive do arquivo ou pasta de origem' }, para: { type: 'string', description: 'pasta de destino no H: (caminho completo, já existente) ou link dela' } }, required: ['link', 'para'] },
  },
  {
    name: 'drive_copia_status',
    description: 'Espera uma cópia de drive_copiar (até ~4 min por chamada) e diz quanto já foi.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'copiar_para_local',
    description: 'Copia arquivos ou pastas do Google Drive (H:) para o disco local antes de editar: vídeos brutos e qualquer arquivo grande. O Drive baixa enquanto lê, e um comando seu (ffmpeg, whisper, Copy-Item) cai no limite de tempo no meio de um arquivo de GB. Aqui a cópia roda no Office, em segundo plano e com retomada se o Drive falhar. Espera até ~4 min; se não terminar, devolve o id e o progresso: chame copia_status para esperar mais. Nunca apaga nem mexe no original. Copie para a pasta TMP do trabalho (C:\REZZU-TEMP\...).',
    inputSchema: { type: 'object', properties: { de: { type: 'array', items: { type: 'string' }, description: 'caminhos completos de arquivos ou pastas' }, para: { type: 'string', description: 'pasta de destino (caminho completo)' } }, required: ['de', 'para'] },
  },
  {
    name: 'copia_status',
    description: 'Espera uma cópia de copiar_para_local (até ~4 min por chamada) e diz quanto falta ou se terminou.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'drive_caminho',
    description: 'Acha no computador (H:) o arquivo ou a pasta de um link do Google Drive (drive.google.com/file/d/..., /drive/folders/..., docs) pelo banco local do Drive para computador, só leitura. Use sempre que a pessoa mandar um link do Drive, em vez de procurar pelo nome ou montar script. Devolve o caminho; se não estiver no H:, diz o motivo.',
    inputSchema: { type: 'object', properties: { link: { type: 'string', description: 'o link do Drive (ou só o código do arquivo)' } }, required: ['link'] },
  },
  {
    name: 'mover',
    description: 'Move ou renomeia um arquivo ou pasta dentro das pastas do escritório (comandos de mover são bloqueados). Use SÓ quando a pessoa pediu nesta conversa para mover ou renomear aquilo; nunca por conta própria e nunca brutos de cliente sem o pedido dela. Não sobrescreve (se o destino existe, recusa); se `para` é uma pasta que existe, vai para dentro dela com o mesmo nome. No mesmo disco (ex.: dentro do Drive H:) é na hora, sem enviar de novo. Devolve como desfazer.',
    inputSchema: { type: 'object', properties: { de: { type: 'string', description: 'caminho completo do que mover' }, para: { type: 'string', description: 'caminho completo do destino (pasta existente ou novo nome)' }, motivo: { type: 'string', description: 'o pedido da pessoa, em poucas palavras' } }, required: ['de', 'para', 'motivo'] },
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
