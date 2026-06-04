import { Router } from "express";
import * as cheerio from "cheerio";
import { prisma } from "../db";
import { getCookie, getCronSchedule, getSetting, setSetting } from "../amazon/config";
import { clearLogs, getLogs } from "../amazon/logger";
import { ignoreQueueItem, manageQueueItemNew, manageQueueItemMerge, runAmazonCrawl } from "../amazon/service";

const router = Router();

// --- Crawler: settings -----------------------------------------------------

router.get("/amazon/settings", async (_req, res) => {
  const cookie = await getCookie();
  res.json({
    cookie_set: Boolean(cookie),
    // 先頭80文字を表示（確認用）
    cookie_preview: cookie ? cookie.slice(0, 80) + (cookie.length > 80 ? "..." : "") : "",
    cookie_length: cookie.length,
    last_sync: await getSetting("amazon_last_sync"),
    cron: getCronSchedule(),
  });
});

router.post("/amazon/settings", async (req, res) => {
  const raw = String(req.body.cookie ?? "").trim();
  // cURLコマンドをそのまま貼った場合は -b '...' または -H 'Cookie: ...' から値を抽出する。
  const cookie = extractCookieFromInput(raw);
  await setSetting("amazon_cookie", cookie);
  res.json({ cookie_set: Boolean(cookie) });
});

function extractCookieFromInput(input: string): string {
  // -b 'value' : cURLのbashコピーはシングルクォートで囲む。
  // Cookieの値自体にダブルクォートが含まれるため ['"] で閉じると途中で切れてしまう。
  // シングルクォート → シングルクォートまで、ダブルクォート → ダブルクォートまでで個別に処理する。
  const bSingle = input.match(/(?:^|\s)-b\s+'([^']+)'/)?.[1];
  if (bSingle) return bSingle.trim();
  const bDouble = input.match(/(?:^|\s)-b\s+"([^"]+)"/)?.[1];
  if (bDouble) return bDouble.trim();
  // -H 'Cookie: value'
  const hSingle = input.match(/(?:^|\s)-H\s+'Cookie:\s*([^']+)'/i)?.[1];
  if (hSingle) return hSingle.trim();
  const hDouble = input.match(/(?:^|\s)-H\s+"Cookie:\s*([^"]+)"/i)?.[1];
  if (hDouble) return hDouble.trim();
  // そのまま（生Cookieとして扱う）
  return input;
}

// --- Logs ------------------------------------------------------------------

router.get("/amazon/logs", (_req, res) => {
  res.json(getLogs());
});

router.delete("/amazon/logs", (_req, res) => {
  clearLogs();
  res.status(204).end();
});

// --- Crawler: run + queue --------------------------------------------------

router.post("/amazon/crawl", async (req, res) => {
  const full = req.body?.full === true;
  try {
    const summary = await runAmazonCrawl(full);
    res.json(summary);
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

router.get("/amazon/queue", async (req, res) => {
  const status = (req.query.status as string) || "pending";
  res.json(
    await prisma.amazonQueue.findMany({
      where: status === "all" ? undefined : { status },
      orderBy: { purchased_at: "desc" },
    })
  );
});

// キュー全リセット（重複dedup解除用）。last_syncも消して次回クロールで全件再取込できるようにする。
router.delete("/amazon/queue", async (_req, res) => {
  await prisma.amazonQueue.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "amazon_last_sync" } });
  res.status(204).end();
});

// パターンA: 在庫管理する
// mode="new"   → 新規アイテム登録 + 在庫加算 + ASIN紐づけ
// mode="merge" → 既存アイテムにASIN紐づけ + 在庫加算
router.post("/amazon/queue/:id/manage", async (req, res) => {
  try {
    const { mode, product_id, ...overrides } = req.body ?? {};
    let product;
    if (mode === "merge") {
      if (!product_id) return res.status(400).json({ detail: "product_id is required for merge" });
      product = await manageQueueItemMerge(req.params.id as string, product_id as string);
    } else {
      product = await manageQueueItemNew(req.params.id as string, overrides);
    }
    res.json(product);
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

// ProductAsin管理: アイテムに紐づくASIN一覧を取得
router.get("/products/:id/asins", async (req, res) => {
  const asins = await prisma.productAsin.findMany({
    where: { product_id: req.params.id as string },
    orderBy: { created_at: "asc" },
  });
  res.json(asins);
});

// ASINを追加
router.post("/products/:id/asins", async (req, res) => {
  const asin = String(req.body.asin ?? "").trim().toUpperCase();
  if (!asin) return res.status(400).json({ detail: "asin is required" });
  try {
    const row = await prisma.productAsin.upsert({
      where: { asin },
      update: { product_id: req.params.id as string },
      create: { product_id: req.params.id as string, asin },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

// ASINを削除
router.delete("/products/asins/:asinId", async (req, res) => {
  try {
    await prisma.productAsin.delete({ where: { id: req.params.asinId as string } });
    res.status(204).end();
  } catch {
    res.status(404).json({ detail: "Not found" });
  }
});

// パターンB: 在庫管理しない（無視リスト登録 + 取込リストから削除）
router.post("/amazon/queue/:id/ignore", async (req, res) => {
  try {
    await ignoreQueueItem(req.params.id as string);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

// --- Amazon URL → 品目情報取込 --------------------------------------------------

const CHROMIUM_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

function findChromium(): string {
  const { existsSync } = require("fs") as typeof import("fs");
  for (const p of CHROMIUM_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Chromiumが見つかりません。確認したパス: ${CHROMIUM_PATHS.join(", ")}`);
}

function parseCookiesForFetch(cookieStr: string): Array<{ name: string; value: string; domain: string; secure?: boolean; path?: string }> {
  const sanitized = cookieStr.replace(/[\r\n\t]/g, " ");
  return sanitized
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const idx = s.indexOf("=");
      if (idx === -1) return null;
      const name = s.slice(0, idx).trim();
      const value = s.slice(idx + 1).trim().replace(/[\x00-\x1F\x7F]/g, "");
      if (!name) return null;
      const secure = name.startsWith("__Secure-") || name.startsWith("__Host-");
      const path = name.startsWith("__Host-") ? "/" : undefined;
      return { name, value, domain: ".amazon.co.jp", ...(secure ? { secure } : {}), ...(path ? { path } : {}) };
    })
    .filter(Boolean) as Array<{ name: string; value: string; domain: string; secure?: boolean; path?: string }>;
}

router.post("/amazon/fetch-product", async (req, res) => {
  const url = String(req.body.url ?? "").trim();
  const asinMatch = url.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/);
  if (!asinMatch) {
    return res.status(400).json({ detail: "URLからASINを取得できませんでした" });
  }
  const asin = asinMatch[1];
  const productUrl = `https://www.amazon.co.jp/dp/${asin}`;

  try {
    const executablePath = findChromium();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { default: puppeteer } = await (Function('return import("puppeteer-core")')() as Promise<any>);
    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-software-rasterizer"],
    });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
      );
      await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8" });

      const cookie = await getCookie();
      if (cookie) {
        const cookies = parseCookiesForFetch(cookie);
        for (const c of cookies) {
          try { await page.setCookie(c); } catch { /* skip bad cookies */ }
        }
      }

      await page.goto(productUrl, { waitUntil: "networkidle2", timeout: 20000 });
      await new Promise((r) => setTimeout(r, 1000));
      const html = await page.content();
      await page.close();

      const $ = cheerio.load(html);
      const name = $("#productTitle").text().trim();
      const makerRaw = $("#bylineInfo, #brand").first().text().trim();
      const maker = makerRaw
        .replace(/ブランド:|Brand:|Visit the/gi, "")
        .replace(/のストアを表示/g, "")
        .trim();
      const image_url = $("#landingImage, #imgBlkFront").first().attr("src") || "";
      const bullets = $("#detailBullets_feature_div, #prodDetails").text();
      const janMatch = bullets.match(/\b(\d{13})\b/);
      const jan_code = janMatch ? janMatch[1] : "";

      res.json({ name, maker, jan_code, asin, product_url: productUrl, image_url });
    } finally {
      await browser.close();
    }
  } catch (e) {
    res.status(500).json({ detail: (e as Error).message });
  }
});

export default router;
