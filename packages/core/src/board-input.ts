import { z } from "zod";
import { BOARD_H, BOARD_LIMITS as L, BOARD_W, CHALK, ITEM_ID, STROKE_ID } from "./board.ts";

/*
 * What the node accepts for the chalkboard, checked at the boundary. Kept apart
 * from board.ts so the PWA and the world's renderer need no zod. Text from an
 * agent is untrusted and shown to the owner: it's bounded here, cleaned of
 * control and bidirectional-override characters, and only ever drawn as text.
 */

/** Control characters (C0 but tab and newline, DEL, C1) and the bidirectional overrides that could make text read other than it is. */
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const clean = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(/\r\n?/g, "\n").replace(UNSAFE, ""));
const Text = (max: number) => clean(max).refine((s) => s.trim().length > 0, "it's empty");

const Finite = z.number().finite();
const Value = z.number().finite().min(-1e15).max(1e15);

export const ChalkSchema = z.enum(CHALK);
export const StrokeId = z.string().regex(STROKE_ID);
export const ItemId = z.string().regex(ITEM_ID);

/** One stroke of the owner's, as the PWA sends it on pen-up. */
const strokeShape = {
  id: StrokeId,
  color: ChalkSchema,
  width: z.number().finite().min(L.minWidth).max(L.maxWidth),
  points: z.array(Finite.min(-100).max(BOARD_W + 100)).min(2).max(L.strokePoints * 2),
  pressure: z.array(z.number().finite().min(0).max(1)).max(L.strokePoints).optional(),
  erase: z.boolean().optional(),
};
const strokeChecks = <T extends z.ZodType<{ points: number[]; pressure?: number[] | undefined }>>(schema: T) =>
  schema
    .refine((s) => s.points.length % 2 === 0, "points are x,y pairs")
    .refine((s) => s.points.every((v, i) => i % 2 === 0 || (v >= -100 && v <= BOARD_H + 100)), "a point is off the board")
    .refine((s) => !s.pressure || s.pressure.length === s.points.length / 2, "one pressure per point");
export const StrokeInput = strokeChecks(z.strictObject(strokeShape));
export type StrokeInput = z.infer<typeof StrokeInput>;

const Series = z.strictObject({ name: clean(L.label), values: z.array(Value).min(1).max(L.values) });

const shapes = {
  text: { kind: z.literal("text"), text: Text(L.text), size: z.enum(["s", "m", "l"]).optional() },
  note: { kind: z.literal("note"), title: clean(L.title).optional(), text: Text(L.note) },
  equation: { kind: z.literal("equation"), text: Text(L.equation) },
  chart: {
    kind: z.literal("chart"),
    title: clean(L.title).optional(),
    type: z.enum(["line", "bar", "scatter"]).optional(),
    series: z.array(Series).min(1).max(L.series),
    xValues: z.array(Value).max(L.values).optional(),
    xLabel: clean(L.label).optional(),
    yLabel: clean(L.label).optional(),
  },
};
type Chart = { series: { values: number[] }[]; xValues?: number[] | undefined };
/** A chart's own limits, beyond each field's. */
function chartIssues(c: Chart, ctx: z.RefinementCtx): void {
  if (c.series.reduce((n, s) => n + s.values.length, 0) > L.chartValues) ctx.addIssue({ code: "custom", message: `at most ${L.chartValues} values in a chart` });
  if (c.xValues && c.series.some((s) => s.values.length > c.xValues!.length)) ctx.addIssue({ code: "custom", message: "xValues needs an x for every value of every series" });
}

/** What an item says. */
export const ItemContentSchema = z.discriminatedUnion("kind", [
  z.strictObject(shapes.text),
  z.strictObject(shapes.note),
  z.strictObject(shapes.equation),
  z.strictObject(shapes.chart).superRefine(chartIssues),
]);

/** An item to write: its content, and optionally where (its top left, board units), how wide to wrap it, its colour, or which of the writer's own items it replaces. */
export const BoardWriteInput = z.strictObject({
  item: ItemContentSchema,
  x: z.number().finite().min(0).max(BOARD_W).optional(),
  y: z.number().finite().min(0).max(BOARD_H).optional(),
  width: z.number().finite().min(80).max(BOARD_W).optional(),
  color: ChalkSchema.optional(),
  replace: ItemId.optional(),
});
export type BoardWriteInput = z.infer<typeof BoardWriteInput>;

/** The snapshot of what the owner sees, as base64 PNG (checked again, byte by byte, at the node). */
const SnapshotB64 = z
  .string()
  .max(Math.ceil((L.snapshotBytes * 4) / 3) + 4)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const BoardDrawInput = z.strictObject({
  strokes: z.array(StrokeInput).max(L.strokesPerDraw),
  snapshot: SnapshotB64.optional(),
});
export type BoardDrawInput = z.infer<typeof BoardDrawInput>;

export const BoardEraseInput = z
  .strictObject({
    strokes: z.array(StrokeId).max(L.erasePerCall).optional(),
    items: z.array(ItemId).max(L.erasePerCall).optional(),
  })
  .refine((e) => (e.strokes?.length ?? 0) + (e.items?.length ?? 0) > 0, "name a stroke or an item to erase");
export type BoardEraseInput = z.infer<typeof BoardEraseInput>;

/** Who wrote an item, where it is, its colour and when. */
const placed = { id: ItemId, by: z.string().min(1).max(64), x: Finite, y: Finite, w: Finite, h: Finite, color: ChalkSchema, at: Finite };
export const ItemStored = z.discriminatedUnion("kind", [
  z.strictObject({ ...shapes.text, ...placed }),
  z.strictObject({ ...shapes.note, ...placed }),
  z.strictObject({ ...shapes.equation, ...placed }),
  z.strictObject({ ...shapes.chart, ...placed }).superRefine(chartIssues),
]);

/** A stroke as the node keeps it. */
export const StrokeStored = strokeChecks(z.strictObject({ ...strokeShape, at: Finite }));

/** The history's pages: newest first, before a version. */
export const BoardHistoryInput = z.strictObject({
  before: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export const BoardVersionInput = z.strictObject({ version: z.number().int().min(0) });

/** The file a board is kept in on the node: what was written, checked again whenever it's read. */
export const BoardFile = z.strictObject({
  v: z.literal(1),
  version: z.number().int().min(0),
  updatedAt: Finite,
  items: z.array(ItemStored).max(L.items),
  strokes: z.array(StrokeStored).max(L.strokes),
  snapshot: z
    .strictObject({ at: Finite, version: z.number().int().min(0), width: z.number().int(), height: z.number().int(), bytes: z.number().int() })
    .nullable(),
});
