import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
  const [addQty, setAddQty] = useState(0);
  const [busy, setBusy] = useState(false);

  const matched = item?.matched_product ?? null;

  const calcQty = (purchaseQty: number, pieceCount: number) =>
    Math.max(1, purchaseQty * Math.max(1, pieceCount));

  useEffect(() => {
    if (!open || !item) return;
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
    setAddQty(calcQty(item.quantity, matched?.piece_count ?? 1));
  }, [open, item]);

  const formPieceCount = Math.max(1, parseInt(form.piece_count, 10) || 1);

  // Recalculate addQty when piece_count in form changes (new product tab)
  useEffect(() => {
    if (!open || !item || matched || tab !== 0) return;
    setAddQty(calcQty(item.quantity, formPieceCount));
  }, [formPieceCount]);

  // Recalculate addQty when merge target changes (existing product tab)
  useEffect(() => {
    if (!open || !item || matched || tab !== 1) return;
    setAddQty(calcQty(item.quantity, mergeTarget?.piece_count ?? 1));
  }, [mergeTarget]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const skip = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.post(`/api/amazon/queue/${item.id}/skip`, {});
      onDone(item.id);
      onClose();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!item) return;
    setBusy(true);
    try {
      if (matched) {
        await api.post(`/api/amazon/queue/${item.id}/manage`, {
          mode: "merge",
          product_id: matched.id,
          quantity: addQty,
        });
        toast(`「${matched.name}」に ${addQty} 追加しました`);
      } else if (tab === 0) {
        if (!form.name.trim()) { toast("品目名は必須です", "error"); return; }
        await api.post(`/api/amazon/queue/${item.id}/manage`, {
          mode: "new",
          ...form,
          piece_count: formPieceCount,
          quantity: addQty,
        });
        toast(`「${form.name}」を登録し在庫を ${addQty} 追加しました`);
      } else {
        if (!mergeTarget) { toast("紐づける品目を選択してください", "error"); return; }
        await api.post(`/api/amazon/queue/${item.id}/manage`, {
          mode: "merge",
          product_id: mergeTarget.id,
          quantity: addQty,
        });
        toast(`「${mergeTarget.name}」にASINを紐づけ、在庫を ${addQty} 追加しました`);
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

  if (!item) return null;

  // Piece count used for the quantity calculation display
  const pieceCountForCalc = matched
    ? matched.piece_count
    : tab === 0
    ? formPieceCount
    : (mergeTarget?.piece_count ?? 1);

  const QtySection = (
    <Stack spacing={1}>
      <Divider />
      <Typography variant="subtitle2" sx={{ pt: 0.5 }}>追加する在庫数</Typography>
      {pieceCountForCalc > 1 && (
        <Typography variant="caption" color="text.secondary">
          購入数 {item.quantity} × 員数 {pieceCountForCalc} = {item.quantity * pieceCountForCalc}個
        </Typography>
      )}
      <TextField
        label="追加数"
        type="number"
        size="small"
        value={addQty}
        onChange={(e) => setAddQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
        slotProps={{ htmlInput: { min: 0 } }}
        sx={{ width: 180 }}
      />
    </Stack>
  );

  const ItemPreview = (
    <Stack direction="row" spacing={2} alignItems="center">
      {item.image_url && (
        <Box
          component="img"
          src={item.image_url.startsWith("http") ? item.image_url : imageUrl(item.image_url)}
          sx={{ width: 56, height: 56, objectFit: "contain", borderRadius: 1, border: "1px solid", borderColor: "divider", flexShrink: 0 }}
        />
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap>{item.product_name}</Typography>
        <Typography variant="caption" color="text.secondary">
          ASIN: {item.asin || "-"} · 購入数: {item.quantity}{item.maker ? ` · ${item.maker}` : ""}
        </Typography>
      </Box>
    </Stack>
  );

  /* ---- Case A: matched product ---- */
  if (matched) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
        <DialogTitle>在庫に追加しますか？</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {ItemPreview}
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}>
              <Avatar src={matched.photo ? imageUrl(matched.photo) : undefined} variant="rounded" sx={{ width: 40, height: 40 }} slotProps={{ img: { style: { objectFit: "contain" } } }}>📦</Avatar>
              <Box>
                <Typography variant="body2" fontWeight={600}>{matched.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  現在庫: {matched.quantity}{matched.piece_count > 1 ? ` · 員数: ${matched.piece_count}` : ""}
                </Typography>
              </Box>
            </Stack>
            {QtySection}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={busy} onClick={skip}>取り込まない</Button>
          <Button variant="contained" disabled={busy || addQty < 0} onClick={submit}>在庫に追加</Button>
        </DialogActions>
      </Dialog>
    );
  }

  /* ---- Case B: unmatched product ---- */
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>品目を登録しますか？</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}>
        <Tab label="新規品目として登録" />
        <Tab label="既存品目に紐づける" />
      </Tabs>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {ItemPreview}
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
                  <MenuItem value="">----</MenuItem>
                  {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                </TextField>
                <TextField select label="置き場" size="small" value={form.location_id} onChange={set("location_id")} fullWidth>
                  <MenuItem value="">----</MenuItem>
                  {locations.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
                </TextField>
              </Stack>
              <TextField label="メモ" size="small" multiline minRows={2} slotProps={{ htmlInput: { style: { resize: "vertical" } } }} value={form.note} onChange={set("note")} fullWidth />
              {QtySection}
            </Stack>
          )}
          {tab === 1 && (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                このASINを既存の品目に紐づけます。次回以降のクロールで自動加算の対象になります。
              </Typography>
              <Autocomplete
                options={products}
                getOptionLabel={(p) => p.name}
                value={mergeTarget}
                onChange={(_, v) => setMergeTarget(v)}
                renderInput={(params) => <TextField {...params} label="紐づける品目を選択" size="small" />}
              />
              {mergeTarget && QtySection}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" disabled={busy} onClick={skip}>取り込まない</Button>
        <Button variant="contained" disabled={busy} onClick={submit}>
          {tab === 0 ? "登録して在庫追加" : "紐づけて在庫追加"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
