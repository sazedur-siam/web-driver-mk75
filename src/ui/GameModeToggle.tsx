/** Game mode's header toggle (in the app shell; the settings card is GameModeCard.tsx, on the Key mapping tab). */
import { useEffect } from 'react';
import { describeOptions } from '../protocol/gameMode';
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
