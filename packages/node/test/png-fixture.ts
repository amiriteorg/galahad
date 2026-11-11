import { deflateSync } from "node:zlib";
import { crc32 } from "../src/board.ts";

/** A real PNG, built here: 8-bit RGBA (or RGB), each row filter 0, then whatever extra chunks a test asks for. */
export function png(width: number, height: number, opts: { channels?: 3 | 4; extra?: [string, Uint8Array][]; rows?: Uint8Array; badCrc?: boolean } = {}): Uint8Array {
  const channels = opts.channels ?? 4;
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)) ^ (opts.badCrc && type === "IDAT" ? 1 : 0));
    return out;
  };
  const header = new Uint8Array(13);
  const h = new DataView(header.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  header.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  const raw = opts.rows ?? new Uint8Array(height * (1 + width * channels)).map((_, i) => (i % (1 + width * channels) === 0 ? 0 : (i * 7) & 0xff));
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", header), ...(opts.extra ?? []).map(([t, d]) => chunk(t, d)), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  return new Uint8Array(Buffer.concat(parts));
}

