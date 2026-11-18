import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LoopWake } from "@galahad/core";
import type { Transferred } from "@galahad/brain";
import { BILAG_QUERY, bilagPlace, bilagSummary, copyBilag, findMail, isBilag, senderOf, type Transfer } from "../src/bilag.ts";

/*
 * Bilag to Google Drive (bilag.ts): what counts as one, where it goes and under what name, and the copying itself,
 * from Gmail and Outlook into Drive, once, with a stand-in for all three services at the node's transfer.
 */

const ok = (value: unknown, extra: Partial<Transferred> = {}): Transferred => ({ ok: true, status: 200, contentType: "application/json", location: null, bytes: new TextEncoder().encode(JSON.stringify(value)), ...extra });
const raw = (bytes: Uint8Array): Transferred => ({ ok: true, status: 200, contentType: "application/pdf", location: null, bytes });
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.7 ${text}`);
// 18 November 2026, 23:30 UTC: 19 November in Copenhagen.
const LATE = Date.UTC(2026, 10, 18, 23, 30);

function services() {
  const calls: { connector: string; method: string; path: string; class: string; body?: Uint8Array | string; headers?: Record<string, string> }[] = [];
  const files: { name: string; parents: string[]; bytes: number }[] = [];
  const folders = new Map<string, string>();
  let next = 0;
  let goneFolders = false;
  const gmail: Record<string, { from: string; at: number; parts: { name: string; type: string; size: number; data?: Uint8Array; inline?: boolean }[] }> = {};
  const outlook: Record<string, { from: { name: string; address: string }; at: string; attachments: { id: string; name: string; type: string; size: number; data?: Uint8Array; inline?: boolean; item?: boolean }[] }> = {};
  const transfer: Transfer = async (connector, step) => {
    calls.push({ connector, method: step.method, path: step.path, class: step.class, ...(step.body === undefined ? {} : { body: step.body }), ...(step.headers ? { headers: step.headers } : {}) });
    const url = new URL(step.path, "https://example.test");
    if (connector === "gmail") {
      const m = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)(?:\/attachments\/(.+))?$/.exec(url.pathname);
      if (url.pathname === "/gmail/v1/users/me/messages") return ok(url.searchParams.get("pageToken") ? { messages: [{ id: "g3" }] } : { messages: [{ id: "g1" }, { id: "g2" }], nextPageToken: "p2" });
      const mail = gmail[decodeURIComponent(m?.[1] ?? "")];
      if (!mail) return { ...ok({ error: { message: "Requested entity was not found." } }), ok: false, status: 404 };
      if (m?.[2]) {
        const part = mail.parts.find((p) => `att-${p.name}` === decodeURIComponent(m[2]!));
        return ok({ size: part!.size, data: Buffer.from(part!.data ?? new Uint8Array(part!.size)).toString("base64url") });
      }
      return ok({
        internalDate: String(mail.at),
        payload: {
          headers: [{ name: "From", value: mail.from }],
          parts: [
            { mimeType: "text/plain", body: { size: 40 } },
            ...mail.parts.map((p) => ({ filename: p.name, mimeType: p.type, headers: p.inline ? [{ name: "Content-Disposition", value: "inline" }, { name: "Content-ID", value: "<logo>" }] : [{ name: "Content-Disposition", value: `attachment; filename="${p.name}"` }], body: { attachmentId: `att-${p.name}`, size: p.size } })),
          ],
        },
      });
    }
    if (connector === "outlook") {
      if (url.pathname === "/v1.0/me/messages") return ok({ value: [{ id: "o1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=2" });
      const m = /^\/v1\.0\/me\/messages\/([^/]+)(\/attachments)?(?:\/([^/]+)\/\$value)?$/.exec(url.pathname);
      const mail = outlook[decodeURIComponent(m?.[1] ?? "")]!;
      if (m?.[3]) return raw(mail.attachments.find((a) => a.id === decodeURIComponent(m[3]!))!.data!);
      if (m?.[2]) return ok({ value: mail.attachments.map((a) => ({ "@odata.type": a.item ? "#microsoft.graph.itemAttachment" : "#microsoft.graph.fileAttachment", id: a.id, name: a.name, contentType: a.type, size: a.size, isInline: a.inline === true })) });
      return ok({ from: { emailAddress: mail.from }, receivedDateTime: mail.at });
    }
    // Drive: its folders and files, as drive.file shows them (only Galahad's own).
    if (url.pathname === "/drive/v3/files" && step.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const name = /name = '([^']*)'/.exec(q)?.[1];
      const parent = /'([^']*)' in parents/.exec(q)?.[1];
      const id = folders.get(`${parent}/${name}`);
      return ok({ files: id ? [{ id }] : [] });
    }
    if (url.pathname === "/drive/v3/files" && step.method === "POST") {
      const meta = JSON.parse(String(step.body)) as { name: string; parents: string[] };
      const id = `folder-${++next}`;
      folders.set(`${meta.parents[0]}/${meta.name}`, id);
      return ok({ id });
    }
    if (url.pathname === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable") return ok({}, { location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=u1" });
    if (url.pathname === "/upload/drive/v3/files") {
      if (goneFolders) {
        goneFolders = false;
        folders.clear();
        return { ...ok({ error: { message: "File not found: folder-1." } }), ok: false, status: 404 };
      }
      const body = step.body instanceof Uint8Array ? new TextDecoder().decode(step.body) : String(step.body);
      const meta = step.method === "PUT" ? { name: "(resumed)", parents: ["?"] } : (JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(body)![1]!) as { name: string; parents: string[] });
      files.push({ name: meta.name, parents: meta.parents, bytes: step.body instanceof Uint8Array ? step.body.length : body.length });
      return ok({ id: `file-${++next}`, webViewLink: `https://drive.google.com/file/d/file-${next}/view` });
    }
    throw new Error(`no stand-in for ${connector} ${step.method} ${step.path}`);
  };
  const deps = { transfer, local: new Database(":memory:"), tz: "Europe/Copenhagen" };
  return { deps, calls, files, folders, gmail, outlook, loseFolders: () => void (goneFolders = true) };
}

describe("what is a bilag, and where it goes", () => {
  const a = (name: string, type: string, size: number, inline = false) => ({ id: "x", name, type, size, inline });

  test("a document, a picture of one or an e-invoice; not a picture set in the mail, nor a logo's few kilobytes, nor a file too big", () => {
    expect(isBilag(a("Faktura 2026-118.pdf", "application/pdf", 80_000))).toBe(true);
    expect(isBilag(a("kvittering.jpg", "image/jpeg", 900_000))).toBe(true);
    expect(isBilag(a("invoice.xml", "application/xml", 12_000))).toBe(true);
    expect(isBilag(a("scan.pdf", "application/octet-stream", 50_000))).toBe(true);
    expect(isBilag(a("logo.png", "image/png", 3_000))).toBe(false);
    expect(isBilag(a("banner.png", "image/png", 200_000, true))).toBe(false);
    expect(isBilag(a("contract.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 40_000))).toBe(false);
    expect(isBilag(a("huge.pdf", "application/pdf", 31 * 2 ** 20))).toBe(false);
  });

  test("its folder by the year and month it came, in your time zone; its name the day, who sent it and its own name, made safe for a name", () => {
    expect(senderOf('"Telia Danmark" <faktura@telia.dk>')).toBe("Telia Danmark");
    expect(senderOf("faktura@telia.dk")).toBe("telia.dk");
    expect(senderOf("<no-reply@billing.example>")).toBe("billing.example");
    expect(bilagPlace(LATE, "Europe/Copenhagen", "Telia <faktura@telia.dk>", "Faktura 11/2026.pdf")).toEqual({ year: "2026", month: "11", file: "2026-11-19 Telia – Faktura 11 2026.pdf" });
    expect(bilagPlace(LATE, "UTC", "faktura@telia.dk", "f.pdf").file).toBe("2026-11-18 telia.dk – f.pdf");
  });

  test("the words a bilag loop wakes on fit a mail wake, for both mailboxes", () => {
    for (const connector of ["gmail", "outlook"] as const) expect(LoopWake.safeParse({ kind: "mail", connector, query: BILAG_QUERY[connector] }).success).toBe(true);
  });
});

describe("copying them", () => {
  test("from Gmail: each bilag as it is into Bilag/<year>/<month>, its folders made once; the mail's words and its logo stay; nothing else is asked of the mail", async () => {
    const s = services();
    s.gmail.g1 = { from: '"Telia" <faktura@telia.dk>', at: LATE, parts: [{ name: "Faktura.pdf", type: "application/pdf", size: 40_000, data: pdf("telia") }, { name: "logo.png", type: "image/png", size: 2_000 }, { name: "banner.png", type: "image/png", size: 90_000, inline: true }] };
    const report = await copyBilag(s.deps, [{ mailbox: "gmail", id: "g1" }]);
    expect(report).toMatchObject({ already: 0, skipped: 2, failed: [] });
    expect(report.copied).toEqual([{ name: "2026-11-19 Telia – Faktura.pdf", folder: "Bilag/2026/11", link: "https://drive.google.com/file/d/file-4/view" }]);
    expect(s.files).toEqual([{ name: "2026-11-19 Telia – Faktura.pdf", parents: ["folder-3"], bytes: expect.any(Number) }]);
    expect([...s.folders.keys()]).toEqual(["root/Bilag", "folder-1/2026", "folder-2/11"]);
    // Of the mail, only reads; of Drive, only reads and new files.
    expect(s.calls.filter((c) => c.connector === "gmail").every((c) => c.method === "GET" && c.class === "read")).toBe(true);
    expect(s.calls.filter((c) => c.connector === "gdrive" && c.method !== "GET").every((c) => c.class === "create")).toBe(true);
    // What went to Drive is the file as it came, its SHA-256 on it.
    const upload = s.calls.find((c) => c.path.startsWith("/upload/"))!;
    expect(new TextDecoder().decode(upload.body as Uint8Array)).toContain("%PDF-1.7 telia");
    expect(new TextDecoder().decode(upload.body as Uint8Array)).toContain('"appProperties":{"galahad":"bilag","sha256":"');
    expect(bilagSummary(report)).toBe("Copied 1 bilag to Drive: Bilag/2026/11/2026-11-19 Telia – Faktura.pdf. 2 attachments aren't bilag by their kind.");
  });

  test("once: the same mail again reads nothing more, and the same file in another mail goes nowhere twice", async () => {
    const s = services();
    const bytes = pdf("same invoice");
    s.gmail.g1 = { from: "a@shop.dk", at: LATE, parts: [{ name: "inv.pdf", type: "application/pdf", size: bytes.length, data: bytes }] };
    s.gmail.g2 = { from: "b@shop.dk", at: LATE, parts: [{ name: "copy.pdf", type: "application/pdf", size: bytes.length, data: bytes }] };
    await copyBilag(s.deps, [{ mailbox: "gmail", id: "g1" }]);
    const before = s.calls.length;
    const again = await copyBilag(s.deps, [{ mailbox: "gmail", id: "g1" }, { mailbox: "gmail", id: "g2" }]);
    expect(again).toMatchObject({ copied: [], already: 2 });
    expect(s.files).toHaveLength(1);
    // The first mail: its list read again, its bytes not; the second's bytes read once, to know them.
    expect(s.calls.slice(before).filter((c) => c.path.includes("/attachments/")).map((c) => c.path)).toEqual(["/gmail/v1/users/me/messages/g2/attachments/att-copy.pdf"]);
  });

  test("from Outlook: its file attachments, read as they are; an attached mail or a picture in the words stays", async () => {
    const s = services();
    s.outlook["AAMk=1"] = { from: { name: "Danske Bank", address: "noreply@danskebank.dk" }, at: "2026-11-18T09:00:00Z", attachments: [{ id: "a1", name: "Kontoudtog.pdf", type: "application/pdf", size: 30_000, data: pdf("statement") }, { id: "a2", name: "fwd", type: "message/rfc822", size: 5_000, item: true }, { id: "a3", name: "sig.png", type: "image/png", size: 50_000, inline: true }] };
    const report = await copyBilag(s.deps, [{ mailbox: "outlook", id: "AAMk=1" }]);
    expect(report.copied.map((c) => c.name)).toEqual(["2026-11-18 Danske Bank – Kontoudtog.pdf"]);
    expect(report.skipped).toBe(1);
    expect(s.calls.find((c) => c.path.endsWith("/$value"))!.path).toBe("/v1.0/me/messages/AAMk%3D1/attachments/a1/$value");
  });

  test("a file over 5 MB goes in a resumable upload, at the address Drive gives; a folder you removed is made again, once", async () => {
    const s = services();
    s.gmail.big = { from: "scan@office.dk", at: LATE, parts: [{ name: "scan.pdf", type: "application/pdf", size: 6 * 2 ** 20 }] };
    s.gmail.small = { from: "x@y.dk", at: LATE, parts: [{ name: "r.pdf", type: "application/pdf", size: 20_000, data: pdf("r") }] };
    await copyBilag(s.deps, [{ mailbox: "gmail", id: "big" }]);
    const put = s.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=u1");
    expect((put.body as Uint8Array).length).toBe(6 * 2 ** 20);
    s.loseFolders();
    const report = await copyBilag(s.deps, [{ mailbox: "gmail", id: "small" }]);
    expect(report.copied).toHaveLength(1);
    expect(report.failed).toEqual([]);
  });

  test("a mail that can't be read is said, and the rest are copied", async () => {
    const s = services();
    s.gmail.g1 = { from: "a@b.dk", at: LATE, parts: [{ name: "a.pdf", type: "application/pdf", size: 20_000, data: pdf("a") }] };
    const report = await copyBilag(s.deps, [{ mailbox: "gmail", id: "gone" }, { mailbox: "gmail", id: "g1" }]);
    expect(report.copied).toHaveLength(1);
    expect(report.failed).toEqual(["gmail gone…: gmail answered 404: Requested entity was not found."]);
  });

  test("what came before: a search's mail, a batch at a time, and where it goes on", async () => {
    const s = services();
    expect(await findMail(s.deps, "gmail", "has:attachment", 50)).toEqual({ ids: ["g1", "g2"], next: "p2" });
    expect(await findMail(s.deps, "gmail", "has:attachment", 50, "p2")).toEqual({ ids: ["g3"], next: null });
    expect(await findMail(s.deps, "outlook", 'say "hi"', 50)).toEqual({ ids: ["o1"], next: "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=2" });
    expect(s.calls.at(-1)!.path).toBe(`/v1.0/me/messages?$search=${encodeURIComponent('"say hi"')}&$top=50&$select=id`);
  });
});
