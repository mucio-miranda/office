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

## 🔜 v0.2: o escritório ganha vida
- [ ] Ferramentas MCP por funcionário: PhotoCraft/VectorCraft (Duda), FilmCraft (Vic), OfficeCLI (Theo e Rafa)
- [ ] Sons (passos por piso, aceno, mão levantada, mensagem), à moda do Gather
- [ ] Editor de planta (arrastar móveis, criar salas, temas) e vários andares
- [ ] Prévia rápida da timeline (render em baixa resolução) e player com a sequência completa
- [ ] Transcrição com Whisper dentro do estúdio, gerando legendas automáticas na timeline
- [ ] Exportar para rascunho do CapCut (`draft_content.json`) e XML do Premiere
- [ ] O gerente aplica direto as demandas que sugere (bloco JSON → um clique)

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
- [ ] App desktop (Electron/Tauri) com bandeja e notificações
