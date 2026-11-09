import { Database } from "bun:sqlite";
import { canonical, type NodeIdentity } from "@galahad/core";
import { GatewayTokens } from "@galahad/brain";
import { PairingHost, SyncEngine } from "@galahad/link";
import { MindStore, Vault } from "@galahad/mind";
import { buildAssets } from "./assets.ts";
import { type Capabilities, presence, probeCapabilities } from "./capabilities.ts";
import { loadEnv } from "./env.ts";
import type { Home } from "./home.ts";
import { createApp } from "./server.ts";

export interface Daemon {
  port: number;
  endpoint: string;
  identity: NodeIdentity;
  store: MindStore;
  sync: SyncEngine;
  stop(): Promise<void>;
}

export interface DaemonOptions {
  log?: (message: string) => void;
  syncIntervalMs?: number;
  /** Loopback port that `tailscale serve` proxies to (default: port + 1). */
  proxyPort?: number;
  /** Skip the (slow) hardware probe; used by tests. */
  capabilities?: Capabilities;
}

/** Publish this node's endpoint + capabilities, only when they changed (idempotent). */
function publishProfile(store: MindStore, identity: NodeIdentity, endpoint: string, caps: Capabilities): void {
  const body = { endpoint, caps: caps as unknown as Record<string, unknown> };
  const current = store.device(identity.id)?.profile;
  if (current && canonical(current) === canonical(body)) return;
  store.emit(identity, "node.profile", body);
}

export async function startDaemon(home: Home, opts: DaemonOptions = {}): Promise<Daemon> {
  const log = opts.log ?? ((message: string) => console.log(`[galahad] ${message}`));
  const env = loadEnv();
  const config = home.readConfig();
  if (!config.fleet) throw new Error("this node has not joined a fleet");
  const identity = await home.loadIdentity(config.keystore);
  const store = new MindStore(home.mindPath);
  store.expectFleet(config.fleet);
  if (!store.activeDevice(identity.id)) throw new Error("this node is not an active member of its fleet (revoked?)");
  const vault = new Vault(store, identity);
  const local = new Database(home.localPath, { create: true, strict: true });
  local.exec("PRAGMA journal_mode = WAL");
  const tokens = new GatewayTokens(local);

  const port = env.GALAHAD_PORT ?? config.port;
  let caps = opts.capabilities ?? (await probeCapabilities());
  const advertise = env.GALAHAD_ADVERTISE ?? config.advertise ?? caps.tailscale?.ip ?? "127.0.0.1";
  const endpoint = `http://${advertise}:${port}`;

  const sync = new SyncEngine(store, identity, { intervalMs: opts.syncIntervalMs, log });
  const stopPush = store.onEmit((event) => sync.push([event]));
  const pairing = new PairingHost(store, identity, endpoint);

  const app = createApp({
    identity,
    nodeName: config.name,
    port,
    store,
    vault,
    pairing,
    sync,
    tokens,
    adminToken: home.adminToken(),
    assets: await buildAssets(),
    caps: () => caps,
    presence,
    log,
  });

  // Loopback: the CLI and the local model gateway (local processes only).
  // Proxied: what `tailscale serve` forwards to (the HTTPS PWA) — remote traffic, so no
  //   admin token and no gateway, even though it arrives from 127.0.0.1.
  // Tailnet: node-to-node link traffic. Never 0.0.0.0.
  const proxyPort = opts.proxyPort ?? env.GALAHAD_PROXY_PORT ?? port + 1;
  const servers = [
    Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 255, fetch: (req) => app(req, "loopback") }),
    Bun.serve({ hostname: "127.0.0.1", port: proxyPort, idleTimeout: 255, fetch: (req) => app(req, "proxied") }),
  ];
  if (advertise !== "127.0.0.1") {
    servers.push(Bun.serve({ hostname: advertise, port, idleTimeout: 255, fetch: (req) => app(req, "tailnet") }));
  }
  // Advertise the endpoint only once we are actually listening on it.
  publishProfile(store, identity, endpoint, caps);
  sync.start();
  const refresh = opts.capabilities
    ? null
    : setInterval(async () => {
        caps = await probeCapabilities();
        publishProfile(store, identity, endpoint, caps);
      }, 5 * 60_000);

  log(`node ${config.name} up · fleet ${store.genesis?.name} · ${endpoint} · vault ${vault.unlocked() ? "unlocked" : "locked"}`);
  return {
    port,
    endpoint,
    identity,
    store,
    sync,
    async stop() {
      if (refresh) clearInterval(refresh);
      stopPush();
      sync.stop();
      await Promise.all(servers.map((s) => s.stop(true)));
      local.close();
      store.close();
    },
  };
}
