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
import { useIsMobile } from "../hooks";
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
  const fullScreen = useIsMobile();
  const [tab, setTab] = useState(0);
  const [form, setForm] = useState({
    name: "",
    volume: "",
    piece_count: "1",
    maker: "",
    jan_code: "",
    category_id: "",
    location_id: "",
    note: "",
  });
  const [mergeTarget, setMergeTarget] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && item) {
      setTab(0);
      setForm({
        name: item.product_name,
        volume: "",
        piece_count: "1",
        maker: item.maker,
        jan_code: item.jan_code,
        category_id: "",
        location_id: "",
        note: "",
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
        if (!form.name.trim()) return toast("品目名は必須です", "error");
        await api.post(`/api/amazon/queue/${item.id}/manage`, {
          mode: "new",
          ...form,
          piece_count: parseInt(form.piece_count, 10) || 1,
        });
        toast(`「${form.name}」を登録し在庫を${item.quantity}加算しました`);
      } else {
        if (!mergeTarget) return toast("紐づける品目を選択してください", "error");
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>在庫管理する</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}>
        <Tab label="新規品目として登録" />
        <Tab label="既存品目に紐づける" />
      </Tabs>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {item && (
            <Stack direction="row" spacing={2} alignItems="center">
              {item.image_url && (
                <Box
                  component="img"
                  src={item.image_url.startsWith("http") ? item.image_url : imageUrl(item.image_url)}
                  sx={{ width: 56, height: 56, objectFit: "contain", borderRadius: 1, border: "1px solid", borderColor: "divider" }}
                />
              )}
              <Box>
                <Typography variant="body2" fontWeight={600}>{item.product_name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  ASIN: {item.asin || "-"} · 数量: {item.quantity}
                  {item.maker ? ` · ${item.maker}` : ""}
                </Typography>
              </Box>
            </Stack>
          )}

          {tab === 0 && (
            <Stack spacing={2}>
              <TextField label="品目名" required size="small" value={form.name} onChange={set("name")} fullWidth />
              <Stack direction="row" spacing={2}>
                <TextField label="内容量" size="small" fullWidth placeholder="例: 500ml、1kg" value={form.volume} onChange={set("volume")} />
                <TextField
                  label="員数" size="small" type="number" sx={{ width: 100, flexShrink: 0 }}
                  slotProps={{ htmlInput: { min: 1 } }}
                  value={form.piece_count} onChange={set("piece_count")}
                />
              </Stack>
              <TextField label="メーカー" size="small" value={form.maker} onChange={set("maker")} fullWidth />
              <TextField label="JANコード" size="small" value={form.jan_code} onChange={set("jan_code")} fullWidth />
              <Stack direction="row" spacing={2}>
                <TextField select label="品目カテゴリ" size="small" value={form.category_id} onChange={set("category_id")} fullWidth>
                  <MenuItem value="">-- 選択 --</MenuItem>
                  {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                </TextField>
                <TextField select label="置き場" size="small" value={form.location_id} onChange={set("location_id")} fullWidth>
                  <MenuItem value="">-- 選択 --</MenuItem>
                  {locations.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                </TextField>
              </Stack>
              <TextField label="メモ" size="small" multiline minRows={2} value={form.note} onChange={set("note")} fullWidth />
            </Stack>
          )}

          {tab === 1 && (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                このASINを既存の品目に紐づけます。次回以降のクロールで自動加算されます。
              </Typography>
              <Autocomplete
                options={products}
                getOptionLabel={(p) => p.name}
                value={mergeTarget}
                onChange={(_, v) => setMergeTarget(v)}
                renderInput={(params) => <TextField {...params} label="紐づける品目を選択" size="small" />}
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
