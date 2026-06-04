import * as cheerio from "cheerio";
import { log } from "./logger";

// Minimal shape of puppeteer-core's Browser/Page (avoids ESM type-import issues)
interface PuppeteerCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: number;
}
interface PuppeteerPage {
  setUserAgent(ua: string): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  setCookie(...cookies: Array<{ name: string; value: string; domain: string }>): Promise<void>;
  cookies(...urls: string[]): Promise<PuppeteerCookie[]>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  content(): Promise<string>;
  close(): Promise<void>;
  evaluateOnNewDocument?: (fn: string | ((...args: unknown[]) => unknown), ...args: unknown[]) => Promise<void>;
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
// 一覧ページ間のウェイト（ボット検知回避）
const politeDelay = (): Promise<void> => sleep(1500 + Math.floor(Math.random() * 1500));
// 詳細ページ間のウェイト（一覧より短くしてOK）
const enrichDelay = (): Promise<void> => sleep(600 + Math.floor(Math.random() * 400));

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
function parseCookies(cookieStr: string): Array<{ name: string; value: string; domain: string; secure?: boolean; path?: string }> {
  // Strip control characters (newlines, carriage returns, tabs) that cause CDP errors
  const sanitized = cookieStr.replace(/[\r\n\t]/g, " ");
  return sanitized
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const idx = s.indexOf("=");
      if (idx === -1) return null;
      const name = s.slice(0, idx).trim();
      // Strip any remaining control characters from value
      const value = s.slice(idx + 1).trim().replace(/[\x00-\x1F\x7F]/g, "");
      if (!name) return null;
      // __Secure- prefix requires secure:true; __Host- requires secure:true + path:"/"
      const secure = name.startsWith("__Secure-") || name.startsWith("__Host-");
      const path = name.startsWith("__Host-") ? "/" : undefined;
      return { name, value, domain: ".amazon.co.jp", ...(secure ? { secure } : {}), ...(path ? { path } : {}) };
    })
    .filter(Boolean) as Array<{ name: string; value: string; domain: string; secure?: boolean; path?: string }>;
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
      log("info", `[診断] 全リンク=${allLinks.length} 品目リンク候補=${productLinks.length}`);
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
      log("info", `  品目検出: [${orderId}] ${name} (ASIN=${asin})`);
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
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
      "--lang=ja-JP,ja",
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
  // Inject stealth overrides before any page script runs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page as any).evaluateOnNewDocument(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // Realistic plugins/mimeTypes
    Object.defineProperty(navigator, "plugins", { get: () => {
      const arr = [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        { name: "Native Client", filename: "internal-nacl-plugin" },
      ] as unknown as Plugin[];
      Object.setPrototypeOf(arr, PluginArray.prototype);
      return arr;
    }});
    Object.defineProperty(navigator, "mimeTypes", { get: () => {
      const arr = [] as unknown as MimeTypeArray;
      Object.setPrototypeOf(arr, MimeTypeArray.prototype);
      return arr;
    }});
    Object.defineProperty(navigator, "languages", { get: () => ["ja-JP", "ja", "en-US", "en"] });
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
    // Complete chrome object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } },
      runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {} },
      loadTimes: () => ({}),
      csi: () => ({}),
    };
    // Mock permissions API (headless returns 'denied' for notifications by default)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origQuery = (window.navigator.permissions as any).query.bind(navigator.permissions);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator.permissions as any).query = (params: any) =>
      params.name === "notifications"
        ? Promise.resolve({ state: "default", onchange: null })
        : origQuery(params);
  });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8" });
  // Cookieを1件ずつセット（1件のエラーで全体が止まらないよう）
  const cookies = parseCookies(cookie);
  let set = 0;
  for (const c of cookies) {
    try {
      await page.setCookie(c);
      set++;
    } catch (e) {
      log("warn", `Cookie "${c.name}" のセットをスキップ: ${(e as Error).message}`);
    }
  }
  log("info", `Cookie ${set}/${cookies.length} 件をセット`);
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

async function enrichItem(page: PuppeteerPage, item: CrawledItem, index: number, total: number): Promise<void> {
  try {
    log("info", `詳細補完 (${index}/${total}): ${item.product_name.slice(0, 40)}`);
    await page.goto(item.product_url, { waitUntil: "networkidle2", timeout: 20000 });
    await sleep(800);
    const html = await page.content();
    const $ = cheerio.load(html);
    if (!item.maker) {
      const brand = $("#bylineInfo, #brand").first().text().trim();
      item.maker = brand
        .replace(/ブランド:|Brand:|Visit the/gi, "")
        .replace(/のストアを表示/g, "")
        .trim();
    }
    if (!item.image_url) {
      item.image_url = $("#landingImage, #imgBlkFront").first().attr("src") || "";
    }
    const bullets = $("#detailBullets_feature_div, #prodDetails").text();
    const jan = bullets.match(/\b(\d{13})\b/);
    if (jan) item.jan_code = jan[1];
    const got = [item.maker && "maker", item.image_url && "image", item.jan_code && "JAN"].filter(Boolean).join(", ");
    log("info", `  → ${got || "補完データなし"} (JAN=${item.jan_code || "-"}, maker=${item.maker || "-"})`);
  } catch (e) {
    log("warn", `詳細補完失敗 (${index}/${total} ${item.asin}): ${(e as Error).message}`);
  }
}

export interface CrawlOptions {
  since: Date;
  enrich?: boolean;
  maxPages?: number;
}

export interface CrawlResult {
  items: CrawledItem[];
  // Refreshed cookie string from Puppeteer (Amazon updates session cookies on each request)
  refreshedCookie: string | null;
}

// Serialize Puppeteer cookie objects back to "name=value; name2=value2" format
function serializeCookies(cookies: PuppeteerCookie[]): string {
  return cookies
    .filter((c) => c.domain && c.domain.includes("amazon"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export async function crawlOrders(cookie: string, opts: CrawlOptions): Promise<CrawlResult> {
  const collected: CrawledItem[] = [];
  const maxPages = opts.maxPages ?? 10;
  let refreshedCookie: string | null = null;
  log("info", `クロール開始 (since=${opts.since.toISOString()}, maxPages=${maxPages})`);

  await withBrowser(async (browser) => {
    const page = await setupPage(browser, cookie);

    for (let p = 0; p < maxPages; p++) {
      const url = `${BASE}/your-orders/orders?startIndex=${p * 10}&unifiedOrders=1`;
      const { html, finalUrl } = await fetchPageHtml(page, url);
      assertLoggedIn(finalUrl, html);

      // After first successful page load, save refreshed cookies
      if (p === 0) {
        try {
          const liveCookies = await page.cookies("https://www.amazon.co.jp");
          const serialized = serializeCookies(liveCookies);
          if (serialized) {
            refreshedCookie = serialized;
            log("info", `Cookieを更新: ${liveCookies.length}件 (${serialized.length}文字)`);
          }
        } catch (e) {
          log("warn", `Cookie更新スキップ: ${(e as Error).message}`);
        }
      }

      const pageItems = parseOrderHistory(html);
      log("info", `ページ ${p + 1}: ${pageItems.length} 件の品目を検出`);
      if (pageItems.length === 0) { log("info", "品目なし — クロール終了"); break; }

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
      log("info", `詳細補完開始: ${collected.length}件`);
      for (let i = 0; i < collected.length; i++) {
        await enrichItem(page, collected[i], i + 1, collected.length);
        await enrichDelay();
      }
      log("info", "詳細補完完了");
    }
  });

  log("info", `クロール完了: 対象 ${collected.length} 件`);
  return { items: collected, refreshedCookie };
}
