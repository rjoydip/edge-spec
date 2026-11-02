import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Marketing landing page. Standalone from the dashboard: no API calls, no
// router, no shared dashboard state. Output goes to dist/www so it never
// overwrites the dashboard bundle the Worker serves.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5175 },
  build: {
    outDir: fileURLToPath(new URL("../../dist/www", import.meta.url)),
    emptyOutDir: true,
  },
});
