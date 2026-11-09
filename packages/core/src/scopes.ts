import { z } from "zod";

/**
 * Per-method authorization. Authenticating a request does not authorize every
 * method; each route names the one scope it needs and the server checks it at
 * execution time. No scope ever exposes a secret's plaintext to a client.
 */
export const SCOPES = [
  "mind:read",
  "mind:write",
  "chat",
  "vault:read", // secret names + metadata only
  "vault:write", // add / replace / delete / rotate
  "brain:write", // providers + roster
  "gateway:mint", // mint scoped model-gateway tokens for arms
  "fleet:admin", // invite, approve, revoke devices
] as const;

export const Scope = z.enum(SCOPES);
export type Scope = z.infer<typeof Scope>;

export const OWNER_SCOPES: Scope[] = [...SCOPES];
