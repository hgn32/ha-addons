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

export function getCronSchedule(): string {
  return (
    process.env.AMAZON_CRON?.trim() ||
    String(readHaOptions().amazon_cron ?? "").trim() ||
    "0 6 * * *"
  );
}
