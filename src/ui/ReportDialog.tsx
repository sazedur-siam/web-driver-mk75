import { useEffect, useMemo, useRef, useState } from 'react';
import { diagnosticsText, issueUrl, ISSUES_URL } from './report';
import type { DeviceApi } from './useDevice';

const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** "Report an Issue": short form → pre-filled GitHub issue (screenshots are pasted on GitHub). */
export function ReportDialog({ api, onClose }: { api: DeviceApi; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [withDiag, setWithDiag] = useState(true);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const diagnostics = useMemo(
    () =>
      diagnosticsText({
        version,
        userAgent: navigator.userAgent,
        connection: api.dev ? `${api.dev.transport.name} · ${api.dev.kind === 'wired' ? 'USB cable' : '2.4 GHz / Bluetooth'}${api.dev.simulated ? ' (simulator)' : ''}` : null,
        modelId: api.modelId ? [...api.modelId].map((b) => b.toString(16).padStart(2, '0')).join(' ') : null,
        theme: document.documentElement.dataset.theme ?? null,
        log: api.log.slice(-50).map((l) => `${new Date(l.t).toLocaleTimeString()} ${l.dir === 'out' ? '→' : l.dir === 'in' ? '←' : '•'} ${l.text}`),
      }),
    [api.dev, api.modelId, api.log],
  );

  const submit = () => {
    window.open(issueUrl({ title, description, steps, expected, diagnostics: withDiag ? diagnostics : undefined }), '_blank', 'noopener,noreferrer');
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <header className="card-h">
          <h2 id="report-title">Report an Issue</h2>
          <button className="x-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="muted small">
          This opens a new issue on GitHub with your report filled in. You'll need a free GitHub account. Add screenshots there by pasting or
          dragging them into the text box.
        </p>
        <label className="field">
          <span className="field-l">Title</span>
          <input ref={first} className="text-input" placeholder="e.g. Lighting doesn't save over 2.4 GHz" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-l">What happened?</span>
          <textarea className="text-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-l">Steps to reproduce</span>
          <textarea className="text-input" rows={3} placeholder={'1. Open Lighting\n2. Choose Rainbow\n3. Click Save'} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-l">What did you expect?</span>
          <textarea className="text-input" rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </label>
        <label className="chk">
          <input type="checkbox" checked={withDiag} onChange={(e) => setWithDiag(e.target.checked)} /> Include diagnostics (app version, browser, connection, recent
          keyboard log)
        </label>
        {withDiag && (
          <details>
            <summary>Preview diagnostics</summary>
            <pre className="mono small diag-preview">{diagnostics}</pre>
          </details>
        )}
        <div className="actions">
          <button className="primary" onClick={submit} disabled={!title.trim() && !description.trim()}>
            Continue on GitHub
          </button>
          <button onClick={onClose}>Cancel</button>
          <a className="small" href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
            See existing issues
          </a>
        </div>
      </div>
    </div>
  );
}
