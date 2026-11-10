import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync } from "node:fs";
import { type ChatMessage, type ConversationSummary, type ConversationView, randomId, type StoredMessage, type StoredStep } from "@galahad/core";

/*
 * Your chat history, on the node that served it: a private database (mode 600, in the
 * node's 700 home), never replicated. Deleting a conversation deletes it: SQLite's
 * secure_delete overwrites what it held. Only you read it; the server decides who
 * "you" is (see the conversation routes).
 */

interface ConversationRow {
  id: string;
  title: string;
  project: string | null;
  role: string;
  pinned: number;
  bank: number;
  created_at: number;
  updated_at: number;
  count: number;
}

interface MessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  steps: string;
  status: StoredMessage["status"];
  error: string | null;
  created_at: number;
  ended_at: number | null;
}

const summaryOf = (r: ConversationRow): ConversationSummary => ({
  id: r.id,
  title: r.title,
  project: r.project,
  role: r.role,
  pinned: r.pinned === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  count: r.count,
  bank: r.bank === 1,
});

const SUMMARY = "SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation = c.id) AS count FROM conversations c";

export class ChatStore {
  private readonly db: Database;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    if (path !== ":memory:" && !existsSync(path)) closeSync(openSync(path, "wx", 0o600));
    this.db = new Database(path);
    this.db.exec("PRAGMA secure_delete = ON; PRAGMA foreign_keys = ON;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, project TEXT, role TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0, bank INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, steps TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, ended_at INTEGER);
      CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation, id);`);
    // An answer the node was writing when it stopped can't finish any more.
    this.db.exec("UPDATE messages SET status = 'stopped' WHERE status = 'streaming'");
  }

  create(input: { title: string; project: string | null; role: string }): ConversationSummary {
    const id = `cv_${randomId(16)}`;
    const at = this.now();
    this.db.query("INSERT INTO conversations (id, title, project, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, input.title, input.project, input.role, at, at);
    return this.summary(id)!;
  }

  summary(id: string): ConversationSummary | null {
    const row = this.db.query<ConversationRow, [string]>(`${SUMMARY} WHERE c.id = ?`).get(id);
    return row ? summaryOf(row) : null;
  }

  /** Pinned first, then the most recently active. */
  list(): ConversationSummary[] {
    return this.db.query<ConversationRow, []>(`${SUMMARY} ORDER BY c.pinned DESC, c.updated_at DESC LIMIT 2000`).all().map(summaryOf);
  }

  get(id: string): ConversationView | null {
    const summary = this.summary(id);
    if (!summary) return null;
    const messages = this.db
      .query<MessageRow, [string]>("SELECT * FROM messages WHERE conversation = ? ORDER BY id")
      .all(id)
      .map(
        (m): StoredMessage => ({
          id: m.id,
          role: m.role,
          content: m.content,
          model: m.model,
          steps: JSON.parse(m.steps) as StoredStep[],
          status: m.status,
          error: m.error,
          createdAt: m.created_at,
          endedAt: m.ended_at,
        }),
      );
    return { ...summary, messages };
  }

  /** What the model sees of it: every question, and every answer that has words in it. */
  history(id: string): ChatMessage[] {
    return this.db
      .query<{ role: "user" | "assistant"; content: string }, [string]>("SELECT role, content FROM messages WHERE conversation = ? AND content != '' ORDER BY id")
      .all(id);
  }

  addUser(id: string, content: string): number {
    const at = this.now();
    const row = this.db.query<{ id: number }, [string, string, number, number]>("INSERT INTO messages (conversation, role, content, status, created_at, ended_at) VALUES (?, 'user', ?, 'done', ?, ?) RETURNING id").get(id, content, at, at)!;
    this.touch(id);
    return row.id;
  }

  /** An answer begins: it's kept even if nothing comes of it (an error, a stop). */
  startAnswer(id: string): number {
    return this.db.query<{ id: number }, [string, number]>("INSERT INTO messages (conversation, role, content, status, created_at) VALUES (?, 'assistant', '', 'streaming', ?) RETURNING id").get(id, this.now())!.id;
  }

  finishAnswer(conversation: string, message: number, answer: { content: string; model: string | null; steps: StoredStep[]; status: "done" | "error" | "stopped"; error: string | null; bank: boolean }): void {
    this.db
      .query("UPDATE messages SET content = ?, model = ?, steps = ?, status = ?, error = ?, ended_at = ? WHERE id = ? AND conversation = ?")
      .run(answer.content, answer.model, JSON.stringify(answer.steps), answer.status, answer.error, this.now(), message, conversation);
    if (answer.bank) this.db.query("UPDATE conversations SET bank = 1 WHERE id = ?").run(conversation);
    this.touch(conversation);
  }

  update(id: string, change: { title?: string; project?: string | null; pinned?: boolean }): ConversationSummary | null {
    if (change.title !== undefined) this.db.query("UPDATE conversations SET title = ? WHERE id = ?").run(change.title, id);
    if (change.project !== undefined) this.db.query("UPDATE conversations SET project = ? WHERE id = ?").run(change.project, id);
    if (change.pinned !== undefined) this.db.query("UPDATE conversations SET pinned = ? WHERE id = ?").run(change.pinned ? 1 : 0, id);
    return this.summary(id);
  }

  /** Asked again: the last question and its answer go, so the new ones take their place. */
  dropLastExchange(id: string): void {
    const last = this.db.query<{ id: number }, [string]>("SELECT id FROM messages WHERE conversation = ? AND role = 'user' ORDER BY id DESC LIMIT 1").get(id);
    if (last) this.db.query("DELETE FROM messages WHERE conversation = ? AND id >= ?").run(id, last.id);
  }

  /** Gone for good: secure_delete overwrites its pages in the file. */
  delete(id: string): boolean {
    return this.db.query("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;
  }

  /** A project that's gone leaves its chats where they were, outside any project. */
  projectRemoved(project: string): void {
    this.db.query("UPDATE conversations SET project = NULL WHERE project = ?").run(project);
  }

  close(): void {
    this.db.close();
  }

  private touch(id: string): void {
    this.db.query("UPDATE conversations SET updated_at = ? WHERE id = ?").run(this.now(), id);
  }
}
