import { Router } from "express";
import { prisma } from "../db";

const router = Router();

type TxType = "add" | "use" | "adjust";

async function recordTx(
  type: TxType,
  product_id: string,
  quantity: number,
  extras: { unit_price?: number; supplier_id?: string; note?: string } = {}
): Promise<void> {
  await prisma.transaction.create({
    data: {
      type,
      product_id,
      quantity,
      unit_price: extras.unit_price ?? 0,
      supplier_id: extras.supplier_id ?? "",
      note: extras.note ?? "",
    },
  });
}

// Inventory list = products with their quantity column.
router.get("/inventory", async (_req, res) => {
  res.json(await prisma.product.findMany({ orderBy: { created_at: "asc" } }));
});

router.post("/inventory/add", async (req, res) => {
  const { product_id, note, supplier_id } = req.body;
  const qty = parseInt(req.body.quantity, 10);
  const unit_price = parseFloat(req.body.unit_price) || 0;
  // by_piece=true（既定・後方互換）: 数量を入り数で換算して加算（セット買い）
  // by_piece=false: 入力値をそのまま実数量として加算（バラ買い・使用後の登録など）
  const byPiece = req.body.by_piece !== false;
  if (!(qty > 0)) return res.status(400).json({ detail: "数量は1以上で指定してください" });
  try {
    const product = await prisma.product.findUnique({ where: { id: product_id } });
    if (!product) return res.status(404).json({ detail: "品目が見つかりません" });
    const pieceCount = product.piece_count || 1;
    const actualQty = byPiece ? qty * pieceCount : qty;
    const updated = await prisma.product.update({
      where: { id: product_id },
      data: { quantity: { increment: actualQty } },
    });
    const autoNote = byPiece && pieceCount > 1 ? `入り数換算: ${qty}×${pieceCount}=${actualQty}` : "";
    await recordTx("add", product_id, actualQty, {
      unit_price,
      supplier_id,
      note: note || autoNote,
    });
    res.json({ product_id, quantity: updated.quantity });
  } catch {
    res.status(404).json({ detail: "品目が見つかりません" });
  }
});

router.post("/inventory/use", async (req, res) => {
  const { product_id, note } = req.body;
  const qty = parseInt(req.body.quantity, 10);
  if (!(qty > 0)) return res.status(400).json({ detail: "数量は1以上で指定してください" });
  const product = await prisma.product.findUnique({ where: { id: product_id } });
  if (!product) return res.status(404).json({ detail: "品目が見つかりません" });
  if (product.quantity < qty) return res.status(400).json({ detail: `在庫不足 (現在: ${product.quantity})` });
  const updated = await prisma.product.update({
    where: { id: product_id },
    data: { quantity: { decrement: qty } },
  });
  await recordTx("use", product_id, -qty, { note });
  res.json({ product_id, quantity: updated.quantity });
});

router.post("/inventory/adjust", async (req, res) => {
  const { product_id, note } = req.body;
  const qty = parseInt(req.body.quantity, 10);
  if (!(qty >= 0)) return res.status(400).json({ detail: "在庫数は0以上で指定してください" });
  const product = await prisma.product.findUnique({ where: { id: product_id } });
  if (!product) return res.status(404).json({ detail: "品目が見つかりません" });
  const before = product.quantity;
  await prisma.product.update({ where: { id: product_id }, data: { quantity: qty } });
  await recordTx("adjust", product_id, qty - before, { note: note || `強制メンテ: ${before}→${qty}` });
  res.json({ product_id, quantity: qty });
});

router.get("/transactions", async (req, res) => {
  const product_id = req.query.product_id as string | undefined;
  res.json(
    await prisma.transaction.findMany({
      where: product_id ? { product_id } : undefined,
      orderBy: { date: "desc" },
    })
  );
});

export default router;
