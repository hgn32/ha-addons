import AddIcon from "@mui/icons-material/Add";
import HistoryIcon from "@mui/icons-material/History";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RemoveIcon from "@mui/icons-material/Remove";
import TuneIcon from "@mui/icons-material/Tune";
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
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { api as apiObj, imageUrl } from "../api";
import { useIsMobile } from "../hooks";
import { useStore } from "../store";
import { InventoryItem } from "../types";
import type { Page } from "../App";
import { getStockStatus, stockBorderSx, stockColor } from "../components/StockStatus";

// --- 履歴ダイアログ ---
const TX_COLOR: Record<string, "success" | "error" | "default"> = { add: "success", use: "error", adjust: "default" };

function HistoryDialog({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const { transactions, suppliers, stockOf, reloadInventory, reloadTransactions, toast } = useStore();
  const fullScreen = useIsMobile();
  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "";

  const currentStock = item ? stockOf(item.id) : 0;
  const [adjustQty, setAdjustQty] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  // ダイアログを開く / 在庫が変わるたびに、入力欄を現在在庫で初期化
  useEffect(() => {
    setAdjustQty(item ? String(currentStock) : "");
  }, [item, currentStock]);

  const txs = useMemo(
    () =>
      transactions
        .filter((t) => t.product_id === item?.id)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [transactions, item]
  );

  const submitAdjust = async () => {
    if (!item) return;
    const n = parseInt(adjustQty, 10);
    if (!(n >= 0)) return toast("0以上の在庫数を入力してください", "error");
    setAdjusting(true);
    try {
      await apiObj.post("/api/inventory/adjust", { product_id: item.id, quantity: n });
      toast(`在庫を ${currentStock} → ${n} に調整しました`);
      await Promise.all([reloadInventory(), reloadTransactions()]);
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <Dialog open={Boolean(item)} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          {item?.photo && (
            <Avatar src={imageUrl(item.photo)} variant="rounded" sx={{ width: 36, height: 36 }} slotProps={{ img: { style: { objectFit: "contain" } } }}>📦</Avatar>
          )}
          <Box>
            <Typography sx={{ fontWeight: 700 }}>{item?.name}</Typography>
            <Typography variant="caption" color="text.secondary">履歴 {txs.length}件</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {/* 強制メンテ（棚卸）: 履歴は書き換えず、指定した数量に合わせる調整を1件登録する */}
        <Box sx={{ mb: 2, p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
            <TuneIcon fontSize="small" color="warning" />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>強制メンテ</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            現在の在庫数を入力すると、その数に合わせる調整履歴が登録されます（現在: {currentStock}）。
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
            <TextField
              type="number"
              label="実在庫数"
              size="small"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              slotProps={{ htmlInput: { min: 0 } }}
              sx={{ width: 140 }}
              onKeyDown={(e) => e.key === "Enter" && submitAdjust()}
            />
            <Button
              variant="contained"
              color="warning"
              disabled={adjusting || adjustQty === "" || parseInt(adjustQty, 10) === currentStock}
              onClick={submitAdjust}
              sx={{ whiteSpace: "nowrap" }}
            >
              この数に調整
            </Button>
          </Stack>
        </Box>
        <Divider sx={{ mb: 2 }} />
        {txs.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>履歴がありません</Typography>
        ) : (
          <Stack spacing={1}>
            {txs.map((t) => (
              <Card key={t.id} variant="outlined">
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                      <Chip
                        label={{ add: "購入", use: "消費", adjust: "調整" }[t.type] ?? t.type}
                        color={TX_COLOR[t.type] as "success" | "error" | "default"}
                        size="small"
                      />
                      <Typography color={TX_COLOR[t.type] === "success" ? "success.main" : TX_COLOR[t.type] === "error" ? "error.main" : "text.secondary"} sx={{ fontWeight: 700 }}>
                        {t.type === "use" ? `-${t.quantity}` : `+${t.quantity}`}
                      </Typography>
                      {t.supplier_id && (
                        <Typography variant="caption" color="text.secondary">{supplierName(t.supplier_id)}</Typography>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                      {new Date(t.date).toLocaleDateString("ja-JP")}
                    </Typography>
                  </Stack>
                  {t.note && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, pl: 0.5 }}>
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
  const fullScreen = useIsMobile();
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  // 在庫追加時の数量の解釈: true=員数で換算 / false=実数量をそのまま加算
  const [byPiece, setByPiece] = useState(true);
  const { api } = useStoreApi();

  useEffect(() => {
    if (item) {
      setQty("1");
      setByPiece(true);
    }
  }, [item]);

  const pieceCount = item?.piece_count ?? 1;
  const usePieceConv = mode === "add" && byPiece && pieceCount > 1;

  const submit = async () => {
    if (!item) return;
    const n = parseInt(qty, 10);
    if (!(n > 0)) return toast("1以上の数量を入力してください", "error");
    setBusy(true);
    try {
      await api.post(`/api/inventory/${mode}`, {
        product_id: item.id,
        quantity: n,
        by_piece: mode === "add" ? byPiece : undefined,
      });
      const actual = usePieceConv ? n * pieceCount : n;
      toast(
        mode === "add"
          ? `在庫を${actual}追加しました${usePieceConv ? ` (${n}×${pieceCount})` : ""}`
          : `在庫を${actual}消費しました`
      );
      await Promise.all([reloadInventory(), reloadTransactions()]);
      onClose();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    } finally {
      setBusy(false);
    }
  };

  const qtyNum = parseInt(qty, 10);
  const actualAdd = usePieceConv && qtyNum > 0 ? qtyNum * pieceCount : null;
  const showPieceToggle = mode === "add" && pieceCount > 1;

  return (
    <Dialog open={Boolean(item)} onClose={onClose} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <DialogTitle>
        {item?.name} — {mode === "add" ? "在庫追加" : "在庫消費"}
        <Typography variant="body2" color="text.secondary">現在の在庫: {item?.quantity ?? 0}</Typography>
      </DialogTitle>
      <DialogContent>
        {showPieceToggle && (
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            color="success"
            value={byPiece ? "piece" : "actual"}
            onChange={(_, v) => v && setByPiece(v === "piece")}
            sx={{ mt: 1 }}
          >
            <ToggleButton value="piece">員数（×{pieceCount}）</ToggleButton>
            <ToggleButton value="actual">実数量</ToggleButton>
          </ToggleButtonGroup>
        )}
        <TextField
          autoFocus type="number"
          label={mode === "add" ? (usePieceConv ? "購員数量（箱・パック数）" : "実数量（個数）") : "数量"}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          slotProps={{ htmlInput: { min: 1 } }}
          fullWidth sx={{ mt: showPieceToggle ? 2 : 1 }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {actualAdd && (
          <Typography variant="body2" color="success.main" sx={{ mt: 1, fontWeight: 600 }}>
            {qtyNum} × 員数{pieceCount} = <strong>{actualAdd}個</strong> 追加
          </Typography>
        )}
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

type SortKey = "alert" | "stock_asc" | "stock_desc" | "name_asc";

// --- Dashboard ---
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Dashboard({ onNavigate: _onNavigate }: { onNavigate: (p: Page) => void }) {
  const { inventory, categories, categoryName } = useStore();
  const [dialogItem, setDialogItem] = useState<InventoryItem | null>(null);
  const [dialogMode, setDialogMode] = useState<"add" | "use">("add");
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [filterCategory, setFilterCategory] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("alert");

  const displayed = useMemo(() => {
    let list = filterCategory
      ? inventory.filter((i) => i.category_id === filterCategory)
      : [...inventory];

    // アラート順: エラー → 警告 → 通常 の順。同じ状態内は在庫が少ない順。
    const alertRank = (i: InventoryItem) => {
      const s = getStockStatus(i.quantity, i.warn_quantity);
      return s === "error" ? 0 : s === "warning" ? 1 : 2;
    };
    list.sort((a, b) => {
      if (sortKey === "alert") {
        const r = alertRank(a) - alertRank(b);
        if (r !== 0) return r;
        if (a.quantity !== b.quantity) return a.quantity - b.quantity;
        return a.name.localeCompare(b.name, "ja");
      }
      if (sortKey === "stock_asc") return a.quantity - b.quantity;
      if (sortKey === "stock_desc") return b.quantity - a.quantity;
      return a.name.localeCompare(b.name, "ja");
    });
    return list;
  }, [inventory, filterCategory, sortKey]);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 2, mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>ダッシュボード</Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", ml: "auto" }}>
          <TextField
            select label="品目カテゴリ" size="small" sx={{ minWidth: 140, maxWidth: 200 }}
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <MenuItem value="">すべて</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select label="並び替え" size="small" sx={{ minWidth: 110, maxWidth: 140 }}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <MenuItem value="alert">アラート順</MenuItem>
            <MenuItem value="stock_asc">在庫 ▲</MenuItem>
            <MenuItem value="stock_desc">在庫 ▼</MenuItem>
            <MenuItem value="name_asc">名前順</MenuItem>
          </TextField>
        </Stack>
      </Stack>

      {displayed.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 6, textAlign: "center" }}>
          {inventory.length === 0 ? "品目がありません" : "該当する品目がありません"}
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)", lg: "repeat(4, 1fr)" },
            gap: 2,
          }}
        >
          {displayed.map((item) => {
            const status = getStockStatus(item.quantity, item.warn_quantity);
            return (
              <Card key={item.id} sx={{ height: "100%", display: "flex", flexDirection: "column", ...stockBorderSx(status) }}>
                  <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 2 } }}>
                    <Stack direction="row" spacing={2} sx={{ flexGrow: 1 }}>
                      <Avatar src={item.photo ? imageUrl(item.photo) : undefined} variant="rounded" sx={{ width: 64, height: 64, flexShrink: 0 }} slotProps={{ img: { style: { objectFit: "contain" } } }}>📦</Avatar>
                      <Box sx={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column" }}>
                        <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between" }}>
                          <Typography noWrap sx={{ fontWeight: 600, flexGrow: 1, mr: 1 }}>{item.name}</Typography>
                          <Typography color={stockColor(status)} sx={{ fontWeight: 700, flexShrink: 0 }}>
                            {item.quantity}
                          </Typography>
                        </Stack>
                        <Box sx={{ mt: 0.5, mb: 0.5, flexGrow: 1 }}>
                          {item.volume && (
                            <Chip label={item.volume} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
                          )}
                          {item.piece_count > 1 && (
                            <Chip label={`${item.piece_count}個入`} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
                          )}
                          {categoryName(item.category_id) && (
                            <Chip label={categoryName(item.category_id)} size="small" color="primary" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
                          )}
                        </Box>
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
                          {item.amazon_url && (
                            <IconButton
                              size="small"
                              color="info"
                              aria-label="Amazonを別タブで開く"
                              onClick={() => window.open(item.amazon_url, "_blank", "noopener,noreferrer")}
                            >
                              <OpenInNewIcon fontSize="small" />
                            </IconButton>
                          )}
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
            );
          })}
        </Box>
      )}

      <QuickStockDialog item={dialogItem} mode={dialogMode} onClose={() => setDialogItem(null)} />
      <HistoryDialog item={historyItem} onClose={() => setHistoryItem(null)} />
    </Box>
  );
}
