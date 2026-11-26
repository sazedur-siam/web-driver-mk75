/**
 * Lighting data structures, decoded from CDev916KB::ApplySetting (OemDrv.exe 0x48C710 / 0x48C830)
 * and the [OPT] LedOptN table of the AU75 KB.ini.
 *
 * Profile block (254 bytes, op 0x83/0x03 sub 0xB6) — fields the vendor driver touches:
 *   [0x04]            1 when the active mode is "Self-define" (per-key custom colours), else 0
 *   [0x05]            hardware effect ID of the active mode
 *   [0x06]            custom colour group (StartGp + group, 0x20 on MK75)
 *   [0x11]            sleep timer code (only when the INI enables ShowSleep; AU75 does not)
 *   [0x14],[0x15]     always written as 0xFF
 *   [0x16 + 2*i]      mode i colour byte: palette index 0..6, or 7 (RandomVal) = colourful
 *   [0x17 + 2*i]      mode i (speed << 4) | brightness, each 0..4 (SpeedHW/LightHW are identity)
 * All other bytes are preserved with read-modify-write.
 */

export interface LedMode {
  /** UI index i (0-based LedOpt index); selects the per-mode bytes at 0x16 + 2*i. */
  index: number;
  name: string;
  /** Hardware effect ID written to profile[5]. */
  hw: number;
  speed: boolean;
  brightness: boolean;
  /** Supports the "colourful" (random) colour option. */
  random: boolean;
  /** Supports choosing a palette colour. */
  color: boolean;
  /** Hidden by the vendor UI via KB.ini LedMask (likely unsupported by this firmware). */
  hidden: boolean;
}

/** MK75 KB.ini LedMask=0x22120: bit i hides LedOpt index i from the effect list. */
const LED_MASK = 0x22120;

// LedOptN = hw, effect(preview id), speed, light, direct, random, color  (from KB.ini)
const LEDOPT: [number, number, number, number, number, number, number][] = [
  [1, 1, 0, 1, 0, 1, 1],
  [2, 3, 1, 1, 0, 1, 1],
  [3, 2, 1, 1, 0, 0, 0],
  [4, 19, 1, 1, 0, 1, 1],
  [5, 15, 1, 1, 0, 1, 1],
  [6, 13, 1, 1, 0, 1, 1],
  [7, 20, 1, 1, 0, 1, 1],
  [8, 16, 1, 1, 0, 1, 1],
  [9, 18, 1, 1, 0, 1, 1],
  [10, 5, 1, 1, 0, 1, 1],
  [11, 7, 1, 1, 0, 1, 1],
  [12, 17, 1, 1, 0, 1, 1],
  [13, 12, 1, 1, 0, 1, 1],
  [14, 8, 1, 1, 0, 1, 1],
  [15, 28, 1, 1, 0, 0, 0],
  [16, 30, 1, 1, 0, 0, 0],
  [17, 14, 1, 1, 0, 0, 0],
  [18, 29, 1, 1, 0, 1, 1],
  [21, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0],
];

// Names from Text/en/text.xml tc_kb_led1..20 (index i -> tc_kb_led{i+1}).
const NAMES = [
  'Fixed on', 'Respire', 'Rainbow', 'Flash away', 'Raindrops', 'Rainbow wheel', 'Ripples shining',
  'Stars twinkle', 'Shadow disappear', 'Retro snake', 'Neon stream', 'Reaction', 'Sine wave',
  'Retinue scanning', 'Rotating windmill', 'Colorful waterfall', 'Blossoming', 'Rotating storm',
  'Self-define', 'Off',
];

export const LED_MODES: LedMode[] = LEDOPT.map((o, i) => ({
  index: i,
  name: NAMES[i],
  hw: o[0],
  speed: !!o[2],
  brightness: !!o[3],
  random: !!o[5],
  color: !!o[6],
  hidden: ((LED_MASK >> i) & 1) === 1,
}));

/**
 * Number of per-mode slots we write. The vendor loops over the count of *visible* effect names, indexing
 * slots by LedOpt index: the MK75 mask hides 4 (20 - 4 = 16), the AU75 build on the same firmware hides 3 (17).
 * We use 17 so Blossoming (index 16, visible) keeps its speed/brightness (CLAUDE.md §5). Never write past that.
 */
export const PER_MODE_SLOTS = 17;

/** GaoshouIndex in KB.ini: the per-key custom ("Self-define") mode. */
export const CUSTOM_MODE_INDEX = 18;
/** Custom colour group (StartGp + group); confirmed 0x20 on MK75 hardware. */
export const CUSTOM_GROUP = 0x20;
/** RandomVal default in the vendor driver (not overridden by AU75's INI). */
export const RANDOM_COLOR_CODE = 7;
export const LEVELS = 5; // Light=0..4, Speed=0..4
export const PALETTE_SIZE = 7;
export const RGB_TABLE_STRIDE = 0x15; // 7 colours * 3 bytes

const P_CUSTOM = 0x04;
const P_MODE = 0x05;
const P_GROUP = 0x06;
const P_PER_MODE = 0x16;

export interface ModeSettings {
  speed: number; // 0..4
  brightness: number; // 0..4
  colorful: boolean;
  colorIndex: number; // 0..6
}

export interface LightingState {
  activeIndex: number;
  perMode: ModeSettings[];
}

export function modeByHw(hw: number, customFlag: boolean): LedMode | undefined {
  if (customFlag) return LED_MODES[CUSTOM_MODE_INDEX];
  return LED_MODES.find((m) => m.hw === hw);
}

export function parseProfile(p: Uint8Array): LightingState {
  const active = modeByHw(p[P_MODE], p[P_CUSTOM] === 1) ?? LED_MODES[0];
  const perMode = LED_MODES.map((_, i) => {
    const c = p[P_PER_MODE + 2 * i];
    const sb = p[P_PER_MODE + 2 * i + 1];
    return {
      colorful: (c & 0x0f) === RANDOM_COLOR_CODE,
      colorIndex: (c & 0x0f) < PALETTE_SIZE ? c & 0x0f : 0,
      speed: Math.min(LEVELS - 1, (sb >> 4) & 0x0f),
      brightness: Math.min(LEVELS - 1, sb & 0x0f),
    };
  });
  return { activeIndex: active.index, perMode };
}

/** Patch a previously-read profile block exactly like the vendor's ApplySetting does. */
export function patchProfile(original: Uint8Array, state: LightingState): Uint8Array {
  const p = new Uint8Array(original);
  const mode = LED_MODES[state.activeIndex];
  p[P_CUSTOM] = state.activeIndex === CUSTOM_MODE_INDEX ? 1 : 0;
  p[P_MODE] = mode.hw;
  p[P_GROUP] = CUSTOM_GROUP;
  p[0x14] = 0xff;
  p[0x15] = 0xff;
  state.perMode.forEach((s, i) => {
    if (i >= PER_MODE_SLOTS) return;
    p[P_PER_MODE + 2 * i] = s.colorful ? RANDOM_COLOR_CODE : s.colorIndex & 0x0f;
    p[P_PER_MODE + 2 * i + 1] = ((s.speed & 0x0f) << 4) | (s.brightness & 0x0f);
  });
  return p;
}

export type RGB = [number, number, number];

/** RGB table: mode i palette at offset 0x15 * (i + 1); 7 colours, R,G,B order (RGBIndex=0,1,2). */
export function parseRgbTable(t: Uint8Array): RGB[][] {
  return LED_MODES.map((_, i) => {
    const base = RGB_TABLE_STRIDE * (i + 1);
    return Array.from({ length: PALETTE_SIZE }, (_, k) => [t[base + 3 * k], t[base + 3 * k + 1], t[base + 3 * k + 2]] as RGB);
  });
}

export function patchRgbTable(original: Uint8Array, palettes: RGB[][]): Uint8Array {
  const t = new Uint8Array(original);
  palettes.forEach((pal, i) => {
    if (i >= PER_MODE_SLOTS) return;
    const base = RGB_TABLE_STRIDE * (i + 1);
    pal.forEach(([r, g, b], k) => t.set([r, g, b], base + 3 * k));
  });
  return t;
}

/**
 * Per-key custom colour buffer (op 0x09 pages 0xBC/0xC0). The vendor builds up to 5 groups of
 * 3 planes x 126 bytes (R plane, G plane, B plane per GameRGBIndex=0,1,2), indexed by LED index.
 * AU75 uses one group (GaoshouGroupNum=1).
 */
export const LED_PLANE = 0x7e; // 126 LEDs
export const LED_GROUP_LEN = LED_PLANE * 3; // 0x17A
export const LED_MATRIX_LEN = 0x762; // 5 groups

export function buildLedMatrix(colorsByLedIndex: Map<number, RGB>): Uint8Array {
  const buf = new Uint8Array(LED_MATRIX_LEN);
  for (const [idx, [r, g, b]] of colorsByLedIndex) {
    if (idx < 0 || idx >= LED_PLANE) continue;
    buf[idx] = r;
    buf[LED_PLANE + idx] = g;
    buf[2 * LED_PLANE + idx] = b;
  }
  return buf;
}

export const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};
