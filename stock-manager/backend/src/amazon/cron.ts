import cron from "node-cron";
import { getCookie, getCronSchedule } from "./config";
import { runAmazonCrawl } from "./service";
import { notifyHA } from "./notify";

// Schedule the periodic differential crawl (default 毎日 6:00 JST).
export function startAmazonCron(): void {
  const schedule = getCronSchedule();
  if (!cron.validate(schedule)) {
    console.warn(`[amazon] invalid cron schedule "${schedule}", scheduler disabled`);
    return;
  }

  cron.schedule(
    schedule,
    async () => {
      try {
        const cookie = await getCookie();
        if (!cookie) {
          console.log("[amazon] skip scheduled crawl: cookie not configured");
          return;
        }
        console.log("[amazon] scheduled crawl start");
        const summary = await runAmazonCrawl();
        console.log(
          `[amazon] crawl done: fetched=${summary.fetched} auto=${summary.auto} queued=${summary.queued} skipped=${summary.skipped}`
        );
        if (summary.auto > 0 || summary.queued > 0) {
          const lines: string[] = [];
          if (summary.auto > 0) lines.push(`・自動追加: ${summary.auto}件`);
          if (summary.queued > 0) lines.push(`・確認待ち: ${summary.queued}件`);
          await notifyHA("Stock Manager: Amazon取込完了", lines.join("\n"));
        }
      } catch (e) {
        // Cookie切れ等はログを出して処理を中断（次回スケジュールで再試行）。
        console.error(`[amazon] scheduled crawl failed: ${(e as Error).message}`);
      }
    },
    { timezone: "Asia/Tokyo" }
  );

  console.log(`[amazon] cron scheduled: ${schedule} (Asia/Tokyo)`);
}
