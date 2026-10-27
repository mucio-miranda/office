# Funcionários de IA (modelos)

Cada arquivo `.md` aqui é um **modelo de funcionário**. Quando você cria um escritório, o Office copia estes
modelos para o banco do escritório, e cada um vira um avatar sentado na sua sala.

- O **frontmatter** define nome, cargo, sala, cor, skills, ferramentas e permissões (`allowedTools`).
- `mcp` lista as **ferramentas criativas** do funcionário (`photocraft`, `vectorcraft`, `lightcraft`, `designcraft`,
  `filmcraft`, `effectcraft`, `soundcraft`, `pdfcraft`, `officecli`): quando estão instaladas, cada tarefa sobe esses
  servidores MCP com as pastas do escritório.
- `live` lista as que ele usa **ao vivo**: o app abre na tela da máquina do servidor, a IA opera a janela pela ponte MCP
  e a equipe assiste pelo espelho no Office (e pode pegar o mouse). A equipe liga e desliga isso no painel do funcionário.
- O **corpo** é a persona: o jeito de trabalhar, que entra como prompt de sistema do Claude Code.
- Os funcionários rodam com `claude -p` (headless) **dentro da pasta raiz do escritório**, então também
  seguem o `CLAUDE.md` e as skills de `.claude/skills` dessa pasta.

Placeholders disponíveis no corpo: `{{OFFICE_NAME}}`, `{{OFFICE_ROOT}}`, `{{OFFICE_RENDER}}` (comando da engine
de vídeo), `{{APPROVAL_MARKER}}`, `{{TODAY}}`.

Para criar um funcionário novo, copie um arquivo, troque o `slug` e mande um PR.
