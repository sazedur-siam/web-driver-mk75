/** Observed on one wired IC2481 MK75. Other variants may use different layouts. */
export interface SideLightState {
  mode: number;
  color: number;
  brightness: number;
  speed: number;
}

export const SIDE_LIGHT_MODES = ['Off', 'Flow', 'Colour change', 'Solid', 'Breathe'] as const;
export const SIDE_LIGHT_COLORS = ['Red', 'Green', 'Blue', 'Yellow', 'Purple', 'Sky blue', 'White'] as const;

export function parseSideLight(raw: Uint8Array): SideLightState {
  if (raw.length !== 128 || raw[0x38] !== 0xff || raw[0x39] !== 0xff || raw[0x7e] !== 0x5a || raw[0x7f] !== 0xa5)
    throw new Error('Invalid lighting block; side-light settings were not changed');
  const state = { mode: raw[0x12], color: raw[0x13], brightness: raw[0x14], speed: raw[0x15] };
  if (state.mode >= SIDE_LIGHT_MODES.length || state.color >= SIDE_LIGHT_COLORS.length || state.brightness > 4 || state.speed > 4)
    throw new Error('Unrecognised side-light settings; this keyboard may use a different layout');
  return state;
}

/** Patch only explicit fields in a freshly read, validated device block. */
export function patchSideLight(raw: Uint8Array, changes: Partial<SideLightState>): Uint8Array {
  parseSideLight(raw);
  if (changes.mode !== undefined && (!Number.isInteger(changes.mode) || changes.mode < 0 || changes.mode >= SIDE_LIGHT_MODES.length))
    throw new Error('Invalid side-light mode');
  if (changes.color !== undefined && (!Number.isInteger(changes.color) || changes.color < 0 || changes.color >= SIDE_LIGHT_COLORS.length))
    throw new Error('Invalid side-light colour');
  for (const value of [changes.brightness, changes.speed]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 4))
      throw new Error('Invalid side-light level');
  }
  const next = raw.slice();
  if (changes.mode !== undefined) next[0x12] = changes.mode;
  if (changes.color !== undefined) next[0x13] = changes.color;
  if (changes.brightness !== undefined) next[0x14] = changes.brightness;
  if (changes.speed !== undefined) next[0x15] = changes.speed;
  return next;
}
