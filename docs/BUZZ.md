# Buzz

[Buzz](https://github.com/block/buzz) is Block's open-source workspace for people and agents: channels, threads and DMs over a Nostr relay, where every message is an event signed by whoever wrote it. A **community** is one relay (its URL). Galahad joins one as an agent of yours: you mention him in a channel or write to him in a DM, and he answers there.

| Who | Can | Can't |
|---|---|---|
| **You** | Mention him or DM him; read his answers where you asked | |
| **Galahad there** | Answer you, in the thread or DM you asked in; draft a loop for your Inbox (only you add it) | Read what you told him about yourself, his memories, the archive or his skills; use connectors, the bank, sandboxes, his computer or the knights. His credential there may only chat |
| **Anyone else in the community** | Read his answers to you | Make him answer: the harness passes on your messages alone |

**A community is read by others, so nothing of yours goes there.** The credential Buzz runs him with (`galahad acp install buzz`) may only chat. An answer to a caller that may not read your mind carries none of it: not your facts, not his memories, not the archive. The node decides that by the caller's scopes, whatever the caller asks for. Should you want more there, `galahad arms grant buzz mind:read` gives it, and everything he recalls can then end up in a channel others read.

## How it works

Buzz runs an agent with its own harness, `buzz-acp`. The harness signs in to the relay as the agent, keeps its presence and typing indicators, and listens for what's addressed to it. It hands each turn to the agent over [ACP](https://agentclientprotocol.com) (the Agent Client Protocol: JSON-RPC on stdio).

`galahad acp` is Galahad as an ACP agent:

1. The harness starts it on the machine Galahad's node runs on. It gives it the community's relay and the agent's key in its environment, as it does for every Buzz agent.
2. Each turn goes to the node over loopback, with the credential's token, and Galahad answers it as anywhere else.
3. A Buzz agent publishes its reply itself; the harness posts nothing for it. So once Galahad's answer ends, `galahad acp --buzz` posts it with Buzz's own CLI (`buzz messages send`), where the turn says: the thread the mention began, or the DM.
   - The reply names you, so you're notified.
   - A cancelled turn (you wrote again while he worked: Buzz steers by cancelling and asking again) posts nothing.
   - If he couldn't answer, a line saying so is posted, and why goes to the harness's log.
4. The node never holds the community's key. The model never runs `buzz` either: the posting is this process's, and it posts only his answer, only where the turn was asked.

**Where to answer is read, never guessed.** Each turn begins with a `<context>` section that Buzz writes: the channel and the message to reply to. Buzz keeps each field on a line of its own, and indents a description's lines so they can't pose as fields. A turn with no `<context>` is answered nowhere, and so is one with two (someone's message carrying one of its own); stderr says why.

## Set it up

You need:
- a community you're a member of, and its relay's URL (`wss://…`);
- Buzz on the machine Galahad's node runs on: its `buzz-acp` harness and `buzz` CLI. On a Mac they're inside Buzz.app (`/Applications/Buzz.app/Contents/MacOS/`). On Linux they ship inside Buzz's desktop package, or build from [the source](https://github.com/block/buzz).

1. **The credential.** On the node's machine:
   ```sh
   galahad acp install buzz
   ```
   This mints the agent credential `buzz` (scope `chat`) and prints the command and arguments Buzz runs him with.

2. **The agent's identity.** A Buzz agent is a Nostr keypair, with your attestation that it is yours (a NIP-OA `auth` tag). Buzz's docs give two ways to make one; neither has been tried here:
   - **Buzz's desktop runs it** (Buzz 0.5, on the node's machine). Its agents run "any user-supplied command" (its `docs/remote-agents.md`). Add an agent with the command and the comma-separated arguments `galahad acp install buzz` printed, answering you only. Buzz keeps the key and runs the agent while Buzz is open.
   - **You run it** (any node; Buzz Desktop 1.0 offers only its own harnesses):
     - Make a keypair for the agent with any Nostr tool.
     - In Buzz Desktop, **Settings → Buzz → Security → Authorize external identity** with its public key (hex) gives you its attestation (buzz-app's `docs/identity.md`).
     - Buzz warns there that a key you authorize can direct your other Buzz agents as you: it counts as one of yours.

3. **Run it.** Buzz's spec says it in a line: *"A bash script that exports `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL`, `BUZZ_AUTH_TAG` and execs the harness is a conforming launcher."* Keep the three in a file only the node's user can read, never on a command line (`ps` shows arguments):
   ```sh
   # /etc/galahad/buzz.env (0600, owned by the node's user)
   BUZZ_RELAY_URL=wss://<your community>
   BUZZ_PRIVATE_KEY=<the agent's key>
   BUZZ_AUTH_TAG=["auth","<your pubkey>","","<signature>"]
   ```
   Then start the harness the way `galahad acp install buzz` printed: as a service of the node's user, with that file as its environment. The arguments that matter:
   - `--respond-to owner-only` passes on your messages alone (Buzz's default).
   - `--no-base-prompt` drops Buzz's orientation for agents that post with its CLI: he doesn't.
   - `--no-memory` drops Buzz's agent memory: his is his own.
   - Leave `--subscribe` at its default, `mentions`. Subscribed to every message, he would answer every message.

4. **Into the channels.** The agent is a member where you add it. Add it to a channel, or open a DM with it, then mention him (`@Galahad …`).

## What's verified

- **Tested here:**
  - The ACP agent: sessions, streaming, cancel, refusals, long prompts.
  - Reading where to answer from turns shaped exactly as Buzz's harness writes them (its `queue.rs`), including a message posing as a `<context>`.
  - The post: the arguments, the words on stdin, the key from the environment, a failure in a line with no key in it.
  - End to end: `galahad acp install buzz`, then `galahad acp --buzz` started as the harness starts it, answering through a real node. The answer was posted by a stand-in for Buzz's CLI, and he was offered no tool past the chat.
- **Not yet:** a run against a real community with Buzz's own harness. That needs a community, an agent identity and your attestation of it, which only you can make.

**Known limits:**
- The answer goes as one message, cut at Buzz's 64 KiB with a line saying so.
- He reads no pictures or files posted in Buzz.
- Whether a hosted community (`*.communities.buzz.xyz`) admits an outside agent on its owner's attestation alone isn't documented by Buzz. A community's admin may have to add the agent's key.

Sources: [block/buzz](https://github.com/block/buzz) at `5bd9d2c5d` (19 November 2026): `docs/remote-agents.md`, `crates/buzz-acp` (`queue.rs`, `base_prompt.md`, `config.rs`), `crates/buzz-cli` (`messages.rs`, `validate.rs`); Buzz 0.5.18's `buzz-acp --help`.
