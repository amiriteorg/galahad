import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVITY_LABEL,
  type Activity,
  EYES,
  EYES_PLACE_LABEL,
  EYES_PLACES,
  EYES_TYPES,
  type EyesFrameInfo,
  type EyesFrameInput,
  type EyesPlace,
  type EyesRequest,
  eyesExtension,
  type GalahadState,
  imageInfo,
  lifeAt,
  type LookView,
  sightInWords,
  STATIONS,
  withDog,
  type WorldWeather,
} from "@galahad/core";
import { z } from "zod";
import { atomicWrite } from "./board.ts";

/*
 * His eyes, on the node (core's eyes.ts has the contract). The node has no GPU: a
 * picture of what he sees is rendered by a page that has the SANDBOX open, on one
 * of the owner's paired devices. `look` asks those pages for a frame over the
 * world's stream and waits a few seconds for one to post it back; the last few
 * frames are kept here, in the node's home (`eyes/`), each with when and by which
 * device it was made: node-local files, like the chalkboard's picture, never the
 * mind's log (which carries no presence and no pictures), bounded and rotated.
 *
 * A frame is data from that device, never instructions. It's taken only when it
 * answers a request that's waiting (an answer nobody asked for is refused), once;
 * its bytes must be the image they claim to be (the header is read here), within
 * the size and shape the contract allows; and pages are asked only so often.
 * With no page open, `look` says so and gives what the node itself knows: where
 * he is and what he's doing (the world hub; his day's plan when there's no work)
 * and the weather it has, with the last kept frame and how old it is.
 */

export class EyesError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const FrameInfo = z.strictObject({
  id: z.string().regex(/^ey_[A-Za-z0-9_-]{16}$/),
  at: z.number().int().nonnegative(),
  device: z.string().max(200),
  type: z.enum(EYES_TYPES),
  width: z.number().int().min(0).max(EYES.maxWidth),
  height: z.number().int().min(0).max(EYES.maxHeight),
  bytes: z.number().int().min(0).max(EYES.maxBytes),
  place: z.enum(EYES_PLACES).nullable(),
  shut: z.boolean(),
  words: z.string().max(EYES.words),
});
const Index = z.strictObject({ v: z.literal(1), frames: z.array(FrameInfo).max(EYES.kept * 4) });

const FILE = /^ey_[A-Za-z0-9_-]{16}\.(jpg|webp|png)$/;

/** The last few frames from his eyes, on disk: an index and a file a frame, each written whole and renamed into place (mode 600). */
export class EyesStore {
  private frames: EyesFrameInfo[] = [];
  private readonly dir: string;
  private readonly now: () => number;

  constructor(opts: { dir: string; now?: () => number; log?: (message: string) => void }) {
    this.dir = opts.dir;
    this.now = opts.now ?? Date.now;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const path = join(this.dir, "index.json");
    if (existsSync(path)) {
      try {
        this.frames = Index.parse(JSON.parse(readFileSync(path, "utf8"))).frames.filter((f) => f.shut || existsSync(this.path(f)));
      } catch {
        // Never trusted: set aside, and the eyes start with nothing kept.
        renameSync(path, `${path}.corrupt-${this.now()}`);
        opts.log?.("eyes: the frame index couldn't be read and was set aside");
      }
    }
    this.sweep();
  }

  private path(f: Pick<EyesFrameInfo, "id" | "type">): string {
    return join(this.dir, `${f.id}.${eyesExtension(f.type)}`);
  }

  /** Files no frame in the index names (a crash between the two writes, a rotated frame) go. */
  private sweep(): void {
    const kept = new Set(this.frames.filter((f) => !f.shut).map((f) => `${f.id}.${eyesExtension(f.type)}`));
    for (const name of readdirSync(this.dir)) if (FILE.test(name) && !kept.has(name)) rmSync(join(this.dir, name), { force: true });
  }

  /** Keeps a frame (its picture first, then the index that names it); the oldest beyond EYES.kept go. */
  add(frame: Omit<EyesFrameInfo, "at" | "bytes">, picture: Uint8Array | null): EyesFrameInfo {
    const info: EyesFrameInfo = { ...frame, at: this.now(), bytes: picture?.length ?? 0 };
    if (picture) atomicWrite(this.path(info), picture);
    this.frames = [...this.frames, info].slice(-EYES.kept);
    atomicWrite(join(this.dir, "index.json"), JSON.stringify({ v: 1, frames: this.frames }));
    this.sweep();
    return info;
  }

  /** Newest last. */
  list(): EyesFrameInfo[] {
    return [...this.frames];
  }

  /** The newest frame from where he was (place null) or from a standing place. */
  latest(place: EyesPlace | null = null): EyesFrameInfo | null {
    for (let i = this.frames.length - 1; i >= 0; i--) if (this.frames[i]!.place === place) return this.frames[i]!;
    return null;
  }

  /** A kept frame's picture; null when it has none (shut eyes) or its file is gone or no longer the image it was. */
  picture(id: string): Uint8Array | null {
    const frame = this.frames.find((f) => f.id === id);
    if (!frame || frame.shut) return null;
    try {
      const bytes = new Uint8Array(readFileSync(this.path(frame)));
      return imageInfo(bytes)?.type === frame.type && bytes.length === frame.bytes ? bytes : null;
    } catch {
      return null;
    }
  }
}

/** What the eyes need of the world hub. */
export interface EyesWorld {
  /** How many pages that draw the world are watching. */
  readonly eyesOpen: number;
  /** Ask them all for a frame; how many were asked. */
  askEyes(request: EyesRequest): number;
  readonly state: GalahadState;
}

interface Waiting {
  request: EyesRequest;
  place: EyesPlace | null;
  done: (frame: EyesFrameInfo | null) => void;
  promise: Promise<EyesFrameInfo | null>;
  timer: ReturnType<typeof setTimeout>;
}

const WHERE: Record<Activity, string> = {
  sleep: "at his hearth",
  wake: "at his hearth",
  rounds: "on his morning rounds of the keep's stations",
  walk: "out on the trail by the lake and the meadow",
  "walk-dog": "on the lawn by the keep",
  friends: "on the keep's lawn, with the Microducks",
  library: "at the library",
  workshop: "at the workshop",
  field: "up at the proving ground",
  council: "at the council table",
  observatory: "at the observatory, by the chalkboard",
  ponder: "on the bench by the lake",
  hearth: "at his hearth",
  journal: "at his desk, at his hearth",
};

/** The weather in a few words: "overcast, 7 °C". */
export const weatherWords = (w: WorldWeather | null): string => (w ? `${w.kind}, ${Math.round(w.temperature)} °C` : "");

/**
 * What the node itself can say of what he sees, with no page to render it: where he is and what he's
 * doing (at work: the station only, never what the work is about; with no work: his day's plan), and the
 * weather it has. It says nothing of what stands in view: it can't know.
 */
export function nodeWords(state: GalahadState, now: number, weather: WorldWeather | null, dog: string | null): string {
  const idle = state.idle ?? (state.station === "keep" && !state.experiment);
  const activity = lifeAt(now).activity;
  const where = idle ? WHERE[activity] : state.station === "field" ? "out at an experiment" : `at the ${STATIONS[state.station].label.replace(/^The /, "").toLowerCase()}`;
  const doing = idle ? withDog(ACTIVITY_LABEL[activity], dog) : "At work";
  return sightInWords({ now, where, doing, eye: null, shut: idle && activity === "sleep" ? 1 : 0, lookingAt: null, things: [], sky: [], weather: weatherWords(weather), season: "", light: "" });
}

/** Text from a device, as a model may read it: no control, bidirectional-override or zero-width characters. */
export const cleanWords = (text: string): string =>
  text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EYES.words);

export class Eyes {
  private readonly waiting = new Map<string, Waiting>();
  private asked: number[] = [];
  private readonly now: () => number;
  private readonly waitMs: number;

  constructor(
    private readonly opts: {
      store: EyesStore;
      world: EyesWorld;
      weather?: () => WorldWeather | null;
      dog?: () => string | null;
      now?: () => number;
      waitMs?: number;
    },
  ) {
    this.now = opts.now ?? Date.now;
    this.waitMs = opts.waitMs ?? EYES.waitMs;
  }

  get store(): EyesStore {
    return this.opts.store;
  }

  /** What the node knows without a page. */
  words(): string {
    return nodeWords(this.opts.world.state, this.now(), this.opts.weather?.() ?? null, this.opts.dog?.() ?? null);
  }

  /**
   * Asks the pages that draw the world for a frame and waits for the first answer. One request per place
   * at a time (a second asker waits on the first's); null when none answered in time. Throws 429 when
   * pages have been asked too often in the last minute.
   */
  request(place: EyesPlace | null = null): Promise<EyesFrameInfo | null> {
    for (const w of this.waiting.values()) if (w.place === place) return w.promise;
    const now = this.now();
    this.asked = this.asked.filter((t) => now - t < 60_000);
    if (this.asked.length >= EYES.perMinute) throw new EyesError(429, `his eyes were asked for ${EYES.perMinute} frames in the last minute; wait a little`);
    this.asked.push(now);
    const request: EyesRequest = { id: `ey_${randomBytes(12).toString("base64url")}`, width: EYES.width, ...(place ? { place } : {}) };
    let done!: (frame: EyesFrameInfo | null) => void;
    const promise = new Promise<EyesFrameInfo | null>((resolve) => (done = resolve));
    const timer = setTimeout(() => this.settle(request.id, null), this.waitMs);
    timer.unref?.();
    this.waiting.set(request.id, { request, place, done, promise, timer });
    if (!this.opts.world.askEyes(request)) this.settle(request.id, null);
    return promise;
  }

  private settle(id: string, frame: EyesFrameInfo | null): void {
    const w = this.waiting.get(id);
    if (!w) return;
    this.waiting.delete(id);
    clearTimeout(w.timer);
    w.done(frame);
  }

  /**
   * A page's answer. Refused unless it names a request that's still waiting (so an answer nobody asked
   * for, a second answer and a late one are all refused), and unless its picture is the image it claims:
   * its own header's type and size must be what was said, within the contract's limits.
   */
  answer(input: z.infer<typeof EyesFrameInput>, device: string): EyesFrameInfo {
    const w = this.waiting.get(input.request);
    if (!w) throw new EyesError(409, "nobody asked for this frame (or it was answered already, or came too late)");
    const words = cleanWords(input.words);
    if (!words) throw new EyesError(400, "a frame comes with what he sees, in words");
    let picture: Uint8Array | null = null;
    let type: EyesFrameInfo["type"] = "image/jpeg";
    let width = 0;
    let height = 0;
    if (!input.shut) {
      picture = new Uint8Array(Buffer.from(input.image!, "base64"));
      if (!picture.length || picture.length > EYES.maxBytes) throw new EyesError(413, `a frame is at most ${EYES.maxBytes} bytes`);
      const seen = imageInfo(picture);
      if (!seen || seen.type !== input.type || seen.width !== input.width || seen.height !== input.height) throw new EyesError(400, "the picture isn't the image it claims to be");
      if (seen.width < EYES.minWidth || seen.width > EYES.maxWidth || seen.height < EYES.minHeight || seen.height > EYES.maxHeight) throw new EyesError(400, "the picture's size is outside what a frame may be");
      ({ type, width, height } = seen);
    }
    const frame = this.opts.store.add({ id: w.request.id, device: device.slice(0, 200), type, width, height, place: w.place, shut: !!input.shut, words }, picture);
    this.settle(input.request, frame);
    return frame;
  }

  /**
   * `look`: the words always, and a picture when one can be had. A frame kept in the last few seconds
   * answers without asking again; with no page open, or none answering, it says so and gives what the
   * node knows and the last frame with its age. Never words about a picture that isn't given.
   */
  async look(input: { place?: EyesPlace | undefined; words?: boolean | undefined } = {}): Promise<LookView> {
    const place = input.place ?? null;
    const view = (frame: EyesFrameInfo | null, live: boolean, note: string | null): LookView => {
      const picture = frame && !input.words ? this.opts.store.picture(frame.id) : null;
      const fromPage = !!frame && live;
      return {
        words: fromPage ? frame.words : this.words(),
        source: fromPage ? "page" : "node",
        live,
        note,
        frame: frame ? { ...frame, ageMs: Math.max(0, this.now() - frame.at), data: picture ? Buffer.from(picture).toString("base64") : null } : null,
      };
    };
    const shutNote = "His eyes are shut (he's asleep), so there's no picture: only what the world itself says.";
    const last = this.opts.store.latest(place);
    if (last && this.now() - last.at < EYES.freshMs) return view(last, true, last.shut ? shutNote : null);
    if (!this.opts.world.eyesOpen) {
      return view(last, false, `No page with the SANDBOX open is connected, so nothing can render his eyes now${place ? ` (nor ${EYES_PLACE_LABEL[place]})` : ""}. ${last ? "The picture is the last one kept: it shows then, not now." : "No frame has been kept yet."}`);
    }
    const frame = await this.request(place);
    if (!frame) return view(last, false, `A page has the SANDBOX open, but none answered within ${Math.round(this.waitMs / 1000)} s (a tab in the background may be asleep). ${last ? "The picture is the last one kept: it shows then, not now." : "No frame has been kept yet."}`);
    return view(frame, true, frame.shut ? shutNote : null);
  }

  close(): void {
    for (const id of [...this.waiting.keys()]) this.settle(id, null);
  }
}
