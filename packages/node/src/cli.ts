#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { b64u, type ChatStreamEvent, decodeInvite, type FleetView, type RouteName, routes } from "@galahad/core";
import { detectProvider, preset, sseData } from "@galahad/brain";
import { requestPairing, signedPost, type SyncPage, waitForApproval } from "@galahad/link";
import { foundFleet, MindStore } from "@galahad/mind";
import { tailscaleInfo } from "./capabilities.ts";
import { startDaemon } from "./daemon.ts";
import { loadEnv } from "./env.ts";
import { Home } from "./home.ts";
import { streamedError } from "./server.ts";

const HELP = `galahad — one mind, many bodies

Set up
  init [--name laptop] [--fleet camelot] [--port 7777]     found a fleet on this machine
  join <invite> [--name server] [--port 7777]              join a fleet with an invite
  serve                                                    run this node (daemon)
  expose [--https 443]                                     publish the PWA over HTTPS on your tailnet (tailscale serve)
  invite [--client] [--origin https://host.ts.net]         add a device (prints an invite, then asks you to approve)
  pairings | approve <invite> <device> | reject <invite> <device>
  revoke <device> [--reason text]
  status                                                   fleet, peers, capabilities

Mind
  remember <text> [--tag t]      recall [query]

Keys & models (keys are typed into a hidden prompt — never into chat, never on the command line)
  key add [--provider id]        paste any API key; provider is auto-detected when possible
  secret set <name> | secret list | secret rm <name> | vault rotate
  secret request <name> --reason "…"   ask for a credential; fill it later from any device
  run [--providers a,b] -- <cmd>  run a tool (opencode, claude, codex…) on a scoped gateway token
  provider add <id> [--preset p] [--base-url url] [--kind openai|anthropic] [--secret name]
  provider list | provider models <id> | provider presets
  roster | roster set <role> <provider/model>...
  ask [--role planner] [--model provider/model] <prompt>
  token mint --label opencode [--providers deepseek,anthropic] [--ttl 60] [--max 1000]

Work
  place [--docker] [--vm] [--gpu] [--mem 16] [--tools git,opencode] [--long] [--untrusted] [--interactive]
  sandbox run [--on ultra] [--net gateway|online|isolated] [--cpus 4] [--mem 8] [--ttl 120]
              [--providers deepseek,anthropic] [--image img] [--timeout 600] [--keep] -- <command…>
  sandbox ls [--on ultra] | sandbox exec <id> [--on ultra] -- <command…> | sandbox rm <id> [--on ultra]
  sandbox build [--on ultra]      build the sandbox image on a host
  ledger [--limit 30]             what Galahad did, and the oath's verdict on each action

Maintenance
  rebuild                         re-materialize the mind from its log and verify the digest

Options: --home <dir> (or GALAHAD_HOME), GALAHAD_PORT, GALAHAD_KEYSTORE=os|file, GALAHAD_ADVERTISE=<tailnet ip>`;

const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

function fail(message: string): never {
  console.error(`galahad: ${message}`);
  process.exit(1);
}

/** Thrown (never `process.exit`) so `finally` blocks, like sandbox cleanup, always run. */
class CliError extends Error {}

class Admin {
  readonly base: string;
  private readonly token: string;

  constructor(home: Home) {
    const config = home.readConfig();
    this.base = `http://127.0.0.1:${loadEnv().GALAHAD_PORT ?? config.port}`;
    this.token = home.adminToken();
  }

  private async request(name: RouteName, input?: unknown): Promise<Response> {
    const route = routes[name];
    let response: Response;
    try {
      response = await fetch(`${this.base}${route.path}`, {
        method: route.method,
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
      });
    } catch {
      throw new CliError(`no daemon on ${this.base} — start it with \`galahad serve\``);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string; issues?: unknown };
      throw new CliError(`${body.error ?? response.statusText}${body.issues ? ` ${JSON.stringify(body.issues)}` : ""}`);
    }
    return response;
  }

  async call<T = any>(name: RouteName, input?: unknown): Promise<T> {
    const body = await (await this.request(name, input)).json();
    const failed = streamedError(body);
    if (failed) throw new CliError(failed.error);
    return body as T;
  }

  async *stream(name: RouteName, input: unknown): AsyncGenerator<ChatStreamEvent> {
    const response = await this.request(name, input);
    for await (const data of sseData(response.body!)) yield JSON.parse(data) as ChatStreamEvent;
  }
}

async function readSecret(promptText: string): Promise<string> {
  if (!process.stdin.isTTY) return (await Bun.stdin.text()).trim();
  process.stdout.write(promptText);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

function confirm(question: string): boolean {
  const answer = prompt(`${question} [y/N]`);
  return /^y(es)?$/i.test(answer?.trim() ?? "");
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const { values: flags, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      home: { type: "string" },
      name: { type: "string" },
      fleet: { type: "string" },
      port: { type: "string" },
      https: { type: "string" },
      keystore: { type: "string" },
      advertise: { type: "string" },
      client: { type: "boolean" },
      origin: { type: "string" },
      provider: { type: "string" },
      preset: { type: "string" },
      "base-url": { type: "string" },
      kind: { type: "string" },
      secret: { type: "string" },
      label: { type: "string" },
      role: { type: "string" },
      model: { type: "string" },
      tag: { type: "string", multiple: true },
      reason: { type: "string" },
      providers: { type: "string" },
      ttl: { type: "string" },
      max: { type: "string" },
      docker: { type: "boolean" },
      vm: { type: "boolean" },
      gpu: { type: "boolean" },
      mem: { type: "string" },
      tools: { type: "string" },
      long: { type: "boolean" },
      untrusted: { type: "boolean" },
      interactive: { type: "boolean" },
      "no-wait": { type: "boolean" },
      on: { type: "string" },
      net: { type: "string" },
      cpus: { type: "string" },
      image: { type: "string" },
      keep: { type: "boolean" },
      limit: { type: "string" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, sub, ...rest] = positionals;
  const home = Home.resolve(flags.home as string | undefined);
  const str = (key: string) => flags[key] as string | undefined;

  if (!command || flags.help || command === "help") {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "init": {
      if (home.exists()) fail(`a node already exists at ${home.dir}`);
      const nodeName = str("name") ?? (await import("node:os")).hostname().toLowerCase();
      const keystorePref = (str("keystore") ?? loadEnv().GALAHAD_KEYSTORE ?? "os") as "os" | "file";
      const { identity, keystore } = await home.createIdentity(keystorePref);
      const store = new MindStore(home.mindPath);
      const fleet = foundFleet(store, identity, { fleetName: str("fleet") ?? "camelot", nodeName });
      store.close();
      home.writeConfig({ v: 1, name: nodeName, fleet, port: Number(str("port") ?? 7777), keystore, advertise: str("advertise") ?? null });
      home.adminToken();
      console.log(`${bold("A new fleet is founded.")}
  fleet   ${fleet}
  node    ${nodeName} (${identity.id.slice(0, 12)}…)
  keys    ${keystore === "os" ? "OS keychain" : `${home.keyFilePath} (0600)`}
  home    ${home.dir}

Next:
  galahad serve                 start this node
  galahad expose                serve the PWA at https://<this-machine>.<tailnet>.ts.net
  galahad invite --client       pair your phone or browser
  galahad invite                add another machine (then run \`galahad join <invite>\` there)
  galahad key add               paste an API key`);
      return;
    }

    case "join": {
      if (!sub) fail("usage: galahad join <invite>");
      if (home.exists()) fail(`a node already exists at ${home.dir}`);
      const invite = decodeInvite(sub);
      if (invite.k !== "node") fail("that invite is for a client; open it in a browser instead");
      const nodeName = str("name") ?? (await import("node:os")).hostname().toLowerCase();
      const port = Number(str("port") ?? loadEnv().GALAHAD_PORT ?? 7777);
      const keystorePref = (str("keystore") ?? loadEnv().GALAHAD_KEYSTORE ?? "os") as "os" | "file";
      const advertise = str("advertise") ?? loadEnv().GALAHAD_ADVERTISE ?? (await tailscaleInfo())?.ip ?? "127.0.0.1";
      const { identity, keystore } = await home.createIdentity(keystorePref);
      const join = await requestPairing(sub, {
        device: identity.id,
        name: nodeName,
        kind: "node",
        box: b64u(identity.boxPublic),
        endpoint: `http://${advertise}:${port}`,
      });
      console.log(`\n  Confirmation code:  ${bold(join.sas)}\n\n  Approve on the inviting node if it shows the same code. Waiting…`);
      const { fleet } = await waitForApproval(join);
      const store = new MindStore(home.mindPath);
      store.expectFleet(fleet);
      for (let page = 0; page < 1000; page++) {
        const result = await signedPost<SyncPage>(identity, invite.e, "/link/sync", { have: store.frontier() });
        store.ingest(result.events);
        if (!result.more) break;
      }
      if (!store.activeDevice(identity.id)) fail("synced, but this node is not enrolled; ask the inviter to retry");
      const fleetName = store.genesis?.name;
      store.close();
      home.writeConfig({ v: 1, name: nodeName, fleet, port, keystore, advertise: str("advertise") ?? null });
      home.adminToken();
      console.log(`\n${bold(`Joined fleet ${fleetName}.`)} The vault and the mind are now shared. Start this node with \`galahad serve\`.`);
      return;
    }

    case "serve":
    case "start": {
      const daemon = await startDaemon(home);
      const shutdown = async () => {
        await daemon.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return;
    }

    case "expose": {
      const config = home.readConfig();
      const ts = await tailscaleInfo();
      if (!ts) fail("tailscale is not running");
      const env = loadEnv();
      const proxyPort = env.GALAHAD_PROXY_PORT ?? (env.GALAHAD_PORT ?? config.port) + 1;
      const https = str("https") ?? "443";
      const proc = Bun.spawn(["tailscale", "serve", "--bg", `--https=${https}`, `http://127.0.0.1:${proxyPort}`], {
        stdout: "inherit",
        stderr: "inherit",
      });
      if ((await proc.exited) !== 0) fail("tailscale serve failed (is HTTPS enabled for your tailnet?)");
      console.log(`PWA: https://${ts.dnsName}${https === "443" ? "" : `:${https}`}/  (tailnet only)`);
      return;
    }

    case "invite": {
      const admin = new Admin(home);
      const kind = flags.client ? "client" : "node";
      let origin = str("origin");
      if (kind === "client" && !origin) {
        const ts = await tailscaleInfo();
        origin = ts?.dnsName ? `https://${ts.dnsName}` : admin.base;
      }
      const created = await admin.call<{ invite: string; url: string | null; expiresAt: number; id: string }>("createInvite", {
        kind,
        ...(origin ? { origin } : {}),
      });
      console.log(
        kind === "client"
          ? `Open this on the device you're adding (valid 10 minutes, single use):\n\n  ${created.url}\n`
          : `On the new machine run (valid 10 minutes, single use):\n\n  galahad join ${created.invite}\n`,
      );
      if (flags["no-wait"]) return;
      console.log(dim("Waiting for the device…"));
      const deadline = created.expiresAt;
      while (Date.now() < deadline) {
        const { pairings } = await admin.call<{ pairings: { invite: string; device: string; name: string; kind: string; sas: string; conflict: boolean }[] }>(
          "pairings",
        );
        const pending = pairings.find((p) => p.invite === created.id);
        if (pending) {
          console.log(`\n  ${bold(pending.name)} (${pending.kind}) wants to join.\n  Code: ${bold(pending.sas)}\n`);
          if (confirm("Does the new device show exactly this code?")) {
            await admin.call("approvePairing", { invite: pending.invite, device: pending.device });
            console.log("Approved. Welcome to the fleet.");
          } else {
            await admin.call("rejectPairing", { invite: pending.invite, device: pending.device });
            console.log("Rejected.");
          }
          return;
        }
        await Bun.sleep(1000);
      }
      fail("invite expired");
    }

    case "pairings": {
      const { pairings } = await new Admin(home).call("pairings");
      if (!pairings.length) console.log("No pending pairings.");
      for (const p of pairings) console.log(`${p.sas}  ${p.name} (${p.kind})  invite=${p.invite} device=${p.device}${p.conflict ? "  ⚠ conflict" : ""}`);
      return;
    }
    case "approve":
    case "reject": {
      if (!sub || !rest[0]) fail(`usage: galahad ${command} <invite> <device>`);
      await new Admin(home).call(command === "approve" ? "approvePairing" : "rejectPairing", { invite: sub, device: rest[0] });
      console.log(command === "approve" ? "Approved." : "Rejected.");
      return;
    }
    case "revoke": {
      if (!sub) fail("usage: galahad revoke <device>");
      const fleet = await new Admin(home).call<FleetView>("fleet");
      const target = fleet.devices.find((d) => d.id === sub || d.name === sub || d.id.startsWith(sub));
      if (!target) fail(`no device matches ${sub}`);
      if (!confirm(`Revoke ${target.name} (${target.kind})? This rotates the vault.`)) return;
      const result = await new Admin(home).call("revokeDevice", { device: target.id, reason: str("reason") });
      console.log(`Revoked ${target.name}.`);
      if (result.resealed?.length) {
        console.log(`Vault rotated. ${target.name} could read these before; rotate them at the provider too:\n  ${result.resealed.join("\n  ")}`);
      }
      return;
    }

    case "status": {
      const fleet = await new Admin(home).call<FleetView>("fleet");
      const peers = new Map(fleet.peers.map((p) => [p.device, p]));
      console.log(`${bold(`Fleet ${fleet.name}`)}  ${dim(fleet.fleet.slice(0, 12))}  events=${fleet.events}  digest=${fleet.digest.slice(0, 10)}`);
      for (const d of fleet.devices) {
        const caps = d.caps as Record<string, any> | null;
        const peer = peers.get(d.id);
        const state = d.revokedAt ? "revoked" : d.id === fleet.self ? "this node" : d.kind === "client" ? "client" : peer?.online ? `online ${peer.rttMs}ms` : "offline";
        const summary = caps
          ? `${caps.os}/${caps.arch} ${caps.cores}c ${caps.memoryGb}GB${caps.gpu?.length ? ` gpu:${caps.gpu[0].name}` : ""}${caps.docker ? " docker" : ""}${caps.vm?.kvm ? " kvm" : ""}${caps.localModels?.some((r: any) => r.models.length) ? " local-ai" : ""}`
          : "";
        console.log(`  ${d.name.padEnd(18)} ${d.kind.padEnd(6)} ${state.padEnd(14)} ${dim(summary)}`);
      }
      return;
    }

    case "remember": {
      const text = [sub, ...rest].filter(Boolean).join(" ");
      if (!text) fail("usage: galahad remember <text>");
      await new Admin(home).call("remember", { text, tags: flags.tag as string[] | undefined });
      console.log("Remembered.");
      return;
    }
    case "recall": {
      const q = [sub, ...rest].filter(Boolean).join(" ");
      const { memories } = await new Admin(home).call("recall", { q: q || undefined, limit: 20 });
      if (!memories.length) console.log("Nothing remembered yet.");
      for (const m of memories) console.log(`• ${m.text}${m.tags.length ? dim(`  #${m.tags.join(" #")}`) : ""}${m.trust !== "owner" ? dim(`  [${m.trust}]`) : ""}`);
      return;
    }

    case "key": {
      if (sub !== "add") fail("usage: galahad key add [--provider id]");
      const value = await readSecret("Paste the API key (hidden): ");
      if (!value) fail("no key given");
      const providerId = str("provider") ?? detectProvider(value);
      if (!providerId) fail("couldn't tell which provider this key is for; pass --provider <id> (see `galahad provider presets`)");
      const admin = new Admin(home);
      const secretName = str("secret") ?? providerId;
      await admin.call("setSecret", { name: secretName, value, provider: providerId });
      const known = preset(providerId);
      const baseUrl = str("base-url") ?? known?.baseUrl;
      if (!baseUrl) {
        console.log(`Key stored as "${secretName}". ${known?.note ?? "Now add the provider with --base-url."}`);
        return;
      }
      await admin.call("setProvider", { id: providerId, baseUrl, kind: (str("kind") ?? known?.kind) as any, secret: secretName });
      console.log(`Key stored and provider "${providerId}" configured. Every full node can now use it.`);
      return;
    }

    case "secret": {
      const admin = new Admin(home);
      if (sub === "set") {
        if (!rest[0]) fail("usage: galahad secret set <name>");
        const value = await readSecret(`Value for ${rest[0]} (hidden): `);
        await admin.call("setSecret", { name: rest[0], value, provider: str("provider"), label: str("label") });
        console.log("Sealed into the vault.");
      } else if (sub === "rm") {
        if (!rest[0]) fail("usage: galahad secret rm <name>");
        if (!confirm(`Delete secret ${rest[0]} from every node?`)) return;
        await admin.call("deleteSecret", { name: rest[0] });
        console.log("Deleted.");
      } else if (sub === "request") {
        if (!rest[0] || !str("reason")) fail('usage: galahad secret request <name> --reason "what it is for" [--provider id]');
        await admin.call("requestSecret", { name: rest[0], purpose: str("reason"), provider: str("provider") });
        console.log(`Requested. Fill it with \`galahad secret set ${rest[0]}\` or on the PWA's Vault page.`);
      } else {
        const [{ secrets, unlocked }, { requests }] = await Promise.all([admin.call("secrets"), admin.call("secretRequests")]);
        if (!unlocked) console.log(dim("(this node cannot decrypt the vault)"));
        for (const s of secrets) console.log(`  ${s.name.padEnd(20)} ${(s.provider ?? "").padEnd(14)} ${s.hint ?? ""}`);
        if (!secrets.length) console.log("The vault is empty. `galahad key add` to add one.");
        for (const r of requests) console.log(`  ${bold("requested")} ${r.name.padEnd(20)} ${dim(r.purpose)}`);
      }
      return;
    }

    case "run": {
      // galahad run [--providers deepseek,anthropic] [--ttl 120] -- opencode …
      const cmd = [sub, ...rest].filter((part): part is string => typeof part === "string");
      if (!cmd.length) fail("usage: galahad run [--providers a,b] [--ttl minutes] -- <command> [args…]");
      const admin = new Admin(home);
      const providers = str("providers")?.split(",").filter(Boolean);
      const minted = await admin.call<{ token: string; info: { hash: string } }>("mintToken", {
        label: `run:${cmd[0]}`,
        ...(providers ? { providers } : {}),
        ttlMinutes: Number(str("ttl") ?? 240),
        maxRequests: Number(str("max") ?? 100_000),
      });
      const gateway = `${admin.base}/gw`;
      const openaiProvider = providers?.find((p) => p !== "anthropic") ?? "deepseek";
      const env: Record<string, string | undefined> = {
        ...process.env,
        GALAHAD_GATEWAY: gateway,
        ANTHROPIC_BASE_URL: `${gateway}/anthropic`,
        ANTHROPIC_AUTH_TOKEN: minted.token,
        OPENAI_BASE_URL: `${gateway}/${openaiProvider}`,
        OPENAI_API_KEY: minted.token,
      };
      delete env.ANTHROPIC_API_KEY;
      process.stderr.write(dim(`[galahad] ${cmd[0]} gets a scoped gateway token (revoked on exit); real keys stay in the vault\n`));
      const child = Bun.spawn(cmd, { env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      const code = await child.exited;
      await admin.call("revokeToken", { hash: minted.info.hash });
      process.exit(code);
    }
    case "vault": {
      if (sub !== "rotate") fail("usage: galahad vault rotate");
      const result = await new Admin(home).call("rotateVault", {});
      console.log(`New vault key ${result.kid}; resealed ${result.resealed.length} secrets.`);
      return;
    }

    case "provider": {
      const admin = new Admin(home);
      if (sub === "add") {
        if (!rest[0]) fail("usage: galahad provider add <id>");
        await admin.call("setProvider", {
          id: rest[0],
          preset: str("preset"),
          baseUrl: str("base-url"),
          kind: str("kind"),
          secret: str("secret") ?? rest[0],
          label: str("label"),
        });
        console.log(`Provider ${rest[0]} configured.`);
      } else if (sub === "models") {
        if (!rest[0]) fail("usage: galahad provider models <id>");
        const { models } = await admin.call("providerModels", { id: rest[0] });
        for (const m of models) console.log(`${rest[0]}/${m}`);
      } else if (sub === "presets") {
        const { presets } = await admin.call("providers");
        for (const p of presets) console.log(`  ${p.id.padEnd(14)} ${p.kind.padEnd(10)} ${p.baseUrl || dim(p.note ?? "")}`);
      } else {
        const { providers } = await admin.call("providers");
        if (!providers.length) console.log("No providers yet. `galahad key add` configures one.");
        for (const p of providers) console.log(`  ${p.id.padEnd(14)} ${p.kind.padEnd(10)} ${p.hasKey ? "key ✓" : p.baseUrl.includes("127.0.0.1") ? "local" : "no key"}  ${dim(p.baseUrl)}`);
      }
      return;
    }

    case "roster": {
      const admin = new Admin(home);
      if (sub === "set") {
        if (!rest[0] || rest.length < 2) fail("usage: galahad roster set <role> <provider/model>...");
        await admin.call("setRoster", { role: rest[0], models: rest.slice(1) });
      }
      const { roster } = await admin.call("roster");
      for (const [role, spec] of Object.entries(roster as Record<string, { models: string[]; configured: boolean }>)) {
        console.log(`  ${role.padEnd(10)} ${spec.models.join(" → ")}${spec.configured ? "" : dim("  (default)")}`);
      }
      return;
    }

    case "ask": {
      const text = [sub, ...rest].filter(Boolean).join(" ");
      if (!text) fail("usage: galahad ask <prompt>");
      for await (const event of new Admin(home).stream("chat", {
        role: str("role"),
        model: str("model"),
        messages: [{ role: "user", content: text }],
      })) {
        if (event.type === "text") process.stdout.write(event.text);
        else if (event.type === "model") process.stderr.write(dim(`[${event.ref}]\n`));
        else if (event.type === "fallback") process.stderr.write(dim(`[skipped ${event.from}: ${event.error}]\n`));
        else if (event.type === "error") fail(event.error);
      }
      process.stdout.write("\n");
      return;
    }

    case "token": {
      if (sub !== "mint") fail("usage: galahad token mint --label <name>");
      const result = await new Admin(home).call("mintToken", {
        label: str("label") ?? "arm",
        providers: str("providers")?.split(",").filter(Boolean),
        ttlMinutes: Number(str("ttl") ?? 60),
        maxRequests: Number(str("max") ?? 1000),
      });
      console.log(`Gateway token (shown once): ${result.token}\n`);
      for (const [k, v] of Object.entries(result.env)) console.log(`  ${k}=${v}`);
      return;
    }

    case "place": {
      const result = await new Admin(home).call("place", {
        ...(flags.docker ? { docker: true } : {}),
        ...(flags.vm ? { vm: true } : {}),
        ...(flags.gpu ? { gpu: true } : {}),
        ...(str("mem") ? { minMemoryGb: Number(str("mem")) } : {}),
        ...(str("tools") ? { tools: str("tools")!.split(",") } : {}),
        ...(flags.long ? { longRunning: true } : {}),
        ...(flags.untrusted ? { untrusted: true } : {}),
        ...(flags.interactive ? { interactive: true } : {}),
      });
      for (const p of result.ranked) console.log(`  ${String(p.score).padStart(4)}  ${p.name.padEnd(18)} ${dim(p.reasons.join(", "))}`);
      for (const r of result.rejected) console.log(dim(`     ✗  ${r.name.padEnd(18)} ${r.reason}`));
      return;
    }

    case "sandbox": {
      const admin = new Admin(home);
      const on = str("on");
      const printResult = (r: { exitCode: number; stdout: string; stderr: string; durationMs: number; truncated: boolean }) => {
        if (r.stdout) process.stdout.write(r.stdout.endsWith("\n") ? r.stdout : `${r.stdout}\n`);
        if (r.stderr) process.stderr.write(r.stderr.endsWith("\n") ? r.stderr : `${r.stderr}\n`);
        process.stderr.write(dim(`[exit ${r.exitCode} · ${r.durationMs} ms${r.truncated ? " · output truncated" : ""}]\n`));
      };
      if (sub === "build") {
        console.log(dim("Building the sandbox image (first build takes a few minutes)…"));
        await admin.call("buildSandboxImage", { ...(on ? { on } : {}) });
        console.log("Sandbox image ready.");
        return;
      }
      if (sub === "ls") {
        const { node, sandboxes } = await admin.call("sandboxes", { ...(on ? { on } : {}) });
        if (!sandboxes.length) console.log(`No sandboxes on ${node}.`);
        for (const s of sandboxes) {
          const left = Math.max(0, Math.round((s.expiresAt - Date.now()) / 60_000));
          console.log(
            `  ${s.id}  ${s.status.padEnd(8)} ${s.network.padEnd(8)} ${String(s.cpus).padStart(3)} cpu ${String(s.memoryGb).padStart(4)} GB  ${s.ephemeral ? `${left} min left` : "persistent"}  ${dim(s.quest)}`,
          );
        }
        return;
      }
      if (sub === "exec") {
        const [id, ...cmd] = rest;
        if (!id || !cmd.length) fail("usage: galahad sandbox exec <id> [--on node] -- <command…>");
        const result = await admin.call("execSandbox", { id, cmd, ...(str("timeout") ? { timeoutSec: Number(str("timeout")) } : {}), ...(on ? { on } : {}) });
        printResult(result);
        process.exit(result.exitCode);
      }
      if (sub === "rm") {
        if (!rest[0]) fail("usage: galahad sandbox rm <id>");
        await admin.call("destroySandbox", { id: rest[0], ...(on ? { on } : {}) });
        console.log("Sandbox destroyed.");
        return;
      }
      if (sub === "run") {
        const cmd = rest;
        if (!cmd.length) fail("usage: galahad sandbox run [options] -- <command…>");
        const { sandbox } = await admin.call("createSandbox", {
          network: str("net") ?? "gateway",
          ...(str("cpus") ? { cpus: Number(str("cpus")) } : {}),
          ...(str("mem") ? { memoryGb: Number(str("mem")) } : {}),
          ...(str("ttl") ? { ttlMinutes: Number(str("ttl")) } : {}),
          ...(str("providers") ? { providers: str("providers")!.split(",").filter(Boolean) } : {}),
          ...(str("image") ? { image: str("image") } : {}),
          ...(on ? { on } : {}),
        });
        const where = on ?? "the best sandbox host";
        process.stderr.write(dim(`[sandbox ${sandbox.id} on ${where} · ${sandbox.network} · ${sandbox.cpus} cpu · ${sandbox.memoryGb} GB]\n`));
        let code = 1;
        try {
          const result = await admin.call("execSandbox", {
            id: sandbox.id,
            cmd,
            ...(str("timeout") ? { timeoutSec: Number(str("timeout")) } : {}),
            ...(on ? { on } : {}),
          });
          printResult(result);
          code = result.exitCode;
        } finally {
          if (flags.keep) process.stderr.write(dim(`[kept: galahad sandbox exec ${sandbox.id} -- …]\n`));
          else await admin.call("destroySandbox", { id: sandbox.id, ...(on ? { on } : {}) });
        }
        process.exit(code);
      }
      fail("usage: galahad sandbox run|ls|exec|rm|build — see `galahad help`");
    }

    case "ledger": {
      const { entries } = await new Admin(home).call("ledger");
      const limit = Number(str("limit") ?? 30);
      if (!entries.length) console.log("The ledger is empty.");
      for (const e of entries.slice(0, limit).reverse()) {
        const when = new Date(Number(e.hlc.slice(0, 15))).toLocaleString();
        const verdict = e.verdict === "allow" || e.verdict === "approved" ? e.verdict : bold(e.verdict);
        console.log(`  ${dim(when)}  ${e.class.padEnd(7)} ${verdict.padEnd(8)} ${e.resource} ${e.target}${e.detail ? dim(`  ${e.detail}`) : ""}`);
      }
      return;
    }

    case "rebuild": {
      const config = home.readConfig();
      const store = new MindStore(home.mindPath);
      store.expectFleet(config.fleet!);
      const before = store.digest();
      store.rebuild();
      const after = store.digest();
      console.log(before === after ? `Rebuilt ${store.eventCount()} events; state identical (${after.slice(0, 12)}).` : `State changed on rebuild: ${before} → ${after}`);
      store.close();
      return;
    }

    default:
      fail(`unknown command "${command}" — try \`galahad help\``);
  }
}

await main().catch((error: unknown) => {
  console.error(`galahad: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
