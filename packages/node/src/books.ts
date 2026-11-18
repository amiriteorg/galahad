import { createHash } from "node:crypto";
import type { ArgValue } from "@galahad/core";
import type { ConnectorResult } from "@galahad/brain";
import type { Transfer } from "./bilag.ts";

/*
 * Bilag into Dinero, to the payments they document (docs/BOOKS.md; the owner's word of 18 November 2026: files go
 * into Dinero on their own, attaching one to a booked voucher's card asks). A file in your Drive goes into Dinero's
 * archive as it is: the node reads its bytes from Drive and hands them to Dinero's upload_file with their length and
 * SHA-256, which Dinero checks before it keeps them, so no model ever types a file out. Attaching it to the card of a
 * payment booked without documentation is filed for your approval, with why that bilag is that payment's.
 */

export const BOOKS = "dinero";
/** Dinero takes a file of a few megabytes inline; more is refused here rather than half sent. */
export const BOOKS_MAX_BYTES = 10 * 2 ** 20;

export interface BooksDeps {
  transfer: Transfer;
  /** The node's own: a file's bytes into an MCP tool that creates (ConnectorService.handFile). */
  handFile: (connector: string, tool: string, args: Record<string, ArgValue>, why: string) => Promise<ConnectorResult>;
  /** A call as Galahad's own, which asks you where its class says so (ConnectorService.call). */
  ask: (call: { connector: string; tool: string; args: Record<string, ArgValue>; why: string }) => Promise<{ status: string; action?: string }>;
}

export interface BooksAttach {
  organizationId: number;
  /** The voucher file card (list_voucher_file_cards): a payment booked without its bilag. */
  card: string;
  /** The bilag's id in Drive. */
  file: string;
  /** Why this bilag is this payment's, as your approval card says it. */
  why: string;
}

export interface BooksAttached {
  name: string;
  bytes: number;
  sha256: string;
  fileGuid: string;
  /** The approval that attaching it waits on; null when it needed none (its class runs freely). */
  action: string | null;
}

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** The fileGuid in what Dinero answered an upload with: its JSON's, else the one Guid it names. */
export function fileGuidOf(body: string): string | null {
  try {
    const found = (function look(value: unknown): string | null {
      if (!value || typeof value !== "object") return null;
      for (const [key, inner] of Object.entries(value)) {
        if (/^fileguid$/i.test(key) && typeof inner === "string" && GUID.test(inner)) return inner;
        const deeper = look(inner);
        if (deeper) return deeper;
      }
      return null;
    })(JSON.parse(body));
    if (found) return found;
  } catch {
    /* words, not JSON */
  }
  const named = /fileGuid\W{0,6}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(body)?.[1];
  if (named) return named;
  const all = body.match(new RegExp(GUID.source, "gi")) ?? [];
  return new Set(all.map((g) => g.toLowerCase())).size === 1 ? all[0]! : null;
}

function json(got: { ok: boolean; status: number; bytes: Uint8Array }, what: string): any {
  let parsed: any = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(got.bytes));
  } catch {
    /* the status says enough */
  }
  if (!got.ok) throw new Error(`gdrive answered ${got.status} for ${what}${parsed?.error?.message ? `: ${String(parsed.error.message).slice(0, 200)}` : ""}`);
  return parsed;
}

/** A bilag from Drive into Dinero's archive, and the attaching of it to a payment's card asked of you. */
export async function attachBilag(deps: BooksDeps, input: BooksAttach): Promise<BooksAttached> {
  const id = encodeURIComponent(input.file);
  const meta = json(await deps.transfer("gdrive", { method: "GET", path: `/drive/v3/files/${id}?fields=name,mimeType,size&supportsAllDrives=true`, class: "read", why: "the bilag to attach in Dinero", max: 1 << 20 }), "the bilag");
  if (typeof meta?.name !== "string") throw new Error("gdrive gave no file by that id");
  const got = await deps.transfer("gdrive", { method: "GET", path: `/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, class: "read", why: `the bytes of ${meta.name}, for Dinero`, max: BOOKS_MAX_BYTES });
  if (!got.ok) throw new Error(`gdrive answered ${got.status} for the bytes of ${meta.name}`);
  const bytes = got.bytes;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const up = await deps.handFile(
    BOOKS,
    "upload_file",
    { organizationId: input.organizationId, fileName: meta.name, base64Content: Buffer.from(bytes).toString("base64"), contentType: typeof meta.mimeType === "string" ? meta.mimeType : "application/pdf", expectedByteLength: bytes.length, sha256 },
    `a bilag into Dinero's archive: ${meta.name}, ${bytes.length} bytes, SHA-256 ${sha256.slice(0, 12)}`,
  );
  if (!up.ok) throw new Error(`Dinero didn't take ${meta.name}: ${up.body.slice(0, 300)}`);
  const fileGuid = fileGuidOf(up.body);
  if (!fileGuid) throw new Error(`Dinero took ${meta.name} but named no fileGuid for it: ${up.body.slice(0, 200)}`);
  const asked = await deps.ask({ connector: BOOKS, tool: "attach_file_to_voucher_card", args: { organizationId: input.organizationId, voucherGuid: input.card, fileGuid }, why: input.why });
  return { name: meta.name, bytes: bytes.length, sha256, fileGuid, action: asked.status === "asked" ? (asked.action ?? null) : null };
}
