/** Game mode: the header toggle and the settings card on the Key mapping tab. */
import { useEffect } from 'react';
import { describeOptions, type GameModeOptions } from '../protocol/gameMode';
import { gameModeStore, turnGameModeOff, turnGameModeOn, useGameModeStatus } from './gameModeStore';
import type { DeviceApi } from './useDevice';

export function GameModeToggle({ api }: { api: DeviceApi }) {
  const { status, options, active } = useGameModeStatus(api);
  const on = status !== 'off';
  // A record none of whose changes are on the keyboard any more (restored elsewhere, a backup, another browser's
  // edits) is stale: forget it once the keyboard has been read.
  useEffect(() => {
    if (active && api.snap && status === 'off' && !api.busy) gameModeStore.clearRecord();
  }, [active, api.snap, status, api.busy]);
  return (
    <button
      className={on ? 'primary' : ''}
      aria-pressed={on}
      disabled={!!api.busy || !api.snap}
      onClick={() => void (on ? turnGameModeOff(api) : turnGameModeOn(api))}
      title={on ? `Game mode is on: ${describeOptions(options)}. Click to put everything back.` : `Game mode: ${describeOptions(options)} (set it up on the Key mapping tab)`}
    >
      Game mode{on ? ' on' : ''}
    </button>
  );
}

export function GameModeCard({ api }: { api: DeviceApi }) {
  const { status, options, active, lastResult } = useGameModeStatus(api);
  const on = status !== 'off';
  const setOpt = (patch: Partial<GameModeOptions>) => gameModeStore.setOptions({ ...options, ...patch });
  return (
    <section className="card">
      <header className="card-h">
        <h2>Game mode</h2>
        <span className="muted small">{on ? `On since ${new Date(active!.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Off'}</span>
      </header>
      <p className="muted small">
        One click switches these on, and a second click puts back exactly what game mode changed. Anything you change in
        between is left as you set it. The keyboard's own <kbd>Fn</kbd>+<kbd>Win</kbd> lock still works in game.
      </p>
      <div className="row">
        <label>
          <input type="checkbox" checked={options.disableWin} disabled={on} onChange={(e) => setOpt({ disableWin: e.target.checked })} /> Disable the Win key
        </label>
        <label>
          <input type="checkbox" checked={options.disableCaps} disabled={on} onChange={(e) => setOpt({ disableCaps: e.target.checked })} /> Disable Caps Lock
        </label>
        <label>
          <input type="checkbox" checked={options.neverSleep} disabled={on} onChange={(e) => setOpt({ neverSleep: e.target.checked })} /> Never sleep
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.lighting === 'wasd'}
            disabled={on}
            onChange={(e) => setOpt({ lighting: e.target.checked ? 'wasd' : 'keep' })}
          />{' '}
          WASD lighting
        </label>
      </div>
      {options.lighting === 'wasd' && (
        <p className="hint">
          WASD lighting replaces the keyboard's Self-define colours. Turning game mode off brings them back from this browser's
          Per-key RGB editor.
        </p>
      )}
      {status === 'partial' && <p className="banner busy">Some of game mode's changes were already undone on the keyboard. Turning it off restores the rest.</p>}
      <div className="row">
        <button className="primary" disabled={!!api.busy} onClick={() => void (on ? turnGameModeOff(api) : turnGameModeOn(api))}>
          {on ? 'Turn game mode off' : 'Turn game mode on'}
        </button>
        <span className="muted small">{describeOptions(options)}</span>
      </div>
      {lastResult && lastResult.length > 0 && (
        <ul className="small">
          {lastResult.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Shown on the Profiles tab while game mode is on. */
export function GameModeProfilesNote({ api }: { api: DeviceApi }) {
  const { status } = useGameModeStatus(api);
  if (status === 'off') return null;
  return (
    <p className="banner busy">
      Game mode is on. <b>Update from keyboard</b> would save its changes into the profile; turn it off first to save your
      normal setup.
    </p>
  );
}
