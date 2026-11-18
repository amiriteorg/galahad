import { artifactTitle, compactNumber, isBlockKind, readArtifact, readChart, readChoices, readStats, readSteps } from "@galahad/core/blocks";

/*
 * His answer, as Telegram shows it: its HTML (bold, italic, code, links, nothing else), the choices of a choices block
 * as buttons, a plan's steps as marked lines, figures as lines, a chart or a page as a line that says it's in the app.
 * Fences are read as the apps read them (a block on one line too). Anything else stays the text it is, escaped.
 */

/** A message Telegram takes is at most 4,096 characters; this leaves room for its markup. */
export const TELEGRAM_CHUNK = 3500;

export interface TelegramAnswer {
  /** HTML, in pieces each short enough to send. */
  chunks: string[];
  /** The answer's choices (its last choices block), offered as buttons under its last piece. */
  choices: string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(?:([\w+#.-]+)(?:\s+([^`\s](?:[^`]*[^`\s])?))?\s*)?$/;
const STEP_MARK: Record<string, string> = { done: "✓", doing: "→", todo: "○", failed: "✗", skipped: "–" };

export const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Bold, italic, inline code and http(s) links, on text already split from code; the rest escaped. */
export function inlineHtml(text: string): string {
  const out: string[] = [];
  // Inline code first: what's inside it is never read as markup.
  const parts = text.split(/(`[^`\n]+`)/);
  for (const part of parts) {
    if (/^`[^`\n]+`$/.test(part)) {
      out.push(`<code>${escapeHtml(part.slice(1, -1))}</code>`);
      continue;
    }
    let html = escapeHtml(part);
    html = html.replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,2000})\)/g, (_m, label: string, url: string) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+)__/g, "<b>$1</b>");
    html = html.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>").replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
    html = html.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    out.push(html);
  }
  return out.join("");
}

/** A block the apps draw, said in words (and its choices kept for buttons). */
function blockText(kind: string, body: string, choices: string[][]): string {
  switch (kind) {
    case "choices": {
      const read = readChoices(body);
      if (!read.ok) return `<pre>${escapeHtml(body)}</pre>`;
      choices.push(read.value);
      return "";
    }
    case "steps": {
      const read = readSteps(body);
      if (!read.ok) return `<pre>${escapeHtml(body)}</pre>`;
      return read.value.map((step) => `${STEP_MARK[step.state] ?? "·"} ${escapeHtml(step.text)}`).join("\n");
    }
    case "stats": {
      const read = readStats(body);
      if (!read.ok) return `<pre>${escapeHtml(body)}</pre>`;
      return read.value
        .map((stat) => {
          const value = typeof stat.value === "number" ? compactNumber(stat.value) : stat.value;
          const delta = stat.delta === null ? "" : ` (${stat.delta > 0 ? "+" : ""}${compactNumber(stat.delta)}${stat.note ? ` ${stat.note}` : ""})`;
          return `<b>${escapeHtml(stat.label)}</b>: ${escapeHtml(`${value}${stat.unit ? ` ${stat.unit}` : ""}${delta}`)}`;
        })
        .join("\n");
    }
    case "chart": {
      const read = readChart(body);
      const title = read.ok && read.value.title ? `: ${read.value.title}` : "";
      return `<i>A chart${escapeHtml(title)}, drawn in the app.</i>`;
    }
    case "artifact": {
      const read = readArtifact(body);
      const title = read.ok ? artifactTitle(read.value) : null;
      return `<i>A page${title ? `, ${escapeHtml(title)}` : ""}: open this chat in the app to see it.</i>`;
    }
  }
  return `<pre>${escapeHtml(body)}</pre>`;
}

/** His answer as Telegram takes it. */
export function telegramAnswer(markdown: string): TelegramAnswer {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  const choices: string[][] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    blocks.push(paragraph.map(lineHtml).join("\n"));
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1]!;
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        const l = lines[i]!;
        if (l.trim().startsWith(marker[0]!.repeat(marker.length)) && /^\s*[`~]+\s*$/.test(l)) break;
        body.push(l);
      }
      const lang = (fence[2] ?? "").toLowerCase();
      const text = body.join("\n");
      const said = fence[3] ?? "";
      if (isBlockKind(lang)) {
        const shown = blockText(lang, !text.trim() && said ? said : text, choices);
        if (shown) blocks.push(shown);
      } else blocks.push(`<pre>${escapeHtml(text)}</pre>`);
      continue;
    }
    if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return { chunks: chunked(blocks.filter((b) => b.trim())), choices: choices.at(-1) ?? [] };
}

/** One line of a paragraph: a heading in bold, a list item with its bullet, a quote kept as one. */
function lineHtml(line: string): string {
  const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
  if (heading) return `<b>${inlineHtml(heading[1]!)}</b>`;
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) return `${bullet[1]!.replace(/ {2}/g, "  ")}• ${inlineHtml(bullet[2]!)}`;
  const quote = /^ {0,3}>\s?(.*)$/.exec(line);
  if (quote) return `▎${inlineHtml(quote[1]!)}`;
  return inlineHtml(line);
}

/** Pieces each short enough to send, split between blocks (a long block alone is cut, code kept as code). */
function chunked(blocks: string[]): string[] {
  const out: string[] = [];
  let current = "";
  const push = (piece: string) => {
    if (current && current.length + 2 + piece.length > TELEGRAM_CHUNK) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${piece}` : piece;
  };
  for (const block of blocks) {
    if (block.length <= TELEGRAM_CHUNK) {
      push(block);
      continue;
    }
    // Too long for one message: a code block is cut into code blocks, anything else at line ends.
    const pre = /^<pre>([\s\S]*)<\/pre>$/.exec(block);
    const body = pre ? pre[1]! : block;
    const room = TELEGRAM_CHUNK - (pre ? 11 : 0);
    let rest = body;
    while (rest.length) {
      let cut = rest.length <= room ? rest.length : rest.lastIndexOf("\n", room);
      if (cut <= 0) cut = room;
      // Never cut an entity (&amp;) in two.
      const amp = rest.lastIndexOf("&", cut);
      if (amp > cut - 8 && rest.indexOf(";", amp) >= cut) cut = amp;
      push(pre ? `<pre>${rest.slice(0, cut)}</pre>` : rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, "");
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}
