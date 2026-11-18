# Build: a workbench with Galahad

**Code beside Galahad, as T3 Code lets you code beside Claude Code or Codex.** A window of the Mac app where your projects are down the side, each with its threads; a thread with Galahad in the middle; what changed in the project beside it; a terminal under it; and the project's branch and its commits in the header. The owner asked for it on 18 November 2026: "add all the features and tools of t3 code into galahad on mac app … a separate view where you build in a more advanced panel with your primary knight", and to take from T3 Code (MIT) what makes sense.

Status: designed, and its first phase built (the node's side and the Mac window), 18 November 2026; the phases after it are below.

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

## The window (Mac, phase 1, built)

`apps/apple/Galahad/Mac/BuildWindow.swift`; File → Build with Galahad (⇧⌘B), or Build in the main window's sidebar.

- **Down the side: your projects**, each with its threads (his chats in it, the latest first, with what each is at: working, needs you, or when it was last touched) and a New Thread. New Project takes a name, a repository and his instructions for it.
- **In the middle: the thread**, his chat as everywhere else, with its project's name as the title and the thread and its branch under it. His work in it reads as a work log: each tool he used, the command it ran and the first lines of what came back.
- **Beside it: Changes** (⌘D), what changed in the checkout since its last commit, each file with its part of the diff, and the whole diff; and its **Files**, read only. They are read again after each answer and each action, without losing your place in a diff.
- **Under it: a terminal** (⌘J) in his computer, started in the checkout (a `cd` typed into a terminal the window opened, never into one already running something).
- **In the bar**: the branch the checkout is on, to switch to another or start one; Set Up Checkout when it isn't there yet; the model the thread answers with (his usual, or any model of the roster's); Commit, with how many files it takes; and Look Again (⌘R).

## The phases after it

What T3 Code has that fits, in the order it would help most (T3 Code's own paths in parentheses, from a survey of its repository on 18 November; it is MIT-licensed, and its Swift is UIKit bound to Expo, so it is taken as ideas, not code):

1. **Checkpoints, a diff per turn, and going back.** The checkout's state kept at each turn (a hidden git ref, as T3 Code's `checkpointing/CheckpointStore.ts`), so each answer lists what it changed with its own diff, and "Edit from here" can rewind the thread and put the files back as they were.
2. **Comments on lines, to him.** A line of a diff or a file commented on goes into the message box as a reference he reads (T3 Code's `DiffCommentAnnotation.tsx` and its composer context chips).
3. **Pull requests, the oath's way.** Commit, then a pull request proposed from the checkout's branch and approved by you before anything leaves (`galahad ship`'s path), its checks and review comments brought back to the thread (T3 Code's `PullRequestWatchService.ts`; PLAN #29).
4. **A command palette and search** (⌘K): threads, projects and actions by name; a thread's words searched (`CommandPalette.tsx`, `ThreadFindBar.tsx`).
5. **Generated words**: a commit's message and a branch's name from the diff and the thread, on the cheap role (`text-generation.md`).
6. **Project actions**: named commands of the project's (its dev server, its tests) run from the bar or a key, and its servers' ports opened in his browser (`t3.json`, `ThreadServersPanel.tsx`).
7. **Side questions**: a question with the thread's context answered aside, not in the thread (`/btw`, `SideChatPane.tsx`).
8. **Queue or steer**, said in the box while he works (the node already steers), and **effort** beside the model.
9. **A primary knight**: the window on a knight's VM and its chats when a knight leads.

Not taken: T3 Code's many agent providers (Galahad is the agent; his knights run Claude Code, Codex, OpenCode or Hermes in their VMs), its own remote access (the node is reached over your tailnet), its theme editor, and its devices and browser tools (his desktop is the browser here).
