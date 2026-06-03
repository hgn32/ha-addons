import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
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

export default function SimpleMasterDialog({ open, entity, item, onClose }: Props) {
  const { reloadCategories, reloadLocations, reloadSuppliers, toast } = useStore();
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setForm(item ? { ...item } : {});
  }, [open, item]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const reload = async () => {
    if (entity === "categories") await reloadCategories();
    if (entity === "locations") await reloadLocations();
    if (entity === "suppliers") await reloadSuppliers();
  };

  const save = async () => {
    if (!form.name?.trim()) return toast("名前は必須です", "error");
    try {
      if (item?.id) await api.put(`/api/${entity}/${item.id}`, form);
      else await api.post(`/api/${entity}`, form);
      toast("保存しました");
      await reload();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {item?.id ? "編集" : "追加"}: {LABELS[entity]}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="名前" required value={form.name ?? ""} onChange={set("name")} fullWidth />
          {(entity === "categories" || entity === "suppliers") && (
            <TextField label="メモ" value={form.note ?? ""} onChange={set("note")} fullWidth />
          )}
          {entity === "locations" && (
            <TextField label="説明" value={form.description ?? ""} onChange={set("description")} fullWidth />
          )}
          {entity === "suppliers" && (
            <TextField label="URL" value={form.url ?? ""} onChange={set("url")} fullWidth placeholder="https://..." />
          )}
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
