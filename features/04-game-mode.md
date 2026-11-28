# 04: Game mode

| Group | Priority | Effort | Needs hardware? |
|---|---|---|---|
| Key mapping / lighting | High | M (3–4 days) | Verify only (no new protocol) |

Branch: `feat/game-mode`

## Goal

One switch that puts the keyboard into a gaming setup and a second click that puts back **exactly what it changed**,
leaving everything else alone. It's built only from writes the app already makes (key matrix, profile, per-key).

## Why, given the keyboard already has a Win lock

The firmware has **Fn + LWin** "Lock the Windows key" (DeviceTab Fn list, device function `07 00 00 01`). Game mode
must do more than that or it isn't worth building:

| | Fn + LWin (firmware) | Game mode (this plan) |
|---|---|---|
| Win key off | ✅ | ✅ |
| Caps Lock off (a common accidental press in WASD games) | ❌ | ✅ optional |
| Keyboard never sleeps during long matches or cutscenes (2.4 GHz / Bluetooth) | ❌ | ✅ optional |
| Gaming lighting (WASD highlight) and back | ❌ | ✅ optional |
| Visible in the app, survives replugging, one-click undo | Win LED only; persistence unknown | ✅ |

The firmware lock stays useful as an in-game hotkey. The manual should mention both.

## What exists to build on

| Piece | Where | Use |
|---|---|---|
| Redirect-aware key writes | `getKeyCode` / `setKeyCode` in [src/protocol/keycodes.ts](../src/protocol/keycodes.ts) | Patch single slots safely (rule 3: never touch redirect words). |
| Key actions | `KeyAction` `{ kind: 'disabled' }`, `encodeAction` / `decodeAction` | "Disabled" is code `00000000`. |
| Key labels | [src/device/mk75Layout.ts](../src/device/mk75Layout.ts): `LWin` (index 11), `CapsLock` | The MK75 has no right Win or Menu key. |
| Pattern for "patch some keys" | `layoutActions()` in [src/protocol/layouts.ts](../src/protocol/layouts.ts) (Caps → Ctrl/Esc tweaks) | Same idea, but with undo. |
| Matrix write + read-back | `saveKeysAndMacros` in [src/ui/saveKeys.ts](../src/ui/saveKeys.ts) | Game mode must **not** re-plan macros, so it calls `dev.writeKeyMatrix` + `readKeyMatrix` directly (see below). |
| Sleep timer byte | profile `[0x11]` (`P_SLEEP` in DeviceTab; `0xFF` = never) | Optional "never sleep". |
| WASD highlight colours | "WASD gamer" in [src/presets/gallery.ts](../src/presets/gallery.ts) | Reuse its per-key map. |
| Per-key write | `dev.writeLedMatrix`, `perKeyStore` | Write-only on every class: there's no `readLedMatrix`. |
| Profile apply | `applyProfile` in [src/ui/applyProfile.ts](../src/ui/applyProfile.ts) | **Not** used: it rewrites whole blocks, and game mode must change only its own bytes. |

## Design

### Options (stored in the browser)

```ts
interface GameModeOptions {
  disableWin: boolean;      // default true
  disableCaps: boolean;     // default true
  neverSleep: boolean;      // default false (true matters most on 2.4 GHz / Bluetooth)
  lighting: 'keep' | 'wasd'; // default 'keep'
}
```

Saved in `localStorage` key `mk75.gamemode` together with the active record below. Versioned JSON (`v: 1`),
validated on load, falls back to defaults if damaged.

### Active record: the undo log

```ts
interface GameModeRecord {
  since: string;                                           // ISO time
  keys: { index: number; before: number; after: number }[]; // u32 codes, base layer
  profile?: { at: number; before: number; after: number }[]; // only the profile bytes game mode changed
  perKeyWritten?: boolean;                                  // WASD highlight was written
}
```

Only what game mode changed is recorded, with both values, so undo can tell whether the user changed it since.

### Pure planning module (`src/protocol/gameMode.ts`)

```ts
planGameModeOn(matrix, profile, options) → { matrix, profile, record, skipped: string[] }
planGameModeOff(matrix, profile, record) → { matrix, profile, restored: number, leftAsIs: string[] }
```

- **On:** for each chosen key, read its current code. Skip it (and say why in `skipped`) if it's the Fn key
  (`0x00000020`), a device function (type `07`), or already disabled. Otherwise set it to `0` with `setKeyCode`.
- **Never sleep:** if `profile[0x11] !== 0xFF`, record it and set `0xFF`.
- **WASD lighting:** `patchProfile(profile, { ...parseProfile(profile), mode: CUSTOM_MODE_INDEX })` from
  [src/protocol/lighting.ts](../src/protocol/lighting.ts) (the Lighting tab's own path, no hand-written offsets).
  Record **every byte that differs** between the old and new profile as `{ at, before, after }`, then write the
  WASD per-key colours (`buildLedMatrix`).
- **Off:** for each recorded key, if the current code still equals `after`, put back `before`; otherwise leave it
  and add it to `leftAsIs` ("Caps Lock was changed after game mode started, left as is"). Same for profile bytes.
- No other bytes are touched (rule 1). As a guard against a damaged `localStorage` value, `planGameModeOff` refuses
  a record whose keys aren't LWin or CapsLock (so never the Fn key or the knob slot 90), or whose profile bytes
  aren't `[0x11]` or bytes that `patchProfile` changes for a mode switch.

### Writes (UI layer, `src/ui/gameMode.ts`)

Vendor order (rule 2), skipping blocks with no change:

1. **Key matrix:** `dev.writeKeyMatrix(planned.matrix)`, then `readKeyMatrix()` and `api.setSnap`. The matrix comes
   from `snap.matrix` read back from the keyboard, so macro cells are already in it and are written back unchanged.
   Don't call `withMacroCodes` or `writeMacroPages`.
2. **Per-key** (only for `wasd`): `dev.writeLedMatrix(...)`.
3. **Profile** (only if a byte changed): `dev.writeProfile(planned.profile)` on a copy of `snap.profile`.

**Turning off with WASD lighting:** per-key colours can't be read back from any MK75 class. If the effect before
game mode was Self-define, rewrite per-key from `perKeyStore` (the Per-key RGB editor's colours in this browser).
The panel says so up front: "Your Self-define colours come back from this browser's Per-key RGB editor." If the
previous effect was anything else, restoring the effect bytes is enough.

Each step reports progress through `api.run(...)` and logs a single info line.

### Where it lives in the UI

- **Header:** a **Game mode** toggle next to the battery icon, shown when connected. On = accent colour and a
  tooltip listing what's active ("Win and Caps Lock off · never sleeps").
- **Settings:** a **Game mode** card at the top of the **Key mapping** tab: the four options, a one-line note about
  Fn + LWin, and a summary after each toggle (what changed, what was skipped, what was left as is).
- Check how the Key mapping drawing shows a disabled key. If it doesn't stand out, add a "disabled" style
  (struck-through or dimmed label) so game mode's effect is visible at a glance.

### Edge cases

| Case | Behaviour |
|---|---|
| Page reload or reconnect while on | On connect, check the record against the keyboard. If every `after` value is still there, show it as on; if none are, clear the record; if only some are, show it as on with a note. |
| Another browser or computer | It has no record, so it just sees disabled keys in Key mapping. Document this in the manual. |
| A profile is applied while game mode is on | On turning off, the changed keys don't match `after`, so they're left as is and the record is cleared. The Profiles tab shows a small banner while game mode is on: "Game mode is on; Update from keyboard will capture its changes." |
| Key mapping saved while game mode is on | Same: undo leaves keys the user changed and restores the rest. |
| 0x15 receiver (`caps.macros === false`) | The key matrix and profile writes are supported; nothing special needed. |
| CDev916KB cable class | Same writes (matrix, profile, per-key) exist; works. |
| Bluetooth | Writes aren't confirmed on hardware yet (CLAUDE.md §5). Allow it, as other tabs do, and add it to the hardware checks. |

### Backups

Add an optional `gameMode` field to `BackupFile` (options only, not the active record) with validation in
`parseBackup`. Older backups without it stay valid. Restoring a backup clears any active record, because the
restored key matrix replaces what the record describes.

## Steps

1. `gameMode.ts` (pure) + tests.
2. Store (`mk75.gamemode`), validation, backup field + tests.
3. `src/ui/gameMode.ts` write sequence; connect-time reconciliation.
4. Header toggle + Key mapping card + Profiles banner.
5. Docs: README (Key mapping section and the connection table), MANUAL (a short Game mode section with a
   screenshot `public/manual/game-mode.webp`, taken as CLAUDE.md §8 describes), TESTING.md checks below.

## Tests

**Unit (vitest):**
- Planning on: Win and Caps go to `0`, the record holds before/after; Fn, device-function and already-disabled keys
  are skipped with a reason; with `neverSleep`, only `[0x11]` changes in the profile; no other byte differs (compare
  whole buffers).
- Planning off: an exact restore when nothing changed; a key changed in between is left as is and reported; a
  damaged record naming the Fn key, the knob slot or an unrelated profile byte is refused.
- Redirect slots: if a game key is a redirect slot (`02` low byte), `setKeyCode` writes through it and the redirect
  word is unchanged (a hand-built matrix with a redirect on LWin).
- Round trip against `MockMk75` and `MockWirelessIO`: on → off leaves the simulator's matrix and profile
  byte-identical to the start. With `wasd`, per-key planes are written and the effect is restored.
- Backup: `gameMode` options round-trip; an old backup without the field parses.

**Browser (simulators):** toggle on/off on both simulators; reload while on; apply a profile while on, then turn off
and check the "left as is" message; check that the header toggle state matches the keyboard drawing.

**Hardware (add to `TESTING.md` as a new section):**
- **G1** (P0) Cable: Game mode on → Win and Caps Lock do nothing; other keys normal; macros still play.
- **G2** (P0) Unplug and replug → still on (keys still disabled), and the app shows it on after reconnecting.
- **G3** (P0) Game mode off → Win and Caps Lock work again; Key mapping shows no other changes.
- **G4** (P1) "Never sleep" on 2.4 GHz → the keyboard stays awake 5 minutes idle; off → it sleeps on the old timer.
- **G5** (P1) WASD lighting on and off, from a non-Self-define effect, and again from Self-define.
- **G6** (P2) Fn + LWin while game mode is on → note whether the firmware lock and the disabled key interact
  strangely: ______

## Risks

| Risk | Mitigation |
|---|---|
| Undo restores stale values over the user's newer changes | Only restore a slot that still equals `after`; report the rest. |
| Damaged `localStorage` makes undo write a forbidden slot | Validation + forbidden-slot guard in the pure planner. |
| Self-define colours lost on turning off | Restore from `perKeyStore`, and say so in the panel before the user turns it on. |
| Each LED-block write blinks the lighting (CLAUDE.md §9) | Write the profile only when a byte changed; "keep lighting" + no sleep change means no profile write at all. |
| Users expect in-game toggling | The app can't see keys when unfocused; point them to Fn + LWin for that. |

## Out of scope (possible later)

- Lower debounce while gaming (`writeSettings`, layout B only). Leave it out until debounce levels are confirmed
  on hardware (`TESTING.md` D4).
- Per-game presets, or switching automatically by app: not possible in a browser (`features/README.md`).
- Fn-layer changes.

## Done when

- On/off round-trips leave the keyboard byte-identical, in tests and on G1–G3.
- Tests, build and the simulator checks pass; README, MANUAL and TESTING are updated.
- This file and its row in `features/README.md` are deleted when it ships.
