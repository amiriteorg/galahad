import { type Mix, type Note, RECIPES, type SoundKind } from "./soundscape.ts";

/*
 * The sound of his world, as Web Audio: a thin layer over soundscape.ts, which
 * says what's heard and how each sound is made. Everything is synthesised here
 * from one two-second loop of noise and from oscillators: no files, no
 * dependencies.
 *
 * Off, there is nothing: no AudioContext, no node, no listener, no timer. It's
 * made when the owner turns the sound on (a click: browsers want a gesture
 * before a page may make a sound) and closed again when they turn it off. On,
 * it holds a few nodes and no more:
 *
 *   always          the volume and a limiter (2), eight panners the short
 *                   sounds share (8);
 *   a bed, while    wind, rain, the lake, the fire, a pen or chalk, insects: a
 *   it's heard      looped noise source, a filter, a gain (and a panner where
 *                   it has a place): started when it's first heard, stopped
 *                   and let go four seconds after it falls silent;
 *   a short sound   a source and a gain a note (a filter for a noise burst),
 *                   let go the moment it ends; at most 24 notes at once.
 *
 * The scene calls `mix` a few times a second (never per frame) and `play` when
 * something happens. Nothing is allocated on the main thread per frame; what a
 * call costs is counted (`stats`). While the tab is hidden the context is
 * suspended: a hidden page makes no sound.
 */

type BedName = "wind" | "rain" | "lake" | "fire" | "scratch" | "insects";

interface Bed {
  source: AudioBufferSourceNode | null;
  filter: BiquadFilterNode | null;
  gain: GainNode | null;
  pan: StereoPannerNode | null;
  /** Seconds it's been silent. */
  quiet: number;
}

/** Each bed's filter, and whether it has a place (a panner). */
const BEDS: Record<BedName, { type: BiquadFilterType; freq: number; q: number; placed: boolean; level: number }> = {
  wind: { type: "bandpass", freq: 300, q: 0.55, placed: false, level: 0.55 },
  rain: { type: "bandpass", freq: 4000, q: 0.35, placed: false, level: 0.42 },
  lake: { type: "lowpass", freq: 430, q: 0.7, placed: true, level: 0.5 },
  fire: { type: "bandpass", freq: 950, q: 0.5, placed: true, level: 0.22 },
  scratch: { type: "bandpass", freq: 4300, q: 1.6, placed: true, level: 0.16 },
  insects: { type: "bandpass", freq: 5600, q: 8, placed: false, level: 0.2 },
};
const BED_NAMES = Object.keys(BEDS) as BedName[];

/** A bed is let go this long after it falls silent (seconds); the panners the short sounds share; the most notes at once. */
const RELEASE_S = 4;
const CHANNELS = 8;
const MAX_NOTES = 24;

export interface SoundStats {
  on: boolean;
  /** The context's state ("running", "suspended"), or "none". */
  state: string;
  volume: number;
  /** Audio nodes held now; made and let go since it was turned on. */
  nodes: number;
  made: number;
  released: number;
  /** The beds running now, and each one's level (0..1, as last set). */
  beds: Record<string, number>;
  /** Notes sounding now, and how often each short sound was played. */
  notes: number;
  played: Record<string, number>;
  dropped: number;
  /** The main thread's time in here (milliseconds), and how many calls it was. */
  ms: number;
  calls: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private channels: StereoPannerNode[] = [];
  private next = 0;
  private readonly beds: Record<BedName, Bed> = Object.fromEntries(BED_NAMES.map((n) => [n, { source: null, filter: null, gain: null, pan: null, quiet: 0 }])) as Record<BedName, Bed>;
  private readonly levels: Record<BedName, number> = { wind: 0, rain: 0, lake: 0, fire: 0, scratch: 0, insects: 0 };
  private volume = 0.6;
  private notes = 0;
  private made = 0;
  private released = 0;
  private dropped = 0;
  private ms = 0;
  private calls = 0;
  private readonly played: Record<string, number> = {};
  /** The notes sounding now, each with what was made for it (let go when it ends, or when the sound's turned off). */
  private readonly flying = new Set<{ source: AudioScheduledSourceNode; filter: BiquadFilterNode | null; env: GainNode }>();
  /** The clock of the lake's lapping and the pen's strokes (seconds). */
  private clock = 0;
  private readonly onVisibility = (): void => this.hidden(document.hidden);

  /** `context`: how an AudioContext is made (the tests hand in a stand-in). */
  constructor(private readonly context: () => AudioContext = () => new AudioContext({ latencyHint: "interactive" })) {}

  get on(): boolean {
    return this.ctx !== null;
  }

  private make<T extends AudioNode>(node: T): T {
    this.made++;
    return node;
  }

  private drop(node: AudioNode | null): void {
    if (!node) return;
    try {
      node.disconnect();
    } catch {
      /* already let go */
    }
    this.released++;
  }

  /** Turns the sound on (from a click or a key: browsers want a gesture). False where there's no Web Audio. */
  enable(volume: number): boolean {
    if (this.ctx) {
      this.setVolume(volume);
      void this.ctx.resume?.();
      return true;
    }
    let ctx: AudioContext;
    try {
      ctx = this.context();
    } catch {
      return false;
    }
    this.ctx = ctx;
    this.made = this.released = this.dropped = this.notes = this.ms = this.calls = 0;
    for (const key of Object.keys(this.played)) delete this.played[key];
    this.limiter = this.make(ctx.createDynamicsCompressor());
    this.limiter.threshold.value = -14;
    this.limiter.ratio.value = 6;
    this.limiter.connect(ctx.destination);
    this.master = this.make(ctx.createGain());
    this.master.connect(this.limiter);
    this.volume = -1;
    this.setVolume(volume);
    this.channels = Array.from({ length: CHANNELS }, () => {
      const pan = this.make(ctx.createStereoPanner());
      pan.connect(this.master!);
      return pan;
    });
    // Two seconds of noise, made once: every hiss, patter and crackle is cut from it.
    const length = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let s = 0x2f6e2b1;
    for (let i = 0; i < length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      data[i] = ((s >>> 0) / 2147483648 - 1) * 0.9;
    }
    document.addEventListener("visibilitychange", this.onVisibility);
    void ctx.resume?.();
    if (document.hidden) this.hidden(true);
    return true;
  }

  /** Turns it off: everything is let go, and the context closed. */
  disable(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const name of BED_NAMES) this.releaseBed(name);
    for (const note of this.flying) {
      note.source.onended = null;
      try {
        note.source.stop();
      } catch {
        /* not started yet */
      }
      this.drop(note.source);
      this.drop(note.filter);
      this.drop(note.env);
    }
    this.flying.clear();
    for (const pan of this.channels) this.drop(pan);
    this.channels = [];
    this.drop(this.master);
    this.drop(this.limiter);
    this.master = this.limiter = null;
    this.noise = null;
    this.ctx = null;
    this.notes = 0;
    void ctx.close?.().catch(() => {});
  }

  /** 0 (silent) to 1: how loud it all is (eased, never a click). */
  setVolume(volume: number): void {
    const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.6));
    if (v === this.volume) return;
    this.volume = v;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.05);
  }

  /** A hidden page makes no sound: the context sleeps, and wakes when the page is seen again. */
  hidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend?.();
    else void this.ctx.resume?.();
  }

  private startBed(name: BedName): Bed {
    const bed = this.beds[name];
    const ctx = this.ctx!;
    const spec = BEDS[name];
    bed.source = this.make(ctx.createBufferSource());
    bed.source.buffer = this.noise;
    bed.source.loop = true;
    bed.filter = this.make(ctx.createBiquadFilter());
    bed.filter.type = spec.type;
    bed.filter.frequency.value = spec.freq;
    bed.filter.Q.value = spec.q;
    bed.gain = this.make(ctx.createGain());
    bed.gain.gain.value = 0;
    bed.source.connect(bed.filter);
    bed.filter.connect(bed.gain);
    if (spec.placed) {
      bed.pan = this.make(ctx.createStereoPanner());
      bed.gain.connect(bed.pan);
      bed.pan.connect(this.master!);
    } else bed.gain.connect(this.master!);
    // (Each from its own place in the loop, so two beds never play the same noise in step.)
    bed.source.start(0, (BED_NAMES.indexOf(name) * 0.31) % 2);
    bed.quiet = 0;
    return bed;
  }

  private releaseBed(name: BedName): void {
    const bed = this.beds[name];
    if (!bed.source) return;
    try {
      bed.source.stop();
    } catch {
      /* never started */
    }
    this.drop(bed.source);
    this.drop(bed.filter);
    this.drop(bed.gain);
    this.drop(bed.pan);
    bed.source = null;
    bed.filter = bed.gain = null;
    bed.pan = null;
    this.levels[name] = 0;
  }

  private setBed(name: BedName, level: number, dt: number, tone = 0, pan = 0): void {
    let bed = this.beds[name];
    const want = Math.max(0, Math.min(1, level));
    if (want < 0.004) {
      if (!bed.source) return;
      bed.quiet += dt;
      bed.gain!.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.25);
      this.levels[name] = 0;
      if (bed.quiet > RELEASE_S) this.releaseBed(name);
      return;
    }
    if (!bed.source) bed = this.startBed(name);
    bed.quiet = 0;
    const now = this.ctx!.currentTime;
    this.levels[name] = want;
    bed.gain!.gain.setTargetAtTime(want * BEDS[name].level, now, 0.3);
    if (tone > 0) bed.filter!.frequency.setTargetAtTime(tone, now, 0.5);
    if (bed.pan) bed.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.2);
  }

  /** What's heard now (soundscape.ts' mixFor), `dt` seconds after the last call. A few times a second, never per frame. */
  mix(m: Mix, dt: number): void {
    if (!this.ctx) return;
    const began = performance.now();
    this.clock += dt;
    const t = this.clock;
    // The wind comes in gusts; the lake laps (a wave every three seconds or so, never quite the same); a pen moves in strokes.
    this.setBed("wind", m.wind * (0.78 + 0.22 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1)), dt, m.windTone * (1 + 0.12 * Math.sin(t * 0.41)));
    this.setBed("rain", m.rain, dt, m.rainTone);
    this.setBed("lake", m.lake * (0.35 + 0.65 * Math.max(0, Math.sin(t * 2.05) * Math.sin(t * 0.37 + 0.6)) ** 0.6), dt, 0, m.lakePan);
    this.setBed("fire", m.fire * (0.8 + 0.2 * Math.sin(t * 5.3)), dt, 0, m.firePan);
    this.setBed("scratch", m.scratch * Math.max(0, Math.sin(t * 9.1) * Math.sin(t * 1.7)) ** 0.5, dt, 0, m.scratchPan);
    this.setBed("insects", m.insects * (0.6 + 0.4 * Math.abs(Math.sin(t * 3.3))), dt);
    this.ms += performance.now() - began;
    this.calls++;
  }

  /**
   * A short sound, now (or `delay` seconds on): `gain` and `pan` are where it is for the listener (soundscape.ts' hear),
   * `pitch` shifts it (a little chance in every step and chirp), `stretch` lengthens its decay (thunder, far off).
   */
  play(kind: SoundKind, gain = 1, pan = 0, pitch = 1, delay = 0, stretch = 1): void {
    const ctx = this.ctx;
    if (!ctx || gain < 0.01) return;
    const began = performance.now();
    const recipe = RECIPES[kind];
    if (this.notes + recipe.length > MAX_NOTES) {
      this.dropped++;
      return;
    }
    const channel = this.channels[this.next++ % CHANNELS]!;
    channel.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime);
    for (let i = 0; i < recipe.length; i++) this.note(ctx, recipe[i]!, channel, gain, pitch, ctx.currentTime + delay, stretch);
    this.played[kind] = (this.played[kind] ?? 0) + 1;
    this.ms += performance.now() - began;
    this.calls++;
  }

  private note(ctx: AudioContext, n: Note, out: AudioNode, gain: number, pitch: number, start: number, stretch: number): void {
    const t0 = start + n.at;
    const decay = n.decay * stretch;
    const end = t0 + n.attack + decay * 4;
    const env = this.make(ctx.createGain());
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(n.gain * gain, t0 + n.attack);
    env.gain.setTargetAtTime(0, t0 + n.attack, decay);
    env.connect(out);
    let source: AudioScheduledSourceNode;
    let filter: BiquadFilterNode | null = null;
    if (n.src === "noise") {
      const s = this.make(ctx.createBufferSource());
      s.buffer = this.noise;
      s.loop = true;
      filter = this.make(ctx.createBiquadFilter());
      filter.type = n.filter ?? "bandpass";
      filter.Q.value = n.q ?? 1;
      filter.frequency.setValueAtTime(n.f0 * pitch, t0);
      if (n.f1 !== n.f0) filter.frequency.exponentialRampToValueAtTime(Math.max(20, n.f1 * pitch), t0 + n.attack + decay * 2);
      s.connect(filter);
      filter.connect(env);
      s.start(t0, (this.next * 0.137) % 1.5);
      source = s;
    } else {
      const o = this.make(ctx.createOscillator());
      o.type = n.src;
      o.frequency.setValueAtTime(n.f0 * pitch, t0);
      if (n.f1 !== n.f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, n.f1 * pitch), t0 + n.attack + decay);
      o.connect(env);
      o.start(t0);
      source = o;
    }
    source.stop(end);
    this.notes++;
    const flying = { source, filter, env };
    this.flying.add(flying);
    // Let go the moment it ends: nothing made for a sound outlives it.
    source.onended = () => {
      source.onended = null;
      if (!this.flying.delete(flying)) return;
      this.notes = Math.max(0, this.notes - 1);
      this.drop(source);
      this.drop(filter);
      this.drop(env);
    };
  }

  /** What it holds and what it's cost, into `out` (for the HUD's tooltip, the page's trace and the tests). */
  stats(out: SoundStats): SoundStats {
    out.on = this.on;
    out.state = this.ctx?.state ?? "none";
    out.volume = this.volume < 0 ? 0 : this.volume;
    out.made = this.made;
    out.released = this.released;
    out.nodes = this.on ? this.made - this.released : 0;
    out.notes = this.notes;
    out.dropped = this.dropped;
    out.ms = this.ms;
    out.calls = this.calls;
    for (const key of Object.keys(out.beds)) delete out.beds[key];
    for (const name of BED_NAMES) if (this.beds[name].source) out.beds[name] = Math.round(this.levels[name] * 1000) / 1000;
    for (const key of Object.keys(out.played)) delete out.played[key];
    Object.assign(out.played, this.played);
    return out;
  }
}

export const emptySoundStats = (): SoundStats => ({ on: false, state: "none", volume: 0, nodes: 0, made: 0, released: 0, beds: {}, notes: 0, played: {}, dropped: 0, ms: 0, calls: 0 });
