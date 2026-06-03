import * as cheerio from "cheerio";
import { log } from "./logger";

// Minimal shape of puppeteer-core's Browser/Page (avoids ESM type-import issues)
interface PuppeteerPage {
  setUserAgent(ua: string): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  setCookie(...cookies: Array<{ name: string; value: string; domain: string }>): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  content(): Promise<string>;
  close(): Promise<void>;
}
interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

const BASE = "https://www.amazon.co.jp";

// Chromiumのパス候補（amd64 / aarch64 両対応）
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
  throw new Error(
    `Chromiumが見つかりません。確認したパス: ${CHROMIUM_PATHS.join(", ")}`
  );
}

export interface CrawledItem {
  order_id: string;
  asin: string;
  jan_code: string;
  product_name: string;
  maker: string;
  product_url: string;
  image_url: string;
  purchased_at: Date;
  quantity: number;
  unit_price: number;
}

export class CookieExpiredError extends Error {
  constructor() {
    super("Amazon Cookieが無効です。再取得して設定し直してください。");
    this.name = "CookieExpiredError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const politeDelay = (): Promise<void> => sleep(1500 + Math.floor(Math.random() * 1500));

function asinFromUrl(href: string): string {
  const m = href.match(/\/(?:dp|gp\/product|product|gp\/aw\/d)\/([A-Z0-9]{10})/);
  return m ? m[1] : "";
}

function parseDate(text: string): Date | null {
  const jp = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (jp) return new Date(Number(jp[1]), Number(jp[2]) - 1, Number(jp[3]));
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : new Date(t);
}

function parsePrice(text: string): number {
  const n = parseFloat(text.replace(/[¥￥,\s]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

// Cookie文字列をPuppeteer形式に変換
function parseCookies(cookieStr: string): Array<{ name: string; value: string; domain: string }> {
  return cookieStr
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const idx = s.indexOf("=");
      if (idx === -1) return null;
      return {
        name: s.slice(0, idx).trim(),
        value: s.slice(idx + 1).trim(),
        domain: ".amazon.co.jp",
      };
    })
    .filter(Boolean) as Array<{ name: string; value: string; domain: string }>;
}

function assertLoggedIn(url: string, html: string): void {
  const challenges = [/\/ap\/signin/, /\/ax\/claim/, /\/errors\/validateCaptcha/, /\/gp\/aw\/c\b/];
  if (
    challenges.some((p) => p.test(url)) ||
    html.includes('id="ap_password"') ||
    html.includes("validateCaptcha")
  ) {
    log("error", `認証ブロック検知: ${url}`);
    log("error", "Cookieを再取得して貼り直してください。");
    throw new CookieExpiredError();
  }
}

export function parseOrderHistory(html: string): CrawledItem[] {
  const $ = cheerio.load(html);
  const items: CrawledItem[] = [];

  const CARD_SELECTORS = [".order-card", ".js-order-card", ".a-box-group.order", ".order"];
  let cards = $();
  for (const sel of CARD_SELECTORS) {
    cards = $(sel);
    if (cards.length > 0) {
      log("info", `注文カードセレクタ "${sel}" で ${cards.length} 件ヒット`);
      break;
    }
  }

  if (cards.length === 0) {
    const snippet = $.html().slice(0, 600).replace(/\s+/g, " ");
    log("warn", `注文カードが見つかりません。HTML先頭: ${snippet}`);
    return items;
  }

  cards.each((idx, card) => {
    const $card = $(card);
    const cardText = $card.text();

    const purchased = parseDate(cardText) || null;
    const orderIdMatch = cardText.match(/\b([0-9]{3}-[0-9]{7}-[0-9]{7})\b/);
    const orderId = orderIdMatch?.[1] ?? "";
    const orderPrice = parsePrice(
      $card.find(".a-color-price, .order-total, .yohtmlc-order-total").first().text()
    );

    const allLinks = $card.find("a[href]");
    const productLinks = allLinks.filter(
      (_, a) => /\/(?:dp|gp\/product|product)\/[A-Z0-9]{10}/.test($(a).attr("href") || "")
    );

    // 1枚目のカードだけ診断ログ
    if (idx === 0) {
      log("info", `[診断] orderId=${orderId} 購入日=${purchased?.toLocaleDateString("ja-JP") ?? "不明"}`);
      log("info", `[診断] 全リンク=${allLinks.length} 商品リンク候補=${productLinks.length}`);
      allLinks.slice(0, 8).each((_, a) => {
        const href = $(a).attr("href") ?? "";
        const text = $(a).text().trim().slice(0, 50);
        log("info", `[診断]   ${href.slice(0, 80)} | "${text}"`);
      });
    }

    const seen = new Set<string>();
    productLinks.each((__, a) => {
      const $a = $(a);
      const href = $a.attr("href") || "";
      const asin = asinFromUrl(href);
      if (!asin || seen.has(asin)) return;
      const name = $a.text().trim() || $a.find("img").attr("alt") || "";
      if (!name) return;
      seen.add(asin);

      const $row = $a.closest(".a-fixed-left-grid, .yohtmlc-item, .item-box, .a-row");
      const img = $row.find("img").attr("src") || $card.find("img[src]").first().attr("src") || "";
      const qtyText = $row.find(".item-view-qty, .od-item-view-qty, [class*='quantity']").first().text();
      let quantity = parseInt(qtyText.replace(/[^0-9]/g, ""), 10);
      if (!quantity || Number.isNaN(quantity)) quantity = 1;

      items.push({
        order_id: orderId,
        asin,
        jan_code: "",
        product_name: name,
        maker: "",
        product_url: href.startsWith("http") ? href : `${BASE}${href.split("?")[0]}`,
        image_url: img,
        purchased_at: purchased || new Date(),
        quantity,
        unit_price: orderPrice,
      });
      log("info", `  商品検出: [${orderId}] ${name} (ASIN=${asin})`);
    });
  });

  return items;
}

async function withBrowser<T>(fn: (browser: PuppeteerBrowser) => Promise<T>): Promise<T> {
  const executablePath = findChromium();
  log("info", `Chromium起動: ${executablePath}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: puppeteer } = await (Function('return import("puppeteer-core")')() as Promise<any>);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
    log("info", "Chromium終了");
  }
}

async function setupPage(browser: PuppeteerBrowser, cookie: string): Promise<PuppeteerPage> {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8" });
  // Cookieをセット
  const cookies = parseCookies(cookie);
  log("info", `Cookie ${cookies.length} 件をセット`);
  await page.setCookie(...cookies);
  return page;
}

async function fetchPageHtml(page: PuppeteerPage, url: string): Promise<{ html: string; finalUrl: string }> {
  log("info", `ページ取得: ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  // JavaScriptの復号が完了するまで少し待つ
  await sleep(2000);
  const finalUrl = page.url();
  const html = await page.content();
  log("info", `finalUrl: ${finalUrl} / HTML長さ: ${html.length}`);
  return { html, finalUrl };
}

async function enrichItem(page: PuppeteerPage, item: CrawledItem): Promise<void> {
  try {
    log("info", `詳細ページ取得: ${item.product_url}`);
    await page.goto(item.product_url, { waitUntil: "networkidle2", timeout: 20000 });
    await sleep(1000);
    const html = await page.content();
    const $ = cheerio.load(html);
    if (!item.maker) {
      const brand = $("#bylineInfo, #brand").first().text().trim();
      item.maker = brand.replace(/^(ブランド:|Brand:|Visit the|のストアを表示)/i, "").trim();
    }
    if (!item.image_url) {
      item.image_url = $("#landingImage, #imgBlkFront").first().attr("src") || "";
    }
    const bullets = $("#detailBullets_feature_div, #prodDetails").text();
    const jan = bullets.match(/\b(\d{13})\b/);
    if (jan) item.jan_code = jan[1];
  } catch (e) {
    log("warn", `詳細ページ取得失敗 (${item.asin}): ${(e as Error).message}`);
  }
}

export interface CrawlOptions {
  since: Date;
  enrich?: boolean;
  maxPages?: number;
}

export async function crawlOrders(cookie: string, opts: CrawlOptions): Promise<CrawledItem[]> {
  const collected: CrawledItem[] = [];
  const maxPages = opts.maxPages ?? 10;
  log("info", `クロール開始 (since=${opts.since.toISOString()}, maxPages=${maxPages})`);

  await withBrowser(async (browser) => {
    const page = await setupPage(browser, cookie);

    for (let p = 0; p < maxPages; p++) {
      const url = `${BASE}/your-orders/orders?startIndex=${p * 10}&unifiedOrders=1`;
      const { html, finalUrl } = await fetchPageHtml(page, url);
      assertLoggedIn(finalUrl, html);

      const pageItems = parseOrderHistory(html);
      log("info", `ページ ${p + 1}: ${pageItems.length} 件の商品を検出`);
      if (pageItems.length === 0) { log("info", "商品なし — クロール終了"); break; }

      let reachedOld = false;
      for (const it of pageItems) {
        if (it.purchased_at < opts.since) {
          log("info", `  スキップ(古): [${it.order_id}] ${it.product_name}`);
          reachedOld = true;
          continue;
        }
        collected.push(it);
      }
      if (reachedOld) { log("info", "差分終端に到達 — 終了"); break; }
      await politeDelay();
    }

    if (opts.enrich && collected.length > 0) {
      log("info", "詳細ページ補完開始...");
      for (const it of collected) {
        await enrichItem(page, it);
        await politeDelay();
      }
    }
  });

  log("info", `クロール完了: 対象 ${collected.length} 件`);
  return collected;
}
