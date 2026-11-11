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
 *   front, north of the aisle   the printer farm (desktop printers on a bench over a collector
 *                               belt), a large-format gantry printer, the dispatch table and room
 *   front, south of the aisle   the assembly line (an indexing conveyor past two six-axis arms and
 *                               an inspection arch), a CNC mill
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
  const u = Math.max(0, Math.min(HALL_TEETH - 1e-9, (x - (HALL.x - HALL.hx)) / HALL_TOOTH));
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

// ---------- the frame and the openings ----------

export const WEST = HALL.x - HALL.hx;
export const EAST = HALL.x + HALL.hx;
export const NORTH = HALL.y + HALL.hy;
export const SOUTH = HALL.y - HALL.hy;
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

/** A window (or the door) in a wall: from `a` to `b` along the wall, from `z0` to `z1` above the floor. */
export interface Opening {
  a: number;
  b: number;
  z0: number;
  z1: number;
}

/** Every window's sill and head. */
export const SILL = 2.6;
export const HEAD = 6.4;
/** The long walls have a window in every bay, this far in from the columns either side. */
export const BAY_INSET = 1.3;
export const OPENINGS: { west: Opening[]; east: Opening[]; north: Opening[]; south: Opening[] } = {
  west: [
    { a: HALL_DOOR.y - HALL_DOOR.half, b: HALL_DOOR.y + HALL_DOOR.half, z0: 0, z1: HALL_DOOR.height },
    { a: 9.5, b: 16.5, z0: SILL, z1: HEAD },
    { a: -16.5, b: -9.5, z0: SILL, z1: HEAD },
  ],
  east: [
    { a: -16, b: -9, z0: SILL, z1: HEAD },
    { a: -3.5, b: 3.5, z0: SILL, z1: HEAD },
    { a: 9, b: 16, z0: SILL, z1: HEAD },
  ],
  north: Array.from({ length: HALL_TEETH }, (_, i) => ({ a: WEST + i * HALL_TOOTH + BAY_INSET, b: WEST + (i + 1) * HALL_TOOTH - BAY_INSET, z0: SILL, z1: HEAD })),
  south: Array.from({ length: HALL_TEETH }, (_, i) => ({ a: WEST + i * HALL_TOOTH + BAY_INSET, b: WEST + (i + 1) * HALL_TOOTH - BAY_INSET, z0: SILL, z1: HEAD })),
};

/** The high-bay lamps: one row under the middle of each tooth of the roof, at these y, hanging to this height. */
export const LAMP_ROWS = [-12, 0, 12];
export const LAMP_HEIGHT = 8.4;
export const lampX = (k: number): number => WEST + (k + 0.5) * HALL_TOOTH;

/** The bridge crane: rails along the north and south walls at this height; the bridge spans between them and travels east-west. */
export const CRANE = {
  /** The rails' top. */
  rail: 7.1,
  /** The rails' centre lines (y). */
  north: NORTH - 1.15,
  south: SOUTH + 1.15,
  /** How far the bridge travels (x of its centre line). */
  west: WEST + 2.2,
  east: EAST - 2.2,
  /** The trolley's travel along the bridge (y). */
  reach: HALL.hy - 2.4,
  /** Where it waits. */
  park: { x: 95, y: 9 },
  /** The hook's height (the underside of its gripper) when raised. */
  up: 5.6,
};

// ---------- the test cells ----------

/** The fence stands this far outside a cell's edge; its gate (on the aisle side) is this wide. */
export const CELL_FENCE = 0.15;
export const CELL_GATE = 3;
export const FENCE_HEIGHT = 1.45;

export type Resident = "arm" | "leg" | "drone" | "shake";

export interface Cell {
  id: string;
  x: number;
  y: number;
  size: number;
  /** +1 north of the aisle, −1 south. */
  side: 1 | -1;
  /** What tests itself here while no experiment has the cell. */
  resident: Resident;
  /** Its name on a hover. */
  name: string;
  /** The status beacon's pole, beside the gate. */
  beacon: { x: number; y: number };
}

const RESIDENTS: Record<string, { resident: Resident; name: string }> = {
  "cell-1": { resident: "arm", name: "Arm endurance test" },
  "cell-2": { resident: "leg", name: "Robot leg on a treadmill" },
  "cell-3": { resident: "drone", name: "Tethered drone" },
  "cell-4": { resident: "shake", name: "Shake table" },
};

export const CELLS: Cell[] = PADS.filter((p) => p.site === "hall").map((p) => {
  const side = p.y >= HALL.y ? 1 : -1;
  const r = RESIDENTS[p.id] ?? { resident: "arm" as const, name: "Test rig" };
  return { id: p.id, x: p.x, y: p.y, size: p.size, side, ...r, beacon: { x: p.x + CELL_GATE / 2 + 0.45, y: p.y - side * (p.size / 2 + CELL_FENCE) } };
});

// ---------- the printer farm ----------

/**
 * The desktop printers (CoreXY, open fronted), side by side on a bench and facing the aisle. Each
 * prints a part, lowers its bed, and a sweeper bar pushes the part off down a chute onto the
 * collector belt in front, which carries it east to the cart's dock.
 */
export const FARM = {
  /** The bench under them, and its top. */
  bench: { x: 85.5, y: 8.35, hx: 4.9, hy: 0.55 } as Rect,
  top: 0.9,
  /** Printer centres: x of the first, their pitch, their y; how many by tier. */
  first: 81.6,
  pitch: 1.3,
  y: 8.35,
  count: { low: 3, medium: 5, high: 7 } as Record<TierName, number>,
  /** The collector belt in front of them: its centre line (y), half-width, ends (x) and top. */
  belt: { y: 7.3, half: 0.2, west: 80.8, east: 97.35, top: 0.78 },
};

export const printerX = (i: number): number => FARM.first + FARM.pitch * i;

/** The large-format gantry printer: its frame (footprint and height) and bed (centred in it, its top). */
export const GANTRY = {
  frame: { x: 87.5, y: 13.6, hx: 1.65, hy: 1.65 } as Rect,
  height: 3,
  bed: { x: 87.5, y: 13.6, hx: 1.25, hy: 1.25 } as Rect,
  bedTop: 0.55,
};

/**
 * Big parts are craned to the dispatch table, whose rollers carry them through a roller door into the
 * dispatch room against the north wall (where they're packed and sent off).
 */
export const DISPATCH = {
  table: { x: 102.5, y: 16.95, hx: 0.95, hy: 1.25 } as Rect,
  top: 0.7,
  /** Where the crane sets a part down. */
  drop: { x: 102.5, y: 16.55 },
  /** The room (its footprint and height) and its door (in its south face). */
  room: { x: 102.5, y: 18.8, hx: 1.9, hy: 0.6 } as Rect,
  height: 2.7,
  door: { half: 1.1, height: 2.05 },
};

// ---------- the assembly line ----------

/**
 * An indexing conveyor: carriers stand at stops `pitch` apart and move on one stop at a time. They
 * come out of the infeed tunnel, take a printed part at the picker's stop, a screw at the fastener's,
 * pass the inspection arch, and go into the outfeed tunnel (and round, under the line, to the infeed).
 */
export const LINE = {
  /** The conveyor: its centre line (y), half-width, ends (x) and the belt's top. */
  y: -12.6,
  half: 0.4,
  west: 82.4,
  east: 101.8,
  top: 0.85,
  /** The stops: the first's x, their pitch, how many (the first and the last two are inside the tunnels). */
  first: 84,
  pitch: 1.5,
  stops: 12,
  pick: 4,
  fasten: 6,
  inspect: 8,
  /** The tunnels (x ranges) and their height. */
  infeed: [82.4, 85] as const,
  outfeed: [98.6, 101.8] as const,
  tunnel: 1.9,
  /** The two arms' bases (the picker, then the fastener), each abreast of its stop, on a pedestal this high. */
  arms: [
    { x: 90, y: -11 },
    { x: 93, y: -11 },
  ],
  pedestal: 0.6,
  /** The screws' bowl feeder beside the fastener. */
  feeder: { x: 94.5, y: -11.65, r: 0.32, top: 0.95 },
};

export const stopX = (k: number): number => LINE.first + LINE.pitch * k;

/** The CNC mill's enclosure, against the south wall by the door. */
export const MILL: Rect = { x: 82.8, y: -18.05, hx: 2, hy: 1.25 };

// ---------- the cart ----------

/** The cart's size (it drives lengthways), its deck's height, the tote on it, and how near anything may come before it stops. */
export const CART = { length: 1.3, width: 0.95, radius: 0.85, deck: 0.38, tote: { length: 0.78, width: 0.62, height: 0.24 } };

/**
 * The cart's lane: from its dock (and charger) at the end of the printers' belt, south across the
 * aisle, then west to the assembly line's picker. It drives the lane both ways (it has no front).
 */
export const CART_LANE: { x: number; y: number }[] = [
  { x: 97.95, y: 7.3 },
  { x: 97.95, y: -9.7 },
  { x: 90, y: -9.7 },
];
/** The lane's corner is rounded to this radius. */
export const CART_TURN = 1.3;

// ---------- along the walls ----------

/** The wind tunnel, in the north-east corner (it blows north to south). */
export const TUNNEL: Rect = { x: 131.65, y: 12.8, hx: 1.75, hy: 5.8 };
/** The electronics bench, along the east wall south of the aisle. */
export const BENCH: Rect = { x: 132.9, y: -12.5, hx: 0.75, hy: 5.5 };
/** Pallet racks behind the north cells; the tool wall's benches and the charging docks behind the south ones. */
export const RACKS: Rect = { x: 118, y: 18.55, hx: 10.6, hy: 0.6 };
export const TOOLS: Rect = { x: 112.1, y: -18.55, hx: 4.7, hy: 0.6 };
export const DOCKS: Rect = { x: 124, y: -18.5, hx: 4.6, hy: 0.65 };
/** Spools and stock on shelves inside the west wall, north of the door. */
export const SHELVES: Rect = { x: WEST + HALL_WALL / 2 + 0.6, y: 12, hx: 0.55, hy: 3.8 };

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
  out.push(box("3D printer", FARM.bench, 2));
  out.push(box("Collector belt", { x: (FARM.belt.west + FARM.belt.east) / 2, y: FARM.belt.y, hx: (FARM.belt.east - FARM.belt.west) / 2, hy: FARM.belt.half + 0.06 }, FARM.belt.top + 0.05));
  out.push(box("Large-format printer", GANTRY.frame, GANTRY.height + 0.2));
  out.push(box("Dispatch table", DISPATCH.table, DISPATCH.top + 0.1));
  out.push(box("Dispatch", DISPATCH.room, DISPATCH.height));
  out.push(box("Assembly line", { x: (LINE.west + LINE.east) / 2, y: LINE.y, hx: (LINE.east - LINE.west) / 2, hy: LINE.half + 0.1 }, LINE.top + 0.25));
  out.push(box("Assembly line", { x: (LINE.infeed[0] + LINE.infeed[1]) / 2, y: LINE.y, hx: (LINE.infeed[1] - LINE.infeed[0]) / 2, hy: 0.85 }, LINE.tunnel));
  out.push(box("Assembly line", { x: (LINE.outfeed[0] + LINE.outfeed[1]) / 2, y: LINE.y, hx: (LINE.outfeed[1] - LINE.outfeed[0]) / 2, hy: 0.85 }, LINE.tunnel));
  for (const a of LINE.arms) out.push({ name: "Assembly arm (six-axis)", collider: { kind: "circle", x: a.x, y: a.y, r: 0.45, top: 3 } });
  out.push({ name: "Screw feeder", collider: { kind: "circle", x: LINE.feeder.x, y: LINE.feeder.y, r: LINE.feeder.r, top: LINE.feeder.top + 0.1 } });
  out.push(box("CNC mill", MILL, 2.5));
  out.push(box("Wind tunnel", TUNNEL, 3));
  out.push(box("Electronics bench", BENCH, 2));
  out.push(box("Material racks", RACKS, 4.2));
  out.push(box("Tool wall", TOOLS, 2.4));
  out.push(box("Charging docks", DOCKS, 1.2));
  out.push(box("Filament shelves", SHELVES, 2.3));
  // Each cell's fence: closed all round (its gate is a light curtain, not a way in).
  for (const c of CELLS) {
    const h = c.size / 2 + CELL_FENCE;
    const t = 0.06;
    out.push(box("", { x: c.x, y: c.y + h, hx: h + t, hy: t }, FENCE_HEIGHT));
    out.push(box("", { x: c.x, y: c.y - h, hx: h + t, hy: t }, FENCE_HEIGHT));
    out.push(box("", { x: c.x + h, y: c.y, hx: t, hy: h + t }, FENCE_HEIGHT));
    out.push(box("", { x: c.x - h, y: c.y, hx: t, hy: h + t }, FENCE_HEIGHT));
    out.push({ name: "", collider: { kind: "circle", x: c.beacon.x, y: c.beacon.y, r: 0.12, top: 2.6 } });
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

/**
 * What must stay clear for walking: the door and the ground either side of it, the aisle from the door
 * to the back, and the ground before each cell's gate (where he stands to watch). Nothing solid may
 * stand in them.
 */
export const HALL_CLEARWAYS: Rect[] = [
  { x: HALL_DOOR.x, y: HALL_DOOR.y, hx: 4.6, hy: HALL_DOOR.half - 0.5 },
  { x: (HALL_DOOR.x + EAST - HALL_WALL / 2) / 2, y: HALL.y, hx: (EAST - HALL_WALL / 2 - HALL_DOOR.x) / 2, hy: HALL_AISLE },
  ...CELLS.map((c) => ({ x: c.x, y: c.y - c.side * (c.size / 2 + 0.9), hx: CELL_GATE / 2, hy: 0.65 })),
];

/** How much of everything a tier draws in the hall: 0 the plainest shapes, 2 the finest. */
export const HALL_DETAIL: Record<TierName, 0 | 1 | 2> = { low: 0, medium: 1, high: 2 };
