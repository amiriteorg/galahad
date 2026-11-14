import { plainLine, type RouteName, TERMINAL_ID, type TeamSnapshot, type TerminalEvent, type TerminalView } from "@galahad/core";

/*
 * `galahad terminal`: a shell in a knight's VM or a sandbox, on a real terminal, from this one. What you type goes to
 * the node in order, one request at a time, and what you type meanwhile goes next, together; what it shows comes back
 * as it comes. Ctrl-] leaves: a terminal opened here is closed with it, one taken up from elsewhere is left open.
 */

export interface TerminalApi {
  call<T>(name: RouteName, input?: unknown): Promise<T>;
  stream<T>(name: RouteName, input: unknown, signal?: AbortSignal): AsyncGenerator<T>;
}

/** This terminal, as the command uses it (a test passes a stand-in). */
export interface Screen {
  size(): { cols: number; rows: number };
  /** Keys as typed, raw, until the returned function is called (which gives the terminal back as it was). */
  keys(onKeys: (data: string) => void): () => void;
  onResize(listener: () => void): () => void;
  write(bytes: Uint8Array): void;
  /** A line of its own, beside the shell's. */
  say(line: string): void;
}

const LEAVE = "\x1d";
const USAGE = "usage: galahad terminal <knight|sandbox> | terminal attach <terminal> | terminal close <terminal> | terminal ls";

/** A size the node takes: this terminal's, within the bounds a terminal has. */
const sizeOf = (screen: Screen) => {
  const { cols, rows } = screen.size();
  return { cols: Math.min(500, Math.max(10, cols || 80)), rows: Math.min(200, Math.max(4, rows || 24)) };
};

export async function terminalCommand(api: TerminalApi, sub: string | undefined, rest: string[], screen: Screen, print: (line: string) => void): Promise<number> {
  if (sub === undefined || sub === "ls") {
    const { terminals } = await api.call<{ terminals: TerminalView[] }>("terminals");
    if (!terminals.length) print("No terminals open on this node. Open one with galahad terminal <knight|sandbox>.");
    for (const t of terminals) print(`${t.id} · ${plainLine(t.name)} · ${t.exitCode === null ? `${t.cols}×${t.rows}${t.watchers ? ` · watched by ${t.watchers}` : ""}` : `its shell ended (exit ${t.exitCode})`}`);
    return 0;
  }
  if (sub === "close" || sub === "attach") {
    const id = rest[0];
    if (!id || !TERMINAL_ID.test(id)) throw new Error(USAGE);
    if (sub === "attach") return attach(api, id, screen, false);
    await api.call("closeTerminal", { terminal: id });
    return 0;
  }
  const { terminal } = await api.call<{ terminal: TerminalView }>("openTerminal", { sandbox: await sandboxOf(api, sub), size: sizeOf(screen) });
  return attach(api, terminal.id, screen, true);
}

/** A sandbox's id as given, or the VM of the knight named (by handle or name). */
async function sandboxOf(api: TerminalApi, target: string): Promise<string> {
  if (/^[a-f0-9]{10}$/.test(target)) return target;
  const { teammates } = await api.call<TeamSnapshot>("team");
  const knight = teammates.find((m) => m.id === target || m.name.toLowerCase() === target.toLowerCase());
  if (!knight) throw new Error(`no knight or sandbox "${plainLine(target)}": galahad roundtable lists the knights, galahad sandbox ls the sandboxes`);
  if (!knight.workspace) throw new Error(`${plainLine(knight.name)} has no VM yet: galahad roundtable provision ${knight.id}`);
  return knight.workspace.id;
}

async function attach(api: TerminalApi, id: string, screen: Screen, opened: boolean): Promise<number> {
  screen.say(`[terminal ${id} · Ctrl-] leaves${opened ? " and closes it" : ", leaving it open"}]`);
  const stop = new AbortController();
  let left = false;
  let typed = "";
  let size: { cols: number; rows: number } | null = opened ? null : sizeOf(screen);
  let sending: Promise<void> | null = null;
  let failed: unknown = null;
  /** Send what waits (keys typed, a new size), if nothing is on its way; what comes meanwhile goes next. */
  const flush = (): void => {
    if (sending || (!typed && !size)) return;
    const data = typed.slice(0, 65_536);
    typed = typed.slice(data.length);
    const input = { terminal: id, ...(data ? { data } : {}), ...(size ? { size } : {}) };
    size = null;
    sending = api.call("terminalInput", input).then(
      () => {
        sending = null;
        flush();
      },
      (error: unknown) => {
        sending = null;
        failed = error;
        stop.abort();
      },
    );
  };
  const stopKeys = screen.keys((data) => {
    const at = data.indexOf(LEAVE);
    typed += at >= 0 ? data.slice(0, at) : data;
    flush();
    if (at >= 0) {
      left = true;
      stop.abort();
    }
  });
  const stopResize = screen.onResize(() => {
    size = sizeOf(screen);
    flush();
  });
  flush();
  let code: number | null = null;
  try {
    for await (const event of api.stream<TerminalEvent>("watchTerminal", { terminal: id }, stop.signal)) {
      if (event.type === "output") screen.write(Buffer.from(event.data, "base64"));
      else {
        code = event.code;
        break;
      }
    }
  } catch (error) {
    if (!stop.signal.aborted) throw error;
  } finally {
    stopKeys();
    stopResize();
  }
  // What was typed before leaving reaches it first.
  while (sending) await sending;
  if (failed && !left && code === null) throw failed;
  if (left) {
    if (opened) await api.call("closeTerminal", { terminal: id }).catch(() => {});
    screen.say(opened ? "[left: the terminal is closed]" : `[left: it is still open · galahad terminal attach ${id}]`);
    return 0;
  }
  if (code === null) {
    screen.say(`[the node let go of this terminal: take it up again with galahad terminal attach ${id}]`);
    return 1;
  }
  screen.say(`[its shell ended: exit ${code}]`);
  return code;
}

/** This process's own terminal: raw keys while attached, and given back as it was. */
export function ttyScreen(dim: (s: string) => string): Screen {
  return {
    size: () => ({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 }),
    keys(onKeys) {
      const raw = process.stdin.isTTY === true;
      if (raw) process.stdin.setRawMode(true);
      const decoder = new TextDecoder();
      const listener = (chunk: Buffer) => onKeys(decoder.decode(chunk, { stream: true }));
      process.stdin.on("data", listener);
      process.stdin.resume();
      return () => {
        process.stdin.off("data", listener);
        if (raw) process.stdin.setRawMode(false);
        process.stdin.pause();
      };
    },
    onResize(listener) {
      process.stdout.on("resize", listener);
      return () => void process.stdout.off("resize", listener);
    },
    write: (bytes) => void process.stdout.write(bytes),
    say: (line) => void process.stderr.write(`\r\n${dim(line)}\r\n`),
  };
}
