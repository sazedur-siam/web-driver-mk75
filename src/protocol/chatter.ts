/**
 * Key test statistics and chatter detection. Chatter = a key reports a new press within `thresholdMs` of
 * its previous release, i.e. one physical press registered twice (common with worn or freshly swapped switches).
 */
export interface KeyStats {
  presses: number;
  chatter: number[]; // gaps (ms) of detected chatter events
  lastDown?: number;
  lastUp?: number;
  longestHold: number;
}

export class ChatterDetector {
  readonly keys = new Map<number, KeyStats>();
  readonly down = new Set<number>();

  constructor(public thresholdMs = 30) {}

  private stats(key: number): KeyStats {
    let s = this.keys.get(key);
    if (!s) {
      s = { presses: 0, chatter: [], longestHold: 0 };
      this.keys.set(key, s);
    }
    return s;
  }

  /** Returns the chatter gap in ms if this press looks like chatter. */
  keyDown(key: number, t: number): number | null {
    if (this.down.has(key)) return null; // OS auto-repeat
    this.down.add(key);
    const s = this.stats(key);
    s.presses++;
    s.lastDown = t;
    if (s.lastUp !== undefined && t - s.lastUp < this.thresholdMs) {
      const gap = Math.round(t - s.lastUp);
      s.chatter.push(gap);
      return gap;
    }
    return null;
  }

  keyUp(key: number, t: number) {
    this.down.delete(key);
    const s = this.stats(key);
    s.lastUp = t;
    if (s.lastDown !== undefined) s.longestHold = Math.max(s.longestHold, Math.round(t - s.lastDown));
  }

  get chattering(): { key: number; gaps: number[] }[] {
    return [...this.keys].filter(([, s]) => s.chatter.length).map(([key, s]) => ({ key, gaps: s.chatter }));
  }

  reset() {
    this.keys.clear();
    this.down.clear();
  }
}
