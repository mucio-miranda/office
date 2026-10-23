# Contribuindo com o Office

Que bom que você quer ajudar! O Office é aberto para crescer com a comunidade.

## Ambiente

```bash
git clone https://github.com/mucio-miranda/office.git
cd office
npm install
npm run dev        # servidor em :4747 e UI em :5173 com hot reload
npm test           # testes (inclui render real se o ffmpeg estiver instalado)
npm run typecheck
```

Requisitos: Node 22.13+ (recomendado 24), ffmpeg/ffprobe no PATH e Claude Code instalado e logado (para os agentes).

## Onde mexer

- **Novo funcionário de IA**: crie `agents/<slug>.md` (veja `agents/README.md`). Não precisa de código.
- **Novo móvel ou sala**: `apps/web/src/office/layout.ts` (planta) e `Furniture.tsx` (modelo low-poly).
- **Nova transição ou efeito de vídeo**: `packages/video-engine/src/schema.ts` + `compile.ts` + um teste.
- **Novo painel**: `apps/web/src/panels/` + registro em `Panels.tsx` e no dock de `OfficeView.tsx`.

## Regras

- Código e textos da UI em **português do Brasil**. Comentários explicam o *porquê*.
- A engine de vídeo mantém `compile()` **puro** e testado.
- Nada que apague arquivo do usuário. Saídas são versionadas (`_v1`, `_v2`...).
- PR pequeno e focado, com descrição do que muda e como testar.
- Ao estudar produtos de terceiros, copie ideias e não código ou assets. De projetos MIT/Apache, dê crédito em `docs/RESEARCH.md`.
