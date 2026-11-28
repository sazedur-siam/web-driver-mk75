/**
 * Skips live frames the keyboard already shows.
 *
 * Live effects render a frame every tick (about 33 a second), but clocks, timers, static colours and still images
 * repeat the same frame for seconds. Each device class runs its wire payload through a gate and sends only when the
 * payload changed, or when the keep-alive is due. The keep-alive stays because the firmware's behaviour without
 * frames is unknown: the vendor notes guess it drops back to the saved effect after about 1 s (spec_live_misc.md),
 * and a frame lost over 2.4 GHz would otherwise never be repainted. TESTING.md V6–V8 check it on hardware.
 */
export const LIVE_KEEPALIVE_MS = 250;

export class LiveGate {
  private last: Uint8Array | null = null;
  private lastAt = 0;

  constructor(
    public keepAliveMs = LIVE_KEEPALIVE_MS,
    /** Clock in ms; replaceable in tests. */
    public now: () => number = () => performance.now(),
  ) {}

  /** True when `payload` must be sent: it differs from the last one sent, or the keep-alive is due. */
  shouldSend(payload: Uint8Array): boolean {
    const last = this.last;
    if (!last || last.length !== payload.length) return true;
    if (this.now() - this.lastAt >= this.keepAliveMs) return true;
    for (let i = 0; i < payload.length; i++) if (last[i] !== payload[i]) return true;
    return false;
  }

  /** Record that `payload` went out. Call it after the write succeeds; a failed write must not count. */
  sent(payload: Uint8Array) {
    this.last = payload.slice(); // callers may reuse their buffer
    this.lastAt = this.now();
  }

  /** Forget the last frame, so the next one is always sent (after any config write, the keyboard shows something else). */
  reset() {
    this.last = null;
  }
}
