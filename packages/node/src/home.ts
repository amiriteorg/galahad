import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { exportIdentity, importIdentity, newNodeIdentity, type NodeIdentity, randomId } from "@galahad/core";
import { z } from "zod";
import { loadEnv } from "./env.ts";

/*
 * ~/.galahad/
 *   config.json   node name, fleet id, port, keystore choice
 *   mind.db       this node's replica of the mind (the log + views)
 *   local.db      node-local state that never replicates (gateway tokens)
 *   admin.token   local CLI credential (0600)
 *   keys.json     device private keys, only when the OS keychain is unavailable (0600)
 */

const Config = z.strictObject({
  v: z.literal(1),
  name: z.string().min(1).max(64),
  fleet: z.string().nullable(),
  port: z.number().int(),
  keystore: z.enum(["os", "file"]),
  /** Address this node advertises to peers (normally its tailnet IP). */
  advertise: z.string().nullable(),
});
export type NodeConfig = z.infer<typeof Config>;

const KEYCHAIN_SERVICE = "dev.galahad.node";

export class Home {
  readonly configPath: string;
  readonly mindPath: string;
  readonly localPath: string;
  readonly adminTokenPath: string;
  readonly keyFilePath: string;

  constructor(readonly dir: string) {
    this.configPath = join(dir, "config.json");
    this.mindPath = join(dir, "mind.db");
    this.localPath = join(dir, "local.db");
    this.adminTokenPath = join(dir, "admin.token");
    this.keyFilePath = join(dir, "keys.json");
  }

  static resolve(dir?: string): Home {
    return new Home(resolve(dir ?? loadEnv().GALAHAD_HOME ?? join(homedir(), ".galahad")));
  }

  exists(): boolean {
    return existsSync(this.configPath);
  }

  ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  readConfig(): NodeConfig {
    if (!this.exists()) throw new Error(`no Galahad node at ${this.dir} — run \`galahad init\` or \`galahad join\``);
    return Config.parse(JSON.parse(readFileSync(this.configPath, "utf8")));
  }

  writeConfig(config: NodeConfig): void {
    this.ensureDir();
    writeFileSync(this.configPath, `${JSON.stringify(Config.parse(config), null, 2)}\n`, { mode: 0o600 });
  }

  // ---- device keys ---------------------------------------------------------

  async createIdentity(keystore: "os" | "file"): Promise<{ identity: NodeIdentity; keystore: "os" | "file" }> {
    this.ensureDir();
    const identity = newNodeIdentity();
    const serialized = exportIdentity(identity);
    if (keystore === "os") {
      try {
        await Bun.secrets.set({ service: KEYCHAIN_SERVICE, name: this.dir, value: serialized });
        return { identity, keystore: "os" };
      } catch {
        // Headless Linux without a Secret Service, for example: fall back to a 0600 file.
      }
    }
    writeSecretFile(this.keyFilePath, serialized);
    return { identity, keystore: "file" };
  }

  async loadIdentity(keystore: "os" | "file"): Promise<NodeIdentity> {
    const serialized =
      keystore === "os"
        ? await Bun.secrets.get({ service: KEYCHAIN_SERVICE, name: this.dir })
        : existsSync(this.keyFilePath)
          ? readFileSync(this.keyFilePath, "utf8")
          : null;
    if (!serialized) throw new Error(`device keys not found in the ${keystore} keystore for ${this.dir}`);
    return importIdentity(serialized);
  }

  // ---- local admin credential ---------------------------------------------

  adminToken(): string {
    if (existsSync(this.adminTokenPath)) return readFileSync(this.adminTokenPath, "utf8").trim();
    const token = `adm_${randomId(32)}`;
    writeSecretFile(this.adminTokenPath, token);
    return token;
  }
}

function writeSecretFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows: the user profile ACL already restricts access */
  }
}
