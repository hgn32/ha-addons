import { log } from "./logger";
import { isNotifyEnabled } from "./config";

export interface NotifyResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  detail?: string;
  service?: string;
}

// HA Core API経由でネイティブ通知を送る。
// SUPERVISOR_TOKEN は HA がコンテナに自動注入する。
// http://supervisor/core/api プロキシを使うため、config.json で
// homeassistant_api: true が必要（無いと 401 Unauthorized になる）。
// 戻り値で成否を返すので、通知テストボタン等から結果を表示できる。
export async function notifyHA(title: string, message: string): Promise<NotifyResult> {
  if (!isNotifyEnabled()) {
    return { ok: true, skipped: true, detail: "通知が無効です" };
  }

  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    log("warn", "SUPERVISOR_TOKEN未設定 — HA通知をスキップ");
    return { ok: false, skipped: true, detail: "SUPERVISOR_TOKENが未設定です（Home Assistant外で実行中の可能性があります）" };
  }

  const service = "persistent_notification";
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
      const detail = await res.text();
      log("warn", `HA通知失敗 (${res.status}): ${detail}`);
      return { ok: false, status: res.status, detail, service };
    }
    log("info", `HA通知送信: [${service}] ${title}`);
    return { ok: true, status: res.status, service };
  } catch (e) {
    const detail = (e as Error).message;
    log("warn", `HA通知エラー: ${detail}`);
    return { ok: false, detail, service };
  }
}
