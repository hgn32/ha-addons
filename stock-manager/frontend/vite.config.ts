import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base: "./" keeps asset URLs relative so the SPA works under the HA Ingress
// token path without knowing it at build time.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
