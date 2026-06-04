import { execSync } from "child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function gitHash(): string {
  if (process.env.GIT_HASH) {
    console.log(`[vite] GIT_HASH from env: ${process.env.GIT_HASH}`);
    return process.env.GIT_HASH;
  }
  try {
    const hash = execSync("git rev-parse --short HEAD").toString().trim();
    console.log(`[vite] GIT_HASH from git: ${hash}`);
    return hash;
  } catch (e) {
    console.log(`[vite] GIT_HASH fallback to "unknown": ${(e as Error).message}`);
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
