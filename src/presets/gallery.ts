/** Curated presets bundled with the app (Profiles → Preset gallery). */
import { MK75_KEYS } from '../device/mk75Layout';
import type { RGB } from '../protocol/lighting';
import type { Preset } from '../protocol/preset';

const SELF_DEFINE = 18;
const byLabel = (labels: string[]) => MK75_KEYS.filter((k) => labels.includes(k.label)).map((k) => k.index);
const fill = (rgb: RGB, overrides: [number[], RGB][] = []): Record<number, RGB> => {
  const out: Record<number, RGB> = Object.fromEntries(MK75_KEYS.map((k) => [k.index, rgb]));
  for (const [keys, c] of overrides) for (const k of keys) out[k] = c;
  return out;
};
const selfDefine = { mode: SELF_DEFINE, speed: 0, brightness: 4, colorful: false, colorIndex: 0 };

export const GALLERY: Preset[] = [
  {
    v: 1,
    name: 'MK75 green-orange backlight',
    lighting: selfDefine,
    perKey: Object.fromEntries(
      MK75_KEYS.map((k) => [k.index, (k.cap === 'alpha' ? [64, 220, 170] : k.cap === 'accent' ? [255, 120, 0] : [30, 90, 40]) as RGB]),
    ),
  },
  {
    v: 1,
    name: 'WASD gamer',
    lighting: selfDefine,
    perKey: fill([0, 20, 60], [
      [byLabel(['W', 'A', 'S', 'D']), [255, 0, 0]],
      [byLabel(['Up', 'Down', 'Left', 'Right']), [255, 0, 0]],
      [byLabel(['Q', 'E', 'R', 'F', 'LShift', 'Space', 'LCtrl']), [255, 140, 0]],
      [byLabel(['1', '2', '3', '4', '5']), [255, 255, 255]],
    ]),
  },
  {
    v: 1,
    name: 'Calm teal breathing',
    lighting: {
      mode: 1,
      speed: 1,
      brightness: 3,
      colorful: false,
      colorIndex: 0,
      palette: [[0, 200, 180], [0, 120, 255], [120, 0, 255], [255, 80, 160], [255, 180, 0], [0, 255, 80], [255, 255, 255]],
    },
  },
  { v: 1, name: 'Neon rainbow stream', lighting: { mode: 10, speed: 3, brightness: 4, colorful: true, colorIndex: 0 } },
  {
    v: 1,
    name: 'Mac bottom row (Ctrl · Option · Cmd)',
    keys: Object.fromEntries([
      ...byLabel(['LWin']).map((i) => [i, { kind: 'key', usage: 0xe2, mods: 0 }]),
      ...byLabel(['LAlt']).map((i) => [i, { kind: 'key', usage: 0xe3, mods: 0 }]),
      ...byLabel(['RAlt']).map((i) => [i, { kind: 'key', usage: 0xe7, mods: 0 }]),
    ]),
  },
];
