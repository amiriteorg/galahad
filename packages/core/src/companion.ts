/*
 * His dog. It wakes him in the morning, walks with him, lies at his feet by the lake
 * and sleeps beside him at the hearth; and it has the name you give it. The name is
 * an owner's setting in the mind (`companion.named`, `companion.unnamed`: signed,
 * synced, last writer wins), so every node's world and his journal call the dog the
 * same thing. Unnamed, it's "the dog".
 *
 * Here: what a name may be, for the API, the CLI and the Settings field alike. Pure and
 * free of zod, so the PWA says why a name won't do with the same words as the node.
 */

export interface Companion {
  name: string;
}

export const COMPANION_NAME_MAX = 24;

/** Letters and their marks (any script), digits, spaces, hyphens and apostrophes. */
const NAME = /^[\p{L}\p{M}\p{N} '’-]+$/u;

/** A name as it's kept: composed (NFC), runs of whitespace as one space, trimmed. */
export const cleanCompanionName = (raw: string): string => raw.normalize("NFC").replace(/\s+/g, " ").trim();

/** Why a name (as kept) can't be his dog's, in words for the owner; null when it can. */
export function companionNameProblem(name: string): string | null {
  if (!name) return "Give his dog a name of at least one letter.";
  if ([...name].length > COMPANION_NAME_MAX) return `A name is at most ${COMPANION_NAME_MAX} characters.`;
  if (!NAME.test(name)) return "A name is letters, digits, spaces, hyphens and apostrophes only.";
  if (!/[\p{L}\p{N}]/u.test(name)) return "A name needs at least one letter or digit.";
  if (name !== cleanCompanionName(name)) return "A name has no spaces at its ends, and single spaces within.";
  return null;
}

/** What the mind holds, read strictly (the log itself is lenient, for newer nodes): a name that passes, or none. */
export function readCompanion(value: unknown): Companion | null {
  if (typeof value !== "object" || value === null) return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && companionNameProblem(name) === null ? { name } : null;
}
