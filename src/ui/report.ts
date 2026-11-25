/**
 * "Report an Issue": builds a pre-filled GitHub "new issue" URL. Screenshots can't travel in a URL, so the
 * reporter pastes them into GitHub's editor. Diagnostics are optional and shown to the user before sending.
 */
export const ISSUES_URL = 'https://github.com/sazedur-siam/web-driver-mk75/issues';

/** GitHub rejects very long URLs; keep well under ~8 KB. */
const MAX_URL = 7000;

export interface IssueReport {
  title: string;
  description: string;
  steps: string;
  expected: string;
  diagnostics?: string;
}

export function issueBody(r: IssueReport): string {
  const parts = [
    '### What happened',
    r.description.trim() || '_(not provided)_',
    '',
    '### Steps to reproduce',
    r.steps.trim() || '_(not provided)_',
    '',
    '### What I expected',
    r.expected.trim() || '_(not provided)_',
    '',
    '### Screenshots',
    '_Paste or drag screenshots here._',
  ];
  if (r.diagnostics) parts.push('', '### Diagnostics', '```', r.diagnostics.trim(), '```');
  return parts.join('\n');
}

export function issueUrl(r: IssueReport): string {
  const build = (body: string) =>
    `${ISSUES_URL}/new?${new URLSearchParams({ template: 'bug_report.md', title: r.title.trim() || 'Problem report', body }).toString()}`;
  let url = build(issueBody(r));
  if (url.length <= MAX_URL || !r.diagnostics) return url;
  // Too long: keep the start of the diagnostics and drop older log lines until it fits.
  const lines = r.diagnostics.split('\n');
  const head = lines.findIndex((l) => l.startsWith('Recent log'));
  let keep = lines.length;
  while (keep > (head >= 0 ? head + 1 : 0)) {
    keep = Math.max(head >= 0 ? head + 1 : 0, keep - 5);
    const trimmed = [...lines.slice(0, head >= 0 ? head + 1 : 0), '(older log lines trimmed)', ...lines.slice(lines.length - (keep - (head >= 0 ? head + 1 : 0)))].join('\n');
    url = build(issueBody({ ...r, diagnostics: trimmed }));
    if (url.length <= MAX_URL) return url;
  }
  return build(issueBody({ ...r, diagnostics: lines.slice(0, Math.max(1, head)).join('\n') }));
}

export interface DiagInput {
  version: string;
  userAgent: string;
  connection: string | null;
  modelId: string | null;
  theme: string | null;
  log: string[];
}

export function diagnosticsText(d: DiagInput): string {
  return [
    `App: Lingbao MK75 Driver ${d.version}`,
    `Browser: ${d.userAgent}`,
    `Connection: ${d.connection ?? 'not connected'}`,
    `Model check: ${d.modelId ?? 'n/a'}`,
    `Theme: ${d.theme ?? 'default'}`,
    `Recent log (newest last):`,
    ...(d.log.length ? d.log : ['(empty)']),
  ].join('\n');
}
