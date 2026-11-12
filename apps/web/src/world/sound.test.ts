import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emptySoundStats, Sound } from "./sound.ts";
import { chance, emptyMix, emptySoundWorld, hear, type Mix, mixFor, RECIPES, type SoundKind, type SoundWorld, songByHour, songBySeason, soundSeconds, surfaceFor, thunderFor } from "./soundscape.ts";

/*
 * The sound of his world. The pure half (soundscape.ts): what's heard and how loud,
 * from the world's state; only what's there is heard. The audio half (sound.ts),
 * against a stand-in for Web Audio: nothing at all while it's off, a few nodes while
 * it's on, and nothing made for a sound that isn't let go when it ends.
 */

const DEG = Math.PI / 180;
const world = (over: Partial<SoundWorld> = {}): SoundWorld => ({ ...emptySoundWorld(), ...over });
const mix = (over: Partial<SoundWorld> = {}): Mix => mixFor(world(over), emptyMix());

describe("what he walks on", () => {
  test("planks up on the deck and the stairs, a floor indoors and on paving, snow where it lies, a path, else grass", () => {
    const on = (over: Partial<Parameters<typeof surfaceFor>[0]>) => surfaceFor({ raised: false, indoors: false, paved: false, built: false, snow: 0, ...over });
    expect(on({})).toBe("grass");
    expect(on({ built: true })).toBe("path");
    expect(on({ paved: true })).toBe("stone");
    expect(on({ indoors: true, raised: true })).toBe("stone");
    expect(on({ raised: true })).toBe("wood");
    expect(on({ snow: 0.8 })).toBe("snow");
    expect(on({ snow: 0.8, built: true })).toBe("snow");
    expect(on({ snow: 0.8, paved: true })).toBe("stone");
  });

  test("every surface, and every short sound, has its recipe: a few notes, each brief and sane", () => {
    for (const surface of ["grass", "path", "stone", "wood", "snow"] as const) expect(RECIPES[`step-${surface}`].length).toBeGreaterThan(0);
    for (const [kind, notes] of Object.entries(RECIPES)) {
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.length).toBeLessThanOrEqual(4);
      for (const n of notes) {
        expect(n.at).toBeGreaterThanOrEqual(0);
        expect(n.attack).toBeGreaterThan(0);
        expect(n.decay).toBeGreaterThan(0);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(1);
        expect(n.f0).toBeGreaterThan(20);
        expect(n.f1).toBeGreaterThan(20);
        expect(n.f0).toBeLessThan(8000);
      }
      expect(soundSeconds(kind as SoundKind)).toBeLessThan(kind === "owl" || kind.startsWith("chime") || kind === "thunder" ? 6 : 1.5);
    }
  });
});

describe("placed for the listener", () => {
  const out = { gain: 0, pan: 0 };
  test("nearer is louder; nothing past its reach; at the listener's feet it's in the middle", () => {
    expect(hear(0, 0, 0, 1, 0, 2, 30, out).gain).toBe(1);
    const near = hear(0, 0, 0, 8, 0, 2, 30, out).gain;
    const far = hear(0, 0, 0, 22, 0, 2, 30, out).gain;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(hear(0, 0, 0, 40, 0, 2, 30, out).gain).toBe(0);
    expect(hear(5, 5, 1, 5, 5, 2, 30, out)).toEqual({ gain: 1, pan: 0 });
  });

  test("left is left and right is right, whichever way the listener looks", () => {
    // Looking east (yaw 0): north is on the left, south on the right, straight ahead and behind in the middle.
    expect(hear(0, 0, 0, 0, 10, 2, 30, out).pan).toBeCloseTo(-1);
    expect(hear(0, 0, 0, 0, -10, 2, 30, out).pan).toBeCloseTo(1);
    expect(Math.abs(hear(0, 0, 0, 10, 0, 2, 30, out).pan)).toBeLessThan(1e-9);
    expect(Math.abs(hear(0, 0, 0, -10, 0, 2, 30, out).pan)).toBeLessThan(1e-9);
    // Looking north: east is on the right.
    expect(hear(0, 0, Math.PI / 2, 10, 0, 2, 30, out).pan).toBeCloseTo(1);
    // His own ears (the view swapped to his eyes) are just another listener: the fire to his left is on the left.
    expect(hear(2, -19.3, Math.PI / 2, -3, -19.3, 2, 30, out).pan).toBeLessThan(-0.9);
  });
});

describe("the mix: only what's there is heard", () => {
  test("a still, dry, empty world is silent", () => {
    const m = mix({ sunElevation: 30 * DEG });
    for (const [key, value] of Object.entries(m)) if (!key.endsWith("Tone") && !key.endsWith("Pan")) expect(value).toBe(0);
  });

  test("the wind follows the real wind's strength, and whistles higher as it rises", () => {
    const calm = mix({ wind: 0.4 });
    const breeze = mix({ wind: 4 });
    const gale = mix({ wind: 19 });
    expect(calm.wind).toBe(0);
    expect(breeze.wind).toBeGreaterThan(0.1);
    expect(breeze.wind).toBeLessThan(0.45);
    expect(gale.wind).toBeGreaterThan(0.9);
    expect(gale.windTone).toBeGreaterThan(breeze.windTone);
    // Under the hall's roof it's still heard, less.
    expect(mix({ wind: 19, indoors: 1 }).wind).toBeLessThan(gale.wind * 0.5);
  });

  test("rain by its weight: a patter, a roar, a drumming under a roof; snow falls silently and hushes the rest", () => {
    const drizzle = mix({ rain: 0.1 });
    const pour = mix({ rain: 1 });
    expect(drizzle.rain).toBeGreaterThan(0.1);
    expect(pour.rain).toBeGreaterThan(drizzle.rain * 2);
    expect(pour.rainTone).toBeLessThan(drizzle.rainTone);
    expect(mix({ rain: 1, indoors: 1 }).rainTone).toBeLessThan(1200);
    expect(mix({ rain: 1, indoors: 1 }).rain).toBeGreaterThan(0.5);
    expect(mix({ snow: 1 }).rain).toBe(0);
    const birds = { songbirds: 24, sunElevation: 8 * DEG, spring: 1, summer: 0 };
    expect(mix({ ...birds, snow: 1 }).song).toBeLessThan(mix(birds).song);
  });

  test("the lake laps near its shore, on the side it's on, more in a wind; not from afar", () => {
    const beside = mix({ shore: 4, shoreX: 0, shoreY: 4, wind: 4 });
    expect(beside.lake).toBeGreaterThan(0.4);
    expect(beside.lakePan).toBeLessThan(-0.5);
    expect(mix({ shore: 4, shoreX: 0, shoreY: 4, wind: 12 }).lake).toBeGreaterThan(beside.lake);
    expect(mix({ shore: 22, shoreX: 22, shoreY: 0 }).lake).toBeLessThan(0.1);
    expect(mix({ shore: Number.POSITIVE_INFINITY }).lake).toBe(0);
  });

  test("the fire is heard only while it burns, from close by, with its crackles", () => {
    const by = mix({ fire: true, fireX: 3, fireY: 0 });
    expect(by.fire).toBeGreaterThan(0.7);
    expect(by.crackle).toBeGreaterThan(2);
    expect(mix({ fire: false, fireX: 3, fireY: 0 }).fire).toBe(0);
    expect(mix({ fire: false, fireX: 3, fireY: 0 }).crackle).toBe(0);
    expect(mix({ fire: true, fireX: 40, fireY: 0 }).fire).toBe(0);
  });

  test("a pen or chalk is heard while he writes, from near", () => {
    expect(mix({ writing: true, writeX: 2, writeY: 0 }).scratch).toBeGreaterThan(0.8);
    expect(mix({ writing: false, writeX: 2, writeY: 0 }).scratch).toBe(0);
    expect(mix({ writing: true, writeX: 30, writeY: 0 }).scratch).toBe(0);
  });

  test("birds by the season and the hour: a dawn chorus in spring, little in November, none at night", () => {
    const flock = { songbirds: 24 };
    const springDawn = mix({ ...flock, spring: 1, summer: 0, sunElevation: 3 * DEG, evening: 0.1 });
    const springNoon = mix({ ...flock, spring: 1, summer: 0, sunElevation: 45 * DEG, evening: 0.5 });
    const november = mix({ ...flock, spring: 0, summer: 0, autumn: 0.8, winter: 0.2, sunElevation: 10 * DEG, evening: 0.4 });
    const night = mix({ ...flock, spring: 1, summer: 0, sunElevation: -20 * DEG });
    expect(springDawn.song).toBeGreaterThan(1);
    expect(springDawn.chorus).toBeGreaterThan(0.9);
    expect(springNoon.song).toBeLessThan(springDawn.song * 0.5);
    expect(springNoon.chorus).toBe(0);
    expect(november.song).toBeGreaterThan(0);
    expect(november.song).toBeLessThan(springDawn.song * 0.25);
    expect(night.song).toBe(0);
    // No birds about, no song; in a downpour or a storm, none either; indoors, none.
    expect(mix({ songbirds: 0, spring: 1, summer: 0, sunElevation: 3 * DEG }).song).toBe(0);
    expect(mix({ ...flock, spring: 1, summer: 0, sunElevation: 3 * DEG, rain: 0.5 }).song).toBe(0);
    expect(mix({ ...flock, spring: 1, summer: 0, sunElevation: 3 * DEG, storm: 1 }).song).toBe(0);
    expect(mix({ ...flock, spring: 1, summer: 0, sunElevation: 3 * DEG, indoors: 1 }).song).toBe(0);
    expect(songByHour(-10 * DEG, 0.2)).toBe(0);
    expect(songByHour(3 * DEG, 0.2)).toBeGreaterThan(songByHour(3 * DEG, 0.8));
    expect(songBySeason({ spring: 1, summer: 0, autumn: 0, winter: 0 })).toBeGreaterThan(songBySeason({ spring: 0, summer: 0, autumn: 1, winter: 0 }) * 4);
  });

  test("the owl only at night and only if one's about; ducks by the water by day; geese while they cross; insects on a summer's day", () => {
    expect(mix({ owls: 1, sunElevation: -20 * DEG }).owl).toBeGreaterThan(0);
    expect(mix({ owls: 0, sunElevation: -20 * DEG }).owl).toBe(0);
    expect(mix({ owls: 1, sunElevation: 20 * DEG }).owl).toBe(0);
    expect(mix({ ducks: 6, shore: 8, sunElevation: 20 * DEG }).quack).toBeGreaterThan(0.05);
    expect(mix({ ducks: 6, shore: 200, sunElevation: 20 * DEG }).quack).toBe(0);
    expect(mix({ ducks: 6, shore: 8, sunElevation: -20 * DEG }).quack).toBe(0);
    expect(mix({ geese: 9 }).honk).toBeGreaterThan(0.2);
    expect(mix({ geese: 0 }).honk).toBe(0);
    expect(mix({ insects: 60, summer: 1, sunElevation: 40 * DEG }).insects).toBeGreaterThan(0.4);
    expect(mix({ insects: 60, summer: 1, sunElevation: -10 * DEG }).insects).toBe(0);
    expect(mix({ insects: 0, summer: 1, sunElevation: 40 * DEG }).insects).toBe(0);
    expect(mix({ insects: 60, summer: 0, winter: 1, sunElevation: 40 * DEG }).insects).toBe(0);
    expect(mix({ insects: 60, summer: 1, sunElevation: 40 * DEG, rain: 0.5 }).insects).toBe(0);
  });

  test("everything stays in range, whatever the world says", () => {
    const m = mix({ wind: 80, rain: 5, snow: 5, storm: 5, shore: 0, fire: true, writing: true, songbirds: 999, owls: 9, ducks: 99, geese: 99, insects: 999, spring: 1, sunElevation: 3 * DEG });
    for (const key of ["wind", "rain", "lake", "fire", "scratch", "insects", "chorus"] as const) {
      expect(m[key]).toBeGreaterThanOrEqual(0);
      expect(m[key]).toBeLessThanOrEqual(1);
    }
    for (const key of ["song", "owl", "quack", "honk", "crackle"] as const) expect(m[key]).toBeLessThan(5);
  });

  test("thunder comes after its flash, by how far off it was; a strike that showed its bolt was nearer and louder", () => {
    for (let strike = 1; strike < 40; strike++) {
      const near = thunderFor(strike, true);
      const far = thunderFor(strike, false);
      expect(near.delay).toBeGreaterThan(1.4);
      expect(near.delay).toBeLessThan(6.2);
      expect(far.delay).toBeGreaterThan(near.delay - 2);
      expect(far.delay).toBeLessThan(15);
      expect(near.gain).toBeGreaterThan(far.gain);
      expect(far.gain).toBeGreaterThan(0);
      expect(near.seconds).toBeGreaterThan(2);
    }
    expect(thunderFor(7, true)).toEqual(thunderFor(7, true));
  });

  test("chance is steady and in range", () => {
    const a = chance(7);
    const b = chance(7);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ---------- the audio half, against a stand-in for Web Audio ----------

class FakeParam {
  value = 0;
  sets = 0;
  setValueAtTime(v: number): void {
    this.value = v;
    this.sets++;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.value = v;
    this.sets++;
  }
}

class FakeNode {
  connected = 0;
  started = false;
  stopped = false;
  stopAt = -1;
  onended: (() => void) | null = null;
  gain = new FakeParam();
  pan = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  ratio = new FakeParam();
  type = "";
  buffer: unknown = null;
  loop = false;
  constructor(
    readonly kind: string,
    private readonly ctx: FakeContext,
  ) {
    ctx.live.add(this);
  }
  connect(): void {
    this.connected++;
  }
  disconnect(): void {
    this.ctx.live.delete(this);
  }
  start(): void {
    this.started = true;
  }
  stop(at = 0): void {
    this.stopped = true;
    this.stopAt = at;
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  state = "running";
  closed = false;
  destination = {};
  readonly live = new Set<FakeNode>();
  readonly all: FakeNode[] = [];
  private node(kind: string): FakeNode {
    const n = new FakeNode(kind, this);
    this.all.push(n);
    return n;
  }
  createGain = () => this.node("gain");
  createStereoPanner = () => this.node("pan");
  createBiquadFilter = () => this.node("filter");
  createDynamicsCompressor = () => this.node("limiter");
  createBufferSource = () => this.node("source");
  createOscillator = () => this.node("osc");
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  /** As a browser without a gesture yet: it won't start, and its promise to is broken when it's closed. */
  static ungestured = false;
  private refuse: ((error: Error) => void) | null = null;
  resume = (): Promise<void> => {
    if (!FakeContext.ungestured) return Promise.resolve(void (this.state = "running"));
    this.state = "suspended";
    return new Promise<void>((_, reject) => (this.refuse = reject));
  };
  suspend = (): Promise<void> => (this.closed ? Promise.reject(new Error("the context is closed")) : Promise.resolve(void (this.state = "suspended")));
  close = async () => {
    this.closed = true;
    this.refuse?.(new Error("the context was closed before it could start"));
  };
  /** Time passes: every source due to have stopped ends. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const n of [...this.live]) if ((n.kind === "source" || n.kind === "osc") && n.stopAt >= 0 && n.stopAt <= this.currentTime) n.onended?.();
  }
}

describe("the audio layer", () => {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    hidden: false,
    addEventListener: (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
  };
  const had = (globalThis as { document?: unknown }).document;
  beforeAll(() => void ((globalThis as { document?: unknown }).document = doc));
  afterAll(() => void ((globalThis as { document?: unknown }).document = had));

  const engine = () => {
    let ctx: FakeContext | null = null;
    let made = 0;
    const sound = new Sound(() => {
      made++;
      ctx = new FakeContext();
      return ctx as unknown as AudioContext;
    });
    return { sound, ctx: () => ctx!, made: () => made, stats: () => sound.stats(emptySoundStats()) };
  };
  const silence = emptyMix();

  test("off, there is nothing: no context, no node, no listener; mixing and playing do nothing", () => {
    const e = engine();
    e.sound.mix({ ...silence, wind: 1, rain: 1 }, 0.125);
    e.sound.play("bark");
    e.sound.setVolume(0.3);
    expect(e.made()).toBe(0);
    expect(e.stats()).toMatchObject({ on: false, state: "none", nodes: 0, made: 0, notes: 0, beds: {}, played: {} });
    expect(listeners.get("visibilitychange")?.size ?? 0).toBe(0);
  });

  test("on: ten nodes and no more (the volume, a limiter, eight panners) until something is heard", () => {
    const e = engine();
    expect(e.sound.enable(0.5)).toBe(true);
    expect(e.stats()).toMatchObject({ on: true, state: "running", nodes: 10, notes: 0, beds: {} });
    expect(e.ctx().live.size).toBe(10);
    // A silent world starts no bed.
    for (let i = 0; i < 40; i++) e.sound.mix(silence, 0.125);
    expect(e.ctx().live.size).toBe(10);
    // Turned on twice, it's the same context.
    e.sound.enable(0.5);
    expect(e.made()).toBe(1);
    e.sound.disable();
  });

  test("a bed starts when it's first heard and is let go four seconds after it falls silent", () => {
    const e = engine();
    e.sound.enable(0.6);
    e.sound.mix({ ...silence, wind: 0.5, lake: 0.4, lakePan: -0.6 }, 0.125);
    // Wind: a source, a filter, a gain. The lake: those and a panner.
    expect(Object.keys(e.stats().beds).sort()).toEqual(["lake", "wind"]);
    expect(e.ctx().live.size).toBe(10 + 3 + 4);
    expect(e.ctx().all.filter((n) => n.kind === "source" && n.started && n.loop)).toHaveLength(2);
    // Steady: nothing more is made however long it goes on.
    for (let i = 0; i < 200; i++) e.sound.mix({ ...silence, wind: 0.5, lake: 0.4 }, 0.125);
    expect(e.ctx().live.size).toBe(17);
    expect(e.stats().made).toBe(17);
    // The wind drops: its bed is kept a few seconds (a lull isn't the end of it), then let go.
    for (let i = 0; i < 24; i++) e.sound.mix({ ...silence, lake: 0.4 }, 0.125);
    expect(Object.keys(e.stats().beds).sort()).toEqual(["lake", "wind"]);
    for (let i = 0; i < 12; i++) e.sound.mix({ ...silence, lake: 0.4 }, 0.125);
    expect(Object.keys(e.stats().beds)).toEqual(["lake"]);
    expect(e.ctx().live.size).toBe(14);
    e.sound.disable();
  });

  test("a short sound makes a few nodes and lets every one go when it ends", () => {
    const e = engine();
    e.sound.enable(0.6);
    e.sound.play("bark", 0.8, -0.3);
    // Two yaps: an oscillator and its envelope each.
    expect(e.stats()).toMatchObject({ notes: 2, nodes: 14, played: { bark: 1 } });
    e.sound.play("step-grass", 0.5, 0.2);
    // Two bursts of noise: a source, a filter and an envelope each.
    expect(e.stats().nodes).toBe(20);
    expect(e.stats().notes).toBe(4);
    e.ctx().advance(5);
    expect(e.stats()).toMatchObject({ notes: 0, nodes: 10 });
    expect(e.ctx().live.size).toBe(10);
    // Too quiet to hear (far off) isn't played at all.
    e.sound.play("bark", 0.001);
    expect(e.stats().nodes).toBe(10);
    e.sound.disable();
  });

  test("at most 24 notes at once: the rest are dropped, not queued", () => {
    const e = engine();
    e.sound.enable(0.6);
    for (let i = 0; i < 40; i++) e.sound.play("phrase", 1, 0);
    expect(e.stats().notes).toBeLessThanOrEqual(24);
    expect(e.stats().dropped).toBe(40 - 6);
    e.ctx().advance(10);
    expect(e.stats().notes).toBe(0);
    expect(e.ctx().live.size).toBe(10);
    e.sound.disable();
  });

  test("a thousand sounds later, nothing has piled up", () => {
    const e = engine();
    e.sound.enable(0.6);
    const kinds = Object.keys(RECIPES) as SoundKind[];
    for (let i = 0; i < 1000; i++) {
      e.sound.play(kinds[i % kinds.length]!, 0.7, 0);
      e.sound.mix({ ...silence, wind: i % 80 < 40 ? 0.5 : 0, rain: 0.3 }, 0.125);
      e.ctx().advance(0.125);
    }
    e.ctx().advance(30);
    for (let i = 0; i < 60; i++) e.sound.mix(silence, 0.125);
    expect(e.ctx().live.size).toBe(10);
    const s = e.stats();
    expect(s.made - s.released).toBe(10);
    expect(s.calls).toBeGreaterThan(1900);
    e.sound.disable();
  });

  test("turned on where the browser won't start it yet (no gesture), then off: nothing is left unanswered", async () => {
    const unanswered: unknown[] = [];
    const note = (reason: unknown) => void unanswered.push(reason);
    process.on("unhandledRejection", note);
    FakeContext.ungestured = true;
    try {
      const e = engine();
      expect(e.sound.enable(0.5)).toBe(true);
      expect(e.ctx().state).toBe("suspended");
      // It's asked to start again (a key, the page shown again), and still can't.
      e.sound.enable(0.5);
      e.sound.hidden(false);
      e.sound.disable();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unanswered).toEqual([]);
    } finally {
      FakeContext.ungestured = false;
      process.off("unhandledRejection", note);
    }
  });

  test("the volume is eased, a hidden page is silent, and turning it off lets everything go and closes the context", () => {
    const e = engine();
    e.sound.enable(0.5);
    expect(listeners.get("visibilitychange")!.size).toBe(1);
    const master = e.ctx().all.find((n) => n.kind === "gain")!;
    expect(master.gain.value).toBeCloseTo(0.25);
    e.sound.setVolume(1);
    expect(master.gain.value).toBe(1);
    e.sound.setVolume(7);
    expect(e.stats().volume).toBe(1);
    doc.hidden = true;
    for (const fn of listeners.get("visibilitychange")!) fn();
    expect(e.ctx().state).toBe("suspended");
    doc.hidden = false;
    for (const fn of listeners.get("visibilitychange")!) fn();
    expect(e.ctx().state).toBe("running");
    e.sound.mix({ ...silence, rain: 1 }, 0.125);
    e.sound.play("hammer");
    const ctx = e.ctx();
    e.sound.disable();
    expect(ctx.live.size).toBe(0);
    expect(ctx.closed).toBe(true);
    expect(listeners.get("visibilitychange")!.size).toBe(0);
    expect(e.stats()).toMatchObject({ on: false, nodes: 0, notes: 0, beds: {} });
    // And on again: a fresh context.
    expect(e.sound.enable(0.5)).toBe(true);
    expect(e.made()).toBe(2);
    e.sound.disable();
  });

  test("where there's no Web Audio, it says so and stays off", () => {
    const sound = new Sound(() => {
      throw new Error("no audio here");
    });
    expect(sound.enable(0.5)).toBe(false);
    expect(sound.on).toBe(false);
  });
});
