import type { Station } from "@galahad/core/world";
import type { WorldAttempt } from "@galahad/core/world-compute";
import { helperDoing } from "../lib/world-compute.ts";
import type { Squire } from "./partners.ts";
import { standAt } from "./path.ts";

/*
 * His helpers: when a quest runs several attempts at once (effort 2 or 3: more
 * compute spent for a better answer), each attempt is a small figure in the
 * squires' style at the station its work is at: at the council table while it's
 * planned, at the forge while it's worked, at the observatory while it's reviewed.
 * He stays at the council, leading them. So more compute is something you see:
 * three at the forge at once, where there was one.
 *
 * A helper stands at a post beside where he'd stand at that station (a row to his
 * left, clear of him and the dog), busy with its hands. When its work moves on to
 * another station it shrinks away and appears at its new post; when its attempt
 * ends it's gone. The figures are drawn by a second set of the squires' instanced
 * meshes (partners.ts' Partners), posed from the slots this writes. Plain numbers:
 * unit-tested without a GPU; nothing allocated per frame.
 */

/** How long a helper takes to appear and to shrink away (seconds). */
const FADE = 0.6;

export interface Post {
  x: number;
  y: number;
  facing: number;
}

/** How far behind his line the helpers' row is: a step back, clear of the lantern that stands beside each station's way in. */
const ROW_BACK = 0.75;

/** Where the k-th helper at a station stands: in a row to the left of where he'd stand there and a step behind, facing what he'd face. */
export function helperPost(station: Station, k: number, out: Post): Post {
  const s = standAt(station === "field" ? "keep" : station);
  const lateral = 1.25 + 0.82 * k;
  out.x = s.x - Math.sin(s.facing) * lateral - Math.cos(s.facing) * ROW_BACK;
  out.y = s.y + Math.cos(s.facing) * lateral - Math.sin(s.facing) * ROW_BACK;
  out.facing = s.facing;
  return out;
}

export class HelperFigures {
  /** Per slot: the attempt it is ("" free), what it says, and where it stands and should stand (a station and its place in the row). */
  private readonly id: string[];
  private readonly label: string[];
  private readonly station: Station[];
  private readonly rank: number[];
  private readonly wantStation: Station[];
  private readonly wantRank: number[];
  private readonly post: Post = { x: 0, y: 0, facing: 0 };

  constructor(private readonly squires: Squire[]) {
    const n = squires.length;
    this.id = Array.from({ length: n }, () => "");
    this.label = Array.from({ length: n }, () => "");
    this.station = Array.from({ length: n }, () => "keep" as Station);
    this.rank = Array.from({ length: n }, () => 0);
    this.wantStation = Array.from({ length: n }, () => "keep" as Station);
    this.wantRank = Array.from({ length: n }, () => 0);
  }

  /** The attempts running now (the model's `compute.attempts`): new ones appear at their station, those done go. */
  sync(attempts: readonly WorldAttempt[]): void {
    for (let i = 0; i < this.squires.length; i++) if (this.id[i] && !attempts.some((a) => a.id === this.id[i])) this.squires[i]!.here = false;
    const seen = new Map<Station, number>();
    for (const a of attempts) {
      const k = seen.get(a.station) ?? 0;
      seen.set(a.station, k + 1);
      let i = this.id.indexOf(a.id);
      if (i < 0) {
        i = this.id.indexOf("");
        if (i < 0) continue;
        const s = this.squires[i]!;
        this.id[i] = a.id;
        this.station[i] = a.station;
        this.rank[i] = k;
        const p = helperPost(a.station, k, this.post);
        Object.assign(s, { name: a.id, x: p.x, y: p.y, vx: 0, vy: 0, r: 0, heading: p.facing, shown: 0, walk: 0, work: 0 });
      }
      this.squires[i]!.here = true;
      this.label[i] = a.label;
      this.wantStation[i] = a.station;
      this.wantRank[i] = k;
    }
  }

  /** How many are about (here, or still shrinking away). */
  get count(): number {
    let n = 0;
    for (const id of this.id) if (id) n++;
    return n;
  }

  /** One step: each appears at its post and works; one whose work moved on shrinks away and appears there. True while any is about. */
  step(dt: number, motion: boolean): boolean {
    let about = false;
    for (let i = 0; i < this.squires.length; i++) {
      if (!this.id[i]) continue;
      const s = this.squires[i]!;
      const moved = this.station[i] !== this.wantStation[i] || this.rank[i] !== this.wantRank[i];
      const grow = s.here && !moved;
      s.shown = motion ? Math.max(0, Math.min(1, s.shown + (grow ? dt : -dt) / FADE)) : grow ? 1 : 0;
      if (s.shown <= 0) {
        if (!s.here) {
          // Its attempt is over: the slot is free again.
          this.id[i] = "";
          s.name = "";
          continue;
        }
        // Its work moved on: it's at its new post now (and grows there from the next step).
        this.station[i] = this.wantStation[i]!;
        this.rank[i] = this.wantRank[i]!;
        const p = helperPost(this.station[i]!, this.rank[i]!, this.post);
        s.x = p.x;
        s.y = p.y;
        s.heading = p.facing;
        if (!motion) s.shown = 1;
      }
      // Busy with its hands once it's there (still, under reduced motion).
      const busy = motion && s.shown >= 1 ? 1 : 0;
      s.work = (s.work ?? 0) + (busy - (s.work ?? 0)) * (motion ? 1 - Math.exp(-dt * 5) : 1);
      s.walk = 0;
      s.phase = (s.phase + dt * (6.5 + (i % 3) * 0.7)) % (Math.PI * 2);
      about = true;
    }
    return about;
  }

  /** The helper under a world point: what it is and what it's doing, for a hover label. */
  hover(x: number, y: number, out: [number, number, number]): string | null {
    for (let i = 0; i < this.squires.length; i++) {
      const s = this.squires[i]!;
      if (!this.id[i] || s.shown < 0.3 || Math.hypot(s.x - x, s.y - y) > 0.8) continue;
      out[0] = s.x;
      out[1] = s.y;
      out[2] = 1.25;
      return `His helper · ${helperDoing(this.station[i]!).toLowerCase()} · ${this.label[i]}`;
    }
    return null;
  }

  /** Where the helpers are (for the page's trace): [x, y, shown] each. */
  trace(): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let i = 0; i < this.squires.length; i++) if (this.id[i]) out.push([this.squires[i]!.x, this.squires[i]!.y, this.squires[i]!.shown]);
    return out;
  }
}
