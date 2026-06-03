import axios from "axios";
import fs from "fs";
import path from "path";
import { prisma } from "../db";
import { IMAGES_DIR, newId } from "../paths";
import { getCookie, getSetting, setSetting } from "./config";
import { crawlOrders, CrawledItem } from "./crawler";
import { log } from "./logger";

const LAST_SYNC_KEY = "amazon_last_sync";
const DEFAULT_LOOKBACK_DAYS = 90;

export interface CrawlSummary {
  fetched: number;
  auto: number;
  queued: number;
  skipped: number;
  last_sync: string;
}

// Find a product master entry matching the crawled item's ASIN or JAN.
async function matchProduct(asin: string, jan: string) {
  if (asin) {
    const byAsin = await prisma.product.findFirst({ where: { amazon_asin: asin } });
    if (byAsin) return byAsin;
  }
  if (jan) {
    const byJan = await prisma.product.findFirst({ where: { jan_code: jan } });
    if (byJan) return byJan;
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
export async function runAmazonCrawl(): Promise<CrawlSummary> {
  const cookie = await getCookie();
  if (!cookie) throw new Error("Amazon Cookieが設定されていません");
  log("info", `Cookie長さ: ${cookie.length}文字`);
  log("info", `Cookie先頭: ${cookie.slice(0, 60)}...`);

  const lastSyncStr = await getSetting(LAST_SYNC_KEY);
  const since = lastSyncStr
    ? new Date(lastSyncStr)
    : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  log("info", `差分取得基準日: ${since.toISOString()}`);

  const orders = await crawlOrders(cookie, { since, enrich: true });

  const ignored = new Set(
    (await prisma.amazonIgnoredAsin.findMany()).map((a) => a.asin)
  );

  let auto = 0;
  let queued = 0;
  let skipped = 0;
  let maxDate = since;

  for (const item of orders) {
    if (item.purchased_at > maxDate) maxDate = item.purchased_at;

    if (item.asin && ignored.has(item.asin)) {
      skipped++;
      continue;
    }

    // Dedup against anything already crawled for this order+asin.
    const dup = await prisma.amazonQueue.findFirst({
      where: { order_id: item.order_id, asin: item.asin },
    });
    if (dup) {
      skipped++;
      continue;
    }

    const product = await matchProduct(item.asin, item.jan_code);
    if (product) {
      log("info", `  自動加算: "${product.name}" +${item.quantity} (ASIN=${item.asin})`);
      await prisma.product.update({
        where: { id: product.id },
        data: { quantity: { increment: item.quantity } },
      });
      await prisma.transaction.create({
        data: {
          type: "add",
          product_id: product.id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          note: `Amazon自動取込 注文:${item.order_id}`,
        },
      });
      await prisma.amazonQueue.create({ data: queueData(item, "auto") });
      auto++;
    } else {
      log("info", `  取込待ち追加: "${item.product_name}" (ASIN=${item.asin})`);
      await prisma.amazonQueue.create({ data: queueData(item, "pending") });
      queued++;
    }
  }

  await setSetting(LAST_SYNC_KEY, maxDate.toISOString());
  log("info", `完了: fetched=${orders.length} auto=${auto} queued=${queued} skipped=${skipped}`);

  return { fetched: orders.length, auto, queued, skipped, last_sync: maxDate.toISOString() };
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
  jan_code?: string;
  category_id?: string;
  location_id?: string;
  supplier_id?: string;
  note?: string;
}

// パターンA「在庫管理する」: 商品マスタに新規登録 + 在庫加算。
export async function manageQueueItem(id: string, overrides: ManageOverrides) {
  const item = await prisma.amazonQueue.findUnique({ where: { id } });
  if (!item) throw new Error("取込データが見つかりません");

  const productId = newId();
  const photo = await downloadImage(productId, item.image_url);

  const product = await prisma.product.create({
    data: {
      id: productId,
      name: (overrides.name ?? item.product_name) || item.asin || "不明",
      jan_code: overrides.jan_code ?? item.jan_code,
      amazon_asin: item.asin,
      category_id: overrides.category_id ?? "",
      location_id: overrides.location_id ?? "",
      supplier_id: overrides.supplier_id ?? "",
      note: overrides.note ?? (item.maker ? `メーカー: ${item.maker}` : ""),
      photo,
      quantity: item.quantity,
    },
  });

  await prisma.transaction.create({
    data: {
      type: "add",
      product_id: product.id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      note: `Amazon取込(在庫管理) 注文:${item.order_id}`,
    },
  });

  await prisma.amazonQueue.update({ where: { id }, data: { status: "managed" } });
  return product;
}

// パターンB「在庫管理しない」: 無視リストに登録し、取込リストから削除。
export async function ignoreQueueItem(id: string): Promise<void> {
  const item = await prisma.amazonQueue.findUnique({ where: { id } });
  if (!item) throw new Error("取込データが見つかりません");

  if (item.asin) {
    await prisma.amazonIgnoredAsin.upsert({
      where: { asin: item.asin },
      update: {},
      create: { asin: item.asin },
    });
    // Drop any other pending rows for the same ASIN too.
    await prisma.amazonQueue.deleteMany({ where: { asin: item.asin, status: "pending" } });
  } else {
    await prisma.amazonQueue.delete({ where: { id } });
  }
}
