# Feature backlog: Lingbao MK75 web driver

Planning notes for the remaining features (not built yet). When a feature ships, its file is removed.
Reverse-engineering specs and emulation scripts that these plans rely on are in `reverse-engineering/`.

Live app: https://mk75-web.vercel.app/ · Repo: https://github.com/sazedur-siam/web-driver-mk75

## Index

New plans go here as `NN-short-name.md` with a row in this table. The hardware checks still open are in
`TESTING.md`.

| # | Feature | Group | Priority | Effort | Needs hardware? |
|---|---|---|---|---|---|
| [01](01-live-frame-skip.md) | Skip unchanged live frames (with a keep-alive) | Performance / live effects | High | S | Verify only |
| [03](03-readme-fn-layer.md) | README: Fn-layer remapping is missing | Docs | High | XS | No |
| [04](04-game-mode.md) | Game mode (Win/Caps off, never sleep, WASD lighting, exact undo) | Key mapping / lighting | High | M | Verify only |

Effort: S ≈ 1 day or less, M ≈ 2–4 days. "Verify only" = buildable now, but confirm on a real MK75.

## Not possible in a browser (don't plan these)

- Per-app profiles: a web page can't see which application is focused.
- System audio without user sharing: music sync always needs a shared tab/system audio.
- Running when the tab is closed: live effects stop with the page.
- Firmware version: only in the USB descriptor, which WebHID doesn't expose.
- Firmware updates: possible in principle, too risky from a browser.

## Shared conventions

- Device I/O goes through `Mk75Device` (`src/protocol/device.ts`); never talk to WebHID from UI code.
- Read-modify-write only; never write bytes we don't understand.
- New protocol code gets unit tests against the simulators (`src/protocol/mock.ts`, `wireless/mockWireless.ts`).
- Browser-only state (profiles, macros, presets) is versioned JSON in `localStorage` and included in backups.
