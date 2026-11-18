import type { LoopWake } from "@galahad/core";

/** A wake in a few words, as core's describeWake says it (lib.test.ts holds the two together). */
export function describeWake(wake: LoopWake): string {
  switch (wake.kind) {
    case "webhook":
      return "a webhook";
    case "mail":
      return `new ${wake.connector === "gmail" ? "Gmail" : "Outlook"} mail${wake.query ? ` matching "${wake.query}"` : ""}`;
    case "github": {
      const what = wake.on.map((on) => (on === "ci.failed" ? `a failed CI run${wake.branch ? ` on ${wake.branch}` : ""}` : "a push"));
      return `${what.join(" or ")} in ${wake.owner}/${wake.repo}`;
    }
  }
}

/** What else wakes a loop, in a sentence ("" when nothing does). */
export function describeWakes(wakes: readonly LoopWake[], cooldownMs: number | null): string {
  if (!wakes.length) return "";
  const minutes = Math.round((cooldownMs ?? 600_000) / 60_000);
  return `Also wakes on ${wakes.map(describeWake).join(" · ")}; a burst within ${minutes} min is one run.`;
}
