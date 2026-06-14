import fs from "fs";
import { prisma } from "../db";

// Home Assistant writes addon options to /data/options.json. Read once.
let haOptions: Record<string, unknown> | null = null;
function readHaOptions(): Record<string, unknown> {
  if (haOptions) return haOptions;
  try {
    haOptions = JSON.parse(fs.readFileSync("/data/options.json", "utf-8"));
  } catch {
    haOptions = {};
  }
  return haOptions!;
}

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? "";
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

// Cookie precedence: env var > HA addon option > value saved via UI (DB).
export async function getCookie(): Promise<string> {
  const env = process.env.AMAZON_COOKIE?.trim();
  if (env) return env;
  const opt = String(readHaOptions().amazon_cookie ?? "").trim();
  if (opt) return opt;
  return (await getSetting("amazon_cookie")).trim();
}

// cURLから抽出した全ヘッダー（保存済みの場合）を返す。なければ空オブジェクト。
export async function getCurlHeaders(): Promise<Record<string, string>> {
  const raw = (await getSetting("amazon_curl_headers")).trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function getCronSchedule(): string {
  return (
    process.env.AMAZON_CRON?.trim() ||
    String(readHaOptions().amazon_cron ?? "").trim() ||
    "0 18 * * *"
  );
}

// 通知先サービス名。優先順位: 環境変数 > HAアドオンオプション > persistent_notification。
// notify.<service> として呼ばれる（例: persistent_notification, mobile_app_xxx）。
export function getNotifyService(): string {
  return (
    process.env.NOTIFY_SERVICE?.trim() ||
    String(readHaOptions().notify_service ?? "").trim() ||
    "persistent_notification"
  );
}
