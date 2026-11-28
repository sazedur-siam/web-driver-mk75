# 01: Skip unchanged live frames

| Group | Priority | Effort | Needs hardware? |
|---|---|---|---|
| Performance / live effects | High | S | Verify only (the keep-alive interval) |

Branch: `perf/live-frame-skip`

## Goal

Stop sending a live frame when it's byte-for-byte the same as the last one on the wire, while still sending often
enough that the keyboard never drops back to its saved effect.

## Why

Every live mode sends a frame on every tick (`FRAME_MS = 30`, about 33 frames a second), even when nothing changed:

- **Signals** (clock, timer, battery bar) change once a second or once a minute.
- **Static** real-time mode and a solid colour never change.
- **Image to keys** with a still frame, a 2-frame GIF or long GIF delays repeats frames.
- **Screen sync** of a still screen produces the same frame after smoothing settles.

On the cable this is wasted USB traffic. On 2.4 GHz and Bluetooth it's worse: a frame is up to 200 bytes in 14-byte
packets with 10 ms pacing (`link.ts`, `livePace`), so one frame can take about 150 ms of radio time. Skipping
repeats frees the link for frames that do change, and leaves room for config reads (battery polling) during a stream.

## What exists today

| Where | What |
|---|---|
| [src/ui/LiveTab.tsx](../src/ui/LiveTab.tsx) frame loop (`startTicker(FRAME_MS, …)`) | Builds a 378-byte frame and calls `dev.sendLiveFrame(frame)` every tick. A `busy` flag drops ticks while a send is in flight. `fps` counts frames sent. |
| [src/ui/ImageToKeys.tsx](../src/ui/ImageToKeys.tsx) GIF playback | Calls `dev.sendLiveFrame(recordToFrame(...))` per GIF frame (15 ms ticker, honours GIF delays). |
| [src/protocol/mk75.ts](../src/protocol/mk75.ts) `sendLiveFrame` | CDev916KB: report `0x08`, `[0A 7A 01] + 126×RGB`, not logged. |
| [src/protocol/g5Wired.ts](../src/protocol/g5Wired.ts) `sendLiveFrame` | IC2481 cable: `link.write(OP_LIVE, 0, rgb)`, 7 ms pacing, not logged. |
| [src/protocol/wireless/mk75Wireless.ts](../src/protocol/wireless/mk75Wireless.ts) `sendLiveFrame` | `encodeLive` turns the frame into colour groups (quantising down to fit 200 bytes), then `link.write(WCmd.Live, 1, payload)`. |
| `device.ts` | `sendLiveFrame(rgb: Uint8Array): Promise<void>` |

The firmware's behaviour when frames stop is **not known**. `spec_live_misc.md` says the vendor driver never sends
an "end stream" command, and guesses a firmware timeout of about 1 s (from OpenRGB's F75 report). We restore the
saved effect ourselves by rewriting the profile on stop (`TESTING.md` V4/V5).

## Design

### 1. A pure `LiveGate` (new file `src/protocol/liveGate.ts`)

```ts
export class LiveGate {
  constructor(private keepAliveMs = 250, private now: () => number = () => performance.now()) {}
  /** True when `payload` must be sent: it differs from the last sent payload, or the keep-alive is due. */
  shouldSend(payload: Uint8Array): boolean;
  /** Record that `payload` went out (call after the write succeeds). */
  sent(payload: Uint8Array): void;
  /** Forget the last payload: the next frame is always sent. */
  reset(): void;
}
```

- Compares bytes exactly. No "close enough" tolerance: a tolerance would change what the keyboard shows.
- Keeps a copy of the last sent payload (callers reuse buffers).
- `sent()` is separate from `shouldSend()` so a failed write doesn't count as sent.
- The clock is injected so tests don't sleep.

### 2. Gate inside each device, on what actually goes on the wire

Put the gate in the three `sendLiveFrame` implementations, not in the UI:

- **Wired (both classes):** gate on the 378 RGB bytes.
- **Wireless:** gate on the **encoded payload** from `encodeLive`, after quantisation. Two different raw frames
  often encode to the same groups, so this skips more than comparing raw frames would.
- Both UI callers (Live tab and Image to keys) get the gain with no extra code, and any future live feature does too.

Change the interface to report what happened:

```ts
/** Send a live frame. Resolves false when it was skipped because the keyboard already shows it. */
sendLiveFrame(rgb: Uint8Array): Promise<boolean>;
```

### 3. Reset the gate on every non-live write

After a profile write (stop → restore), a per-key write or any other config write, the keyboard is no longer showing
the last live frame. The next live frame must go out even if it's identical to the last one sent.

- `mk75.ts`: call `this.liveGate.reset()` inside `exclusive()` (all config reads and writes pass through it).
- `Mk75Wireless` / `Mk75G5Wired`: reset in every public method other than `sendLiveFrame` that writes. The simplest
  safe rule is to reset in the shared link write path for any command that isn't the live command.
- Also reset on reconnect (a new device object starts fresh anyway).

### 4. Keep-alive interval

Default **250 ms** (4 frames a second when nothing changes). That's a quarter of the guessed 1 s firmware timeout,
so one lost frame over 2.4 GHz still leaves margin. Keep it as a named constant (`LIVE_KEEPALIVE_MS`) with a comment
pointing at the hardware test below. If hardware shows no timeout at all, the interval can go up later. Don't remove
it, because a frame lost on the radio would otherwise never be corrected.

### 5. Live tab readout

`streaming · 33 fps` becomes `streaming · 33 fps · 4 sent/s` (sent frames counted from the `true` results). Keep
`fps` as frames rendered, so the number users already know doesn't suddenly drop. Add a `title` tooltip: "Frames
the keyboard already shows aren't sent again".

## Steps

1. `liveGate.ts` + `liveGate.test.ts` (pure, injected clock).
2. Change `Mk75Device.sendLiveFrame` to `Promise<boolean>`; update `mk75.ts`, `g5Wired.ts`, `mk75Wireless.ts`.
3. Gate reset on non-live writes in all three classes.
4. Live tab: count sent frames, show `sent/s`. Image to keys: no change needed beyond the type.
5. Update `PROTOCOL.md` (live section: "frames identical to the last one are skipped, with a 250 ms keep-alive") and
   the Live effects bullet in `README.md` / `MANUAL.md` if they mention frame rates.
6. Add the hardware checks below to `TESTING.md` §6 and §8.

## Tests

**Unit (vitest):**
- `LiveGate`: first frame sends; identical frame within 250 ms skips; identical frame after 250 ms sends; changed
  frame always sends; `reset()` forces the next send; mutating the caller's buffer after `sent()` doesn't fool it.
- `Mk75` with `MockMk75`: send the same frame 10 times within the keep-alive → `liveFrames === 1`; advance the
  clock → 2; `writeProfile` in between → the next identical frame is sent.
- `Mk75Wireless` with `MockWirelessIO`: two raw frames that differ only below the quantisation step → one `0x88`
  write; a frame after `writeLedMatrix` is sent.
- `Mk75G5Wired`: same as wired.
- Existing live tests keep passing (they send changing frames).

**Browser (USB and 2.4 GHz simulators, `npm run dev`):**
- Live → Signals → Clock: the simulator's `liveFrames` counter (reachable through `window.__mk75.dev`, see
  CLAUDE.md §6) grows about 4 per second, not 33.
- Rainbow wave: grows about 33 per second (wired simulator), so moving effects aren't throttled.
- Stop → the saved effect is restored; Start again → the first frame shows immediately.

**Hardware (add to `TESTING.md`):**
- **V6** (P0) Live → Signals → Clock over the cable for 2 minutes. The keyboard keeps showing the clock and never
  flashes back to the saved effect.
- **V7** (P1) Same over 2.4 GHz.
- **V8** (P2) Measure the firmware timeout: in the browser console run one `sendLiveFrame` and nothing else. Note
  whether and when the keyboard returns to its saved effect: ______. This settles the keep-alive value.

## Risks

| Risk | Mitigation |
|---|---|
| Firmware drops back to the saved effect sooner than 250 ms without frames | V6/V7 catch it; the constant is one line to lower. |
| Gate not reset after a config write, so the first live frame after a restore is skipped | Reset inside the shared write paths, with unit tests per class. Worst case, the keep-alive repaints within 250 ms. |
| The `Promise<boolean>` change breaks a caller | Only two callers exist and the type checker finds both. |

## Done when

- Static and signal modes send about 4 frames a second; moving effects still send about 33 over the cable.
- All unit tests pass, the build is clean, the simulator checks pass, and V6 passes on a real MK75.
- This file and its row in `features/README.md` are deleted when it ships.
