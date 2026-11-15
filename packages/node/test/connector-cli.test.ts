import { expect, spyOn, test } from "bun:test";
import type { ConnectorRequestView, RouteName } from "@galahad/core";
import { connectorCommand } from "../src/loop-cli.ts";

/* `galahad connector requests` and `connector dismiss` at a terminal, against what the node would answer. */

const github: ConnectorRequestView = { id: "cr_AAAAAAAAAAAAAAAAAAAAAA", connector: "github", label: "GitHub", why: "To read the failing checks on your pull request.", by: "Kay", at: 1, expires: 2 };
const slack: ConnectorRequestView = { id: "cr_BBBBBBBBBBBBBBBBBBBBBB", connector: "slack", label: null, why: "To post the release notes.", by: "Galahad", at: 1, expires: 2 };

function node(requests: ConnectorRequestView[] = [github, slack]) {
  const asked: { name: RouteName; input: unknown }[] = [];
  const api = {
    async call<T>(name: RouteName, input?: unknown): Promise<T> {
      asked.push({ name, input });
      if (name === "connectorRequests") return { requests } as T;
      return { ok: true } as T;
    },
  };
  return { api, asked };
}

async function printed(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...parts: unknown[]) => void lines.push(parts.join(" ")));
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

test("what agents asked you to connect: who asked, which and why, and how to add each (one Galahad ships, or as an MCP server)", async () => {
  const { api, asked } = node();
  const text = (await printed(() => connectorCommand(api, "requests", [], {}))).join("\n");
  expect(text).toContain("cr_AAAAAAAAAAAAAAAAAAAAAA  GitHub, asked by Kay");
  expect(text).toContain("why: To read the failing checks on your pull request.");
  expect(text).toContain("add it: galahad connector add github");
  expect(text).toContain("cr_BBBBBBBBBBBBBBBBBBBBBB  slack, asked by Galahad");
  expect(text).toContain("galahad connector add slack --mcp <url>");
  expect(text).toContain("galahad connector dismiss <id>");
  expect(asked.map((a) => a.name)).toEqual(["connectorRequests"]);
});

test("with none asked it says so; dismissing one sends its id and adds nothing", async () => {
  const { api, asked } = node([]);
  expect((await printed(() => connectorCommand(api, "requests", [], {}))).join("\n")).toContain("No agent is asking for a connector");
  expect((await printed(() => connectorCommand(api, "dismiss", [github.id], {}))).join("\n")).toContain("Nothing was added");
  expect(asked.at(-1)).toEqual({ name: "dismissConnectorRequest", input: { id: github.id } });
  await expect(connectorCommand(api, "dismiss", [], {})).rejects.toThrow(/usage: galahad connector dismiss <request id>/);
});
