import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";

export type StockMode = "add" | "use" | "adjust";

interface Props {
  open: boolean;
  mode: StockMode;
  initialProductId?: string;
  onClose: () => void;
}

const CONFIG: Record<StockMode, { title: string; color: "success" | "error" | "warning"; action: string }> = {
  add: { title: "在庫追加", color: "success", action: "追加する" },
  use: { title: "在庫使用", color: "error", action: "使用する" },
  adjust: { title: "強制メンテ（在庫数を直接指定）", color: "warning", action: "調整する" },
};

export default function StockDialog({ open, mode, initialProductId, onClose }: Props) {
  const { products, suppliers, stockOf, reloadInventory, reloadTransactions, toast } = useStore();
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setProductId(initialProductId ?? "");
      setQuantity(mode === "adjust" ? "0" : "1");
      setUnitPrice("0");
      setSupplierId("");
      setNote("");
    }
  }, [open, mode, initialProductId]);

  const cfg = CONFIG[mode];

  const submit = async () => {
    if (!productId) return toast("商品を選択してください", "error");
    const qty = parseInt(quantity, 10);
    if (Number.isNaN(qty) || qty < 0) return toast("数量を入力してください", "error");
    try {
      await api.post(`/api/inventory/${mode}`, {
        product_id: productId,
        quantity: qty,
        unit_price: parseFloat(unitPrice) || 0,
        supplier_id: supplierId,
        note,
      });
      toast(`${cfg.title}しました`);
      await Promise.all([reloadInventory(), reloadTransactions()]);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{cfg.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="商品"
            required
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            fullWidth
          >
            <MenuItem value="">-- 選択 --</MenuItem>
            {products.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}（在庫: {stockOf(p.id)}）
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="number"
            label={mode === "adjust" ? "新しい在庫数" : "数量"}
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputProps={{ min: 0 }}
            fullWidth
          />
          {mode === "add" && (
            <>
              <TextField
                type="number"
                label="単価（円）"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                inputProps={{ min: 0 }}
                fullWidth
              />
              <TextField
                select
                label="購入先"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                fullWidth
              >
                <MenuItem value="">-- 選択 --</MenuItem>
                {suppliers.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
          <TextField label="メモ" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" color={cfg.color} onClick={submit}>
          {cfg.action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
