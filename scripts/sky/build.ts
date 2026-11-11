/*
 * Builds the SANDBOX's star table (apps/web/src/world/sky/stars-data.ts): the
 * naked-eye stars, from Wikidata.
 *
 *   bun scripts/sky/build.ts [--cache <dir>] [--check <bsc catalog file>] [--limit 6]
 *
 * Why Wikidata: it is dedicated to the public domain (CC0 1.0), so its star
 * positions and magnitudes may be embedded and changed freely. The Yale Bright
 * Star Catalogue, the usual source, is not: NASA's HEASARC states that Yale
 * University Observatory and/or its authors keep the copyright and offers it
 * for research only, and Debian files it under non-free. So the catalogue
 * itself is never embedded here. It only chooses which stars are asked for
 * (Wikidata's own statement that a star has an HR number), and, when a copy is
 * given with --check, it is read to throw out the few Wikidata entries whose
 * position is plainly another star's and to print how well the two agree.
 *
 * Each star is six bytes: right ascension and declination (J2000, 16 bits
 * each), visual magnitude and B−V colour (8 bits each); brightest first, so a
 * device that draws fewer simply stops early. The build asks Wikidata's query
 * service three fixed questions (nothing about you in them) and keeps the
 * answers in the cache directory (the system's temporary one unless --cache
 * says where), so it can be run again offline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLOR_BIAS, COLOR_STEP, MAG_BIAS, MAG_STEP } from "../../apps/web/src/world/sky/stars.ts";

const args = Bun.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const cache = flag("cache") ?? join(tmpdir(), "galahad-sky-build");
const checkPath = flag("check");
const LIMIT = Number(flag("limit") ?? 6);
const OUT = join(import.meta.dir, "../../apps/web/src/world/sky/stars-data.ts");
mkdirSync(cache, { recursive: true });

/** Wikidata's items: the Bright Star Catalogue (as a catalogue a star is listed in), and the photometric bands. */
const BSC = "Q499138";
const BAND = { V: "Q4892529", B: "Q6746395", G: "Q66659648" } as const;
const ENDPOINT = "https://query.wikidata.org/sparql";

const QUERIES = {
  places: `SELECT ?item ?hr ?ra ?dec WHERE { ?item p:P528 ?c . ?c ps:P528 ?hr ; pq:P972 wd:${BSC} . ?item wdt:P6257 ?ra ; wdt:P6258 ?dec . }`,
  magnitudes: `SELECT ?item ?mag ?band WHERE { ?item p:P528 ?c . ?c pq:P972 wd:${BSC} . ?item p:P1215 ?m . ?m ps:P1215 ?mag ; pq:P1227 ?band . VALUES ?band { wd:${BAND.V} wd:${BAND.B} wd:${BAND.G} } }`,
  names: `SELECT ?item ?label ?lang WHERE { ?item p:P528 ?c . ?c pq:P972 wd:${BSC} . ?item p:P1215 ?m . ?m ps:P1215 ?mag ; pq:P1227 wd:${BAND.V} . FILTER(?mag < 2.6) ?item rdfs:label ?label . BIND(LANG(?label) AS ?lang) FILTER(?lang = "en" || ?lang = "mul") }`,
} as const;

async function ask(name: keyof typeof QUERIES): Promise<string[][]> {
  const file = join(cache, `${name}.csv`);
  if (!existsSync(file)) {
    const url = `${ENDPOINT}?query=${encodeURIComponent(QUERIES[name])}`;
    const r = await fetch(url, { headers: { accept: "text/csv", "user-agent": "sky-catalogue-build/1.0 (star positions for a sky renderer)" }, redirect: "error" });
    if (!r.ok) throw new Error(`Wikidata ${name}: ${r.status}`);
    writeFileSync(file, await r.text());
  }
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split(","));
}

interface Star {
  item: string;
  hr: number;
  ra: number;
  dec: number;
  v: number;
  bv: number;
  name?: string;
}

const RAD = Math.PI / 180;
/** The angle between two places on the sky, degrees. */
const apart = (ra1: number, dec1: number, ra2: number, dec2: number): number =>
  Math.acos(Math.max(-1, Math.min(1, Math.sin(dec1 * RAD) * Math.sin(dec2 * RAD) + Math.cos(dec1 * RAD) * Math.cos(dec2 * RAD) * Math.cos((ra1 - ra2) * RAD)))) / RAD;

// ---- where each star is ----
const places = new Map<string, { hr: number; ra: number; dec: number }>();
for (const [item, hrText, ra, dec] of await ask("places")) {
  const m = /^HR\s*(\d+)$/.exec((hrText ?? "").trim());
  const a = Number(ra);
  const d = Number(dec);
  if (!item || !m || !Number.isFinite(a) || !Number.isFinite(d) || a < 0 || a >= 360 || Math.abs(d) > 90) continue;
  // (An item with several statements keeps its first.)
  if (!places.has(item)) places.set(item, { hr: Number(m[1]), ra: a, dec: d });
}

// ---- how bright, and what colour ----
const bands = new Map<string, { V: number[]; B: number[]; G: number[] }>();
for (const [item, mag, band] of await ask("magnitudes")) {
  const value = Number(mag);
  if (!item || !Number.isFinite(value) || value < -2 || value > 20) continue;
  let b = bands.get(item);
  if (!b) bands.set(item, (b = { V: [], B: [], G: [] }));
  const key = band?.endsWith(BAND.V) ? "V" : band?.endsWith(BAND.B) ? "B" : band?.endsWith(BAND.G) ? "G" : null;
  if (key) b[key].push(value);
}

// (A star's English name; where it has none, the one it has for every language.)
const names = new Map<string, string>();
for (const row of await ask("names")) {
  const item = row[0];
  const lang = row[row.length - 1];
  const label = row.slice(1, -1).join(",").replace(/^"|"$/g, "");
  if (item && label && (lang === "en" || !names.has(item))) names.set(item, label);
}

/**
 * Left out by hand: T Coronae Borealis (HR 5958), a recurrent nova. Wikidata and the catalogue both give the
 * second magnitude it reached in its outbursts of 1866 and 1946; between them it is tenth magnitude, far too
 * faint to see. (Should it erupt again it would be a real event the page has no way to know of.)
 */
const OUTBURSTS = new Set([5958]);

const stars: Star[] = [];
let noMagnitude = 0;
for (const [item, place] of places) {
  const b = bands.get(item);
  // As the eye sees it: where a star has several values (a double's parts, a variable's range), its brightest.
  // With no V at all, Gaia's G stands in (within a few tenths for all but the reddest).
  if (OUTBURSTS.has(place.hr)) continue;
  const v = b?.V.length ? Math.min(...b.V) : b?.G.length ? Math.min(...b.G) : Number.NaN;
  if (!Number.isFinite(v)) {
    noMagnitude++;
    continue;
  }
  if (v > LIMIT) continue;
  // B−V from the pair of values that goes with that V; white (0.3) when there's no B.
  const bMag = b?.B.length && b.V.length ? Math.min(...b.B) : Number.NaN;
  const bv = Number.isFinite(bMag) ? Math.max(-0.4, Math.min(2, bMag - v)) : 0.3;
  const name = names.get(item);
  stars.push({ item, hr: place.hr, ra: place.ra, dec: place.dec, v, bv, ...(name ? { name } : {}) });
}

// ---- checked against the catalogue itself, when a copy is given (it is never embedded) ----
let dropped = 0;
if (checkPath) {
  const bsc = new Map<number, { ra: number; dec: number; v: number }>();
  /** The catalogue's entries that aren't stars (novae, clusters and galaxies kept for their numbers, with no data). */
  const notStars = new Set<number>();
  for (const line of readFileSync(checkPath, "latin1").split("\n")) {
    if (line.length >= 4 && !line.slice(75, 77).trim()) notStars.add(Number(line.slice(0, 4)));
    if (line.length < 107 || !line.slice(75, 77).trim()) continue;
    const ra = (Number(line.slice(75, 77)) + Number(line.slice(77, 79)) / 60 + Number(line.slice(79, 83)) / 3600) * 15;
    const dec = (line[83] === "-" ? -1 : 1) * (Number(line.slice(84, 86)) + Number(line.slice(86, 88)) / 60 + Number(line.slice(88, 90)) / 3600);
    bsc.set(Number(line.slice(0, 4)), { ra, dec, v: Number(line.slice(102, 107)) });
  }
  const offsets: number[] = [];
  const dv: number[] = [];
  for (let i = stars.length - 1; i >= 0; i--) {
    const s = stars[i]!;
    if (notStars.has(s.hr)) {
      console.log(`dropped HR ${s.hr}: not a star in the catalogue`);
      stars.splice(i, 1);
      dropped++;
      continue;
    }
    const ref = bsc.get(s.hr);
    if (!ref) continue;
    const d = apart(s.ra, s.dec, ref.ra, ref.dec);
    if (d > 0.2) {
      console.log(`dropped HR ${s.hr}: ${d.toFixed(1)}° from where the catalogue has it`);
      stars.splice(i, 1);
      dropped++;
      continue;
    }
    // Far brighter here than the catalogue has it: an outburst's magnitude (a nova at its peak), not how it looks tonight.
    if (ref.v - s.v > 2.5) {
      console.log(`dropped HR ${s.hr}: magnitude ${s.v} here, ${ref.v} in the catalogue`);
      stars.splice(i, 1);
      dropped++;
      continue;
    }
    offsets.push(d * 3600);
    dv.push(Math.abs(s.v - ref.v));
  }
  const q = (list: number[], p: number) => [...list].sort((a, b) => a - b)[Math.floor(list.length * p)] ?? Number.NaN;
  const bright = [...bsc.values()].filter((b) => b.v <= LIMIT - 0.5).length;
  const have = stars.filter((s) => s.v <= LIMIT - 0.5).length;
  console.log(`against the catalogue: place median ${q(offsets, 0.5).toFixed(1)}", 99% ${q(offsets, 0.99).toFixed(1)}"; |dV| median ${q(dv, 0.5).toFixed(2)}, 95% ${q(dv, 0.95).toFixed(2)}; to V ${LIMIT - 0.5}: ${have} here, ${bright} there`);
}

// ---- one star where the eye sees one: of two within half an arcminute, the brighter stays ----
stars.sort((a, b) => a.v - b.v || a.hr - b.hr);
const kept: Star[] = [];
let merged = 0;
for (const s of stars) {
  if (kept.some((k) => Math.abs(k.dec - s.dec) < 0.01 && apart(k.ra, k.dec, s.ra, s.dec) < 30 / 3600)) {
    merged++;
    continue;
  }
  kept.push(s);
}

// ---- packed ----
const bytes = new Uint8Array(kept.length * 6);
const view = new DataView(bytes.buffer);
kept.forEach((s, i) => {
  view.setUint16(i * 6, Math.min(65535, Math.round((s.ra / 360) * 65536)) & 65535, true);
  view.setUint16(i * 6 + 2, Math.max(0, Math.min(65535, Math.round(((s.dec + 90) / 180) * 65535))), true);
  bytes[i * 6 + 4] = Math.max(0, Math.min(255, Math.round((s.v + MAG_BIAS) / MAG_STEP)));
  bytes[i * 6 + 5] = Math.max(0, Math.min(255, Math.round((s.bv + COLOR_BIAS) / COLOR_STEP)));
});
const packed = Buffer.from(bytes).toString("base64");
const lines: string[] = [];
for (let i = 0; i < packed.length; i += 120) lines.push(`  "${packed.slice(i, i + 120)}"`);

// The brightest with a name of their own, for the tests and the HUD's words: [name, index].
const named = kept
  .map((s, i) => [s.name?.replace(/\s+A[ab]?$/, "") ?? "", i] as const)
  .filter(([name]) => name && !/^(HR|HD|HIP|[A-Za-z]{2,3}\.? |[0-9])/.test(name) && !/\b(Aurigae|Centauri|Crucis|Carinae|Velorum|Gruis|Scorpii|Sagittarii|Ursae|Geminorum|Persei|Orionis|Leonis|Canis|Puppis|Pavonis|Trianguli|Tauri|Cygni|Andromedae|Cassiopeiae|Ophiuchi|Draconis|Lupi|Eridani|Hydrae|Arae|Virginis|Bootis|Cephei|Pegasi|Phoenicis|Muscae|Coronae|Ceti|Aquilae|Arietis|Librae|Serpentis|Herculis|Columbae|Leporis|Corvi|Tucanae|Hydri)\b/.test(name));

const text = `/*
 * The naked-eye stars: generated by scripts/sky/build.ts. Do not edit by hand.
 *
 * Source: Wikidata (https://www.wikidata.org), public domain (CC0 1.0): every
 * star it lists with a Bright Star Catalogue (HR) number, its J2000 place, V
 * magnitude and B−V colour, to magnitude ${LIMIT}. ${kept.length} stars, brightest first,
 * six bytes each: right ascension and declination (16 bits, little-endian),
 * magnitude and colour (8 bits); stars.ts unpacks them.
 */

/** How many stars. */
export const STAR_COUNT = ${kept.length};

/** The faintest magnitude kept. */
export const STAR_LIMIT = ${LIMIT};

/** The brightest stars with a name of their own, and where each is in the table. */
export const STAR_NAMES: Readonly<Record<string, number>> = {
${named.map(([name, i]) => `  ${JSON.stringify(name)}: ${i},`).join("\n")}
};

/** The table, base64. */
export const STAR_DATA =
${lines.join(" +\n")};
`;
writeFileSync(OUT, text);
if (!checkPath) console.log("not checked against the catalogue (--check <its file>): a misplaced entry or two may be in");
console.log(`${kept.length} stars to magnitude ${LIMIT} (${noMagnitude} with no magnitude left out, ${dropped} dropped by the check, ${merged} doubles merged); ${named.length} named; ${packed.length} characters -> ${OUT}`);
