import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { ImportResult } from "../types";

export default function AmazonImport() {
  const { reloadProducts, reloadInventory, reloadTransactions, toast } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post<{ imported: number; results: ImportResult[] }>("/api/import/amazon", fd);
      setResults(res.results);
      toast(`${res.imported}件を取込みました`);
      await Promise.all([reloadProducts(), reloadInventory(), reloadTransactions()]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        Amazon購入履歴取込
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Amazonの「注文履歴」→「注文レポートをリクエスト」でダウンロードしたCSVをアップロードしてください。
        ASINが一致する商品は在庫追加、未登録の商品は自動作成されます。
      </Alert>

      <Paper sx={{ p: 3 }}>
        <Stack spacing={2} alignItems="flex-start">
          <Button component="label" variant="outlined">
            {file ? file.name : "CSVファイルを選択"}
            <input
              hidden
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Button>
          <Button variant="contained" startIcon={<CloudUploadIcon />} disabled={!file || busy} onClick={run}>
            取込実行
          </Button>
        </Stack>
      </Paper>

      {results.length > 0 && (
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="h6" mb={1}>
            取込結果（{results.length}件）
          </Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>商品名</TableCell>
                  <TableCell>状態</TableCell>
                  <TableCell align="right">数量</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.product_id} hover>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={r.status === "added" ? "success" : "warning"}
                        label={r.status === "added" ? "在庫追加" : "新規作成"}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ color: "success.main", fontWeight: 600 }}>
                      +{r.qty}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
