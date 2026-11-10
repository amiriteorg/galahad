import { z } from "zod";
import { canonical, type Json } from "./canonical.ts";
import { b64u, fromB64u } from "./bytes.ts";
import { sha256B64u } from "./crypto.ts";
import { isHlc } from "./hlc.ts";
import { type DeviceId, domain, isNodeId, type NodeIdentity, verifyDeviceSignature } from "./identity.ts";
import { Conclusion, InvestigationId, InvestigationStatus, PredictionOutcome } from "./investigations.ts";
import { OrderId, OrderTerms } from "./orders.ts";
import { Scope } from "./scopes.ts";
import { TrialId, TrialRecord } from "./trials.ts";

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

/** Loop names double as arm labels (`loop.<name>`), so they are lowercase. */
export const LoopName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,39}$/, "lowercase letters, digits, . _ - (max 40)");
export const ConnectorId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "lowercase letters, digits and - (max 40)");
export const NoticeKey = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/);
export const ActionId = z.string().regex(/^a_[A-Za-z0-9_-]{22}$/);
export const ArtifactId = z.string().regex(/^art_[A-Za-z0-9_-]{22}$/);
export const ArtifactFile = z.strictObject({
  path: z.string().min(1).max(512),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const LoopStatus = z.enum(["ok", "attention", "failed", "interrupted"]);
export const NoticeSeverity = z.enum(["info", "warn", "alert"]);
/**
 * Open-ended objects (a loop's task, a connector's manifest, a call's arguments)
 * stay loosely typed in the log, so what a newer node adds never makes an older
 * one refuse the event. The API and the runner validate them strictly.
 */
const Open = z.record(z.string(), z.unknown());

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
  "device.revoked": z.strictObject({
    device: DeviceRef,
    reason: z.string().max(500),
    /** The revoked device's chain head as the revoker saw it: nothing after it ever counts. */
    head: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .nullable()
      .optional(),
  }),
  /** Change what a paired client may do (full nodes are always owner-equivalent). */
  "device.scoped": z.strictObject({ device: DeviceRef, scopes: z.array(Scope).max(32) }),
  /** A legacy (v1) fleet adopts chains: exactly these unchained events stay valid, no others ever. */
  "fleet.chained": z.strictObject({ legacy: z.array(z.string().regex(/^[A-Za-z0-9_-]{43}$/)).max(1400) }),
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
  /** A loop: work Galahad does on a schedule, on one named node (LWW by name). */
  "loop.set": z.strictObject({
    name: LoopName,
    schedule: z.string().min(1).max(128),
    tz: z.string().max(64).optional(),
    /** The one node that runs it, so a loop never runs twice. */
    on: DeviceRef,
    enabled: z.boolean(),
    task: Open,
    label: z.string().max(128).optional(),
  }),
  "loop.removed": z.strictObject({ name: LoopName }),
  /** One run of a loop, recorded by the node that ran it. `slot` is the scheduled time (null when run by hand). */
  "loop.ran": z.strictObject({
    loop: LoopName,
    run: z.string().min(1).max(64),
    slot: z.number().int().nullable(),
    status: LoopStatus,
    started: z.number().int(),
    finished: z.number().int(),
    summary: z.string().max(2000),
  }),
  /** Something that needs your attention (LWW by key); the heartbeat raises and clears these. */
  "notice.raised": z.strictObject({
    key: NoticeKey,
    severity: NoticeSeverity,
    title: z.string().min(1).max(200),
    body: z.string().max(2000),
    source: z.string().min(1).max(64),
    /** The node whose body it concerns, when it is about one node (its disk, its vault). */
    node: DeviceRef.optional(),
    at: z.number().int(),
  }),
  "notice.cleared": z.strictObject({ key: NoticeKey }),
  /** You've seen it: it stays quiet until it changes. */
  "notice.dismissed": z.strictObject({ key: NoticeKey }),
  "connector.set": z.strictObject({ id: ConnectorId, manifest: Open }),
  "connector.removed": z.strictObject({ id: ConnectorId }),
  /** The outbox: an action the oath says to ask about, recorded before anything is sent. */
  "action.requested": z.strictObject({
    id: ActionId,
    connector: ConnectorId,
    tool: z.string().min(1).max(48),
    args: Open,
    class: z.enum(["read", "create", "modify", "outward", "delete"]),
    target: z.string().min(1).max(256),
    /** Who asked: an arm, a loop or a quest. */
    by: z.string().min(1).max(100),
    why: z.string().max(500).optional(),
    expires: z.number().int(),
  }),
  /** Your answer. The first decision stands; no answer before it expires means no. */
  "action.decided": z.strictObject({ id: ActionId, verdict: z.enum(["approved", "denied"]), note: z.string().max(500).optional() }),
  /** The receipt, written once by the node that asked, after it sent the request exactly once. */
  "action.done": z.strictObject({ id: ActionId, ok: z.boolean(), status: z.number().int().optional(), receipt: z.string().max(2000) }),
  /** A standing order: your answer in advance to calls that match it (see orders.ts). Immutable: revoke and sign anew. */
  "order.set": OrderTerms.extend({ id: OrderId }),
  "order.revoked": z.strictObject({ id: OrderId }),
  /** The node that filed an action records which order answered it; every replica checks the order covers it. */
  "order.applied": z.strictObject({ order: OrderId, action: ActionId }),
  /**
   * Work products kept from a sandbox (its /work/out): the files stay on the node that saved them
   * (the signer); the log records what they are, so any device can see and fetch them.
   */
  "artifact.saved": z.strictObject({
    id: ArtifactId,
    label: z.string().min(1).max(200),
    quest: z.string().max(64).optional(),
    sandbox: z.string().regex(/^[0-9a-f]{10}$/).optional(),
    bytes: z.number().int().min(0),
    count: z.number().int().min(0),
    /** As many as fit; the holding node keeps the full manifest. */
    files: z.array(ArtifactFile).max(200),
  }),
  /** Recorded by the node that held the files, once they're gone. */
  "artifact.removed": z.strictObject({ id: ArtifactId }),
  /**
   * A pre-registered investigation: recorded before anything runs and never changed.
   * `registration` is open in the log (newer nodes may add fields); `digest` pins it.
   */
  "investigation.registered": z.strictObject({
    id: InvestigationId,
    question: z.string().min(1).max(2000),
    registration: Open,
    digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
  /** How it ended, recorded once by the node that registered it. */
  "investigation.concluded": z.strictObject({
    id: InvestigationId,
    status: InvestigationStatus,
    conclusion: Conclusion.optional(),
    summary: z.string().max(4000),
    review: z.string().max(4000).optional(),
    artifact: ArtifactId.optional(),
    predictions: z.array(PredictionOutcome).max(16).optional(),
  }),
  /** A trial's score, recorded once by the node that ran it; every replica checks it follows from the numbers (trials.ts). */
  "trial.scored": TrialRecord.extend({ id: TrialId }),
} as const;

export type EventKind = keyof typeof Bodies;
export type BodyOf<K extends EventKind> = z.infer<(typeof Bodies)[K]>;
export const isKnownKind = (kind: string): kind is EventKind => Object.hasOwn(Bodies, kind);

export const MAX_EVENT_BYTES = 64 * 1024;

const EventIdRef = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/*
 * v1: legacy, unchained.
 * v2: chained. `prev` is the id of the same device's previous event (null for its
 *     first). A device's events form one hash chain; revocation pins its head, so a
 *     stolen key cannot add events "in the past", and a device that forks its own
 *     chain (equivocates) is detected by every replica.
 */
export const EventEnvelope = z.strictObject({
  v: z.union([z.literal(1), z.literal(2)]),
  id: EventIdRef,
  /** Fleet id = id of the fleet.genesis event; empty only on the genesis event itself. */
  fleet: z.string().regex(/^([A-Za-z0-9_-]{43})?$/),
  hlc: z.string().refine(isHlc, "invalid hlc"),
  device: DeviceRef,
  prev: EventIdRef.nullable().optional(),
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
  if (event.v === 2 && event.prev === undefined) throw new Error("v2 events must name their predecessor (prev)");
  if (event.v === 1 && event.prev !== undefined) throw new Error("v1 events cannot be chained");
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
