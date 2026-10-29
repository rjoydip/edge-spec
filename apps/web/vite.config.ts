import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { localApi } from "./vite.local";

// Dashboard build. The Worker serves dist/web as static assets, so the app is a
// plain SPA hitting the same-origin /api. In dev Vite proxies /api to the
// Worker, so the dashboard works without a build.
const apiTarget = process.env.EDGE_SPEC_API_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [localApi(), react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      // Trailing slash matters: "/api" would also capture the source module
      // "/api.ts" and serve the Worker's HTML instead of TypeScript.
      "/api/": { target: apiTarget, changeOrigin: true },
      "/webhook": { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../../dist/web", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Vendors change far less often than the app, so they get their own
        // chunk and stay cached across deploys. `onlyExplicitManualChunks`
        // keeps a vendor in the chunk it was named in, which also avoids
        // circular chunks between them.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@pierre/trees")) return "trees";
          if (id.includes("@vortexlabs")) return "kirari";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("lucide-react")) return "icons";
          // React and its scheduler stay together, or the chunks import each
          // other in a circle.
          if (
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
});
