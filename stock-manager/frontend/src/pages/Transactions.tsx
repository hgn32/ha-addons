import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useStore } from "../store";
import { TransactionType } from "../types";

const TYPE_META: Record<TransactionType, { label: string; color: "success" | "error" | "warning" }> = {
  add: { label: "追加", color: "success" },
  use: { label: "使用", color: "error" },
  adjust: { label: "調整", color: "warning" },
};

export default function Transactions() {
  const { transactions, productName } = useStore();

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        操作履歴
      </Typography>
      <Paper sx={{ p: 2 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>日時</TableCell>
                <TableCell>種別</TableCell>
                <TableCell>品目</TableCell>
                <TableCell align="right">数量</TableCell>
                <TableCell align="right">単価</TableCell>
                <TableCell>メモ</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.map((tx) => {
                const meta = TYPE_META[tx.type];
                return (
                  <TableRow key={tx.id} hover>
                    <TableCell sx={{ color: "text.secondary", fontSize: 13 }}>
                      {tx.date.replace("T", " ").slice(0, 19)}
                    </TableCell>
                    <TableCell>
                      <Chip label={meta.label} color={meta.color} size="small" />
                    </TableCell>
                    <TableCell>{productName(tx.product_id)}</TableCell>
                    <TableCell align="right">
                      <Typography fontWeight={600} color={tx.quantity > 0 ? "success.main" : "error.main"}>
                        {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ color: "text.secondary", fontSize: 13 }}>
                      {tx.unit_price ? `¥${tx.unit_price.toLocaleString()}` : ""}
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary", fontSize: 13 }}>{tx.note}</TableCell>
                  </TableRow>
                );
              })}
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    履歴がありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
