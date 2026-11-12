import type { FleetView, SecretView } from "@galahad/core";
import { isUnavailable } from "../api.ts";
import type { View } from "../context.ts";
import { ledgerSignature } from "../lib/activity.ts";
import { gb, plural } from "../lib/text.ts";
import { greeting } from "../lib/time.ts";
import { asCaps, type LedgerEntry } from "../types.ts";
import { button, dot, empty, meter, pageHead, section, skeletonRows, skeletonStat, statTile } from "../ui/controls.ts";
import { h, keepPlace, replace } from "../ui/dom.ts";
import { icon } from "../ui/icons.ts";
import { autonomyCard, ledgerItem } from "./activity.ts";
import { inHandSection } from "./in-hand.ts";
import { doctorSection } from "./doctor-card.ts";
import { startNewChat } from "./chat.ts";
import { isOnline, openInvite, peerOf } from "./fleet.ts";
import { openAddKey, vaultChanged } from "./vault.ts";

/* Home: is everything well, does anything need me, what has Galahad been doing. */

export const overviewView: View = (root, ctx, { scope }) => {
  const stats = h("div", { class: "grid stats" }, skeletonStat(), skeletonStat(), skeletonStat(), skeletonStat());
  const health = h("div", { class: "card" }, skeletonRows(2, { avatar: true }));
  const recent = h("div", { class: "card" }, skeletonRows(4));
  const autonomyBox = h("div", {}, autonomyCard(null));
  const lede = h("span", {}, ctx.whoami.fleetName ? `Fleet ${ctx.whoami.fleetName}, through ${ctx.whoami.nodeName}.` : `Through ${ctx.whoami.nodeName}.`);
  let vault: { count: number; unlocked: boolean } | null = null;
  let ledgerMissing = false;
  let ledgerSeen = "";

  function renderStats(fleet: FleetView | null): void {
    const tiles: HTMLElement[] = [];
    if (fleet) {
      const nodes = fleet.devices.filter((d) => d.kind === "node" && !d.revokedAt);
      const online = nodes.filter((d) => isOnline(fleet, d)).length;
      tiles.push(
        statTile({
          label: "Nodes online",
          icon: "server",
          value: [String(online), h("span", { class: "of" }, ` / ${nodes.length}`)],
          note: online === nodes.length ? [dot("ok"), "all well"] : [dot("warn"), `${nodes.length - online} offline`],
          href: "#/fleet",
        }),
      );
      lede.textContent = `${ctx.whoami.fleetName ?? fleet.name ?? "Your fleet"}: ${online === nodes.length ? `all ${plural(nodes.length, "node")} online` : `${online} of ${plural(nodes.length, "node")} online`}, through ${ctx.whoami.nodeName}.`;
    }
    const inbox = ctx.live.inboxCount.value;
    tiles.push(statTile({ label: "Inbox", icon: "inbox", value: String(inbox), note: inbox ? [dot("accent"), "waiting for you"] : "nothing needs you", href: "#/inbox" }));
    if (ctx.can("vault:read")) {
      tiles.push(
        statTile({
          label: "Vault",
          icon: "vault",
          value: vault ? String(vault.count) : "–",
          note: vault ? (vault.unlocked ? [dot("ok"), "sealed keys, usable here"] : [dot("warn"), "locked on this node"]) : "loading…",
          href: "#/vault",
        }),
      );
    }
    if (fleet) tiles.push(statTile({ label: "Mind", icon: "memory", value: fleet.events.toLocaleString(), note: "events in the shared mind", href: "#/memory" }));
    replace(stats, ...tiles);
  }

  function renderHealth(fleet: FleetView | null): void {
    if (!fleet) return;
    const nodes = fleet.devices.filter((d) => d.kind === "node" && !d.revokedAt).sort((a, b) => Number(b.id === fleet.self) - Number(a.id === fleet.self) || a.name.localeCompare(b.name));
    replace(
      health,
      h(
        "div",
        { class: "rows" },
        ...nodes.map((d) => {
          const peer = peerOf(fleet, d.id);
          const caps = asCaps(d.caps);
          const online = isOnline(fleet, d);
          const presence = peer?.presence;
          const load = presence && caps?.cores ? Math.min(1, presence.load / (presence.cores || caps.cores)) : null;
          return h(
            "a",
            { class: "item center", href: "#/fleet", style: "text-decoration:none;color:inherit" },
            h("span", { class: "avatar" }, icon(caps?.hasBattery ? "laptop" : "server", { size: 16 })),
            h(
              "div",
              { class: "grow" },
              h("div", { class: "row" }, h("span", { class: "strong" }, d.name), d.id === fleet.self ? h("span", { class: "tiny subtle" }, "this node") : null),
              h(
                "div",
                { class: "meta" },
                dot(online ? "ok" : null),
                h("span", { class: "tnum" }, online ? (d.id === fleet.self ? "online" : `online${peer?.rttMs != null ? ` · ${peer.rttMs} ms` : ""}`) : "offline"),
                caps?.memoryGb ? h("span", {}, `${caps.cores ?? "?"} cores · ${gb(caps.memoryGb)}`) : null,
                presence?.onBattery ? h("span", {}, "on battery") : null,
              ),
            ),
            load !== null ? h("div", { style: "width:72px" }, h("div", { class: "tiny subtle tnum", style: "text-align:right;margin-bottom:4px" }, `${Math.round(load * 100)}% load`), meter(load, load > 0.85 ? "var(--warn)" : undefined, "CPU load")) : null,
          );
        }),
      ),
    );
  }

  async function loadVault(): Promise<void> {
    if (!ctx.can("vault:read")) return;
    try {
      const result = await ctx.api.get<{ secrets: SecretView[]; unlocked: boolean }>("/api/secrets", scope.signal);
      vault = { count: result.secrets.length, unlocked: result.unlocked };
      if (!scope.disposed) renderStats(ctx.live.fleet.value);
    } catch {
      /* the tile shows a dash */
    }
  }

  async function loadLedger(): Promise<void> {
    if (ledgerMissing) return;
    if (!ctx.can("mind:read")) {
      replace(recent, empty({ icon: "activity", title: "Activity needs the mind:read scope", compact: true }));
      return;
    }
    try {
      const { entries } = await ctx.api.get<{ entries: LedgerEntry[] }>("/api/ledger", scope.signal);
      if (scope.disposed) return;
      // Nothing new since the last look: leave the cards as they are.
      const seen = ledgerSignature(entries);
      if (seen === ledgerSeen) return;
      ledgerSeen = seen;
      const latest = [...entries].sort((a, b) => (a.hlc < b.hlc ? 1 : -1)).slice(0, 8);
      replace(autonomyBox, autonomyCard(entries));
      replace(
        recent,
        latest.length
          ? h("div", { class: "timeline" }, ...latest.map((e) => ledgerItem(ctx, e, true)))
          : empty({ icon: "activity", title: "Quiet so far", body: "What Galahad creates, changes or sends will show up here.", compact: true }),
      );
    } catch (error) {
      if (scope.disposed) return;
      ledgerSeen = "";
      if (isUnavailable(error)) ledgerMissing = true;
      replace(
        recent,
        empty({
          icon: "scroll",
          title: isUnavailable(error) ? "The ledger arrives with an upcoming update" : "Couldn't read recent activity",
          body: isUnavailable(error) ? "The oath already gates every action; soon you'll see each one here." : String((error as Error).message ?? error),
          compact: true,
        }),
      );
    }
  }

  const actions = [
    ctx.can("chat")
      ? button("New chat", {
          variant: "primary",
          icon: "chat",
          onClick: () => {
            startNewChat();
            ctx.navigate("chat");
          },
        })
      : null,
    ctx.can("vault:write") ? button("Add key", { icon: "key", onClick: () => openAddKey(ctx) }) : null,
    ctx.can("fleet:admin") ? button("Pair device", { icon: "phone", onClick: () => openInvite(ctx, "client") }) : null,
  ];

  replace(
    root,
    h(
      "div",
      { class: "page" },
      pageHead(`${greeting()}.`, lede, actions),
      stats,
      h(
        "div",
        { class: "two-col" },
        h(
          "div",
          { class: "stack loose" },
          // What he's working on now: the turns the node is running, and the quests in hand with their plan and gates.
          inHandSection(ctx, scope),
          ctx.can("mind:read") ? section("Fleet health", { actions: h("a", { href: "#/fleet", class: "btn ghost sm" }, "Open fleet", icon("chevron-right", { size: 14 })) }, health) : null,
          section("Recent activity", { actions: h("a", { href: "#/activity", class: "btn ghost sm" }, "View all", icon("chevron-right", { size: 14 })) }, recent),
        ),
        // Is everything well on the node you're talking to: a quick look by the doctor, and a full check when you ask.
        h("div", { class: "stack loose" }, doctorSection(ctx, scope), autonomyBox),
      ),
    ),
  );

  scope.add(
    ctx.live.fleet.watch((fleet) => {
      keepPlace(root, () => {
        renderStats(fleet);
        renderHealth(fleet);
      });
    }),
  );
  scope.add(ctx.live.inboxCount.subscribe(() => renderStats(ctx.live.fleet.value)));
  scope.add(vaultChanged.subscribe(() => void loadVault()));
  void loadVault();
  void loadLedger();
  scope.interval(() => void loadLedger(), 15_000);
};
