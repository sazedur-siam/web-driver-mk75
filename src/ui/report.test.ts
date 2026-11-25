import { describe, expect, it } from 'vitest';
import { diagnosticsText, issueBody, issueUrl } from './report';

const base = { title: 'Lighting does not save', description: 'Clicked Save, nothing changed', steps: '1. Lighting\n2. Rainbow\n3. Save', expected: 'Rainbow on keyboard' };

describe('report an issue', () => {
  it('builds a pre-filled GitHub new-issue URL', () => {
    const url = new URL(issueUrl(base));
    expect(url.origin + url.pathname).toBe('https://github.com/sazedur-siam/web-driver-mk75/issues/new');
    expect(url.searchParams.get('title')).toBe('Lighting does not save');
    expect(url.searchParams.get('template')).toBe('bug_report.md');
    const body = url.searchParams.get('body')!;
    expect(body).toContain('### What happened\nClicked Save, nothing changed');
    expect(body).toContain('### Screenshots');
  });
  it('includes diagnostics only when given', () => {
    expect(issueBody(base)).not.toContain('Diagnostics');
    const d = diagnosticsText({ version: '0.1.0', userAgent: 'UA', connection: 'Simulated MK75 · USB', modelId: '03 00 00 00 00 c6', theme: 'arthur', log: ['a', 'b'] });
    expect(issueBody({ ...base, diagnostics: d })).toContain('```\nApp: Lingbao MK75 Driver 0.1.0');
  });
  it('trims old log lines to keep the URL short', () => {
    const log = Array.from({ length: 400 }, (_, i) => `12:00:${i} → #06 03 b6 00 00 00 00 00 00 00 00 00 00 01 00 00 00 … (1031 B) line ${i}`);
    const d = diagnosticsText({ version: '0.1.0', userAgent: 'UA', connection: 'USB', modelId: null, theme: null, log });
    const url = issueUrl({ ...base, diagnostics: d });
    expect(url.length).toBeLessThanOrEqual(7000);
    const body = new URL(url).searchParams.get('body')!;
    expect(body).toContain('App: Lingbao MK75 Driver 0.1.0');
    expect(body).toContain('line 399'); // newest kept
    expect(body).not.toContain('line 0 '); // oldest dropped
  });
  it('defaults an empty title', () => {
    expect(new URL(issueUrl({ ...base, title: '  ' })).searchParams.get('title')).toBe('Problem report');
  });
});
