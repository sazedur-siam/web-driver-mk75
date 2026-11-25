/**
 * Shareable presets: semantic setups (not raw device blocks) encoded as JSON → deflate → base64url, carried
 * in the URL hash (#p=…) so they never reach a server. Applied on top of the keyboard's current blocks.
 */
import { MK75_KEYS } from '../device/mk75Layout';
import { vkToHid } from './mock';
import { decodeAction, encodeAction, getKeyCode, setKeyCode, type KeyAction } from './keycodes';
import { LED_MODES, LEVELS, PALETTE_SIZE, parseProfile, parseRgbTable, patchProfile, patchRgbTable, type RGB } from './lighting';

export interface PresetLighting {
  mode: number; // LED_MODES index
  speed: number;
  brightness: number;
  colorful: boolean;
  colorIndex: number;
  palette?: RGB[]; // the mode's 7 colours
}

export interface Preset {
  v: 1;
  name: string;
  lighting?: PresetLighting;
  perKey?: Record<number, RGB>;
  /** key index → action (only plain key/consumer/modifier/mouse/disabled; no macros). */
  keys?: Record<number, KeyAction>;
}

const SHAREABLE_KINDS = new Set(['key', 'consumer', 'modifier', 'mouse', 'disabled']);
const KEY_INDICES = new Set(MK75_KEYS.map((k) => k.index));
const FN_INDEX = MK75_KEYS.find((k) => k.vk === 0xfa)?.index;

// ---------------------------------------------------------------- build from the keyboard
export function presetFromBlocks(
  name: string,
  blocks: { profile: Uint8Array; rgbTable: Uint8Array; matrix: Uint8Array },
  /** Factory code for a key, to share only keys that differ (omit to share all shareable keys). */
  defaultCode: ((index: number) => number | undefined) | null,
  perKey: Record<number, RGB> | null,
  parts: { lighting?: boolean; perKey?: boolean; keys?: boolean } = { lighting: true, perKey: true, keys: true },
): Preset {
  const p: Preset = { v: 1, name };
  if (parts.lighting) {
    const st = parseProfile(blocks.profile);
    const s = st.perMode[st.activeIndex];
    p.lighting = { mode: st.activeIndex, ...s, palette: parseRgbTable(blocks.rgbTable)[st.activeIndex] };
  }
  if (parts.perKey && perKey && Object.keys(perKey).length) p.perKey = perKey;
  if (parts.keys) {
    const keys: Record<number, KeyAction> = {};
    for (const k of MK75_KEYS) {
      if (k.index === FN_INDEX) continue;
      const code = getKeyCode(blocks.matrix, k.index);
      if (defaultCode && code === defaultCode(k.index)) continue;
      const a = decodeAction(code);
      if (SHAREABLE_KINDS.has(a.kind)) keys[k.index] = a;
    }
    if (Object.keys(keys).length) p.keys = keys;
  }
  return p;
}

// ---------------------------------------------------------------- apply onto the keyboard's blocks
export function applyPresetToBlocks(p: Preset, blocks: { profile: Uint8Array; rgbTable: Uint8Array; matrix: Uint8Array }) {
  let { profile, rgbTable, matrix } = blocks;
  if (p.lighting) {
    const st = parseProfile(profile);
    const L = p.lighting;
    st.activeIndex = L.mode;
    st.perMode[L.mode] = { speed: L.speed, brightness: L.brightness, colorful: L.colorful, colorIndex: L.colorIndex };
    profile = patchProfile(profile, st);
    if (L.palette) {
      const pal = parseRgbTable(rgbTable);
      pal[L.mode] = L.palette;
      rgbTable = patchRgbTable(rgbTable, pal);
    }
  }
  if (p.keys) for (const [idx, a] of Object.entries(p.keys)) matrix = setKeyCode(matrix, Number(idx), encodeAction(a));
  return { profile, rgbTable, matrix };
}

// ---------------------------------------------------------------- validation
const isRgb = (c: unknown): c is RGB => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
const lvl = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < LEVELS;

export function validatePreset(x: unknown): Preset {
  const o = x as Partial<Preset>;
  if (!o || typeof o !== 'object' || o.v !== 1) throw new Error('Unsupported or corrupted preset link');
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : 'Shared preset';
  const out: Preset = { v: 1, name };
  if (o.lighting) {
    const L = o.lighting;
    const mode = LED_MODES[L.mode as number];
    if (!mode || mode.hidden || !lvl(L.speed) || !lvl(L.brightness) || typeof L.colorful !== 'boolean' || !Number.isInteger(L.colorIndex) || L.colorIndex < 0 || L.colorIndex >= PALETTE_SIZE)
      throw new Error('Preset lighting settings are invalid');
    if (L.palette && (!Array.isArray(L.palette) || L.palette.length !== PALETTE_SIZE || !L.palette.every(isRgb))) throw new Error('Preset palette is invalid');
    out.lighting = { mode: L.mode, speed: L.speed, brightness: L.brightness, colorful: L.colorful, colorIndex: L.colorIndex, palette: L.palette };
  }
  if (o.perKey) {
    const pk: Record<number, RGB> = {};
    for (const [k, c] of Object.entries(o.perKey)) {
      if (!KEY_INDICES.has(Number(k)) || !isRgb(c)) throw new Error('Preset per-key colours are invalid');
      pk[Number(k)] = c;
    }
    out.perKey = pk;
  }
  if (o.keys) {
    const keys: Record<number, KeyAction> = {};
    for (const [k, a] of Object.entries(o.keys)) {
      const idx = Number(k);
      if (!KEY_INDICES.has(idx) || idx === FN_INDEX || !a || !SHAREABLE_KINDS.has((a as KeyAction).kind)) throw new Error('Preset key mapping is invalid');
      const code = encodeAction(a as KeyAction);
      keys[idx] = decodeAction(code); // normalise through the encoder
    }
    out.keys = keys;
  }
  if (!out.lighting && !out.perKey && !out.keys) throw new Error('Preset is empty');
  return out;
}

// ---------------------------------------------------------------- encoding
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([new Uint8Array(data)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Compact JSON: perKey colours as hex strings, keys as numeric codes. */
function toWire(p: Preset) {
  return {
    v: 1,
    n: p.name,
    l: p.lighting && [p.lighting.mode, p.lighting.speed, p.lighting.brightness, p.lighting.colorful ? 1 : 0, p.lighting.colorIndex, p.lighting.palette?.map(hex6)],
    p: p.perKey && Object.fromEntries(Object.entries(p.perKey).map(([k, c]) => [k, hex6(c)])),
    k: p.keys && Object.fromEntries(Object.entries(p.keys).map(([k, a]) => [k, encodeAction(a)])),
  };
}
const hex6 = (c: RGB) => c.map((v) => v.toString(16).padStart(2, '0')).join('');
const rgb6 = (s: string): RGB => [0, 2, 4].map((i) => parseInt(String(s).slice(i, i + 2), 16)) as RGB;

function fromWire(w: Record<string, unknown>): unknown {
  const l = w.l as unknown[] | undefined;
  return {
    v: w.v,
    name: w.n,
    lighting: l && { mode: l[0], speed: l[1], brightness: l[2], colorful: l[3] === 1, colorIndex: l[4], palette: (l[5] as string[] | undefined)?.map(rgb6) },
    perKey: w.p && Object.fromEntries(Object.entries(w.p as Record<string, string>).map(([k, c]) => [k, rgb6(c)])),
    keys: w.k && Object.fromEntries(Object.entries(w.k as Record<string, number>).map(([k, c]) => [k, decodeAction(Number(c))])),
  };
}

export async function encodePreset(p: Preset): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toWire(p)));
  return b64url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodePreset(s: string): Promise<Preset> {
  let raw: unknown;
  try {
    const bytes = await pipe(unb64url(s), new DecompressionStream('deflate-raw'));
    raw = fromWire(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new Error('This preset link is damaged or incomplete');
  }
  return validatePreset(raw);
}

export function presetSummary(p: Preset): string {
  const parts: string[] = [];
  if (p.lighting) parts.push(`${LED_MODES[p.lighting.mode].name} lighting`);
  if (p.perKey) parts.push(`${Object.keys(p.perKey).length} per-key colours`);
  if (p.keys) parts.push(`${Object.keys(p.keys).length} remapped keys`);
  return parts.join(' · ');
}

/** Factory key code (plain HID key from the vendor KB.ini). */
export function factoryKeyCode(index: number): number | undefined {
  const k = MK75_KEYS.find((x) => x.index === index);
  const hid = k ? vkToHid(k.vk) : undefined;
  return hid === undefined ? undefined : encodeAction({ kind: 'key', usage: hid, mods: 0 });
}
