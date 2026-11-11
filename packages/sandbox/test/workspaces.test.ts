import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetProblem, parseStats, WorkspaceHelper, type WorkspaceStats } from "../src/index.ts";

/*
 * Sandbox disk limits: the helper's answers, the budget rule, and the client that
 * talks to the helper over its socket (against a stand-in on a temp socket).
 */

const GIB = 2 ** 30;
const disk = (freeGb: number, images: [number, number][] = [], totalGb = 1800): WorkspaceStats => ({
  totalBytes: totalGb * GIB,
  freeBytes: freeGb * GIB,
  images: images.map(([size, used], i) => ({ id: `${i}`.padStart(10, "0"), sizeBytes: size * GIB, usedBytes: used * GIB, mounted: true, createdAt: 0 })),
});

describe("the helper's stats", () => {
  test("parse: the filesystem, then one line per workspace; junk is ignored", () => {
    const stats = parseStats("ok 1932735283200 1717986918400\n0123456789 21474836480 1048576 1 1762780000\n../etc 1 1 1 1\n\n");
    expect(stats).toEqual({
      totalBytes: 1932735283200,
      freeBytes: 1717986918400,
      images: [{ id: "0123456789", sizeBytes: 21474836480, usedBytes: 1048576, mounted: true, createdAt: 1762780000000 }],
    });
    expect(() => parseStats("error cannot prepare")).toThrow(/unexpected stats/);
  });
});

describe("the disk budget", () => {
  test("a workspace fits when every other one could fill up and the reserve stays free", () => {
    expect(budgetProblem(disk(1600), 20)).toBeNull();
    // 1800 GB disk → 180 GB reserve. 300 GB free, two workspaces promised 100 GB more growth: 20 GB left.
    expect(budgetProblem(disk(300, [[60, 10], [60, 10]]), 20)).toBeNull();
    expect(budgetProblem(disk(300, [[60, 10], [60, 10]]), 21)).toMatch(/doesn't fit: 20 GB is left .* 180 GB stays free/);
  });
  test("used space is already counted as used: only the growth still to come is promised", () => {
    expect(budgetProblem(disk(250, [[50, 50]]), 50)).toBeNull();
    expect(budgetProblem(disk(250, [[50, 0]]), 50)).not.toBeNull();
  });
  test("small disks keep at least 20 GB free", () => {
    expect(budgetProblem(disk(40, [], 100), 20)).toBeNull();
    expect(budgetProblem(disk(39, [], 100), 20)).not.toBeNull();
  });
});

const unixSockets = process.platform !== "win32";
describe.skipIf(!unixSockets)("talking to the helper", () => {
  // A skipped block's body still runs (to collect it) but its afterAll doesn't: set nothing up.
  if (!unixSockets) return;
  const dir = mkdtempSync(join(tmpdir(), "galahad-ws-"));
  const path = join(dir, "helper.sock");
  const heard: string[] = [];
  const server = Bun.listen({
    unix: path,
    socket: {
      data(socket, chunk) {
        const line = new TextDecoder().decode(chunk).trim();
        heard.push(line);
        const [verb, id] = line.split(" ");
        socket.end(
          verb === "ping" ? "ok\n"
          : verb === "create" ? `ok /var/lib/galahad-workspaces/${id}\n`
          : verb === "stats" ? "ok 100 50\n0123456789 10 1 1 1762780000\n"
          : verb === "remove" && id === "ffffffffff" ? "error cannot unmount\n"
          : "ok\n",
        );
      },
    },
  });
  afterAll(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("one line out, the answer back; refusals become errors", async () => {
    const helper = new WorkspaceHelper(path, 5000);
    expect(await helper.available()).toBe(true);
    expect(await helper.create("0123456789", 20)).toBe("/var/lib/galahad-workspaces/0123456789");
    expect((await helper.stats()).images[0]!.id).toBe("0123456789");
    await helper.remove("0123456789");
    await expect(helper.remove("ffffffffff")).rejects.toThrow(/cannot unmount/);
    expect(heard).toEqual(["ping", "create 0123456789 20", "stats", "remove 0123456789", "remove ffffffffff"]);
  });

  test("nothing that isn't an id or a size is ever sent", async () => {
    const helper = new WorkspaceHelper(path, 5000);
    const before = heard.length;
    await expect(helper.create("../../etc", 20)).rejects.toThrow(/bad workspace/);
    await expect(helper.create("0123456789", 1.5)).rejects.toThrow(/bad workspace/);
    await expect(helper.remove("0123456789 ; rm -rf /")).rejects.toThrow(/bad workspace/);
    expect(heard).toHaveLength(before);
  });

  test("no helper: not available, so sandboxes fall back to unlimited volumes (and the heartbeat says so)", async () => {
    expect(await new WorkspaceHelper(join(dir, "missing.sock"), 1000).available()).toBe(false);
  });
});
