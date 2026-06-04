import AddIcon from "@mui/icons-material/Add";
import HistoryIcon from "@mui/icons-material/History";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { api as apiObj, imageUrl } from "../api";
import { useStore } from "../store";
import { InventoryItem, Transaction } from "../types";
import type { Page } from "../App";

// --- 次回購入想定日の計算 ---
// 同品目の「add」トランザクションが2件以上あれば、購入インターバルの平均から推定する。
function estimateNextPurchase(productId: string, stock: number, txs: Transaction[]): Date | null {
  const adds = txs
    .filter((t) => t.product_id === productId && t.type === "add" && t.quantity > 0)
    .map((t) => ({ date: new Date(t.date), qty: t.quantity }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (adds.length < 2) return null;

  let totalInterval = 0;
  let totalQty = 0;
  for (let i = 1; i < adds.length; i++) {
    totalInterval += adds[i].date.getTime() - adds[i - 1].date.getTime();
    totalQty += adds[i - 1].qty;
  }
  const avgIntervalMs = totalInterval / (adds.length - 1);
  const avgQtyPerPurchase = totalQty / (adds.length - 1) || 1;

  const last = adds[adds.length - 1].date;
  const daysUntilEmpty = (stock / avgQtyPerPurchase) * (avgIntervalMs / 86400000);
  return new Date(last.getTime() + daysUntilEmpty * 86400000);
}

function NextPurchaseChip({ date }: { date: Date }) {
  const now = Date.now();
  const diff = Math.ceil((date.getTime() - now) / 86400000);
  const label =
    diff <= 0
      ? `切れ (${Math.abs(diff)}日超過)`
      : diff <= 7
      ? `残${diff}日`
      : date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
  const color = diff <= 0 ? "error" : diff <= 7 ? "warning" : "default";
  return <Chip label={`次回購入: ${label}`} color={color} size="small" />;
}

// --- 履歴ダイアログ ---
const TX_LABEL: Record<string, string> = { add: "入庫", use: "消費", adjust: "調整" };
const TX_COLOR: Record<string, "success" | "error" | "default"> = { add: "success", use: "error", adjust: "default" };

function HistoryDialog({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const { transactions, suppliers } = useStore();
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "";

  const txs = useMemo(
    () =>
      transactions
        .filter((t) => t.product_id === item?.id)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions, item]
  );

  return (
    <Dialog open={Boolean(item)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {item?.photo && (
            <Avatar src={imageUrl(item.photo)} variant="rounded" sx={{ width: 36, height: 36 }}>📦</Avatar>
          )}
          <Box>
            <Typography fontWeight={700}>{item?.name}</Typography>
            <Typography variant="caption" color="text.secondary">履歴 {txs.length}件</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {txs.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>履歴がありません</Typography>
        ) : (
          <Stack spacing={1}>
            {txs.map((t) => (
              <Card key={t.id} variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        label={TX_LABEL[t.type] ?? t.type}
                        color={TX_COLOR[t.type] ?? "default"}
                        size="small"
                      />
                      <Typography fontWeight={600}>
                        {t.type === "use" ? "-" : "+"}{t.quantity}
                      </Typography>
                      {t.supplier_id && (
                        <Typography variant="caption" color="text.secondary">
                          {supplierName(t.supplier_id)}
                        </Typography>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(t.date).toLocaleDateString("ja-JP")}
                    </Typography>
                  </Stack>
                  {t.note && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      {t.note}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </Dialog>
  );
}

// --- クイック在庫操作ダイアログ ---
function useStoreApi() { return { api: apiObj }; }

function QuickStockDialog({ item, mode, onClose }: { item: InventoryItem | null; mode: "add" | "use"; onClose: () => void }) {
  const { reloadInventory, reloadTransactions, toast } = useStore();
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const { api } = useStoreApi();

  const submit = async () => {
    if (!item) return;
    const n = parseInt(qty, 10);
    if (!(n > 0)) return toast("1以上の数量を入力してください", "error");
    setBusy(true);
    try {
      await api.post(`/api/inventory/${mode}`, { product_id: item.id, quantity: n });
      toast(mode === "add" ? `在庫を${n}追加しました` : `在庫を${n}消費しました`);
      await Promise.all([reloadInventory(), reloadTransactions()]);
      onClose();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(item)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {item?.name} — {mode === "add" ? "在庫追加" : "在庫消費"}
        <Typography variant="body2" color="text.secondary">現在の在庫: {item?.quantity ?? 0}</Typography>
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus type="number" label="数量" value={qty}
          onChange={(e) => setQty(e.target.value)}
          slotProps={{ htmlInput: { min: 1 } }}
          fullWidth sx={{ mt: 1 }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" color={mode === "add" ? "success" : "error"} disabled={busy} onClick={submit}>
          {mode === "add" ? "追加" : "消費"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- Dashboard ---
export default function Dashboard({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { inventory, transactions, categoryName } = useStore();
  const [dialogItem, setDialogItem] = useState<InventoryItem | null>(null);
  const [dialogMode, setDialogMode] = useState<"add" | "use">("add");
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);

  const sorted = useMemo(
    () => [...inventory].sort((a, b) => a.quantity - b.quantity),
    [inventory]
  );

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>ダッシュボード</Typography>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>品目</TableCell>
                <TableCell>カテゴリ</TableCell>
                <TableCell align="center">在庫数</TableCell>
                <TableCell>次回購入</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((item) => {
                const next = estimateNextPurchase(item.id, item.quantity, transactions);
                const low = item.quantity <= 1;
                return (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Avatar src={item.photo ? imageUrl(item.photo) : undefined} variant="rounded" sx={{ width: 40, height: 40 }}>📦</Avatar>
                        <Typography variant="body2" fontWeight={600}>{item.name}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">{categoryName(item.category_id)}</Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography fontWeight={700} color={low ? "error.main" : "text.primary"}>{item.quantity}</Typography>
                    </TableCell>
                    <TableCell>{next ? <NextPurchaseChip date={next} /> : null}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button size="small" variant="outlined" startIcon={<HistoryIcon />} onClick={() => setHistoryItem(item)}>
                          履歴
                        </Button>
                        <Button size="small" variant="outlined" color="success" startIcon={<AddIcon />} onClick={() => { setDialogItem(item); setDialogMode("add"); }}>
                          追加
                        </Button>
                        <Button size="small" variant="outlined" color="error" startIcon={<RemoveIcon />} onClick={() => { setDialogItem(item); setDialogMode("use"); }}>
                          消費
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6, color: "text.secondary" }}>品目がありません</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <QuickStockDialog item={dialogItem} mode={dialogMode} onClose={() => setDialogItem(null)} />
      <HistoryDialog item={historyItem} onClose={() => setHistoryItem(null)} />
    </Box>
  );
}
