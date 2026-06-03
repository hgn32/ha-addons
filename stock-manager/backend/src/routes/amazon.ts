import { parse } from "csv-parse/sync";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

// Amazon order report column mappings (Japanese / English headers).
const COLUMNS_JP: Record<string, string> = {
  注文日: "order_date",
  注文番号: "order_id",
  商品名: "title",
  "ASIN/ISBN": "asin",
  数量: "quantity",
  単価: "unit_price",
};
const COLUMNS_EN: Record<string, string> = {
  "Order Date": "order_date",
  "Order ID": "order_id",
  Title: "title",
  "ASIN/ISBN": "asin",
  Quantity: "quantity",
  "Unit Price": "unit_price",
};

interface ImportResult {
  status: "added" | "created";
  product_id: string;
  name: string;
  qty: number;
}

router.post("/import/amazon", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ detail: "ファイルがありません" });

  let content = req.file.buffer.toString("utf-8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // strip BOM

  let records: Record<string, string>[];
  try {
    records = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true });
  } catch {
    return res.status(400).json({ detail: "CSVを解析できませんでした" });
  }
  if (records.length === 0) return res.status(400).json({ detail: "データがありません" });

  const headers = Object.keys(records[0]);
  const colMap = headers.includes("注文日") || headers.includes("商品名") ? COLUMNS_JP : COLUMNS_EN;

  const results: ImportResult[] = [];

  for (const row of records) {
    const m: Record<string, string> = {};
    for (const [src, dst] of Object.entries(colMap)) m[dst] = (row[src] ?? "").trim();

    const title = m.title;
    if (!title) continue;
    const asin = m.asin || "";
    let qty = parseInt(m.quantity || "1", 10);
    if (Number.isNaN(qty)) qty = 1;
    let price = parseFloat((m.unit_price || "0").replace(/[¥$,]/g, "").trim());
    if (Number.isNaN(price)) price = 0;

    const existing = asin ? await prisma.product.findFirst({ where: { amazon_asin: asin } }) : null;

    let productId: string;
    let name: string;
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data: { quantity: { increment: qty } } });
      productId = existing.id;
      name = existing.name;
    } else {
      const created = await prisma.product.create({
        data: {
          name: title || asin || "不明",
          amazon_asin: asin,
          note: `Amazonから自動作成 (${m.order_date || ""})`,
          quantity: qty,
        },
      });
      productId = created.id;
      name = created.name;
    }

    await prisma.transaction.create({
      data: {
        type: "add",
        product_id: productId,
        quantity: qty,
        unit_price: price,
        note: `Amazon購入履歴 注文:${m.order_id || ""}`,
      },
    });
    results.push({ status: existing ? "added" : "created", product_id: productId, name, qty });
  }

  res.json({ imported: results.length, results });
});

export default router;
