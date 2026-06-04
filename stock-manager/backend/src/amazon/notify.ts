import { log } from "./logger";

// HA Supervisor API経由でネイティブ通知を送る。
// SUPERVISOR_TOKEN / SUPERVISOR_API は HA がコンテナに自動注入する。
export async function notifyHA(title: string, message: string): Promise<void> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    log("warn", "SUPERVISOR_TOKEN未設定 — HA通知をスキップ");
    return;
  }

  const service = process.env.NOTIFY_SERVICE || "persistent_notification";
  const baseUrl = process.env.SUPERVISOR_API || "http://supervisor/core";
  const url = `${baseUrl}/api/services/notify/${service}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, message }),
    });
    if (!res.ok) {
      log("warn", `HA通知失敗 (${res.status}): ${await res.text()}`);
    } else {
      log("info", `HA通知送信: [${service}] ${title}`);
    }
  } catch (e) {
    log("warn", `HA通知エラー: ${(e as Error).message}`);
  }
}
