/*
 * Which file a shell command shows, and which files it changes: read conservatively from the command's words, for
 * the quest loop to tell a file's contents a later command made stale (quest.ts compact). Anything it can't read for
 * certain (a pipe into a read, a glob, a substitution) names nothing, so nothing is called stale by a guess.
 */

/** A command's words, split into its simple commands at unquoted `&&`, `||`, `;`, `|`, `&` and newlines. Each word
 * says whether any of it was unquoted dynamic shell (`$`, a glob, a backtick), which a read can't be judged by. */
interface Word { text: string; dynamic: boolean; operator?: string }

/** The command without a here-document's body (its lines are data, not commands). */
function withoutHereDocs(command: string): string {
  const lines = command.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    out.push(line);
    const here = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (!here) continue;
    const end = lines.findIndex((l, j) => j > i && l.trim() === here[2]);
    if (end === -1) break;
    i = end;
  }
  return out.join("\n");
}

function segments(command: string): Word[][] {
  const all: Word[][] = [[]];
  let text = "", dynamic = false, started = false;
  const end = () => {
    if (started) all.at(-1)!.push({ text, dynamic });
    text = ""; dynamic = false; started = false;
  };
  const operator = (op: string) => { end(); all.at(-1)!.push({ text: op, dynamic: false, operator: op }); };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close === -1) return [];
      text += command.slice(i + 1, close); started = true; i = close;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === "\\" && j + 1 < command.length) { text += command[++j]; continue; }
        if (command[j] === "$" || command[j] === "`") dynamic = true;
        text += command[j];
      }
      if (j >= command.length) return [];
      started = true; i = j;
    } else if (c === "\\" && i + 1 < command.length) {
      text += command[++i]; started = true;
    } else if (c === " " || c === "\t") {
      end();
    } else if (c === "\n" || c === ";") {
      end(); all.push([]);
    } else if (c === "&" || c === "|") {
      // `&>` and `>&` are redirects, read below; `&&`, `||`, `|` and `&` end a simple command.
      if (c === "&" && command[i + 1] === ">") { operator(command[i + 2] === ">" ? "&>>" : "&>"); i += command[i + 2] === ">" ? 2 : 1; continue; }
      end();
      if (command[i + 1] === c) i++;
      all.push([]);
    } else if (c === ">" || c === "<") {
      // A redirect, with the descriptor it names (`2>`) when the word before it is only that.
      let op = c;
      if (/^\d$/.test(text) && started) { op = text + op; text = ""; started = false; }
      end();
      if (command[i + 1] === c) { op += c; i++; }
      if (command[i + 1] === "&") { op += "&"; i++; }
      operator(op);
    } else {
      if (c === "$" || c === "`" || c === "*" || c === "?" || c === "[") dynamic = true;
      text += c; started = true;
    }
  }
  end();
  return all.filter((words) => words.length > 0);
}

const clean = (path: string): string => path.replace(/^(\.\/)+/, "");

/** The one file a plain read shows (`cat`, `head`, `tail`, `nl`, `sed -n '…p'`), or null when it is anything more. */
export function readOf(command: string): string | null {
  if (command.includes("<<")) return null;
  const all = segments(command);
  if (all.length !== 1) return null;
  const words = all[0]!;
  if (words.some((w) => w.operator)) return null;
  const [name, ...rest] = words;
  if (!name || name.dynamic) return null;
  const files: Word[] = [];
  if (name.text === "cat" || name.text === "nl") {
    for (const w of rest) if (!w.text.startsWith("-")) files.push(w);
  } else if (name.text === "head" || name.text === "tail") {
    for (let i = 0; i < rest.length; i++) {
      const w = rest[i]!;
      if (w.text === "-n" || w.text === "-c") { i++; continue; }
      if (!w.text.startsWith("-")) files.push(w);
    }
  } else if (name.text === "sed") {
    if (!rest.some((w) => w.text === "-n")) return null;
    const args = rest.filter((w) => !w.text.startsWith("-"));
    const [script, ...paths] = args;
    if (!script || !/^(\d+|\$)(,(\d+|\$))?p$/.test(script.text)) return null;
    files.push(...paths);
  } else return null;
  if (files.length !== 1 || files[0]!.dynamic || !files[0]!.text) return null;
  return clean(files[0]!.text);
}

/** The files a command writes, moves, removes or restores, in the order it names them (none it can't read for certain). */
export function writesOf(command: string): string[] {
  const out: string[] = [];
  const add = (w: Word | undefined) => { if (w && !w.dynamic && !w.operator && w.text) out.push(clean(w.text)); };
  for (const words of segments(withoutHereDocs(command))) {
    // Redirects that write: `>`, `>>`, `2>`, `&>` (not a duplication such as `2>&1`, nor a read `<`).
    words.forEach((w, i) => { if (w.operator && /^(\d|&)?>>?$/.test(w.operator)) add(words[i + 1]); });
    const plain = words.filter((w, i) => !w.operator && !(i > 0 && words[i - 1]!.operator));
    let at = 0;
    while (at < plain.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(plain[at]!.text)) at++;
    const name = plain[at]?.text;
    const args = plain.slice(at + 1);
    const operands = args.filter((w) => !w.text.startsWith("-"));
    if (name === "sed" && args.some((w) => /^(-i|--in-place)/.test(w.text))) {
      const files: Word[] = [];
      let script = !args.some((w) => w.text === "-e" || w.text === "-f");
      for (let i = 0; i < args.length; i++) {
        const w = args[i]!;
        if (w.text === "-e" || w.text === "-f") { i++; continue; }
        // BSD sed's suffix as a word of its own: `-i ''`.
        if (w.text === "-i" && args[i + 1]?.text === "") { i++; continue; }
        if (w.text.startsWith("-")) continue;
        if (script) { script = false; continue; }
        files.push(w);
      }
      files.forEach(add);
    } else if (name === "tee" || name === "rm") operands.forEach(add);
    else if (name === "mv") operands.forEach(add);
    else if (name === "cp") add(operands.at(-1));
    else if (name === "git" && operands[0]?.text === "restore") operands.slice(1).forEach(add);
    else if (name === "git" && operands[0]?.text === "checkout") {
      const dashes = args.findIndex((w) => w.text === "--");
      if (dashes !== -1) args.slice(dashes + 1).forEach(add);
    }
  }
  return [...new Set(out)];
}
