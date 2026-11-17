import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ScreenAction, ScreenStatus, ScreenView } from "@galahad/core";

/*
 * A Mac's own screen, for Galahad (docs/MAC.md, the Mac itself): the app's own binary takes its pictures and moves its
 * pointer and keys (`Galahad --desktop`, apps/apple/Galahad/Mac/MacScreen.swift), so it is the app macOS asks you to
 * allow, once, in System Settings (Screen & System Audio Recording, and Accessibility). Only a node the app runs (its
 * Bun inside the app's bundle) has one; any other has none.
 */

/** How the helper's run went: its exit (0, 1 failed, 2 refused or asked wrongly) and what it printed. */
export interface HelperRan {
  code: number;
  stdout: string;
  stderr: string;
}
export type HelperRun = (args: string[], timeoutMs: number) => Promise<HelperRan>;

/** The app's own binary, beside the Bun this node runs on (`<App>/Contents/Helpers/bun`): null off a Mac, or outside the app. */
export function screenHelper(execPath = process.execPath, platform: string = process.platform, exists: (path: string) => boolean = existsSync): string | null {
  if (platform !== "darwin") return null;
  const helpers = dirname(execPath);
  if (!helpers.endsWith("/Contents/Helpers")) return null;
  const binary = join(dirname(helpers), "MacOS", "Galahad");
  return exists(binary) ? binary : null;
}

/** The helper, run as a process of this node's (so what macOS allows the app, it allows here), killed at its deadline. */
export function spawnHelper(binary: string): HelperRun {
  return async (args, timeoutMs) => {
    const proc = Bun.spawn([binary, "--desktop", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => proc.kill(9), timeoutMs);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  };
}

export class ScreenError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The helper's arguments for one thing done on the screen (`look`: none). Typed text goes as base64, as one argument. */
export function screenArgs(action: ScreenAction): string[] | null {
  switch (action.do) {
    case "look":
      return null;
    case "click":
      return ["click", String(action.x), String(action.y), action.button ?? "left"];
    case "move":
      return ["move", String(action.x), String(action.y)];
    case "scroll":
      return ["scroll", action.direction, String(action.times ?? 3)];
    case "type":
      return ["type", Buffer.from(action.text, "utf8").toString("base64")];
    case "key":
      return ["key", ...action.keys];
    case "open":
      return ["open", action.address];
    case "app":
      return ["open", action.name];
  }
}

/** What a thing done on the screen says in the ledger: what was done, and of typing only how much. */
export function screenDid(action: ScreenAction): string | null {
  switch (action.do) {
    case "look":
      return null;
    case "type":
      return `type (${[...action.text].length} characters, not recorded)`;
    case "app":
      return `open the app ${action.name}`;
    default:
      return screenArgs(action)!.join(" ");
  }
}

export class MacScreen {
  /** How long the screen is given to show what was done before its picture is taken. */
  private readonly settleMs: number;

  constructor(
    private readonly run: HelperRun,
    opts: { settleMs?: number } = {},
  ) {
    this.settleMs = opts.settleMs ?? 350;
  }

  private async helper(args: string[], timeoutMs = 20_000): Promise<string> {
    const ran = await this.run(args, timeoutMs);
    if (ran.code === 0) return ran.stdout;
    const said = ran.stderr.trim().split("\n")[0] || `the screen's helper ended with ${ran.code}`;
    throw new ScreenError(ran.code === 2 ? 424 : 502, said);
  }

  /** Its size in points, what macOS lets Galahad do with it, and what is in front. */
  async status(): Promise<Omit<ScreenStatus, "node">> {
    const said = JSON.parse(await this.helper(["status"])) as Partial<Omit<ScreenStatus, "node">>;
    if (typeof said.width !== "number" || typeof said.height !== "number") throw new ScreenError(502, "the screen's helper didn't say its size");
    return { width: said.width, height: said.height, record: said.record === true, control: said.control === true, front: typeof said.front === "string" ? said.front.slice(0, 200) : "" };
  }

  /** Shows macOS's own prompts on this Mac's screen (or lists the app in System Settings), for you to answer there. */
  async allow(): Promise<Omit<ScreenStatus, "node">> {
    await this.helper(["allow"]);
    return this.status();
  }

  /** A picture of the screen, at its size in points. */
  async look(): Promise<ScreenView> {
    const status = await this.status();
    const data = (await this.helper(["shot"], 30_000)).trim();
    if (!data) throw new ScreenError(502, "the screen's helper gave no picture");
    return { shot: { mediaType: "image/jpeg", data }, width: status.width, height: status.height };
  }

  /** One thing done there, then a picture of what it did. */
  async act(action: ScreenAction): Promise<ScreenView> {
    const args = screenArgs(action);
    if (args) {
      await this.helper(args);
      await Bun.sleep(this.settleMs);
    }
    return this.look();
  }
}
