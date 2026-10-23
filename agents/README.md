# Funcionários de IA (modelos)

Cada arquivo `.md` aqui é um **modelo de funcionário**. Quando você cria um escritório, o Office copia estes
modelos para o banco do escritório, e cada um vira um avatar sentado na sua sala.

- O **frontmatter** define nome, cargo, sala, cor, skills, ferramentas e permissões (`allowedTools`).
- O **corpo** é a persona: o jeito de trabalhar, que entra como prompt de sistema do Claude Code.
- Os funcionários rodam com `claude -p` (headless) **dentro da pasta raiz do escritório**, então também
  seguem o `CLAUDE.md` e as skills de `.claude/skills` dessa pasta.

Placeholders disponíveis no corpo: `{{OFFICE_NAME}}`, `{{OFFICE_ROOT}}`, `{{OFFICE_RENDER}}` (comando da engine
de vídeo), `{{APPROVAL_MARKER}}`, `{{TODAY}}`.

Para criar um funcionário novo, copie um arquivo, troque o `slug` e mande um PR.
