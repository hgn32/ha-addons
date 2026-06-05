import { Prisma } from "@prisma/client";
import { Router } from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { prisma } from "../db";
import { IMAGES_DIR, newId } from "../paths";

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

const EDITABLE: string[] = [
  "name",
  "volume",
  "piece_count",
  "maker",
  "jan_code",
  "amazon_asin",
  "amazon_url",
  "category_id",
  "location_id",
  "note",
];

function savePhoto(id: string, file: Express.Multer.File): string {
  const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
  const filename = `${id}${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, filename), file.buffer);
  return filename;
}

function removePhoto(filename: string): void {
  if (!filename) return;
  const p = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

router.get("/products", async (_req, res) => {
  res.json(await prisma.product.findMany({ orderBy: [{ sort_order: "asc" }, { created_at: "asc" }] }));
});

// バーコード(JANコード)で品目を検索。簡単棚卸し画面のスキャンから利用する。
// 主JANコード → 追加バーコード(ProductBarcode) の順でフォールバックする。
router.get("/products/by-barcode/:code", async (req, res) => {
  const code = String(req.params.code ?? "").trim();
  if (!code) return res.status(400).json({ detail: "コードが空です" });
  let product = await prisma.product.findFirst({ where: { jan_code: code } });
  if (!product) {
    const bc = await prisma.productBarcode.findUnique({ where: { code }, include: { product: true } });
    product = bc?.product ?? null;
  }
  if (!product) return res.status(404).json({ detail: "該当する品目がありません" });
  res.json(product);
});

// スキャンしたバーコードを既存品目に紐づける（簡単棚卸しで未登録コードを検出した時に使用）。
// 主JANが空ならそこに、埋まっていれば追加バーコードとして登録し（既存JANは上書きしない）。
router.post("/products/:id/barcodes", async (req, res) => {
  const code = String(req.body.code ?? "").trim();
  if (!code) return res.status(400).json({ detail: "コードが空です" });
  const product = await prisma.product.findUnique({ where: { id: req.params.id as string } });
  if (!product) return res.status(404).json({ detail: "品目が見つかりません" });

  // 同じコードが他品目で使われていないか確認（主JAN / 追加バーコード）
  const ownerByJan = await prisma.product.findFirst({ where: { jan_code: code } });
  const ownerByBarcode = await prisma.productBarcode.findUnique({ where: { code }, include: { product: true } });
  if ((ownerByJan && ownerByJan.id !== product.id) || (ownerByBarcode && ownerByBarcode.product_id !== product.id)) {
    const name = ownerByJan && ownerByJan.id !== product.id ? ownerByJan.name : ownerByBarcode!.product.name;
    return res.status(409).json({ detail: `このバーコードは既に「${name}」に登録されています` });
  }

  // すでにこの品目に紐づいている場合は何もしない
  if (product.jan_code === code || (ownerByBarcode && ownerByBarcode.product_id === product.id)) {
    return res.json(product);
  }

  if (!product.jan_code) {
    const updated = await prisma.product.update({ where: { id: product.id }, data: { jan_code: code } });
    return res.json(updated);
  }
  await prisma.productBarcode.create({ data: { product_id: product.id, code } });
  res.json(product);
});

router.put("/products/reorder", async (req, res) => {
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids)) return res.status(400).json({ detail: "ids must be array" });
  await Promise.all(
    ids.map((id, index) => prisma.product.update({ where: { id }, data: { sort_order: index } }))
  );
  res.status(204).end();
});

function coerce(field: string, value: string): string | number {
  if (field === "piece_count") return Math.max(1, parseInt(value, 10) || 1);
  return value;
}

router.post("/products", upload.single("photo"), async (req, res) => {
  const id = newId();
  const count = await prisma.product.count();
  const data: Record<string, unknown> = { id, name: req.body.name ?? "", sort_order: count };
  for (const f of EDITABLE) data[f] = coerce(f, req.body[f] ?? "");
  if (req.file) data.photo = savePhoto(id, req.file);
  res.status(201).json(await prisma.product.create({ data: data as Prisma.ProductUncheckedCreateInput }));
});

router.put("/products/:id", upload.single("photo"), async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id as string } });
  if (!existing) return res.status(404).json({ detail: "Not found" });

  const data: Record<string, unknown> = {};
  for (const f of EDITABLE) {
    if (req.body[f] !== undefined) data[f] = coerce(f, req.body[f]);
  }
  if (req.file) {
    removePhoto(existing.photo);
    data.photo = savePhoto(existing.id, req.file);
  }
  res.json(await prisma.product.update({ where: { id: req.params.id as string }, data: data as Prisma.ProductUncheckedUpdateInput }));
});

router.delete("/products/:id", async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id as string } });
  if (!existing) return res.status(404).json({ detail: "Not found" });
  removePhoto(existing.photo);
  await prisma.product.delete({ where: { id: req.params.id as string } });
  res.status(204).end();
});

export default router;
