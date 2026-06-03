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
  const prefix = `[amazon][${level.toUpperCase()}]`;
  if (level === "error") console.error(prefix, msg);
  else console.log(prefix, msg);
}

export function getLogs(): LogEntry[] {
  return [...entries].reverse(); // 新しい順
}

export function clearLogs(): void {
  entries.length = 0;
}
