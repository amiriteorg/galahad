import { z } from "zod";
import { EYES, EYES_PLACES, EYES_TYPES, REVIEW_FINDINGS, REVIEW_SURE } from "./eyes.ts";

/*
 * What the node takes about his eyes (eyes.ts), checked at the boundary. Kept apart
 * from eyes.ts so the world's renderer bundle needs no zod.
 */

export const EyesPlaceName = z.enum(EYES_PLACES);

/** A frame request's id: the node's own, random; an answer names it. */
export const EyesRequestId = z.string().regex(/^ey_[A-Za-z0-9_-]{16}$/);

/** `look`: from where he is, or from a standing place of his day. */
export const LookInput = z.strictObject({
  place: EyesPlaceName.optional(),
  /** Leave the picture's bytes out of the answer (the words and what's kept are enough). */
  words: z.boolean().optional(),
});

/** Base64 of at most EYES.maxBytes bytes. */
const Picture = z
  .string()
  .max(Math.ceil(EYES.maxBytes / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "base64");

/**
 * A page's answer to a frame request: the picture (none when his eyes are shut), what it claims
 * to be, and what he sees in words. The node checks the picture's own header against the claim.
 */
export const EyesFrameInput = z
  .strictObject({
    request: EyesRequestId,
    /** His eyes are shut (asleep): no picture, only the words. */
    shut: z.boolean().optional(),
    image: Picture.optional(),
    type: z.enum(EYES_TYPES).optional(),
    width: z.number().int().min(EYES.minWidth).max(EYES.maxWidth).optional(),
    height: z.number().int().min(EYES.minHeight).max(EYES.maxHeight).optional(),
    words: z.string().min(1).max(EYES.words),
  })
  .refine((f) => (f.shut ? !f.image : !!f.image && !!f.type && !!f.width && !!f.height), "a picture with its type and size, or shut eyes and no picture");

/** The review's budget, tokens a day. */
export const REVIEW_BUDGET_MIN = 2_000;
export const REVIEW_BUDGET_MAX = 400_000;
export const ReviewBudgetInput = z.strictObject({ budget: z.number().int().min(REVIEW_BUDGET_MIN).max(REVIEW_BUDGET_MAX) });

/** A review: from where he is, and from these places if a page is open to render them (default: all of them). */
export const WorldReviewInput = z.strictObject({ places: z.array(EyesPlaceName).max(EYES_PLACES.length).optional() });

const Line = (max: number) =>
  z
    .string()
    .trim()
    .min(3)
    .max(max);

/** What the model that looked must answer, for one view: a fixed shape, checked before anything is kept. */
export const ReviewReply = z.strictObject({
  findings: z
    .array(z.strictObject({ where: Line(120), what: Line(240), why: Line(300), sure: z.enum(REVIEW_SURE) }))
    .max(REVIEW_FINDINGS * 2),
});
