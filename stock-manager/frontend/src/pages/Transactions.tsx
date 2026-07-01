import {
  Box,
  Chip,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { TransactionType } from "../types";

const TYPE_META: Record<TransactionType, { label: string; color: "success" | "error" | "warning" }> = {
  add: { label: "購入", color: "success" },
  use: { label: "消費", color: "error" },
  adjust: { label: "調整", color: "warning" },
};

const PAGE_SIZES = [20, 50, 100];

export default function Transactions() {
  const { transactions, products, productName, suppliers } = useStore();
  const [filterProduct, setFilterProduct] = useState("");
  const [filterType, setFilterType] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "";

  const filtered = useMemo(() => {
    let rows = [...transactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    if (filterProduct) rows = rows.filter((t) => t.product_id === filterProduct);
    if (filterType) rows = rows.filter((t) => t.type === filterType);
    return rows;
  }, [transactions, filterProduct, filterType]);

  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const handleFilterChange = () => setPage(0);

  return (
    <Box>
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ alignItems: { xs: "flex-start", sm: "center" }, flexWrap: "wrap", gap: 2, mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>在庫履歴</Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", ml: { sm: "auto" } }}>
          <TextField
            select label="品目" size="small" sx={{ minWidth: 150, maxWidth: 220 }}
            value={filterProduct}
            onChange={(e) => { setFilterProduct(e.target.value); handleFilterChange(); }}
          >
            <MenuItem value="">すべて</MenuItem>
            {products.map((p) => (
              <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select label="種別" size="small" sx={{ minWidth: 100, maxWidth: 120 }}
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); handleFilterChange(); }}
          >
            <MenuItem value="">すべて</MenuItem>
            <MenuItem value="add">購入</MenuItem>
            <MenuItem value="use">消費</MenuItem>
            <MenuItem value="adjust">調整</MenuItem>
          </TextField>
        </Stack>
      </Stack>

      <Paper>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>日時</TableCell>
                <TableCell>種別</TableCell>
                <TableCell>品目</TableCell>
                <TableCell align="right">数量</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>購入先</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>メモ</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.map((tx) => {
                const meta = TYPE_META[tx.type as TransactionType] ?? { label: tx.type, color: "default" as const };
                return (
                  <TableRow key={tx.id} hover>
                    <TableCell sx={{ color: "text.secondary", fontSize: 13, whiteSpace: "nowrap" }}>
                      {tx.date.replace("T", " ").slice(0, 16)}
                    </TableCell>
                    <TableCell>
                      <Chip label={meta.label} color={meta.color} size="small" />
                    </TableCell>
                    <TableCell>{productName(tx.product_id)}</TableCell>
                    <TableCell align="right">
                      <Typography color={tx.type === "use" ? "error.main" : "success.main"} sx={{ fontWeight: 600, fontSize: 13 }}>
                        {tx.quantity >= 0 ? `+${tx.quantity}` : `${tx.quantity}`}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary", fontSize: 13, display: { xs: "none", sm: "table-cell" } }}>
                      {tx.supplier_id ? supplierName(tx.supplier_id) : ""}
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary", fontSize: 13, display: { xs: "none", sm: "table-cell" } }}>{tx.note}</TableCell>
                  </TableRow>
                );
              })}
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    履歴がありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={PAGE_SIZES}
          labelRowsPerPage="表示件数"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}件`}
        />
      </Paper>
    </Box>
  );
}
