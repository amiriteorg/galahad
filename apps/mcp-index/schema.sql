-- The MCP library's index (apps/mcp-index): the registry's servers that are their service's own, their sites' ranks, and
-- what the index keeps between runs. `entry` is the server as the library lists it, worked out when anything about it
-- changes; a server with none (not yet probed, down, unranked) isn't listed.
CREATE TABLE IF NOT EXISTS servers (
  name TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  site TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '[]',
  updated TEXT NOT NULL,
  auth TEXT,
  header TEXT,
  probed TEXT,
  entry TEXT
);
CREATE INDEX IF NOT EXISTS servers_site ON servers (site);
CREATE INDEX IF NOT EXISTS servers_probed ON servers (probed);
CREATE TABLE IF NOT EXISTS sites (
  site TEXT PRIMARY KEY,
  rank INTEGER,
  checked TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
