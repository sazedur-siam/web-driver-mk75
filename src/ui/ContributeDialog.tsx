import { useEffect, useMemo, useState } from 'react';
import { buildContribution, DATA_DOC_URL, dataIssueUrl, downloadContribution } from './contribute';
import type { DeviceApi } from './useDevice';

const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const PREVIEW_CHARS = 20_000;

/** "Contribute device data": consent → download one JSON file → attach it to a pre-filled GitHub issue. */
export function ContributeDialog({ api, onClose }: { api: DeviceApi; onClose: () => void }) {
  const [hid, setHid] = useState<HIDDevice[]>([]);
  const [note, setNote] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.grantedDevices().then(setHid).catch(() => setHid([]));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, onClose]);

  const data = useMemo(
    () => (api.dev ? buildContribution({ version, userAgent: navigator.userAgent, dev: api.dev, modelId: api.modelId, snap: api.snap, hid, log: api.log, note }) : null),
    [api.dev, api.modelId, api.snap, api.log, hid, note],
  );
  const json = useMemo(() => (data ? JSON.stringify(data, null, 2) : ''), [data]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="contrib-title">
        <header className="card-h">
          <h2 id="contrib-title">Contribute device data</h2>
          <button className="x-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {!data ? (
          <p className="muted">Connect your MK75 first (cable, 2.4 GHz receiver or Bluetooth). Each mode you send helps.</p>
        ) : (
          <>
            <p className="muted small">
              Saves one file describing how your keyboard talks to the computer, so support for more boards and modes can be added. You attach it to a GitHub
              issue yourself; nothing is uploaded automatically.{' '}
              <a href={DATA_DOC_URL} target="_blank" rel="noopener noreferrer">
                Exactly what's collected
              </a>
            </p>
            <ul className="small">
              <li>
                <b>Included:</b> connection mode, USB IDs and HID interface layout, model id, the keyboard's lighting / key-map / palette settings, the
                recent configuration traffic log, browser and app version.
              </li>
              <li>
                <b>Never included:</b> what you type (browsers block the typing interface), macro contents (hidden in the log), anything stored in this
                browser (profiles, macro library), your name or IP.
              </li>
            </ul>
            <label className="field">
              <span className="field-l">Notes (optional)</span>
              <textarea
                className="text-input"
                rows={2}
                placeholder="e.g. 2.4 GHz receiver, Windows 11. Lighting works, battery shows nothing."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <details>
              <summary>
                Preview file ({Math.round(json.length / 1024)} KB, {data.hid.length} HID interface{data.hid.length === 1 ? '' : 's'}, {data.log.length} log lines)
              </summary>
              <pre className="mono small diag-preview">{json.length > PREVIEW_CHARS ? `${json.slice(0, PREVIEW_CHARS)}\n… (rest is in the file)` : json}</pre>
            </details>
            <label className="chk">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I agree to share this file publicly on GitHub
            </label>
            {data.connection.simulated && <p className="hint warn">This is the simulator, not a real keyboard.</p>}
            <div className="actions">
              <button
                className="primary"
                disabled={!agreed}
                onClick={() => {
                  downloadContribution(data);
                  setSaved(true);
                }}
              >
                1. Save file
              </button>
              <button disabled={!saved} onClick={() => window.open(dataIssueUrl(data), '_blank', 'noopener,noreferrer')}>
                2. Open GitHub issue and attach it
              </button>
              <button onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
