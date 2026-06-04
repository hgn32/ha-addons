import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { api, imageUrl } from "../api";
import { useStore } from "../store";
import { AmazonQueueItem, Product } from "../types";

interface Props {
  open: boolean;
  item: AmazonQueueItem | null;
  onClose: () => void;
  onDone: (id: string) => void;
}

export default function AmazonManageDialog({ open, item, onClose, onDone }: Props) {
  const { categories, locations, products, reloadProducts, reloadInventory, toast } = useStore();
  const [tab, setTab] = useState(0); // 0=新規登録, 1=既存にマージ
  const [form, setForm] = useState({
    name: "",
    maker: "",
    jan_code: "",
    category_id: "",
    location_id: "",
  });
  const [mergeTarget, setMergeTarget] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && item) {
      setTab(0);
      setForm({
        name: item.product_name,
        maker: item.maker,
        jan_code: item.jan_code,
        category_id: "",
        location_id: "",
          });
      setMergeTarget(null);
    }
  }, [open, item]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!item) return;
    setBusy(true);
    try {
      if (tab === 0) {
        if (!form.name.trim()) return toast("アイテム名は必須です", "error");
        await api.post(`/api/amazon/queue/${item.id}/manage`, { mode: "new", ...form });
        toast(`「${form.name}」を登録し在庫を${item.quantity}加算しました`);
      } else {
        if (!mergeTarget) return toast("マージ先を選択してください", "error");
        await api.post(`/api/amazon/queue/${item.id}/manage`, { mode: "merge", product_id: mergeTarget.id });
        toast(`「${mergeTarget.name}」にASINを紐づけ、在庫を${item.quantity}加算しました`);
      }
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
      <DialogTitle>在庫管理する</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {item && (
            <Stack direction="row" spacing={2} alignItems="center">
              {item.image_url && (
                <Box
                  component="img"
                  src={item.image_url.startsWith("http") ? item.image_url : imageUrl(item.image_url)}
                  sx={{ width: 56, height: 56, objectFit: "contain", borderRadius: 1, border: "1px solid #eee" }}
                />
              )}
              <Box>
                <Typography variant="body2" fontWeight={600}>{item.product_name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  ASIN: {item.asin || "-"} / 数量: {item.quantity} / 単価: ¥{item.unit_price.toLocaleString()}
                  {item.maker ? ` / ${item.maker}` : ""}
                </Typography>
              </Box>
            </Stack>
          )}

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tab label="新規アイテムとして登録" />
            <Tab label="既存アイテムに紐づける" />
          </Tabs>

          {tab === 0 && (
            <Stack spacing={2}>
              <TextField label="アイテム名" required value={form.name} onChange={set("name")} fullWidth />
              <TextField label="メーカー" value={form.maker} onChange={set("maker")} fullWidth />
              <TextField label="JANコード" value={form.jan_code} onChange={set("jan_code")} fullWidth />
              <Stack direction="row" spacing={2}>
                <TextField select label="品目カテゴリ" value={form.category_id} onChange={set("category_id")} fullWidth>
                  <MenuItem value="">-- 選択 --</MenuItem>
                  {categories.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </TextField>
                <TextField select label="置き場" value={form.location_id} onChange={set("location_id")} fullWidth>
                  <MenuItem value="">-- 選択 --</MenuItem>
                  {locations.map((l) => (
                    <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Stack>
          )}

          {tab === 1 && (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                このASINを既存のアイテムに紐づけます。次回以降のクロールで自動加算されます。
              </Typography>
              <Autocomplete
                options={products}
                getOptionLabel={(p) => p.name}
                value={mergeTarget}
                onChange={(_, v) => setMergeTarget(v)}
                renderInput={(params) => <TextField {...params} label="マージ先のアイテムを選択" />}
              />
              {mergeTarget && (
                <Typography variant="caption" color="text.secondary">
                  在庫 +{item?.quantity} 加算されます
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" disabled={busy} onClick={submit}>
          {tab === 0 ? "登録して在庫加算" : "紐づけて在庫加算"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
