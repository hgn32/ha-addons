import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { useEffect, useState } from "react";
import { api, imageUrl } from "../api";
import { useStore } from "../store";
import { Product } from "../types";

interface Props {
  open: boolean;
  product: Product | null;
  onClose: () => void;
}

const EMPTY = {
  name: "",
  jan_code: "",
  amazon_asin: "",
  category_id: "",
  supplier_id: "",
  location_id: "",
  note: "",
};

export default function ProductDialog({ open, product, onClose }: Props) {
  const { categories, locations, suppliers, reloadProducts, reloadInventory, toast } = useStore();
  const [form, setForm] = useState({ ...EMPTY });
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (open) {
      setForm(product ? { ...EMPTY, ...product } : { ...EMPTY });
      setFile(null);
    }
  }, [open, product]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const preview = file ? URL.createObjectURL(file) : product?.photo ? imageUrl(product.photo) : "";

  const save = async () => {
    if (!form.name.trim()) return toast("商品名は必須です", "error");
    const fd = new FormData();
    (Object.keys(EMPTY) as (keyof typeof EMPTY)[]).forEach((k) => fd.append(k, form[k] ?? ""));
    if (file) fd.append("photo", file);
    try {
      if (product) {
        await api.put(`/api/products/${product.id}`, fd);
        toast("商品を更新しました");
      } else {
        await api.post("/api/products", fd);
        toast("商品を追加しました");
      }
      await Promise.all([reloadProducts(), reloadInventory()]);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{product ? "商品を編集" : "商品を追加"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="商品名" required value={form.name} onChange={set("name")} fullWidth />
          <Stack direction="row" spacing={2}>
            <TextField label="JANコード" value={form.jan_code} onChange={set("jan_code")} fullWidth />
            <TextField label="Amazon ASIN" value={form.amazon_asin} onChange={set("amazon_asin")} fullWidth />
          </Stack>
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
          <TextField label="メモ" value={form.note} onChange={set("note")} fullWidth multiline minRows={2} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Avatar src={preview} variant="rounded" sx={{ width: 64, height: 64 }}>
              📦
            </Avatar>
            <Button component="label" variant="outlined" startIcon={<PhotoCameraIcon />}>
              写真を選択
              <input
                hidden
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Button>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" onClick={save}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
