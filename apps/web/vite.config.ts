import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = path.resolve("../..");

export default defineConfig({
  root: ".",
  plugins: [react()],
  resolve: {
    alias: {
      "@junhang/ai": path.resolve(repoRoot, "packages/ai/src/index.js"),
      "@junhang/core": path.resolve(repoRoot, "packages/core/src/index.js")
    }
  },
  server: {
    fs: {
      allow: [repoRoot]
    }
  }
});
