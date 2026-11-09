import type { DeviceView, FleetView, PairingView, PeerStatus } from "@galahad/core";
import { type Ctx, errorMessage, type View } from "../context.ts";
import { gb, plural, shortId } from "../lib/text.ts";
import { countdown, hlcMs, relativeTime } from "../lib/time.ts";
import { type AnyScope, asCaps, type Caps, type InviteResponse, type PlacementResult } from "../types.ts";
import {
  badge,
  busy,
  button,
  callout,
  copyField,
  dot,
  empty,
  errorState,
  meter,
  pageHead,
  rangeControl,
  sasCode,
  section,
  segmented,
  skeletonBlock,
  statTile,
} from "../ui/controls.ts";
import { confirmAction, openSheet } from "../ui/dialog.ts";
import { type Child, debounce, h, keepPlace, replace, type Scope } from "../ui/dom.ts";
import { icon, type IconName } from "../ui/icons.ts";
import { toast } from "../ui/toast.ts";

/* Every body that shares the one mind: nodes, client devices, pairing, placement. */

export const SCOPE_INFO: { scope: AnyScope; label: string }[] = [
  { scope: "chat", label: "Talk to Galahad" },
  { scope: "mind:read", label: "Read memory, fleet, models and activity" },
  { scope: "mind:write", label: "Remember and forget" },
  { scope: "vault:read", label: "See secret names (never values)" },
  { scope: "vault:write", label: "Add, replace and delete keys" },
  { scope: "brain:write", label: "Change providers, the roster, loops and connectors" },
  { scope: "gateway:mint", label: "Mint scoped model-gateway tokens" },
  { scope: "fleet:admin", label: "Invite, approve and revoke devices" },
  { scope: "sandbox", label: "Create and use sandboxes" },
  { scope: "connect", label: "Run connector tools (never see their keys)" },
];

export function peerOf(fleet: FleetView, id: string): PeerStatus | undefined {
  return fleet.peers.find((p) => p.device === id);
}

export function isOnline(fleet: FleetView, d: DeviceView): boolean {
  return d.id === fleet.self || Boolean(peerOf(fleet, d.id)?.online);
}

export function capChips(caps: Caps | null): HTMLElement[] {
  if (!caps) return [h("span", { class: "chip" }, icon("info"), "No capability profile yet")];
  const chip = (iconName: IconName, text: string, on = false, title?: string) => h("span", { class: `chip${on ? " on" : ""}`, title: title ?? null }, icon(iconName), text);
  const out: HTMLElement[] = [];
  if (caps.os) out.push(chip("monitor", `${caps.os}/${caps.arch ?? "?"}`));
  if (caps.cores) out.push(chip("cpu", `${caps.cores} cores`, false, caps.cpu));
  if (caps.memoryGb) out.push(chip("ram", gb(caps.memoryGb)));
  for (const g of caps.gpu ?? []) out.push(chip("zap", g.memoryGb ? `${g.name} · ${gb(g.memoryGb)}` : g.name, true));
  if (caps.docker) out.push(chip("sandbox", "Docker", true));
  if (caps.vm?.kvm) out.push(chip("layers", "KVM", true));
  else if (caps.vm?.tools.length) out.push(chip("layers", caps.vm.tools.join(", "), true));
  const models = (caps.localModels ?? []).flatMap((r) => r.models);
  if (models.length) out.push(chip("models", `${plural(models.length, "local model")}`, true, models.join(", ")));
  if (caps.docker || caps.vm?.kvm || caps.vm?.tools.length) out.push(chip("shield-check", "Sandbox-ready", true));
  if (caps.hasBattery) out.push(chip("battery", "Battery"));
  return out;
}

function statusLine(fleet: FleetView, d: DeviceView): HTMLElement {
  if (d.id === fleet.self) return h("span", { class: "row", style: "gap:6px" }, dot("ok", { live: true }), "online · serving you");
  const peer = peerOf(fleet, d.id);
  if (peer?.online) return h("span", { class: "row tnum", style: "gap:6px" }, dot("ok", { live: true }), `online${peer.rttMs !== null ? ` · ${peer.rttMs} ms` : ""}`);
  return h(
    "span",
    { class: "row", style: "gap:6px", title: peer?.error ?? "" },
    dot(null),
    peer?.lastSeen ? `offline · seen ${relativeTime(peer.lastSeen)}` : "offline",
  );
}

async function revoke(ctx: Ctx, d: DeviceView): Promise<void> {
  const ok = await confirmAction({
    title: `Revoke ${d.name}?`,
    body:
      d.kind === "node"
        ? [
            h("p", {}, "It's removed from the fleet and the vault is rotated, so it can't read anything written from now on."),
            h("p", {}, "It could read the keys in the vault until now: rotate those at their providers too."),
          ]
        : h("p", {}, "It will no longer be able to reach Galahad. Pairing it again needs a fresh invite."),
    confirmLabel: "Revoke device",
    typeToConfirm: d.name,
  });
  if (!ok) return;
  try {
    const result = await ctx.api.post<{ resealed?: string[] }>("/api/devices/revoke", { device: d.id, reason: "revoked from the PWA" });
    toast(`${d.name} revoked`, {
      tone: "ok",
      description: result.resealed?.length ? `Rotate these at their providers: ${result.resealed.join(", ")}` : undefined,
      duration: result.resealed?.length ? 0 : undefined,
    });
    await ctx.live.refreshFleet();
  } catch (error) {
    toast("Couldn't revoke it", { tone: "error", description: errorMessage(error) });
  }
}

function nodeCard(ctx: Ctx, fleet: FleetView, d: DeviceView): HTMLElement {
  const caps = asCaps(d.caps);
  const peer = peerOf(fleet, d.id);
  const presence = peer?.presence ?? null;
  const self = d.id === fleet.self;
  const loads: Child[] = [];
  if (presence && caps?.cores) {
    const load = Math.min(1, presence.load / (presence.cores || caps.cores));
    loads.push(
      h("div", {}, h("div", { class: "load-label" }, h("span", {}, "CPU load"), h("span", {}, `${Math.round(load * 100)}%`)), meter(load, load > 0.85 ? "var(--warn)" : undefined, "CPU load")),
    );
  }
  if (presence && caps?.memoryGb) {
    const used = 1 - presence.freeMemoryGb / caps.memoryGb;
    loads.push(
      h("div", {}, h("div", { class: "load-label" }, h("span", {}, "Memory"), h("span", {}, `${gb(presence.freeMemoryGb)} free`)), meter(used, used > 0.9 ? "var(--warn)" : undefined, "Memory used")),
    );
  }
  const joined = hlcMs(d.enrolledAt);
  return h(
    "article",
    { class: "card node-card", "aria-label": d.name },
    h(
      "div",
      { class: "node-head" },
      h("span", { class: "node-icon" }, icon(caps?.hasBattery ? "laptop" : "server")),
      h(
        "div",
        { class: "grow" },
        h("div", { class: "row wrap" }, h("span", { class: "node-name" }, d.name), self ? badge("this node", "accent") : null, d.role !== "full" ? badge(d.role) : null),
        h("div", { class: "node-sub" }, statusLine(fleet, d), presence?.onBattery ? badge(`on battery${presence.batteryPercent !== null ? ` · ${presence.batteryPercent}%` : ""}`, "warn", "battery") : null),
      ),
      ctx.can("fleet:admin") && !self ? button(`Revoke ${d.name}`, { variant: "ghost", size: "sm", iconOnly: true, icon: "logout", onClick: () => void revoke(ctx, d) }) : null,
    ),
    h(
      "div",
      { class: "node-body" },
      h("div", { class: "chips" }, ...capChips(caps)),
      loads.length ? h("div", { class: "loads" }, ...loads) : null,
      h("div", { class: "tiny subtle row wrap" }, d.endpoint ? h("span", { class: "mono" }, d.endpoint) : null, h("span", { class: "mono" }, shortId(d.id)), joined ? h("span", {}, `joined ${relativeTime(joined)}`) : null),
    ),
  );
}

function clientRow(ctx: Ctx, fleet: FleetView, d: DeviceView): HTMLElement {
  const me = d.id === ctx.identity.device;
  const joined = hlcMs(d.enrolledAt);
  const revokedAt = d.revokedAt ? hlcMs(d.revokedAt) : null;
  const all = SCOPE_INFO.filter((s) => s.scope !== "sandbox").every((s) => d.scopes.includes(s.scope as never));
  return h(
    "div",
    { class: "item center" },
    h("span", { class: "avatar" }, icon(/iPhone|Android|iPad/.test(d.name) ? "phone" : "laptop", { size: 16 })),
    h(
      "div",
      { class: "grow" },
      h("div", { class: "row wrap" }, h("span", { class: "strong" }, d.name), me ? badge("this browser", "accent") : null, d.revokedAt ? badge("revoked", "danger") : null),
      h(
        "div",
        { class: "meta" },
        h("span", { title: d.scopes.join(", ") }, all ? "all scopes" : d.scopes.join(" · ") || "no scopes"),
        joined ? h("span", {}, `joined ${relativeTime(joined)}`) : null,
        revokedAt ? h("span", {}, `revoked ${relativeTime(revokedAt)}`) : null,
      ),
    ),
    ctx.can("fleet:admin") && !d.revokedAt && d.id !== fleet.self
      ? h("div", { class: "item-actions reveal" }, button(me ? "Revoke this browser" : `Revoke ${d.name}`, { variant: "ghost", size: "sm", icon: "logout", label: `Revoke ${d.name}`, onClick: () => void revoke(ctx, d) }))
      : null,
  );
}

/** A pending pairing, with its code. Approving a machine asks once more: it receives the vault. */
/** A pending pairing, with its code. Outcome feedback is shown inline (the card may live in a sheet). */
export function pairingCard(ctx: Ctx, p: PairingView, onDone?: (outcome: "approved" | "rejected") => void): HTMLElement {
  const node = p.kind === "node";
  const note = h("div");
  const approve = button("Codes match: approve", { variant: "primary", icon: "check", disabled: p.conflict });
  const reject = button("Reject", { variant: "danger", icon: "x" });
  approve.addEventListener("click", async () => {
    if (node) {
      const ok = await confirmAction({
        title: `Approve ${p.name} as a full node?`,
        body: [h("p", {}, "A full node receives every key in the vault and a full copy of the mind."), h("p", {}, `Approve only if ${p.name} showed ${p.sas}.`)],
        confirmLabel: "Approve machine",
        tone: "primary",
      });
      if (!ok) return;
    }
    await busy(approve, async () => {
      try {
        await ctx.api.post("/api/pairings/approve", { invite: p.invite, device: p.device });
        if (onDone) onDone("approved");
        else toast(`${p.name} has joined the fleet`, { tone: "ok" });
        await Promise.all([ctx.live.refreshInbox(), ctx.live.refreshFleet()]);
      } catch (error) {
        replace(note, callout("danger", errorMessage(error), { title: "Couldn't approve" }));
      }
    });
  });
  reject.addEventListener("click", () =>
    void busy(reject, async () => {
      try {
        await ctx.api.post("/api/pairings/reject", { invite: p.invite, device: p.device });
        if (onDone) onDone("rejected");
        else toast(`${p.name} was turned away`);
        await ctx.live.refreshInbox();
      } catch (error) {
        replace(note, callout("danger", errorMessage(error), { title: "Couldn't reject" }));
      }
    }),
  );
  return h(
    "article",
    { class: `card ${p.conflict ? "danger" : "accent"}`, "aria-label": `${p.name} asks to join` },
    h(
      "div",
      { class: "card-body stack" },
      h(
        "div",
        { class: "row top" },
        h("span", { class: "avatar" }, icon(node ? "server" : "phone", { size: 16 })),
        h(
          "div",
          { class: "grow" },
          h("div", { class: "strong" }, `${p.name} asks to join`),
          h("div", { class: "tiny subtle" }, node ? "A machine. It would become a full node." : "A phone or browser.", ` Asked ${relativeTime(p.requestedAt)}.`),
        ),
      ),
      sasCode(p.sas),
      p.conflict
        ? callout("danger", "Two devices used this invite. It may have been intercepted: reject, then create a new invite.", { title: "Possible interception" })
        : node
          ? callout(
              "info",
              h(
                "span",
                {},
                "A new machine receives the whole vault, so it's approved from a terminal on an existing node, never from a phone. There, run ",
                h("code", {}, "galahad pairings"),
                ", check this same code, then approve. You can still reject it here.",
              ),
              { title: "Approve machines from a terminal" },
            )
          : h("p", { class: "small muted", style: "text-align:center" }, `Approve only if ${p.name} shows exactly this code.`),
      h("div", { class: "row wrap", style: "justify-content:center" }, ...(node ? [reject] : [reject, approve])),
      note,
    ),
  );
}

const KNOWN_SCOPES = (ctx: Ctx) => SCOPE_INFO.filter((s) => s.scope !== "sandbox" || ctx.can("sandbox"));

export function openInvite(ctx: Ctx, initialKind: "client" | "node" = "client"): void {
  if (!ctx.can("fleet:admin")) {
    toast("This device can't invite others", { tone: "warn", description: "It needs the fleet:admin scope." });
    return;
  }
  let kind = initialKind;
  let access: "owner" | "limited" | "custom" = "owner";
  const chosen = new Set<AnyScope>(["chat", "mind:read"]);
  const body = h("div", { class: "stack loose" });
  const sheetTitle = () => (kind === "client" ? "Pair a phone or browser" : "Add a machine");

  const sheet = openSheet({ title: sheetTitle(), description: "Invites work once and expire in ten minutes.", body });
  const titleEl = sheet.el.querySelector("h2");
  const pending = h("div", { class: "stack", "aria-live": "polite" });
  const note = h("div");
  let inviteScope: Scope | null = null;
  let outcome: { name: string; result: "approved" | "rejected" } | null = null;

  function scopesFor(): AnyScope[] | undefined {
    if (kind !== "client" || access === "owner") return undefined;
    if (access === "limited") return ["chat", "mind:read"];
    return [...chosen];
  }

  function chooser(): void {
    inviteScope?.dispose();
    if (titleEl) titleEl.textContent = sheetTitle();
    const kindControl = segmented(
      [
        { value: "client", label: "Phone or browser", icon: "phone" },
        { value: "node", label: "Machine", icon: "server" },
      ],
      kind,
      (value) => {
        kind = value as "client" | "node";
        chooser();
      },
      { label: "What are you adding?", block: true },
    );
    const custom = h(
      "div",
      { class: "scope-list", hidden: access !== "custom" },
      ...KNOWN_SCOPES(ctx).map((s) => {
        const input = h("input", { type: "checkbox", checked: chosen.has(s.scope) });
        input.addEventListener("change", () => (input.checked ? chosen.add(s.scope) : chosen.delete(s.scope)));
        return h("label", { class: "scope", style: "cursor:pointer" }, input, h("span", {}, h("div", { class: "scope-name" }, s.scope), h("div", { class: "tiny subtle" }, s.label)));
      }),
    );
    const accessControl = segmented(
      [
        { value: "owner", label: "Everything", icon: "shield" },
        { value: "limited", label: "Chat & read", icon: "chat" },
        { value: "custom", label: "Custom", icon: "settings" },
      ],
      access,
      (value) => {
        access = value as typeof access;
        custom.hidden = access !== "custom";
      },
      { label: "What may it do?", block: true },
    );
    const create = button("Create invite", { variant: "primary", icon: "link", block: true });
    create.addEventListener("click", () => void busy(create, createInvite));
    replace(note);
    replace(
      body,
      kindControl.el,
      kind === "client"
        ? h("div", { class: "stack tight" }, h("div", { class: "label" }, "What may it do?"), accessControl.el, custom, h("p", { class: "tiny subtle" }, "Least privilege is wise for phones you carry. You can always pair again with more."))
        : callout("info", "A machine becomes a full node: it holds a copy of the mind and can use the vault. You'll confirm once more when it asks to join.", { icon: "server" }),
      note,
      create,
    );
  }

  async function createInvite(): Promise<void> {
    const scopes = scopesFor();
    if (scopes && !scopes.length) {
      replace(note, callout("warn", "Choose at least one thing it may do."));
      return;
    }
    try {
      const invite = await ctx.api.post<InviteResponse>("/api/invites", { kind, origin: location.origin, ...(scopes ? { scopes } : {}) });
      showInvite(invite, scopes);
    } catch (error) {
      replace(note, callout("danger", errorMessage(error), { title: "Couldn't create an invite" }));
    }
  }

  function showInvite(invite: InviteResponse, scopes: AnyScope[] | undefined): void {
    inviteScope?.dispose();
    inviteScope = sheet.scope.child();
    const ring = h("span", { class: "ring", "aria-hidden": "true" });
    const left = h("span", { class: "tnum" });
    const total = Math.max(1, invite.expiresAt - Date.now());
    const tick = () => {
      const ms = Math.max(0, invite.expiresAt - Date.now());
      ring.style.setProperty("--p", String(ms / total));
      left.textContent = ms ? `Valid for ${countdown(ms)} · single use` : "Expired. Create a new one.";
    };
    tick();
    inviteScope.interval(tick, 1000);
    const value = kind === "client" ? (invite.url ?? invite.invite) : `galahad join ${invite.invite}`;
    replace(
      body,
      h(
        "div",
        { class: "stack tight" },
        h("div", { class: "label" }, kind === "client" ? "Open this link on the phone or browser" : "Run this on the new machine"),
        copyField(value, kind === "client" ? "Copy invite link" : "Copy join command"),
        h("div", { class: "row small muted" }, ring, left),
      ),
      callout("warn", "Treat it like a password. When the device asks to join, its code appears below: approve only if both screens show the same code.", { icon: "shield" }),
      scopes ? h("p", { class: "tiny subtle" }, `It may: ${scopes.join(", ")}`) : null,
      pending,
      h("div", { class: "row", style: "justify-content:space-between" }, button("Start over", { variant: "ghost", icon: "chevron-left", onClick: chooser }), button("Done", { onClick: () => sheet.close() })),
    );
    outcome = null;
    const renderPending = (list: PairingView[]) => {
      if (outcome) {
        replace(
          pending,
          outcome.result === "approved"
            ? callout("ok", `${outcome.name} has joined the fleet.`, { icon: "shield-check" })
            : callout("quiet", `${outcome.name} was turned away. Create a new invite to try again.`),
        );
        return;
      }
      const mine = list.filter((p) => p.invite === invite.id);
      replace(
        pending,
        ...(mine.length
          ? mine.map((p) =>
              pairingCard(ctx, p, (result) => {
                outcome = { name: p.name, result };
                renderPending(ctx.live.pairings.value);
              }),
            )
          : [h("div", { class: "row small muted", style: "justify-content:center" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Waiting for the device…")]),
      );
    };
    inviteScope.add(ctx.live.pairings.watch(renderPending));
    // Poll faster while someone is in the middle of pairing.
    inviteScope.interval(() => void ctx.live.refreshInbox(), 1500);
  }

  chooser();
}

function placementPlayground(ctx: Ctx, scope: Scope): HTMLElement {
  const needs: Record<string, boolean> = {};
  const toggles: [string, string, IconName][] = [
    ["docker", "Docker", "sandbox"],
    ["vm", "VM", "layers"],
    ["gpu", "GPU", "zap"],
    ["localModels", "Local models", "models"],
    ["longRunning", "Long-running", "clock"],
    ["interactive", "Interactive", "user"],
    ["untrusted", "Untrusted input", "alert"],
  ];
  const out = h("div", { class: "place-rank" }, skeletonBlock(48));
  const verdict = h("div", { class: "sr-only", role: "status" });
  let minMemory = 0;
  let seq = 0;

  async function run(): Promise<void> {
    const mine = ++seq;
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(needs).filter(([, v]) => v));
    if (minMemory) body.minMemoryGb = minMemory;
    try {
      const result = await ctx.api.post<PlacementResult>("/api/place", body, scope.signal);
      if (mine !== seq || scope.disposed) return;
      verdict.textContent = result.ranked[0] ? `Best fit: ${result.ranked[0].name}. ${result.rejected.length} ruled out.` : "No machine fits all of that right now.";
      replace(
        out,
        ...result.ranked.map((r, i) =>
          h(
            "div",
            { class: `place-row${i === 0 ? " first" : ""}` },
            h("span", { class: "rank" }, String(i + 1)),
            h("div", { class: "grow" }, h("div", { class: "strong" }, r.name, i === 0 ? h("span", { class: "tiny", style: "color:var(--accent);margin-left:8px;font-weight:600" }, "best fit") : null), r.reasons.length ? h("div", { class: "chips", style: "margin-top:6px" }, ...r.reasons.map((reason) => h("span", { class: "chip" }, reason))) : null),
            h("span", { class: "mono small tnum", title: "score" }, String(r.score)),
          ),
        ),
        ...result.rejected.map((r) =>
          h("div", { class: "place-row rejected" }, icon("x", { size: 14 }), h("div", { class: "grow" }, h("span", { class: "strong" }, r.name), h("span", { class: "small" }, ` · ${r.reason}`)), h("span", {})),
        ),
        !result.ranked.length ? callout("warn", "No machine fits all of that right now.") : null,
      );
    } catch (error) {
      if (mine === seq && !scope.disposed) replace(out, errorState("Couldn't ask the placer", error, () => void run()));
    }
  }
  const runSoon = debounce(() => void run(), 150);
  scope.add(() => runSoon.cancel());

  const chips = toggles.map(([key, label, iconName]) => {
    const chip = h("button", { class: "chip", type: "button", "aria-pressed": "false" }, icon(iconName), label);
    chip.addEventListener("click", () => {
      needs[key] = !needs[key];
      chip.setAttribute("aria-pressed", String(needs[key]));
      runSoon();
    });
    return chip;
  });
  const memory = rangeControl({
    label: "At least this much memory",
    min: 0,
    max: 128,
    step: 4,
    value: 0,
    format: (v) => (v ? `${v} GB` : "any"),
    onInput: (v) => {
      minMemory = v;
      runSoon();
    },
    scale: ["any", "128 GB"],
  });
  void run();
  return h(
    "div",
    { class: "card pad stack loose", id: "placement" },
    h("div", { class: "stack tight" }, h("h3", {}, "Where would this run?"), h("p", { class: "small muted" }, "Describe a piece of work; Galahad ranks your machines and says why. Nothing runs.")),
    h("div", { class: "chips", role: "group", "aria-label": "The work needs" }, ...chips),
    memory.el,
    out,
    verdict,
  );
}

export const fleetView: View = (root, ctx, { scope, opts }) => {
  const admin = ctx.can("fleet:admin");
  const stats = h("div", { class: "grid stats" }, skeletonBlock(92), skeletonBlock(92), skeletonBlock(92));
  const nodesBox = h("div", { class: "grid wide" }, skeletonBlock(180), skeletonBlock(180));
  const clientsBox = h("div", { class: "card" });
  const revokedBox = h("div");
  const errorBox = h("div");

  function render(fleet: FleetView | null): void {
    if (!fleet) return;
    replace(errorBox);
    const active = fleet.devices.filter((d) => !d.revokedAt);
    const nodes = active.filter((d) => d.kind === "node").sort((a, b) => Number(b.id === fleet.self) - Number(a.id === fleet.self) || a.name.localeCompare(b.name));
    const clients = active.filter((d) => d.kind === "client").sort((a, b) => Number(b.id === ctx.identity.device) - Number(a.id === ctx.identity.device) || a.name.localeCompare(b.name));
    const revoked = fleet.devices.filter((d) => d.revokedAt);
    const online = nodes.filter((d) => isOnline(fleet, d)).length;
    const rtts = fleet.peers.filter((p) => p.online && p.rttMs !== null).map((p) => p.rttMs!);
    replace(
      stats,
      statTile({ label: "Nodes online", icon: "server", value: [String(online), h("span", { class: "of" }, ` / ${nodes.length}`)], note: rtts.length ? `median ${rtts.sort((a, b) => a - b)[Math.floor(rtts.length / 2)]} ms` : "this node only" }),
      statTile({ label: "Client devices", icon: "phone", value: String(clients.length), note: "phones and browsers" }),
      statTile({ label: "Mind", icon: "memory", value: fleet.events.toLocaleString(), note: h("span", { class: "mono", title: fleet.digest }, `events · ${fleet.digest.slice(0, 10)}`) }),
    );
    replace(nodesBox, ...nodes.map((d) => nodeCard(ctx, fleet, d)));
    replace(
      clientsBox,
      clients.length
        ? h("div", { class: "rows" }, ...clients.map((d) => clientRow(ctx, fleet, d)))
        : empty({ icon: "phone", title: "No phones or browsers yet", body: "Pair one to talk to Galahad from anywhere on your tailnet.", compact: true, actions: admin ? button("Pair a phone or browser", { icon: "plus", onClick: () => openInvite(ctx, "client") }) : null }),
    );
    replace(
      revokedBox,
      revoked.length
        ? h(
            "details",
            { class: "card" },
            h("summary", { class: "card-head", style: "cursor:pointer;border-bottom:0" }, icon("chevron-right", { size: 14 }), h("span", { class: "small strong" }, `Revoked devices (${revoked.length})`)),
            h("div", { class: "rows", style: "border-top:1px solid var(--border)" }, ...revoked.map((d) => clientRow(ctx, fleet, d))),
          )
        : null,
    );
  }

  replace(
    root,
    h(
      "div",
      { class: "page" },
      pageHead(
        "Fleet",
        "Every body that shares the one mind.",
        admin ? [button("Add a machine", { icon: "server", onClick: () => openInvite(ctx, "node") }), button("Pair a device", { variant: "primary", icon: "plus", onClick: () => openInvite(ctx, "client") })] : null,
      ),
      errorBox,
      stats,
      section("Nodes", {}, nodesBox),
      section("Phones and browsers", {}, clientsBox),
      revokedBox,
      section("Placement", {}, placementPlayground(ctx, scope)),
    ),
  );

  scope.add(ctx.live.fleet.watch((fleet) => keepPlace(root, () => render(fleet))));
  ctx.live.refreshFleet().then(() => {
    if (!ctx.live.fleet.value && !scope.disposed) replace(errorBox, errorState("Couldn't load the fleet", new Error("The node didn't answer."), () => void ctx.live.refreshFleet()));
  });
  if (opts.intent === "invite") openInvite(ctx, "client");
  if (opts.intent === "place") requestAnimationFrame(() => root.querySelector("#placement")?.scrollIntoView({ block: "start", behavior: "smooth" }));
};
