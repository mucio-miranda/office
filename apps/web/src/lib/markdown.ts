import { Marked } from 'marked';
import DOMPurify from 'dompurify';

/** Parece um caminho de arquivo/pasta: C:\..., \\servidor\..., ou relativo com barra invertida (espaços valem). */
const PATH_RE = /^([a-z]:[\\/]|\\\\|[^`<>|\n]*[^\s`<>|\n]\\)/i;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // código inline que é um caminho ganha data-path: a UI transforma em "abrir no Explorer"
    codespan({ text }) {
      const raw = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      return PATH_RE.test(raw) ? `<code class="path" data-path="${escape(raw)}" title="Abrir no Explorer">${text}</code>` : `<code>${text}</code>`;
    },
    link({ href, text }) {
      return `<a href="${escape(href)}" target="_blank" rel="noreferrer">${text}</a>`;
    },
  },
});

/** Markdown do agente → HTML seguro (tabelas, listas, títulos, código, citações, links). */
export function renderMarkdown(src: string) {
  const html = md.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-path'] });
}
