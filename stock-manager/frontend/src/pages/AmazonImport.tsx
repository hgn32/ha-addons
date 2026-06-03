import BlockIcon from "@mui/icons-material/Block";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import InventoryIcon from "@mui/icons-material/Inventory";
import SyncIcon from "@mui/icons-material/Sync";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
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
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import AmazonManageDialog from "../components/AmazonManageDialog";
import { useStore } from "../store";
import { AmazonCrawlSummary, AmazonQueueItem, AmazonSettings, ImportResult } from "../types";

export default function AmazonImport() {
  const { reloadProducts, reloadInventory, reloadTransactions, toast } = useStore();

  const [settings, setSettings] = useState<AmazonSettings | null>(null);
  const [cookie, setCookie] = useState("");
  const [queue, setQueue] = useState<AmazonQueueItem[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [savingCookie, setSavingCookie] = useState(false);
  const [manageItem, setManageItem] = useState<AmazonQueueItem | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    setSettings(await api.get<AmazonSettings>("/api/amazon/settings"));
  }, []);
  const loadQueue = useCallback(async () => {
    setQueue(await api.get<AmazonQueueItem[]>("/api/amazon/queue?status=pending"));
  }, []);

  useEffect(() => {
    loadSettings().catch((e) => toast((e as Error).message, "error"));
    loadQueue().catch(() => undefined);
  }, [loadSettings, loadQueue, toast]);

  const saveCookie = async () => {
    setSavingCookie(true);
    try {
      await api.post("/api/amazon/settings", { cookie });
      setCookie("");
      toast("Cookieを保存しました");
      await loadSettings();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingCookie(false);
    }
  };

  const crawl = async () => {
    setCrawling(true);
    try {
      const s = await api.post<AmazonCrawlSummary>("/api/amazon/crawl");
      toast(`取得 ${s.fetched}件（自動 ${s.auto} / 要確認 ${s.queued} / スキップ ${s.skipped}）`);
      await Promise.all([loadQueue(), loadSettings(), reloadProducts(), reloadInventory(), reloadTransactions()]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setCrawling(false);
    }
  };

  const ignore = async (item: AmazonQueueItem) => {
    try {
      await api.post(`/api/amazon/queue/${item.id}/ignore`);
      toast(`「${item.product_name}」を在庫管理しない（無視）に設定しました`);
      await loadQueue();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const runCsv = async () => {
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

      {/* --- 1. Cookie設定 --- */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={1}>
          1. ログインCookie設定
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          ブラウザでAmazon.co.jpにログイン後、DevToolsで取得したCookie文字列を貼り付けてください。
          セッション切れ時は再取得して差し替えてください。
        </Alert>
        <Stack spacing={2} alignItems="flex-start">
          <Chip
            label={settings?.cookie_set ? "Cookie設定済み" : "Cookie未設定"}
            color={settings?.cookie_set ? "success" : "default"}
            size="small"
          />
          <TextField
            label="Cookie"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            placeholder="session-id=...; ubid-acbjp=...; at-acbjp=..."
          />
          <Button variant="contained" disabled={!cookie.trim() || savingCookie} onClick={saveCookie}>
            Cookieを保存
          </Button>
        </Stack>
      </Paper>

      {/* --- 2. クロール実行 --- */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={1}>
          2. 購入履歴を取得（差分同期）
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Button
            variant="contained"
            startIcon={<SyncIcon />}
            disabled={!settings?.cookie_set || crawling}
            onClick={crawl}
          >
            {crawling ? "取得中..." : "今すぐ取得"}
          </Button>
          <Typography variant="body2" color="text.secondary">
            前回同期: {settings?.last_sync ? new Date(settings.last_sync).toLocaleString("ja-JP") : "未実行"}
            {settings?.cron ? ` / 定期実行: ${settings.cron}` : ""}
          </Typography>
        </Stack>
      </Paper>

      {/* --- 3. 取込待ちリスト --- */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={1}>
          3. 取込待ちリスト（{queue.length}件）
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          マスタに一致した商品は自動で在庫加算済みです。未登録の商品をここで振り分けます。
        </Typography>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>商品名</TableCell>
                <TableCell>ASIN</TableCell>
                <TableCell>購入日</TableCell>
                <TableCell align="right">数量</TableCell>
                <TableCell align="right">単価</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {queue.map((q) => (
                <TableRow key={q.id} hover>
                  <TableCell>{q.product_name}</TableCell>
                  <TableCell>{q.asin}</TableCell>
                  <TableCell>{new Date(q.purchased_at).toLocaleDateString("ja-JP")}</TableCell>
                  <TableCell align="right">{q.quantity}</TableCell>
                  <TableCell align="right">¥{q.unit_price}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<InventoryIcon />}
                        onClick={() => setManageItem(q)}
                      >
                        在庫管理する
                      </Button>
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={<BlockIcon />}
                        onClick={() => ignore(q)}
                      >
                        管理しない
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {queue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    取込待ちの商品はありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* --- CSV取込（補助） --- */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" mb={1}>
          CSVから取込（補助）
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Alert severity="info" sx={{ mb: 2 }}>
          Amazonの「注文レポートをリクエスト」でダウンロードしたCSVからも取込できます。
          ASIN一致は在庫追加、未登録は自動作成されます。
        </Alert>
        <Stack spacing={2} alignItems="flex-start">
          <Button component="label" variant="outlined">
            {file ? file.name : "CSVファイルを選択"}
            <input hidden type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Button>
          <Button variant="contained" startIcon={<CloudUploadIcon />} disabled={!file || busy} onClick={runCsv}>
            取込実行
          </Button>
        </Stack>

        {results.length > 0 && (
          <TableContainer sx={{ mt: 2 }}>
            <Table size="small">
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
        )}
      </Paper>

      <AmazonManageDialog
        open={Boolean(manageItem)}
        item={manageItem}
        onClose={() => setManageItem(null)}
        onDone={loadQueue}
      />
    </Box>
  );
}
