import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import {
  Avatar,
  Box,
  Card,
  CardContent,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
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
    <Card ref={setNodeRef} style={style}>
      <CardContent>
        <Stack direction="row" spacing={2}>
          <Avatar
            src={p.photo ? imageUrl(p.photo) : undefined}
            variant="rounded"
            sx={{ width: 64, height: 64, flexShrink: 0 }}
          >
            📦
          </Avatar>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
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
            {p.maker && (
              <Typography variant="caption" color="text.secondary" display="block">
                {p.maker}
              </Typography>
            )}
            {categoryLabel && (
              <Typography variant="caption" color="text.secondary" display="block">
                {categoryLabel}
              </Typography>
            )}
            {lastPurchased && (
              <Typography variant="caption" color="text.secondary" display="block">
                最終購入: {lastPurchased}
              </Typography>
            )}
            <Stack direction="row" spacing={0.5} mt={1}>
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
    useSensor(PointerSensor),
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

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        商品マスタ
      </Typography>

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
                商品がありません
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
