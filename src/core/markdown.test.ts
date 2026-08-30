import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownExcerpt, renderInline, renderMarkdown } from './markdown';

describe('escaping', () => {
  it('escapes every character that could open a tag or attribute', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;',
    );
  });

  /**
   * The tags this module emits, and nothing else. Anything outside this set
   * appearing in the output means input reached the browser as markup.
   */
  const ALLOWED = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'code', 'pre',
    'ul', 'ol', 'li', 'blockquote', 'hr', 'a',
  ]);

  /**
   * The safety property, asserted structurally rather than by grepping the
   * output: escaped text *containing* the word `javascript:` is inert and must
   * not fail, while a single unescaped tag must.
   */
  function inertMarkup(html: string): { tags: string[]; attributes: string[] } {
    const tags: string[] = [];
    const attributes: string[] = [];
    for (const [, name, rest] of html.matchAll(/<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|[^>])*)>/g)) {
      if (!ALLOWED.has((name as string).toLowerCase())) tags.push(name as string);
      for (const [, attribute, value] of (rest as string).matchAll(/([\w-]+)="([^"]*)"/g)) {
        const key = (attribute as string).toLowerCase();
        if (key.startsWith('on')) attributes.push(`${key}=${value as string}`);
        if (key === 'href' && !/^(?:https?:\/\/|mailto:|#|\/|\.{0,2}\/)/i.test(value as string)) {
          attributes.push(`${key}=${value as string}`);
        }
      }
    }
    return { tags, attributes };
  }

  /**
   * If any of these ever renders as markup, the social layer ships an XSS the
   * moment someone forks a stranger's connection note.
   */
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<svg/onload=alert(1)>',
    '"><script>alert(1)</script>',
    '<a href="javascript:alert(1)">click</a>',
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[click](vbscript:msgbox(1))',
    '![x](javascript:alert(1))',
    '`<script>alert(1)</script>`',
    '> <script>alert(1)</script>',
    '# <img src=x onerror=alert(1)>',
    '- <script>alert(1)</script>',
    '```\n<script>alert(1)</script>\n```',
  ];

  for (const attack of attacks) {
    it(`renders no live markup for ${JSON.stringify(attack)}`, () => {
      expect(inertMarkup(renderMarkdown(attack))).toEqual({ tags: [], attributes: [] });
    });
  }

  it('the inertness check itself fails on markup that got through', () => {
    // A test that can only pass is not a test. This is the shape the assertion
    // above is meant to catch.
    expect(inertMarkup('<p><img src=x onerror="alert(1)"></p>').tags).toEqual(['img']);
    expect(inertMarkup('<a href="javascript:alert(1)">x</a>').attributes).toHaveLength(1);
  });

  it('cannot have its code-span placeholder forged', () => {
    // The placeholder is a NUL, and text that carried one used to address the
    // code array directly: "\0 0 \0" came back as <code>undefined</code>.
    const forged = `a ${String.fromCharCode(0)}0${String.fromCharCode(0)} b`;
    expect(escapeHtml(forged)).toBe('a 0 b');
    expect(renderMarkdown(forged)).toBe('<p>a 0 b</p>');
    expect(renderMarkdown(forged)).not.toContain('undefined');
  });

  it('leaves a rejected link visible as text rather than dropping it', () => {
    // Silently swallowing it would leave the author thinking the link worked.
    expect(renderMarkdown('[click](javascript:alert(1))')).toContain('[click]');
  });

  it('accepts the schemes a note actually needs', () => {
    expect(renderInline('[a](https://example.org/x?y=1)')).toBe(
      '<a href="https://example.org/x?y=1" target="_blank" rel="noreferrer noopener">a</a>',
    );
    expect(renderInline('[m](mailto:someone@example.org)')).toContain('href="mailto:');
    expect(renderInline('[r](/local/path)')).toContain('href="/local/path"');
  });

  it('rejects a scheme broken up by control characters', () => {
    expect(renderInline('[a](java\tscript:alert(1))')).not.toContain('<a ');
    expect(renderInline('[a](java\nscript:alert(1))')).not.toContain('<a ');
  });
});

describe('inline', () => {
  it('renders bold, italic and code', () => {
    expect(renderInline(escapeHtml('**a** *b* _c_ `d`'))).toBe(
      '<strong>a</strong> <em>b</em> <em>c</em> <code>d</code>',
    );
  });

  it('does not treat asterisks inside code as emphasis', () => {
    expect(renderInline(escapeHtml('`a * b * c`'))).toBe('<code>a * b * c</code>');
    expect(renderInline(escapeHtml('`**not bold**`'))).toBe('<code>**not bold**</code>');
  });

  it('leaves intra-word underscores alone', () => {
    // `learned_at` and `learned_from` are field names a note will mention.
    expect(renderInline(escapeHtml('the learned_at field'))).toBe('the learned_at field');
  });

  it('puts emphasis inside the anchor rather than tearing the brackets apart', () => {
    const html = renderInline(escapeHtml('[**Gombrich**](https://example.org)'));
    expect(html).toBe(
      '<a href="https://example.org" target="_blank" rel="noreferrer noopener"><strong>Gombrich</strong></a>',
    );
  });

  it('keeps a bracket that belongs to the URL inside the href', () => {
    // Wikipedia disambiguates with brackets, so this is the ordinary case, not
    // an edge one: the href used to stop at the "(" and the rest leaked out.
    const url = 'https://en.wikipedia.org/wiki/Battle_of_Lepanto_(1571)';
    const html = renderInline(escapeHtml(`[Lepanto](${url})`));
    expect(html).toBe(
      `<a href="${url}" target="_blank" rel="noreferrer noopener">Lepanto</a>`,
    );
    expect(markdownExcerpt(`see [Lepanto](${url}) for more`)).toBe('see Lepanto for more');
  });

  it('accepts an angle-bracketed destination', () => {
    const html = renderInline(escapeHtml('[a](<https://example.org/x_(y)>)'));
    expect(html).toContain('href="https://example.org/x_(y)"');
    expect(html).not.toContain('&lt;');
  });

  it('keeps an ampersand in a URL escaped exactly once', () => {
    const html = renderInline(escapeHtml('[a](https://example.org/?x=1&y=2)'));
    expect(html).toContain('href="https://example.org/?x=1&amp;y=2"');
    expect(html).not.toContain('&amp;amp;');
  });
});

describe('blocks', () => {
  it('renders headings at every level', () => {
    expect(renderMarkdown('# one')).toBe('<h1>one</h1>');
    expect(renderMarkdown('###### six')).toBe('<h6>six</h6>');
    expect(renderMarkdown('####### seven')).toBe('<p>####### seven</p>');
  });

  it('joins wrapped lines into one paragraph and splits on a blank line', () => {
    expect(renderMarkdown('a\nb\n\nc')).toBe('<p>a\nb</p>\n<p>c</p>');
  });

  it('renders both kinds of list', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('keeps a wrapped list item as one item', () => {
    expect(renderMarkdown('- a long point\n  continued here\n- second')).toBe(
      '<ul><li>a long point continued here</li><li>second</li></ul>',
    );
  });

  it('renders a fenced code block literally', () => {
    expect(renderMarkdown('```\n**x**\n```')).toBe('<pre><code>**x**</code></pre>');
  });

  it('renders an unclosed fence to the end of the input', () => {
    expect(renderMarkdown('```\nx')).toBe('<pre><code>x</code></pre>');
  });

  it('gives a blockquote the full block vocabulary', () => {
    expect(renderMarkdown('> - a\n> - b')).toBe(
      '<blockquote><ul><li>a</li><li>b</li></ul></blockquote>',
    );
  });

  it('renders a horizontal rule', () => {
    expect(renderMarkdown('a\n\n---\n\nb')).toBe('<p>a</p>\n<hr />\n<p>b</p>');
  });

  it('does not mistake a wrapped indented line for code', () => {
    const html = renderMarkdown('a paragraph\n    that wrapped');
    expect(html).toMatch(/^<p>/);
    expect(html).not.toContain('<pre>');
  });

  it('renders an indented code block that starts a block', () => {
    expect(renderMarkdown('    x = 1')).toBe('<pre><code>x = 1</code></pre>');
  });

  it('returns nothing for empty or blank input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   \n\n  ')).toBe('');
  });

  it('handles CRLF the way an imported file delivers it', () => {
    expect(renderMarkdown('a\r\n\r\nb')).toBe('<p>a</p>\n<p>b</p>');
  });
});

describe('markdownExcerpt', () => {
  it('strips the syntax and collapses whitespace', () => {
    expect(markdownExcerpt('# Why\n\nThe **printing press** and `movable type`.')).toBe(
      'Why The printing press and movable type.',
    );
  });

  it('keeps link text and drops the URL', () => {
    expect(markdownExcerpt('see [Gombrich](https://example.org)')).toBe('see Gombrich');
  });

  it('truncates on a word boundary with an ellipsis', () => {
    const excerpt = markdownExcerpt('word '.repeat(60), 20);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(21);
  });
});
