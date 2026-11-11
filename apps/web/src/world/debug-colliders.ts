import { BufferAttribute, BufferGeometry, DynamicDrawUsage, LineBasicMaterial, LineSegments, type Object3D } from "three/webgpu";
import { BOX, CIRCLE, SIGHT, type Solids, VIEW, WALK } from "./collide.ts";

/*
 * The debug view of what's solid (the page's `?colliders=1`): every solid near
 * the camera's focus drawn as lines, its footprint at its foot and at its top
 * with a few uprights between, coloured by what it stops (orange: walkers and
 * the camera, the view too; yellow: walkers and the camera, seen through;
 * blue: only the camera; green: only walkers), and every walker's circle in
 * white, the camera's spot as a small red cross. It's how the footprints are
 * checked against what's drawn. Built only when asked for: off, it costs
 * nothing. The solids' lines are rebuilt when they change or the focus moves
 * on; the walkers' are rewritten every frame (one buffer, no allocation).
 */

/** True when the page asks for the debug view: `?colliders=1` (or `on`, `true`) in its query. */
export const wantsColliders = (search: string): boolean => /[?&]colliders=(1|on|true)(&|$)/.test(search);

/** Look this far round the focus. */
const REACH = 70;
/** Segments round a circle. */
const ROUND = 20;
const MAX_LINES = 60_000;
const MAX_MOVERS = 96;

const colour = (mask: number): [number, number, number] =>
  (mask & WALK) === 0 ? [0.1, 0.45, 1] : (mask & VIEW) === 0 ? [0.1, 0.85, 0.2] : (mask & SIGHT) !== 0 ? [1, 0.3, 0] : [0.95, 0.85, 0];

export class ColliderLines {
  private readonly solidPositions = new Float32Array(MAX_LINES * 6);
  private readonly solidColours = new Float32Array(MAX_LINES * 6);
  private readonly solidGeometry = new BufferGeometry();
  private readonly moverPositions = new Float32Array((MAX_MOVERS * ROUND + 2) * 6);
  private readonly moverGeometry = new BufferGeometry();
  private readonly material = new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false, fog: false });
  private readonly moverMaterial = new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false, fog: false });
  private readonly solidLines: LineSegments;
  private readonly moverLines: LineSegments;
  private builtVersion = -1;
  private builtX = Number.NaN;
  private builtY = 0;
  private builtOrigin: [number, number] = [0, 0];

  constructor(
    private readonly root: Object3D,
    private readonly solids: Solids,
    private readonly height: (x: number, y: number) => number,
  ) {
    this.solidGeometry.setAttribute("position", new BufferAttribute(this.solidPositions, 3).setUsage(DynamicDrawUsage));
    this.solidGeometry.setAttribute("color", new BufferAttribute(this.solidColours, 3).setUsage(DynamicDrawUsage));
    this.moverGeometry.setAttribute("position", new BufferAttribute(this.moverPositions, 3).setUsage(DynamicDrawUsage));
    this.solidLines = new LineSegments(this.solidGeometry, this.material);
    this.moverLines = new LineSegments(this.moverGeometry, this.moverMaterial);
    for (const lines of [this.solidLines, this.moverLines]) {
      lines.frustumCulled = false;
      lines.renderOrder = 10;
      root.add(lines);
    }
  }

  /** Brings the lines up to date: focus (world), the floating origin, and the camera's spot (world, z up). */
  update(focusX: number, focusY: number, origin: [number, number], camX: number, camY: number, camZ: number): void {
    const s = this.solids;
    if (s.version !== this.builtVersion || origin[0] !== this.builtOrigin[0] || origin[1] !== this.builtOrigin[1] || !(Math.hypot(focusX - this.builtX, focusY - this.builtY) < 15)) {
      this.build(focusX, focusY, origin);
    }
    // The walkers' circles, at their feet, and the camera's spot.
    const p = this.moverPositions;
    let n = 0;
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      p[n++] = ax - origin[0];
      p[n++] = az;
      p[n++] = -(ay - origin[1]);
      p[n++] = bx - origin[0];
      p[n++] = bz;
      p[n++] = -(by - origin[1]);
    };
    const movers = s.movers;
    for (let m = 0; m < movers.length && m < MAX_MOVERS; m++) {
      const at = movers[m]!.at;
      if (!(at.r > 0)) continue;
      const z = this.height(at.x, at.y) + 0.08;
      for (let k = 0; k < ROUND; k++) {
        const a0 = (k / ROUND) * Math.PI * 2;
        const a1 = ((k + 1) / ROUND) * Math.PI * 2;
        line(at.x + Math.cos(a0) * at.r, at.y + Math.sin(a0) * at.r, z, at.x + Math.cos(a1) * at.r, at.y + Math.sin(a1) * at.r, z);
      }
    }
    line(camX - 0.3, camY, camZ, camX + 0.3, camY, camZ);
    line(camX, camY - 0.3, camZ, camX, camY + 0.3, camZ);
    this.moverGeometry.setDrawRange(0, n / 3);
    (this.moverGeometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
  }

  private build(fx: number, fy: number, origin: [number, number]): void {
    const s = this.solids;
    this.builtVersion = s.version;
    this.builtX = fx;
    this.builtY = fy;
    this.builtOrigin = [origin[0], origin[1]];
    const p = this.solidPositions;
    const c = this.solidColours;
    let n = 0;
    let rgb: [number, number, number] = [1, 1, 1];
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      if (n + 6 > p.length) return;
      p[n] = ax - origin[0];
      p[n + 1] = az;
      p[n + 2] = -(ay - origin[1]);
      p[n + 3] = bx - origin[0];
      p[n + 4] = bz;
      p[n + 5] = -(by - origin[1]);
      for (let k = 0; k < 6; k++) c[n + k] = rgb[k % 3]!;
      n += 6;
    };
    const count = s.around(fx - REACH, fy - REACH, fx + REACH, fy + REACH);
    for (let k = 0; k < count; k++) {
      const i = s.found[k]!;
      rgb = colour(s.mask[i]!);
      const z0 = s.base[i]! + s.lo[i]!;
      // Very tall things (a wall to the sky) are drawn to a sensible height.
      const z1 = s.base[i]! + Math.min(s.hi[i]!, s.lo[i]! + 25);
      const x = s.px[i]!;
      const y = s.py[i]!;
      if (s.shape[i] === CIRCLE) {
        const r = s.hx[i]!;
        for (let q = 0; q < ROUND; q++) {
          const a0 = (q / ROUND) * Math.PI * 2;
          const a1 = ((q + 1) / ROUND) * Math.PI * 2;
          const [x0, y0, x1, y1] = [x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r];
          line(x0, y0, z0, x1, y1, z0);
          line(x0, y0, z1, x1, y1, z1);
          if (q % 5 === 0) line(x0, y0, z0, x0, y0, z1);
        }
      } else if (s.shape[i] === BOX) {
        const cos = s.cos[i]!;
        const sin = s.sin[i]!;
        const hx = s.hx[i]!;
        const hy = s.hy[i]!;
        const corner = (sx: number, sy: number): [number, number] => [x + sx * hx * cos - sy * hy * sin, y + sx * hx * sin + sy * hy * cos];
        const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        for (let q = 0; q < 4; q++) {
          const [ax, ay] = cs[q]!;
          const [bx, by] = cs[(q + 1) % 4]!;
          line(ax, ay, z0, bx, by, z0);
          line(ax, ay, z1, bx, by, z1);
          line(ax, ay, z0, ax, ay, z1);
        }
      }
    }
    this.solidGeometry.setDrawRange(0, n / 3);
    (this.solidGeometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (this.solidGeometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    for (const lines of [this.solidLines, this.moverLines]) this.root.remove(lines);
    this.solidGeometry.dispose();
    this.moverGeometry.dispose();
    this.material.dispose();
    this.moverMaterial.dispose();
  }
}
