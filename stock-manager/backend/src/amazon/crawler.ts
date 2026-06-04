import axios from "axios";
import * as cheerio from "cheerio";
import { log } from "./logger";

const BASE = "https://www.amazon.co.jp";

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

// axiosインスタンス: cURLから取得した実ブラウザのヘッダーをそのまま使用
// curlHeaders が空の場合はデフォルトヘッダーにフォールバック
function makeClient(cookie: string, curlHeaders: Record<string, string> = {}) {
  const defaultHeaders: Record<string, string> = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "ja-JP,ja;q=0.9,en;q=0.8",
    "accept-encoding": "gzip, deflate, br",
    "referer": "https://www.amazon.co.jp/",
    "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };

  // cURLヘッダーを優先（:authority, :method 等の疑似ヘッダーは除外）
  const merged: Record<string, string> = { ...defaultHeaders };
  for (const [k, v] of Object.entries(curlHeaders)) {
    if (!k.startsWith(":")) merged[k] = v;
  }
  // Cookieは常に最新値を使う
  merged["cookie"] = cookie;

  const usingCurl = Object.keys(curlHeaders).length > 0;
  log("info", `HTTPクライアント初期化: ${usingCurl ? "cURLヘッダー使用" : "デフォルトヘッダー使用"} (${Object.keys(merged).length}件)`);

  const client = axios.create({
    baseURL: BASE,
    timeout: 30000,
    headers: merged,
    maxRedirects: 5,
  });
  return client;
}

// レスポンスのSet-Cookieを元のcookie文字列にマージして返す
function mergeResponseCookies(originalCookie: string, setCookieHeaders: string[]): string {
  const map = new Map<string, string>();
  // 既存cookieをmapに展開
  for (const part of originalCookie.split(";")) {
    const idx = part.trim().indexOf("=");
    if (idx === -1) continue;
    const name = part.trim().slice(0, idx).trim();
    const value = part.trim().slice(idx + 1).trim();
    if (name) map.set(name, value);
  }
  // Set-Cookieで上書き
  for (const header of setCookieHeaders) {
    const segment = header.split(";")[0].trim();
    const idx = segment.indexOf("=");
    if (idx === -1) continue;
    const name = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    if (name) {
      const prev = map.get(name);
      if (prev !== value) {
        log("info", `[Set-Cookie] ${name} 更新`);
        map.set(name, value);
      }
    }
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchHtml(
  client: ReturnType<typeof makeClient>,
  url: string,
  currentCookie: string
): Promise<{ html: string; finalUrl: string; updatedCookie: string }> {
  log("info", `ページ取得: ${url}`);
  const resp = await client.get(url, { responseType: "text" });
  const finalUrl = resp.request?.res?.responseUrl ?? url;
  log("info", `finalUrl: ${finalUrl} / ステータス: ${resp.status} / HTML長さ: ${resp.data.length}`);

  const setCookies: string[] = [];
  const raw = resp.headers["set-cookie"];
  if (Array.isArray(raw)) setCookies.push(...raw);
  else if (typeof raw === "string") setCookies.push(raw);

  if (setCookies.length > 0) {
    log("info", `Set-Cookie ${setCookies.length}件受信`);
  }
  const updatedCookie = mergeResponseCookies(currentCookie, setCookies);
  return { html: resp.data as string, finalUrl, updatedCookie };
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

async function enrichItem(
  client: ReturnType<typeof makeClient>,
  item: CrawledItem,
  index: number,
  total: number,
  currentCookie: string
): Promise<string> {
  try {
    log("info", `詳細補完 (${index}/${total}): ${item.product_name.slice(0, 40)}`);
    const { html, updatedCookie } = await fetchHtml(client, item.product_url, currentCookie);
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
    const got = [item.maker && "maker", item.image_url && "image", item.jan_code && "JAN"]
      .filter(Boolean).join(", ");
    log("info", `  → ${got || "補完データなし"}`);
    return updatedCookie;
  } catch (e) {
    log("warn", `詳細補完失敗 (${index}/${total} ${item.asin}): ${(e as Error).message}`);
    return currentCookie;
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

export async function crawlOrders(cookie: string, opts: CrawlOptions, curlHeaders: Record<string, string> = {}): Promise<CrawlResult> {
  const collected: CrawledItem[] = [];
  const maxPages = opts.maxPages ?? 10;
  let currentCookie = cookie;
  log("info", `クロール開始 (since=${opts.since.toISOString()}, maxPages=${maxPages})`);
  log("info", `Cookie長さ: ${cookie.length}文字`);

  const client = makeClient(currentCookie, curlHeaders);

  for (let p = 0; p < maxPages; p++) {
    const url = `/your-orders/orders?startIndex=${p * 10}&unifiedOrders=1`;
    let html: string;
    let finalUrl: string;
    try {
      ({ html, finalUrl, updatedCookie: currentCookie } = await fetchHtml(client, url, currentCookie));
      // axiosのCookieヘッダを最新に更新
      client.defaults.headers.common["Cookie"] = currentCookie;
    } catch (e) {
      log("error", `ページ取得失敗: ${(e as Error).message}`);
      throw e;
    }

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

  log("info", `クロール完了: 対象 ${collected.length} 件`);
  const refreshedCookie = currentCookie !== cookie ? currentCookie : null;
  if (refreshedCookie) log("info", "Cookieを更新しました");
  return { items: collected, refreshedCookie };
}

// 品目詳細補完 — マスタ未登録アイテムのみ対象にして呼ぶこと
export async function enrichItems(cookie: string, items: CrawledItem[], curlHeaders: Record<string, string> = {}): Promise<void> {
  if (items.length === 0) return;
  log("info", `詳細補完開始: ${items.length}件`);
  let currentCookie = cookie;
  const client = makeClient(currentCookie, curlHeaders);

  for (let i = 0; i < items.length; i++) {
    currentCookie = await enrichItem(client, items[i], i + 1, items.length, currentCookie);
    client.defaults.headers.common["Cookie"] = currentCookie;
    await enrichDelay();
  }
  log("info", "詳細補完完了");
}
