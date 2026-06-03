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
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
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

const schema = yup.object({
  product_id: yup.string().required("商品を選択してください"),
  quantity: yup
    .number()
    .typeError("数量を入力してください")
    .integer("整数で入力してください")
    .min(0, "0以上で入力してください")
    .required("数量は必須です"),
  unit_price: yup.number().typeError("単価を入力してください").min(0).default(0),
  supplier_id: yup.string().default(""),
  note: yup.string().default(""),
});

type FormValues = yup.InferType<typeof schema>;

export default function StockDialog({ open, mode, initialProductId, onClose }: Props) {
  const { products, suppliers, stockOf, reloadInventory, reloadTransactions, toast } = useStore();
  const cfg = CONFIG[mode];

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { product_id: "", quantity: mode === "adjust" ? 0 : 1, unit_price: 0, supplier_id: "", note: "" },
  });

  useEffect(() => {
    if (open) {
      reset({
        product_id: initialProductId ?? "",
        quantity: mode === "adjust" ? 0 : 1,
        unit_price: 0,
        supplier_id: "",
        note: "",
      });
    }
  }, [open, mode, initialProductId, reset]);

  const onSubmit = async (data: FormValues) => {
    try {
      await api.post(`/api/inventory/${mode}`, data);
      toast(`${cfg.title}しました`);
      await Promise.all([reloadInventory(), reloadTransactions()]);
      onClose();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{cfg.title}</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Controller
              name="product_id"
              control={control}
              render={({ field }) => (
                <TextField
                  select
                  label="商品"
                  required
                  fullWidth
                  {...field}
                  error={!!errors.product_id}
                  helperText={errors.product_id?.message}
                >
                  <MenuItem value="">-- 選択 --</MenuItem>
                  {products.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name}（在庫: {stockOf(p.id)}）
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <TextField
              type="number"
              label={mode === "adjust" ? "新しい在庫数" : "数量"}
              required
              fullWidth
              inputProps={{ min: 0 }}
              {...register("quantity")}
              error={!!errors.quantity}
              helperText={errors.quantity?.message}
            />
            {mode === "add" && (
              <>
                <TextField
                  type="number"
                  label="単価（円）"
                  fullWidth
                  inputProps={{ min: 0 }}
                  {...register("unit_price")}
                  error={!!errors.unit_price}
                  helperText={errors.unit_price?.message}
                />
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
              </>
            )}
            <TextField label="メモ" fullWidth {...register("note")} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>キャンセル</Button>
          <Button type="submit" variant="contained" color={cfg.color} disabled={isSubmitting}>
            {cfg.action}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
