import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { api } from "../api";
import { useIsMobile } from "../hooks";
import { useStore } from "../store";
import IconPicker from "./IconPicker";

export type MasterEntity = "categories" | "locations" | "suppliers";

interface Props {
  open: boolean;
  entity: MasterEntity;
  item: Record<string, string> | null;
  onClose: () => void;
}

const LABELS: Record<MasterEntity, string> = {
  categories: "品目カテゴリ",
  locations: "置き場",
  suppliers: "購入先",
};

const schema = yup.object({
  name: yup.string().required("名前は必須です"),
  note: yup.string().default(""),
  url: yup.string().default(""),
  icon: yup.string().default(""),
});

type FormValues = yup.InferType<typeof schema>;

export default function SimpleMasterDialog({ open, entity, item, onClose }: Props) {
  const { reloadCategories, reloadLocations, reloadSuppliers, toast } = useStore();
  const fullScreen = useIsMobile();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { name: "", note: "", url: "", icon: "" },
  });

  const watchedIcon = watch("icon");

  useEffect(() => {
    if (open) {
      reset({
        name: item?.name ?? "",
        note: item?.note ?? "",
        url: item?.url ?? "",
        icon: item?.icon ?? "",
      });
    }
  }, [open, item, reset]);

  const reload = async () => {
    if (entity === "categories") await reloadCategories();
    if (entity === "locations") await reloadLocations();
    if (entity === "suppliers") await reloadSuppliers();
  };

  const onSubmit = async (data: FormValues) => {
    try {
      if (item?.id) await api.put(`/api/${entity}/${item.id}`, data);
      else await api.post(`/api/${entity}`, data);
      toast("保存しました");
      await reload();
      onClose();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <DialogTitle>
        {item?.id ? "編集" : "追加"}: {LABELS[entity]}
      </DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="名前"
              required
              fullWidth
              {...register("name")}
              error={!!errors.name}
              helperText={errors.name?.message}
            />
            <TextField
              label="メモ"
              fullWidth
              {...register("note")}
              error={!!errors.note}
              helperText={errors.note?.message}
            />
            {entity === "suppliers" && (
              <TextField
                label="URL"
                fullWidth
                placeholder="https://..."
                {...register("url")}
                error={!!errors.url}
                helperText={errors.url?.message}
              />
            )}
            {(entity === "categories" || entity === "locations") && (
              <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <Typography variant="body2">アイコン:</Typography>
                <IconPicker value={watchedIcon} onChange={(v) => setValue("icon", v)} />
              </Stack>
            )}
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
