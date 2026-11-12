/*
 * Measures the spikes: bundles each (minified, as the node bundles the SANDBOX), serves them on the loopback,
 * opens each in headless Edge with the frame-rate limit off, and reads what harness.js kept.
 *
 *   bun measure.ts [--only=<regex>] [--shots=<dir>] [--rounds=3] [--windows=2] [--seconds=3] [--x=1,2,3]
 *
 * Writes results.json beside this file. The same flags, the same loop and the same scaling by how quiet the page's
 * own thread finds the machine as bench/browser/world-scale.ts. Every engine and mode is measured once a round,
 * round after round, so on a shared machine they all meet the same weather; a number is the median of its rounds.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

const HERE = import.meta.dir;
const EDGE = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const flag = (name: string): string | undefined => {
  const hit = Bun.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "";
};
const ONLY = flag("only") ? new RegExp(flag("only")!) : null;
const WINDOWS = Number(flag("windows")) || 2;
const SECONDS = Number(flag("seconds")) || 3;
const ROUNDS = Number(flag("rounds")) || 3;
const SHOTS = flag("shots");
const XS = (flag("x") || "1,2,3").split(",").map(Number);

interface Config {
  id: string;
  engine: "three" | "babylon" | "playcanvas";
  mode?: string;
  webgl?: boolean;
}
const CONFIGS: Config[] = [
  { id: "three.webgpu", engine: "three" },
  { id: "three.webgpu.bundle", engine: "three", mode: "bundle" },
  { id: "three.webgpu.static", engine: "three", mode: "static" },
  { id: "three.webgl2", engine: "three", webgl: true },
  { id: "babylon.webgpu", engine: "babylon" },
  { id: "babylon.webgpu.snapshot", engine: "babylon", mode: "snapshot" },
  { id: "babylon.webgpu.snapshot-fast", engine: "babylon", mode: "snapshot-fast" },
  { id: "babylon.webgl2", engine: "babylon", webgl: true },
  { id: "playcanvas.webgpu", engine: "playcanvas" },
  { id: "playcanvas.webgl2", engine: "playcanvas", webgl: true },
];

// ---- the bundles ----
const sizes: Record<string, { raw: number; gzip: number; brotli: number }> = {};
const files = new Map<string, Uint8Array>();
for (const engine of ["three", "babylon", "playcanvas"] as const) {
  if (!CONFIGS.some((c) => c.engine === engine && (!ONLY || ONLY.test(c.id)))) continue;
  const built = await Bun.build({ entrypoints: [join(HERE, `${engine}.js`)], target: "browser", minify: true, naming: "[name].[ext]" });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  for (const output of built.outputs) {
    const bytes = new Uint8Array(await output.arrayBuffer());
    const name = output.path.split(/[\\/]/).pop()!;
    files.set(`/dist/${name}`, bytes);
    if (name === `${engine}.js`) sizes[engine] = { raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length };
  }
  console.log(`${engine}: ${(sizes[engine]!.raw / 1024).toFixed(0)} KB minified, ${(sizes[engine]!.gzip / 1024).toFixed(0)} KB gzip, ${(sizes[engine]!.brotli / 1024).toFixed(0)} KB brotli`);
}
const html = readFileSync(join(HERE, "index.html"));
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/" || path === "/index.html") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    const file = files.get(path);
    return file ? new Response(file, { headers: { "content-type": "text/javascript; charset=utf-8" } }) : new Response("not found", { status: 404 });
  },
});

const median = (values: number[]): number => {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[v.length >> 1]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2) : 0;
};
const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

const root = mkdtempSync(join(os.tmpdir(), "galahad-spikes-"));
const cdpPort = 9900 + Math.floor(Math.random() * 90);
const browser = Bun.spawn(
  [EDGE, "--headless=new", "--no-first-run", "--disable-extensions", "--hide-scrollbars", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--enable-webgpu-developer-features", "--disable-frame-rate-limit", "--disable-gpu-vsync", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${join(root, "profile")}`, "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);
interface Taken {
  id: string;
  x: number;
  name: string;
  windows: { work: any; interval: any }[];
  speeds: number[];
  info: any;
  first: number;
  heapMb: number;
  errors: string[];
}
const taken: Taken[] = [];
let bestPage = 0;
try {
  bestPage = (JSON.parse(readFileSync(join(HERE, "machine.json"), "utf8")) as { page: number }).page || 0;
} catch {}
let browserWs = "";
try {
  let wsUrl = "";
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
    } catch {}
    if (!wsUrl) await Bun.sleep(250);
  }
  browserWs = ((await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
  const connect = async (url: string) => {
    const ws = new WebSocket(url);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let next = 0;
    const pending = new Map<number, (m: any) => void>();
    const listeners: ((m: any) => void)[] = [];
    ws.addEventListener("message", (event) => {
      const m = JSON.parse(String(event.data));
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)!(m);
        pending.delete(m.id);
      } else for (const l of listeners) l(m);
    });
    const send = (method: string, params: object = {}): Promise<any> =>
      new Promise((resolve) => {
        const id = ++next;
        const timer = setTimeout(() => pending.delete(id) && resolve({ timedOut: true }), 60_000);
        pending.set(id, (m) => (clearTimeout(timer), resolve(m)));
        ws.send(JSON.stringify({ id, method, params }));
      });
    return { ws, send, listeners };
  };
  const page = await connect(wsUrl);
  const whole = await connect(browserWs);
  const send = page.send;
  let errors: string[] = [];
  page.listeners.push((m) => {
    if (m.method === "Runtime.exceptionThrown") errors.push(`exception ${JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 400)}`);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) errors.push(`${m.params.type} ${JSON.stringify(m.params.args.map((a: any) => a.value ?? a.description)).slice(0, 400)}`);
  });
  const evaluate = async (expression: string): Promise<any> => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Performance.enable");
  await send("HeapProfiler.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const raise = async (): Promise<void> => {
    try {
      const info = await whole.send("SystemInfo.getProcessInfo");
      for (const p of [{ id: process.pid }, ...((info.result?.processInfo as { id: number }[] | undefined) ?? [])]) {
        try {
          os.setPriority(p.id, os.constants.priority.PRIORITY_HIGH);
        } catch {}
      }
    } catch {}
  };
  for (let turn = 0; turn < ROUNDS; turn++)
  for (const config of CONFIGS) {
    if (ONLY && !ONLY.test(config.id)) continue;
    for (const x of XS) {
      errors = [];
      const query = new URLSearchParams({ engine: config.engine, x: String(x) });
      if (config.mode) query.set("mode", config.mode);
      if (config.webgl) query.set("webgl", "1");
      await send("Page.navigate", { url: "about:blank" });
      await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?${query}` });
      let ok = false;
      for (let i = 0; i < 240; i++) {
        await Bun.sleep(250);
        const frames = await evaluate("globalThis.__spike ? globalThis.__spike.state.frames : (globalThis.__spikeError ? -1 : 0)");
        if (frames === -1) break;
        if (frames > 30) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        const why = await evaluate("globalThis.__spikeError || (globalThis.__spike && globalThis.__spike.state.error) || 'no frames'");
        console.log(`  ${config.id} x${x}: FAILED: ${String(why).slice(0, 600)} ${errors.slice(0, 4).join(" | ")}`);
        taken.push({ id: config.id, x, name: "", windows: [], speeds: [], info: null, first: 0, heapMb: 0, errors: [String(why), ...errors].slice(0, 6) });
        continue;
      }
      await raise();
      await Bun.sleep(3000);
      const speed = async (): Promise<number> => {
        const k = Number(await evaluate("globalThis.__spike.kernel(60)"));
        bestPage = Math.max(bestPage, k);
        return k;
      };
      const windows: Taken["windows"] = [];
      const speeds: number[] = [];
      let around = await speed();
      for (let w = 0; w < WINDOWS; w++) {
        await evaluate("globalThis.__spike.reset()");
        await Bun.sleep(SECONDS * 1000);
        windows.push(await evaluate("globalThis.__spike.stats()"));
        const after = await speed();
        speeds.push((around + after) / 2);
        around = after;
      }
      const info = await evaluate("globalThis.__spike.info()");
      const state = await evaluate("globalThis.__spike.state");
      await send("HeapProfiler.collectGarbage");
      const m = await send("Performance.getMetrics");
      const heapMb = round(((m.result?.metrics as { name: string; value: number }[]).find((v) => v.name === "JSHeapUsedSize")?.value ?? 0) / 2 ** 20, 1);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        const shot = await send("Page.captureScreenshot", { format: "png" });
        if (shot.result?.data) writeFileSync(join(SHOTS, `${config.id}.x${x}.png`), Buffer.from(shot.result.data, "base64"));
      }
      taken.push({ id: config.id, x, name: state.name, windows, speeds, info, first: state.first, heapMb, errors: errors.slice(0, 6) });
      const raw = median(windows.map((w) => w.work.p50));
      console.log(`  round ${turn + 1} ${config.id} x${x} (${state.name}): cpu ${raw.toFixed(2)} ms p50 as measured, frame ${median(windows.map((w) => w.interval.p50)).toFixed(2)} ms, ${info.calls} calls, ${(info.triangles / 1e6).toFixed(2)} M tris, first frame ${Math.round(state.first)} ms${errors.length ? `, ${errors.length} console message(s): ${errors[0]}` : ""}`);
    }
  }
  page.ws.close();
  whole.ws.close();
} finally {
  try {
    const b = new WebSocket(browserWs);
    await new Promise((resolve) => b.addEventListener("open", resolve, { once: true }));
    b.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await Bun.sleep(1200);
  } catch {}
  Bun.spawnSync(["taskkill", "/PID", String(browser.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
  browser.kill();
  await browser.exited;
  server.stop(true);
  for (let i = 0; i < 8; i++) {
    try {
      rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await Bun.sleep(800);
    }
  }
}

// ---- what it says: each time scaled to the best the page's own loop did (a quiet machine isn't scaled) ----
writeFileSync(join(HERE, "machine.json"), `${JSON.stringify({ page: Math.round(bestPage) })}\n`);
const scaledOf = (t: Taken) => {
  const q = t.speeds.map((k) => Math.min(1, k / bestPage));
  return { quiet: Math.min(...q), cpuP50: median(t.windows.map((w, i) => w.work.p50 * q[i]!)), cpuP95: median(t.windows.map((w, i) => w.work.p95 * q[i]!)), frameP50: median(t.windows.map((w, i) => w.interval.p50 * q[i]!)), frameP95: median(t.windows.map((w, i) => w.interval.p95 * q[i]!)), rawCpuP50: Math.min(...t.windows.map((w) => w.work.p50)) };
};
const keys = [...new Set(taken.map((t) => `${t.id}|${t.x}`))];
const results = keys.map((key) => {
  const rounds = taken.filter((t) => `${t.id}|${t.x}` === key);
  const good = rounds.filter((t) => t.windows.length);
  const first = rounds[0]!;
  if (!good.length) return { id: first.id, x: first.x, failed: true, errors: first.errors };
  const each = good.map(scaledOf);
  const spread = (values: number[]): number => round((Math.max(...values) - Math.min(...values)) / 2);
  return {
    id: first.id,
    x: first.x,
    name: good[0]!.name,
    rounds: good.length,
    quiet: round(Math.min(...each.map((e) => e.quiet)), 2),
    cpuP50: round(median(each.map((e) => e.cpuP50))),
    cpuP50Spread: spread(each.map((e) => e.cpuP50)),
    cpuP95: round(median(each.map((e) => e.cpuP95))),
    frameP50: round(median(each.map((e) => e.frameP50))),
    frameP95: round(median(each.map((e) => e.frameP95))),
    /** The least any window measured, unscaled: what it does when the machine lets it. */
    cpuP50LeastMeasured: round(Math.min(...each.map((e) => e.rawCpuP50))),
    calls: good[0]!.info.calls,
    triangles: good[0]!.info.triangles,
    firstFrameMs: Math.round(median(good.map((t) => t.first))),
    heapMb: good[0]!.heapMb,
    errors: good[0]!.errors,
  };
});
// Per engine and mode: the cost of an object drawn and what a frame costs before any (a line through the points). The
// objects are counted as the engine's plain mode counts its draw calls for the same slice (a recorded frame's replay
// isn't counted call by call).
const plain = (id: string, x: number): number => {
  const engine = id.split(".").slice(0, 2).join(".");
  const r = results.find((r) => r.id === engine && r.x === x && !("failed" in r)) as { calls: number } | undefined;
  return r ? r.calls : 0;
};
const fits = [...new Set(results.map((r) => r.id))].map((id) => {
  const points = (results.filter((r) => r.id === id && !("failed" in r)) as { x: number; calls: number; cpuP50: number }[]).map((p) => ({ calls: plain(id, p.x) || p.calls, cpuP50: p.cpuP50 }));
  if (points.length < 2) return { id, points: points.length };
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.calls, 0) / n;
  const my = points.reduce((s, p) => s + p.cpuP50, 0) / n;
  const slope = points.reduce((s, p) => s + (p.calls - mx) * (p.cpuP50 - my), 0) / points.reduce((s, p) => s + (p.calls - mx) ** 2, 0);
  return { id, microsecondsAnObject: round(slope * 1000, 1), fixedMs: round(my - slope * mx, 2) };
});
writeFileSync(join(HERE, "results.json"), `${JSON.stringify({ at: new Date().toISOString(), rounds: ROUNDS, windows: WINDOWS, seconds: SECONDS, bundles: sizes, fits, results }, null, 1)}\n`);
console.table(results.map((r) => ("failed" in r ? { id: r.id, x: r.x, failed: true } : { id: r.id, x: r.x, calls: r.calls, cpuP50: r.cpuP50, "±": r.cpuP50Spread, cpuP95: r.cpuP95, least: r.cpuP50LeastMeasured, frameP50: r.frameP50, quiet: r.quiet, firstMs: r.firstFrameMs, heapMb: r.heapMb })));
console.table(fits);
process.exit(0);
