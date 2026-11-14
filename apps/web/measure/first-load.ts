#!/usr/bin/env bun
/*
 * What does opening the PWA cost? One measurement, the same for any checkout, so a change to the
 * app is shown with its number before and after.
 *
 *   bun apps/web/measure/first-load.ts                     this checkout
 *   bun apps/web/measure/first-load.ts --repo <checkout>   another one, measured the same way
 *     --runs 9      loads per page, profile and kind (the median is reported, with the fastest and slowest)
 *     --json <file> everything measured, as JSON
 *     --shots <dir> also screenshots: Chat (new, and a kept chat), Squires, a room, its work, Inbox, More, Overview and
 *                   Trials, 390 and 1280 px, light and dark
 *
 * It starts a throwaway node on loopback (a temp home, the file keystore, a stand-in Docker and
 * stand-in models: nothing leaves this machine, and ~/.galahad is never touched), fills it with a
 * few squires, a room, tasks and trials, a kept chat, a quest in hand and one thing that needs you,
 * pairs a headless Chrome with it through the real pairing page, and then opens pages the way a
 * browser does:
 *
 *   cold   nothing cached and no service worker: the first visit after pairing
 *   warm   the service worker holds the shell: every visit after that
 *
 * on two profiles: "laptop" (1280×800, this machine as it is) and "phone" (390×844, the processor
 * slowed 4×, 9 Mbit/s down, 1.5 up and 60 ms a request: an emulation, not a phone).
 *
 * What it reports, per page:
 *   paint    first contentful paint (the browser's own mark; the boot emblem, before any script)
 *   shell    the app's shell is in the page (the device key is read and the node has answered)
 *   usable   the page's own content has replaced every loading placeholder, and a frame was drawn
 *   blocked  time the main thread was held past 50 ms at a stretch, up to "usable"
 *   nodes    elements in the page at "usable"
 * and for the first visit: every request, with its bytes on the wire, each of the app's files as
 * the node sends it (raw, gzip, brotli), and where the main thread's time went (script, style,
 * layout, paint, parsing), from Chrome's own trace. For Squires it also says what the page costs
 * while nothing changes: main-thread time per second over ten seconds.
 *
 * Timings move with the machine's load: compare two checkouts measured one after the other, and
 * trust a difference only when the ranges don't overlap. Bytes, requests and nodes don't move.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const REPO = resolve(flag("repo") ?? join(dirname(fileURLToPath(import.meta.url)), "../../.."));
const RUNS = Math.max(1, Number(flag("runs") ?? 9));
const JSON_OUT = flag("json");
const SHOTS = flag("shots");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(CHROME)) throw new Error(`No Chrome at ${CHROME}. Set CHROME to a Chrome or Chromium binary.`);

// The node's key goes to a file in the temp home, never to the OS keychain.
process.env.GALAHAD_KEYSTORE = "file";
const tmp = mkdtempSync(join(tmpdir(), "galahad-web-measure-"));
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const freePort = (): number => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = s.port!;
  s.stop(true);
  return port;
};

// ---------- the browser, over the DevTools protocol (one connection, a session per target) ----------
interface CdpEvent {
  method: string;
  params: any;
  sessionId?: string;
}
class Chrome {
  private next = 0;
  private readonly waiting = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private constructor(
    private readonly ws: WebSocket,
    private readonly proc: ReturnType<typeof Bun.spawn>,
  ) {
    ws.addEventListener("message", (message) => {
      const m = JSON.parse(String(message.data));
      if (m.id === undefined) {
        for (const listener of this.listeners) listener(m);
        return;
      }
      const asked = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      if (m.error) asked?.reject(new Error(m.error.message));
      else asked?.resolve(m.result);
    });
  }
  static async launch(profile: string): Promise<Chrome> {
    const proc = Bun.spawn(
      [
        CHROME,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        // Never the macOS keychain: Chrome's own storage key comes from a mock one.
        "--use-mock-keychain",
        "--password-store=basic",
        "--hide-scrollbars",
        "--mute-audio",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        // No name but this machine's resolves: the browser can reach nothing else.
        "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost",
        `--user-data-dir=${profile}`,
        "--remote-debugging-port=0",
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) {
      proc.kill();
      throw new Error("Chrome never wrote down its DevTools port");
    }
    const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((done, fail) => {
      ws.addEventListener("open", () => done(), { once: true });
      ws.addEventListener("error", () => fail(new Error("no DevTools connection")), { once: true });
    });
    return new Chrome(ws, proc);
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(listener: (event: CdpEvent) => void): void {
    this.listeners.add(listener);
  }
  off(listener: (event: CdpEvent) => void): void {
    this.listeners.delete(listener);
  }
  /** Asked to close; ended by its own pid if it hasn't gone. */
  async close(): Promise<void> {
    await Promise.race([this.send("Browser.close").catch(() => {}), sleep(3000)]);
    if (!(await Promise.race([this.proc.exited.then(() => true), sleep(5000).then(() => false)]))) this.proc.kill();
  }
}

// ---------- what is measured ----------
// (The first is the page the app opens on: its first visit is the one whose requests and files are listed.)
const PAGES = [
  { name: "Chat", hash: "#/chat" },
  { name: "Squires", hash: "#/team" },
  { name: "Overview", hash: "#/overview" },
] as const;
const PROFILES = {
  laptop: { width: 1280, height: 800, scale: 2, mobile: false, cpu: 1, network: null },
  phone: { width: 390, height: 844, scale: 3, mobile: true, cpu: 4, network: { latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 } },
} as const;
type Profile = keyof typeof PROFILES;

/*
 * Runs in every page before its own scripts: when the shell arrives, when the page is usable,
 * and how long the main thread was held on the way. "Usable" is the first frame after the page's
 * own content is there with no loading placeholder left in it.
 */
function watchPage(): void {
  if (!location.protocol.startsWith("http")) return;
  const m = { shell: null as number | null, usable: null as number | null, blocked: 0 };
  (window as unknown as { __measure: typeof m }).__measure = m;
  try {
    new PerformanceObserver((list) => {
      if (m.usable === null) for (const entry of list.getEntries()) m.blocked += Math.max(0, entry.duration - 50);
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* no long-task timing here: blocked stays 0 */
  }
  const there = (): boolean => {
    const main = document.querySelector(".shell main");
    if (!main || main.querySelector(".skeleton")) return false;
    // (A new chat holds a place for your recent chats until the node has said which they are.)
    if (location.hash.startsWith("#/chat")) return Boolean(main.querySelector(".chat .composer"));
    if (!location.hash.startsWith("#/team")) return Boolean(main.querySelector(".page-head h1"));
    return Boolean(main.querySelector(location.hash.includes("room=") ? ".team-message, .team-task" : ".team-nav-row[data-key]"));
  };
  let seen = false;
  const watch = new MutationObserver(() => {
    if (m.shell === null && document.querySelector(".shell")) m.shell = performance.now();
    if (seen || !there()) return;
    seen = true;
    watch.disconnect();
    requestAnimationFrame(() => setTimeout(() => (m.usable = performance.now())));
  });
  watch.observe(document, { childList: true, subtree: true, attributes: true });
}

interface Wire {
  path: string;
  status: number;
  bytes: number;
  encoding: string;
  by: "page" | "service worker";
  from: "network" | "service worker" | "cache";
}
interface Load {
  paint: number;
  shell: number;
  usable: number;
  blocked: number;
  nodes: number;
  wire: Wire[];
}
interface Spread {
  median: number;
  min: number;
  max: number;
}
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
};
const spread = (values: number[]): Spread => ({ median: Math.round(median(values)), min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)) });
/** A page's loads in one line: its times as median and range; what doesn't move from load to load, from the first. */
const summary = (loads: Load[]) => ({
  paint: spread(loads.map((l) => l.paint)),
  shell: spread(loads.map((l) => l.shell)),
  usable: spread(loads.map((l) => l.usable)),
  blocked: spread(loads.map((l) => l.blocked)),
  nodes: loads[0]!.nodes,
  requests: loads[0]!.wire.length,
  bytes: loads[0]!.wire.reduce((sum, w) => sum + w.bytes, 0),
});
type Summary = ReturnType<typeof summary>;

let chrome: Chrome | null = null;
let daemon: { stop(): Promise<void> } | null = null;
let model: ReturnType<typeof Bun.serve> | null = null;
const held: (() => void)[] = [];
async function tidy(): Promise<void> {
  for (const release of held.splice(0)) release();
  await chrome?.close().catch(() => {});
  await daemon?.stop().catch(() => {});
  model?.stop(true);
  rmSync(tmp, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => void tidy().finally(() => process.exit(130)));

try {
  const from = (path: string): Promise<any> => import(join(REPO, path));
  const core = await from("packages/core/src/index.ts");
  const { foundFleet, MindStore } = await from("packages/mind/src/index.ts");
  const { startDaemon } = await from("packages/node/src/daemon.ts");
  const { Home } = await from("packages/node/src/home.ts");
  const { buildAssets } = await from("packages/node/src/assets.ts");
  const { fakeDocker } = await from("packages/node/test/fake-docker.ts");
  const routes = core.routes as Record<string, { method: string; path: string }>;
  const revision = new TextDecoder().decode(Bun.spawnSync(["git", "-C", REPO, "rev-parse", "--short", "HEAD"]).stdout).trim() || "not a git checkout";
  const dirty = new TextDecoder().decode(Bun.spawnSync(["git", "-C", REPO, "status", "--porcelain", "--", "apps/web/src", "packages"]).stdout).trim() ? " + uncommitted changes" : "";

  // ---------- a throwaway node ----------
  const home = new Home(join(tmp, "home"));
  const port = freePort();
  const { identity, keystore } = await home.createIdentity("file");
  if (keystore !== "file") throw new Error(`the node's key went to the ${keystore} keystore, not a file`);
  const mind = new MindStore(home.mindPath);
  const fleet = foundFleet(mind, identity, { fleetName: "measure", nodeName: "keep" });
  mind.close();
  home.writeConfig({ v: 1, name: "keep", fleet, port, keystore, advertise: "127.0.0.1" });
  const caps = { os: "linux", arch: "x64", hostname: "keep", cores: 16, cpu: "stand-in", memoryGb: 32, hasBattery: false, gpu: [], docker: true, vm: { kvm: true, tools: ["kata"] }, tools: ["docker"], localModels: [], tailscale: null, sandbox: { image: true, networks: true, vm: true } };
  // Ada's task stays at its first command until the run ends, so one squire is always working.
  const docker = fakeDocker();
  let adaAtWork = false;
  const hold = new Promise<void>((release) => held.push(release));
  docker.onExec = async (_container: string, command: string[]) => {
    const text = command.join("\n");
    if (text.includes("write-sync")) {
      adaAtWork = true;
      await hold;
    }
    return { code: 0, stdout: text.includes("gate-") ? "required gate passed" : "command completed" };
  };
  // The browser comes in as a phone does behind `tailscale serve`: through the proxied port.
  const proxyPort = freePort();
  const started = await startDaemon(home, {
    capabilities: caps,
    proxyPort,
    log: () => {},
    docker: docker.runner,
    measure: async (reason: string, body: unknown, limit: unknown) => {
      const threads = core.ceilingThreads(body, limit);
      return { at: Date.now(), tookMs: 1, reason, body: core.bodyFingerprint(body, limit), cpu: { single: core.REFERENCE_SINGLE, multi: core.REFERENCE_SINGLE * threads, threads, kernel: core.KERNEL } };
    },
    loopIntervalMs: 3_600_000,
    defaultHeartbeat: false,
    archiveIntervalMs: false,
    shutdownGraceMs: 100,
  });
  daemon = started;
  const origin = `http://127.0.0.1:${proxyPort}`;
  const admin = async (name: string, input?: unknown): Promise<any> => {
    const route = routes[name];
    if (!route) throw new Error(`this checkout has no route named ${name}`);
    const response = await fetch(`http://127.0.0.1:${port}${route.path}`, {
      method: route.method,
      headers: { authorization: `Bearer ${home.adminToken()}`, "content-type": "application/json" },
      body: route.method === "POST" ? JSON.stringify(input ?? {}) : undefined,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${name}: ${response.status} ${JSON.stringify(body)}`);
    return body;
  };
  const until = async (what: string, probe: () => unknown | Promise<unknown>, timeoutMs = 20_000): Promise<void> => {
    const end = Date.now() + timeoutMs;
    let trouble = "";
    while (Date.now() < end) {
      try {
        if (await probe()) return;
      } catch (error) {
        // A page between two documents can't be asked: asked again.
        trouble = `: ${(error as Error).message}`;
      }
      await sleep(50);
    }
    throw new Error(`waited ${timeoutMs / 1000} s for ${what}${trouble}`);
  };

  // ---------- stand-in models, and what the pages show ----------
  // Percival's answer never comes while the run lasts, so one squire is always thinking.
  model = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    fetch: async (request) => {
      const body = (await request.json()) as { model: string; messages: { role: string; content: unknown }[] };
      const turns = body.messages.filter((message) => message.role !== "system");
      if (JSON.stringify(turns).includes("Take your time")) await hold;
      let text = "Understood. I will take the part that is mine and say when it is done.";
      if (JSON.stringify(turns[0] ?? "").includes("TASK_")) {
        text = "1. Make the change.\n2. Run the required gate.\nDone when: the gate and independent review pass.";
        if (body.model === "engineer") text = turns.some((message) => message.role === "assistant") ? "DONE\nVerified." : "```sh\nprintf done > result.txt # write-sync\n```";
        else if (body.model === "reviewer") text = "PASS\nThe required gate passed and execution evidence supports the result.";
      }
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  });
  await until("the node's calibration", () => started.store.lww(`calibration:${started.identity.id}`) !== null);
  await admin("setProvider", { id: "stand-in", kind: "openai", baseUrl: `http://127.0.0.1:${model.port}/v1` });
  for (const role of ["planner", "engineer", "reviewer", "swift"]) await admin("setRoster", { role, models: [`stand-in/${role}`] });
  const squires = [
    { id: "ada", name: "Ada", role: "engineer", instructions: "Builds the sync engine and keeps its tests green." },
    { id: "lin", name: "Lin", role: "engineer", instructions: "Owns the PWA: fast, plain and legible." },
    { id: "kay", name: "Kay", role: "planner", instructions: "Breaks large work into tasks that can be checked." },
    { id: "bors", name: "Bors", role: "reviewer", instructions: "Reviews what the others ship, independently.", enabled: false },
    { id: "percival", name: "Percival", role: "planner", instructions: "Researches the questions the others park." },
  ];
  for (const squire of squires) await admin("saveTeammate", squire);
  const idle = async () => !(await admin("team")).deliveries.some((d: { status: string; teammate: string }) => d.teammate !== "percival" && (d.status === "queued" || d.status === "running"));
  await admin("saveTeamRoom", { id: "forge", name: "Forge", members: ["ada", "lin", "kay"], turnBudget: 3 });
  await admin("postTeamMessage", { room: "forge", text: "Plan the release together: who takes the sync engine, who takes the app, and what proves each is done?" });
  await until("the room's conversation", idle);
  const first = (await admin("createTeamTask", { room: "forge", assignee: "ada", title: "Sync survives a dropped connection", goal: "TASK_SYNC: make sync resume after a dropped connection, with a test that drops it.", dependsOn: [], gates: ["test -f result.txt # gate-sync"] })).task;
  await until("Ada's task to start", () => adaAtWork);
  await admin("createTeamTask", { room: "forge", assignee: "lin", title: "The app says when sync resumed", goal: "TASK_APP: show a quiet line when sync resumes.", dependsOn: [first.id], gates: ["test -f result.txt # gate-app"] });
  const { room: direct } = await admin("directTeammate", { id: "percival" });
  await admin("postTeamMessage", { room: direct.id, text: "Take your time: what do other agents do about context rot?" });
  await until("Percival to start thinking", async () => (await admin("team")).deliveries.some((d: { status: string; teammate: string }) => d.teammate === "percival" && d.status === "running"));
  const problems = [
    { problem: "rlc-step", title: "Step response of a series RLC circuit", domain: "electrical" },
    { problem: "beam-deflection", title: "Deflection of a loaded cantilever", domain: "mechanical" },
    { problem: "orbit-transfer", title: "Delta-v of a Hohmann transfer", domain: "orbital" },
    { problem: "heat-fin", title: "Heat lost by a straight fin", domain: "thermal" },
  ];
  for (const [n, run] of ["r-one", "r-two"].entries()) {
    await admin("startTrialRun", { run, suite: "engineering", effort: 1 });
    for (const [i, problem] of problems.entries()) {
      const ok = i <= n + 1;
      await admin("recordTrial", {
        run,
        suite: "engineering",
        ...problem,
        seed: 7 + i,
        status: "scored",
        score: ok ? 1 : 0.5,
        answers: [
          { key: "first", units: "1", expected: 0.25, got: 0.2501, tolerance: 0.00075, ok: true },
          { key: "second", units: "s", expected: 560.9, got: ok ? 560.8 : 600, tolerance: 1.68, ok },
        ],
        quest: { status: "done", steps: 4 + i, revisions: ok ? 0 : 1 },
        models: ["stand-in/engineer"],
        version: "abc1234",
        seconds: 90 + 20 * i,
      });
    }
  }
  // A kept chat (asked through the real chat route, answered by the stand-in), a quest in hand and a key he asked for.
  const asked = await fetch(`http://127.0.0.1:${port}${routes.chat!.path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${home.adminToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "planner", save: true, tools: false, messages: [{ role: "user", content: "What is left before the release, in order?" }] }),
  });
  const conversation = /"(cv_[A-Za-z0-9_-]{22})"/.exec(await asked.text())?.[1];
  if (!asked.ok || !conversation) throw new Error(`the kept chat wasn't made: ${asked.status}`);
  await until("the kept chat's turn to end", async () => (await admin("turns")).turns.length === 0);
  await admin("questProgress", { quest: "measure-1", goal: "Make sync resume after a dropped connection", state: "working", plan: "1. Reproduce the drop.\n2. Resume from the last acknowledged entry.\n3. Run the gate.", step: 3, maxSteps: 30, doing: "bun test packages/link", revisions: 0, gates: [{ command: "bun test packages/link", by: "owner", exitCode: null }] });
  await admin("requestSecret", { name: "github-token", purpose: "To open the pull request for the sync fix." });
  const team = await admin("team");
  const faces = Object.fromEntries(team.teammates.map((member: { id: string }) => [member.id, core.avatarExpression(member, team, Date.now())]));

  // ---------- the app's files as the node sends them ----------
  const assets = await buildAssets();
  const sizeOf = async (path: string) => {
    const size = async (accept: string | null) => (await assets.serve(path, new Request(`${origin}${path}`, { headers: accept ? { "accept-encoding": accept } : {} })).arrayBuffer()).byteLength;
    return { path, raw: await size(null), gzip: await size("gzip"), brotli: await size("br") };
  };

  // ---------- a paired browser ----------
  chrome = await Chrome.launch(join(tmp, "chrome"));
  const browser = chrome;
  const { targetInfos } = await browser.send("Target.getTargets");
  const { sessionId: page } = await browser.send("Target.attachToTarget", { targetId: targetInfos.find((t: { type: string }) => t.type === "page").targetId, flatten: true });
  const wire = new Map<string, Wire & { done: boolean }>();
  const workers = new Set<string>();
  let profile: Profile = "laptop";
  let lastTraffic = Date.now();
  const line = (name: Profile) => ({ offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, ...(PROFILES[name].network ?? {}) });
  browser.on(({ method, params, sessionId }) => {
    if (method === "Target.attachedToTarget" && params.targetInfo.type === "service_worker") {
      // A service worker waits for us at its start, so none of its requests are missed, and it is on the same line as the page.
      workers.add(params.sessionId);
      void browser
        .send("Network.enable", {}, params.sessionId)
        .then(() => browser.send("Network.emulateNetworkConditions", line(profile), params.sessionId))
        .then(() => browser.send("Runtime.runIfWaitingForDebugger", {}, params.sessionId))
        .catch(() => {});
      return;
    }
    if (method === "Target.detachedFromTarget") workers.delete(params.sessionId);
    if (!method.startsWith("Network.") || (sessionId !== page && !workers.has(sessionId ?? ""))) return;
    lastTraffic = Date.now();
    const key = `${sessionId}:${params.requestId}`;
    if (method === "Network.requestWillBeSent" && params.request.url.startsWith(origin)) {
      wire.set(key, { path: new URL(params.request.url).pathname, status: 0, bytes: 0, encoding: "", by: sessionId === page ? "page" : "service worker", from: "network", done: false });
    } else if (method === "Network.responseReceived" && wire.has(key)) {
      const entry = wire.get(key)!;
      entry.status = params.response.status;
      entry.encoding = params.response.headers["content-encoding"] ?? params.response.headers["Content-Encoding"] ?? "";
      entry.from = params.response.fromServiceWorker ? "service worker" : params.response.fromDiskCache || params.response.fromPrefetchCache ? "cache" : "network";
    } else if ((method === "Network.loadingFinished" || method === "Network.loadingFailed") && wire.has(key)) {
      Object.assign(wire.get(key)!, { bytes: params.encodedDataLength ?? 0, done: true });
    }
  });
  await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "service_worker" }] });
  for (const domain of ["Page", "Runtime", "Network", "Performance"]) await browser.send(`${domain}.enable`, {}, page);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${watchPage.toString()})()` }, page);
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const { result, exceptionDetails } = await browser.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, page);
    if (exceptionDetails) throw new Error(`in the page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value as T;
  };
  const navigate = async (url: string): Promise<void> => {
    await browser.send("Page.navigate", { url }, page);
  };
  const quiet = (ms: number) => until("the network to go quiet", () => Date.now() - lastTraffic > ms && [...wire.values()].every((entry) => entry.done), 30_000);

  // The real pairing page: the code it shows is compared with the node's before anything is approved.
  const invite = await admin("createInvite", { kind: "client", origin, scopes: core.CLIENT_DEFAULT_SCOPES });
  await navigate(invite.url);
  await until("the pairing page", () => evaluate(`Boolean(document.querySelector("form.card button[type=submit]"))`));
  await evaluate(`document.querySelector("form.card button[type=submit]").click()`);
  await until("the page's code", () => evaluate(`Boolean(document.querySelector(".sas"))`));
  const pageCode = await evaluate<string>(`[...document.querySelectorAll(".sas span")].map((s) => s.textContent).join("")`);
  await until("the node's pending pairing", async () => (await admin("pairings")).pairings.length === 1);
  const [pending] = (await admin("pairings")).pairings;
  if (String(pending.sas).replace(/\s+/g, "") !== pageCode) throw new Error("the page's code and the node's differ: nothing approved");
  await admin("approvePairing", { invite: pending.invite, device: pending.device });
  await until("the app after pairing", () => evaluate(`Boolean(document.querySelector(".shell"))`));

  // ---------- loading a page ----------
  const setProfile = async (name: Profile): Promise<void> => {
    profile = name;
    const p = PROFILES[name];
    await browser.send("Emulation.setDeviceMetricsOverride", { width: p.width, height: p.height, deviceScaleFactor: p.scale, mobile: p.mobile }, page);
    await browser.send("Emulation.setTouchEmulationEnabled", { enabled: p.mobile }, page);
    await browser.send("Emulation.setCPUThrottlingRate", { rate: p.cpu }, page);
    for (const session of [page, ...workers]) await browser.send("Network.emulateNetworkConditions", line(name), session).catch(() => {});
  };
  const forget = async (): Promise<void> => {
    await navigate("about:blank");
    await sleep(100);
    await browser.send("Network.clearBrowserCache", {}, page);
    // The device key (IndexedDB) stays: this is a paired browser that has never opened the app.
    await browser.send("Storage.clearDataForOrigin", { origin, storageTypes: "service_workers,cache_storage" }, page);
    await sleep(200);
  };
  const usable = (hash: string) => until(`${hash} to be usable`, () => evaluate(`window.__measure?.usable != null && performance.getEntriesByName("first-contentful-paint").length > 0`), 45_000);
  const open = async (hash: string, settle: boolean): Promise<Load> => {
    await navigate("about:blank");
    await sleep(100);
    wire.clear();
    await navigate(`${origin}/${hash}`);
    await usable(hash);
    const marks = await evaluate<Omit<Load, "wire">>(`({ ...window.__measure, paint: performance.getEntriesByName("first-contentful-paint")[0].startTime, nodes: document.querySelectorAll("*").length })`);
    // A first visit goes on after the page is usable: the service worker installs and fetches the shell again.
    if (settle) {
      await until("the service worker", () => evaluate(`navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === "activated")`), 30_000);
      await quiet(700);
    }
    return { ...marks, wire: [...wire.values()].map(({ done: _done, ...entry }) => entry) };
  };

  /*
   * Where the main thread's time goes on a first visit, up to "usable": one load with Chrome's own
   * trace on, each stretch of work counted once under what it was (its own time, without what it called).
   */
  const WORK: [string, RegExp][] = [
    ["script", /^(v8\.|V8\.|EvaluateScript|FunctionCall|RunMicrotasks|TimerFire|EventDispatch|XHR|FireAnimationFrame|MinorGC|MajorGC)/],
    ["style", /^(UpdateLayoutTree|ScheduleStyleRecalculation)/],
    ["layout", /^Layout$/],
    ["paint", /^(Paint|PrePaint|Layerize|Commit|UpdateLayer|CompositeLayers|RasterTask|Decode)/],
    ["parsing", /^(ParseHTML|ParseAuthorStyleSheet|DecodedDataDocumentParser)/],
  ];
  const traced = async (hash: string): Promise<Record<string, number>> => {
    await forget();
    const events: any[] = [];
    let complete = () => {};
    const done = new Promise<void>((resolve) => (complete = resolve));
    const listen = ({ method, params }: CdpEvent) => {
      if (method === "Tracing.dataCollected") events.push(...params.value);
      else if (method === "Tracing.tracingComplete") complete();
    };
    browser.on(listen);
    await browser.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "v8", "blink.user_timing", "loading"] } });
    await navigate(`${origin}/${hash}`);
    await usable(hash);
    const at = await evaluate<number>(`window.__measure.usable`);
    await browser.send("Tracing.end");
    await done;
    browser.off(listen);
    // The page's own main thread: the one its navigation started on.
    const start = events.findLast((e) => e.name === "navigationStart" && String(e.args?.data?.documentLoaderURL ?? "").startsWith(origin));
    if (!start) throw new Error("the trace has no navigation start for the page");
    const main = events.filter((e) => e.ph === "X" && e.pid === start.pid && e.tid === start.tid && e.ts >= start.ts && e.ts <= start.ts + at * 1000).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const own = new Map<any, number>(main.map((e) => [e, e.dur]));
    const open: any[] = [];
    for (const e of main) {
      while (open.length && open.at(-1).ts + open.at(-1).dur <= e.ts) open.pop();
      if (open.length) own.set(open.at(-1), own.get(open.at(-1))! - e.dur);
      open.push(e);
    }
    const spent: Record<string, number> = Object.fromEntries([...WORK.map(([kind]) => [kind, 0]), ["other", 0]]);
    for (const [e, micros] of own) spent[WORK.find(([, names]) => names.test(e.name))?.[0] ?? "other"]! += Math.max(0, micros) / 1000;
    return spent;
  };

  const results: Record<string, { cold: Summary; warm: Summary; work: Record<string, number> }> = {};
  let firstVisit: Wire[] = [];
  for (const name of Object.keys(PROFILES) as Profile[]) {
    await setProfile(name);
    for (const target of PAGES) {
      const cold: Load[] = [];
      const warm: Load[] = [];
      for (let run = 0; run < RUNS; run++) {
        await forget();
        cold.push(await open(target.hash, true));
        warm.push(await open(target.hash, false));
      }
      if (name === "laptop" && target === PAGES[0]) firstVisit = cold[0]!.wire;
      const traces = [await traced(target.hash), await traced(target.hash), await traced(target.hash)];
      const work = Object.fromEntries(Object.keys(traces[0]!).map((kind) => [kind, Math.round(median(traces.map((t) => t[kind]!)) * 10) / 10]));
      results[`${target.name} · ${name}`] = { cold: summary(cold), warm: summary(warm), work };
      console.error(`measured ${target.name} on the ${name} profile`);
    }
  }

  // ---------- what Squires costs while nothing changes ----------
  // (On this machine as it is: a slowed processor drops frames, and so hides the work an animation asks for.)
  await setProfile("laptop");
  await open("#/team", false);
  const work = async (): Promise<Record<string, number>> => Object.fromEntries((await browser.send("Performance.getMetrics", {}, page)).metrics.map((metric: { name: string; value: number }) => [metric.name, metric.value]));
  await sleep(1500);
  const before = await work();
  await sleep(10_000);
  const after = await work();
  const perSecond = (metric: string) => Math.round((after[metric]! - before[metric]!) * 1000) / 10;
  const atRest = {
    avatars: await evaluate<number>(`document.querySelectorAll(".worker-avatar").length`),
    avatarElements: await evaluate<number>(`document.querySelectorAll(".worker-avatar, .worker-avatar *").length`),
    animations: await evaluate<number>(`document.getAnimations().filter((a) => a.playState === "running").length`),
    mainThread: perSecond("TaskDuration"),
    script: perSecond("ScriptDuration"),
    style: perSecond("RecalcStyleDuration"),
    layout: perSecond("LayoutDuration"),
  };

  // ---------- screenshots ----------
  const shots: string[] = [];
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await setProfile("laptop");
    const views: { name: string; hash: string; wait?: string }[] = [
      { name: "chat", hash: "#/chat" },
      { name: "chat-kept", hash: `#/chat?c=${conversation}`, wait: ".turn.assistant" },
      { name: "squires", hash: "#/team" },
      { name: "room", hash: "#/team?room=forge" },
      { name: "room-work", hash: "#/team?room=forge&tab=work" },
      { name: "inbox", hash: "#/inbox" },
      { name: "more", hash: "#/more" },
      { name: "overview", hash: "#/overview" },
      { name: "trials", hash: "#/trials" },
    ];
    for (const theme of ["light", "dark"]) {
      await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, page);
      for (const [width, height, mobile] of [[390, 844, true], [1280, 800, false]] as const) {
        await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile }, page);
        await browser.send("Emulation.setTouchEmulationEnabled", { enabled: mobile }, page);
        for (const view of views) {
          // A new chat, not the kept one the last round left open (the app comes back to that one).
          await evaluate(`try { localStorage.removeItem("galahad:open-chat") } catch {}`);
          await open(view.hash, false);
          if (view.wait) await until(`${view.name} to show`, () => evaluate(`Boolean(document.querySelector(${JSON.stringify(view.wait)}))`));
          await sleep(400);
          const { data } = await browser.send("Page.captureScreenshot", { format: "png" }, page);
          const file = join(SHOTS, `${view.name}-${width}-${theme}.png`);
          writeFileSync(file, Buffer.from(data, "base64"));
          shots.push(file);
        }
      }
    }
  }

  // ---------- the report ----------
  // (The browser fetches /sw.js itself, outside what the protocol shows of the page and the worker: it is counted here.)
  const files = await Promise.all([...new Set([...firstVisit.filter((w) => !w.path.startsWith("/api/") && !w.path.startsWith("/link/")).map((w) => w.path), "/sw.js"])].map(sizeOf));
  const total = (key: "raw" | "gzip" | "brotli") => files.reduce((sum, file) => sum + file[key], 0);
  const report = {
    revision: `${revision}${dirty}`,
    repo: REPO,
    chrome: (await browser.send("Browser.getVersion")).product,
    runs: RUNS,
    faces,
    firstVisit: { requests: firstVisit.length, api: firstVisit.filter((w) => w.path.startsWith("/api/")).length, bytesOnTheWire: firstVisit.reduce((sum, w) => sum + w.bytes, 0), wire: firstVisit },
    files: [...files, { path: "all of them", raw: total("raw"), gzip: total("gzip"), brotli: total("brotli") }],
    pages: results,
    squiresAtRest: atRest,
    shots,
  };
  if (JSON_OUT) writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);

  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  const ms = (s: Spread) => `${s.median} ms (${s.min}–${s.max})`;
  const table = (rows: string[][]) => {
    const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
    return rows.map((row) => row.map((cell, column) => (column ? cell.padStart(widths[column]!) : cell.padEnd(widths[column]!))).join("  ")).join("\n");
  };
  console.log(`\nThe PWA at ${report.revision} (${REPO}), in ${report.chrome}, ${RUNS} loads each.`);
  console.log(`Squires' faces while it was measured: ${Object.entries(faces).map(([id, face]) => `${id} ${face}`).join(", ")}.\n`);
  console.log("The app's files on a first visit, as the node sends them:");
  console.log(table([["file", "raw", "gzip", "brotli"], ...report.files.map((f) => [f.path, kb(f.raw), kb(f.gzip), kb(f.brotli)])]));
  console.log(`\nA first visit to ${PAGES[0].name}: ${report.firstVisit.requests} requests seen, and /sw.js (${firstVisit.filter((w) => w.by === "page").length} by the page, ${firstVisit.filter((w) => w.by === "service worker").length} by the service worker; ${report.firstVisit.api} of them to the API),`);
  console.log(`${kb(report.firstVisit.bytesOnTheWire)} on the wire with their headers (this Chrome was sent: ${[...new Set(firstVisit.filter((w) => w.encoding).map((w) => w.encoding))].join(", ") || "nothing compressed"}).\n`);
  const rows = [["page · profile · visit", "paint", "shell", "usable", "blocked", "elements", "requests", "on the wire"]];
  for (const [name, kinds] of Object.entries(results)) {
    for (const kind of ["cold", "warm"] as const) {
      const s = kinds[kind];
      rows.push([`${name} · ${kind}`, ms(s.paint), ms(s.shell), ms(s.usable), ms(s.blocked), String(s.nodes), String(s.requests), kb(s.bytes)]);
    }
  }
  console.log(table(rows));
  console.log("\nThe main thread's work on a first visit, up to usable (ms, the median of three traced loads):");
  console.log(table([["page · profile", ...Object.keys(Object.values(results)[0]!.work)], ...Object.entries(results).map(([name, r]) => [name, ...Object.values(r.work).map((n) => n.toFixed(1))])]));
  console.log(`\nSquires at rest (laptop, ten seconds): ${atRest.avatars} avatars of ${atRest.avatarElements} elements, ${atRest.animations} animations running;`);
  console.log(`the main thread works ${atRest.mainThread} ms a second (script ${atRest.script}, style ${atRest.style}, layout ${atRest.layout}).`);
  if (shots.length) console.log(`\n${shots.length} screenshots in ${resolve(SHOTS!)}`);
  if (JSON_OUT) console.log(`Everything measured: ${resolve(JSON_OUT)}`);
} finally {
  await tidy();
}
