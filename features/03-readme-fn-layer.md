# 03: README says remapping is base-layer only

| Group | Priority | Effort | Needs hardware? |
|---|---|---|---|
| Docs | High | XS (under an hour) | No |

Branch: `docs/readme-fn-layer`

## Problem

[README.md](../README.md) line 94, under **Key mapping**, says "Remap any key (base layer):". The Key mapping tab has
edited the Fn layer for a while ([src/ui/KeymapTab.tsx](../src/ui/KeymapTab.tsx): `layer` state, **Fn layer** button,
`readFnLayer`/`writeFnLayer`, **Restore Fn layer**), and [MANUAL.md](../MANUAL.md) lines 132–134 already describe it.
The README undersells the feature, and the in-app Guide shows the same README text.

## Change

1. **README.md, Key mapping section:**
   - Change the first bullet to "Remap any key on the base layer, or what it does while Fn is held (Fn layer,
     experimental, current MK75 boards):".
   - Add a bullet after the hardware-layouts bullet: "**Fn layer:** the mode, pairing and battery keys are locked so
     they can't be lost, and **Restore Fn layer** puts back the Fn layer as the app first read it."
2. **README.md, Connection support table:** under "Key mapping and layouts", add a row
   `| Fn layer remapping | ✅ IC2481 boards (all current MK75s, experimental) | ✅ (experimental) |`. Checked
   2026-11-28: `readFnLayer`/`writeFnLayer` exist on `Mk75Wireless` (and `Mk75G5Wired`, which extends it), not on
   the CDev916KB `Mk75` class.
3. **Search for other stale mentions** before committing: `grep -rn -i "base layer" README.md MANUAL.md
   features/ CLAUDE.md`. CLAUDE.md doesn't need a change (§5 already lists the Fn layer).

## Checks

- `npm test` (`guide.test.ts` renders README.md and MANUAL.md, so any markdown breakage shows up).
- `npm run dev` → **Guide** → README: the Key mapping section shows the new bullets and the table renders.

## Done when

The README matches the app, the Guide renders it, and this file and its row in `features/README.md` are deleted
when it ships.
