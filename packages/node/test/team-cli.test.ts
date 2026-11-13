import { expect, test } from "bun:test";
import type { RouteName, Teammate, TeamSnapshot } from "@galahad/core";
import { defaultAvatar } from "@galahad/core/avatar";
import { teamCommand } from "../src/team-cli.ts";

/* `galahad team` at a terminal, against what the node would answer. */

const member = (id: string, over: Partial<Teammate> = {}): Teammate => ({ id, name: id[0]!.toUpperCase() + id.slice(1), instructions: "", role: "engineer", harness: "native", enabled: true, dailyTurns: 40, turnsToday: 0, repository: null, workspaceNode: null, workspace: null, memory: "", avatar: defaultAvatar(id), createdBy: "owner", instructionsBy: "owner", createdAt: 1, updatedAt: 1, ...over });
function node(teammates: Teammate[]) {
  const saved: { name: RouteName; input: any }[] = [];
  const state: TeamSnapshot = { teammates, rooms: [], tasks: [], deliveries: [] };
  const api = {
    async call<T>(name: RouteName, input?: unknown): Promise<T> {
      if (name === "team") return state as T;
      saved.push({ name, input });
      const asked = input as { id: string; avatar: Teammate["avatar"] | null };
      return { teammate: { ...teammates.find((t) => t.id === asked.id)!, avatar: asked.avatar ?? defaultAvatar(asked.id) } } as T;
    },
  };
  return { api, saved };
}

test("the listing says which workers Galahad made for himself, and yours read as they always did", async () => {
  const lines: string[] = [];
  const { api } = node([member("ada"), member("scout", { createdBy: "galahad" }), member("rev", { createdBy: "ada", enabled: false }), member("old", { createdBy: undefined })]);
  await teamCommand(api, undefined, [], {}, (line) => lines.push(line));
  expect(lines).toEqual([
    "ada · Ada · native · enabled · 0/40 turns today · VM not provisioned",
    "scout · Scout · native · enabled · 0/40 turns today · VM not provisioned · made by Galahad",
    "rev · Rev · native · paused · 0/40 turns today · VM not provisioned · made by ada",
    "old · Old · native · enabled · 0/40 turns today · VM not provisioned",
  ]);
});

test("a new body color brings its matching accent; an accent you name, or chose apart before, is kept", async () => {
  const sand = { ...defaultAvatar("ada"), color: "#e8c8a5", accent: "#b58b69" };
  const { api, saved } = node([member("ada", { avatar: sand })]);
  const quiet = () => {};
  await teamCommand(api, "avatar", ["ada"], { color: "#A8C9DB" }, quiet);
  expect(saved.at(-1)).toEqual({ name: "saveTeammate", input: { id: "ada", name: "Ada", avatar: { ...sand, color: "#a8c9db", accent: "#638cb5" } } });
  await teamCommand(api, "avatar", ["ada"], { color: "#a8c9db", accent: "#112233" }, quiet);
  expect(saved.at(-1)!.input.avatar).toEqual({ ...sand, color: "#a8c9db", accent: "#112233" });
  await teamCommand(api, "avatar", ["ada"], { form: "round" }, quiet);
  expect(saved.at(-1)!.input.avatar).toEqual({ ...sand, form: "round" });
  // What isn't a color is the node's to refuse, as it was: nothing here guesses at it.
  await teamCommand(api, "avatar", ["ada"], { color: "blue" }, quiet);
  expect(saved.at(-1)!.input.avatar).toEqual({ ...sand, color: "blue" });
  await teamCommand(api, "avatar", ["ada"], { reset: true }, quiet);
  expect(saved.at(-1)!.input.avatar).toBeNull();
  const apart = node([member("ada", { avatar: { ...sand, accent: "#3355aa" } })]);
  await teamCommand(apart.api, "avatar", ["ada"], { color: "#a8c9db" }, quiet);
  expect(apart.saved.at(-1)!.input.avatar).toEqual({ ...sand, color: "#a8c9db", accent: "#3355aa" });
  // Reading it changes nothing.
  const before = saved.length;
  await teamCommand(api, "avatar", ["ada"], {}, quiet);
  expect(saved).toHaveLength(before);
});
