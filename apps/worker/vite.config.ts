import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Worker build: bundles src/index.ts to the root dist/worker/index.js.
// Cloudflare runtime modules stay external and are resolved by wrangler.
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
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
    external: ["cloudflare:workers"],
    noExternal: ["hono"],
  },
});
