import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { api } from "../api";
import { useStore } from "../store";

export type MasterEntity = "categories" | "locations" | "suppliers";

interface Props {
  open: boolean;
  entity: MasterEntity;
  item: Record<string, string> | null;
  onClose: () => void;
}

const LABELS: Record<MasterEntity, string> = {
  categories: "カテゴリ",
  locations: "置き場",
  suppliers: "購入先",
};

const schema = yup.object({
  name: yup.string().required("名前は必須です"),
  note: yup.string().default(""),
  description: yup.string().default(""),
  url: yup.string().default(""),
});

type FormValues = yup.InferType<typeof schema>;

export default function SimpleMasterDialog({ open, entity, item, onClose }: Props) {
  const { reloadCategories, reloadLocations, reloadSuppliers, toast } = useStore();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { name: "", note: "", description: "", url: "" },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: item?.name ?? "",
        note: item?.note ?? "",
        description: item?.description ?? "",
        url: item?.url ?? "",
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
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
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
            {(entity === "categories" || entity === "suppliers") && (
              <TextField
                label="メモ"
                fullWidth
                {...register("note")}
                error={!!errors.note}
                helperText={errors.note?.message}
              />
            )}
            {entity === "locations" && (
              <TextField
                label="説明"
                fullWidth
                {...register("description")}
                error={!!errors.description}
                helperText={errors.description?.message}
              />
            )}
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
