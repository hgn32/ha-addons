import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { AmazonQueueItem } from "../types";

interface Props {
  open: boolean;
  item: AmazonQueueItem | null;
  onClose: () => void;
  onDone: (id: string) => void;
}

// パターンA「在庫管理する」: 商品マスタへ登録する前に内容を確認・補完する。
export default function AmazonManageDialog({ open, item, onClose, onDone }: Props) {
  const { categories, locations, suppliers, reloadProducts, reloadInventory, toast } = useStore();
  const [form, setForm] = useState({
    name: "",
    jan_code: "",
    category_id: "",
    location_id: "",
    supplier_id: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && item) {
      setForm({
        name: item.product_name,
        jan_code: item.jan_code,
        category_id: "",
        location_id: "",
        supplier_id: "",
      });
    }
  }, [open, item]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!item) return;
    if (!form.name.trim()) return toast("商品名は必須です", "error");
    setBusy(true);
    try {
      await api.post(`/api/amazon/queue/${item.id}/manage`, form);
      toast(`「${form.name}」を登録し在庫を${item.quantity}加算しました`);
      await Promise.all([reloadProducts(), reloadInventory()]);
      onDone(item.id);
      onClose();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>在庫管理する（商品マスタ登録）</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {item && (
            <Typography variant="caption" color="text.secondary">
              ASIN: {item.asin || "-"} / 数量: {item.quantity} / 単価: ¥{item.unit_price}
              {item.maker ? ` / メーカー: ${item.maker}` : ""}
            </Typography>
          )}
          <TextField label="商品名" required value={form.name} onChange={set("name")} fullWidth />
          <TextField label="JANコード" value={form.jan_code} onChange={set("jan_code")} fullWidth />
          <Stack direction="row" spacing={2}>
            <TextField select label="カテゴリ" value={form.category_id} onChange={set("category_id")} fullWidth>
              <MenuItem value="">-- 選択 --</MenuItem>
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="置き場" value={form.location_id} onChange={set("location_id")} fullWidth>
              <MenuItem value="">-- 選択 --</MenuItem>
              {locations.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField select label="購入先" value={form.supplier_id} onChange={set("supplier_id")} fullWidth>
            <MenuItem value="">-- 選択 --</MenuItem>
            {suppliers.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={busy} onClick={submit}>
          登録して在庫加算
        </Button>
      </DialogActions>
    </Dialog>
  );
}
