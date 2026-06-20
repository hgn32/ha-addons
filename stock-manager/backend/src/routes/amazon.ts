import { Router } from "express";
import * as cheerio from "cheerio";
import { prisma } from "../db";
import { getCookie, getCronSchedule, getSetting, setSetting } from "../amazon/config";
import { clearLogs, getLogs } from "../amazon/logger";
import { manageQueueItemNew, manageQueueItemMerge, matchProductWithUnit, runAmazonCrawl, isCrawlRunning, retryEnrichFailed } from "../amazon/service";
import { notifyHA } from "../amazon/notify";
import { getBrowser } from "../amazon/crawler";

const router = Router();

// --- Crawler: settings -----------------------------------------------------

router.get("/amazon/settings", async (_req, res) => {
  const cookie = await getCookie();
  res.json({
    cookie_set: Boolean(cookie),
    // 先頭80文字を表示（確認用）
    cookie_preview: cookie ? cookie.slice(0, 80) + (cookie.length > 80 ? "..." : "") : "",
    cookie_length: cookie.length,
    // 「前回同期」は実際にクロールを実行した時刻を表示する（差分カーソルの注文日ではない）
    last_sync: await getSetting("amazon_last_run"),
    cron: getCronSchedule(),
  });
});

router.post("/amazon/settings", async (req, res) => {
  const raw = String(req.body.cookie ?? "").trim();
  // cURLコマンドなら全ヘッダーを抽出してJSONで保存、生Cookieならそのまま保存
  if (raw.startsWith("curl ")) {
    const headers = extractHeadersFromCurl(raw);
    await setSetting("amazon_cookie", headers.cookie ?? "");
    await setSetting("amazon_curl_headers", JSON.stringify(headers.all));
    res.json({ cookie_set: Boolean(headers.cookie) });
  } else {
    const cookie = raw;
    await setSetting("amazon_cookie", cookie);
    await setSetting("amazon_curl_headers", "");
    res.json({ cookie_set: Boolean(cookie) });
  }
});

// cURLコマンドから全ヘッダーとCookieを抽出する
function extractHeadersFromCurl(input: string): { cookie: string; all: Record<string, string> } {
  const headers: Record<string, string> = {};

  // -H 'Name: Value' を全件抽出（シングル・ダブルクォート両対応）
  const hPattern = /-H\s+(?:'([^']+)'|"([^"]+)")/g;
  let m: RegExpExecArray | null;
  while ((m = hPattern.exec(input)) !== null) {
    const raw = (m[1] ?? m[2]).trim();
    const idx = raw.indexOf(":");
    if (idx === -1) continue;
    const name = raw.slice(0, idx).trim().toLowerCase();
    const value = raw.slice(idx + 1).trim();
    headers[name] = value;
  }

  // -b 'cookie' 形式
  const bSingle = input.match(/(?:^|\s)-b\s+'([^']+)'/)?.[1];
  const bDouble = input.match(/(?:^|\s)-b\s+"([^"]+)"/)?.[1];
  if (bSingle) headers["cookie"] = bSingle.trim();
  else if (bDouble) headers["cookie"] = bDouble.trim();

  const cookie = headers["cookie"] ?? "";
  return { cookie, all: headers };
}

// --- Logs ------------------------------------------------------------------

router.get("/amazon/logs", (_req, res) => {
  res.json(getLogs());
});

router.delete("/amazon/logs", (_req, res) => {
  clearLogs();
  res.status(204).end();
});

// クロール実行状態。UIが定期ポーリングして実行中表示・ログ更新に使う。
router.get("/amazon/status", (_req, res) => {
  res.json({ running: isCrawlRunning() });
});

// HA通知のテスト送信。設定済みのnotifyサービスへ1件送り、成否を返す。
router.post("/amazon/notify-test", async (_req, res) => {
  const result = await notifyHA(
    "Stock Manager 通知テスト",
    `これはテスト通知です（${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）`
  );
  res.json(result);
});

// --- Crawler: run + queue --------------------------------------------------

router.post("/amazon/crawl", async (req, res) => {
  const full = req.body?.full === true;
  if (isCrawlRunning()) {
    return res.status(409).json({ detail: "既にクロールを実行中です。完了までお待ちください。" });
  }
  try {
    const summary = await runAmazonCrawl(full);
    if (summary.queued > 0) {
      await notifyHA("Stock Manager: Amazon取込完了", `・確認待ち: ${summary.queued}件`);
    }
    res.json(summary);
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

router.post("/amazon/enrich-retry", async (_req, res) => {
  if (isCrawlRunning()) return res.status(409).json({ detail: "クロール実行中です" });
  try {
    const result = await retryEnrichFailed();
    res.json(result);
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

router.get("/amazon/queue", async (req, res) => {
  const status = (req.query.status as string) || "pending";
  const items = await prisma.amazonQueue.findMany({
    where: status === "all" ? undefined : { status },
    orderBy: { purchased_at: "desc" },
  });
  const enriched = await Promise.all(
    items.map(async (item) => {
      const match = await matchProductWithUnit(item.asin, item.jan_code);
      return {
        ...item,
        // piece_count はマッチしたコード(ASIN/JAN)に設定された員数。員数換算に使う。
        matched_product: match
          ? { id: match.product.id, name: match.product.name, piece_count: match.pieceCount, quantity: match.product.quantity, photo: match.product.photo }
          : null,
      };
    })
  );
  res.json(enriched);
});

// キュー全クリア。同期カーソル(last_sync)は保持するので次回クロールは差分取得のまま。
router.delete("/amazon/queue", async (_req, res) => {
  await prisma.amazonQueue.deleteMany({});
  res.status(204).end();
});

// パターンA: 在庫管理する
// mode="new"   → 新規アイテム登録 + 在庫加算 + ASIN紐づけ
// mode="merge" → 既存アイテムにASIN紐づけ + 在庫加算
router.post("/amazon/queue/:id/manage", async (req, res) => {
  try {
    const { mode, product_id, quantity, ...overrides } = req.body ?? {};
    const qty = Math.max(0, parseInt(quantity, 10) || 0);
    let product;
    if (mode === "merge") {
      if (!product_id) return res.status(400).json({ detail: "product_id is required for merge" });
      // 紐づけるASINに設定する員数（任意）。
      const pieceCount = overrides.piece_count != null ? Math.max(1, parseInt(overrides.piece_count, 10) || 1) : undefined;
      product = await manageQueueItemMerge(req.params.id as string, product_id as string, qty, pieceCount);
    } else {
      product = await manageQueueItemNew(req.params.id as string, overrides, qty);
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
    orderBy: { asin: "asc" },
  });
  res.json(asins);
});

// ASINを追加（員数を任意指定）
router.post("/products/:id/asins", async (req, res) => {
  const asin = String(req.body.asin ?? "").trim().toUpperCase();
  if (!asin) return res.status(400).json({ detail: "asin is required" });
  const pieceCount = req.body.piece_count != null ? Math.max(1, parseInt(req.body.piece_count, 10) || 1) : 1;
  try {
    const row = await prisma.productAsin.upsert({
      where: { asin },
      update: { product_id: req.params.id as string, piece_count: pieceCount },
      create: { product_id: req.params.id as string, asin, piece_count: pieceCount },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

// ASINの員数を更新
router.patch("/products/asins/:asinId", async (req, res) => {
  const pieceCount = Math.max(1, parseInt(req.body.piece_count, 10) || 1);
  try {
    const row = await prisma.productAsin.update({
      where: { id: req.params.asinId as string },
      data: { piece_count: pieceCount },
    });
    res.json(row);
  } catch {
    res.status(404).json({ detail: "Not found" });
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

// 取り込まない（レコードを完全削除。次回購入時に新規注文として再出現）
router.post("/amazon/queue/:id/skip", async (req, res) => {
  try {
    await prisma.amazonQueue.delete({ where: { id: req.params.id as string } });
    res.status(204).end();
  } catch {
    res.status(404).json({ detail: "Not found" });
  }
});

// --- Amazon URL / JAN → 品目情報取込 ------------------------------------------

interface ScrapedProduct {
  name: string;
  maker: string;
  jan_code: string;
  asin: string;
  product_url: string;
  image_url: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function newAmazonPage(browser: any) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8" });
  // 画像/CSS/フォント等は読み込まずスキップしページ取得を高速化（HTMLのテキスト・属性のみ使用するため）
  await page.setRequestInterception(true);
  page.on("request", (req: any) => {
    const type = req.resourceType();
    if (type === "image" || type === "stylesheet" || type === "font" || type === "media") {
      req.abort();
    } else {
      req.continue();
    }
  });
  const cookie = await getCookie();
  if (cookie) {
    const sanitized = cookie.replace(/[\r\n\t]/g, " ");
    const cookies = sanitized.split(";").map((s: string) => s.trim()).filter(Boolean).map((s: string) => {
      const idx = s.indexOf("=");
      if (idx === -1) return null;
      const name = s.slice(0, idx).trim();
      const value = s.slice(idx + 1).trim().replace(/[\x00-\x1F\x7F]/g, "");
      if (!name) return null;
      const secure = name.startsWith("__Secure-") || name.startsWith("__Host-");
      const path = name.startsWith("__Host-") ? "/" : undefined;
      return { name, value, domain: ".amazon.co.jp", ...(secure ? { secure } : {}), ...(path ? { path } : {}) };
    }).filter(Boolean);
    for (const c of cookies) {
      try { await page.setCookie(c); } catch { /* skip bad cookies */ }
    }
  }
  return page;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scrapeProductDetail(page: any, asin: string): Promise<ScrapedProduct> {
  const productUrl = `https://www.amazon.co.jp/dp/${asin}`;
  await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  const html = await page.content();
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
  return { name, maker, jan_code, asin, product_url: productUrl, image_url };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function searchAsinByKeyword(page: any, keyword: string): Promise<{ asin: string; blocked: boolean }> {
  const searchUrl = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  const html = await page.content();
  const $ = cheerio.load(html);
  let asin = "";
  $('[data-component-type="s-search-result"]').each((_, el) => {
    const a = ($(el).attr("data-asin") || "").trim();
    if (/^[A-Z0-9]{10}$/.test(a)) { asin = a; return false; }
  });
  if (!asin) {
    $("div.s-result-item[data-asin]").each((_, el) => {
      const a = ($(el).attr("data-asin") || "").trim();
      if (/^[A-Z0-9]{10}$/.test(a)) { asin = a; return false; }
    });
  }
  const blocked = !asin && /captcha|ロボットでは|automated access|api-services-support/i.test(html);
  return { asin, blocked };
}

// Amazon商品URL → 品目情報取込
router.post("/amazon/fetch-product", async (req, res) => {
  const url = String(req.body.url ?? "").trim();
  const asinMatch = url.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/);
  if (!asinMatch) {
    return res.status(400).json({ detail: "URLからASINを取得できませんでした" });
  }
  const asin = asinMatch[1];
  try {
    const browser = await getBrowser();
    const page = await newAmazonPage(browser);
    try {
      const data = await scrapeProductDetail(page, asin);
      res.json(data);
    } finally {
      await page.close();
    }
  } catch (e) {
    res.status(500).json({ detail: (e as Error).message });
  }
});

// JANコード → Amazon検索 → 先頭ヒット商品の情報取込（スクレイピング方式）
router.post("/amazon/search-by-jan", async (req, res) => {
  const jan = String(req.body.jan ?? req.body.code ?? "").trim();
  if (!/^\d{8,14}$/.test(jan)) {
    return res.status(400).json({ detail: "JANコード（数字8〜14桁）を指定してください" });
  }
  try {
    const browser = await getBrowser();
    const page = await newAmazonPage(browser);
    try {
      const { asin, blocked } = await searchAsinByKeyword(page, jan);
      if (!asin) {
        return res.status(blocked ? 503 : 404).json({
          detail: blocked
            ? "Amazonにアクセスをブロックされた可能性があります。ログインCookieを設定/更新してお試しください。"
            : `Amazonでヒットしませんでした（JAN: ${jan}）`,
        });
      }
      const data = await scrapeProductDetail(page, asin);
      if (!data.jan_code) data.jan_code = jan;
      res.json(data);
    } finally {
      await page.close();
    }
  } catch (e) {
    res.status(500).json({ detail: (e as Error).message });
  }
});

export default router;
