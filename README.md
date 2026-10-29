<div align="center">

# 🏢 Office

### O escritório virtual onde seus funcionários de IA trabalham de verdade.

Ande por um escritório 3D, puxe uma demanda do quadro e entregue para a **Vic**, sua editora de vídeo de IA.<br/>
Ela abre os brutos do cliente, monta o corte, renderiza e **levanta a mão ✋** quando precisa da sua aprovação.

<br/>

![Licença MIT](https://img.shields.io/badge/licença-MIT-ff5c8a?style=for-the-badge)
![Node 22+](https://img.shields.io/badge/node-22%2B-7c5cff?style=for-the-badge&logo=node.js&logoColor=white)
![Claude Code](https://img.shields.io/badge/IA-Claude%20Code-d97757?style=for-the-badge)
![three.js](https://img.shields.io/badge/3D-three.js-22c3a6?style=for-the-badge&logo=three.js&logoColor=white)
![ffmpeg](https://img.shields.io/badge/vídeo-ffmpeg-3fa7ff?style=for-the-badge&logo=ffmpeg&logoColor=white)
![Local first](https://img.shields.io/badge/roda-100%25%20local-ffb020?style=for-the-badge)

<br/>

<img src="docs/img/escritorio-pixel.jpg" alt="Escritório em pixel art isométrica e andar aberto: recepção, redação, gerência, copa e design sem paredes entre si, sala de reunião e ilha de vídeo fechadas e funcionários de IA nas mesas" width="100%"/>

<img src="docs/img/modo-decorar.jpg" alt="Modo Decorar: catálogo de móveis na parte de baixo, com a peça escolhida seguindo o cursor sobre a grade do piso" width="100%"/>

</div>

---

<img src="docs/img/entrada.jpg" alt="Tela de entrada: formulário à esquerda e, à direita, objetos de escritório em arte ASCII cruzando a tela e deixando rastro" width="100%"/>

## ✨ Por que o Office existe

Escritórios virtuais como **Gather** e **SoWork** juntaram pessoas num espaço que parece um jogo.
Ferramentas de IA como o **Claude Code** já editam vídeo, criam arte, escrevem copy e mexem em arquivos.
Mas essas duas coisas ainda vivem em mundos separados.

**O Office junta as duas.** É um escritório navegável onde a equipe humana e os **funcionários de IA**
dividem o mesmo quadro de demandas, o mesmo calendário e as mesmas pastas de clientes. Cada funcionário é treinado
com **skills** e sabe usar as ferramentas do mercado (ffmpeg, Photoshop por script, Figma via MCP, pesquisa web...).

E roda **na sua máquina**: seus arquivos não saem dela, a equipe entra pela rede local e a IA usa a sua assinatura do Claude.

## 🎮 O que tem dentro

<table>
<tr>
<td width="50%" valign="top">

### 🗺️ Escritório 3D navegável
- **Pixel art isométrica** (padrão), inspirada nos mundos de pixel do Habbo e do Gather: câmera 2:1, contorno escuro, sombreamento em 3 tons, andar aberto de 54 × 36 m (só a sala de reunião e a ilha de vídeo têm paredes; divisórias verdes e tapetes separam as outras áreas), piso de tacos, carpetes e ladrilhos por área, paredes com papel de parede e janelas, avatares em blocos que andam, sentam e digitam e etiquetas de nome em pílula. Tudo desenhado por código, sem assets de terceiros
- **Modo Decorar** (<kbd>X</kbd> ou o botão Decorar), no espírito do catálogo de mobis do Habbo: 74 peças em 10 categorias, inspiradas em escritórios de startup (madeira clara e vidro da Apple Park, cabines acústicas, armários coloridos e bicicletas do Google, arquibancada e neon do Nubank, horta e escada vermelha do iFood, cabanas, tijolinho e bar de cereais da Pixar) e no lado biofílico (árvores e jardins internos das Amazon Spheres: sofá orgânico curvo, banco com jardineira, divisória verde, plantas suspensas e quadro de musgo). A aba **Pisos** troca o piso de uma sala inteira: tábuas de carvalho ou nogueira, parquet, cimento queimado, porcelanato, granilite, ladrilho hidráulico, deck, grama, pedra, carpete em placas e xadrez, com prévia ao passar o mouse. Clique para selecionar, arraste para mover, <kbd>R</kbd> gira, troca de cor, duplicar, remover e desfazer (<kbd>Ctrl</kbd>+<kbd>Z</kbd>). A peça fica verde onde cabe e vermelha onde bloquearia uma porta, uma cadeira ou outro móvel; quadros, neons e revestimentos deslizam pelas paredes. A decoração é salva no servidor e aparece na hora para todo mundo do escritório
- Ou a **maquete isométrica minimalista** (botão ao lado do tema ou `Ctrl+K` → "Mundo em maquete"), em tema claro e escuro, com as mesmas 7 salas: recepção, gerência, ilha de vídeo, estúdio de design, redação, sala de reunião e copa
- **WASD** ou clique para andar (o avatar contorna paredes e móveis até o ponto clicado, marcado no chão), **Shift** para correr, **1–7** para teletransportar
- **Ctrl+K**: vá para qualquer sala, painel, cliente, demanda ou funcionário
- Minimapa clicável, chat geral ou da sala, status (🎧 foco, ⛔ ocupado, 💤 ausente) e emotes
- **Ir até**: um clique no aviso, no mapa, na lista de quem está online ou no `Ctrl+K` leva você até a pessoa ou o funcionário que chamou
- **Mesa própria**: chegue perto de uma mesa livre e aperte **E**; **M** leva você de volta a ela, você entra no escritório já sentado e, quando sai, a plaquinha mostra que está fora
- **Tour guiado**: no primeiro acesso a gerente (Rafa) apresenta as salas, a equipe de IA, a sua mesa, os atalhos e como delegar a primeira demanda; refaça quando quiser pelo `Ctrl+K` → "Tour do escritório"
- **Mini-mapa ao vivo** flutuando sobre as páginas: você vê o escritório enquanto trabalha nas demandas
- Chegue perto de um móvel e aperte **E**: o quadro abre as demandas, o cofre abre o financeiro e a TV abre o estúdio de vídeo

</td>
<td width="50%" valign="top">

### 🤖 Funcionários de IA
- **Vic** · editor(a) de vídeo · **Duda** · designer · **Theo** · copy e estratégia · **Rafa** · gerente e contador
- Cada um é uma sessão do **Claude Code headless**, rodando na pasta do escritório e respeitando o seu `CLAUDE.md` e as suas skills
- O avatar digita ⌨️ enquanto trabalha e **levanta a mão ✋** quando precisa de aprovação
- Você responde pelo chat e ele **continua a mesma sessão**
- Comandos destrutivos ficam **sempre bloqueados**, e o custo de cada tarefa aparece em US$
- **Ferramentas criativas por MCP**: a Duda usa o PhotoCraft e o VectorCraft, a Vic usa o FilmCraft e o Theo e a Rafa usam o OfficeCLI, sempre presos às pastas do escritório

</td>
</tr>
<tr>
<td valign="top">

### 🗂️ Gestão de demandas
- Kanban: Backlog → A fazer → Em produção → Aprovação → Entregue
- Cliente, tipo, prioridade, prazo e responsável (pessoa **ou** IA)
- **Cronômetro** por demanda (▶/⏸) que alimenta as horas por cliente
- **🤖 Delegar**: escolha o funcionário, e o briefing e a pasta do cliente vão juntos
- **Esteira**: pauta → copy → arte ou vídeo → aprovação → pronto para agendar. Cada etapa passa sozinha para o
  próximo funcionário, levando o briefing, o índice da pasta e o resumo das etapas anteriores
- **Aprovação por cliente**: uma pessoa (Aprovar / Pedir ajustes) ou o gerente de IA, que confere a peça com o
  briefing e devolve para ajuste até duas vezes antes de chamar alguém

### 🧾 Clientes
- **Cliente novo** cria a pasta no padrão da casa (`CLIENTES\<NOME>` com DOCUMENTOS, FOTOS e VIDEOS); só cria
  as pastas que faltam, nada é movido nem apagado
- **Entrevista de briefing**: o gerente de IA lê a pasta, pergunta o que falta pelo chat, grava o `BRIEFING.md`
  e sugere as primeiras demandas
- **Índice de arquivos**: ensaio, logos, identidade visual, brutos, referências e editados, com miniaturas

</td>
<td valign="top">

### 💰 Contador e métricas
- MRR, receita, despesas, resultado do mês, valores a receber
- Fluxo de caixa de 6 meses e horas gastas por cliente
- **Custo de IA** do mês, somado das sessões do Claude Code
- Demandas atrasadas e entregues no mês
- O botão **"Pedir análise ao gerente"** manda os números reais para o Rafa, que devolve margem, inadimplência e ações

</td>
</tr>
<tr>
<td valign="top">

### 📅 Calendário
- Mês inteiro com reuniões, gravações e entregas
- Os prazos das demandas aparecem no dia com ⏰
- A lista de próximos eventos fica sempre à vista

</td>
<td valign="top">

### 👥 Multi-escritório e multiusuário
- Crie **quantos escritórios quiser**, cada um com a própria pasta raiz e os próprios funcionários
- Convide a equipe com um **código**: quem estiver na mesma rede abre `http://SEU-IP:4747`
- Presença em tempo real, e você vê os colegas andando pelo escritório

</td>
</tr>
</table>

## 🎬 Engine de vídeo com timeline

<img src="docs/img/estudio-video.jpg" alt="Estúdio de vídeo: prévia vertical, inspetor de clipe e trilhas de vídeo, legendas, sobreposições e áudio" width="100%"/>

A engine do Office descreve uma edição inteira num **JSON**, e é esse JSON que liga humanos e IA:

- A **UI** edita a timeline: arrastar para cortar, mover legendas, trocar transições, ajustar a cor
- A **IA** escreve o mesmo JSON e manda renderizar pela CLI
- O **ffmpeg** renderiza tudo num único `filter_complex`, com progresso em tempo real

```jsonc
{
  "name": "reels-depoimento",
  "width": 1080, "height": 1920, "fps": 30,
  "video": [
    { "id": "a", "src": "../BRUTOS/take1.mp4", "in": 2.4, "out": 6.1, "keepAudio": true, "zoom": { "from": 1, "to": 1.12 } },
    { "id": "b", "src": "../BRUTOS/broll.mp4", "in": 0, "out": 3, "speed": 1.5, "transition": { "type": "flash", "duration": 0.3 } },
    { "id": "c", "src": "../BRUTOS/take2.mp4", "in": 1, "out": 4, "reverse": true, "transition": { "type": "whip-esquerda", "duration": 0.3 } }
  ],
  "audio":    [{ "id": "m", "src": "../MUSICAS/trilha.mp3", "volume": 0.3, "fadeIn": 0.5, "fadeOut": 1.5 }],
  "overlays": [{ "id": "logo", "src": "../../DOCUMENTOS/LOGOS/logo.png", "start": 8, "end": 10, "y": 0.85, "width": 0.35 }],
  "captions": { "style": "rezzu", "items": [{ "start": 0.2, "end": 1.6, "text": "Isso mudou meu negócio" }] },
  "output":   { "voiceOnly": true }
}
```

```bash
npx tsx packages/video-engine/src/cli.ts timeline.json saida.mp4             # render final
npx tsx packages/video-engine/src/cli.ts legendas timeline.json              # legendas com o Whisper
npx tsx packages/video-engine/src/cli.ts previa timeline.json previa.mp4     # prévia rápida em 540p
npx tsx packages/video-engine/src/cli.ts exportar timeline.json otio         # otio | fcp7 | mlt | srt
```

| Recurso | Detalhe |
|---|---|
| Transições estilo CapCut | `corte` `fade` `fadeblack` `flash` `blur` `zoom` `whip-esquerda` `whip-direita` `slide-cima` `slide-baixo` `circulo` `pixel` `radial` `dissolve` |
| Clipes | in/out, velocidade 0,1×–8× (com áudio acompanhando), reverse, zoom suave, brilho, contraste, saturação e gama |
| Legendas | `rezzu` (caixa alta com contorno), `classica`, `karaoke` (palavra acende) e `caixa` |
| Legendas automáticas | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) com o modelo large-v3-turbo e o Silero VAD, **nesta máquina**: tempo por palavra, quebra em pausa e pontuação, direto na faixa de legendas (instale em **Equipe → Ferramentas criativas**) |
| Prévia rápida | o mesmo render em 540p com encoder ultrarrápido, para conferir cortes e legendas antes do final |
| Exportar | [OpenTimelineIO](https://opentimeline.io) (Kdenlive, DaVinci), XML FCP7 (Premiere, DaVinci), MLT ([Shotcut](https://shotcut.org)) e SRT (CapCut): cortes, velocidade, transições como dissolve, trilhas e imagens |
| Ilha ao vivo | apps do FilmCraft, EffectCraft e SoundCraft abertos pelos funcionários aparecem em **Na ilha agora**, no estúdio, e na TV da ilha de vídeo, no mapa |
| Áudio | voz dos clipes no ponto exato, trilhas com fade, mixagem com limitador |
| Saída | MP4 H.264, opcionalmente também a versão **só voz**. **Nunca sobrescreve** (`_v1`, `_v2`...) e o `.timeline.json` fica ao lado |

## 🧠 Como um funcionário de IA trabalha

<img src="docs/img/funcionario-ia.jpg" alt="Painel do funcionário Theo com histórico da tarefa, ferramentas usadas e resumo final" width="100%"/>

```mermaid
sequenceDiagram
  participant Você
  participant Office
  participant Claude as Claude Code (headless)
  participant Pasta as Pasta do cliente
  Você->>Office: 🤖 Delegar "Reels do depoimento" para a Vic
  Office->>Claude: claude -p --output-format stream-json (cwd = pasta do escritório)
  Claude->>Pasta: lê CLAUDE.md, skills, brutos e referências
  Claude-->>Office: ⌨️ ferramentas e mensagens em tempo real
  Claude-->>Office: "Escolhi estes 3 takes" + [[AGUARDANDO_APROVACAO]]
  Office-->>Você: ✋ a Vic precisa de você
  Você->>Office: "Aprovado, pode seguir"
  Office->>Claude: --resume (mesma sessão)
  Claude->>Pasta: timeline.json → office-render → reels_v1.mp4
  Office-->>Você: ✅ demanda vai para "Aprovação"
```

Os funcionários são **arquivos Markdown** em [`agents/`](agents/). Para criar um novo (social media, tráfego pago,
roteirista, atendimento...), copie um arquivo, escreva a persona e liste as skills e as ferramentas permitidas.

### 🧰 Ferramentas criativas (MCP)

Programas open source que os funcionários operam por MCP, sem interface ou **ao vivo**, com o app aberto na tela:

| Ferramenta | No lugar do | Quem usa | O que faz | Ao vivo |
|---|---|---|---|---|
| [PhotoCraft](https://github.com/storytold/photocraft) | Photoshop | Duda | Imagens e PSD com camadas, máscaras, ajustes e exportação | ✅ |
| [VectorCraft](https://github.com/storytold/vectorcraft) | Illustrator | Duda | SVG, PDF e `.ai`: logos, ícones e layouts | ✅ |
| [LightCraft](https://github.com/storytold/lightcraft) | Lightroom | Duda | Tratamento de foto sem tocar no original, presets, exportação em lote | ✅ |
| [DesignCraft](https://github.com/storytold/designcraft) | InDesign | Duda | Diagramação: carrosséis, materiais e PDF | ✅ |
| [FilmCraft](https://github.com/storytold/filmcraft) | Premiere | Vic | Edição de vídeo: sequência, cortes, cor, mixagem, legendas e exportação | ✅ |
| [EffectCraft](https://github.com/storytold/effectcraft) | After Effects | Vic | Motion graphics, títulos e legendas animadas | ✅ |
| [SoundCraft](https://github.com/storytold/soundcraft) | Pro Tools | Vic | Áudio: limpar voz, mixar trilha, loudness | ✅ |
| [PdfCraft](https://github.com/storytold/pdfcraft) | Acrobat | Theo e Rafa | Ler, anotar, juntar, dividir e preencher PDF | |
| [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) | Word, Excel e PowerPoint | Theo e Rafa | Cria e edita DOCX, XLSX e PPTX | |

- Em **Equipe → Ferramentas criativas** o dono do escritório vê o que está instalado e clica em **Instalar**: o Office baixa o
  release oficial do GitHub, **confere o SHA256 publicado** e guarda em `%LOCALAPPDATA%\Office\tools\<ferramenta>\<versão>`
  (outras plataformas: `~/.office/tools`, ou qualquer pasta no `PATH`; `OFFICE_TOOLS_DIR` muda o lugar).
- Cada tarefa sobe só os servidores do funcionário (`--mcp-config`), com leitura nas pastas do escritório e gravação **só
  na pasta raiz**. Nada é registrado na configuração global do Claude Code.
- No painel do funcionário dá para **ligar e desligar** cada ferramenta. No modelo `.md`, a lista fica em `mcp: [...]`.

#### 🔴 Modo ao vivo: a IA trabalha no app de verdade

Com **ao vivo** ligado (padrão: PhotoCraft da Duda e FilmCraft do Vic), a tarefa abre o app na tela do computador que roda o
Office, com um canal de controle local e um token novo por sessão, e o servidor MCP vira uma **ponte para a janela**. É o
diretor de arte e o estagiário: a IA edita, você assiste e pega o mouse quando quiser.

- **Espelho no Office**: o painel do funcionário mostra a tela do app, atualizada a cada segundo, com **Ampliar**,
  **Assumir** (traz a janela para a frente) e **Fechar app**. Quem está em outra máquina da rede assiste pelo espelho.
- **No mapa**: o monitor da mesa do funcionário e a TV da ilha de vídeo mostram a edição em andamento; clicar abre o painel.
- Quando a tarefa para, o app **continua aberto** com o arquivo, esperando a sua revisão. Responder no chat retoma na
  mesma janela.
- No máximo `OFFICE_LIVE_MAX` apps abertos ao mesmo tempo (padrão 2). Passou disso, a ferramenta roda sem janela.
- No modelo `.md`, a lista fica em `live: [...]`.

## 🖥️ App de Windows

O jeito mais completo de usar o Office é o **app de Windows**: o mesmo escritório, só que nativo.

- **Janela imersiva**, sem moldura de navegador, com **F11** para tela cheia
- Fica na **bandeja**, perto do relógio, pode **iniciar com o Windows** e abre com **Ctrl+Shift+O** de qualquer lugar
- **Notificações do Windows** quando um funcionário de IA precisa de você ou termina, e o ícone da bandeja fica laranja enquanto houver aprovação pendente
- **Seletor de pastas nativo** do Windows
- **Abrir e mostrar no Explorer** os vídeos renderizados e a pasta do escritório
- O servidor roda dentro do app: **a equipe continua entrando pelo navegador** em `http://SEU-IP:4747`
- Atualização automática pelos releases do GitHub

Baixe o `Office-Setup-x.y.z.exe` em [Releases](https://github.com/mucio-miranda/office/releases) ou gere o instalador você mesmo:

```bash
npm install
npm run desktop:dist     # gera apps/desktop/release/Office-Setup-<versão>.exe
npm run desktop          # ou abre o app em modo de desenvolvimento
```

## 🚀 Começando (versão web)

**Você precisa de:** [Node.js 22.13+](https://nodejs.org) · [ffmpeg](https://ffmpeg.org) no PATH (`winget install ffmpeg`) ·
[Claude Code](https://claude.com/claude-code) instalado e logado (`npm i -g @anthropic-ai/claude-code`).

```bash
git clone https://github.com/mucio-miranda/office.git
cd office
npm install
npm start            # compila a UI e sobe tudo em http://localhost:4747
```

Abra o navegador, entre com seu nome e **crie um escritório**, escolhendo (navegando, sem digitar) a pasta onde ficam
os seus clientes. Se essa pasta tiver um `CLAUDE.md` e `.claude/skills`,
os funcionários já chegam sabendo trabalhar do seu jeito.

Para desenvolver: `npm run dev` (UI com hot reload em `:5173`).

<details>
<summary><b>⌨️ Atalhos</b></summary>

| Tecla | Ação |
|---|---|
| `W A S D` / setas | andar (Shift corre) |
| clique no chão | ir até lá, desviando dos obstáculos |
| `Espaço` + arrastar | **modo drone**: sobrevoa o escritório sem mover o personagem (o botão do meio do mouse também arrasta) |
| dois dedos no touchpad | move a câmera para os lados e para cima/baixo, como no Figma (o personagem fica parado) |
| pinça no touchpad / roda do mouse | zoom (`Shift` + roda move para os lados) |
| `X` | modo Decorar |
| `Esc` | volta a câmera para você (ou fecha o painel) |
| `M` | ir para a sua mesa (sem mesa, leva até uma livre) |
| `E` | interagir com o que está perto |
| `1`–`7` | teletransportar para uma sala |
| `K` `B` `C` `F` `V` `G` `H` | clientes · demandas · calendário · financeiro · vídeo · equipe · atividade |
| `Ctrl+K` | busca rápida |
| `T` / `Enter` | conversar |
| `[` `]` | girar a câmera |
| roda do mouse | zoom |
| `Esc` | fechar painel |

</details>

<details>
<summary><b>⚙️ Configuração (variáveis de ambiente)</b></summary>

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `4747` | porta do servidor |
| `HOST` | `0.0.0.0` | use `127.0.0.1` para só esta máquina |
| `OFFICE_DATA` | `./data` | onde fica o banco |
| `OFFICE_MAX_JOBS` | `2` | quantos funcionários de IA trabalham ao mesmo tempo |
| `CLAUDE_BIN` | autodetectado | caminho do executável do Claude Code |
| `FFMPEG_BIN` / `FFPROBE_BIN` | `ffmpeg` / `ffprobe` | caminhos do ffmpeg |

</details>

<details>
<summary><b>🔒 Segurança</b></summary>

- Os funcionários rodam com `--permission-mode acceptEdits` e uma lista de ferramentas por funcionário.
- **Sempre negados**: `rm`, `del`, `rmdir`, `mv`, `move`, `ren`, `Remove-Item`, `Move-Item`, `Rename-Item`, `git push`,
  lixeira e compartilhamento do Google Drive e exclusão no Notion.
- O navegador de arquivos e o servidor de mídia só enxergam a pasta raiz do escritório e as pastas extras que você liberou.
- Renders nunca sobrescrevem arquivos.
- Na rede local, qualquer pessoa com o **código de convite** entra no escritório. Não exponha a porta na internet
  sem um proxy com HTTPS.

</details>

## 🏗️ Arquitetura

```
apps/server            Fastify + WebSocket + SQLite (node:sqlite) + runtime dos agentes
apps/web               React 19 + three.js (react-three-fiber) + zustand
packages/shared        tipos e protocolo em tempo real
packages/video-engine  timeline JSON → ffmpeg (biblioteca + CLI)
agents/                funcionários de IA em Markdown
```

Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). A pesquisa de mercado (Gather, SoWork, Pixel Agents,
AI Town, OpenCut...) está em [`docs/RESEARCH.md`](docs/RESEARCH.md).

## 🗺️ Roadmap

- [x] Escritório 3D, multi-escritório, presença na LAN
- [x] Demandas, calendário, financeiro e métricas
- [x] Funcionários de IA com Claude Code e aprovação
- [x] Engine de vídeo com timeline
- [x] Visual minimalista (estilo Paperclip) e seletor de pastas navegável
- [x] App de Windows, modo drone, "Ir até" e mini-mapa ao vivo
- [x] Mesa própria por pessoa
- [x] Tour guiado no primeiro acesso
- [x] Funcionários usando PhotoCraft, VectorCraft, FilmCraft e OfficeCLI via MCP
- [x] Suíte Craft completa e modo ao vivo (a IA opera o app aberto, a equipe assiste e assume)
- [x] Ilha de edição ao vivo, legendas com Whisper, prévia rápida e exportação para OTIO, Premiere, Shotcut e SRT
- [x] Mundo em pixel art isométrica (com a maquete minimalista como opção)
- [x] Modo Decorar com catálogo de móveis, salvo para o escritório todo
- [x] Visual detalhado em pixel art 1:1 (contorno na cor do material, assoalho e lambri de 32 px por metro, folhagem arredondada) e pisos por sala
- [x] Cliente novo com briefing, esteira de demandas entre funcionários e aprovação configurável
- [ ] Mesa do diretor de arte, publicação com Postiz e arquivo de documentos no mapa
- [ ] Sons do mundo, editor de planta e vários andares
- [ ] Voz e vídeo por proximidade
- [ ] Google Calendar, Notion e Trello
- [ ] Servidor MCP do Office

Lista completa em [`docs/ROADMAP.md`](docs/ROADMAP.md).

## 🤝 Contribua

O Office nasceu numa agência de marketing (a REZZU) para resolver um problema real:
coordenar pessoas e IA no mesmo fluxo. Ele é **open source** para evoluir com quem tem o mesmo problema.

Funcionários novos, móveis, transições, integrações, traduções: tudo é bem-vindo. Comece pelo [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 🙏 Inspirações

[Gather](https://gather.town) e [SoWork](https://sowork.com) pela experiência de escritório virtual ·
[Paperclip](https://github.com/paperclipai/paperclip) pela estética e pela tela de entrada ·
[Pixel Agents](https://github.com/pablodelucca/pixel-agents) e [Claude-Office](https://github.com/W17ant/Claude-Office)
pela ideia de dar corpo aos agentes do Claude Code · [AI Town](https://github.com/a16z-infra/ai-town) pelo mundo
compartilhado entre agentes · [OpenCut](https://github.com/OpenCut-app/OpenCut), Motion Canvas e Revideo pela edição de vídeo programável.

## 📄 Licença

[MIT](LICENSE). Use, modifique, venda, só mantenha o aviso de copyright.

<div align="center"><br/><sub>Feito com ☕, ffmpeg e Claude no Brasil 🇧🇷</sub></div>
