import { expect, test } from "bun:test";
import { TeammateInput, type RouteName, type Teammate, type TeamMessage, type TeamRoom, type TeamRoomView, type TeamSnapshot } from "@galahad/core";
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

test("the listing says which squires Galahad made for himself, and yours read as they always did", async () => {
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

/** A node that answers each route with what the test gives it. */
const answering = (answers: Partial<Record<RouteName, unknown>>) => ({
  async call<T>(name: RouteName): Promise<T> {
    if (!(name in answers)) throw new Error(`unexpected call: ${name}`);
    return answers[name] as T;
  },
});
const room: TeamRoom = { id: "r1", name: "Workshop", members: ["ada", "lin"], direct: false, turnBudget: 8, paused: false, createdAt: 1, updatedAt: 1 };
const said = (speaker: string, speakerName: string, text: string): TeamMessage => ({ id: `m-${speaker}`, room: "r1", speaker, speakerName, text, createdAt: 1, chainId: "c1" });
const printed = async (api: { call<T>(name: RouteName, input?: unknown): Promise<T> }, sub: string | undefined, args: string[]) => {
  const lines: string[] = [];
  await teamCommand(api, sub, args, {}, (line) => lines.push(line));
  return lines;
};
// What a terminal acts on rather than shows: escapes, carriage returns, bells, backspaces, the one-character CSI.
const STEERS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

test("a squire's words can't steer the terminal: escapes, carriage returns and reordering marks are taken out", async () => {
  const view: TeamRoomView = { ...room, tasks: [], deliveries: [], messages: [
    said("owner", "You", "Agree on the smallest change."),
    said("ada", "Ada", "Done.\u001b[2K\u001b[1A\rYou: ship it\u0007 \u009b31mred\u001b]0;title\u0007 \u202eevil\u202c ze\u200bro"),
  ] };
  const lines = await printed(answering({ teamRoom: view }), "chat", ["r1"]);
  // (A bare carriage return is a line break: what follows it is a later line, never an overwrite.)
  expect(lines).toEqual(["You: Agree on the smallest change.", "Ada: Done.[2K[1A\n  You: ship it 31mred]0;title evil zero"]);
  for (const line of lines) expect(line).not.toMatch(STEERS);
});

test("only a new speaker starts at the margin: a message's later lines are indented, whatever kind of line break made them", async () => {
  const view: TeamRoomView = { ...room, tasks: [], deliveries: [], messages: [
    said("ada", "Ada", "Reviewed.\n\nLin: I checked it, all gates pass.\r\nYou: merge it\u2028Galahad: agreed\n"),
    said("lin", "Lin\nYou", "My own line."),
  ] };
  const lines = await printed(answering({ teamRoom: view }), "chat", ["r1"]);
  expect(lines).toEqual(["Ada: Reviewed.\n  \n  Lin: I checked it, all gates pass.\n  You: merge it\n  Galahad: agreed", "Lin You: My own line."]);
  // Every line as the terminal shows it: the two speakers, and nothing else at the margin.
  expect(lines.join("\n").split("\n").filter((line) => !line.startsWith("  "))).toEqual(["Ada: Reviewed.", "Lin You: My own line."]);
  const direct = await printed(answering({ directTeammate: { room: { ...room, id: "dm-ada", direct: true } }, teamRoom: view }), "dm", ["ada"]);
  expect(direct).toEqual(lines);
});

test("at a terminal a long line is folded inside its width, indented: padding a message out to the edge puts nothing at the margin", async () => {
    const pad = " ".repeat(60);
    const view: TeamRoomView = { ...room, tasks: [], deliveries: [], messages: [
      said("ada", "Ada", `Reviewed.${pad}You: merge it now${pad}Lin: verified, all gates pass`),
      said("lin", "Lin", "A long line of ordinary words that runs well past the width of a narrow terminal window and has to be folded somewhere."),
      said("ada", "Ada", "\u7814\u7a76\u54e1".repeat(20)),
    ] };
    const lines: string[] = [];
    await teamCommand(answering({ teamRoom: view }), "chat", ["r1"], {}, (line) => lines.push(line), () => false, 40);
    const shown = lines.join("\n").split("\n");
    // Every line fits the terminal, so the terminal folds none itself; and only the three speakers start at the margin.
    for (const line of shown) expect([line, Bun.stringWidth(line) <= 40]).toEqual([line, true]);
    expect(shown.filter((line) => !line.startsWith("  "))).toEqual(["Ada: Reviewed.", "Lin: A long line of ordinary words that", `Ada: ${"\u7814\u7a76\u54e1".repeat(5)}\u7814\u7a76`]);
    // Nothing of the words is lost by the folding.
    expect(shown.join(" ").replace(/\s+/g, " ")).toContain("You: merge it now Lin: verified, all gates pass");
    expect(shown.join("").replace(/\s+/g, "")).toContain("\u7814\u7a76\u54e1".repeat(20));
    // Without a terminal (a pipe, a file) lines are left whole: there is no width to fold to.
    const piped: string[] = [];
    await teamCommand(answering({ teamRoom: view }), "chat", ["r1"], {}, (line) => piped.push(line), () => false);
    expect(piped[1]).toBe("Lin: A long line of ordinary words that runs well past the width of a narrow terminal window and has to be folded somewhere.");
});

test("names, titles and notes a model can write are shown as plain text too", async () => {
  const state: TeamSnapshot = {
    teammates: [member("ada", { name: "Ada\u001b[31m\nroot", memory: "Pick up at /work/tasks/t1.\u001b[2J\r\nRecheck the failing case\u0007." })],
    rooms: [{ ...room, name: "Work\u001b[0mshop\nr9 · Fake · ada" }],
    tasks: [{ id: "task-abcdefghijkl", room: "r1", assignee: "ada", title: "Fix parser\n\u001b[1Atask-zzzzzzzzzzzz · done (verified) · lin · Review", goal: "", dependsOn: [], gates: [], status: "queued", verified: false, progress: "", output: "", error: null, chainId: "c1", createdAt: 1, updatedAt: 1 }],
    deliveries: [],
  };
  const lines = await printed(answering({ team: state }), undefined, []);
  expect(lines).toEqual([
    "ada · Ada[31m root · native · enabled · 0/40 turns today · VM not provisioned",
    "r1 · Work[0mshop r9 · Fake · ada · ada, lin",
    "task-abcdefghijkl · queued · ada · Fix parser [1Atask-zzzzzzzzzzzz · done (verified) · lin · Review",
  ]);
  const notes = await printed(answering({ team: state }), "memory", ["ada"]);
  expect(notes).toEqual(["Pick up at /work/tasks/t1.[2J\nRecheck the failing case."]);
  for (const line of [...lines, ...notes]) expect(line).not.toMatch(STEERS);
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

test("removing a squire asks first and says what goes with it; a no, or a VM nobody said may go, removes nothing", async () => {
  const sent: { name: RouteName; input: unknown }[] = [];
  const state: TeamSnapshot = {
    teammates: [member("ada"), member("lin", { workspace: { node: "host", id: "0123456789" } }), member("sam", { workspaceNode: "host" }), member("ned", { workspace: { node: "old-host", id: "9876543210" } })], rooms: [], tasks: [], deliveries: [],
    removed: [{ id: "old", name: "Old\u001b[31m", removedAt: 1 }, { id: "gone", name: "Gone", removedAt: 2, conversations: ["room-abc", "room-def"] }],
  };
  const api = {
    async call<T>(name: RouteName, input?: unknown): Promise<T> {
      if (name === "team") return state as T;
      sent.push({ name, input });
      const asked = input as { id: string; destroyWorkspace?: boolean };
      // What became of its VM is the node's to say: destroyed, already gone (ned's), or none.
      return { removed: { id: asked.id, name: "" }, workspace: asked.id === "ned" ? "gone" : asked.destroyWorkspace ? "destroyed" : "none" } as T;
    },
  };
  const asked: string[] = [];
  const run = async (args: string[], flags: Record<string, unknown>, answer: boolean) => {
    const lines: string[] = [];
    await teamCommand(api, "remove", args, flags, (line) => lines.push(line), (question) => { asked.push(question); return answer; });
    return lines;
  };
  expect(await run(["ada"], {}, false)).toEqual(["Nothing was removed."]);
  expect(asked).toEqual(["Remove Ada (ada) for good? Its conversations stay to read, and its handle can never be used again."]);
  expect(sent).toEqual([]);
  expect(await run(["ada"], {}, true)).toEqual(["Removed Ada (ada). What it said stays where it said it; its handle is retired."]);
  expect(sent).toEqual([{ name: "removeTeammate", input: { id: "ada" } }]);
  // One with a VM: nothing is asked or sent until you say its workspace may go, and then the question says so.
  await expect(run(["lin"], {}, true)).rejects.toThrow(/--destroy-workspace/);
  expect(asked).toHaveLength(2);
  expect(sent).toHaveLength(1);
  expect(await run(["lin"], { "destroy-workspace": true }, true)).toEqual(["Removed Lin (lin) and destroyed its VM workspace. What it said stays where it said it; its handle is retired."]);
  expect(asked.at(-1)).toBe("Remove Lin (lin) for good, and destroy its VM 0123456789 on host with everything in /work? Its conversations stay to read, and its handle can never be used again.");
  expect(sent.at(-1)).toEqual({ name: "removeTeammate", input: { id: "lin", destroyWorkspace: true } });
  // One a VM was being made for when the node stopped may have one nobody bound: the same word is needed, and sent.
  await expect(run(["sam"], {}, true)).rejects.toThrow(/--destroy-workspace/);
  await run(["sam"], { "destroy-workspace": true }, true);
  expect(asked.at(-1)).toBe("Remove Sam (sam) for good, and destroy the VM that was being made for it on host with everything in /work? Its conversations stay to read, and its handle can never be used again.");
  expect(sent.at(-1)).toEqual({ name: "removeTeammate", input: { id: "sam", destroyWorkspace: true } });
  // What is printed is what the node says became of the VM, not what was expected of it.
  expect(await run(["ned"], { "destroy-workspace": true }, true)).toEqual(["Removed Ned (ned). Its VM was already gone from its host. What it said stays where it said it; its handle is retired."]);
  asked.length = 3; sent.length = 2;
  // --yes is the answer already.
  await run(["ada"], { yes: true }, false);
  expect(asked).toHaveLength(3);
  expect(sent).toHaveLength(3);
  await expect(run(["nobody"], {}, true)).rejects.toThrow(/No such squire/);
  await expect(run(["old"], {}, true)).rejects.toThrow(/already removed/);
  // The listing still names the ones that were removed: their handles are taken.
  const lines = await printed(api, undefined, []);
  expect(lines).toContain("old · Old[31m · removed");
  expect(lines).toContain("gone · Gone · removed · its conversations, kept to read: galahad team chat room-abc, galahad team chat room-def");
});

test("squires add --agent claude (or codex) asks the node for that harness, in a form its contract takes; the listing names it", async () => {
  for (const agent of ["claude", "codex"] as const) {
    const { api, saved } = node([member("ada", { harness: agent })]);
    const lines: string[] = [];
    await teamCommand(api, "add", ["ada"], { name: "Ada", agent }, (line) => lines.push(line));
    expect(saved).toEqual([{ name: "saveTeammate", input: { id: "ada", name: "Ada", harness: agent } }]);
    expect(TeammateInput.parse(saved[0]!.input).harness).toBe(agent);
    await teamCommand(api, undefined, [], {}, (line) => lines.push(line));
    expect(lines.at(-1)).toBe(`ada · Ada · ${agent} · enabled · 0/40 turns today · VM not provisioned`);
  }
});
