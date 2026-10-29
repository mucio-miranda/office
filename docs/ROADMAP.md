# Roadmap

## ✅ v0.1: fundação (23/10/2026)
- Escritório 3D isométrico com 7 salas, colisão, teleporte, minimapa e busca `Ctrl+K`
- Vários escritórios, convite por código e presença em tempo real na rede local
- Demandas (kanban, prioridade, prazo, responsável humano ou IA, cronômetro)
- Calendário com eventos e prazos das demandas
- Financeiro e métricas: MRR, receita, despesa, resultado, a receber, custo de IA, horas por cliente e fluxo de caixa
- 4 funcionários de IA (vídeo, design, copy, gerente/contador) rodando no Claude Code headless, com aprovação
- Engine de vídeo por timeline JSON com estúdio na UI e CLI para os agentes

## ✅ v0.1.1: visual minimalista (23/10/2026)
- Redesign no estilo Paperclip: tokens neutros, tema claro e escuro, sidebar, páginas e entrada com arte ASCII
- Maquete 3D monocromática (piso sem iluminação + sombra suave, paredes baixas, peões)
- Seletor de pastas navegável (máquina local e pastas do escritório) em todos os campos de caminho

## ✅ v0.2.0: app de Windows (23/10/2026)
- App Electron com servidor embutido, bandeja, atalho global, notificações nativas, seletor de pastas nativo,
  tela cheia, iniciar com o Windows, abrir no Explorer e instalador NSIS com atualização automática

## ✅ v0.2.3: modo drone (23/10/2026)
- `Espaço` + arrastar (ou botão do meio) sobrevoa o escritório; `Esc` / "Voltar para mim" recentraliza

## 🔜 v0.2: o escritório ganha vida, por etapas
Cada etapa sai como um release próprio, testado, e o app instalado se atualiza sozinho.

1. ✅ **Ir até e mini-mapa ao vivo (v0.2.4)**: "Ir até" nos avisos, na busca, no mapa e no painel do
   funcionário; lista de quem está online; aviso quando alguém entra; mini-mapa flutuando sobre as páginas
2. ✅ **Mesa própria (v0.2.5)**: cada pessoa escolhe uma mesa no espaço aberto, "Ir para minha mesa" (`M`),
   o nome e o status ficam na mesa quando você está longe ou ausente
3. ✅ **Tour guiado (v0.2.6)**: no primeiro acesso a Rafa apresenta o escritório, as salas, os atalhos e como
   delegar a primeira demanda (refaça pelo `Ctrl+K` → "Tour do escritório")
4. ✅ **Ferramentas criativas por funcionário (v0.3.0)**: servidores MCP por agente, com PhotoCraft/VectorCraft
   (Duda), FilmCraft (Vic) e OfficeCLI (Theo e Rafa), configurados e testados com tarefas reais (arte PNG/PSD,
   ícone SVG, vídeo 1080x1920, proposta DOCX e planilha XLSX); instalação com um clique e SHA256 conferido
## 🔜 A agência dentro do Office, por etapas
A ideia: você passa um cliente novo, a equipe de IA pede o briefing, divide o trabalho entre os funcionários, usa o
que já está na pasta do cliente (ensaio, IDV, logos), pede aprovação no ponto certo e entrega no calendário, como uma
agência de verdade: o humano é o diretor de arte, a IA é o estagiário. Tudo com software open source e ligado ao mapa.

5. ✅ **Suíte Craft e modo ao vivo (v0.3.1)**: EffectCraft, SoundCraft (Vic), LightCraft, DesignCraft (Duda) e
   PdfCraft (Theo e Rafa) no catálogo; **ao vivo**: o app abre na tela, a IA opera a janela pela ponte MCP, o painel
   do funcionário espelha a tela a cada segundo (Ampliar, Assumir, Fechar app) e o monitor da mesa e a TV da ilha de
   vídeo mostram a edição no mapa; testado com tarefas reais no PhotoCraft (PSD + PNG) e no FilmCraft (projeto + MP4)
6. ✅ **Ilha de edição ao vivo (v0.3.2)**: legendas automáticas com whisper.cpp (large-v3-turbo + Silero VAD,
   tempo por palavra, realinhado quando o VAD corta os silêncios) direto na timeline, prévia rápida em 540p,
   exportação para OpenTimelineIO (Kdenlive, DaVinci), XML FCP7 (Premiere, DaVinci), MLT (Shotcut) e SRT (CapCut),
   "Na ilha agora" no estúdio e a TV da ilha abrindo o app ao vivo; Vic com EffectCraft e SoundCraft e os
   comandos `legendas`, `previa` e `exportar`; o Whisper se instala pelo Office com SHA256 conferido. O rascunho
   nativo do CapCut ficou de fora: o formato é fechado e muda a cada versão, então o CapCut recebe o SRT
6b. ✅ **Mundo em pixel art (v0.3.3)**: tema Pixel isométrico 2:1 (padrão), estudado no Habbo e no Gather e desenhado
   do zero por código: render em baixa resolução ampliado sem suavizar, sombreamento em 3 tons, contorno escuro (que
   acende no hover), pisos por sala, paredes do fundo altas com janelas, móveis detalhados, decoração (bebedouro,
   geladeira, máquina de lanches, tripé com ring light, cavalete, cabideiro), avatares em blocos e etiquetas em pílula;
   a maquete minimalista continua a um clique
6c. ✅ **Modo Decorar (v0.3.4)**: catálogo de mobis com miniaturas (69 peças em 10 categorias, inspiradas
   nos melhores quartos do Habbo e nos escritórios de Google, Nubank, iFood, Apple e Pixar), grade no piso, prévia
   verde ou vermelha, mover, girar, cores, duplicar, remover, desfazer e refazer, itens de parede que deslizam pelas
   paredes do fundo e decoração padrão nova; salva no servidor e sincroniza ao vivo; avatares com penteados e óculos
6d. ✅ **Visual detalhado e pisos (v0.4.2)**: pixel art a 1:1 como nos quartos do Habbo, contorno num tom escuro da
   cor de cada material, 4 tons de luz, assoalho de tábuas e lambri ripado a 32 px por metro, folhagem arredondada
   com folhas miúdas e flores, recepção biofílica (árvore no centro, sofás orgânicos, jardineiras, divisória verde,
   plantas suspensas), quadro de musgo e a aba Pisos (12 materiais aplicados por sala). Falta: avatares no mesmo
   nível de detalhe
6e. ✅ **Andar aberto (v0.4.3)**: planta 1,5× maior (54 × 36 m) e sem paredes internas, como nos escritórios
   grandes; só a sala de reunião e a ilha de vídeo continuam fechadas, e divisórias verdes e tapetes marcam as
   áreas. Decorações salvas na planta antiga são convertidas sozinhas. Entrada com animação ASCII nova (objetos
   de escritório que cruzam a tela e deixam rastro), mais perto da proposta do Paperclip
   Na v0.4.4: pisos padrão de todas as salas a 32 px por metro (carpete em placas, carpete felpudo, porcelanato,
   borracha de estúdio e ladrilho xadrez) e o clique para andar mais firme (folga nas quinas, rota refeita se o
   avatar esbarrar e marca no chão no destino)
   Na v0.4.5: clique como no Habbo, com o cursor quadrado de 1 m seguindo o mouse pelo chão, o ladrilho do
   destino marcado até a chegada e o avatar andando só reto ou na diagonal da grade
7. ✅ **Cliente e esteira (v0.4)**: cliente novo com entrevista de briefing, pasta no padrão REZZU com índice de
   arquivos (ensaio, logo, IDV, brutos), demandas em etapas (briefing → pauta → copy → arte/vídeo → aprovação →
   agendado) passando sozinhas de um funcionário para outro, aprovação humana ou da IA configurável por cliente.
   Feito: página Clientes, entrevista de briefing pelo chat com o gerente (grava o BRIEFING.md e sugere as
   demandas), índice da pasta com miniaturas, esteira com histórico por etapa, Aprovar / Pedir ajustes, revisão
   pela IA com até duas voltas e limite de tarefas por demanda
8. ✅ **Mesa do diretor de arte e agendamento: o MVP (v0.5.0)**: cada etapa registra os arquivos que produziu e a
   versão; a mesa mostra as peças por etapa e versão (imagem, vídeo e texto), e o pedido de ajuste leva áreas
   marcadas na imagem (em porcentagem, que o funcionário lê) para uma versão nova gravada ao lado da anterior.
   A peça aprovada é agendada (data, redes, legenda puxada da copy): evento no calendário, pacote `PUBLICAR/…/POST.md`
   na pasta do cliente, aviso na hora de postar e "Marcar como publicado". Com isso o ciclo da agência fecha de
   ponta a ponta: cliente → briefing → demandas → esteira → revisão → agendamento → publicado.
   Falta: edição ao vivo da área marcada no PhotoCraft e no LightCraft
9. **Publicação automática (v0.5.1)**: [Postiz](https://github.com/gitroomhq/postiz-app) (AGPL-3.0) rodando junto,
   recebendo os posts agendados pelo Office; as contas dos clientes são conectadas por vocês no próprio Postiz
10. **Arquivo no mapa (v0.5.2)**: armário por cliente nas salas, documentos como marcadores no mapa e visualização
    no Office (PdfCraft para editar)
11. **Vida no escritório**: sons à moda do Gather, o gerente aplica direto as demandas que sugere (um clique) e o
    modo Auto (maquete de perto, planta esquemática de longe)
12. **Editor de planta**: arrastar móveis, criar salas, temas e vários andares

## 🧭 v0.3: equipe e integrações
- [ ] Voz e vídeo por proximidade (WebRTC/LiveKit) e salas de reunião com porta
- [ ] Google Calendar (status inteligente) e Notion/Trello (espelhar quadros)
- [ ] Lobby de clientes com acesso só à aprovação das peças deles
- [ ] Permissões por papel (dono, membro, convidado) nas ações dos agentes
- [ ] Hooks do Claude Code para mostrar no mundo as sessões que você abre no terminal (como o Pixel Agents)

## 🚀 Depois
- [ ] Servidor na internet (túnel ou VPS) com HTTPS e login de verdade
- [ ] Marketplace de funcionários (modelos `.md`) e de skills
- [ ] Servidor MCP do Office: qualquer agente pode ler e escrever demandas e timelines
