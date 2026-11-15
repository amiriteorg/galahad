import { expect, spyOn, test } from "bun:test";
import type { LoopDraftView, RouteName } from "@galahad/core";
import { loopCommand } from "../src/loop-cli.ts";

/* `galahad loop drafts`, `loop add --draft` and `loop dismiss` at a terminal, against what the node would answer. */

const draft: LoopDraftView = {
  id: "ld_AAAAAAAAAAAAAAAAAAAAAA",
  name: "pr-check",
  schedule: "0 8 * * 1-5",
  tz: "Europe/Copenhagen",
  on: null,
  task: { kind: "call", connector: "github", tool: "pulls", args: { owner: "amiriteorg", repo: "galahad" } },
  label: "Open pull requests, each weekday",
  why: "You asked to see the open pull requests every weekday at 8.",
  by: "galahad",
  at: 1,
  expires: 2,
  replaces: false,
};

function node(drafts: LoopDraftView[] = [draft]) {
  const asked: { name: RouteName; input: unknown }[] = [];
  const api = {
    async call<T>(name: RouteName, input?: unknown): Promise<T> {
      asked.push({ name, input });
      if (name === "loopDrafts") return { drafts } as T;
      if (name === "setLoop") return { loop: { name: draft.name, schedule: draft.schedule, tz: draft.tz, onName: "keep", task: draft.task, next: null } } as T;
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

test("the drafts are listed with what each would do and why, and how to add or dismiss one", async () => {
  const lines = await printed(() => loopCommand(node().api, "drafts", [], {}));
  expect(lines.join("\n")).toContain("ld_AAAAAAAAAAAAAAAAAAAAAA  pr-check: 0 8 * * 1-5 (Europe/Copenhagen)");
  expect(lines.join("\n")).toContain("call github.pulls owner=amiriteorg repo=galahad");
  expect(lines.join("\n")).toContain("why: You asked to see the open pull requests every weekday at 8.");
  expect(lines.at(-1)).toContain("galahad loop add --draft <id>");
  expect(await printed(() => loopCommand(node([]).api, "drafts", [], {}))).toEqual(["No drafts. Ask Galahad in chat for something on a schedule, and his draft waits here for you."]);
});

test("a draft is added as he drafted it, naming the draft so it leaves the Inbox; where it runs may still be given", async () => {
  const { api, asked } = node();
  await printed(() => loopCommand(api, "add", [], { draft: draft.id, on: "ultra" }));
  expect(asked.at(-1)).toEqual({
    name: "setLoop",
    input: { name: "pr-check", schedule: "0 8 * * 1-5", tz: "Europe/Copenhagen", task: draft.task, on: "ultra", label: "Open pull requests, each weekday", draft: draft.id },
  });
});

test("a draft that's gone says so, and adds nothing; dismissing one asks the node to drop it", async () => {
  const { api, asked } = node([]);
  await expect(loopCommand(api, "add", [], { draft: draft.id })).rejects.toThrow(/no draft ld_A+ \(it was added, dismissed, or a week went by\)/);
  expect(asked.map((a) => a.name)).toEqual(["loopDrafts"]);
  await printed(() => loopCommand(api, "dismiss", [draft.id], {}));
  expect(asked.at(-1)).toEqual({ name: "dismissLoopDraft", input: { id: draft.id } });
});
