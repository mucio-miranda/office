# Pesquisa: o que o mercado faz e o que o Office aproveita

Registro da pesquisa feita em 23/10/2026 para orientar o produto. A regra é estudar a **experiência e as ideias**
de produtos fechados e reaproveitar **código só de projetos com licença permissiva** (MIT/Apache), sempre com crédito.

## Escritórios virtuais comerciais

### Gather (v2)
Análise com a REA (captura de navegador headless, rede e acessibilidade) em `app.v2.gather.town`:

- **Entrada sem atrito**: a v2 cria um usuário anônimo (Firebase `accounts:signUp`) antes do login e leva direto
  para um *survey* de onboarding em 4 passos (cargo, tamanho da empresa, uso do escritório...) antes de criar o espaço.
- **API REST simples** (`/api/v2/users/me`, `/owned-spaces`, `/recent-spaces`) e um canal separado para o tempo real.
- **Som como feedback**: a v2 carrega dezenas de sons ao abrir. São passos por tipo de piso (madeira, carpete,
  pedra, grama), aceno enviado/recebido, levantar a mão, entrar em grupo, início e fim de coworking, travar e
  destravar reunião. É um detalhe barato que faz o mundo parecer vivo. **Adotar** (roadmap).
- Pelo material público: *smart status* via calendário (Almoço, Foco, Reunião), mesas atribuídas, ouvir conversas
  perto da sua mesa, reunião em um clique, notas e transcrição por IA, música na sala de reunião.
  Itens do roadmap deles: **vários andares** e **presença de agentes de IA**, exatamente o que o Office já nasce fazendo.

### SoWork
- Visual **2.5D isométrico**, com modo "simplificado" para quem prefere menos imersão. **Adotado**: o Office é
  isométrico, e os painéis funcionam como o modo simplificado.
- **Mapmaker** inspirado no The Sims. **Roadmap**: editor de planta.
- IA "Sophia": resumo de reuniões, transcrição e itens de ação enviados para ferramentas de projeto.
  **Adotado e ampliado**: no Office a IA não só resume, ela trabalha (edita vídeo, cria arte, escreve).
- Lobby para convidados e clientes. **Roadmap**.

Sobre contas: criar contas de teste nos serviços acima fica a cargo de uma pessoa (o agente não cria contas
em serviços de terceiros). Com uma conta logada, dá para aprofundar a análise das telas internas com a REA.

## Open source que serviu de referência

| Projeto | Licença | O que aproveitamos |
|---|---|---|
| [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) (~10k ⭐) | MIT | A ideia de **um avatar por sessão do Claude Code**, estados (digitando, lendo, esperando permissão), o modelo de eventos normalizado e o fallback lendo os transcripts JSONL. |
| [W17ant/Claude-Office](https://github.com/W17ant/Claude-Office) | MIT | **Levantar a mão** quando o agente precisa de permissão, chat estilo Slack com roteamento por agente, medidor de custo e servidor só em 127.0.0.1 com token. |
| [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) (~10k ⭐) | MIT | Estado do mundo transacional e compartilhado, personas definidas em arquivo de dados e pausar a simulação quando ninguém está olhando. |
| [OpenCut-app/OpenCut](https://github.com/OpenCut-app/OpenCut) (~95k ⭐) | MIT | Direção da engine: **headless/batch render**, **servidor MCP para agentes** e arquitetura de plugins (planos da reescrita deles). |
| Motion Canvas / Revideo | MIT | Timeline descrita em código ou dados e renderizada por API. Inspirou a timeline em JSON. |
| pyJianYingDraft / capcut-cli | — | Formato `draft_content.json` do CapCut (tempos em microssegundos, ids UUID). **Roadmap**: exportar a timeline do Office como rascunho do CapCut. |
| Remotion | source-available | Evitado: exige licença paga para empresas com mais de 3 pessoas. |

## Visual: Paperclip (atualizado em 23/10/2026)

[paperclipai/paperclip](https://github.com/paperclipai/paperclip) (MIT): painel de "empresas" de agentes de IA.
Inspirou o redesign minimalista do Office:

- **Tela de entrada** dividida ao meio: formulário enxuto à esquerda (logo, título, subtítulo, rótulos pequenos,
  botão de largura total, link sublinhado para alternar o modo) e uma **animação ASCII** à direita, com troca de tema no canto.
  O Office tem a própria animação (`AsciiOffice`, com mesas e peões), escrita do zero.
- **Tokens** shadcn/neutros: oklch sem croma, bordas translúcidas, Inter só em 400 e 600, raio de 8 px, cor reservada
  ao **status** (ocioso `#a8aeb2`, rodando `#2563eb`, aguardando `#f59e0b`, revisão `#7c3aed`, pronto `#22c55e`, erro `#dc2626`).
- **Casca**: sidebar de 240 px com rótulos de seção em caixa alta, cabeçalho de página de 56 px e páginas em vez de modais.

## Suites "Craft" (clones open source da Adobe e do Office)

Projetos do time ArtCraft ([storytold](https://github.com/storytold)), em Rust puro, licença MIT ou Apache-2.0, todos em alpha.
O ponto que importa para o Office: **cada app expõe todos os comandos por CLI, canal JSON e servidor MCP**, ou seja,
os nossos funcionários de IA conseguem operar sem interface.

| App | Substitui | Destaques para o Office |
|---|---|---|
| [PhotoCraft](https://github.com/storytold/photocraft) (~71k ⭐) | Photoshop | Lê e grava PSD/PSB, camadas, máscaras, 27 modos de mesclagem e ajustes. `photocraft-cli run/batch` e `photocraft-cli mcp`, com mais de 500 comandos compartilhados entre UI, CLI e MCP. |
| [VectorCraft](https://github.com/storytold/vectorcraft) (~10k ⭐) | Illustrator | SVG, PDF e `.ai` compatível com PDF. `vectorcraft-cli mcp` com pastas de leitura e escrita restritas (`--automation-read-root/--automation-write-root`). |
| [FilmCraft](https://github.com/storytold/filmcraft) | Premiere | Todo comando de edição exposto por CLI, controle JSON e MCP. Ainda não abre `.prproj`. |
| PdfCraft | Acrobat | Servidor MCP para agentes. |
| WordCraft (~14k ⭐) · GridCraft (~5,7k ⭐) · DeckCraft (~3,7k ⭐) | Word · Excel · PowerPoint | DOCX, XLSX e PPTX (GridCraft cobre 513 das 523 funções do Excel). Lançados em outubro de 2026, ainda alpha. |

Também no radar: [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) (~32k ⭐, Apache-2.0). É um binário único para
**agentes** lerem, editarem e renderizarem DOCX/XLSX/PPTX (HTML/PNG), com MCP (`officecli mcp claude`) e skill
para o Claude Code. É o caminho mais curto para o Theo e o Rafa entregarem propostas, planilhas e apresentações.

**Plano**: virar "ferramentas" dos funcionários. A Duda usa PhotoCraft e VectorCraft via MCP no lugar do
Photoshop por script, a Vic ganha o FilmCraft além da nossa engine e o Theo e o Rafa usam o OfficeCLI.
O servidor do Office registra esses MCPs por escritório, com as pastas restritas às do escritório.

## Decisões que saíram daqui

1. **Isométrico 3D low-poly** com primitivas (sem assets pesados): roda leve em qualquer notebook da equipe.
2. **Funcionário de IA = sessão do Claude Code headless** (`claude -p --output-format stream-json`), rodando na
   pasta do escritório para herdar o `CLAUDE.md` e as skills. Nada de reimplementar ferramentas.
3. **Checkpoint de aprovação explícito** (marcador no texto + `--resume` da mesma sessão). É o "levantar a mão"
   do Claude-Office, mas resolvido sem hooks, o que funciona igual em Windows, Mac e Linux.
4. **Timeline em JSON**: o mesmo arquivo serve para a UI, para a IA e para versionar. Renderiza com ffmpeg num
   único `filter_complex`.
5. **LAN primeiro**: um processo Node serve a API, o WebSocket e a UI. A equipe só abre o IP.
