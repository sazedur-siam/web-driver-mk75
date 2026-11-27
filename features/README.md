# Feature backlog: Lingbao MK75 web driver

Planning notes for the remaining features (not built yet). When a feature ships, its file is removed.
Reverse-engineering specs and emulation scripts that these plans rely on are in `reverse-engineering/`.

Live app: https://mk75-web.vercel.app/ · Repo: https://github.com/sazedur-siam/web-driver-mk75

## Index

| # | Feature | Group | Priority | Effort | Needs hardware? |
|---|---|---|---|---|---|
| 19 | [Desktop tray app (always-on live effects)](19-desktop-tray-app.md) | Platform | P2 | M | No · first version built |
| 20 | [Side lights (light bars) from the app](20-side-lights.md) | Lighting | P1 | M | Yes · find the bytes first |

Effort: S ≈ 1 day or less, M ≈ 2–4 days. "Verify only" = buildable now, but confirm on a real MK75.

## Suggested order

1. Run the hardware tests in `TESTING.md` first: several features build on behaviour that's still unconfirmed.
2. Batch 1: 01 Profiles, 03 Text → macro, 04 Layout presets, 05 Key tester, 12 PWA.
3. Batch 2: 02 Shareable presets, 06 Lighting tools, 07 Screen sync.
4. Batch 3: the rest, then the reverse-engineering items once a keyboard is available.

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
