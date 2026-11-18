# The MCP library's index

A Cloudflare Worker at **mcp.galahad.sh** that keeps the library of hosted MCP servers every Galahad node reads: the
official MCP Registry's servers that are their service's own, ranked by how widely their sites are used, and probed for
how each lets a client in. Galahad's reviewed list (`packages/core/src/mcp-library.ts`) is the library's floor; this
index is the rest.

| | |
|---|---|
| `GET /v1/library.json` | The library: `{ v: 1, generated, count, entries }`, most popular first, cached 15 minutes at the edge |
| `GET /v1/health` | How far along it is: servers kept, probed, listable; sites ranked; the last sync and run |

## What it lists

A server in the [official MCP Registry](https://registry.modelcontextprotocol.io) is listed when all of these hold:

1. **It is the service's own.** Its name begins with a namespace its publisher proved to the registry (`com.stripe` is
   control of stripe.com), and one of its endpoints is streamable HTTP over https on that very domain, with no
   credentials, query or template in its address. A namespace on a hosting platform (the Public Suffix List's private
   section: `workers.dev`, `vercel.app`, `github.io`…) or a tunnel (`lhr.life`, `sslip.io`…) is someone's project, not a
   service's, and isn't listed (`src/registry.ts`).
2. **Its site is among the web's most visited.** Its registrable domain has a rank in the
   [Tranco list](https://tranco-list.eu) (the top million). A site with more than twelve servers is a platform hosting
   others' unless it is a vendor named in `src/worker.ts` (`VENDORS`).
3. **It answers.** An initialize sent with no credentials (`src/probe.ts`): answered, it is **open**; a 401 that names an
   authorization server letting a client register itself, with PKCE (S256), is one you **sign in** to as yourself; any
   other 401 or 403 takes **a key** (in the header the registry says it reads, else Authorization). A redirect, an error
   or no answer is down, and not listed until a later probe finds it up. Nothing is ever signed in to or registered.
4. **It passes the rules every node holds an entry to** (`packages/core/src/mcp-index.ts` `entryProblem`), which every
   node checks again when it reads the index.

Each is filed on a shelf by the words of its name and description (`categorize`), and given an id Galahad can install it
under (`src/entry.ts`).

"Open" means it lists its tools without a key; a few check who you are only when a tool is called, and say so then.

## How it runs

Every ten minutes, within a free Worker's limits (fewer than fifty requests and a few milliseconds of CPU a run):

- **sync**: the registry's latest versions changed since the last sync (`updated_since`), four pages at most, going on
  from where it stopped; a server that no longer qualifies, or was deleted, is dropped.
- **rank**: two sites ranked by Tranco's API (its rate limit allows no more); ranked again monthly.
- **probe**: six servers, the never-probed and most popular first; each again after a week.

On Mondays at 03:17 UTC a run of its own fetches the Public Suffix List again (it is kept in D1 in pieces, as a D1
statement holds at most 100 KB). Labels, ids, shelves and each server's entry are worked out when it changes, so serving
the library is stored entries put together.

## Running it

It is deployed with the site's wrangler (`apps/site`, which pins its version), so it has no package of its own:

```sh
cd apps/mcp-index
../site/node_modules/.bin/wrangler d1 create galahad-mcp-index          # once: put its id in wrangler.jsonc
../site/node_modules/.bin/wrangler d1 execute galahad-mcp-index --remote --file schema.sql
../site/node_modules/.bin/wrangler deploy                                 # the Worker, its two crons, mcp.galahad.sh
```

A fresh database fills itself at a free Worker's pace (weeks). `scripts/seed.ts` does it at once from this machine: the
registry read whole, every candidate site ranked from Tranco's daily list
([top-1m.csv.zip](https://tranco-list.eu/top-1m.csv.zip), unzipped), and the servers on ranked sites probed, a few dozen
at a time. It writes SQL for `wrangler d1 execute --remote --file`:

```sh
bun apps/mcp-index/scripts/seed.ts --tranco top-1m.csv --out seed.sql [--crawl crawl.json] [--psl psl.dat]
```

The first seed (18 November 2026) read 65,364 servers: 25,565 were their service's own, 1,898 were on ranked sites, and
of those 812 sign in, 670 are open, 136 take a key and 280 were down; 1,540 were listable after the platform rule.

## On a node

A node reads the index when the library is asked for and its last read is more than twelve hours old, keeps it on disk
(`mcp-index.json` in its home), and checks every entry again; one that fails is dropped, never the rest
(`packages/node/src/mcp-index.ts`). `GALAHAD_MCP_INDEX` points a node at another copy (https, or plain http on its own
machine), or `off`. Reading it sends nothing about you: a GET of a public file. Adding a server installs it as any MCP
server is installed: its tools are listed only once you've signed in or sealed its key, and outward and delete tools
ask you first.
