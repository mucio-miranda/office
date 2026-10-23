# Office: notas para quem usa Claude Code neste repositório

- Projeto em **português do Brasil** (código, UI, commits e docs).
- Monorepo npm workspaces: `apps/server`, `apps/web`, `packages/shared`, `packages/video-engine`, `agents/`.
- Rodar: `npm run dev` · testar: `npm test` · tipos: `npm run typecheck`.
- `packages/video-engine/src/compile.ts` é uma função pura; toda mudança nela vem com teste em `engine.test.ts`.
- Funcionários de IA são Markdown em `agents/`; regras comuns em `agents/_regras-da-casa.md`.
- Nunca adicionar código que apague arquivos do usuário; saídas de render são versionadas.
- Arquitetura em `docs/ARCHITECTURE.md`, pesquisa em `docs/RESEARCH.md`.
