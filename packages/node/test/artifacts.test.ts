import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ArtifactView, b64u, newNodeIdentity, type RouteName, routes } from "@galahad/core";
import { enrollDevice, foundFleet, MindStore } from "@galahad/mind";
import type { ExtractLimits, ExtractResult } from "@galahad/sandbox";
import { ArtifactStore, contentTypeOf } from "../src/artifacts.ts";
import type { Capabilities } from "../src/capabilities.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { Home } from "../src/home.ts";

/*
 * Artifacts: what a sandbox's /work/out leaves behind. The collector (docker cp
 * through the hostile-archive extractor) is faked here; tar.test.ts and the
 * Docker integration tests cover the real one.
 */

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A collector that "finds" these files in the sandbox. */
function collector(files: Record<string, string>) {
  return async (_sandbox: string, _from: string, dest: string, limits: ExtractLimits): Promise<ExtractResult | null> => {
    const entries = Object.entries(files);
    if (!entries.length) return null;
    let bytes = 0;
    const out: ExtractResult = { files: [], bytes: 0, skipped: [] };
    for (const [path, text] of entries) {
      bytes += text.length;
      if (bytes > limits.maxBytes) throw new Error("too big");
      const target = join(dest, ...path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      out.files.push({ path, size: text.length, sha256: sha(text) });
    }
    out.bytes = bytes;
    return out;
  };
}

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "galahad-art-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("keeping a sandbox's work", () => {
  const identity = newNodeIdentity();
  const store = new MindStore(":memory:");
  foundFleet(store, identity, { fleetName: "camelot", nodeName: "ultra" });
  const ledger: { resource: string; class: string }[] = [];
  const artifacts = new ArtifactStore({ store, identity, dir: temp(), ledger: (e) => ledger.push(e) });

  test("files are kept with their hashes, and the mind records what they are", async () => {
    const kept = await artifacts.save(collector({ "report.md": "# Beam\nδ = 1.67 mm\n", "plots/mode1.png": "PNG…", "data/u.csv": "x,u\n0,0\n" }), {
      sandbox: "0123456789",
      label: "Cantilever check",
      quest: "q-1",
    });
    expect(kept).toMatchObject({ label: "Cantilever check", quest: "q-1", sandbox: "0123456789", count: 3, here: true, nodeName: "ultra" });
    expect(kept!.files.find((f) => f.path === "report.md")!.sha256).toBe(sha("# Beam\nδ = 1.67 mm\n"));
    expect(store.lww<{ count: number }>(`artifact:${kept!.id}`)?.value?.count).toBe(3);
    expect(ledger.at(-1)).toMatchObject({ resource: "artifact", class: "create" });
    expect(new TextDecoder().decode(artifacts.read(kept!.id, "data/u.csv").bytes)).toBe("x,u\n0,0\n");
  });

  test("nothing in /work/out: nothing kept, nothing recorded", async () => {
    const before = artifacts.list().length;
    expect(await artifacts.save(collector({}), { sandbox: "0123456789" })).toBeNull();
    expect(artifacts.list()).toHaveLength(before);
  });

  test("only files the manifest lists are ever served: no other path is opened", async () => {
    const kept = (await artifacts.save(collector({ "a.txt": "a" }), { sandbox: "0123456789" }))!;
    for (const path of ["../manifest.json", "../../a.txt", "/etc/passwd", "a.txt/..", "b.txt"]) {
      expect(() => artifacts.read(kept.id, path)).toThrow(/no such file/);
    }
    expect(() => artifacts.read("art_xxxxxxxxxxxxxxxxxxxxxx", "a.txt")).toThrow(/no such artifact/);
  });

  test("HTML and SVG are shown as their source, never rendered; raster images inline; the rest downloads", () => {
    expect(contentTypeOf("report.html")).toEqual({ type: "text/plain; charset=utf-8", inline: true });
    expect(contentTypeOf("diagram.svg")).toEqual({ type: "text/plain; charset=utf-8", inline: true });
    expect(contentTypeOf("plot.PNG")).toEqual({ type: "image/png", inline: true });
    expect(contentTypeOf("part.stl")).toEqual({ type: "application/octet-stream", inline: false });
    expect(contentTypeOf("paper.pdf")).toEqual({ type: "application/pdf", inline: false });
  });

  test("removing deletes the files and records it; only the node holding them may record that", async () => {
    const kept = (await artifacts.save(collector({ "x.txt": "x" }), { sandbox: "0123456789" }))!;
    const other = newNodeIdentity();
    enrollDevice(store, identity, { device: other.id, name: "laptop", kind: "node", box: b64u(other.boxPublic) });
    expect(() => store.emit(other, "artifact.removed", { id: kept.id })).toThrow(/only the node holding/);
    artifacts.remove(kept.id, "by you");
    expect(artifacts.get(kept.id)).toBeNull();
    expect(() => artifacts.read(kept.id, "x.txt")).toThrow(/no such artifact/);
    expect(() => store.emit(identity, "artifact.removed", { id: kept.id })).toThrow(/no such artifact/);
  });
});

describe("artifacts over the API", () => {
  const caps: Capabilities = {
    os: "linux",
    arch: "x64",
    hostname: "art",
    cores: 4,
    cpu: "test",
    memoryGb: 8,
    hasBattery: false,
    gpu: [],
    docker: false,
    vm: { kvm: false, tools: [] },
    tools: [],
    localModels: [],
    tailscale: null,
  };
  const freePort = () => {
    const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const p = s.port!;
    s.stop(true);
    return p;
  };
  const root = temp();
  const home = new Home(join(root, "node"));
  const port = freePort();
  let daemon: Daemon;
  let armToken: string;
  let kept: ArtifactView;
  const send = (token: string, name: RouteName, input?: unknown) =>
    fetch(`http://127.0.0.1:${port}${routes[name].path}`, {
      method: routes[name].method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: routes[name].method === "POST" ? JSON.stringify(input ?? {}) : undefined,
    });

  beforeAll(async () => {
    const { identity, keystore } = await home.createIdentity("file");
    const store = new MindStore(home.mindPath);
    const fleet = foundFleet(store, identity, { fleetName: "camelot", nodeName: "ultra" });
    store.close();
    home.writeConfig({ v: 1, name: "ultra", fleet, port, keystore, advertise: "127.0.0.1" });
    daemon = await startDaemon(home, { capabilities: caps, proxyPort: freePort(), log: () => {} });
    armToken = ((await (await send(home.adminToken(), "mintArm", { label: "reader" })).json()) as { token: string }).token;
    kept = (await daemon.artifacts.save(collector({ "report.md": "# Result\n", "page.html": "<script>alert(1)</script>", "part.stl": "solid x" }), {
      sandbox: "0123456789",
      label: "API test",
    }))!;
  });
  afterAll(async () => {
    await daemon?.stop();
  });

  test("listed for any reader; a file comes back as bytes, fenced", async () => {
    const list = (await (await send(armToken, "artifacts")).json()) as { artifacts: ArtifactView[] };
    expect(list.artifacts.map((a) => a.id)).toContain(kept.id);
    const md = await send(armToken, "artifactFile", { id: kept.id, path: "report.md" });
    expect(await md.text()).toBe("# Result\n");
    expect(md.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(md.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(md.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await send(armToken, "artifactFile", { id: kept.id, path: "page.html" });
    expect(html.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const stl = await send(armToken, "artifactFile", { id: kept.id, path: "part.stl" });
    expect(stl.headers.get("content-disposition")).toBe('attachment; filename="part.stl"');
    expect((await send(armToken, "artifactFile", { id: kept.id, path: "../manifest.json" })).status).toBe(404);
  });

  test("an agent can't remove kept work; you can", async () => {
    expect((await send(armToken, "removeArtifact", { id: kept.id })).status).toBe(403);
    expect((await send(home.adminToken(), "removeArtifact", { id: kept.id })).status).toBe(200);
    expect((await send(home.adminToken(), "artifactFile", { id: kept.id, path: "report.md" })).status).toBe(404);
  });

  test("this node isn't a sandbox host: saving says so", async () => {
    const response = await send(home.adminToken(), "saveArtifact", { sandbox: "0123456789" });
    expect(response.status).toBe(424);
    expect((await send(home.adminToken(), "saveArtifact", { sandbox: "0123456789", path: "/work/../etc" })).status).toBe(400);
  });
});
