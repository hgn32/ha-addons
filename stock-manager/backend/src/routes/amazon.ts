import { Router } from "express";
import { prisma } from "../db";
import { getCookie, getCronSchedule, getSetting, setSetting } from "../amazon/config";
import { clearLogs, getLogs } from "../amazon/logger";
import { ignoreQueueItem, manageQueueItem, runAmazonCrawl } from "../amazon/service";

const router = Router();

// --- Crawler: settings -----------------------------------------------------

router.get("/amazon/settings", async (_req, res) => {
  const cookie = await getCookie();
  res.json({
    cookie_set: Boolean(cookie),
    // 先頭80文字を表示（確認用）
    cookie_preview: cookie ? cookie.slice(0, 80) + (cookie.length > 80 ? "..." : "") : "",
    cookie_length: cookie.length,
    last_sync: await getSetting("amazon_last_sync"),
    cron: getCronSchedule(),
  });
});

router.post("/amazon/settings", async (req, res) => {
  const raw = String(req.body.cookie ?? "").trim();
  // cURLコマンドをそのまま貼った場合は -b '...' または -H 'Cookie: ...' から値を抽出する。
  const cookie = extractCookieFromInput(raw);
  await setSetting("amazon_cookie", cookie);
  res.json({ cookie_set: Boolean(cookie) });
});

function extractCookieFromInput(input: string): string {
  // -b 'value' : cURLのbashコピーはシングルクォートで囲む。
  // Cookieの値自体にダブルクォートが含まれるため ['"] で閉じると途中で切れてしまう。
  // シングルクォート → シングルクォートまで、ダブルクォート → ダブルクォートまでで個別に処理する。
  const bSingle = input.match(/(?:^|\s)-b\s+'([^']+)'/)?.[1];
  if (bSingle) return bSingle.trim();
  const bDouble = input.match(/(?:^|\s)-b\s+"([^"]+)"/)?.[1];
  if (bDouble) return bDouble.trim();
  // -H 'Cookie: value'
  const hSingle = input.match(/(?:^|\s)-H\s+'Cookie:\s*([^']+)'/i)?.[1];
  if (hSingle) return hSingle.trim();
  const hDouble = input.match(/(?:^|\s)-H\s+"Cookie:\s*([^"]+)"/i)?.[1];
  if (hDouble) return hDouble.trim();
  // そのまま（生Cookieとして扱う）
  return input;
}

// --- Logs ------------------------------------------------------------------

router.get("/amazon/logs", (_req, res) => {
  res.json(getLogs());
});

router.delete("/amazon/logs", (_req, res) => {
  clearLogs();
  res.status(204).end();
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

// キュー全リセット（重複dedup解除用）
router.delete("/amazon/queue", async (_req, res) => {
  await prisma.amazonQueue.deleteMany({});
  res.status(204).end();
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
