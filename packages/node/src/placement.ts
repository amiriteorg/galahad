import type { NodeCapacity, PlacementNeeds, Presence } from "@galahad/core";
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
 *  - a node's strength is what it measured (its calibration), not its core count
 *  - a node with a slot free is preferred; a full one is ranked behind (work would wait there)
 */

export interface Candidate {
  device: string;
  name: string;
  caps: Capabilities | null;
  online: boolean;
  self: boolean;
  presence: Presence | null;
  /**
   * What the node may carry (from its calibration and the owner's ceiling), how many standard sandboxes
   * fit now (null: not known) and how many wait. Absent: scored from the core count, as before compute.
   */
  compute?: { capacity: NodeCapacity; free: number | null; queued: number; /** Tokens a second its best local model measured. */ localTps?: number } | null;
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
  // The owner's ceiling: a node told to carry no sandboxes takes none.
  if ((needs.docker || needs.untrusted) && caps.sandbox && c.compute && c.compute.capacity.sandboxes <= 0) return "its ceiling takes no sandboxes";
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
      const microVMs = !!caps.sandbox?.vm;
      score += microVMs ? 15 : caps.vm.kvm ? 10 : 5;
      reasons.push(microVMs ? "KVM microVMs" : caps.vm.kvm ? "VM isolation available" : "container isolation");
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
    const compute = c.compute;
    if (!compute) score += Math.min(10, Math.round(caps.cores / 4));
    else {
      // Strength: what it measured, in reference cores' worth; a guess from its threads until it has.
      if (compute.capacity.strength !== null) {
        score += Math.min(10, Math.round(compute.capacity.strength / 4));
        reasons.push(`measured ${compute.capacity.strength.toFixed(1)} reference cores' worth`);
      } else {
        score += Math.min(10, Math.round(caps.cores / 8));
        reasons.push(`not measured yet: guessing from ${caps.cores} threads`);
      }
      // Room: a slot free now counts for it; a full node is ranked behind, the longer its queue the further.
      const slots = compute.capacity.sandboxes;
      if (slots > 0) {
        if (compute.free === null) reasons.push(`${slots} slot${slots === 1 ? "" : "s"} (in use: not known)`);
        else if (compute.free > 0) {
          score += Math.min(10, compute.free * 2);
          reasons.push(`${compute.free} of ${slots} slot${slots === 1 ? "" : "s"} free`);
        } else {
          score -= 20 + Math.min(10, compute.queued * 2);
          reasons.push(`full: work waits for a slot (${compute.queued} ahead)`);
        }
      }
      if (needs.localModels && compute.localTps) {
        score += Math.min(10, Math.round(compute.localTps / 6));
        reasons.push(`its local model wrote ${Math.round(compute.localTps)} tokens a second`);
      }
    }
    if (needs.prefer && (c.name === needs.prefer || c.device === needs.prefer)) {
      score += 50;
      reasons.push("preferred");
    }
    ranked.push({ device: c.device, name: c.name, score, reasons });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { ranked, rejected };
}
