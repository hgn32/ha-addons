import axios from "axios";
import fs from "fs";
import path from "path";
import { prisma } from "../db";
import { IMAGES_DIR, newId } from "../paths";
import { getCookie, getCurlHeaders, getSetting, setSetting } from "./config";
import { crawlOrders, enrichItems, CrawledItem } from "./crawler";
import { log } from "./logger";

const LAST_SYNC_KEY = "amazon_last_sync"; // 差分取得カーソル（取得済み注文の最新購入日）
const LAST_RUN_KEY = "amazon_last_run";   // 実際にクロールを実行した時刻（UIの「前回同期」表示用）
const DEFAULT_LOOKBACK_DAYS = 90;

// クロール実行中フラグ。UIが状態をポーリングして実行中表示・多重起動防止に使う。
let crawlRunning = false;
export function isCrawlRunning(): boolean {
  return crawlRunning;
}

export interface CrawlSummary {
  fetched: number;
  auto: number;
  queued: number;
  skipped: number;
  last_sync: string;
}

// Find a product master entry matching the crawled item's ASIN or JAN.
// Checks ProductAsin table first, then legacy product.amazon_asin field, then
// JAN code (主jan_code → 追加JANコードProductBarcode).
export async function matchProduct(asin: string, jan: string) {
  if (asin) {
    const byProductAsin = await prisma.productAsin.findUnique({ where: { asin }, include: { product: true } });
    if (byProductAsin) return byProductAsin.product;
    // Legacy fallback: products created before multi-ASIN support
    const byLegacyAsin = await prisma.product.findFirst({ where: { amazon_asin: asin } });
    if (byLegacyAsin) return byLegacyAsin;
  }
  if (jan) {
    const byJan = await prisma.product.findFirst({ where: { jan_code: jan } });
    if (byJan) return byJan;
    const byBarcode = await prisma.productBarcode.findUnique({ where: { code: jan }, include: { product: true } });
    if (byBarcode) return byBarcode.product;
  }
  return null;
}

function queueData(item: CrawledItem, status: string) {
  return {
    order_id: item.order_id,
    asin: item.asin,
    jan_code: item.jan_code,
    product_name: item.product_name,
    maker: item.maker,
    product_url: item.product_url,
    image_url: item.image_url,
    purchased_at: item.purchased_at,
    quantity: item.quantity,
    unit_price: item.unit_price,
    status,
  };
}

// Run a differential crawl: fetch orders since last sync, auto-add matches,
// queue the rest for manual triage.
// full=true forces a 90-day lookback regardless of last sync date.
export async function runAmazonCrawl(full = false): Promise<CrawlSummary> {
  if (crawlRunning) throw new Error("既にクロールを実行中です");
  crawlRunning = true;
  try {
    return await runAmazonCrawlInner(full);
  } finally {
    crawlRunning = false;
  }
}

async function runAmazonCrawlInner(full = false): Promise<CrawlSummary> {
  const startedAt = Date.now();
  const cookie = await getCookie();
  if (!cookie) throw new Error("Amazon Cookieが設定されていません");
  log("info", `=== クロール開始 ${new Date(startedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false })} ===`);
  log("info", `Cookie長さ: ${cookie.length}文字`);
  log("info", `Cookie先頭: ${cookie.slice(0, 60)}...`);

  const lastSyncStr = await getSetting(LAST_SYNC_KEY);
  const since =
    !full && lastSyncStr
      ? new Date(lastSyncStr)
      : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  log("info", `差分取得基準日: ${since.toISOString()} (full=${full})`);

  const curlHeaders = await getCurlHeaders();
  const { items: orders, refreshedCookie } = await crawlOrders(cookie, { since }, curlHeaders);

  // Save refreshed cookies so the next crawl uses the latest session tokens
  if (refreshedCookie) {
    await setSetting("amazon_cookie", refreshedCookie);
    log("info", "セッションCookieを自動更新しました");
  }

  log("info", `★ crawlOrders完了: ${orders.length}件取得`);

  const existingQueue = await prisma.amazonQueue.count();
  log("info", `キュー既存件数: ${existingQueue}件`);

  let queued = 0;
  let skipped = 0;
  let maxDate = since;

  // マッチング判定（enrich前に実施）
  type MatchedItem = { item: CrawledItem; product: Awaited<ReturnType<typeof matchProduct>> };
  const toProcess: MatchedItem[] = [];

  for (const item of orders) {
    if (item.purchased_at > maxDate) maxDate = item.purchased_at;

    const dup = await prisma.amazonQueue.findFirst({
      where: { order_id: item.order_id, asin: item.asin },
    });
    if (dup) {
      log("info", `  スキップ(重複 status=${dup.status}): [${item.order_id}] ${item.product_name}`);
      skipped++;
      continue;
    }

    const product = await matchProduct(item.asin, item.jan_code);
    toProcess.push({ item, product });
  }

  // マスタ未マッチのアイテムのみ詳細補完（Chromium再起動で取得）
  const needEnrich = toProcess
    .filter(({ product }) => !product)
    .map(({ item }) => item);
  let failedAsins: string[] = [];
  if (needEnrich.length > 0) {
    log("info", `詳細補完対象: ${needEnrich.length}件（マスタ未登録のみ）`);
    failedAsins = await enrichItems(cookie, needEnrich, curlHeaders);
  }

  // DB登録
  for (const { item } of toProcess) {
    log("info", `  取込待ち追加: "${item.product_name}" (ASIN=${item.asin})`);
    const enrichFailed = needEnrich.some(n => n.asin === item.asin) && failedAsins.includes(item.asin);
    await prisma.amazonQueue.create({ data: { ...queueData(item, "pending"), enrich_failed: enrichFailed } });
    queued++;
  }

  // +1ms makes the next crawl's filter strictly after this date, preventing
  // boundary re-imports when purchased_at equals the last seen order's date.
  await setSetting(LAST_SYNC_KEY, new Date(maxDate.getTime() + 1).toISOString());
  await setSetting(LAST_RUN_KEY, new Date().toISOString());
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  log("info", `★ 完了: fetched=${orders.length} queued=${queued} skipped=${skipped} (キュー合計: ${await prisma.amazonQueue.count()}件) / 所要時間 ${elapsedSec}秒`);

  return { fetched: orders.length, auto: 0, queued, skipped, last_sync: maxDate.toISOString() };
}

// Best-effort: download a remote image into IMAGES_DIR, return stored filename.
async function downloadImage(id: string, url: string): Promise<string> {
  if (!url) return "";
  try {
    const res = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 15000 });
    const ext = (path.extname(new URL(url).pathname) || ".jpg").split("?")[0];
    const filename = `${id}${ext}`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), Buffer.from(res.data));
    return filename;
  } catch {
    return "";
  }
}

export interface ManageOverrides {
  name?: string;
  maker?: string;
  volume?: string;
  piece_count?: number;
  jan_code?: string;
  category_id?: string;
  location_id?: string;
  note?: string;
}

// パターンA-1「新規登録」: 品目マスタに新規登録 + 在庫加算 + ASIN紐づけ
export async function manageQueueItemNew(id: string, rawOverrides: ManageOverrides, quantity: number) {
  const overrides: ManageOverrides = {
    name: rawOverrides.name?.trim(),
    maker: rawOverrides.maker?.trim(),
    volume: rawOverrides.volume?.trim(),
    piece_count: rawOverrides.piece_count,
    jan_code: rawOverrides.jan_code?.trim(),
    category_id: rawOverrides.category_id?.trim(),
    location_id: rawOverrides.location_id?.trim(),
    note: rawOverrides.note?.trim(),
  };
  const item = await prisma.amazonQueue.findUnique({ where: { id } });
  if (!item) throw new Error("取込データが見つかりません");

  const productId = newId();
  const photo = item.image_url.startsWith("http")
    ? await downloadImage(productId, item.image_url)
    : item.image_url;

  // Auto-select Amazon.co.jp supplier for the transaction
  const amazonSupplier = await prisma.supplier.findFirst({ where: { name: "Amazon.co.jp" } });

  const product = await prisma.product.create({
    data: {
      id: productId,
      name: (overrides.name ?? item.product_name) || item.asin || "不明",
      maker: overrides.maker ?? item.maker,
      volume: overrides.volume ?? "",
      piece_count: overrides.piece_count ?? 1,
      jan_code: overrides.jan_code ?? item.jan_code,
      amazon_asin: item.asin,
      amazon_url: item.product_url,
      category_id: overrides.category_id ?? "",
      location_id: overrides.location_id ?? "",
      note: overrides.note ?? "",
      photo,
      quantity: quantity,
    },
  });

  // Register ASIN in ProductAsin table
  if (item.asin) {
    await prisma.productAsin.upsert({
      where: { asin: item.asin },
      update: { product_id: product.id },
      create: { product_id: product.id, asin: item.asin },
    });
  }

  await prisma.transaction.create({
    data: {
      type: "add",
      product_id: product.id,
      quantity: quantity,
      supplier_id: amazonSupplier?.id ?? "",
      note: `Amazon取込(新規登録) 注文:${item.order_id}`,
    },
  });

  await prisma.amazonQueue.delete({ where: { id } });
  return product;
}

// パターンA-2「既存アイテムにマージ」: 既存マスタにASIN紐づけ + 在庫加算
export async function manageQueueItemMerge(id: string, productId: string, quantity: number) {
  const item = await prisma.amazonQueue.findUnique({ where: { id } });
  if (!item) throw new Error("取込データが見つかりません");
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("マージ先の品目が見つかりません");

  // Add ASIN association
  if (item.asin) {
    await prisma.productAsin.upsert({
      where: { asin: item.asin },
      update: { product_id: productId },
      create: { product_id: productId, asin: item.asin },
    });
  }

  await prisma.product.update({
    where: { id: productId },
    data: { quantity: { increment: quantity } },
  });

  await prisma.transaction.create({
    data: {
      type: "add",
      product_id: productId,
      quantity: quantity,
      unit_price: item.unit_price,
      supplier_id: (await prisma.supplier.findFirst({ where: { name: "Amazon.co.jp" } }))?.id ?? "",
      note: `Amazon取込(マージ) 注文:${item.order_id}`,
    },
  });

  await prisma.amazonQueue.delete({ where: { id } });
  return product;
}

export async function retryEnrichFailed(): Promise<{ total: number; success: number }> {
  if (crawlRunning) throw new Error("既にクロールを実行中です");
  crawlRunning = true;
  try {
    return await retryEnrichFailedInner();
  } finally {
    crawlRunning = false;
  }
}

async function retryEnrichFailedInner(): Promise<{ total: number; success: number }> {
  const cookie = await getCookie();
  if (!cookie) throw new Error("Amazon Cookieが設定されていません");

  const failedItems = await prisma.amazonQueue.findMany({ where: { enrich_failed: true } });
  if (failedItems.length === 0) return { total: 0, success: 0 };

  log("info", `補完リトライ: ${failedItems.length}件`);
  const curlHeaders = await getCurlHeaders();

  const crawlItems: CrawledItem[] = failedItems.map(q => ({
    order_id: q.order_id,
    asin: q.asin,
    jan_code: q.jan_code,
    product_name: q.product_name,
    maker: q.maker,
    product_url: q.product_url,
    image_url: q.image_url,
    purchased_at: q.purchased_at,
    quantity: q.quantity,
    unit_price: q.unit_price,
  }));

  const failedAsins = await enrichItems(cookie, crawlItems, curlHeaders);

  let success = 0;
  for (const item of crawlItems) {
    const enrichFailed = failedAsins.includes(item.asin);
    const queueRow = failedItems.find(f => f.asin === item.asin)!;
    await prisma.amazonQueue.update({
      where: { id: queueRow.id },
      data: { maker: item.maker, image_url: item.image_url, jan_code: item.jan_code, enrich_failed: enrichFailed },
    });
    if (!enrichFailed) success++;
  }

  log("info", `補完リトライ完了: ${success}/${failedItems.length}件成功`);
  return { total: failedItems.length, success };
}
