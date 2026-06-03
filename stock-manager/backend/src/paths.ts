import crypto from "crypto";
import fs from "fs";
import path from "path";

export const DATA_DIR = process.env.DATA_DIR || "/config/stock_manager_3a30c8ec";
export const IMAGES_DIR = path.join(DATA_DIR, "images");

export function ensureDirs(): void {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

export function newId(): string {
  return crypto.randomUUID();
}
