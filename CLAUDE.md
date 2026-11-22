# Office: notas para quem usa Claude Code neste repositório

- Projeto em **português do Brasil** (código, UI, commits e docs). Responder sempre em português.
- Monorepo npm workspaces: `apps/server` (Fastify, `node:sqlite`), `apps/web` (React/Vite/three), `apps/desktop` (Electron), `packages/shared`, `packages/video-engine`, `agents/`.
- Rodar: `npm run dev` · testar: `npm test` · tipos: `npm run typecheck`.
- `packages/video-engine/src/compile.ts` é uma função pura; toda mudança nela vem com teste em `engine.test.ts`.
- Funcionários de IA são Markdown em `agents/`; regras comuns em `agents/_regras-da-casa.md`.
- Nunca adicionar código que apague arquivos do usuário; saídas de render são versionadas.
- Arquitetura em `docs/ARCHITECTURE.md`, pesquisa em `docs/RESEARCH.md`.
- **Commits sem `Co-Authored-By` e sem rodapé de atribuição** (regra do dono).

## Conferir antes de publicar

- Servidor: `cd apps/server && npx tsx --test src/routes/*.test.ts src/agents/*.test.ts src/clients/*.test.ts src/*.test.ts` (todos devem passar).
- Tela: `cd apps/web && npx tsc -p . --noEmit --noUnusedLocals && npm run build`.
- Os testes usam banco temporário (`OFFICE_DATA`). Nunca escrever no banco real do usuário (`%APPDATA%\Office\data\office.db`); para olhar dados reais, abrir só leitura.
- Quem programa **não vê a tela**: mudança visual do mapa se confere por script (`tsx` importando `apps/web/src/office/layout.ts`; não importar `lib/theme.ts` em script, ele precisa de navegador) e depois pelo usuário, com print.

## Publicar uma versão (só quando o usuário pedir)

1. Subir a versão em `apps/desktop/package.json` e a linha 27 do `package-lock.json`.
2. `git commit -am "vX.Y.Z: ..."` · `git tag vX.Y.Z` · `git push origin main vX.Y.Z`.
3. O GitHub Actions gera o instalador (`Office-Setup-X.Y.Z.exe`); conferir com `gh run watch` e `gh release view vX.Y.Z`.
4. O app instalado se atualiza sozinho ao abrir.

## Onde mexer

- Banco: lista de migrações em `apps/server/src/db.ts` (só acrescentar no fim, nunca editar uma antiga). Colunas voltam em camelCase no código.
- Funcionários rodando: `apps/server/src/agents/runtime.ts` (spawn do `claude -p` em stream-json, fila, trava de render, mensagens durante o trabalho); `pipeline.ts` (demandas, conversa do cliente, conversa nova automática, virada de mês); `daily.ts` (daily report do gerente); `usage.ts` (limite da assinatura); `office-hook.mjs` (gancho do Claude Code).
- Mapa: `apps/web/src/office/layout.ts` (planta, paredes em pedaços de 0,5 m, salas originais e novas, mesas, caminhos), `decor/` (modo Decorar e ferramenta Planta), `npc.ts` e `seats.ts` (rotina e lugares dos funcionários), `view.ts` (câmera), `lib/gamepad.ts` (controle de videogame).
- Regras e tipos compartilhados (planta, limites, modelos): `packages/shared/src/index.ts`.
