import DeleteIcon from "@mui/icons-material/Delete";
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
import { useState } from "react";
import { api, imageUrl } from "../api";
import AddFab from "../components/AddFab";
import ProductDialog from "../components/ProductDialog";
import { useStore } from "../store";
import { Product } from "../types";

export default function Products() {
  const { products, categoryName, reloadProducts, reloadInventory, toast } = useStore();
  const [dialog, setDialog] = useState<{ open: boolean; product: Product | null }>({
    open: false,
    product: null,
  });

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

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        商品マスタ
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", lg: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        {products.map((p) => (
          <Card key={p.id}>
            <CardContent>
              <Stack direction="row" spacing={2}>
                <Avatar
                  src={p.photo ? imageUrl(p.photo) : undefined}
                  variant="rounded"
                  sx={{ width: 64, height: 64 }}
                >
                  📦
                </Avatar>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography fontWeight={600} noWrap>
                    {p.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {categoryName(p.category_id)}
                  </Typography>
                  {p.jan_code && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      JAN: {p.jan_code}
                    </Typography>
                  )}
                  {p.amazon_asin && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      ASIN: {p.amazon_asin}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.5} mt={1}>
                    <IconButton color="primary" onClick={() => setDialog({ open: true, product: p })}>
                      <EditIcon />
                    </IconButton>
                    <IconButton color="error" onClick={() => remove(p)}>
                      <DeleteIcon />
                    </IconButton>
                  </Stack>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        ))}
        {products.length === 0 && (
          <Typography color="text.secondary" sx={{ gridColumn: "1 / -1", textAlign: "center", py: 6 }}>
            商品がありません
          </Typography>
        )}
      </Box>

      <AddFab label="新規追加" onClick={() => setDialog({ open: true, product: null })} />

      <ProductDialog
        open={dialog.open}
        product={dialog.product}
        onClose={() => setDialog({ ...dialog, open: false })}
      />
    </Box>
  );
}
