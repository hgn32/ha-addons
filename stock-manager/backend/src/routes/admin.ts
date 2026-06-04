import { Router } from "express";
import fs from "fs";
import path from "path";
import { prisma } from "../db";
import { IMAGES_DIR } from "../paths";

const router = Router();

// 全マスタデータ削除（緊急用）
// Product / Transaction / Category / Location / Supplier / AmazonQueue / AmazonIgnoredAsin を全削除。
// Setting（Cookie・last_sync等）は残す。
router.delete("/admin/all-data", async (_req, res) => {
  await prisma.transaction.deleteMany({});
  await prisma.amazonQueue.deleteMany({});
  await prisma.amazonIgnoredAsin.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.location.deleteMany({});
  await prisma.supplier.deleteMany({});

  // 画像ファイルも削除
  try {
    for (const f of fs.readdirSync(IMAGES_DIR)) {
      fs.unlinkSync(path.join(IMAGES_DIR, f));
    }
  } catch {
    // 無視
  }

  res.status(204).end();
});

export default router;
