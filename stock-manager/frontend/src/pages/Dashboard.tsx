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
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { api as apiObj, imageUrl } from "../api";
import { useStore } from "../store";
import { InventoryItem, Transaction } from "../types";
import type { Page } from "../App";

// --- 次回購入想定日の計算 ---
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
  return <Chip label={`次回購入: ${label}`} color={color} size="small" sx={{ mr: 0.5, mb: 0.5 }} />;
}

// --- 履歴ダイアログ ---
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
                      <Typography fontWeight={600} color={TX_COLOR[t.type] === "success" ? "success.main" : TX_COLOR[t.type] === "error" ? "error.main" : "text.secondary"}>
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

type SortKey = "stock_asc" | "stock_desc" | "name_asc" | "next_purchase";

// --- Dashboard ---
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Dashboard({ onNavigate: _onNavigate }: { onNavigate: (p: Page) => void }) {
  const { inventory, transactions, categories, categoryName } = useStore();
  const [dialogItem, setDialogItem] = useState<InventoryItem | null>(null);
  const [dialogMode, setDialogMode] = useState<"add" | "use">("add");
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [filterCategory, setFilterCategory] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("stock_asc");

  const nextPurchaseMap = useMemo(() => {
    const m = new Map<string, Date | null>();
    for (const item of inventory) {
      m.set(item.id, estimateNextPurchase(item.id, item.quantity, transactions));
    }
    return m;
  }, [inventory, transactions]);

  const displayed = useMemo(() => {
    let list = filterCategory
      ? inventory.filter((i) => i.category_id === filterCategory)
      : [...inventory];

    list.sort((a, b) => {
      if (sortKey === "stock_asc") return a.quantity - b.quantity;
      if (sortKey === "stock_desc") return b.quantity - a.quantity;
      if (sortKey === "name_asc") return a.name.localeCompare(b.name, "ja");
      // next_purchase: 期限切れ→近い順、未推定は末尾
      const da = nextPurchaseMap.get(a.id);
      const db = nextPurchaseMap.get(b.id);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });
    return list;
  }, [inventory, filterCategory, sortKey, nextPurchaseMap]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={2} sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>ダッシュボード</Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ ml: "auto" }}>
          <TextField
            select label="カテゴリ" size="small" sx={{ minWidth: 160 }}
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <MenuItem value="">すべて</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select label="並び替え" size="small" sx={{ minWidth: 160 }}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <MenuItem value="stock_asc">在庫 少ない順</MenuItem>
            <MenuItem value="stock_desc">在庫 多い順</MenuItem>
            <MenuItem value="name_asc">名前順</MenuItem>
            <MenuItem value="next_purchase">購入予定日順</MenuItem>
          </TextField>
        </Stack>
      </Stack>

      {displayed.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 6, textAlign: "center" }}>
          {inventory.length === 0 ? "品目がありません" : "該当する品目がありません"}
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {displayed.map((item) => {
            const next = nextPurchaseMap.get(item.id) ?? null;
            const low = item.quantity <= 1;
            return (
              <Grid key={item.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                  <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 2 } }}>
                    <Stack direction="row" spacing={2} sx={{ flexGrow: 1 }}>
                      <Avatar src={item.photo ? imageUrl(item.photo) : undefined} variant="rounded" sx={{ width: 64, height: 64, flexShrink: 0 }}>📦</Avatar>
                      <Box sx={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column" }}>
                        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                          <Typography fontWeight={600} noWrap sx={{ flexGrow: 1, mr: 1 }}>{item.name}</Typography>
                          <Typography fontWeight={700} color={low ? "error.main" : "text.primary"} sx={{ flexShrink: 0 }}>
                            {item.quantity}
                          </Typography>
                        </Stack>
                        <Box sx={{ mt: 0.5, mb: 0.5, flexGrow: 1 }}>
                          {item.volume && (
                            <Chip label={item.volume} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
                          )}
                          {categoryName(item.category_id) && (
                            <Chip label={categoryName(item.category_id)} size="small" color="primary" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
                          )}
                          {next && <NextPurchaseChip date={next} />}
                        </Box>
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <IconButton size="small" onClick={() => setHistoryItem(item)}>
                            <HistoryIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" color="success" onClick={() => { setDialogItem(item); setDialogMode("add"); }}>
                            <AddIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => { setDialogItem(item); setDialogMode("use"); }}>
                            <RemoveIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <QuickStockDialog item={dialogItem} mode={dialogMode} onClose={() => setDialogItem(null)} />
      <HistoryDialog item={historyItem} onClose={() => setHistoryItem(null)} />
    </Box>
  );
}
