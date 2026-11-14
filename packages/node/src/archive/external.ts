import type { BoardItem, Trust } from "@galahad/core";
import { boardCursor, type BoardHistory, boardVersionForArchive, boardVersionsSince } from "../board-history.ts";
import type { ExternalSource } from "./adapters.ts";

/*
 * The chalkboard, as the archive takes it in (the daemon passes this to
 * boardsAdapter).
 *
 * The chalkboard: its versions. Each pen-up is a version, so a run of strokes
 * by the same hand is kept as one entry, its last version (which shows them
 * all), and a blank board where its history begins isn't kept at all; the
 * board's own history keeps every version. A version is as trusted
 * as the least trusted hand on it: what another agent wrote there is never
 * passed off as Galahad's or yours.
 */

/** Strokes drawn within this of each other, by the same hand, are one run. */
export const STROKE_RUN_MS = 10 * 60_000;

/** The least trusted hand on the board: another agent's words make it untrusted, his make it his; otherwise it's yours. */
export function boardTrust(items: readonly Pick<BoardItem, "by">[]): Trust {
  if (items.some((i) => i.by !== "owner" && i.by !== "galahad")) return "untrusted";
  return items.some((i) => i.by === "galahad") ? "agent" : "owner";
}

export function boardSource(board: { readonly history: BoardHistory }): ExternalSource {
  return {
    listSince: async (cursor, limit) => {
      // One past the page, to see whether its last stroke's run goes on.
      const { versions } = boardVersionsSince(board, cursor, limit + 1);
      const page = versions.slice(0, limit);
      const inRun = (i: number) => {
        const v = page[i]!;
        const next = versions[i + 1];
        return v.change === "draw" && next !== undefined && next.change === "draw" && next.by === v.by && next.at - v.at < STROKE_RUN_MS;
      };
      // Where its history begins: worth keeping only with something on it (after the owner forgot the history before).
      const blankStart = (i: number) => {
        if (page[i]!.change !== "start") return false;
        const at = boardVersionForArchive(board, page[i]!.version);
        return !at || (!at.items.length && !at.strokes.length);
      };
      const records = page.flatMap((v, i) => (inRun(i) || blankStart(i) ? [] : [{ id: String(v.version), title: `Chalkboard, version ${v.version}: ${v.summary}`, at: v.at }]));
      return { records, cursor: page.length ? boardCursor(page.at(-1)!.version) : null };
    },
    describe: async (id) => {
      const version = boardVersionForArchive(board, Number(id));
      // Forgotten by the owner since it was listed: this pull fails whole, and the next listing goes without it.
      if (!version) throw new Error(`chalkboard version ${id} is no longer in its history`);
      return {
        description: version.text,
        trust: boardTrust(version.items),
        files: version.image ? [{ path: `chalkboard-v${version.image.shows}.png`, bytes: version.image.png }] : [],
      };
    },
  };
}
