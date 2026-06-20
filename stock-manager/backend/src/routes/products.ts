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
  "warn_quantity",
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
  const [products, locations] = await Promise.all([
    prisma.product.findMany(),
    prisma.location.findMany(),
  ]);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  products.sort((a, b) => {
    const locA = locationName.get(a.location_id) ?? "";
    const locB = locationName.get(b.location_id) ?? "";
    if (locA !== locB) return locA.localeCompare(locB, "ja");
    return a.name.localeCompare(b.name, "ja");
  });
  res.json(products);
});

// JANコード(JANコード)で品目を検索。棚卸画面のスキャンから利用する。
// 主JANコード → 追加JANコード(ProductBarcode) の順でフォールバックする。
router.get("/products/by-barcode/:code", async (req, res) => {
  const code = String(req.params.code ?? "").trim();
  if (!code) return res.status(400).json({ detail: "コードが空です" });
  // scanned_piece_count: スキャンしたコードに設定された員数（入庫時の換算に使う）。
  // 主jan_codeは基本単位(1個ずつ加算)として扱い、個別スキャン運用を維持する。
  // 追加JANコード(箱・ケース等)は、そのコードに設定された員数で換算する。
  let product = await prisma.product.findFirst({ where: { jan_code: code } });
  let scannedPieceCount = 1;
  if (!product) {
    const bc = await prisma.productBarcode.findUnique({ where: { code }, include: { product: true } });
    product = bc?.product ?? null;
    if (bc) scannedPieceCount = Math.max(1, bc.piece_count || 1);
  }
  if (!product) return res.status(404).json({ detail: "該当する品目がありません" });
  res.json({ ...product, scanned_code: code, scanned_piece_count: scannedPieceCount });
});

// 品目に紐づくJAN/JANコード一覧を取得（主jan_codeを除く追加分）。
router.get("/products/:id/barcodes", async (req, res) => {
  const rows = await prisma.productBarcode.findMany({
    where: { product_id: req.params.id as string },
    orderBy: { created_at: "asc" },
  });
  res.json(rows);
});

// スキャンしたJANコードを既存品目に紐づける。
// mode="additional" : 常に追加JANコードとして登録（品目編集のJANコードタブ用）。
// modeなし(既定) : 主JANが空なら主JANに、埋まっていれば追加JANコードに（棚卸の紐づけ用）。
// いずれも既存JANは上書きせず、他品目で使用中なら409。
router.post("/products/:id/barcodes", async (req, res) => {
  const code = String(req.body.code ?? "").trim();
  const mode = String(req.body.mode ?? "").trim();
  const pieceCount = req.body.piece_count != null ? Math.max(1, parseInt(req.body.piece_count, 10) || 1) : 1;
  if (!code) return res.status(400).json({ detail: "コードが空です" });
  const product = await prisma.product.findUnique({ where: { id: req.params.id as string } });
  if (!product) return res.status(404).json({ detail: "品目が見つかりません" });

  const ownerByJan = await prisma.product.findFirst({ where: { jan_code: code } });
  const ownerByBarcode = await prisma.productBarcode.findUnique({ where: { code }, include: { product: true } });
  if ((ownerByJan && ownerByJan.id !== product.id) || (ownerByBarcode && ownerByBarcode.product_id !== product.id)) {
    const name = ownerByJan && ownerByJan.id !== product.id ? ownerByJan.name : ownerByBarcode!.product.name;
    return res.status(409).json({ detail: `このJANコードは既に「${name}」に登録されています` });
  }

  // すでにこの品目に紐づいている場合は何もしない
  if (product.jan_code === code || (ownerByBarcode && ownerByBarcode.product_id === product.id)) {
    return res.json(product);
  }

  // 主JANが空 かつ 既定モードのときだけ主JANに設定する。
  if (!product.jan_code && mode !== "additional") {
    const updated = await prisma.product.update({ where: { id: product.id }, data: { jan_code: code } });
    return res.json(updated);
  }
  const row = await prisma.productBarcode.create({ data: { product_id: product.id, code, piece_count: pieceCount } });
  res.status(201).json(row);
});

// 追加JANコードの員数を更新
router.patch("/products/barcodes/:barcodeId", async (req, res) => {
  const pieceCount = Math.max(1, parseInt(req.body.piece_count, 10) || 1);
  try {
    const row = await prisma.productBarcode.update({
      where: { id: req.params.barcodeId as string },
      data: { piece_count: pieceCount },
    });
    res.json(row);
  } catch {
    res.status(404).json({ detail: "Not found" });
  }
});

// 追加JANコードを削除
router.delete("/products/barcodes/:barcodeId", async (req, res) => {
  try {
    await prisma.productBarcode.delete({ where: { id: req.params.barcodeId as string } });
    res.status(204).end();
  } catch {
    res.status(404).json({ detail: "Not found" });
  }
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
  // 警告しきい値: 0以上の整数。未入力/不正値は既定の1にフォールバックする。
  if (field === "warn_quantity") {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? 1 : Math.max(0, n);
  }
  return String(value ?? "").trim();
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
