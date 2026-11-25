/** Typing heatmap + WPM helpers. Counts are per MK75 key index. */
import type { RGB } from './lighting';

const STOPS: RGB[] = [
  [20, 40, 160], // cold: dark blue
  [0, 170, 255], // cyan
  [0, 220, 90], // green
  [255, 210, 0], // yellow
  [255, 40, 20], // hot: red
];

/** Perceptual heat colour for t ∈ [0,1]. */
export function heatColour(t: number): RGB {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((c) => Math.round(STOPS[i][c] + (STOPS[i + 1][c] - STOPS[i][c]) * f)) as RGB;
}

/** Log-scaled heat colours for every key with at least one press. */
export function heatmapColours(counts: Record<number, number>): Record<number, RGB> {
  const vals = Object.values(counts).filter((v) => v > 0);
  if (!vals.length) return {};
  const max = Math.log1p(Math.max(...vals));
  return Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => [k, heatColour(max ? Math.log1p(v) / max : 1)]));
}

/** Words per minute using the standard 5 characters per word. */
export function wpm(correctChars: number, ms: number): number {
  return ms > 0 ? Math.round(correctChars / 5 / (ms / 60_000)) : 0;
}

/** Characters typed correctly (same position as the target) and accuracy %. */
export function scoreTyping(target: string, typed: string): { correct: number; accuracy: number } {
  let correct = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] === target[i]) correct++;
  return { correct, accuracy: typed.length ? Math.round((correct / typed.length) * 100) : 100 };
}

export const SAMPLE_TEXTS = [
  'The quick brown fox jumps over the lazy dog while the MK75 glows in dark green and orange.',
  'Gasket mounted boards feel soft and sound deep; hot-swap sockets let you try new switches in minutes.',
  'Pack my box with five dozen liquor jugs, then type it again a little faster than before.',
  'function hello(name) { return `Hello, ${name}!`; } // braces, brackets and backticks matter',
];
