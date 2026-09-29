import { defineConfig } from "vite";

// Static app: the AR viewer reads the dish slug from the URL path (/dish/<slug>),
// resolves it against /dishes.json, and does the rest client-side. No server needed
// beyond serving static files, which is what makes this deployable on its own,
// separate from the biteme/ Next.js app.
export default defineConfig({
  server: { host: true },
  build: {
    target: "es2020",
    // the vendored mind-ar bundle statically imports node-fetch for a Node-only code path
    // (server-side compiling) that our browser build never calls; it just needs to not be
    // resolved at build time.
    rolldownOptions: { external: ["node-fetch"] },
  },
});
