import AddIcon from "@mui/icons-material/Add";
import BuildIcon from "@mui/icons-material/Build";
import HistoryIcon from "@mui/icons-material/History";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Avatar,
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import type { Page } from "../App";
import { imageUrl } from "../api";
import StockDialog, { StockMode } from "../components/StockDialog";
import { useStore } from "../store";

export default function Inventory({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { inventory, categoryName, locationName, reloadTransactions } = useStore();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; mode: StockMode }>({ open: false, mode: "add" });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return inventory;
    return inventory.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.jan_code.includes(q) ||
        i.amazon_asin.toLowerCase().includes(q)
    );
  }, [inventory, search]);

  const viewHistory = async (productId: string) => {
    await reloadTransactions(productId);
    onNavigate("transactions");
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h5" fontWeight={700}>
          在庫一覧
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="success" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, mode: "add" })}>
            在庫追加
          </Button>
          <Button variant="contained" color="error" startIcon={<RemoveIcon />} onClick={() => setDialog({ open: true, mode: "use" })}>
            在庫使用
          </Button>
          <Button variant="contained" color="warning" startIcon={<BuildIcon />} onClick={() => setDialog({ open: true, mode: "adjust" })}>
            強制メンテ
          </Button>
        </Stack>
      </Stack>

      <Paper sx={{ p: 2 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="商品名・JANコード・ASINで検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>商品</TableCell>
                <TableCell>カテゴリ</TableCell>
                <TableCell>置き場</TableCell>
                <TableCell align="right">在庫数</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar src={item.photo ? imageUrl(item.photo) : undefined} variant="rounded">
                        📦
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {item.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.jan_code ? `JAN: ${item.jan_code}` : item.amazon_asin ? `ASIN: ${item.amazon_asin}` : ""}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>{categoryName(item.category_id)}</TableCell>
                  <TableCell>{locationName(item.location_id)}</TableCell>
                  <TableCell align="right">
                    <Typography fontWeight={700} color={item.quantity <= 1 ? "error.main" : "text.primary"}>
                      {item.quantity}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" startIcon={<HistoryIcon />} onClick={() => viewHistory(item.id)}>
                      履歴
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    商品がありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <StockDialog open={dialog.open} mode={dialog.mode} onClose={() => setDialog({ ...dialog, open: false })} />
    </Box>
  );
}
