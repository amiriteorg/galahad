import { PADS, SITES } from "@galahad/core/world";
import type { Collider, Rect } from "./colliders.ts";
import type { TierName } from "./tiers.ts";

/*
 * The workshop hall's plan: where its walls, door and aisle are, and where every
 * machine in it stands, as the land, the walkers, the camera and the hall's own
 * builders need to know them. The contract (core's SITES and PADS) fixes the
 * hall's rectangle and its test cells; everything else about the plan lives
 * here. World metres (x east, y north, heights above the floor). Pure data, so
 * the path planner and the tests can read it without the renderer.
 *
 * The hall, from the door (west) to the back (east):
 *   front, north of the aisle   the printer farm (a bench of printers over a collector belt, a
 *                               large-format gantry printer, the dispatch hatch its parts leave by)
 *   front, south of the aisle   the assembly line (a conveyor past two six-axis arms), a CNC mill
 *   between them                the cart's lane, crossing the aisle once
 *   back                        the four test cells, two either side of the aisle
 *   along the back walls        racks, a tool wall, charging docks, a wind tunnel, the electronics bench
 *   overhead                    a bridge crane on rails along the north and south walls
 */

const S = SITES.hall;

/** The hall's floor: wall to wall. */
export const HALL: Rect = { x: S.x, y: S.y, hx: S.w / 2, hy: S.d / 2 };

/** Walls this thick, standing on the floor's edge. */
export const HALL_WALL = 0.6;
/** The eaves' height (the roof rises above it). */
export const HALL_EAVES = 9;
/** The roof is a sawtooth: this many teeth from west to east, each rising this far above the eaves at its glazed west face. */
export const HALL_TEETH = 8;
export const HALL_TOOTH = (HALL.hx * 2) / HALL_TEETH;
export const HALL_RISE = 2.6;
/** The roof's height over a point of the floor (its outer surface). */
export const roofAt = (x: number): number => {
  const u = (x - (HALL.x - HALL.hx)) / HALL_TOOTH;
  const f = u - Math.floor(u);
  return HALL_EAVES + HALL_RISE * (1 - f);
};

/** The door: in the west wall, facing the keep, this wide and this high, always open. */
export const HALL_DOOR = { x: HALL.x - HALL.hx, y: HALL.y, half: 6, height: 6.4 };
/** Just outside and just inside the door, on its centre line. */
export const HALL_DOOR_OUT = { x: HALL_DOOR.x - 4, y: HALL_DOOR.y };
export const HALL_DOOR_IN = { x: HALL_DOOR.x + 4, y: HALL_DOOR.y };

/** The aisle runs east from the door along the hall's centre line; this is its half-width. */
export const HALL_AISLE = 5;

/** Inside the hall (on its floor). */
export const inHall = (x: number, y: number): boolean => Math.abs(x - HALL.x) < HALL.hx && Math.abs(y - HALL.y) < HALL.hy;

/** The point of the aisle abreast of (x, y). */
export const aisleAt = (x: number): { x: number; y: number } => ({ x: Math.max(HALL_DOOR_IN.x, Math.min(HALL.x + HALL.hx - 3, x)), y: HALL.y });

/** What the path planner walks round: the whole hall, as one circle (he goes in by the door, never through a wall). */
export const HALL_OBSTACLES: { x: number; y: number; r: number }[] = [{ x: HALL.x, y: HALL.y, r: Math.hypot(HALL.hx, HALL.hy) }];

/** Ground that's floor or paving rather than grass: the hall's floor and the forecourt before its door. */
export const HALL_PAVED: Rect[] = [
  { x: HALL.x, y: HALL.y, hx: HALL.hx + 1, hy: HALL.hy + 1 },
  { x: HALL_DOOR.x - 4, y: HALL.y, hx: 4, hy: HALL_DOOR.half + 3 },
];

// ---------- the frame ----------

const WEST = HALL.x - HALL.hx;
const EAST = HALL.x + HALL.hx;
const NORTH = HALL.y + HALL.hy;
const SOUTH = HALL.y - HALL.hy;
/** The walls' inner faces. */
export const HALL_INNER: Rect = { x: HALL.x, y: HALL.y, hx: HALL.hx - HALL_WALL / 2, hy: HALL.hy - HALL_WALL / 2 };

/** The steel columns stand inside the north and south walls, one under each valley of the roof. */
export const COLUMN = 0.5;
export const COLUMNS: { x: number; y: number }[] = (() => {
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k <= HALL_TEETH; k++) {
    const x = Math.max(WEST + HALL_WALL / 2 + COLUMN / 2, Math.min(EAST - HALL_WALL / 2 - COLUMN / 2, WEST + k * HALL_TOOTH));
    for (const side of [1, -1]) out.push({ x, y: HALL.y + side * (HALL_INNER.hy - COLUMN / 2) });
  }
  return out;
})();

/** The bridge crane: rails along the north and south walls at this height; the bridge spans between them and travels east-west. */
export const CRANE = {
  /** The rails' top. */
  rail: 7.1,
  /** The rails' centre lines (y). */
  north: NORTH - 1.05,
  south: SOUTH + 1.05,
  /** How far the bridge travels (x of its centre line). */
  west: WEST + 3,
  east: EAST - 3,
  /** The trolley's travel along the bridge (y). */
  reach: HALL.hy - 3.2,
  /** Where it waits. */
  park: { x: 103.4, y: 12 },
  /** The hook's height (its underside) when raised. */
  up: 5.9,
};

// ---------- the test cells ----------

/** The fence stands this far outside a cell's edge; its gate (on the aisle side) is this wide. */
export const CELL_FENCE = 0.15;
export const CELL_GATE = 3;
export const FENCE_HEIGHT = 1.45;

export interface Cell {
  id: string;
  x: number;
  y: number;
  size: number;
  /** +1 north of the aisle, −1 south. */
  side: 1 | -1;
  /** What tests itself here while no experiment has the cell. */
  resident: "arm" | "leg" | "drone" | "shake";
  /** Its name on a hover. */
  name: string;
  /** The status beacon's pole, beside the gate. */
  beacon: { x: number; y: number };
}

const RESIDENTS: Record<string, { resident: Cell["resident"]; name: string }> = {
  "cell-1": { resident: "arm", name: "Arm endurance test" },
  "cell-2": { resident: "leg", name: "Leg on a treadmill" },
  "cell-3": { resident: "drone", name: "Tethered drone" },
  "cell-4": { resident: "shake", name: "Shake table" },
};

export const CELLS: Cell[] = PADS.filter((p) => p.site === "hall").map((p) => {
  const side = p.y >= HALL.y ? 1 : -1;
  const r = RESIDENTS[p.id] ?? { resident: "arm" as const, name: "Test rig" };
  return { id: p.id, x: p.x, y: p.y, size: p.size, side, ...r, beacon: { x: p.x + CELL_GATE / 2 + 0.45, y: p.y - side * (p.size / 2 + CELL_FENCE) } };
});

// ---------- the printer farm ----------

/** The desktop printers: side by side on a bench, their beds opening south onto the collector belt. */
export const FARM = {
  /** The bench under them (its top is `top` high). */
  bench: { x: 89.2, y: 7.45, hx: 8, hy: 1.05 } as Rect,
  top: 0.8,
  /** Printer centres: x of the first, their pitch, their y; how many by tier. */
  first: 82.4,
  pitch: 2.15,
  y: 7.65,
  count: { low: 3, medium: 5, high: 7 } as Record<TierName, number>,
  /** The bed: a square this wide, its top this high. */
  bed: 1,
  bedTop: 1.02,
  /** The collector belt in front of the beds, level with them: its centre line (y), half-width and ends (x). */
  belt: { y: 6.84, half: 0.29, west: 81.4, east: 97.5 },
  /** The stand at the belt's end where the tote waits to be filled, and its deck's height (the cart's too). */
  stand: { x: 98.3, y: 6.84, hx: 0.6, hy: 0.55 } as Rect,
  deck: 0.5,
};

export const printerX = (i: number): number => FARM.first + FARM.pitch * i;

/** The large-format gantry printer, and where its finished parts go: craned to a roller table and rolled out by the dispatch hatch. */
export const GANTRY = {
  /** Its frame's footprint and height. */
  frame: { x: 90.1, y: 15.2, hx: 3.5, hy: 2.6 } as Rect,
  height: 3.5,
  /** The bed (centred in the frame) and its top. */
  bed: { x: 90.1, y: 15.2, hx: 2.5, hy: 1.8 } as Rect,
  bedTop: 0.45,
  /** The roller table the crane sets a part down on, and the hatch behind it. */
  table: { x: 97.6, y: 15.8, hx: 1.4, hy: 1.2 } as Rect,
  tableTop: 0.6,
  hatch: { x: 97.6, y: 18.35, hx: 1.7, hy: 1.35 } as Rect,
  hatchHeight: 2.7,
};

// ---------- the assembly line ----------

export const LINE = {
  /** The conveyor: its centre line (y), half-width, ends (x) and the belt's height. */
  y: -12.6,
  half: 0.5,
  west: 81.2,
  east: 101.6,
  top: 0.9,
  /** A carrier stops every `pitch` metres: hidden in the infeed tunnel, staged, at the two arms, at inspection, hidden in the outfeed. */
  first: 82.6,
  pitch: 3.6,
  stops: 6,
  /** The tunnels the carriers come out of and go into (x ranges) and their height. */
  infeed: [81, 84.2] as const,
  outfeed: [98.6, 101.8] as const,
  tunnel: 2,
  /** The two arms' bases (the picker, then the fastener), each abreast of its stop, on a pedestal this high. */
  arms: [
    { x: 89.8, y: -10.7 },
    { x: 93.4, y: -10.7 },
  ],
  pedestal: 0.5,
  /** The stand beside the picker where the cart leaves the tote of printed parts. */
  stand: { x: 87.9, y: -10, hx: 0.6, hy: 0.55 } as Rect,
};

/** The CNC mill's enclosure, against the south wall. */
export const MILL: Rect = { x: 82.4, y: -18.3, hx: 2, hy: 1.3 };

// ---------- the cart ----------

/** The cart's size (it drives lengthways), and how near anything may come before it stops. */
export const CART = { length: 1.3, width: 0.95, radius: 0.85 };

/**
 * The cart's lane: from its charger by the printer farm, past the farm's stand, south across the
 * aisle, then west to the assembly line's stand. It drives the lane both ways (it has no front).
 */
export const CART_LANE: { x: number; y: number }[] = [
  { x: 99.95, y: 9.3 },
  { x: 99.95, y: -8.2 },
  { x: 87.9, y: -8.2 },
];
/** The lane's corner is rounded to this radius. */
export const CART_TURN = 1.3;

// ---------- along the back walls ----------

/** The wind tunnel, in the north-east corner (it blows north to south). */
export const TUNNEL: Rect = { x: 131.45, y: 12.6, hx: 1.45, hy: 6 };
/** The electronics bench, along the east wall south of the aisle. */
export const BENCH: Rect = { x: 132.95, y: -12.5, hx: 0.7, hy: 6 };
/** Pallet racks behind the north cells; the tool wall's benches and the charging docks behind the south ones. */
export const RACKS: Rect = { x: 118, y: 18.85, hx: 10.6, hy: 0.75 };
export const TOOLS: Rect = { x: 112.2, y: -18.95, hx: 4.9, hy: 0.65 };
export const DOCKS: Rect = { x: 124, y: -18.9, hx: 4.6, hy: 0.7 };
/** Spools and stock on shelves inside the west wall, north of the door. */
export const SHELVES: Rect = { x: WEST + 0.95, y: 12.2, hx: 0.6, hy: 3.6 };

// ---------- what's solid ----------

/** A thing that stands on the floor: what it is (for a hover), and its footprint. */
export interface Solid {
  name: string;
  collider: Collider;
}

const box = (name: string, r: Rect, top: number): Solid => ({ name, collider: { kind: "box", x: r.x, y: r.y, hx: r.hx, hy: r.hy, top } });

/** The walls (the west one in two pieces, either side of the door). */
export const HALL_WALLS: Collider[] = (() => {
  const t = HALL_WALL / 2;
  const side = (HALL.hy - HALL_DOOR.half) / 2;
  return [
    { kind: "box", x: HALL.x, y: NORTH, hx: HALL.hx + t, hy: t, top: HALL_EAVES },
    { kind: "box", x: HALL.x, y: SOUTH, hx: HALL.hx + t, hy: t, top: HALL_EAVES },
    { kind: "box", x: EAST, y: HALL.y, hx: t, hy: HALL.hy + t, top: HALL_EAVES },
    { kind: "box", x: HALL_DOOR.x, y: HALL.y + HALL_DOOR.half + side, hx: t, hy: side, top: HALL_EAVES },
    { kind: "box", x: HALL_DOOR.x, y: HALL.y - HALL_DOOR.half - side, hx: t, hy: side, top: HALL_EAVES },
  ];
})();

/** Every machine, bench and fence on the floor, named. The cart is the only thing that moves across it (the hall's `movers`). */
export const HALL_SOLIDS: Solid[] = (() => {
  const out: Solid[] = [];
  for (const c of COLUMNS) out.push({ name: "", collider: { kind: "box", x: c.x, y: c.y, hx: COLUMN / 2, hy: COLUMN / 2, top: HALL_EAVES } });
  out.push(box("3D printer farm", FARM.bench, 2.5));
  out.push(box("Parts tote", FARM.stand, 1));
  out.push(box("Large-format printer", GANTRY.frame, GANTRY.height + 0.3));
  out.push(box("Dispatch table", GANTRY.table, GANTRY.tableTop + 0.1));
  out.push(box("Dispatch hatch", GANTRY.hatch, GANTRY.hatchHeight));
  out.push(box("Assembly line", { x: (LINE.west + LINE.east) / 2, y: LINE.y, hx: (LINE.east - LINE.west) / 2, hy: LINE.half + 0.15 }, 1.2));
  out.push(box("Assembly line", { x: (LINE.infeed[0] + LINE.infeed[1]) / 2, y: LINE.y, hx: (LINE.infeed[1] - LINE.infeed[0]) / 2, hy: 0.95 }, LINE.tunnel));
  out.push(box("Assembly line", { x: (LINE.outfeed[0] + LINE.outfeed[1]) / 2, y: LINE.y, hx: (LINE.outfeed[1] - LINE.outfeed[0]) / 2, hy: 0.95 }, LINE.tunnel));
  for (const a of LINE.arms) out.push({ name: "Assembly arm (six-axis)", collider: { kind: "circle", x: a.x, y: a.y, r: 0.55, top: 3 } });
  out.push(box("Parts tote", LINE.stand, 1));
  out.push(box("CNC mill", MILL, 2.6));
  out.push(box("Wind tunnel", TUNNEL, 3));
  out.push(box("Electronics bench", BENCH, 1.7));
  out.push(box("Material racks", RACKS, 5));
  out.push(box("Tool wall", TOOLS, 2.4));
  out.push(box("Charging docks", DOCKS, 1.3));
  out.push(box("Filament shelves", SHELVES, 3));
  // Each cell's fence: closed all round (its gate is a light curtain, not a way in).
  for (const c of CELLS) {
    const h = c.size / 2 + CELL_FENCE;
    const t = 0.06;
    out.push(box("", { x: c.x, y: c.y + h, hx: h + t, hy: t }, FENCE_HEIGHT));
    out.push(box("", { x: c.x, y: c.y - h, hx: h + t, hy: t }, FENCE_HEIGHT));
    out.push(box("", { x: c.x + h, y: c.y, hx: t, hy: h + t }, FENCE_HEIGHT));
    out.push(box("", { x: c.x - h, y: c.y, hx: t, hy: h + t }, FENCE_HEIGHT));
    out.push({ name: "", collider: { kind: "circle", x: c.beacon.x, y: c.beacon.y, r: 0.12, top: 3.2 } });
  }
  return out;
})();

/** The walls, and everything that stands inside them. */
export const HALL_COLLIDERS: Collider[] = [...HALL_WALLS, ...HALL_SOLIDS.map((s) => s.collider)];

/** True inside a collider's footprint, or within `grow` metres of it. */
export function inCollider(c: Collider, x: number, y: number, grow = 0): boolean {
  if (c.kind === "circle") return Math.hypot(x - c.x, y - c.y) < c.r + grow;
  const cos = Math.cos(-(c.yaw ?? 0));
  const sin = Math.sin(-(c.yaw ?? 0));
  const lx = (x - c.x) * cos - (y - c.y) * sin;
  const ly = (x - c.x) * sin + (y - c.y) * cos;
  return Math.abs(lx) < c.hx + grow && Math.abs(ly) < c.hy + grow;
}

/** How much of everything a tier draws in the hall: 0 the plainest shapes, 2 the finest. */
export const HALL_DETAIL: Record<TierName, 0 | 1 | 2> = { low: 0, medium: 1, high: 2 };
