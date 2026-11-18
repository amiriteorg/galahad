import type { TelegramView } from "@galahad/core";
import { type Ctx, errorMessage } from "../context.ts";
import { relativeTime } from "../lib/time.ts";
import { busy, button, callout, card, copyField, listRow, note, secretInput, section, skeletonBlock } from "../ui/controls.ts";
import { confirmAction } from "../ui/dialog.ts";
import { h, replace } from "../ui/dom.ts";
import { toast } from "../ui/toast.ts";

/*
 * Chat apps (PLAN #19): Telegram, through a bot of yours, on the node this device talks to. Connecting takes the bot's
 * token (sealed on the node, as a key is) and gives a code to send the bot from your own account; only that account is
 * answered, as a device of its own that may chat. Its chats are yours, here.
 */

/** The code Connect answered, held here only (the node shows it to nobody after): it links your account once. */
interface LinkCode {
  code: string;
  expires: number;
}

export function chatAppsSection(ctx: Ctx): { el: HTMLElement; refresh: () => Promise<void> } {
  const body = h("div", { class: "stack" }, skeletonBlock(120));
  const el = section("Chat apps", { note: "Talk to Galahad from a chat app you already use. Approvals stay here." }, body);
  el.hidden = !ctx.can("mind:read");
  let code: LinkCode | null = null;

  async function refresh(): Promise<void> {
    if (el.hidden) return;
    try {
      const { telegram } = await ctx.api.get<{ telegram: TelegramView }>("/api/telegram");
      if (telegram.owner || !telegram.connected) code = null;
      replace(body, telegramCard(ctx, telegram, code, (given) => ((code = given), refresh()), refresh));
    } catch (error) {
      replace(body, callout("danger", errorMessage(error), { title: "Couldn't read the chat apps" }));
    }
  }
  return { el, refresh };
}

function telegramCard(ctx: Ctx, telegram: TelegramView, code: LinkCode | null, connected: (code: LinkCode) => Promise<void>, refresh: () => Promise<void>): HTMLElement {
  const admin = ctx.can("fleet:admin");
  const status = h("div");
  const disconnect = button("Disconnect", {
    size: "sm",
    variant: "ghost",
    icon: "x",
    onClick: async (event) => {
      const ok = await confirmAction({ title: "Disconnect Telegram?", body: "Its device is revoked and the bot's token deleted. The chats it had stay yours.", confirmLabel: "Disconnect" });
      if (!ok) return;
      await busy(event.currentTarget as HTMLButtonElement, async () => {
        try {
          await ctx.api.post("/api/telegram/disconnect", {});
          toast("Telegram disconnected", { tone: "ok" });
          await refresh();
        } catch (error) {
          replace(status, callout("danger", errorMessage(error)));
        }
      });
    },
  });

  const token = secretInput({ label: "The bot's token", placeholder: "123456789:AA… from @BotFather" });
  const connect = button(telegram.connected ? "New code" : "Connect", { variant: "primary", type: "submit", icon: "chat" });
  const form = h(
    "form",
    {
      class: "row",
      autocomplete: "off",
      onsubmit: (event: Event) => {
        event.preventDefault();
        // Read, then cleared at once: the token lives in this page as briefly as possible.
        const value = token.input.value.trim();
        token.input.value = "";
        if (!value) return void token.input.focus();
        void busy(connect, async () => {
          try {
            const done = await ctx.api.post<{ bot: string; code: string; expires: number }>("/api/telegram/connect", { token: value });
            toast(`${done.bot} connected`, { tone: "ok", description: "Send it the message below from your own Telegram account." });
            await connected({ code: done.code, expires: done.expires });
          } catch (error) {
            replace(status, callout("danger", `${errorMessage(error)}. The field was cleared; paste the token again.`));
          }
        });
      },
    },
    h("div", { class: "grow" }, token.wrap),
    connect,
  );

  const head = listRow({
    lead: "chat",
    title: "Telegram",
    sub: telegram.connected ? `${telegram.bot ?? "Your bot"} on ${telegram.node}` : "Not connected",
    meta: telegram.owner ? [h("span", {}, `Answers ${telegram.owner}, and nobody else`)] : [],
  });

  if (!telegram.connected) {
    return card(
      { label: "Telegram" },
      head,
      note("Through a bot of yours: make one with @BotFather (send it /newbot), and paste the token it gives you. Only your own account is answered, as a device of its own that may chat; nothing on your network is opened."),
      admin ? form : callout("quiet", "Connecting needs a device with fleet:admin, or a terminal on a node: galahad telegram connect."),
      status,
    );
  }
  return card(
    { label: "Telegram" },
    head,
    telegram.problem ? callout("warn", telegram.problem) : null,
    !telegram.owner && code && code.expires > Date.now()
      ? h(
          "div",
          { class: "stack tight" },
          note(`From your own Telegram account, send ${telegram.bot ?? "the bot"} this message (it stops working ${relativeTime(code.expires)}):`),
          copyField(`/start ${code.code}`, "Copy the message"),
        )
      : null,
    !telegram.owner && !(code && code.expires > Date.now())
      ? callout("info", telegram.linkExpires ? "Waiting for the code Connect gave. Lost it? Give the token again for a new one." : "No account is linked yet: give the token again for a new code.")
      : null,
    telegram.owner ? note("Your chats from Telegram are kept with your other chats here. Photos and files go through this app for now.") : null,
    admin && (!telegram.owner || telegram.problem) ? form : null,
    admin ? h("div", { class: "row" }, disconnect) : null,
    status,
  );
}
