import { z } from "zod";
import { canonical, type Json } from "./canonical.ts";
import { b64u, fromB64u } from "./bytes.ts";
import { sha256B64u } from "./crypto.ts";
import { isHlc } from "./hlc.ts";
import { type DeviceId, domain, isNodeId, type NodeIdentity, verifyDeviceSignature } from "./identity.ts";
import { Scope } from "./scopes.ts";

/*
 * The mind is an append-only log of these events. Each event is content-addressed
 * (id = sha256 of its canonical unsigned form) and signed by the node that wrote it,
 * so applying it twice is a no-op and nobody can alter it in transit.
 */

const B64 = z.string().regex(/^[A-Za-z0-9_-]+$/).max(8192);
const Name = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "letters, digits and . _ : - only");
const DeviceRef = z.string().regex(/^[nc]_[A-Za-z0-9_-]{43,87}$/);
const SealedBoxSchema = z.strictObject({ eph: B64, nonce: B64, ct: B64 });

export const Trust = z.enum(["owner", "agent", "untrusted"]);
export type Trust = z.infer<typeof Trust>;

/** Provenance: who caused this event and how much to trust its content. */
export const Prov = z.strictObject({
  via: DeviceRef.optional(),
  trust: Trust,
  source: z.string().max(2048).optional(),
});
export type Prov = z.infer<typeof Prov>;

export const SecretMeta = z.strictObject({
  provider: Name.optional(),
  hint: z.string().max(16).optional(),
  label: z.string().max(128).optional(),
  /** The only origin this key is ever sent to; set when you enter it. A repointed provider gets nothing. */
  origin: z
    .string()
    .max(256)
    .regex(/^https?:\/\/[^/?#]+$/)
    .optional(),
});

export const Bodies = {
  "fleet.genesis": z.strictObject({ name: z.string().min(1).max(64), created: z.number().int() }),
  "device.enrolled": z.strictObject({
    device: DeviceRef,
    name: z.string().min(1).max(64),
    kind: z.enum(["node", "client"]),
    role: z.enum(["full", "limited", "client"]),
    box: B64.optional(),
    scopes: z.array(Scope).max(32),
  }),
  "device.revoked": z.strictObject({ device: DeviceRef, reason: z.string().max(500) }),
  "vault.key": z.strictObject({ kid: B64, grants: z.record(z.string(), SealedBoxSchema) }),
  "vault.grant": z.strictObject({ kid: B64, device: DeviceRef, box: SealedBoxSchema }),
  "secret.set": z.strictObject({ name: Name, kid: B64, nonce: B64, ct: B64, meta: SecretMeta }),
  "secret.deleted": z.strictObject({ name: Name }),
  /** Galahad asks you for a credential; you fill it in the vault, he never sees it. */
  "secret.requested": z.strictObject({
    name: Name,
    provider: Name.optional(),
    purpose: z.string().min(1).max(500),
  }),
  "memory.added": z.strictObject({
    text: z.string().min(1).max(20_000),
    tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  }),
  "memory.forgotten": z.strictObject({ memory: B64 }),
  "node.profile": z.strictObject({
    endpoint: z.string().url().max(512).optional(),
    caps: z.record(z.string(), z.unknown()),
  }),
  "provider.set": z.strictObject({
    id: Name,
    kind: z.enum(["openai", "anthropic"]),
    baseUrl: z.string().url().max(512),
    secret: Name.optional(),
    label: z.string().max(128).optional(),
  }),
  "provider.removed": z.strictObject({ id: Name }),
  /** The ledger: every gated action, its verdict and why. Signed and replicated like everything else. */
  "ledger.recorded": z.strictObject({
    class: z.enum(["read", "create", "modify", "outward", "delete", "forbidden"]),
    resource: z.string().min(1).max(64),
    target: z.string().min(1).max(256),
    verdict: z.enum(["allow", "ask", "deny", "approved"]),
    reason: z.string().max(500).optional(),
    quest: z.string().max(64).optional(),
    detail: z.string().max(2000).optional(),
  }),
  "roster.set": z.strictObject({ role: Name, models: z.array(z.string().min(1).max(256)).max(16) }),
} as const;

export type EventKind = keyof typeof Bodies;
export type BodyOf<K extends EventKind> = z.infer<(typeof Bodies)[K]>;
export const isKnownKind = (kind: string): kind is EventKind => Object.hasOwn(Bodies, kind);

export const MAX_EVENT_BYTES = 64 * 1024;

export const EventEnvelope = z.strictObject({
  v: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  /** Fleet id = id of the fleet.genesis event; empty only on the genesis event itself. */
  fleet: z.string().regex(/^([A-Za-z0-9_-]{43})?$/),
  hlc: z.string().refine(isHlc, "invalid hlc"),
  device: DeviceRef,
  kind: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/).max(64),
  body: z.unknown(),
  prov: Prov.optional(),
  sig: B64,
});
export type GEvent = z.infer<typeof EventEnvelope> & { body: Json };
export type UnsignedEvent = Omit<GEvent, "id" | "sig">;

export const unsignedOf = (event: GEvent): UnsignedEvent => {
  const { id: _id, sig: _sig, ...rest } = event;
  return rest;
};

export const eventId = (unsigned: UnsignedEvent): string => sha256B64u(canonical(unsigned));
const signingInput = (id: string) => domain("galahad-event/v1", id);

export function signEvent(unsigned: UnsignedEvent, signer: NodeIdentity): GEvent {
  if (unsigned.device !== signer.id) throw new Error("event device must be the signer");
  const id = eventId(unsigned);
  const sig = signer.sign(signingInput(id));
  return { ...unsigned, id, sig: b64u(sig) };
}

/** Structural parse + content-address check + signature check. Throws on any failure. */
export function parseEvent(raw: unknown): GEvent {
  const event = EventEnvelope.parse(raw) as GEvent;
  if (canonical(event).length > MAX_EVENT_BYTES) throw new Error("event too large");
  if (!isNodeId(event.device)) throw new Error("only nodes sign log events");
  if (eventId(unsignedOf(event)) !== event.id) throw new Error("event id does not match content");
  if (!verifyDeviceSignature(event.device as DeviceId, fromB64u(event.sig), signingInput(event.id))) {
    throw new Error("bad event signature");
  }
  if (isKnownKind(event.kind)) Bodies[event.kind].parse(event.body);
  return event;
}

export function bodyOf<K extends EventKind>(event: GEvent, kind: K): BodyOf<K> {
  return Bodies[kind].parse(event.body) as BodyOf<K>;
}

/** Total order used everywhere: (hlc, id). */
export const compareEvents = (a: { hlc: string; id: string }, b: { hlc: string; id: string }): number =>
  a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
