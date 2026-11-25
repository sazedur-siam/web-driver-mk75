import { describe, expect, it } from 'vitest';
import manual from '../../MANUAL.md?raw';
import readme from '../../README.md?raw';
import { renderGuide, resolveHref, slugify } from './guide';

describe('guide renderer', () => {
  it('slugifies headings like GitHub', () => {
    expect(slugify('Per-key RGB ("Self-define")')).toBe('per-key-rgb-self-define');
    expect(slugify('Backup & log')).toBe('backup--log');
  });
  it('resolves links: anchors stay, repo files go to GitHub, URLs open externally', () => {
    expect(resolveHref('#features')).toEqual({ href: '#features', external: false });
    expect(resolveHref('TESTING.md').href).toBe('https://github.com/sazedur-siam/web-driver-mk75/blob/main/TESTING.md');
    expect(resolveHref('https://mk75-web.vercel.app/').external).toBe(true);
  });
  it('renders headings with ids, a TOC, tables and safe external links', () => {
    const { html, toc } = renderGuide('# T\n\n## Quick start\n\n### Profiles\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSee [tests](TESTING.md).');
    expect(toc).toEqual([
      { depth: 2, text: 'Quick start', id: 'quick-start' },
      { depth: 3, text: 'Profiles', id: 'profiles' },
    ]);
    expect(html).toContain('<h2 id="quick-start">');
    expect(html).toContain('<table>');
    expect(html).toContain('href="https://github.com/sazedur-siam/web-driver-mk75/blob/main/TESTING.md" target="_blank" rel="noopener noreferrer"');
  });
  it('renders the real README with all main sections', () => {
    const { toc } = renderGuide(readme);
    const ids = toc.map((t) => t.id);
    for (const id of ['quick-start', 'features', 'connection-support', 'planned-features']) expect(ids).toContain(id);
  });
  it('renders the user manual with its main sections', () => {
    const ids = renderGuide(manual).toc.map((t) => t.id);
    for (const id of ['what-you-need', 'connect-your-keyboard', 'with-the-usb-cable-recommended', 'everyday-tasks', 'troubleshooting']) expect(ids).toContain(id);
  });
});
