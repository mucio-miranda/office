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
5. **Estúdio de vídeo turbinado (v0.3.1)**: transcrição com Whisper gerando legendas na timeline, prévia rápida
   em baixa resolução e exportação para CapCut (`draft_content.json`) e Premiere (XML)
6. **Vida no escritório (v0.3.2)**: sons à moda do Gather, o gerente aplica direto as demandas que sugere
   (um clique) e o modo Auto (maquete de perto, planta esquemática de longe)
7. **Editor de planta (v0.4)**: arrastar móveis, criar salas, temas e vários andares

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
