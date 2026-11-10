import type { PlacementNeeds, Presence } from "@galahad/core";
import { type Capabilities, isAlwaysOn } from "./capabilities.ts";

/*
 * Where should a piece of work run? Hard constraints filter, soft preferences
 * score, and every decision carries its reasons so you can see why.
 *
 * Rules of thumb the scorer encodes:
 *  - untrusted work (web content, unknown code) only runs where it can be sandboxed
 *  - long work prefers always-on machines and avoids laptops on battery
 *  - interactive work prefers the machine you are using
 *  - local-model work prefers GPUs; heavy work prefers free memory and idle cores
 */

export interface Candidate {
  device: string;
  name: string;
  caps: Capabilities | null;
  online: boolean;
  self: boolean;
  presence: Presence | null;
}

export interface Placement {
  device: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface PlacementResult {
  ranked: Placement[];
  rejected: { device: string; name: string; reason: string }[];
}

function hardCheck(needs: PlacementNeeds, c: Candidate): string | null {
  if (!c.online && !c.self) return "offline";
  const caps = c.caps;
  if (!caps) return "no capability profile yet";
  if (needs.docker && !caps.docker) return "no docker";
  if (needs.vm && !(caps.vm.kvm || caps.vm.tools.length)) return "no VM support";
  if (needs.gpu && !caps.gpu.length) return "no GPU";
  if (needs.minMemoryGb && caps.memoryGb < needs.minMemoryGb) return `only ${caps.memoryGb} GB RAM`;
  const missing = (needs.tools ?? []).filter((t) => !caps.tools.includes(t));
  if (missing.length) return `missing ${missing.join(", ")}`;
  if (needs.localModels && !caps.localModels.some((r) => r.models.length)) return "no local models running";
  if (needs.untrusted && !caps.docker && !(caps.vm.kvm || caps.vm.tools.length)) return "cannot sandbox untrusted work";
  return null;
}

export function place(needs: PlacementNeeds, candidates: Candidate[]): PlacementResult {
  const ranked: Placement[] = [];
  const rejected: PlacementResult["rejected"] = [];
  for (const c of candidates) {
    const reason = hardCheck(needs, c);
    if (reason) {
      rejected.push({ device: c.device, name: c.name, reason });
      continue;
    }
    const caps = c.caps!;
    const reasons: string[] = [];
    let score = 50;
    const onBattery = c.presence?.onBattery ?? false;
    const alwaysOn = isAlwaysOn(caps);

    if (needs.longRunning) {
      if (alwaysOn) {
        score += 25;
        reasons.push("always-on");
      }
      if (onBattery) {
        score -= 40;
        reasons.push("on battery");
      }
    } else if (onBattery) {
      score -= 10;
      reasons.push("on battery");
    }
    if (needs.interactive && c.self) {
      score += 20;
      reasons.push("you are here");
    }
    if (needs.untrusted) {
      score += caps.vm.kvm ? 10 : 5;
      reasons.push(caps.vm.kvm ? "VM isolation available" : "container isolation");
      if (caps.sandbox?.image && caps.sandbox.networks) {
        score += 15;
        reasons.push("sandbox host ready");
      }
    }
    if (needs.localModels && caps.gpu.length) {
      score += 15;
      reasons.push(`GPU: ${caps.gpu[0]!.name}`);
    }
    if (c.presence) {
      const busy = c.presence.cores ? c.presence.load / c.presence.cores : 0;
      if (busy > 0.75) {
        score -= 20;
        reasons.push("busy");
      }
      const freeShare = caps.memoryGb ? c.presence.freeMemoryGb / caps.memoryGb : 0;
      score += Math.round(freeShare * 10);
    }
    score += Math.min(10, Math.round(caps.cores / 4));
    if (needs.prefer && (c.name === needs.prefer || c.device === needs.prefer)) {
      score += 50;
      reasons.push("preferred");
    }
    ranked.push({ device: c.device, name: c.name, score, reasons });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { ranked, rejected };
}
