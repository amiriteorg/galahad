import { describe, expect, test } from "bun:test";
import { CONTAINER_UNMADE, type DockerRunner, probeContainer } from "../src/index.ts";

/*
 * How a Mac finds Apple's container: its binary, then `container system version --format json`, whose API server row
 * is there only when its service answered (the documentation's own sample, command-reference.md at 1.7.1), then
 * whether the sandbox image and the gateway network are there. Nothing is made or changed by looking.
 */

const SAMPLE = `[
  {
    "appName": "container",
    "buildType": "debug",
    "commit": "abcdef1",
    "version": "1.2.3"
  },
  {
    "appName": "container-apiserver",
    "buildType": "release",
    "commit": "1234abcdef",
    "version": "container-apiserver version 1.2.3 (build: release, commit: 1234abc)"
  }
]`;

function answering(over: { version?: string; image?: boolean; network?: boolean } = {}) {
  const asked: string[][] = [];
  const runner: DockerRunner = async (args) => {
    asked.push(args);
    if (args[0] === "system") return { code: 0, stdout: over.version ?? SAMPLE, stderr: "" };
    if (args[0] === "image") return over.image === false ? { code: 1, stdout: "", stderr: "image not found" } : { code: 0, stdout: "[]", stderr: "" };
    if (args[0] === "network") return over.network === false ? { code: 1, stdout: "", stderr: "network not found" } : { code: 0, stdout: "[]", stderr: "" };
    return { code: 1, stdout: "", stderr: "not asked for" };
  };
  return { runner, asked };
}

describe("finding Apple's container on a Mac", () => {
  test("its service answering, at 1.x: a sandbox host whose every sandbox is a VM, that can't grow one live, and says what it won't make", async () => {
    const { runner, asked } = answering();
    expect(await probeContainer(runner)).toEqual({
      container: { version: "1.2.3", running: true },
      sandbox: { image: true, networks: true, vm: true, engine: "container", cannot: [...CONTAINER_UNMADE], grows: false },
    });
    // Only looked: nothing made, nothing started.
    expect(asked).toEqual([["system", "version", "--format", "json"], ["image", "inspect", "galahad/sandbox:1"], ["network", "inspect", "galahad-gw"], ["network", "inspect", "galahad-net"]]);
  });

  test("its image not built, or its network not made yet: a host that says so (the node makes the network as it starts)", async () => {
    const probed = await probeContainer(answering({ image: false, network: false }).runner);
    expect(probed?.sandbox).toMatchObject({ image: false, networks: false });
  });

  test("its service not running: found, said so, and no sandbox host", async () => {
    const cliAlone = JSON.stringify([{ appName: "container", buildType: "release", commit: "abcdef1", version: "1.7.1" }]);
    expect(await probeContainer(answering({ version: cliAlone }).runner)).toEqual({ container: { version: "1.7.1", running: false }, sandbox: null });
  });

  test("a major release this node doesn't speak, or an answer it can't read: no sandbox host", async () => {
    const two = JSON.stringify([{ appName: "container", version: "2.0.0" }, { appName: "container-apiserver", version: "container-apiserver version 2.0.0" }]);
    expect(await probeContainer(answering({ version: two }).runner)).toEqual({ container: { version: "2.0.0", running: true }, sandbox: null });
    expect(await probeContainer(answering({ version: "garbled" }).runner)).toEqual({ container: { version: null, running: false }, sandbox: null });
  });
});
