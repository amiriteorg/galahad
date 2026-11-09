import { b64u, type NodeIdentity, OWNER_SCOPES, type Scope } from "@galahad/core";
import { MindStore } from "./store.ts";
import { Vault } from "./vault.ts";

/** Found a new fleet: genesis, self-enrollment as the first full node, first vault key. */
export function foundFleet(store: MindStore, identity: NodeIdentity, opts: { fleetName: string; nodeName: string }): string {
  if (store.fleet) throw new Error(`this replica already belongs to fleet ${store.fleet}`);
  const genesis = store.emit(identity, "fleet.genesis", { name: opts.fleetName, created: Date.now() });
  store.emit(identity, "device.enrolled", {
    device: identity.id,
    name: opts.nodeName,
    kind: "node",
    role: "full",
    box: b64u(identity.boxPublic),
    scopes: OWNER_SCOPES,
  });
  new Vault(store, identity).createKey();
  return genesis.id;
}

export interface EnrollInput {
  device: string;
  name: string;
  kind: "node" | "client";
  box?: string;
  scopes?: Scope[];
}

/** Enroll a paired device; full nodes also receive every vault key in use. */
export function enrollDevice(store: MindStore, approver: NodeIdentity, input: EnrollInput): void {
  store.emit(approver, "device.enrolled", {
    device: input.device,
    name: input.name,
    kind: input.kind,
    role: input.kind === "node" ? "full" : "client",
    ...(input.box ? { box: input.box } : {}),
    scopes: input.scopes ?? OWNER_SCOPES,
  });
  if (input.kind === "node") new Vault(store, approver).grantTo(input.device);
}

/** Revoke a device and rotate the vault so it can't read anything written afterwards. */
export function revokeDevice(store: MindStore, approver: NodeIdentity, device: string, reason: string) {
  const target = store.activeDevice(device);
  if (!target) throw new Error("unknown or already revoked device");
  store.emit(approver, "device.revoked", { device, reason });
  if (target.kind === "node") return new Vault(store, approver).rotate();
  return { kid: null, resealed: [] as string[] };
}

export { MindStore };
