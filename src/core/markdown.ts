/**
 * A deliberately small Markdown subset, rendered to HTML (D27).
 *
 * Connections carry an argument for why two events belong together, and events
 * carry notes; both are Markdown per the data model. That needs a renderer, and
 * the choice was between a library plus a sanitiser and a subset written here.
 *
 * This is the subset, for one reason that outweighs the convenience: **raw HTML
 * is never passed through**. Every byte of input is escaped before any parsing
 * happens, and the output is assembled from a fixed set of tags this file emits
 * itself. There is no code path from input text to live markup, so there is
 * nothing for a sanitiser to get wrong later.
 *
 * That matters more than it looks. Notes are the unit the social layer plans to
 * share — "inherit or fork someone's connection with its explanation" — so a
 * note becomes untrusted text the moment that ships, and an imported file is
 * untrusted already. Escaping first makes that safe by construction rather than
 * by remembering to sanitise at each boundary.
 *
 * Supported: headings, paragraphs, `**bold**`, `*italic*`, `` `code` ``, links,
 * fenced and indented code, blockquotes, ordered and unordered lists, rules.
 * Not supported: tables, footnotes, images, reference links, inline HTML. Those
 * are absent because notes do not need them, not because they are hard.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  // Dropped, not escaped: NUL is the code-span placeholder below, and leaving it
  // in the text would let a note forge one and address the code array itself.
  '\u0000': '',
};

/** The single chokepoint. Everything entering the output passes through here. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"'\u0000]/g, (char) => ESCAPES[char] as string);
}

/**
 * Link schemes that may appear in an `href`.
 *
 * An allowlist, not a `javascript:` denylist: the ways to smuggle a script URL
 * past a denylist are numerous and well catalogued — tab and newline inside the
 * scheme, HTML entities, leading control characters — and the ways to write a
 * legitimate link are three. A rejected URL renders as plain text rather than
 * silently vanishing, so the user can see that it was not accepted.
 */
const SAFE_SCHEME = /^(?:https?:\/\/|mailto:|#|\/|\.{0,2}\/)/i;
const CONTROL_OR_SPACE = /[\u0000-\u0020]/;

function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  if (CONTROL_OR_SPACE.test(trimmed)) return null;
  return SAFE_SCHEME.test(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/** A character `escapeHtml` strips from the input, so it cannot be forged. */
const PLACEHOLDER = '\u0000';

/**
 * `[label](destination)`, with an optional `"title"` after the destination.
 *
 * The destination is either angle-bracketed — already escaped to `&lt;…&gt;` by
 * the time this runs — or bare, in which case it may carry one level of balanced
 * parentheses. That level is not pedantry: Wikipedia disambiguates with brackets
 * (`…/Battle_of_Lepanto_(1571)`), and stopping at the first `(` cut the href in
 * half and left the tail of the URL sitting in the prose.
 */
const LINK =
  /\[([^\]]*)\]\(\s*(?:&lt;([^\n]*?)&gt;|((?:[^()\s]|\([^()\s]*\))+))(?:\s+&quot;[^)]*&quot;)?\s*\)/g;

/**
 * Inline spans, over already-escaped text.
 *
 * Code first, and by placeholder: a span of code is literal by definition, so
 * `**` inside it has to survive the emphasis pass untouched. Substituting it out
 * and back is the cheapest way to say that in a single pass.
 */
export function renderInline(escaped: string): string {
  const code: string[] = [];
  let text = escaped.replace(/`+([^`]|[^`][\s\S]*?[^`])`+/g, (_, body: string) => {
    code.push(body.trim());
    return `${PLACEHOLDER}${code.length - 1}${PLACEHOLDER}`;
  });

  // Links before emphasis, so `[**a**](url)` puts the emphasis inside the anchor
  // rather than tearing the brackets apart.
  text = text.replace(
    LINK,
    (whole, label: string, angle: string | undefined, bare: string | undefined) => {
      const href = safeHref(unescapeHtml(angle ?? bare ?? ''));
      if (href === null) return whole;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
    },
  );

  text = text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![\w_])/g, '$1<em>$2</em>');

  return text.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'),
    (_, index: string) => `<code>${code[Number(index)] as string}</code>`,
  );
}

/** Only the entities `escapeHtml` produces, so a URL can be scheme-checked. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const FENCE = /^\s{0,3}(?:```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
/** `>` has already become `&gt;` by the time any block matcher runs. */
const QUOTE = /^\s{0,3}&gt;\s?(.*)$/;
const INDENTED_CODE = /^(?: {4}|\t)(.*)$/;

/**
 * Markdown to HTML.
 *
 * Line-oriented rather than a full two-phase CommonMark parse: notes are prose,
 * and the constructs that need the real algorithm — lazy continuation, nested
 * lists, setext headings — are not in the subset. Where this differs from
 * CommonMark it does so by rendering something plainer, never by rendering
 * something unsafe.
 */
export function renderMarkdown(source: string): string {
  if (source.trim().length === 0) return '';

  const lines = escapeHtml(source.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  const buffer: string[] = [];
  let i = 0;

  const paragraph = () => {
    if (buffer.length === 0) return;
    out.push(`<p>${renderInline(buffer.join('\n').trim())}</p>`);
    buffer.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i] as string;

    if (line.trim().length === 0) {
      paragraph();
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      paragraph();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] as string)) {
        body.push(lines[i] as string);
        i++;
      }
      i++; // the closing fence, or the end of the input
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    if (RULE.test(line)) {
      paragraph();
      out.push('<hr />');
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      paragraph();
      const level = (heading[1] as string).length;
      const text = renderInline((heading[2] as string).replace(/\s+#+\s*$/, ''));
      out.push(`<h${level}>${text}</h${level}>`);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      paragraph();
      const body: string[] = [];
      while (i < lines.length) {
        const quoted = QUOTE.exec(lines[i] as string);
        if (!quoted) break;
        body.push(quoted[1] as string);
        i++;
      }
      // Recursing gives a blockquote the same block vocabulary as the document,
      // which is what makes quoting a passage that contains a list work.
      out.push(`<blockquote>${renderMarkdown(unescapeHtml(body.join('\n')))}</blockquote>`);
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      paragraph();
      const ordered = ORDERED.test(line);
      const pattern = ordered ? ORDERED : BULLET;
      const items: string[] = [];

      while (i < lines.length) {
        const item = pattern.exec(lines[i] as string);
        if (!item) break;
        const parts = [item[1] as string];
        i++;
        // A wrapped line belongs to the item above it, so a long note does not
        // fragment into one bullet per editor line.
        while (
          i < lines.length &&
          (lines[i] as string).trim().length > 0 &&
          !BULLET.test(lines[i] as string) &&
          !ORDERED.test(lines[i] as string) &&
          !HEADING.test(lines[i] as string) &&
          !QUOTE.test(lines[i] as string) &&
          !FENCE.test(lines[i] as string)
        ) {
          parts.push((lines[i] as string).trim());
          i++;
        }
        items.push(`<li>${renderInline(parts.join(' '))}</li>`);
      }

      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // Only at the start of a block: four spaces continuing a paragraph is a
    // wrapped line someone indented, not a code block.
    if (buffer.length === 0 && INDENTED_CODE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const code = INDENTED_CODE.exec(lines[i] as string);
        if (code) {
          body.push(code[1] as string);
          i++;
        } else if ((lines[i] as string).trim().length === 0 && body.length > 0) {
          body.push('');
          i++;
        } else break;
      }
      while (body.length > 0 && (body[body.length - 1] as string).length === 0) body.pop();
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    buffer.push(line);
    i++;
  }

  paragraph();
  return out.join('\n');
}

/**
 * The first `limit` characters of a note as plain text, for list rows and the
 * hover card — places that want a hint of the argument, not the argument.
 */
export function markdownExcerpt(source: string, limit = 120): string {
  const plain = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // Balanced parens here too, or a Wikipedia link leaves a stray bracket behind.
    .replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, '$1')
    .replace(/^[\s>#*+-]+/gm, '')
    .replace(/[*_]{1,2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length <= limit ? plain : `${plain.slice(0, limit).trimEnd()}…`;
}
