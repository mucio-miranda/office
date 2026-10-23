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

#### Gather por dentro (conta de teste, 23/10/2026)

Percorri o onboarding completo, o tour do "Escritório de demonstração" e um espaço criado do zero ("Office Lab Teste").

- **Onboarding em 4 perguntas** (cargo, tamanho, uso, origem). Depois vêm o nome do escritório, o **layout**
  (Híbrido, Aberto ou Privado), o **tema** (Startup, Antique, Zen ou Eco) e o **tamanho** (1–10 até 81–100). O mapa é
  **gerado proceduralmente** juntando módulos (mesas, salas de reunião, auditório) conforme o tamanho.
- **Tour guiado interativo** num escritório de demonstração cheio de bots. Ele ensina fazendo: buscar uma pessoa
  (pesquisa global), acenar, receber "Fulano acenou de volta" com o botão **Ir até**, chegar perto e a chamada abrir
  sozinha ("sem vínculos, sem agendamento") e entrar numa reunião pela notificação do calendário.
- **Mesa dedicada**: cada pessoa tem uma mesa, que é a sua posição padrão fora das reuniões. Zonas por time têm
  rótulo no chão ("Product team", "Engineering team").
- **Visualização Simplificada**: planta esquemática minimalista, com avatares como círculos com foto e salas de
  reunião destacadas, para quem acha o escritório cheio caótico.
- **Casca do app**: trilho de ícones (busca Ctrl K, mapa, chat, calendário, atividade, configurações), painel
  lateral com seletor de **andar**, busca de pessoas (Ctrl F) e lista de online. Ao abrir chat ou calendário, o
  **mapa vira um mini-mapa ao vivo no canto**, junto com os controles de mídia: você nunca "sai" do escritório.
- **Chat** com canais (#general, #social), mensagens diretas e **Resumos**. **Calendário** semanal com conexão ao
  Google Calendar e aba de **Notas da reunião**. **Feed de atividade**.
- Antes de entrar: prévia de câmera e microfone, e uma sugestão do app desktop ("Não, inicie no navegador").

#### SoWork por dentro (convidado no escritório público, 23/10/2026)

- Entrada como **convidado** com nome, avatar e prévia de câmera/microfone, com "Continuar sem câmera ou microfone" e um modo **Lite**.
- **Tutorial no cenário**: placas no próprio mundo ("1 · Use WASD ou clique com o botão direito para andar") e um
  elevador para os andares.
- **Três modos de visão**: Imersivo, **Simplificado** e **Auto**. O simplificado é uma planta isométrica
  esquemática: zonas coloridas por tipo (vermelho para reunião e auditório, verde para salas individuais, amarelo
  para mesas pessoais, azul para colaboração), nome da zona no chão e avatares como pinos com foto e status.
  **É a mesma linguagem visual da maquete do Office**, o que valida a direção.
- Trilho: Ver escritório, Chat, Calendário, **Biblioteca de reuniões**, **Insights**, **Criador de mapas**.
  Controles do mapa: **Centrar em mim**, **Ir para minha mesa**, modo, **Andares** e zoom.

#### O que entra no Office a partir disso
1. **Mini-mapa ao vivo** quando uma página está aberta (em vez de esconder o mundo).
2. **"Ir até"** em notificações (aprovação de agente, menção, reunião), levando o avatar até lá.
3. **Mesa própria** para cada pessoa e botão **Ir para minha mesa**. Zonas por cliente/time com cor por tipo de sala.
4. **Modo Auto**: a maquete detalhada no zoom de perto e a planta esquemática no zoom de longe.
5. **Tour guiado** no primeiro acesso, ensinando com os próprios funcionários de IA (acenar para a Vic, aprovar uma tarefa).
6. **Criação assistida**: layout e tamanho geram a planta (salas por funcionário e por cliente).

### SoWork
- Visual **2.5D isométrico**, com modo "simplificado" para quem prefere menos imersão. **Adotado**: o Office é
  isométrico, e os painéis funcionam como o modo simplificado.
- **Mapmaker** inspirado no The Sims. **Roadmap**: editor de planta.
- IA "Sophia": resumo de reuniões, transcrição e itens de ação enviados para ferramentas de projeto.
  **Adotado e ampliado**: no Office a IA não só resume, ela trabalha (edita vídeo, cria arte, escreve).
- Lobby para convidados e clientes. **Roadmap**.

As contas de teste foram criadas por uma pessoa (o agente não cria contas em serviços de terceiros). A análise
das telas internas está nas seções "por dentro" abaixo.

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
