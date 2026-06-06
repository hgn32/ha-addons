import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, imageUrl } from "../api";
import AddFab from "../components/AddFab";
import ProductDialog from "../components/ProductDialog";
import { useStore } from "../store";
import { Product } from "../types";

interface CardProps {
  product: Product;
  categoryLabel: string;
  lastPurchased: string;
  onEdit: () => void;
  onRemove: () => void;
}

function SortableProductCard({ product: p, categoryLabel, lastPurchased, onEdit, onRemove }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card ref={setNodeRef} style={style} sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 2 } }}>
        <Stack direction="row" spacing={2} sx={{ flexGrow: 1 }}>
          <Avatar
            src={p.photo ? imageUrl(p.photo) : undefined}
            variant="rounded"
            sx={{ width: 64, height: 64, flexShrink: 0 }}
          >
            📦
          </Avatar>
          <Box sx={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column" }}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
              <Typography fontWeight={600} noWrap sx={{ flexGrow: 1, mr: 1 }}>
                {p.name}
              </Typography>
              <Box
                {...attributes}
                {...listeners}
                sx={{ cursor: "grab", color: "text.disabled", mt: "-2px", flexShrink: 0 }}
              >
                <DragIndicatorIcon fontSize="small" />
              </Box>
            </Stack>
            <Box sx={{ mt: 0.5, mb: 0.5, flexGrow: 1 }}>
              {p.volume && (
                <Chip label={p.volume} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
              )}
              {p.piece_count > 1 && (
                <Chip label={`${p.piece_count}個入`} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
              )}
              {p.maker && (
                <Chip label={p.maker} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
              )}
              {categoryLabel && (
                <Chip label={categoryLabel} size="small" color="primary" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
              )}
              {lastPurchased && (
                <Chip label={`購入: ${lastPurchased}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
              )}
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
              {p.amazon_url && (
                <IconButton
                  size="small"
                  color="info"
                  aria-label="Amazonを別タブで開く"
                  onClick={() => window.open(p.amazon_url, "_blank", "noopener,noreferrer")}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              )}
              <IconButton size="small" color="primary" onClick={onEdit}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={onRemove}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function Products() {
  const { products, transactions, categoryName, reloadProducts, reloadInventory, toast } = useStore();
  const [localProducts, setLocalProducts] = useState<Product[]>([]);
  const [dialog, setDialog] = useState<{ open: boolean; product: Product | null }>({
    open: false,
    product: null,
  });

  useEffect(() => {
    setLocalProducts(products);
  }, [products]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localProducts.findIndex((p) => p.id === active.id);
    const newIndex = localProducts.findIndex((p) => p.id === over.id);
    const reordered = arrayMove(localProducts, oldIndex, newIndex);
    setLocalProducts(reordered);
    try {
      await api.put("/api/products/reorder", { ids: reordered.map((p) => p.id) });
    } catch (e) {
      toast((e as Error).message, "error");
      setLocalProducts(products);
    }
  };

  const remove = async (p: Product) => {
    if (!confirm(`「${p.name}」を削除しますか？`)) return;
    try {
      await api.del(`/api/products/${p.id}`);
      toast("削除しました");
      await Promise.all([reloadProducts(), reloadInventory()]);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  // Compute last purchase date per product from transactions (type="add")
  const lastPurchasedMap = new Map<string, string>();
  for (const t of transactions) {
    if (t.type !== "add") continue;
    const prev = lastPurchasedMap.get(t.product_id);
    if (!prev || t.date > prev) lastPurchasedMap.set(t.product_id, t.date);
  }

  const exportCsv = () => {
    const headers = ["名前", "内容量", "員数", "メーカー", "JANコード", "品目カテゴリ", "メモ"];
    const rows = localProducts.map((p) => [
      p.name, p.volume, String(p.piece_count), p.maker, p.jan_code, categoryName(p.category_id), p.note,
    ].map((v) => `"${(v ?? "").replace(/"/g, '""')}"`));
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "品目マスタ.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>品目マスタ</Typography>
        <Button size="small" startIcon={<DownloadIcon />} onClick={exportCsv} sx={{ ml: "auto" }}>CSV出力</Button>
      </Stack>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={localProducts.map((p) => p.id)} strategy={rectSortingStrategy}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", lg: "repeat(3, 1fr)" },
              gap: 2,
            }}
          >
            {localProducts.map((p) => {
              const lastDate = lastPurchasedMap.get(p.id);
              const lastPurchased = lastDate
                ? new Date(lastDate).toLocaleDateString("ja-JP")
                : "";
              return (
                <SortableProductCard
                  key={p.id}
                  product={p}
                  categoryLabel={categoryName(p.category_id)}
                  lastPurchased={lastPurchased}
                  onEdit={() => setDialog({ open: true, product: p })}
                  onRemove={() => remove(p)}
                />
              );
            })}
            {localProducts.length === 0 && (
              <Typography color="text.secondary" sx={{ gridColumn: "1 / -1", textAlign: "center", py: 6 }}>
                品目がありません
              </Typography>
            )}
          </Box>
        </SortableContext>
      </DndContext>

      <AddFab label="新規追加" onClick={() => setDialog({ open: true, product: null })} />

      <ProductDialog
        open={dialog.open}
        product={dialog.product}
        onClose={() => setDialog({ ...dialog, open: false })}
      />
    </Box>
  );
}
