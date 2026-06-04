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

const schema = yup.object({
  name: yup.string().required("商品名は必須です"),
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
      toast("商品情報を取込みました");
    } catch (e) {
      toast((e as Error).message || "取込に失敗しました", "error");
    } finally {
      setFetching(false);
    }
  };

  const onSubmit = async (data: FormValues) => {
    const fd = new FormData();
    (Object.keys(data) as (keyof FormValues)[]).forEach((k) => fd.append(k, data[k] ?? ""));
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
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{product ? "商品を編集" : "商品を追加"}</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
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
                {fetching ? "取込中..." : "商品情報を取込"}
              </Button>
            </Stack>
            <TextField
              label="商品名"
              required
              fullWidth
              {...register("name")}
              error={!!errors.name}
              helperText={errors.name?.message}
            />
            <TextField label="メーカー" fullWidth {...register("maker")} />
            <Stack direction="row" spacing={2}>
              <TextField label="JANコード" fullWidth {...register("jan_code")} />
              <TextField label="Amazon ASIN" fullWidth {...register("amazon_asin")} />
            </Stack>
            <TextField label="Amazon商品URL" fullWidth {...register("amazon_url")} />
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
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>キャンセル</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            保存
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
