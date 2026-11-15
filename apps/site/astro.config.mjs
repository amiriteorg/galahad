import { defineConfig } from "astro/config";

// galahad.sh: static pages only. The CSP allows no inline script or style, so nothing is inlined: every script and
// stylesheet is its own file. The pages read the app's own drawings, eye data and marks (apps/web) and the installer
// (scripts/install.sh) at build time, so they are never copies that drift.
export default defineConfig({
  site: "https://galahad.sh",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory", inlineStylesheets: "never" },
  devToolbar: { enabled: false },
  vite: {
    build: { assetsInlineLimit: 0 },
    server: { fs: { allow: ["../.."] } },
  },
});
