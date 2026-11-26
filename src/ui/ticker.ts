/**
 * A frame clock that keeps running in background tabs.
 * Chrome throttles `setInterval` on hidden pages (≈1 Hz, less after 5 min), which made live effects stutter.
 * Timers inside a dedicated Worker aren't throttled that way, and the page still receives its messages promptly,
 * so the worker posts a tick every `ms` and the page renders a frame per tick.
 */
const WORKER_SRC = `let id = 0;
onmessage = (e) => {
  clearInterval(id);
  if (e.data > 0) id = setInterval(() => postMessage(0), e.data);
};`;

export interface Ticker {
  stop(): void;
  /** 'worker' when background-safe, 'interval' when falling back to a page timer. */
  readonly kind: 'worker' | 'interval';
}

export function startTicker(ms: number, onTick: () => void): Ticker {
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('no worker');
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = () => onTick();
    w.postMessage(ms);
    return {
      kind: 'worker',
      stop() {
        w.onmessage = null; // drop ticks already queued, so no frame lands after a restore
        w.postMessage(0);
        w.terminate();
      },
    };
  } catch {
    const id = setInterval(onTick, ms);
    return { kind: 'interval', stop: () => clearInterval(id) };
  }
}
