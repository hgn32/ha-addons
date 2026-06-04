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
