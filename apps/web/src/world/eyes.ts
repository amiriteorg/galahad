import type { SightEye } from "@galahad/core/eyes";
import { CanvasTarget, type Object3D, PerspectiveCamera, Quaternion, Vector3, type WebGPURenderer } from "three/webgpu";

/*
 * His eyes: a second view of the world, from Galahad's own visor.
 *
 * The camera sits at his visor's line, a little before its glass, and turns with
 * his head (knight.ts solves the head's yaw and pitch towards what he attends
 * to), so his helm is behind the view and what's before him is seen as he'd see
 * it: his hands, the page under his pen, his sword's hilt at the bench, the dog
 * at his feet when he looks down. A natural field of view (62° top to bottom:
 * the main view's 45° is a long lens from over his shoulder).
 *
 * Cost is the design. A second render of the scene is dear, so:
 *
 * - It's drawn only while its panel is open, into a small canvas of its own (by
 *   tier: 192, 256 or 384 pixels wide), a few times a second (2, 5 or 12), never
 *   per frame; not at all while his eyes are shut. Closed, it costs one test a frame.
 * - On WebGPU the panel's canvas is a second target of the same device (three's
 *   CanvasTarget): the same pipelines, buffers, textures and shadow map as the
 *   main view, nothing read back, nothing copied. It goes straight to that
 *   canvas without the post effects (no ambient occlusion, shafts or bloom), and
 *   the sun's shadow map isn't drawn again for it: it's the main view's.
 * - On WebGL2 (one context, one canvas) his view is drawn on the main canvas,
 *   copied into the panel's 2D canvas, and the main view drawn over it again in
 *   the same task, so it's never seen there: a full-size render a time, at the
 *   low tier's two a second.
 * - Nothing is allocated per frame: the cameras, the targets and the scratch
 *   vectors are made once.
 *
 * Swapped, his view is the main one (full size, with the post effects, at the
 * main view's rate) and the usual view from over his shoulder goes to the panel.
 * A frame for the node (`look`) is drawn the same way into a canvas of its own,
 * 768 wide, and encoded as a JPEG.
 */

/**
 * The eye camera: its field of view (degrees, top to bottom), its near plane, where it sits in his head's frame
 * (y up, z forward; metres), its shape, and how far his eyes turn in his head beyond where it points (radians).
 */
export const EYE = { fov: 62, near: 0.07, up: 0.172, forward: 0.25, aspect: 1.6, turn: 0.4 } as const;

/** What the eyes need of the scene. */
export interface EyesHost {
  renderer: WebGPURenderer;
  webgpu: boolean;
  /** The main canvas. */
  canvas: HTMLCanvasElement;
  /** Draws the scene from `camera` into whatever the renderer is aimed at: what follows a camera is set for it and put back after; no post effects; the sun's shadow map as it stands. */
  draw(camera: PerspectiveCamera): void;
  /** Draws the main view again (after his view was drawn on the main canvas: the WebGL2 path). */
  redraw(): void;
}

/** How much sooner than its interval a panel's frame may come (milliseconds): under half a 120 Hz frame. */
export const PACE_SLACK_MS = 4;

const FLIP = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const scratch = new Vector3();
const scale = new Vector3();
const ahead = new Vector3();
const turn = new Quaternion();
const part = new Quaternion();

interface Surface {
  canvas: HTMLCanvasElement;
  /** WebGPU: the canvas as a target of the renderer's own device. */
  target: CanvasTarget | null;
  /** WebGL2: a 2D canvas the main canvas is copied into. */
  ctx: CanvasRenderingContext2D | null;
  width: number;
  height: number;
}

export class Eyes {
  /** His own view. */
  readonly camera = new PerspectiveCamera(EYE.fov, EYE.aspect, EYE.near, 2000);
  /** The usual view from over his shoulder, for the panel while his own is the main one. */
  readonly outside = new PerspectiveCamera(45, EYE.aspect, 0.25, 2000);
  /** His view is the main one, and the usual view is in the panel. */
  swapped = false;
  /** How far his eyes are shut, 0..1 (asleep). */
  shut = 0;
  /** What the panel has cost since it was opened: frames drawn, and the milliseconds the draws took on the CPU. */
  readonly cost = { frames: 0, ms: 0 };
  private panel: Surface | null = null;
  private shot: Surface | null = null;
  private last = -1e9;

  constructor(
    /** The panel's width in pixels and how often it's drawn, by tier. */
    private readonly size: { width: number; fps: number },
    private readonly host: EyesHost,
  ) {}

  private surface(width: number, height: number, className?: string): Surface {
    const canvas = document.createElement("canvas");
    if (className) canvas.className = className;
    canvas.width = width;
    canvas.height = height;
    if (!this.host.webgpu) return { canvas, target: null, ctx: canvas.getContext("2d"), width, height };
    const target = new CanvasTarget(canvas);
    // Sized while it's the renderer's own, so the backend sizes its buffers to it.
    const main = this.host.renderer.getCanvasTarget();
    this.host.renderer.setCanvasTarget(target);
    target.setPixelRatio(1);
    target.setSize(width, height, false);
    this.host.renderer.setCanvasTarget(main);
    return { canvas, target, ctx: null, width, height };
  }

  private release(surface: Surface | null): void {
    surface?.target?.dispose();
    surface?.canvas.remove();
  }

  /** The panel was drawn at `now` (the draw itself does this: for tests of its pace). */
  drew(now: number): void {
    this.last = now;
  }

  /** Opens the panel in `container` (its canvas goes there), or closes it (null): closed, nothing more is drawn for it. */
  open(container: HTMLElement | null): void {
    if (!container) {
      this.release(this.panel);
      this.panel = null;
      return;
    }
    if (!this.panel) {
      const width = this.size.width;
      this.panel = this.surface(width, Math.round(width / EYE.aspect), "world-eyes-canvas");
      this.panel.canvas.setAttribute("aria-hidden", "true");
      this.cost.frames = 0;
      this.cost.ms = 0;
    }
    if (this.panel.canvas.parentElement !== container) container.prepend(this.panel.canvas);
    this.last = -1e9;
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  /** Whether his eyes have to be posed this frame: the panel shows them, or the main view does. */
  get wanted(): boolean {
    return this.panel !== null || this.swapped;
  }

  /** Puts the eye camera at his visor, turned as his head is (`head`: his head's bone, posed for this frame). */
  pose(head: Object3D): void {
    head.updateWorldMatrix(true, false);
    this.camera.position.set(0, EYE.up, EYE.forward).applyMatrix4(head.matrixWorld);
    head.matrixWorld.decompose(scratch, this.camera.quaternion, scale);
    // A camera looks along its own −z; his head faces +z.
    this.camera.quaternion.multiply(FLIP);
    this.camera.updateMatrixWorld();
  }

  private gazing = 0;
  private readonly target = new Vector3();

  /**
   * After `pose`: his eyes turn in his head towards what he attends to (a point, scene coordinates), as far as
   * eyes do (EYE.turn). His head turns most of the way and stops (knight.ts holds its pitch and yaw to what a
   * neck does); his eyes go the rest, so the page under his pen and his hand on it are in view, and the dog at
   * his feet. Eased in and out over a moment (at once without motion, or with no time passed).
   */
  gaze(on: boolean, x: number, y: number, z: number, dt: number, motion: boolean): void {
    if (on) this.target.set(x, y, z);
    this.gazing = motion && dt > 0 ? this.gazing + ((on ? 1 : 0) - this.gazing) * (1 - Math.exp(-dt * 6)) : on ? 1 : 0;
    if (this.gazing < 0.005) return;
    ahead.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    scratch.copy(this.target).sub(this.camera.position);
    const far = scratch.length();
    if (far < 0.12) return;
    scratch.divideScalar(far);
    const angle = ahead.angleTo(scratch);
    if (angle < 1e-4) return;
    turn.setFromUnitVectors(ahead, scratch);
    part.identity().slerp(turn, Math.min(1, EYE.turn / angle) * this.gazing);
    this.camera.quaternion.premultiply(part);
    this.camera.updateMatrixWorld();
  }

  /** Puts the eye camera where his eyes would be standing at a place: scene coordinates, looking along `heading` (atan2(north, east)), `pitch` up. */
  poseAt(x: number, y: number, z: number, heading: number, pitch: number): void {
    this.camera.position.set(x, y, z);
    scratch.set(x + Math.cos(heading) * Math.cos(pitch), y + Math.sin(pitch), z - Math.sin(heading) * Math.cos(pitch));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(scratch);
    this.camera.updateMatrixWorld();
  }

  /** His eyes as the words need them: where (world metres, z up), the way they look, and how wide. */
  sightEye(origin: readonly [number, number], out: SightEye): SightEye {
    const c = this.camera;
    c.getWorldDirection(scratch);
    out.x = c.position.x + origin[0];
    out.y = -c.position.z + origin[1];
    out.z = c.position.y;
    out.heading = Math.atan2(-scratch.z, scratch.x);
    out.pitch = Math.asin(Math.max(-1, Math.min(1, scratch.y)));
    out.fov = (c.fov * Math.PI) / 180;
    out.aspect = c.aspect;
    return out;
  }

  /** Whether the panel is due a frame now: open, on screen, its interval passed (a second apart without motion), and something to see. */
  due(now: number, motion: boolean): boolean {
    const p = this.panel;
    if (!p) return false;
    // (Less a few milliseconds: frames come on the display's beat, and an interval that is a whole number of them must not wait one more.)
    if (now - this.last < (motion ? 1000 / this.size.fps : 1000) - PACE_SLACK_MS) return false;
    // His eyes shut: nothing to draw (the panel shows his lids). The usual view, when swapped, is always there.
    if (!this.swapped && this.shut > 0.97) return false;
    return p.canvas.isConnected !== false;
  }

  /** Draws the panel's view (his eyes; the usual view when swapped) into its canvas. */
  draw(now: number): void {
    const p = this.panel;
    if (!p) return;
    this.drew(now);
    const started = performance.now();
    this.render(this.swapped ? this.outside : this.camera, p);
    this.cost.frames += 1;
    this.cost.ms += performance.now() - started;
  }

  private render(camera: PerspectiveCamera, surface: Surface): void {
    const { renderer } = this.host;
    if (surface.target) {
      const main = renderer.getCanvasTarget();
      if (camera.aspect !== surface.width / surface.height) {
        camera.aspect = surface.width / surface.height;
        camera.updateProjectionMatrix();
      }
      renderer.setCanvasTarget(surface.target);
      try {
        this.host.draw(camera);
      } finally {
        renderer.setCanvasTarget(main);
      }
      return;
    }
    if (!surface.ctx) return;
    // WebGL2: on the main canvas, with its shape; the middle of it, in the eyes' own shape, is copied out.
    const main = this.host.canvas;
    const wide = main.width / Math.max(1, main.height);
    const want = surface.width / surface.height;
    const fov = camera.fov;
    const aspect = camera.aspect;
    camera.aspect = wide;
    // Narrower than the eyes' shape (a phone held upright): the view opens upward so its sides still fit.
    if (wide < want) camera.fov = (2 * Math.atan((Math.tan((fov * Math.PI) / 360) * want) / wide) * 180) / Math.PI;
    camera.updateProjectionMatrix();
    this.host.draw(camera);
    const sw = wide < want ? main.width : main.height * want;
    const sh = wide < want ? main.width / want : main.height;
    surface.ctx.drawImage(main, (main.width - sw) / 2, (main.height - sh) / 2, sw, sh, 0, 0, surface.width, surface.height);
    camera.fov = fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    this.host.redraw();
  }

  /** One frame from the eye camera as it's posed now, `width` pixels wide, as a JPEG (or whatever the browser encodes instead). */
  capture(width: number): Promise<Blob | null> {
    const height = Math.round(width / EYE.aspect);
    if (!this.shot || this.shot.width !== width) {
      this.release(this.shot);
      this.shot = this.surface(width, height);
    }
    const shot = this.shot;
    this.render(this.camera, shot);
    // The canvas holds the frame until this task ends: it's encoded from here.
    return new Promise((resolve) => shot.canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82));
  }

  dispose(): void {
    this.release(this.panel);
    this.release(this.shot);
    this.panel = this.shot = null;
  }
}
