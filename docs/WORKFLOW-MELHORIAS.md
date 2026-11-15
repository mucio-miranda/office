# Melhorias de workflow a partir do uso real (15/11/2026)

Base: sessão de 14-15/11 no Claude Code com o site do Dr. Alex Laurentino (critique, ajustes, troca de fotos das
"Quatro etapas" com tunning), o carrossel do Múcio e as ideias da DM. É o mesmo ritmo dos outros clientes e o que
vai migrar para o Office. Cada item diz o que aconteceu, o que custou e o que o Office deveria fazer.

## Prioridade 1: o que mais se repetiu

### 1. Escolha entre opções como peça nativa da Mesa
- **Hoje:** para cada troca de foto eu monto uma folha JPG com opções numeradas (1A, 1B, 2A...) e uma linha de
  contexto (as peças vizinhas), abro na tela e o diretor responde "2B" no chat.
- **Custo:** a folha é refeita à mão a cada vez. Houve erro de leitura: apliquei a 3B quando a escolha era a 3C.
- **No Office:** a etapa entrega um conjunto de opções (arquivo + código + uma linha de motivo + "recomendada"). A Mesa
  mostra os cards, com as peças vizinhas ao lado (como fica no site, no feed ou no carrossel). Clicar em uma grava a
  escolha e a etapa continua sozinha. Com isso o erro de leitura some.

### 2. Tunning como ferramenta, não como passo manual
- **Hoje (por foto):** recorte base 4:5 em alta, cópia para uma pasta que o upload aceita, aba nova do ChatGPT,
  upload, prompt, espera, download pelo blob para Downloads, mover, comparação antes|depois e rosto a 100%. São cerca
  de 12 chamadas de ferramenta e uma aba que precisa ser fechada no fim.
- **No Office:** um comando `tunning <arquivo> [prompt]` que faz tudo isso e devolve à Mesa a comparação e o recorte
  do rosto. Regras: um post por chat e aba própria (já estão na arte-referencia).
- **Biblioteca de prompts por cliente:** o prompt da etapa 1 "ficou muito bom" e foi reaproveitado na etapa 2 trocando
  só o contexto. O Office deveria guardar o prompt aprovado em `marca.json` (ou num `PROMPTS.md` do cliente) e
  oferecer "mesmo tunning da peça X".

### 3. Diário de mudanças com desfazer
- **Hoje, a cada ajuste:** backup `_vNN-antes-<o que>-index.html`, o asset antigo para `_assets-sem-uso/<data>/`, o alt
  atualizado, uma linha no `REGISTRO.md` e o link do Drive. Tudo à mão; já estamos no `_v40`.
- **No Office:** cada pedido aplicado vira uma entrada (antes/depois, arquivos tocados, quem pediu, de qual conversa)
  com o botão **Desfazer** na Mesa. O `REGISTRO.md` é gerado a partir disso, não escrito.

### 4. Prévia do site dentro do Office
- **Hoje:** o servidor local foi encerrado por falta de memória. Abrir por `file://` quebra os links "/". Houve um
  "abriu não" e foi preciso confirmar o navegador padrão antes de abrir de novo.
- **No Office:** prévia embutida e leve (um servidor estático por projeto, que sobe e cai sob demanda), com
  screenshots automáticos em 1440 e 390 depois de cada mudança, anexados à entrada do diário. Com isso a pergunta
  "abriu?" deixa de existir.

### 5. Pedidos curtos no meio de uma tarefa
- **Hoje:** durante o tunning chegaram "deixe o botão da seção 2 igual aos demais" e "liste as skills de UI". Foram
  atendidos entre um passo e outro do tunning.
- **No Office:** um pedido curto que chega com uma tarefa longa rodando vira um card paralelo (outro funcionário, ou
  o mesmo em sessão lateral), sem quebrar o fluxo da principal. A "correção no meio do trabalho" da v0.10 continua
  só para o que muda a tarefa em curso.

## Prioridade 2: contexto do cliente que se perdeu ou foi recriado

### 6. Banco de fotos do cliente com códigos e etiquetas
- **Hoje:** criei um `indice.json` (OUT124, NOV03...) e folhas de contato fora do projeto, em `C:\REZZU-TEMP`. A
  procura por "sério, em reunião, sem logo da OAB" foi feita olhando folha por folha.
- **No Office:** o índice da pasta (que já existe, v0.4) ganha **códigos estáveis** e **etiquetas** geradas por visão
  uma vez só: expressão (sorrindo/sério), cenário (reunião, plenário, rua, estúdio), roupa (terno, beca), elementos
  proibidos e "já usada em". A busca fica "sério + reunião − usada".

### 7. Regras de imagem do cliente
Aprendidas nesta sessão, e que hoje só existem na conversa:
- criminalista: nada de sorriso em etapas de momento tenso; o que se quer passar é confiança, autoridade e empatia;
- a pasta `NOVL` é de outro advogado;
- evitar as fotos com o logo da OAB (OUT97–111);
- tunning padrão do Dr. Alex: luz quente lateral, fundo em penumbra, sem reflexo azul nos óculos.

**No Office:** um bloco `regras_imagem` no `marca.json`/BRIEFING, que o funcionário lê antes de sugerir fotos. O bloco
`Aprendizados:` (v0.10) deveria propor a gravação ali, com aprovação.

### 8. Link do Drive automático
- **Hoje:** para cumprir "mande o link, sempre", abro a busca do Drive no Chrome, leio o `data-id` e fecho a aba.
- **No Office:** o envio ao Drive (v0.11.7) devolve o ID e grava o link na entrega. O resumo final sempre traz o link.

### 9. Publicação como aprovação na Mesa
O deploy do site (Netlify, `scripts/preparar-deploy.py`) está parado esperando o "OK". Na Mesa, ele deveria ser um
botão **Publicar** com o que muda desde a última publicação (lista do diário, item 3) e um link para a versão no ar.

## Prioridade 3: equipe e recursos

### 10. Um funcionário de web
A Duda (designer) não tem as skills de site. Proposta: um funcionário **web** (sala design) com `referencia-web`,
`frontend-design`, `design-taste-frontend`, `site-imersivo`, `impeccable`, `extract-design-md`, `diagram-design` e
`retrato-autoridade`. O Copywriter ganha `humanizer`, `stop-slop` e `copy-editing`. A Duda ganha `edicao-criativa`, que
hoje está fora da lista dela.

### 11. Fila consciente de memória
O servidor local e processos de imagem caíram por falta de RAM. A fila (v0.10) deveria limitar os trabalhos pesados
(tunning, recorte, rembg, render) a um por vez e checar a memória livre antes de subir servidores.

### 12. Entregas na tela sem janelas soltas
O autopop abre cada folha numa janela do Windows. No Office, o equivalente é a peça aparecer na Mesa ou no painel
do funcionário, com aviso. O autopop fica só para quando a pessoa está no terminal.

## Para o conteúdo de dezembro (próximo uso)
O fluxo `start-conteudo` → `arte-referencia` já está bem amarrado. Do que aparece aqui, o que mais ajudaria já em
dezembro, nessa ordem: 1 (escolha na Mesa), 2 (tunning como ferramenta, com prompt salvo por cliente), 6 (banco de
fotos com etiquetas e "já usada") e 3 (diário com desfazer).
