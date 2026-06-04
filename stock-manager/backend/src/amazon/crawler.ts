import * as cheerio from "cheerio";
import { log } from "./logger";

// Minimal Puppeteer interfaces (avoids ESM type-import issues in CommonJS)
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
  setViewport(v: { width: number; height: number }): Promise<void>;
  setExtraHTTPHeaders(h: Record<string, string>): Promise<void>;
  setCookie(...cookies: Array<{ name: string; value: string; domain: string; secure?: boolean; path?: string }>): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  content(): Promise<string>;
  close(): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluateOnNewDocument(fn: string | ((...args: any[]) => any), ...args: any[]): Promise<void>;
}
interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

const BASE = "https://www.amazon.co.jp";

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
const enrichDelay = (): Promise<void> => sleep(800 + Math.floor(Math.random() * 400));

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

// Cookie文字列 → Puppeteer形式に変換
function parseCookies(cookieStr: string): Array<{ name: string; value: string; domain: string; secure?: boolean; path?: string }> {
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

    if (idx === 0) {
      log("info", `[診断] orderId=${orderId} 購入日=${purchased?.toLocaleDateString("ja-JP") ?? "不明"}`);
      log("info", `[診断] 全リンク=${allLinks.length} 品目リンク候補=${productLinks.length}`);
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

// Chromiumをシングルトンで保持（フィンガープリント一貫性 + 起動コスト削減）
let _browser: PuppeteerBrowser | null = null;

const CHROME_PROFILE_DIR = "/config/stock_manager_3a30c8ec/chrome-profile";

// フィンガープリントに不要なキャッシュ系ディレクトリを起動前に削除
function cleanChromeCache(): void {
  const { rmSync, existsSync } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const targets = [
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/Service Worker",
    "Default/CacheStorage",
    "ShaderCache",
    "GrShaderCache",
  ];
  for (const rel of targets) {
    const full = join(CHROME_PROFILE_DIR, rel);
    if (existsSync(full)) {
      try {
        rmSync(full, { recursive: true, force: true });
      } catch {
        // 削除失敗は無視
      }
    }
  }
  log("info", "Chromeキャッシュを削除しました");
}

async function getBrowser(): Promise<PuppeteerBrowser> {
  if (_browser) {
    // 生存確認: ページを開けるか試す
    try {
      const p = await _browser.newPage();
      await p.close();
      return _browser;
    } catch {
      log("warn", "Chromiumが応答しないため再起動します");
      _browser = null;
    }
  }

  cleanChromeCache();

  const executablePath = findChromium();
  log("info", `Chromium起動: ${executablePath} (プロファイル: ${CHROME_PROFILE_DIR})`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { default: puppeteer } = await (Function('return import("puppeteer-core")')() as Promise<any>);
  _browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: CHROME_PROFILE_DIR,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
      "--lang=ja-JP,ja",
      "--disk-cache-size=1",
      "--media-cache-size=1",
      "--disable-gpu-shader-disk-cache",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
    ],
  });
  log("info", "Chromium起動完了");
  return _browser!;
}

async function withBrowser<T>(fn: (browser: PuppeteerBrowser) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  return fn(browser);
}

async function setupPage(
  browser: PuppeteerBrowser,
  cookie: string,
  curlHeaders: Record<string, string> = {}
): Promise<PuppeteerPage> {
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).chrome = {
      app: { isInstalled: false },
      runtime: {},
      loadTimes: () => ({}),
      csi: () => ({}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origQuery = (window.navigator.permissions as any).query.bind(navigator.permissions);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator.permissions as any).query = (params: any) =>
      params.name === "notifications"
        ? Promise.resolve({ state: "default", onchange: null })
        : origQuery(params);
  });

  const ua = curlHeaders["user-agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
  await page.setUserAgent(ua);
  await page.setViewport({ width: 1920, height: 1080 });

  // cURLヘッダーからCookie・UA以外をextraHTTPHeadersとして設定
  const extraHeaders: Record<string, string> = {
    "Accept-Language": curlHeaders["accept-language"] || "ja-JP,ja;q=0.9,en;q=0.8",
    "Accept": curlHeaders["accept"] ||
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Referer": "https://www.amazon.co.jp/",
  };
  // sec-ch-ua 系もcURLから引き継ぐ
  for (const [k, v] of Object.entries(curlHeaders)) {
    if (k.startsWith("sec-") && k !== "sec-fetch-site" && k !== "sec-fetch-mode") {
      extraHeaders[k] = v;
    }
  }
  await page.setExtraHTTPHeaders(extraHeaders);

  // Cookieを1件ずつセット（userDataDirがあるため初回のみ必要、以降はChromiumが自動管理）
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
  // domcontentloaded後にAmazonのSiegeClientSideDecryptionが実行されるまで待つ
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1500);
  const finalUrl = page.url();
  const html = await page.content();
  log("info", `finalUrl: ${finalUrl} / HTML長さ: ${html.length}`);
  return { html, finalUrl };
}

async function enrichItem(page: PuppeteerPage, item: CrawledItem, index: number, total: number): Promise<void> {
  try {
    log("info", `詳細補完 (${index}/${total}): ${item.product_name.slice(0, 40)}`);
    await page.goto(item.product_url, { waitUntil: "domcontentloaded", timeout: 20000 });
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
    log("info", `  → ${got || "補完データなし"}`);
  } catch (e) {
    log("warn", `詳細補完失敗 (${index}/${total} ${item.asin}): ${(e as Error).message}`);
  }
}

export interface CrawlOptions {
  since: Date;
  maxPages?: number;
}

export interface CrawlResult {
  items: CrawledItem[];
  refreshedCookie: string | null;
}

// Chromiumが保持しているAmazon Cookieを "name=value; ..." 形式で返す
async function readBrowserCookies(page: PuppeteerPage): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveCookies: PuppeteerCookie[] = await (page as any).cookies("https://www.amazon.co.jp");
    if (!liveCookies.length) return null;
    const str = liveCookies.map((c) => `${c.name}=${c.value}`).join("; ");
    log("info", `ブラウザからCookie読取: ${liveCookies.length}件 (${str.length}文字)`);
    return str;
  } catch (e) {
    log("warn", `Cookie読取スキップ: ${(e as Error).message}`);
    return null;
  }
}

export async function crawlOrders(cookie: string, opts: CrawlOptions, curlHeaders: Record<string, string> = {}): Promise<CrawlResult> {
  const collected: CrawledItem[] = [];
  const maxPages = opts.maxPages ?? 10;
  let refreshedCookie: string | null = null;
  log("info", `クロール開始 (since=${opts.since.toISOString()}, maxPages=${maxPages})`);
  log("info", `Cookie長さ: ${cookie.length}文字`);

  await withBrowser(async (browser) => {
    const page = await setupPage(browser, cookie, curlHeaders);

    for (let p = 0; p < maxPages; p++) {
      const url = `${BASE}/your-orders/orders?startIndex=${p * 10}&unifiedOrders=1`;
      const { html, finalUrl } = await fetchPageHtml(page, url);

      assertLoggedIn(finalUrl, html);

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

    // クロール完了後にChromiumが保持している最新Cookieを取得
    refreshedCookie = await readBrowserCookies(page);
    await page.close();
  });

  log("info", `クロール完了: 対象 ${collected.length} 件`);
  if (refreshedCookie) log("info", "Cookieを更新しました");
  return { items: collected, refreshedCookie };
}

export async function enrichItems(cookie: string, items: CrawledItem[], curlHeaders: Record<string, string> = {}): Promise<void> {
  if (items.length === 0) return;
  log("info", `詳細補完開始: ${items.length}件`);
  await withBrowser(async (browser) => {
    const page = await setupPage(browser, cookie, curlHeaders);
    for (let i = 0; i < items.length; i++) {
      await enrichItem(page, items[i], i + 1, items.length);
      await enrichDelay();
    }
    await page.close();
  });
  log("info", "詳細補完完了");
}
