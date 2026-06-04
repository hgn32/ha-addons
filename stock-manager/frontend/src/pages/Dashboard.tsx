import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Avatar,
  Box,
  Button,
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
import { imageUrl } from "../api";
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

  // 平均購入インターバル（ミリ秒）
  let totalInterval = 0;
  let totalQty = 0;
  for (let i = 1; i < adds.length; i++) {
    totalInterval += adds[i].date.getTime() - adds[i - 1].date.getTime();
    totalQty += adds[i - 1].qty;
  }
  const avgIntervalMs = totalInterval / (adds.length - 1);
  const avgQtyPerPurchase = totalQty / (adds.length - 1) || 1;

  // 最終購入日 + (現在在庫 / 平均消費量) * 平均インターバル
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

// --- クイック在庫操作ダイアログ ---
interface QuickStockDialogProps {
  item: InventoryItem | null;
  mode: "add" | "use";
  onClose: () => void;
}

function QuickStockDialog({ item, mode, onClose }: QuickStockDialogProps) {
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
        <Typography variant="body2" color="text.secondary">
          現在の在庫: {item?.quantity ?? 0}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          type="number"
          label="数量"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          slotProps={{ htmlInput: { min: 1 } }}
          fullWidth
          sx={{ mt: 1 }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button
          variant="contained"
          color={mode === "add" ? "success" : "error"}
          disabled={busy}
          onClick={submit}
        >
          {mode === "add" ? "追加" : "消費"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Hook to get `api` object from the api module (avoids circular dep with store).
import { api as apiObj } from "../api";
function useStoreApi() {
  return { api: apiObj };
}

// --- Dashboard ---
export default function Dashboard({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { inventory, transactions, categoryName } = useStore();
  const [dialogItem, setDialogItem] = useState<InventoryItem | null>(null);
  const [dialogMode, setDialogMode] = useState<"add" | "use">("add");

  const sorted = useMemo(
    () => [...inventory].sort((a, b) => a.quantity - b.quantity),
    [inventory]
  );

  const openDialog = (item: InventoryItem, mode: "add" | "use") => {
    setDialogItem(item);
    setDialogMode(mode);
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        ダッシュボード
      </Typography>

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
                        <Avatar
                          src={item.photo ? imageUrl(item.photo) : undefined}
                          variant="rounded"
                          sx={{ width: 40, height: 40 }}
                        >
                          📦
                        </Avatar>
                        <Typography variant="body2" fontWeight={600}>
                          {item.name}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {categoryName(item.category_id)}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography
                        fontWeight={700}
                        color={low ? "error.main" : "text.primary"}
                      >
                        {item.quantity}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {next ? <NextPurchaseChip date={next} /> : null}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          startIcon={<AddIcon />}
                          onClick={() => openDialog(item, "add")}
                        >
                          追加
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          startIcon={<RemoveIcon />}
                          onClick={() => openDialog(item, "use")}
                        >
                          消費
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6, color: "text.secondary" }}>
                    品目がありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <QuickStockDialog
        item={dialogItem}
        mode={dialogMode}
        onClose={() => setDialogItem(null)}
      />
    </Box>
  );
}
