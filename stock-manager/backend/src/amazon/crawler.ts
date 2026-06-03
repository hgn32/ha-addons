import axios, { AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import { log } from "./logger";

const BASE = "https://www.amazon.co.jp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

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

// Raised when the session cookie is no longer valid (Amazon redirects to sign-in).
export class CookieExpiredError extends Error {
  constructor() {
    super("Amazon Cookieが無効です。再取得して設定し直してください。");
    this.name = "CookieExpiredError";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const politeDelay = (): Promise<void> => sleep(1000 + Math.floor(Math.random() * 2000));

function makeClient(cookie: string): AxiosInstance {
  return axios.create({
    baseURL: BASE,
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      Cookie: cookie,
      "User-Agent": UA,
      "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  });
}

function assertLoggedIn(html: string, finalUrl: string): void {
  const challengePatterns = [
    /\/ap\/signin/,       // ログインページ
    /\/ax\/claim/,        // bot認証チャレンジ
    /\/errors\/validateCaptcha/, // CAPTCHA
    /\/gp\/aw\/c\b/,      // モバイルカート（未ログイン時リダイレクト先）
  ];
  if (
    challengePatterns.some((p) => p.test(finalUrl)) ||
    html.includes('id="ap_password"') ||
    html.includes('name="ap_email"') ||
    html.includes("validateCaptcha")
  ) {
    log("error", `認証ブロック検知: ${finalUrl}`);
    log("error", "CookieまたはCaptchaが原因です。Cookieを再取得して貼り直してください。");
    throw new CookieExpiredError();
  }
}

// Extract a 10-char ASIN from any Amazon product URL.
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

export function parseOrderHistory(html: string): CrawledItem[] {
  const $ = cheerio.load(html);
  const items: CrawledItem[] = [];

  // セレクタの候補を順に試す
  const CARD_SELECTORS = [
    ".order-card",
    ".js-order-card",
    ".a-box-group.order",
    ".order",
    "[data-component='order']",
  ];
  let cards = $();
  for (const sel of CARD_SELECTORS) {
    cards = $(sel);
    if (cards.length > 0) {
      log("info", `注文カードセレクタ "${sel}" で ${cards.length} 件ヒット`);
      break;
    }
  }

  if (cards.length === 0) {
    const snippet = $.html().slice(0, 500).replace(/\s+/g, " ");
    log("warn", `注文カードが見つかりません。HTML先頭: ${snippet}`);
  }

  cards.each((idx, card) => {
    const $card = $(card);

    const headerText = $card.find(".order-info, .order-header, .a-row").first().text();
    const purchased = parseDate($card.text()) || parseDate(headerText) || null;

    let orderId = "";
    const idMatch = $card.text().match(/\b([0-9]{3}-[0-9]{7}-[0-9]{7})\b/);
    if (idMatch) orderId = idMatch[1];

    const priceText = $card.find(".a-color-price, .order-total, .yohtmlc-order-total").first().text();
    const orderPrice = parsePrice(priceText);

    // 商品リンク: /dp/ /gp/product/ /product/ いずれかを含むhref
    const productLinks = $card.find(
      "a[href*='/dp/'], a[href*='/gp/product/'], a[href*='/product/']"
    );

    // 1枚目のカードだけ詳細をログ出力してHTML構造を確認する
    if (idx === 0) {
      log("info", `[診断] カード0 orderId=${orderId} 購入日=${purchased?.toLocaleDateString("ja-JP") ?? "不明"}`);
      log("info", `[診断] 全リンク数=${$card.find("a[href]").length} 商品リンク候補数=${productLinks.length}`);
      // カード内の全aタグのhrefを最大10件表示
      $card.find("a[href]").slice(0, 10).each((_, a) => {
        log("info", `[診断]   href=${$(a).attr("href")?.slice(0, 80)} text=${$(a).text().trim().slice(0, 40)}`);
      });
      // カードHTMLの先頭600文字
      const cardHtml = $.html(card).replace(/\s+/g, " ").slice(0, 600);
      log("info", `[診断] カードHTML先頭: ${cardHtml}`);
    }

    const seen = new Set<string>();
    productLinks.each((__, a) => {
      const $a = $(a);
      const href = $a.attr("href") || "";
      const asin = asinFromUrl(href);
      const name = $a.text().trim();
      if (!asin || seen.has(asin)) return;
      // テキストがない場合はimg alt を使う
      const displayName = name || $a.find("img").attr("alt") || "";
      if (!displayName) return;
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
        product_name: displayName,
        maker: "",
        product_url: href.startsWith("http") ? href : `${BASE}${href.split("?")[0]}`,
        image_url: img,
        purchased_at: purchased || new Date(),
        quantity,
        unit_price: orderPrice,
      });
      log("info", `  商品検出: [${orderId}] ${displayName} (ASIN=${asin}, qty=${quantity})`);
    });
  });

  return items;
}

async function enrichItem(client: AxiosInstance, item: CrawledItem): Promise<void> {
  try {
    log("info", `詳細ページ取得: ${item.product_url}`);
    const res = await client.get(item.product_url);
    const finalUrl: string = res.request?.res?.responseUrl || "";
    assertLoggedIn(String(res.data), finalUrl);
    const $ = cheerio.load(res.data as string);

    if (!item.maker) {
      const brand = $("#bylineInfo, #brand, a#bylineInfo").first().text().trim();
      item.maker = brand.replace(/^(ブランド:|Brand:|Visit the|のストアを表示)/i, "").trim();
    }
    if (!item.image_url) {
      item.image_url = $("#landingImage, #imgBlkFront, #main-image").first().attr("src") || "";
    }
    const bullets = $("#detailBullets_feature_div, #productDetails_detailBullets_sections1, #prodDetails").text();
    const jan = bullets.match(/\b(\d{13})\b/);
    if (jan) item.jan_code = jan[1];
  } catch (e) {
    if (e instanceof CookieExpiredError) throw e;
    log("warn", `詳細ページ取得失敗 (${item.asin}): ${(e as Error).message}`);
  }
}

export interface CrawlOptions {
  since: Date;
  enrich?: boolean;
  maxPages?: number;
}

export async function crawlOrders(cookie: string, opts: CrawlOptions): Promise<CrawledItem[]> {
  const client = makeClient(cookie);
  const collected: CrawledItem[] = [];
  const maxPages = opts.maxPages ?? 10;

  log("info", `クロール開始 (since=${opts.since.toISOString()}, maxPages=${maxPages})`);

  for (let page = 0; page < maxPages; page++) {
    const startIndex = page * 10;
    // /your-orders/orders が現行エンドポイント。/gp/css/order-history は廃止済み。
    const url = `/your-orders/orders?startIndex=${startIndex}&unifiedOrders=1`;
    log("info", `注文履歴ページ取得: ${url}`);

    let res;
    try {
      res = await client.get(url);
    } catch (e) {
      log("error", `HTTPリクエスト失敗: ${(e as Error).message}`);
      throw e;
    }

    const finalUrl: string = res.request?.res?.responseUrl || url;
    log("info", `レスポンス: status=${res.status}, finalUrl=${finalUrl}`);

    const html = String(res.data);
    assertLoggedIn(html, finalUrl);

    const pageItems = parseOrderHistory(html);
    log("info", `ページ ${page + 1}: ${pageItems.length} 件の商品を検出`);

    if (pageItems.length === 0) {
      log("info", "商品なし — クロール終了");
      break;
    }

    let reachedOld = false;
    for (const it of pageItems) {
      if (it.purchased_at < opts.since) {
        log("info", `  スキップ (古い): [${it.order_id}] ${it.product_name} (${it.purchased_at.toLocaleDateString("ja-JP")})`);
        reachedOld = true;
        continue;
      }
      collected.push(it);
    }
    if (reachedOld) {
      log("info", "差分の終端に到達 — クロール終了");
      break;
    }
    await politeDelay();
  }

  log("info", `クロール完了: 対象 ${collected.length} 件`);

  if (opts.enrich && collected.length > 0) {
    log("info", "詳細ページ補完開始...");
    for (const it of collected) {
      await enrichItem(client, it);
      await politeDelay();
    }
  }

  return collected;
}
