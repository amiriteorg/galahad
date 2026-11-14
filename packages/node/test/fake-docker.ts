import type { DockerRunner } from "@galahad/sandbox";

/*
 * A stand-in for Docker, for tests on machines without one: it answers the commands
 * the sandbox host runs (info, inspect, run, ps, exec, stop, start, rename, rm, volumes, networks) from
 * memory, so the real host's own logic (labels, the ledger, the oath gate, reaping)
 * runs unchanged above it. Nothing is spawned.
 */

interface Container {
  name: string;
  image: string;
  labels: Record<string, string>;
  status: string;
}

export interface FakeDocker {
  runner: DockerRunner;
  /** Every `docker exec` command, as the sandbox ran it (after its timeout wrapper). */
  execs: { container: string; cmd: string[] }[];
  /** Containers alive now, and the most there ever were at once. */
  running(): number;
  peak(): number;
  /** How `docker exec` answers (default: exit 0, nothing printed). */
  onExec?: (container: string, cmd: string[]) => Promise<{ code: number; stdout: string; stderr?: string }> | { code: number; stdout: string; stderr?: string };
  /** How long `docker run` takes (ms). */
  startMs: number;
}

export function fakeDocker(): FakeDocker {
  const containers = new Map<string, Container>();
  let peak = 0;
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
  const no = (stderr = "No such object") => ({ code: 1, stdout: "", stderr });
  const fake: FakeDocker = {
    execs: [],
    startMs: 0,
    running: () => [...containers.values()].filter((c) => c.status === "running").length,
    peak: () => peak,
    runner: async (args) => {
      const [command, ...rest] = args;
      switch (command) {
        case "info":
          return ok("27.0.0-fake");
        case "image":
          return rest[0] === "inspect" ? ok("sha256:fake") : no();
        case "network":
          return ok("net");
        case "volume":
          return ok();
        case "container":
          // Keeper containers (image pins): none here.
          return no();
        case "create":
          return ok("keeper");
        case "build":
          return ok("built");
        case "run": {
          if (fake.startMs) await Bun.sleep(fake.startMs);
          const name = rest[rest.indexOf("--name") + 1]!;
          const labels: Record<string, string> = {};
          for (let i = 0; i < rest.length; i++) {
            if (rest[i] !== "--label") continue;
            const [key, ...value] = rest[i + 1]!.split("=");
            labels[key!] = value.join("=");
          }
          // The image comes before the command (`sleep infinity`).
          const image = rest[rest.length - 3]!;
          containers.set(name, { name, image, labels, status: "running" });
          peak = Math.max(peak, fake.running());
          return ok(name);
        }
        case "ps": {
          const wanted = rest.filter((_, i) => rest[i - 1] === "--filter").map((f) => f.replace(/^label=/, ""));
          const matching = [...containers.values()].filter((c) => wanted.every((w) => {
            const [key, ...value] = w.split("=");
            return c.labels[key!] === value.join("=");
          }));
          if (rest.includes("--format")) return ok(matching.map((c) => c.labels["dev.galahad.id"] ?? "").join("\n"));
          return ok(matching.map((c) => c.name).join("\n"));
        }
        case "inspect": {
          const found = rest.map((name) => containers.get(name)).filter((c): c is Container => !!c);
          if (!found.length) return no();
          return ok(JSON.stringify(found.map((c) => ({ Config: { Labels: c.labels, Image: c.image }, State: { Status: c.status } }))));
        }
        case "exec": {
          const at = rest.findIndex((a) => a.startsWith("galahad-sbx-"));
          const container = rest[at]!;
          if (!containers.has(container)) return no(`No such container: ${container}`);
          // After the container: timeout --signal=KILL <n>s <cmd…>
          const cmd = rest.slice(at + 4);
          fake.execs.push({ container, cmd });
          const answer = (await fake.onExec?.(container, cmd)) ?? { code: 0, stdout: "" };
          return { code: answer.code, stdout: answer.stdout, stderr: answer.stderr ?? "" };
        }
        case "stop":
        case "start": {
          const container = containers.get(rest.at(-1)!);
          if (!container) return no(`No such container: ${rest.at(-1)}`);
          container.status = command === "stop" ? "exited" : "running";
          return ok(container.name);
        }
        case "rename": {
          const [from, to] = rest as [string, string];
          const container = containers.get(from);
          if (!container || containers.has(to)) return no(container ? `the name ${to} is in use` : `No such container: ${from}`);
          containers.delete(from);
          containers.set(to, { ...container, name: to });
          return ok();
        }
        case "rm": {
          const name = rest.at(-1)!;
          containers.delete(name);
          return ok(name);
        }
        default:
          return no(`fake docker doesn't know "${command}"`);
      }
    },
  };
  return fake;
}
