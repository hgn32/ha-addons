export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
}

// インメモリの直近ログ（最大500件）
const MAX = 500;
const entries: LogEntry[] = [];

export function log(level: LogLevel, msg: string): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();
  // コンソール出力にも時刻(JST)を付与して、HAのアドオンログから時系列を追えるようにする
  const time = new Date(entry.ts).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
  const prefix = `[${time}][amazon][${level.toUpperCase()}]`;
  if (level === "error") console.error(prefix, msg);
  else console.log(prefix, msg);
}

export function getLogs(): LogEntry[] {
  return [...entries].reverse(); // 新しい順
}

export function clearLogs(): void {
  entries.length = 0;
}
