import { Router } from "express";
import { prisma } from "../db";
import { getCookie, getCronSchedule, getSetting, setSetting } from "../amazon/config";
import { ignoreQueueItem, manageQueueItem, runAmazonCrawl } from "../amazon/service";

const router = Router();

// --- Crawler: settings -----------------------------------------------------

router.get("/amazon/settings", async (_req, res) => {
  const cookie = await getCookie();
  res.json({
    cookie_set: Boolean(cookie),
    last_sync: await getSetting("amazon_last_sync"),
    cron: getCronSchedule(),
  });
});

router.post("/amazon/settings", async (req, res) => {
  const cookie = String(req.body.cookie ?? "").trim();
  await setSetting("amazon_cookie", cookie);
  res.json({ cookie_set: Boolean(cookie) });
});

// --- Crawler: run + queue --------------------------------------------------

router.post("/amazon/crawl", async (_req, res) => {
  try {
    const summary = await runAmazonCrawl();
    res.json(summary);
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

router.get("/amazon/queue", async (req, res) => {
  const status = (req.query.status as string) || "pending";
  res.json(
    await prisma.amazonQueue.findMany({
      where: status === "all" ? undefined : { status },
      orderBy: { purchased_at: "desc" },
    })
  );
});

// パターンA: 在庫管理する（商品マスタ登録 + 在庫加算）
router.post("/amazon/queue/:id/manage", async (req, res) => {
  try {
    const product = await manageQueueItem(req.params.id as string, req.body ?? {});
    res.json(product);
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

// パターンB: 在庫管理しない（無視リスト登録 + 取込リストから削除）
router.post("/amazon/queue/:id/ignore", async (req, res) => {
  try {
    await ignoreQueueItem(req.params.id as string);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ detail: (e as Error).message });
  }
});

export default router;
