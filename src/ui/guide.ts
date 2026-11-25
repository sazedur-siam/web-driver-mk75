/**
 * Renders the bundled README for the in-app Guide: GitHub-flavoured markdown with heading anchors,
 * a table of contents, and links that open in a new tab. Relative repo links (e.g. TESTING.md) point to
 * the files on GitHub. The README is our own build-time content, so rendering it as HTML is safe.
 */
import { Marked, type Tokens } from 'marked';

export const REPO_URL = 'https://github.com/sazedur-siam/web-driver-mk75';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-'); // GitHub: every space becomes a dash (so "a & b" → "a--b")
}

export interface TocEntry {
  depth: number;
  text: string;
  id: string;
}

/** Resolve a markdown link target for the in-app guide. */
export function resolveHref(href: string): { href: string; external: boolean } {
  if (href.startsWith('#')) return { href, external: false };
  if (/^[a-z]+:/i.test(href)) return { href, external: true };
  return { href: `${REPO_URL}/blob/main/${href.replace(/^\.\//, '')}`, external: true };
}

export function renderGuide(markdown: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const used = new Map<string, number>();
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { tokens, depth, text }: Tokens.Heading) {
        const base = slugify(text) || 'section';
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        if (depth >= 2 && depth <= 3) toc.push({ depth, text: text.replace(/[*_`]/g, ''), id });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { href, title, tokens }: Tokens.Link) {
        const r = resolveHref(href);
        const t = title ? ` title="${title}"` : '';
        const ext = r.external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${r.href}"${t}${ext}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  const html = md.parse(markdown, { async: false }) as string;
  return { html, toc };
}
