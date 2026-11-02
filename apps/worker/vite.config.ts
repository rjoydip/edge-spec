import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Worker build: bundles src/index.ts to the root dist/worker/index.js.
// Cloudflare runtime modules stay external and are resolved by Alchemy.
const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Worker/browser export conditions matter: better-auth's password hashing and
 * consola's transports both ship separate Node and browser builds. Under the
 * default `node` condition the bundle kept `node:crypto`/`node:fs` imports and
 * `alchemy dev` failed with "Module not found: node:fs".
 */
const WORKER_CONDITIONS = ["workerd", "worker", "browser"];

export default defineConfig({
  root,
  resolve: { conditions: WORKER_CONDITIONS },
  build: {
    ssr: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    outDir: fileURLToPath(new URL("../../dist/worker", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      external: ["cloudflare:workers"],
      output: { format: "es", entryFileNames: "index.js" },
    },
  },
  ssr: {
    // A webworker SSR target drops the implicit `node` condition that made
    // better-auth/consola resolve their Node builds.
    target: "webworker",
    external: ["cloudflare:workers"],
    noExternal: ["hono"],
    resolve: { conditions: WORKER_CONDITIONS },
  },
});
