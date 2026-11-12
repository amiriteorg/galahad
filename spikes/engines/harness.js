/*
 * What every spike is measured with: the same loop, the same clock, the same numbers as the SANDBOX's own
 * benchmark (bench/browser/world-scale.ts): the main thread's time a frame, and the interval between frames with
 * the browser's frame-rate limit off (what the whole pipeline takes).
 */

const CAPACITY = 8192;

export function params() {
  const q = new URLSearchParams(location.search);
  return { x: Math.max(1, Number(q.get("x")) || 1), webgl: q.get("webgl") === "1", mode: q.get("mode") || "" };
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] : 0);
const spread = (values, n) => {
  const sorted = values.slice(0, n).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  return { n, mean: n ? sum / n : 0, p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99), max: n ? sorted[n - 1] : 0 };
};

/**
 * Runs `frame(seconds)` every animation frame (it updates and draws, and returns when the frame's commands are
 * handed over), and keeps each frame's time and interval. `info()` says what was drawn (draw calls, triangles).
 */
export function run(name, frame, info) {
  const work = new Float64Array(CAPACITY);
  const interval = new Float64Array(CAPACITY);
  let n = 0;
  let last = 0;
  const state = { name, first: 0, frames: 0, error: null };
  const tick = (now) => {
    requestAnimationFrame(tick);
    const from = performance.now();
    try {
      frame(now / 1000);
    } catch (error) {
      state.error = String(error && error.stack ? error.stack : error);
      throw error;
    }
    const to = performance.now();
    if (!state.first) state.first = to;
    if (last) {
      work[n % CAPACITY] = to - from;
      interval[n % CAPACITY] = now - last;
      n++;
    }
    last = now;
    state.frames++;
  };
  requestAnimationFrame(tick);
  globalThis.__spike = {
    state,
    reset: () => void (n = 0),
    stats: () => ({ frames: Math.min(n, CAPACITY), work: spread(work, Math.min(n, CAPACITY)), interval: spread(interval, Math.min(n, CAPACITY)) }),
    info,
    /** The same fixed loop the SANDBOX's benchmark runs on the page's main thread, to know how quiet the machine is. */
    kernel: (ms) => {
      const a = new Float64Array(2048);
      let x = 1, h = 0, rounds = 0;
      const from = performance.now();
      let now = from;
      do {
        for (let i = 0; i < 2048; i++) {
          x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
          h = (Math.imul(h ^ x, 0x01000193) + i) | 0;
          a[i] = a[(i * 7 + 1) & 2047] * 1.0000001 + Math.sqrt((h >>> 8) + 1);
        }
        rounds++;
        now = performance.now();
      } while (now - from < ms);
      return rounds / (now - from);
    },
  };
}

/** The figure's bones at `t`: each one's turn about x and z (radians), the same in every engine. */
export function boneTurn(i, t) {
  return [Math.sin(t * 2 + i * 0.7) * 0.25, Math.cos(t * 1.6 + i * 1.1) * 0.2];
}
