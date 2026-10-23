import type { Timeline } from './schema.ts';

type Captions = NonNullable<Timeline['captions']>;

/** #RRGGBB -> &H00BBGGRR (formato de cor do ASS). */
export function assColor(hex: string, alpha = 0) {
  const h = hex.replace('#', '').padEnd(6, '0');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, '0')}${b}${g}${r}`.toUpperCase();
}

export function assTime(s: number) {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');

/**
 * Gera o arquivo .ass das legendas.
 * Estilos:
 *  - rezzu: caixa alta, negrito, contorno grosso (padrão de Reels da agência)
 *  - classica: branca com sombra leve
 *  - karaoke: palavra a palavra acendendo na cor de destaque
 *  - caixa: texto sobre faixa sólida
 */
export function buildAss(t: Timeline, c: Captions) {
  const marginV = Math.round(t.height * (1 - c.y));
  const primary = assColor(c.primary);
  const highlight = assColor(c.highlight);
  const black = assColor('#000000');
  const box = c.style === 'caixa';
  const style = [
    'Default', c.font, c.size,
    c.style === 'karaoke' ? highlight : primary, // PrimaryColour (karaoke: cor depois de "acender")
    primary, // SecondaryColour
    black, // OutlineColour
    box ? assColor('#000000', 0x40) : assColor('#000000', 0x80), // BackColour
    c.style === 'classica' ? 0 : -1, // Bold
    0, 0, 0, 100, 100, 0, 0,
    box ? 3 : 1, // BorderStyle (3 = caixa opaca)
    c.style === 'rezzu' ? 6 : c.style === 'karaoke' ? 5 : box ? 12 : 2, // Outline
    c.style === 'classica' ? 2 : 0, // Shadow
    2, // Alignment (base, centro)
    Math.round(t.width * 0.08), Math.round(t.width * 0.08), marginV, 1,
  ].join(',');

  const lines = c.items.map((it) => {
    let text = c.style === 'rezzu' ? it.text.toUpperCase() : it.text;
    if (c.style === 'karaoke') {
      const words = text.split(/\s+/).filter(Boolean);
      const per = Math.max(1, Math.round(((it.end - it.start) * 100) / Math.max(1, words.length)));
      text = words.map((w) => `{\\k${per}}${escapeText(w)}`).join(' ');
    } else {
      text = escapeText(text);
    }
    // pequena entrada com escala (pop) para os estilos de Reels
    const pop = c.style === 'rezzu' || c.style === 'karaoke' ? '{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}' : '';
    return `Dialogue: 0,${assTime(it.start)},${assTime(it.end)},Default,,0,0,0,,${pop}${text}`;
  });

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${t.width}`,
    `PlayResY: ${t.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${style}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines,
    '',
  ].join('\n');
}
