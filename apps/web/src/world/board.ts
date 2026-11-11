import { BOARD_H, BOARD_W, type BoardChange, type BoardView, emptyBoard } from "@galahad/core/board";
import { STATIONS } from "@galahad/core/world";
import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, LinearFilter, Mesh, MeshLambertNodeMaterial, PlaneGeometry, SRGBColorSpace } from "three/webgpu";
import { paintBoard } from "../ui/chalk.ts";
import type { Collider } from "./colliders.ts";
import { headingToSceneYaw, toScene, type Vec3 } from "./coords.ts";
import { at, groundAO, Mesher, within } from "./mesher.ts";
import type { Glow, Place, PlaceContext, PlaceFrame } from "./place.ts";

/*
 * The chalkboard at the observatory, as the world shows it: a slate in a wooden
 * frame on two legs with splayed feet, a chalk tray along its foot with sticks
 * of chalk and a felt duster. Its face is a texture drawn from the board's
 * state with the same chalk as the page you draw on (ui/chalk.ts), drawn again
 * only when the board changes (never per frame), at a size by tier.
 *
 * When Galahad writes on it (a `board` event for an agent's item, with where
 * it went), he walks to the board, stands before that spot and writes there for
 * a few seconds, his right hand moving along the lines (the knight's own reach:
 * `writing`); the item shows on the face as he starts. Several writes queue
 * (three at most; more just appear). Under reduced motion they just appear.
 */

/** Where it stands: beside the observatory, on the keep's side, turned a little towards the way up to it. */
const OBS = STATIONS.observatory;
const STATION_FACING = Math.atan2(-OBS.y, -OBS.x);
const local = (lx: number, lz: number): [number, number] => [OBS.x - Math.sin(STATION_FACING) * lx + Math.cos(STATION_FACING) * lz, OBS.y + Math.cos(STATION_FACING) * lx + Math.sin(STATION_FACING) * lz];
const [CX, CY] = local(-4.3, 1.2);
/** The way its face looks (atan2 convention): towards the keep, turned a little towards the observatory's front. */
export const BOARD_FACING = STATION_FACING - 0.38;
/** Its face, metres: a 16:9 slate from 0.85 m to 2.2 m above the ground. */
const FACE_W = 2.4;
const FACE_H = (FACE_W * BOARD_H) / BOARD_W;
const FACE_BOTTOM = 0.85;
/** How far before the face he stands to write (his radius is 0.45). */
const STAND = 0.62;
/** Seconds he writes for, per item. */
const WRITE_S = 3.2;
/** Given up on, if he hasn't reached the board by then (a blocked way). */
const ARRIVE_S = 30;

const nx = Math.cos(BOARD_FACING);
const ny = Math.sin(BOARD_FACING);
/** The board's +x (left to right, as you face it), in the world. */
const rx = Math.cos(BOARD_FACING + Math.PI / 2);
const ry = Math.sin(BOARD_FACING + Math.PI / 2);

/** Where it stands in the world (metres, z up), and which way it faces. */
export const BOARD_SPOT = { x: CX, y: CY, facing: BOARD_FACING, width: FACE_W } as const;

/** A board point (board units) on the face, in the world (metres, z above the ground). */
export function facePoint(bx: number, by: number, out: { x: number; y: number; z: number }): void {
  const u = (Math.max(0, Math.min(BOARD_W, bx)) / BOARD_W - 0.5) * FACE_W;
  out.x = CX + rx * u + nx * 0.05;
  out.y = CY + ry * u + ny * 0.05;
  out.z = FACE_BOTTOM + (1 - Math.max(0, Math.min(BOARD_H, by)) / BOARD_H) * FACE_H;
}

/** Where he stands to write at a region: before it, his right hand over it (he faces the board, so his right is its +x). */
export function standFor(region: { x: number; w: number }): { x: number; y: number; facing: number } {
  const u = Math.max(-FACE_W / 2 + 0.3, Math.min(FACE_W / 2 - 0.1, ((region.x + region.w / 2) / BOARD_W - 0.5) * FACE_W - 0.22));
  return { x: CX + rx * u + nx * STAND, y: CY + ry * u + ny * STAND, facing: BOARD_FACING + Math.PI };
}

/** Under a ground point: the board, seen from the front at the usual heights (the ground behind the face is where a look through it lands). */
export function overBoard(x: number, y: number): boolean {
  const dx = x - CX;
  const dy = y - CY;
  const along = dx * rx + dy * ry;
  const out = dx * nx + dy * ny;
  return Math.abs(along) <= FACE_W / 2 + 0.25 && out <= 1.2 && out >= -4.5;
}

/** Solid: the frame and its legs (their feet reach back), never the space before it where he stands. */
export const BOARD_COLLIDERS: readonly Collider[] = [
  { kind: "box", x: CX - nx * 0.18, y: CY - ny * 0.18, hx: FACE_W / 2 + 0.2, hy: 0.3, yaw: BOARD_FACING + Math.PI / 2, top: FACE_BOTTOM + FACE_H + 0.2 },
];

/** The face's texture, by tier: phones a fair size, desktops sharp. */
const TEXTURE_W: Record<string, number> = { low: 512, medium: 1024, high: 1600 };

const WOOD = 0xb57c4e;
const WOOD_DARK = 0x8b5a39;
const SLATE_EDGE = 0x26302c;

interface Chore {
  region: { x: number; y: number; w: number; h: number };
  stand: { x: number; y: number; facing: number };
  queued: number;
  started: number | null;
}

export class Chalkboard implements Place {
  readonly group = new Group();
  readonly warmGlows: readonly Glow[] = [];
  readonly coolGlows: readonly Glow[] = [];
  readonly colliders: readonly Collider[];
  /** The scene calls this when where he should stand changes (a write to go and do, or done). */
  onStand: (() => void) | null = null;
  private readonly canvas = document.createElement("canvas");
  private readonly scratch = document.createElement("canvas");
  private readonly texture: CanvasTexture;
  private readonly faceMaterial: MeshLambertNodeMaterial;
  private readonly solidMaterial = new MeshLambertNodeMaterial({ vertexColors: true });
  private board: BoardView = emptyBoard();
  private chores: Chore[] = [];
  private now = 0;
  /** The ground's height under it (the face's heights are above it). */
  private readonly gz: number;

  constructor(ctx: PlaceContext) {
    const gz = ctx.ground(CX, CY);
    this.gz = gz;
    const [sx, , sz] = toScene(CX, CY, 0);
    const frame = at(sx, gz, sz, headingToSceneYaw(BOARD_FACING));
    const solid = new Mesher();
    const add = (g: BoxGeometry | CylinderGeometry, color: number, m: ReturnType<typeof at>, vary?: number) => solid.add(g, color, within(frame, m), vary);
    const top = FACE_BOTTOM + FACE_H;
    const mid = FACE_BOTTOM + FACE_H / 2;
    // The slate's back and its edge, then the frame: rails top and bottom, stiles at the sides.
    add(new BoxGeometry(FACE_W + 0.04, FACE_H + 0.04, 0.05), SLATE_EDGE, at(0, mid, -0.02), 0.02);
    add(new BoxGeometry(FACE_W + 0.2, 0.09, 0.1), WOOD, at(0, top + 0.045, 0), 0.05);
    add(new BoxGeometry(FACE_W + 0.2, 0.09, 0.1), WOOD, at(0, FACE_BOTTOM - 0.045, 0), 0.05);
    for (const side of [-1, 1]) add(new BoxGeometry(0.09, FACE_H + 0.18, 0.1), WOOD, at(side * (FACE_W / 2 + 0.055), mid, 0), 0.05);
    // Two legs from the ground past the top rail, each with a splayed foot and a brace behind.
    for (const side of [-1, 1]) {
      const x = side * (FACE_W / 2 + 0.14);
      add(new BoxGeometry(0.08, top + 0.16, 0.08), WOOD_DARK, at(x, (top + 0.16) / 2, -0.02), 0.05);
      add(new BoxGeometry(0.1, 0.07, 0.62), WOOD_DARK, at(x, 0.035, -0.12), 0.05);
      add(new BoxGeometry(0.05, 1.1, 0.05), WOOD_DARK, at(x, 0.5, -0.24, 0, 1, -0.42), 0.04);
      add(new CylinderGeometry(0.03, 0.03, 0.03, 6), 0xd9cdb5, at(x, top + 0.17, -0.02), 0);
    }
    // The chalk tray along the foot of the slate, its lip, the chalk and the duster in it.
    const tray = FACE_BOTTOM - 0.1;
    add(new BoxGeometry(FACE_W, 0.025, 0.12), WOOD, at(0, tray, 0.08), 0.04);
    add(new BoxGeometry(FACE_W, 0.035, 0.015), WOOD_DARK, at(0, tray + 0.025, 0.14), 0.04);
    const sticks: [number, number][] = [[-0.62, 0xf2efe6], [-0.55, 0xf2efe6], [-0.44, 0xf4d872], [-0.36, 0xf2a3bd], [-0.27, 0x9cccef], [0.18, 0xa7d99c]];
    for (const [x, color] of sticks) add(new CylinderGeometry(0.011, 0.011, 0.085, 6), color, at(x, tray + 0.024, 0.08, 0.15 * x, 1, 0, Math.PI / 2), 0.04);
    add(new BoxGeometry(0.17, 0.035, 0.07), WOOD_DARK, at(0.62, tray + 0.032, 0.08, 0.12), 0.04);
    add(new BoxGeometry(0.17, 0.018, 0.07), 0xd8d0c2, at(0.62, tray + 0.01, 0.08, 0.12), 0.02);
    // A smudge of chalk dust on the tray.
    add(new BoxGeometry(0.5, 0.004, 0.09), 0xe6e2d8, at(-0.1, tray + 0.014, 0.08), 0.1);
    const mesh = new Mesh(solid.build({ ao: groundAO(0.6, 1.2, 0.72, gz) }), this.solidMaterial);
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = ctx.shadows;

    // The face: the board's state as a texture.
    const width = TEXTURE_W[ctx.tier.name] ?? 1024;
    this.canvas.width = width;
    this.canvas.height = Math.round((width * BOARD_H) / BOARD_W);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.faceMaterial = new MeshLambertNodeMaterial({ map: this.texture });
    const face = new Mesh(new PlaneGeometry(FACE_W, FACE_H), this.faceMaterial);
    face.applyMatrix4(within(frame, at(0, mid, 0.006)));
    face.receiveShadow = ctx.shadows;
    this.group.add(mesh, face);
    this.paint();

    this.colliders = BOARD_COLLIDERS;
  }

  /** The board as the node has it now. */
  setBoard(board: BoardView | null): void {
    this.board = board ?? emptyBoard();
    this.paint();
  }

  /** The board changed: an agent's item, somewhere, is his to go and write (unless motion is off: then it just appears). */
  boardChanged(change: BoardChange, motion: boolean): void {
    if (change.change === "clear") this.chores = [];
    if (change.change !== "write" || change.by !== "agent" || !change.region || !motion) return;
    if (this.chores.length >= 3) return;
    const first = this.chores.length === 0;
    this.chores.push({ region: change.region, stand: standFor(change.region), queued: this.now, started: null });
    this.paint();
    if (first) this.onStand?.();
  }

  /** Where he should stand now: before the board, while he has something to write; otherwise null (his station decides). */
  stand(): { x: number; y: number; facing: number } | null {
    return this.chores[0]?.stand ?? null;
  }

  /** Writing now: where his hand is (the chalk on the face, along the lines of what he writes), into `out`. */
  hand(out: { x: number; y: number; z: number; on: boolean }): boolean {
    const chore = this.chores[0];
    if (!chore || chore.started === null) return false;
    const r = chore.region;
    const lines = Math.max(1, Math.min(6, Math.round(r.h / 70)));
    const p = Math.min(0.999, (this.now - chore.started) / WRITE_S) * lines;
    const line = Math.floor(p);
    const across = p - line;
    // Along the line he's on, within his reach of where he stands.
    const centre = r.x + r.w / 2;
    const reach = Math.min(r.w / 2, 300);
    facePoint(centre - reach + across * 2 * reach, r.y + ((line + 0.6) / lines) * r.h, out);
    // Within his reach (the face runs from his knees to over his head), on the ground's level.
    out.z = this.gz + Math.max(1.15, Math.min(2.02, out.z));
    out.on = true;
    return true;
  }

  /** Items he's yet to write: kept off the face until he starts on them. */
  private hidden(): Set<string> {
    const waiting = this.chores.filter((c) => c.started === null);
    const out = new Set<string>();
    if (!waiting.length) return out;
    for (const item of this.board.items) {
      if (waiting.some((c) => c.region.x === item.x && c.region.y === item.y && c.region.w === item.w && c.region.h === item.h)) out.add(item.id);
    }
    return out;
  }

  /** What the face shows now: painted again only when the board or what's held back changes. */
  private shown: { board: BoardView | null; hidden: string } = { board: null, hidden: "" };

  private paint(): void {
    const hide = this.hidden();
    const key = [...hide].join(",");
    if (this.shown.board === this.board && this.shown.hidden === key) return;
    this.shown = { board: this.board, hidden: key };
    paintBoard(this.canvas, this.scratch, this.board, { hide });
    this.texture.needsUpdate = true;
  }

  setNight(): void {}
  setOccupied(): void {}

  animate(frame: PlaceFrame): void {
    this.now = frame.t;
    const chore = this.chores[0];
    if (!chore) return;
    if (chore.queued === 0) chore.queued = frame.t;
    if (chore.started === null) {
      const there = Math.hypot(frame.galahadX - chore.stand.x, frame.galahadY - chore.stand.y) < 0.6;
      if (there) {
        chore.started = frame.t;
        this.paint();
      } else if (frame.t - chore.queued > ARRIVE_S) chore.started = frame.t - WRITE_S;
    }
    if (chore.started !== null && frame.t - chore.started >= WRITE_S) {
      this.chores.shift();
      if (this.chores[0]) this.chores[0].queued = frame.t;
      this.paint();
      this.onStand?.();
    }
  }

  hover(x: number, y: number, out: Vec3): string | null {
    if (!overBoard(x, y)) return null;
    out[0] = CX;
    out[1] = CY;
    out[2] = FACE_BOTTOM + FACE_H + 0.35;
    return "Chalkboard · tap to open";
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
