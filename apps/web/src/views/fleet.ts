import type { DeviceView, FleetView, PairingView } from "@galahad/core";
import { errorMessage, type View } from "../context.ts";
import { badge, copyBox, h, hlcDate, notice, replace, short, toast } from "../dom.ts";

interface InviteResponse {
  invite: string;
  url: string | null;
  expiresAt: number;
  id: string;
}

function capsSummary(caps: Record<string, any> | null): string {
  if (!caps) return "no capability profile yet";
  const parts = [`${caps.os}/${caps.arch}`, `${caps.cores} cores`, `${caps.memoryGb} GB`];
  if (caps.gpu?.length) parts.push(`GPU ${caps.gpu[0].name}`);
  if (caps.docker) parts.push("docker");
  if (caps.vm?.kvm) parts.push("KVM");
  const models = (caps.localModels ?? []).flatMap((r: { models: string[] }) => r.models);
  if (models.length) parts.push(`${models.length} local model${models.length === 1 ? "" : "s"}`);
  if (caps.hasBattery) parts.push("battery");
  return parts.join(" · ");
}

export const fleetView: View = (root, ctx) => {
  const summary = h("div");
  const devicesBox = h("ul", { class: "list" });
  const inviteBox = h("div");
  const pairingsBox = h("div", { "aria-live": "polite" });
  const status = h("div");
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  const admin = ctx.can("fleet:admin");

  function deviceItem(d: DeviceView, fleet: FleetView): HTMLElement {
    const peer = fleet.peers.find((p) => p.device === d.id);
    const state = d.revokedAt
      ? badge("revoked", "danger")
      : d.id === fleet.self
        ? badge("this node", "accent")
        : d.id === ctx.identity.device
          ? badge("this browser", "accent")
          : d.kind === "client"
            ? badge("client")
            : peer?.online
              ? badge(`online${peer.rttMs !== null ? ` · ${peer.rttMs} ms` : ""}`, "ok")
              : badge("offline", "warn");
    const canRevoke = admin && !d.revokedAt && d.id !== fleet.self;
    return h(
      "li",
      {},
      h("div", { class: "row" }, h("strong", {}, d.name), badge(d.kind === "node" ? d.role : "client"), state, h("span", { class: "grow" }),
        canRevoke
          ? h(
              "button",
              {
                class: "btn small danger",
                type: "button",
                onclick: async () => {
                  const warning =
                    d.kind === "node"
                      ? `Revoke ${d.name}? It is removed from the fleet and the vault is rotated. Keys it could read should also be rotated at their providers.`
                      : `Revoke ${d.name}? It will no longer be able to reach Galahad.`;
                  if (!window.confirm(warning)) return;
                  try {
                    const result = await ctx.api.post<{ resealed?: string[] }>("/api/devices/revoke", { device: d.id, reason: "revoked from the PWA" });
                    toast(result.resealed?.length ? `Revoked. Rotate at the provider: ${result.resealed.join(", ")}` : "Revoked.");
                    await refresh();
                  } catch (error) {
                    toast(errorMessage(error), "error");
                  }
                },
              },
              "Revoke",
            )
          : null,
      ),
      d.kind === "node" ? h("div", { class: "small muted", style: "margin-top:4px" }, capsSummary(d.caps as Record<string, any> | null)) : null,
      h(
        "div",
        { class: "small muted" },
        [d.endpoint, `id ${short(d.id)}`, `joined ${hlcDate(d.enrolledAt)}`, d.revokedAt ? `revoked ${hlcDate(d.revokedAt)}` : ""].filter(Boolean).join(" · "),
      ),
    );
  }

  async function refresh(): Promise<void> {
    try {
      const fleet = await ctx.api.get<FleetView>("/api/fleet");
      replace(
        summary,
        h(
          "div",
          { class: "row small muted" },
          h("span", {}, `${fleet.devices.filter((d) => !d.revokedAt).length} devices`),
          h("span", {}, `${fleet.events} events`),
          h("span", { class: "mono" }, `mind ${fleet.digest.slice(0, 10)}`),
        ),
      );
      const ordered = [...fleet.devices].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
      replace(devicesBox, ...ordered.map((d) => deviceItem(d, fleet)));
      replace(status);
    } catch (error) {
      replace(status, notice(errorMessage(error), "error"));
    }
  }

  async function refreshPairings(): Promise<void> {
    if (!admin) return;
    try {
      const { pairings } = await ctx.api.get<{ pairings: PairingView[] }>("/api/pairings");
      if (!pairings.length) {
        replace(pairingsBox);
        return;
      }
      replace(
        pairingsBox,
        ...pairings.map((p) =>
          h(
            "div",
            { class: "card", style: "border-color:var(--accent)" },
            h("h2", {}, `${p.name} wants to join`),
            h("p", { class: "muted" }, `A ${p.kind === "node" ? "machine" : "phone or browser"}. Approve only if it shows exactly this code:`),
            h("div", { class: "sas", "aria-label": `Code ${p.sas.split("").join(" ")}` }, p.sas),
            p.conflict ? notice("This invite was used by two devices. It may have been intercepted; create a new one.", "error") : null,
            h(
              "div",
              { class: "row", style: "justify-content:center" },
              h(
                "button",
                {
                  class: "btn primary",
                  type: "button",
                  disabled: p.conflict,
                  onclick: async () => {
                    try {
                      await ctx.api.post("/api/pairings/approve", { invite: p.invite, device: p.device });
                      toast(`${p.name} has joined the fleet.`);
                      replace(inviteBox);
                      await Promise.all([refreshPairings(), refresh()]);
                    } catch (error) {
                      toast(errorMessage(error), "error");
                    }
                  },
                },
                "The codes match — approve",
              ),
              h(
                "button",
                {
                  class: "btn danger",
                  type: "button",
                  onclick: async () => {
                    try {
                      await ctx.api.post("/api/pairings/reject", { invite: p.invite, device: p.device });
                      toast("Rejected.");
                      await refreshPairings();
                    } catch (error) {
                      toast(errorMessage(error), "error");
                    }
                  },
                },
                "Reject",
              ),
            ),
          ),
        ),
      );
    } catch {
      /* transient; next poll retries */
    }
  }

  async function createInvite(kind: "client" | "node"): Promise<void> {
    try {
      const invite = await ctx.api.post<InviteResponse>("/api/invites", { kind, origin: location.origin });
      const countdown = h("span", { class: "small muted" });
      const tick = () => {
        const left = Math.max(0, invite.expiresAt - Date.now());
        countdown.textContent = left ? `Valid for ${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}, single use.` : "Expired — create a new one.";
      };
      tick();
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = setInterval(tick, 1000);
      replace(
        inviteBox,
        h(
          "div",
          { class: "card stack" },
          h("h2", {}, kind === "client" ? "Open this on the phone or browser" : "Run this on the new machine"),
          copyBox(kind === "client" ? (invite.url ?? invite.invite) : `galahad join ${invite.invite}`),
          countdown,
          h("p", { class: "small muted" }, "Treat it like a password. When the device asks to join, its code appears below — approve only if both screens match."),
        ),
      );
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  replace(
    root,
    h("h1", {}, "Fleet"),
    h("p", { class: "lede" }, "Every body that shares the one mind."),
    summary,
    status,
    admin
      ? h(
          "div",
          { class: "card" },
          h("h2", {}, "Add a device"),
          h(
            "div",
            { class: "row" },
            h("button", { class: "btn primary", type: "button", onclick: () => void createInvite("client") }, "Pair a phone or browser"),
            h("button", { class: "btn", type: "button", onclick: () => void createInvite("node") }, "Add a machine"),
          ),
          h("div", { style: "margin-top:12px" }, inviteBox),
        )
      : null,
    pairingsBox,
    h("div", { class: "card" }, h("h2", {}, "Devices"), devicesBox),
  );

  void refresh();
  void refreshPairings();
  pollTimer = setInterval(() => {
    void refreshPairings();
  }, 1500);
  const fleetTimer = setInterval(() => void refresh(), 10_000);

  return () => {
    if (pollTimer) clearInterval(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    clearInterval(fleetTimer);
  };
};
