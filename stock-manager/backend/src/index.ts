import express from "express";
import fs from "fs";
import path from "path";
import amazonRouter from "./routes/amazon";
import inventoryRouter from "./routes/inventory";
import mastersRouter from "./routes/masters";
import productsRouter from "./routes/products";
import { startAmazonCron } from "./amazon/cron";
import { ensureDirs, IMAGES_DIR } from "./paths";

const PORT = Number(process.env.PORT) || 8099;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

ensureDirs();

const app = express();
app.use(express.json());

// REST API
app.use("/api", mastersRouter);
app.use("/api", productsRouter);
app.use("/api", inventoryRouter);
app.use("/api", amazonRouter);

// Uploaded product images
app.use("/images", express.static(IMAGES_DIR));

// Compiled SPA assets (JS/CSS). index.html is served by the fallback below.
app.use(express.static(PUBLIC_DIR, { index: false }));

// SPA fallback. HA Ingress proxies requests under a token path and passes it
// via the X-Ingress-Path header; inject it so the frontend can build correct
// absolute URLs for API calls and image assets.
app.get(/.*/, (req, res) => {
  const ingressPath = ((req.headers["x-ingress-path"] as string) || "").replace(/\/$/, "");
  const html = fs
    .readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf-8")
    .replace("{{INGRESS_PATH}}", ingressPath);
  res.type("html").send(html);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Stock Manager listening on :${PORT}`);
  startAmazonCron();
});
