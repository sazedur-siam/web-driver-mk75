import { MK75_KEYS } from '../device/mk75Layout';
import type { RGB } from './lighting';
import { coloursToFrame } from './signals';

// Compact 3×5 source glyphs, expanded to heavier 5×5 glyphs for the five usable rows.
// Unsupported characters use '?'.
const FONT: Record<string, string> = {
  A:'010101111101101', B:'110101110101110', C:'011100100100011', D:'110101101101110',
  E:'111100110100111', F:'111100110100100', G:'011100101101011', H:'101101111101101',
  I:'111010010010111', J:'001001001101010', K:'101101110101101', L:'100100100100111',
  M:'101111111101101', N:'101111111111101', O:'010101101101010', P:'110101110100100',
  Q:'010101101111011', R:'110101110101101', S:'011100010001110', T:'111010010010010',
  U:'101101101101111', V:'101101101101010', W:'101101111111101', X:'101101010101101',
  Y:'101101010010010', Z:'111001010100111',
  '0':'111101101101111', '1':'010110010010111', '2':'110001010100111', '3':'110001010001110',
  '4':'101101111001001', '5':'111100110001110', '6':'011100110101010', '7':'111001010010010',
  '8':'010101010101010', '9':'010101011001110',
  ' ':'000000000000000', '!':'010010010000010', '?':'110001010000010', '.':'000000000000010',
  '-':'000000111000000', ':':'000010000010000', '/':'001001010100100',
};

// Project the sixth physical row (modifiers, space and arrows) onto the
// glyph's bottom row, while retaining every key's independent LED index.
const CELLS = MK75_KEYS.map((key) => ({
  index: key.index,
  x: Math.floor(key.index / 6),
  y: Math.min(key.index % 6, 4),
  bottom: key.index % 6 === 5,
}));

/** One scrolling frame. All other LEDs remain off; no persistent settings are written. */
export function scrollTextFrame(text: string, seconds: number, columnsPerSecond: number, color: RGB, brightness: number, width: 'narrow' | 'wide' | 'block' = 'wide', includeBottom = true): Uint8Array {
  const message = Array.from(text.toUpperCase()).slice(0, 64).map((c) => FONT[c] ?? FONT['?']);
  if (!message.length) return new Uint8Array(378);
  // Wrap every sampled column, including text entering from the right while the
  // previous copy exits on the left. A short gap separates repetitions.
  const glyphWidth = width === 'block' ? 7 : width === 'wide' ? 5 : 3;
  const stride = glyphWidth + 1;
  const messageWidth = message.length * stride - 1;
  const length = messageWidth + 3;
  const offset = Math.floor(Math.max(0, seconds) * columnsPerSecond) % length;
  const colors = new Map<number, RGB>();
  for (const { index, x, y, bottom } of CELLS) {
    if (bottom && !includeBottom) continue;
    const column = (x + offset) % length;
    const glyph = Math.floor(column / stride);
    const gx = column % stride;
    // Block triples the outside columns; wide doubles them; narrow stays 3×5.
    const sourceX = width === 'block' ? [0, 0, 0, 1, 2, 2, 2][gx] : width === 'wide' ? [0, 0, 1, 2, 2][gx] : gx;
    if (glyph < message.length && gx < glyphWidth && message[glyph][y * 3 + sourceX] === '1') colors.set(index, color);
  }
  return coloursToFrame(colors, brightness);
}
