import ErrorIcon from "@mui/icons-material/Error";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Chip from "@mui/material/Chip";

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

const STATUS_LABEL: Record<Exclude<StockStatusLevel, "ok">, string> = {
  warning: "残りわずか",
  error: "在庫不足",
};

function statusIcon(status: "warning" | "error") {
  return status === "error" ? <ErrorIcon /> : <WarningAmberIcon />;
}

// 警告/エラー時にカードへ付ける枠線スタイル（okは枠線なしのオブジェクト）。
// Card の sx にスプレッドして使う。
export function stockBorderSx(status: StockStatusLevel) {
  return status === "ok" ? null : { border: 2, borderColor: `${status}.main` };
}

// 状態ラベルのチップ。okのときは何も表示しない（ダッシュボード等で在庫数の近くに添える用途）。
export function StockStatusChip({ status }: { status: StockStatusLevel }) {
  if (status === "ok") return null;
  return (
    <Chip
      icon={statusIcon(status)}
      label={STATUS_LABEL[status]}
      color={status}
      size="small"
      variant="outlined"
      sx={{ mr: 0.5, mb: 0.5 }}
    />
  );
}

// 在庫数を常に表示するチップ。警告/エラー時は色とアイコンとラベルで状態を示す。
// 在庫数を別途大きく表示しない品目マスタ等で使う。
export function StockBadge({ status, quantity }: { status: StockStatusLevel; quantity: number }) {
  const flag = status !== "ok";
  return (
    <Chip
      icon={flag ? statusIcon(status) : undefined}
      label={flag ? `在庫 ${quantity}・${STATUS_LABEL[status]}` : `在庫 ${quantity}`}
      color={flag ? status : "default"}
      variant={flag ? "filled" : "outlined"}
      size="small"
      sx={{ mr: 0.5, mb: 0.5 }}
    />
  );
}
