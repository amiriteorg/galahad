import { z } from "zod";

/**
 * Environment, validated once at startup (the t3-env idea): a typo'd or
 * malformed variable fails loudly here instead of misbehaving later.
 */
const Env = z.object({
  GALAHAD_HOME: z.string().min(1).optional(),
  GALAHAD_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  /** Loopback port for `tailscale serve` (the HTTPS PWA); defaults to GALAHAD_PORT + 1. */
  GALAHAD_PROXY_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  /** "os" = OS keychain via Bun.secrets (default), "file" = 0600 key file (headless servers). */
  GALAHAD_KEYSTORE: z.enum(["os", "file"]).optional(),
  /** Override the tailnet address this node advertises and binds, e.g. 100.118.201.75. */
  GALAHAD_ADVERTISE: z.string().min(1).optional(),
  /** The sandbox workspace helper's socket (default /run/galahad-workspace.sock). */
  GALAHAD_WORKSPACE_SOCKET: z.string().startsWith("/").optional(),
  /** Where the archive keeps its files (default <home>/archive); an absolute path the node's user may write. */
  GALAHAD_ARCHIVE_DIR: z
    .string()
    .refine((p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p), "an absolute path")
    .optional(),
  /** off: the archive keeps what it has and serves it, but pulls, embeds and summarises nothing new. */
  GALAHAD_ARCHIVE: z.enum(["on", "off"]).optional(),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`invalid Galahad environment:\n${issues}`);
  }
  return parsed.data;
}
