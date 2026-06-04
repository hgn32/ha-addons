import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { useEffect, useState } from "react";
import { useForm, Controller, type FieldPath } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { api, imageUrl } from "../api";
import { useStore } from "../store";
import { Product } from "../types";

interface Props {
  open: boolean;
  product: Product | null;
  onClose: () => void;
}

interface ProductAsin {
  id: string;
  asin: string;
}

const schema = yup.object({
  name: yup.string().required("アイテム名は必須です"),
  maker: yup.string().default(""),
  jan_code: yup.string().default(""),
  amazon_asin: yup.string().default(""),
  amazon_url: yup.string().default(""),
  category_id: yup.string().default(""),
  supplier_id: yup.string().default(""),
  location_id: yup.string().default(""),
  note: yup.string().default(""),
});

type FormValues = yup.InferType<typeof schema>;

export default function ProductDialog({ open, product, onClose }: Props) {
  const { categories, locations, suppliers, reloadProducts, reloadInventory, toast } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [fetchUrl, setFetchUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [tab, setTab] = useState(0);
  const [asins, setAsins] = useState<ProductAsin[]>([]);
  const [newAsin, setNewAsin] = useState("");

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { name: "", maker: "", jan_code: "", amazon_asin: "", amazon_url: "", category_id: "", supplier_id: "", location_id: "", note: "" },
  });

  useEffect(() => {
    if (open) {
      setTab(0);
      reset({
        name: product?.name ?? "",
        maker: product?.maker ?? "",
        jan_code: product?.jan_code ?? "",
        amazon_asin: product?.amazon_asin ?? "",
        amazon_url: product?.amazon_url ?? "",
        category_id: product?.category_id ?? "",
        supplier_id: product?.supplier_id ?? "",
        location_id: product?.location_id ?? "",
        note: product?.note ?? "",
      });
      setFile(null);
      setFetchUrl("");
      setNewAsin("");
      if (product) {
        api.get<ProductAsin[]>(`/api/products/${product.id}/asins`).then(setAsins).catch(() => setAsins([]));
      } else {
        setAsins([]);
      }
    }
  }, [open, product, reset]);

  const preview = file ? URL.createObjectURL(file) : product?.photo ? imageUrl(product.photo) : "";

  const handleFetchProduct = async () => {
    if (!fetchUrl.trim()) return;
    setFetching(true);
    try {
      const data = await api.post<{ name: string; maker: string; jan_code: string; asin: string; product_url: string; image_url: string }>("/api/amazon/fetch-product", { url: fetchUrl });
      const fields: [FieldPath<FormValues>, string][] = [
        ["name", data.name],
        ["maker", data.maker],
        ["jan_code", data.jan_code],
        ["amazon_asin", data.asin],
        ["amazon_url", data.product_url],
      ];
      for (const [field, value] of fields) {
        if (value) setValue(field, value);
      }
      toast("アイテム情報を取込みました");
    } catch (e) {
      toast((e as Error).message || "取込に失敗しました", "error");
    } finally {
      setFetching(false);
    }
  };

  const addAsin = async () => {
    if (!product || !newAsin.trim()) return;
    try {
      const row = await api.post<ProductAsin>(`/api/products/${product.id}/asins`, { asin: newAsin.trim().toUpperCase() });
      setAsins((prev) => [...prev, row]);
      setNewAsin("");
      toast("ASINを追加しました");
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  const removeAsin = async (asinId: string) => {
    if (!product) return;
    try {
      await api.del(`/api/products/asins/${asinId}`);
      setAsins((prev) => prev.filter((a) => a.id !== asinId));
      toast("ASINを削除しました");
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  const onSubmit = async (data: FormValues) => {
    const fd = new FormData();
    (Object.keys(data) as (keyof FormValues)[]).forEach((k) => fd.append(k, data[k] ?? ""));
    if (file) fd.append("photo", file);
    try {
      if (product) {
        await api.put(`/api/products/${product.id}`, fd);
        toast("アイテムを更新しました");
      } else {
        await api.post("/api/products", fd);
        toast("アイテムを追加しました");
      }
      await Promise.all([reloadProducts(), reloadInventory()]);
      onClose();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{product ? "アイテムを編集" : "アイテムを追加"}</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}>
        <Tab label="基本情報" />
        {product && <Tab label={`ASIN (${asins.length})`} />}
      </Tabs>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          {tab === 0 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <TextField
                  label="Amazon URLから取込"
                  placeholder="https://www.amazon.co.jp/dp/..."
                  fullWidth
                  value={fetchUrl}
                  onChange={(e) => setFetchUrl(e.target.value)}
                  size="small"
                />
                <Button
                  variant="outlined"
                  onClick={handleFetchProduct}
                  disabled={fetching || !fetchUrl.trim()}
                  sx={{ whiteSpace: "nowrap", minWidth: 120 }}
                >
                  {fetching ? "取込中..." : "情報を取込"}
                </Button>
              </Stack>
              <TextField
                label="アイテム名"
                required
                fullWidth
                {...register("name")}
                error={!!errors.name}
                helperText={errors.name?.message}
              />
              <TextField label="メーカー" fullWidth {...register("maker")} />
              <Stack direction="row" spacing={2}>
                <TextField label="JANコード" fullWidth {...register("jan_code")} />
                <TextField label="Amazon ASIN (メイン)" fullWidth {...register("amazon_asin")} />
              </Stack>
              <TextField label="Amazon URL" fullWidth {...register("amazon_url")} />
              <Stack direction="row" spacing={2}>
                <Controller
                  name="category_id"
                  control={control}
                  render={({ field }) => (
                    <TextField select label="カテゴリ" fullWidth {...field}>
                      <MenuItem value="">-- 選択 --</MenuItem>
                      {categories.map((c) => (
                        <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <Controller
                  name="location_id"
                  control={control}
                  render={({ field }) => (
                    <TextField select label="置き場" fullWidth {...field}>
                      <MenuItem value="">-- 選択 --</MenuItem>
                      {locations.map((l) => (
                        <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Stack>
              <Controller
                name="supplier_id"
                control={control}
                render={({ field }) => (
                  <TextField select label="購入先" fullWidth {...field}>
                    <MenuItem value="">-- 選択 --</MenuItem>
                    {suppliers.map((s) => (
                      <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <TextField label="メモ" fullWidth multiline minRows={2} {...register("note")} />
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
          )}

          {tab === 1 && product && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                紐づいたASINはAmazonクロール時に自動でこのアイテムに在庫加算されます。
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {asins.length === 0 && (
                  <Typography variant="body2" color="text.disabled">ASINが登録されていません</Typography>
                )}
                {asins.map((a) => (
                  <Chip
                    key={a.id}
                    label={a.asin}
                    onDelete={() => removeAsin(a.id)}
                    deleteIcon={<DeleteIcon />}
                  />
                ))}
              </Box>
              <Stack direction="row" spacing={1}>
                <TextField
                  label="ASIN追加"
                  placeholder="B0XXXXXXXXXX"
                  size="small"
                  value={newAsin}
                  onChange={(e) => setNewAsin(e.target.value)}
                  fullWidth
                />
                <IconButton color="primary" onClick={addAsin} disabled={!newAsin.trim()}>
                  <AddIcon />
                </IconButton>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>キャンセル</Button>
          {tab === 0 && (
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              保存
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
