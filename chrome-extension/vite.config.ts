import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import zip from "vite-plugin-zip-pack";
import manifest from "./manifest.config.js";
import pkg from "./package.json" with { type: "json" };

const sourceDirectory = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": sourceDirectory,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    crx({ manifest }),
    zip({
      outDir: "release",
      outFileName: `crx-${pkg.name}-${pkg.version}.zip`,
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
});
