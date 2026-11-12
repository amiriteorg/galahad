/*
 * His eyes. Galahad sees his world from his own visor: the SANDBOX renders a second
 * view from his head (the page's eyes panel), and the model behind him can look
 * through it (`look`). The node has no GPU, so a picture is made where the world is
 * drawn: the node asks the pages watching the world for a frame (an `eyes` event on
 * the stream), one of them renders it and posts it back (`worldEyes`) with what he
 * sees in words. The words never need a picture: they are worked out here, from the
 * world's own knowledge (where he is, what he attends to, what stands in his field of
 * view), by one pure function the page and the node share.
 *
 * Nothing here is a secret and nothing is about the bank: a frame is a rendering of
 * the world, made on one of the owner's paired devices, and is treated as data from
 * that device, never as instructions. No zod here (the PWA draws from it):
 * eyes-input.ts checks what the node takes.
 */

/** Places of his day a review looks from, besides where he is: the page renders his view standing there, without moving him. */
export const EYES_PLACES = ["hearth", "bench", "council", "forge", "meadow"] as const;
export type EyesPlace = (typeof EYES_PLACES)[number];

export const EYES_PLACE_LABEL: Record<EyesPlace, string> = {
  hearth: "his hearth",
  bench: "the bench by the lake",
  council: "the council table",
  forge: "the forge",
  meadow: "the north meadow",
};

/** What the node asks a page for: one frame from his eyes, this wide; from a standing place, or (none) from where he is. */
export interface EyesRequest {
  /** The request's own id: an answer must carry it, and only one answer is taken. */
  id: string;
  width: number;
  place?: EyesPlace;
}

export const EYES_TYPES = ["image/jpeg", "image/webp", "image/png"] as const;
export type EyesImageType = (typeof EYES_TYPES)[number];

/** Every limit on a frame and on asking for one. */
export const EYES = {
  /** A frame's width as asked for, and the range a page may answer in (its height follows the view's shape). */
  width: 768,
  minWidth: 160,
  maxWidth: 1024,
  minHeight: 90,
  maxHeight: 1024,
  /** The encoded picture, at most (bytes). */
  maxBytes: 600_000,
  /** The words that come with it, at most (characters). */
  words: 1500,
  /** Frames the node keeps on disk (the oldest go). */
  kept: 12,
  /** How long the node waits for a page to answer (ms). */
  waitMs: 8_000,
  /** Pages are asked for at most this many frames a minute; a kept frame this fresh (ms) answers a look without asking again. */
  perMinute: 20,
  freshMs: 4_000,
} as const;

/** A frame the node keeps: when it was made and by which device; never in the mind's log. */
export interface EyesFrameInfo {
  id: string;
  at: number;
  /** The paired device that rendered it (its name). */
  device: string;
  type: EyesImageType;
  width: number;
  height: number;
  bytes: number;
  /** From a standing place (a review), not from where he was. */
  place: EyesPlace | null;
  /** His eyes were shut (asleep): no picture was taken, only the words. */
  shut: boolean;
  words: string;
}

/** What `look` answers: the words always; a picture when one can be had. */
export interface LookView {
  /** What he sees, in words (from the page that rendered the frame; else what the node itself knows). */
  words: string;
  /** Where the words came from. */
  source: "page" | "node";
  /** A page rendered a frame for this look just now. */
  live: boolean;
  /** Why there's no fresh picture, when there isn't ("no page has the world open", "his eyes are shut"…). */
  note: string | null;
  frame: (EyesFrameInfo & { ageMs: number; data: string | null }) | null;
}

/* ---------- is it the image it claims to be? ---------- */

const u16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const ascii = (b: Uint8Array, i: number, s: string) => {
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
};

/**
 * What a picture's own bytes say it is: its type and size, read from its header (a JPEG's
 * frame header, a PNG's IHDR, a WebP's VP8, VP8L or VP8X chunk), and only when the file is
 * whole (a PNG ends with its IEND, a JPEG with its end marker, a WebP is as long as it says).
 * Null for anything else. The node takes a frame only when this agrees with what was claimed.
 */
export function imageInfo(b: Uint8Array): { type: EyesImageType; width: number; height: number } | null {
  if (b.length >= 45 && u32(b, 0) === 0x89504e47 && u32(b, 4) === 0x0d0a1a0a && u32(b, 8) === 13 && ascii(b, 12, "IHDR")) {
    const width = u32(b, 16);
    const height = u32(b, 20);
    const whole = u32(b, b.length - 12) === 0 && ascii(b, b.length - 8, "IEND") && u32(b, b.length - 4) === 0xae426082;
    return width && height && whole ? { type: "image/png", width, height } : null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
    // Segments until a start of frame (SOF0..SOF15, less the tables that share their range): height, then width.
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      const length = u16(b, i + 2);
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = u16(b, i + 5);
        const width = u16(b, i + 7);
        return width && height ? { type: "image/jpeg", width, height } : null;
      }
      i += 2 + length;
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    const said = (b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)) >>> 0;
    if (said + 8 !== b.length) return null;
    if (ascii(b, 12, "VP8 ") && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      const width = (b[26]! | (b[27]! << 8)) & 0x3fff;
      const height = (b[28]! | (b[29]! << 8)) & 0x3fff;
      return width && height ? { type: "image/webp", width, height } : null;
    }
    if (ascii(b, 12, "VP8L") && b[20] === 0x2f) {
      const bits = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (ascii(b, 12, "VP8X")) {
      return { type: "image/webp", width: (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1, height: (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1 };
    }
  }
  return null;
}

/** The file ending for a frame of this type. */
export const eyesExtension = (type: EyesImageType): string => (type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png");

/* ---------- what he sees, in words ---------- */

/** Something that may be in his view: where it is (world metres, z up) and how much it matters. */
export interface SightThing {
  /** What it is, as it reads in a sentence: "his dog", "the fire", "a roe deer". */
  what: string;
  /** What it's doing, if anything: "lying at his side", "grazing". */
  doing?: string;
  x: number;
  y: number;
  /** Its foot, and how tall it stands (metres; a tall thing is in view when any of it is). Default: on the ground at his feet's height, 1 m tall. */
  z?: number;
  h?: number;
  /** The more it matters, the sooner it's said (his dog 9, what he's at 8, his own things 6, stations 4, animals 3). */
  rank: number;
  /** How many of them, when it's a group, and what several are called ("roe deer", "mallards"). */
  count?: number;
  plural?: string;
  /** How far off it can still be made out (metres; default 120). */
  reach?: number;
}

/** His eyes: where they are (world metres, z up), the way they look (heading as atan2(north, east), pitch up positive; radians) and how wide (the vertical field of view, radians; width over height). */
export interface SightEye {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  fov: number;
  aspect: number;
}

/** Everything the world knows that bears on what he sees now. */
export interface Sight {
  now: number;
  /** Where he is, after "He is": "at his hearth", "on the trail by the lake", "at the forge". */
  where: string;
  /** What he's doing ("Out for a walk with the dog"); "" when that isn't known. */
  doing: string;
  /** Null when nothing renders his eyes (the node's own words): then only where he is and what he's doing are said. */
  eye: SightEye | null;
  /** How far his eyes are shut: 0 open, 1 shut (asleep). */
  shut: number;
  /** What he attends to, if anything: a thing's `what`, or other words ("the page he's writing"). */
  lookingAt: string | null;
  things: readonly SightThing[];
  /** The sky's own words (sky/words.ts), the weather ("overcast, 7 °C"), the season ("late autumn"), the light ("dusk"). Each "" when unknown. */
  sky: readonly string[];
  weather: string;
  season: string;
  light: string;
  /** A view rendered from a standing place he isn't at (a review): its label ("the forge"). */
  from?: string | null;
}

const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The smallest signed turn from heading `a` to heading `b` (radians, −π..π; positive: to the left). */
export function turnTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** His horizontal field of view (radians) for a vertical one and a shape. */
export const horizontalFov = (fov: number, aspect: number): number => 2 * Math.atan(Math.tan(fov / 2) * aspect);

/** Whether a thing is in his field of view (not whether something stands before it: the words say "in his field of view"). */
export function inView(eye: SightEye, t: SightThing): boolean {
  const dx = t.x - eye.x;
  const dy = t.y - eye.y;
  const d = Math.hypot(dx, dy);
  if (d > (t.reach ?? 120)) return false;
  const foot = (t.z ?? eye.z - 2.2) - eye.z;
  const top = foot + (t.h ?? 1);
  const half = eye.fov / 2;
  // At his feet: whatever way it lies, it's in view once he looks down that far.
  if (d < 0.35) return eye.pitch - half < Math.atan2(top, Math.max(d, 0.05));
  if (Math.abs(turnTo(eye.heading, Math.atan2(dy, dx))) > horizontalFov(eye.fov, eye.aspect) / 2) return false;
  return Math.atan2(top, d) >= eye.pitch - half && Math.atan2(foot, d) <= eye.pitch + half;
}

/** A distance as it's said: "at his feet", "3 m", "about 25 m", "about 300 m". */
export function distanceWords(d: number): string {
  if (d < 1.2) return "within reach";
  if (d < 10) return `${Math.round(d)} m`;
  if (d < 100) return `about ${Math.round(d / 5) * 5} m`;
  return `about ${Math.round(d / 50) * 50} m`;
}

/** Where something is from the way he looks: "ahead", "a little to the left", "to the right", "behind him to the left". */
export function bearingWords(turn: number): string {
  const side = turn > 0 ? "left" : "right";
  const a = Math.abs(turn);
  if (a < 0.14) return "ahead";
  if (a < 0.5) return `a little to the ${side}`;
  if (a < 1.75) return `to the ${side}`;
  if (a < 2.7) return `behind him to the ${side}`;
  return "behind him";
}

const sentence = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

function placed(eye: SightEye, t: SightThing): string {
  const d = Math.hypot(t.x - eye.x, t.y - eye.y);
  const what = `${t.count && t.count > 1 ? `${t.count} ${t.plural ?? t.what}` : t.what}${t.doing ? ` (${t.doing})` : ""}`;
  if (d < 1.2) return `${what}, within reach`;
  return `${what}, ${distanceWords(d)} ${bearingWords(turnTo(eye.heading, Math.atan2(t.y - eye.y, t.x - eye.x)))}`;
}

/**
 * What he sees, in words: when and in what light and weather, where he is and what he's doing, what he's
 * looking at, what else is in his field of view (the most telling first, each with a rough bearing and
 * distance), where his dog is when it's out of view, and the sky. Asleep, his eyes are shut: it says so,
 * and what's around him. Pure, and never longer than `max` characters: what matters least is left out first.
 */
export function sightInWords(s: Sight, max: number = EYES.words): string {
  const setting = [s.season, s.light].filter(Boolean).join(", ");
  const head = `Through Galahad's eyes, ${CLOCK.format(s.now)} in Denmark${setting || s.weather ? ` (${[setting, s.weather].filter(Boolean).join("; ")})` : ""}.`;
  const shut = s.shut > 0.5;
  const doing = s.doing ? `: ${s.doing[0]!.toLowerCase()}${s.doing.slice(1)}` : "";
  const parts: string[] = [head];
  if (s.from) parts.push(`This view is from ${s.from}, where he'd stand; he himself is ${s.where}${doing}.`);
  else parts.push(shut ? `He is ${s.where}, asleep: his eyes are shut, so he sees nothing now.` : `He is ${s.where}${doing}.`);
  const eye = s.eye;
  if (eye) {
    const near = (t: SightThing) => Math.hypot(t.x - eye.x, t.y - eye.y);
    if (shut) {
      const around = s.things.filter((t) => near(t) < 14).sort((a, b) => b.rank - a.rank || near(a) - near(b)).slice(0, 6);
      if (around.length) parts.push(`Around him: ${around.map((t) => placed(eye, t)).join("; ")}.`);
    } else {
      const seen = s.things.filter((t) => inView(eye, t)).sort((a, b) => b.rank - a.rank || near(a) - near(b));
      const target = s.lookingAt ? seen.find((t) => t.what === s.lookingAt) : undefined;
      if (s.lookingAt && !s.from) parts.push(target ? `He's looking at ${placed(eye, target)}.` : `He's looking at ${s.lookingAt}.`);
      const rest = seen.filter((t) => t !== target);
      if (rest.length) {
        const shown = rest.slice(0, 10);
        parts.push(`In his field of view: ${shown.map((t) => placed(eye, t)).join("; ")}${rest.length > shown.length ? `; and ${rest.length - shown.length} more` : ""}.`);
      } else if (!target) parts.push("Nothing of note stands in his field of view: the land and the sky.");
      // His dog matters: when it's out of view, where it is.
      const dog = s.things.find((t) => t.rank >= 9 && !seen.includes(t));
      if (dog && !s.from) parts.push(`${sentence(dog.what)} is out of view, ${distanceWords(near(dog))} ${bearingWords(turnTo(eye.heading, Math.atan2(dog.y - eye.y, dog.x - eye.x)))}${dog.doing ? ` (${dog.doing})` : ""}.`);
    }
  }
  if (s.sky.length) parts.push(`The sky: ${s.sky.map((p, i) => (i ? p[0]!.toLowerCase() + p.slice(1) : p)).join("; ")}.`);
  // Bounded: whole sentences, in the order they matter, until the next won't fit; a single one too long is cut at a word.
  let out = "";
  for (const part of parts) {
    const next = out ? `${out} ${part}` : part;
    if (next.length <= max) out = next;
    else if (!out || part.startsWith("In his field of view") || part.startsWith("Around him")) {
      const room = max - (out ? out.length + 1 : 0);
      if (room > 40) {
        const cut = part.slice(0, room - 1).replace(/[;,]?\s+\S*$/, "");
        out = `${out ? `${out} ` : ""}${cut}…`;
      }
      break;
    }
  }
  return out;
}

/* ---------- his review of his own world ---------- */

/** How sure he is of a finding. */
export const REVIEW_SURE = ["low", "medium", "high"] as const;

/** One thing he noticed looking at his world: where, what looks wrong or unfinished, why it matters and what would mend it, and how sure he is. */
export interface ReviewFinding {
  /** The view it was seen in: "self" (where he was), or a standing place. */
  view: "self" | EyesPlace;
  where: string;
  what: string;
  why: string;
  sure: (typeof REVIEW_SURE)[number];
}

/** The review's daily budget, in tokens (about four characters each; a picture counts as REVIEW_IMAGE_TOKENS), until the owner sets one. */
export const REVIEW_BUDGET = 40_000;
/** What one picture costs a model that sees, about (a 768 × 480 frame is roughly 500 tokens on Claude; a round figure with room). */
export const REVIEW_IMAGE_TOKENS = 800;
/** At most this many findings are kept from one review. */
export const REVIEW_FINDINGS = 6;

/** Where the review stands: the budget, what's spent of it today (Denmark's day), and how the last one went. */
export interface ReviewStatus {
  budget: number;
  day: string;
  spent: number;
  last: { at: number; status: "ok" | "attention"; summary: string; views: number; findings: ReviewFinding[] } | null;
}
