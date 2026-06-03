import axios, { AxiosInstance } from "axios";
import * as cheerio from "cheerio";

const BASE = "https://www.amazon.co.jp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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
// 1〜3秒のランダムな間隔でサーバー負荷を避ける。
const politeDelay = (): Promise<void> => sleep(1000 + Math.floor(Math.random() * 2000));

function makeClient(cookie: string): AxiosInstance {
  return axios.create({
    baseURL: BASE,
    timeout: 20000,
    maxRedirects: 5,
    // Resolve redirects so we can detect the sign-in bounce.
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      Cookie: cookie,
      "User-Agent": UA,
      "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
}

function assertLoggedIn(html: string, finalUrl: string): void {
  if (/\/ap\/signin/.test(finalUrl) || html.includes('id="ap_password"') || html.includes('name="ap_email"')) {
    throw new CookieExpiredError();
  }
}

// Extract a 10-char ASIN from any Amazon product URL.
function asinFromUrl(href: string): string {
  const m = href.match(/\/(?:dp|gp\/product|product|gp\/aw\/d)\/([A-Z0-9]{10})/);
  return m ? m[1] : "";
}

// Parse Japanese ("2024年5月3日") or ISO-ish order dates.
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

// Parse a single order-history page into items. Amazon's markup varies, so we
// try several selectors and fall back gracefully.
export function parseOrderHistory(html: string): CrawledItem[] {
  const $ = cheerio.load(html);
  const items: CrawledItem[] = [];

  const cards = $(".order-card, .js-order-card, .a-box-group.order, .order");
  cards.each((_, card) => {
    const $card = $(card);

    const headerText = $card.find(".order-info, .order-header, .a-row").first().text();
    const purchased = parseDate($card.text()) || parseDate(headerText) || null;

    let orderId = "";
    const idMatch = $card.text().match(/\b([0-9]{3}-[0-9]{7}-[0-9]{7})\b/);
    if (idMatch) orderId = idMatch[1];

    // Order total / unit price (best effort; per-item price isn't always shown).
    const priceText = $card.find(".a-color-price, .order-total, .yohtmlc-order-total").first().text();
    const orderPrice = parsePrice(priceText);

    const productLinks = $card.find("a.a-link-normal[href*='/dp/'], a.a-link-normal[href*='/gp/product/'], a.a-link-normal[href*='/product/']");
    const seen = new Set<string>();
    productLinks.each((__, a) => {
      const $a = $(a);
      const href = $a.attr("href") || "";
      const asin = asinFromUrl(href);
      const name = $a.text().trim();
      if (!name || !asin || seen.has(asin)) return;
      seen.add(asin);

      const $row = $a.closest(".a-fixed-left-grid, .yohtmlc-item, .item-box, .a-row");
      const img = $row.find("img").attr("src") || $card.find(`img[src]`).first().attr("src") || "";
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
    });
  });

  return items;
}

// Optionally enrich an item from its product detail page (maker / JAN / image).
async function enrichItem(client: AxiosInstance, item: CrawledItem): Promise<void> {
  try {
    const res = await client.get(item.product_url);
    assertLoggedIn(String(res.data), res.request?.res?.responseUrl || "");
    const $ = cheerio.load(res.data as string);

    if (!item.maker) {
      const brand = $("#bylineInfo, #brand, a#bylineInfo").first().text().trim();
      item.maker = brand.replace(/^(ブランド:|Brand:|Visit the|のストアを表示)/i, "").trim();
    }
    if (!item.image_url) {
      item.image_url = $("#landingImage, #imgBlkFront, #main-image").first().attr("src") || "";
    }
    // JAN/EAN occasionally appears in the detail bullets.
    const bullets = $("#detailBullets_feature_div, #productDetails_detailBullets_sections1, #prodDetails").text();
    const jan = bullets.match(/\b(\d{13})\b/);
    if (jan) item.jan_code = jan[1];
  } catch (e) {
    if (e instanceof CookieExpiredError) throw e;
    // Enrichment is best-effort; ignore other failures.
  }
}

export interface CrawlOptions {
  since: Date;
  enrich?: boolean;
  maxPages?: number;
}

// Crawl order history pages newest-first, stopping once we pass `since`.
export async function crawlOrders(cookie: string, opts: CrawlOptions): Promise<CrawledItem[]> {
  const client = makeClient(cookie);
  const collected: CrawledItem[] = [];
  const maxPages = opts.maxPages ?? 10;

  for (let page = 0; page < maxPages; page++) {
    const startIndex = page * 10;
    const res = await client.get(`/gp/css/order-history?startIndex=${startIndex}&unifiedOrders=1`);
    const html = String(res.data);
    assertLoggedIn(html, res.request?.res?.responseUrl || "");

    const pageItems = parseOrderHistory(html);
    if (pageItems.length === 0) break;

    let reachedOld = false;
    for (const it of pageItems) {
      if (it.purchased_at < opts.since) {
        reachedOld = true;
        continue;
      }
      collected.push(it);
    }
    if (reachedOld) break;
    await politeDelay();
  }

  if (opts.enrich) {
    for (const it of collected) {
      await enrichItem(client, it);
      await politeDelay();
    }
  }

  return collected;
}
