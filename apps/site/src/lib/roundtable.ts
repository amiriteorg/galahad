/*
 * The Roundtable's geometry, as the app's icon has it (ROUNDTABLE in apps/web/src/brand.ts), for the site's two
 * drawings of it: the mark in the bar and the title block, and the table in the plan's hall.
 */
import { ROUNDTABLE } from "../../../web/src/brand.ts";

export { ROUNDTABLE };

type Seat = { R: number; w: number; d: number; rx: number };

/** A chair as a rect on the 24-unit grid: the knights' at the bottom (turned into place by `turn`), Galahad's at the top. */
export const seat = (c: Seat, top: boolean) => ({ x: 12 - c.w / 2, y: top ? 12 - c.R - c.d / 2 : 12 + c.R - c.d / 2, width: c.w, height: c.d, rx: c.rx });

/** How a knight's chair is turned about the middle from the bottom one, which stays as it is. */
export const turn = (deg: number) => (deg === 180 ? undefined : `rotate(${(deg + 180) % 360} 12 12)`);
