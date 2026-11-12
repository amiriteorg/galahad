import { BOARD_H, BOARD_W } from "@galahad/core/board";
import { type WorldQuest, worldQuestInHand, worldQuestLine } from "@galahad/core/world-quest";
import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, LinearFilter, Mesh, MeshLambertNodeMaterial, PlaneGeometry, SRGBColorSpace } from "three/webgpu";
import { planSlate, SLATE_REGIONS, slateChore, slateKey, type SlatePart } from "../lib/world-quest.ts";
import { paintBoard } from "../ui/chalk.ts";
import type { Collider } from "./colliders.ts";
import { headingToSceneYaw, toScene, type Vec3 } from "./coords.ts";
import { at, groundAO, Mesher, within } from "./mesher.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";
import { overSlate, SLATE, SLATE_COLLIDERS, slatePoint, slateStand } from "./slate-plan.ts";

/*
 * His slate, by the council table: a quest in hand, in chalk. The plan as the
 * planner wrote it, the stage he's at (ringed), a tally of the commands he's run,
 * each gate ticked as it passes or crossed where it failed, and how it ended;
 * wiped a while after (the node stops sending it: core's world-quest.ts).
 *
 * A smaller sister of the chalkboard at the observatory (board.ts), and his own:
 * the board you share with him is never written on from here. Its face is a
 * texture painted with the same chalk (ui/chalk.ts) from lib/world-quest.ts'
 * marks, painted again only when what's drawn changes, never per frame.
 *
 * When there's something worth chalking (the plan, a gate's result, the outcome)
 * and he's nearby, he steps over, stands before that part and writes it for a
 * couple of seconds, then goes back to the table; what he writes shows as he
 * starts. Elsewhere, or under reduced motion, it's simply there.
 */

/** Seconds he writes for, a part. */
const WRITE_S = 2.6;
/** Given up on, if he hasn't reached the slate by then. */
const ARRIVE_S = 20;
/** He walks over only from this near (the council table is 4 m off): from elsewhere it's simply written. */
const NEAR = 9;

const TEXTURE_W: Record<string, number> = { low: 512, medium: 1024, high: 1600 };
const WOOD = 0xb57c4e;
const WOOD_DARK = 0x8b5a39;
const SLATE_EDGE = 0x26302c;

interface Chore {
  part: SlatePart;
  stand: { x: number; y: number; facing: number };
  queued: number;
  started: number | null;
}

export class PlanSlate implements Place {
  readonly group = new Group();
  readonly warmGlows: readonly Glow[] = [];
  readonly coolGlows: readonly Glow[] = [];
  readonly colliders: readonly Collider[] = SLATE_COLLIDERS;
  /** The scene calls this when where he should stand changes (something to go and write, or done). */
  onStand: (() => void) | null = null;
  private readonly canvas = document.createElement("canvas");
  private readonly scratch = document.createElement("canvas");
  private readonly texture: CanvasTexture;
  private readonly faceMaterial: MeshLambertNodeMaterial;
  private readonly solidMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  /** The quest it shows (null: clean), how many more are in hand, and what the face was last painted from. */
  private quest: WorldQuest | null = null;
  private more = 0;
  private painted = "unpainted";
  /** What's on the face while he's still on his way to write the newest change: the standing before it. */
  private held: { quest: WorldQuest | null; more: number } | null = null;
  private chore: Chore | null = null;
  private now = 0;
  private galahadX = Number.NaN;
  private galahadY = Number.NaN;
  private readonly gz: number;

  constructor(ctx: PlaceContext) {
    const gz = ctx.ground(SLATE.x, SLATE.y);
    this.gz = gz;
    const [sx, , sz] = toScene(SLATE.x, SLATE.y, 0);
    const frame = at(sx, gz, sz, headingToSceneYaw(SLATE.facing));
    const solid = new Mesher();
    const add = (g: BoxGeometry | CylinderGeometry, color: number, m: ReturnType<typeof at>, vary?: number) => solid.add(g, color, within(frame, m), vary);
    const W = SLATE.width;
    const H = SLATE.height;
    const top = SLATE.bottom + H;
    const mid = SLATE.bottom + H / 2;
    // The slate's back and edge, a frame of four rails, and an easel: two legs leaning back on a third, a peg rail under the slate.
    add(new BoxGeometry(W + 0.04, H + 0.04, 0.05), SLATE_EDGE, at(0, mid, -0.02), 0.02);
    add(new BoxGeometry(W + 0.18, 0.08, 0.09), WOOD, at(0, top + 0.04, 0), 0.05);
    add(new BoxGeometry(W + 0.18, 0.08, 0.09), WOOD, at(0, SLATE.bottom - 0.04, 0), 0.05);
    for (const side of [-1, 1]) add(new BoxGeometry(0.08, H + 0.16, 0.09), WOOD, at(side * (W / 2 + 0.05), mid, 0), 0.05);
    for (const side of [-1, 1]) {
      const x = side * (W / 2 + 0.13);
      add(new BoxGeometry(0.07, top + 0.2, 0.07), WOOD_DARK, at(x, (top + 0.2) / 2, -0.02), 0.05);
      add(new BoxGeometry(0.09, 0.06, 0.56), WOOD_DARK, at(x, 0.03, -0.12), 0.05);
      add(new BoxGeometry(0.045, 1.0, 0.045), WOOD_DARK, at(x, 0.46, -0.22, 0, 1, -0.42), 0.04);
    }
    // A shelf for the chalk and a rag, and a little pennant of his orange on the left leg's top.
    const tray = SLATE.bottom - 0.09;
    add(new BoxGeometry(W * 0.7, 0.022, 0.1), WOOD, at(0, tray, 0.07), 0.04);
    add(new BoxGeometry(W * 0.7, 0.03, 0.014), WOOD_DARK, at(0, tray + 0.022, 0.12), 0.04);
    for (const [x, color] of [[-0.4, 0xf2efe6], [-0.31, 0xf4d872], [-0.2, 0xa7d99c], [0.02, 0xf2a3bd]] as const) add(new CylinderGeometry(0.011, 0.011, 0.08, 6), color, at(x, tray + 0.022, 0.07, 0.2 * x, 1, 0, Math.PI / 2), 0.04);
    add(new BoxGeometry(0.16, 0.03, 0.07), 0xd8d0c2, at(0.45, tray + 0.026, 0.07, 0.16), 0.03);
    add(new BoxGeometry(0.012, 0.3, 0.012), WOOD_DARK, at(-(W / 2 + 0.13), top + 0.34, -0.02), 0);
    add(new BoxGeometry(0.2, 0.11, 0.008), 0xe8853a, at(-(W / 2 + 0.13) + 0.1, top + 0.43, -0.02), 0.03);
    const mesh = new Mesh(solid.build({ ao: groundAO(0.6, 1.2, 0.72, gz) }), this.solidMaterial);
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = ctx.shadows;

    const width = TEXTURE_W[ctx.tier.name] ?? 1024;
    this.canvas.width = width;
    this.canvas.height = Math.round((width * BOARD_H) / BOARD_W);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.faceMaterial = new MeshLambertNodeMaterial({ map: this.texture });
    const face = new Mesh(new PlaneGeometry(W, H), this.faceMaterial);
    face.applyMatrix4(within(frame, at(0, mid, 0.006)));
    face.receiveShadow = ctx.shadows;
    this.group.add(mesh, face);
    this.paint();
  }

  /**
   * The quest the slate shows now (lib/world.ts' slateQuest; null: wiped) and how many more are in hand. When the
   * change is worth chalking and he's near, he goes and writes it (the face keeps the standing before until he starts).
   */
  setQuest(quest: WorldQuest | null, more: number, motion: boolean): void {
    if (slateKey(quest, more) === slateKey(this.quest, this.more)) return;
    const part = motion ? slateChore(this.quest, quest) : null;
    const near = Math.hypot(this.galahadX - SLATE.x, this.galahadY - SLATE.y) < NEAR;
    const before = { quest: this.quest, more: this.more };
    this.quest = quest;
    this.more = more;
    if (part && near) {
      // One chore at a time: a change that lands while he's writing (or on his way) joins what he's writing.
      const first = !this.chore;
      if (!this.chore) {
        this.held = before;
        this.chore = { part, stand: slateStand(SLATE_REGIONS[part]), queued: this.now, started: null };
      }
      this.paint();
      if (first) this.onStand?.();
      return;
    }
    if (!this.chore || this.chore.started !== null) this.held = null;
    this.paint();
  }

  /** The quest on it now, for words (never drawn text): null when it's clean. */
  get shown(): WorldQuest | null {
    return this.quest;
  }

  /** Where he should stand now: before the slate, while he has something to write; otherwise null. */
  stand(): { x: number; y: number; facing: number } | null {
    return this.chore?.stand ?? null;
  }

  /** Writing now: where his hand is (the chalk on the face, along the part he writes), into `out`. */
  hand(out: { x: number; y: number; z: number; on: boolean }): boolean {
    const chore = this.chore;
    if (!chore || chore.started === null) return false;
    const r = SLATE_REGIONS[chore.part];
    const lines = Math.max(1, Math.min(4, Math.round(r.h / 70)));
    const p = Math.min(0.999, (this.now - chore.started) / WRITE_S) * lines;
    const line = Math.floor(p);
    const across = p - line;
    const reach = Math.min(r.w / 2, 280);
    slatePoint(r.x + r.w / 2 - reach + across * 2 * reach, r.y + ((line + 0.6) / lines) * r.h, out);
    // Within his reach, on the ground's level.
    out.z = this.gz + Math.max(1.05, Math.min(1.95, out.z));
    out.on = true;
    return true;
  }

  /** Where the middle of the face is (world, z up), for a glance at it. */
  middle(out: { x: number; y: number; z: number }): void {
    slatePoint(BOARD_W / 2, BOARD_H * 0.4, out);
    out.z += this.gz;
  }

  private paint(): void {
    const show = this.held ?? { quest: this.quest, more: this.more };
    const key = slateKey(show.quest, show.more);
    if (key === this.painted) return;
    this.painted = key;
    paintBoard(this.canvas, this.scratch, planSlate(show.quest, show.more));
    this.texture.needsUpdate = true;
  }

  setNight(): void {}
  setOccupied(): void {}

  animate(frame: PlaceFrame): void {
    this.now = frame.t;
    this.galahadX = frame.galahadX;
    this.galahadY = frame.galahadY;
    const chore = this.chore;
    if (!chore) return;
    if (chore.started === null) {
      const there = Math.hypot(frame.galahadX - chore.stand.x, frame.galahadY - chore.stand.y) < 0.6;
      if (there || !frame.motion || frame.t - chore.queued > ARRIVE_S) {
        // He's there (or isn't coming): what he writes shows as he starts.
        chore.started = there && frame.motion ? frame.t : frame.t - WRITE_S;
        this.held = null;
        this.paint();
      }
    }
    if (chore.started !== null && frame.t - chore.started >= WRITE_S) {
      this.chore = null;
      this.onStand?.();
    }
  }

  hover(x: number, y: number, out: Vec3): string | null {
    if (!overSlate(x, y)) return null;
    out[0] = SLATE.x;
    out[1] = SLATE.y;
    out[2] = SLATE.bottom + SLATE.height + 0.35;
    const q = this.quest;
    // (Fixed words only: a quest's own are on the slate, and in full on Overview.)
    return q ? `His slate · ${worldQuestInHand(q.state) ? "a quest in hand" : "a quest ended"}: ${worldQuestLine(q).toLowerCase()}` : "His slate · no quest in hand";
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.texture.dispose();
    this.faceMaterial.dispose();
    this.solidMaterial.dispose();
  }
}
