# Build: a workbench with Galahad

**Code beside Galahad, as T3 Code lets you code beside Claude Code or Codex.** A window of the Mac app where your projects are down the side, each with its threads; a thread with Galahad in the middle; what changed in the project beside it; a terminal under it; and the project's branch and its commits in the header. The owner asked for it on 18 November 2026: "add all the features and tools of t3 code into galahad on mac app … a separate view where you build in a more advanced panel with your primary knight", and to take from T3 Code (MIT) what makes sense.

Status: designed, and its node side built, 18 November 2026; the Mac window is being built.

## What it is, and what it isn't

- **Galahad works; you review.** In T3 Code the agent edits a folder on your machine. Here Galahad works in his own computer (his VM, kept between conversations), in one checkout per project, and the Build window shows that checkout: what changed since its last commit, its files, its branch, a terminal there. You read the changes, then commit them, or ask for more.
- **A project is the one Galahad already has** (`project.set`: a name, his instructions for it, a repository). Its threads are its chats. Build adds where its work is kept: `/work/projects/<id>` on his computer (core's `projectCheckout`), told to him with the project's context when he has a computer.
- **One agent, the primary.** The owner's word: build "with your primary knight (for that would be galahad)". Galahad first; a knight made primary works the same way in its own VM later.
- **Nothing outward without you.** His computer holds no key that can push. A commit is yours, from the window; a pull request goes the way all outward work does: proposed, then approved (`galahad ship`, the oath gate).

## The node

All yours alone (owner-only, scope `sandbox`), each a fixed script run in his computer with its input as arguments, never through a shell (`packages/node/src/project-git.ts`, beside `workspace-look.ts`):

| Route | What it does |
|---|---|
| `POST /api/projects/git` `{ id }` | The checkout as git has it: missing, not a repository, or ready with its branch, branches (latest first), how many files are changed or new, its upstream and how far ahead and behind, origin's address with any credentials taken out, its last ten commits. |
| `POST /api/projects/branch` `{ id, branch, create }` | Switch to a branch, or start one where it stands. The name is held to what git takes before it reaches the VM (core's `BranchName`), and git checks it again there. |
| `POST /api/projects/commit` `{ id, message }` | Everything changed or new, committed; as Galahad where the checkout has no author set. A message with a key in it is refused. |
| `POST /api/projects/clone` `{ id }` | The project's repository cloned into its checkout, the first time (never over a folder that has something in it). |
| `POST /api/team/changes` `{ id: "galahad", path }` | What changed in the repository at `path` since its last commit: each file's part of the diff, and what git doesn't track yet. (`path` is under `/work`; a task or a path, not both.) |

The terminal has them too: `galahad project git|changes|clone <id>`, `galahad project branch <id> <name> [--new]`, `galahad project commit <id> --message "…"`.

A Build thread is a chat with `project` set; a model chosen for it goes with each message (`model`, the chat route's own).
