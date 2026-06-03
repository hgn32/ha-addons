import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function gitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

// base: "./" keeps asset URLs relative so the SPA works under the HA Ingress
// token path without knowing it at build time.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __COMMIT_HASH__: JSON.stringify(gitHash()),
  },
  build: {
    outDir: "dist",
  },
});
