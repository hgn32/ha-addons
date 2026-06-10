// 在庫の警告状態。
//  - "error"   : 在庫が警告数量を下回っている（要補充）
//  - "warning" : 在庫が警告数量ちょうど（残りわずか）
//  - "ok"      : 在庫が警告数量を上回っている
export type StockStatusLevel = "ok" | "warning" | "error";

// 在庫数と品目ごとの警告数量から状態を判定する。
export function getStockStatus(quantity: number, warnQuantity: number): StockStatusLevel {
  const warn = Number.isFinite(warnQuantity) ? warnQuantity : 1;
  if (quantity < warn) return "error";
  if (quantity === warn) return "warning";
  return "ok";
}

// 警告/エラー時にカードへ付ける枠線スタイル（okは枠線なしのオブジェクト）。
// Card の sx にスプレッドして使う。
export function stockBorderSx(status: StockStatusLevel) {
  return status === "ok" ? null : { border: 2, borderColor: `${status}.main` };
}

// 在庫数テキストの表示色（状態を色で示す）。
export function stockColor(status: StockStatusLevel): string {
  return status === "error" ? "error.main" : status === "warning" ? "warning.main" : "text.primary";
}
