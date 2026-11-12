import { writeFileSync } from "node:fs";
import { EYES_PLACE_LABEL, EYES_PLACES, type EyesPlace, eyesExtension, type LookView, type ReviewStatus, type RouteName } from "@galahad/core";
import type { ReviewResult } from "./world-review.ts";

/*
 * `galahad look` and `galahad world review`, for you at a terminal: what he sees
 * through his own eyes in the SANDBOX (the words, and the picture saved where you
 * say), and his review of his own world (suggestions only).
 */

interface Api {
  call<T = any>(name: RouteName, input?: unknown): Promise<T>;
}

type Flags = Record<string, string | boolean | (string | boolean)[] | undefined>;

const tty = process.stdout.isTTY;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const str = (flags: Flags, key: string) => (typeof flags[key] === "string" ? (flags[key] as string) : undefined);

/** How long ago, in a few words: "just now", "40 s ago", "12 min ago", "3 h ago", "2 days ago". */
export function ageWords(ms: number): string {
  if (ms < 5_000) return "just now";
  if (ms < 90_000) return `${Math.round(ms / 1000)} s ago`;
  if (ms < 90 * 60_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 48 * 3_600_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return `${Math.round(ms / 86_400_000)} days ago`;
}

function placeOf(flags: Flags): EyesPlace | undefined {
  const place = str(flags, "place");
  if (place === undefined) return undefined;
  if (!(EYES_PLACES as readonly string[]).includes(place)) throw new Error(`--place takes one of: ${EYES_PLACES.join(", ")}`);
  return place as EyesPlace;
}

/** `galahad look [--place hearth] [--out view.jpg]`: the words, and the picture saved to the path given. */
export async function lookCommand(api: Api, flags: Flags): Promise<void> {
  const place = placeOf(flags);
  const out = str(flags, "out");
  const view = await api.call<LookView>("look", { ...(place ? { place } : {}), ...(out ? {} : { words: true }) });
  console.log(bold(place ? `Through his eyes, from ${EYES_PLACE_LABEL[place]}` : "Through his eyes"));
  console.log(view.words);
  if (view.note) console.log(dim(view.note));
  const frame = view.frame;
  if (!frame) return;
  const what = frame.shut ? "eyes shut, no picture" : `${frame.width} × ${frame.height}, ${Math.max(1, Math.round(frame.bytes / 1024))} KB`;
  console.log(dim(`${view.live ? "Frame" : "Last frame kept"}: ${what} · rendered on ${frame.device} · ${ageWords(frame.ageMs)}`));
  if (!view.live && frame.words) console.log(dim(`What it showed then: ${frame.words}`));
  if (!out) {
    if (!frame.shut) console.log(dim("Save the picture with --out <file>."));
    return;
  }
  if (!frame.data) {
    console.log(frame.shut ? "No picture to save: his eyes are shut." : "No picture to save: the kept frame's file is gone.");
    return;
  }
  const want = `.${eyesExtension(frame.type)}`;
  const path = /\.(jpe?g|png|webp)$/i.test(out) ? out : `${out}${want}`;
  writeFileSync(path, Buffer.from(frame.data, "base64"));
  console.log(`Saved ${path} (${frame.type}).`);
}

const tokens = (n: number) => n.toLocaleString("en-US");

function printStatus(s: ReviewStatus): void {
  console.log(`Budget: ${tokens(s.budget)} tokens a day · ${tokens(s.spent)} used today (${s.day || "no review yet"})`);
  if (!s.last) {
    console.log(dim("He hasn't reviewed his world yet: galahad world review (with the SANDBOX open on one of your devices)."));
    return;
  }
  console.log(`Last: ${new Date(s.last.at).toLocaleString()} · ${s.last.summary}`);
  for (const f of s.last.findings) console.log(`  - ${f.view === "self" ? "where he stood" : EYES_PLACE_LABEL[f.view]}, ${f.where}: ${f.what} ${dim(`(${f.sure}) ${f.why}`)}`);
}

/** `galahad world review [--places hearth,forge] | --status | --budget 40000`. */
export async function worldReviewCommand(api: Api, flags: Flags): Promise<void> {
  const budget = str(flags, "budget");
  if (budget !== undefined) {
    if (!/^\d+$/.test(budget)) throw new Error("--budget takes a number of tokens a day, e.g. 40000");
    printStatus(await api.call<ReviewStatus>("setReviewBudget", { budget: Number(budget) }));
    return;
  }
  if (flags.status) {
    printStatus(await api.call<ReviewStatus>("worldReviewStatus"));
    return;
  }
  const places = str(flags, "places")?.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of places ?? []) if (!(EYES_PLACES as readonly string[]).includes(p)) throw new Error(`--places takes any of: ${EYES_PLACES.join(", ")}`);
  console.log(dim("He's looking at his world (a page with the SANDBOX open renders each view; this takes a minute or two)…"));
  const result = await api.call<ReviewResult>("worldReview", places ? { places } : {});
  console.log(`${result.status === "ok" ? "✓" : "△"} ${result.summary}`);
  for (const f of result.findings) console.log(`  - ${f.view === "self" ? "where he stood" : EYES_PLACE_LABEL[f.view]}, ${f.where}: ${f.what} ${dim(`(${f.sure}) ${f.why}`)}`);
  if (result.findings.length) console.log(dim("Suggestions only: each is in your inbox (galahad inbox) and among his ideas (galahad archive search). He changes nothing himself."));
}
