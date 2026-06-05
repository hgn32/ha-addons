import BlockIcon from "@mui/icons-material/Block";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import InventoryIcon from "@mui/icons-material/Inventory";
import RefreshIcon from "@mui/icons-material/Refresh";
import SyncIcon from "@mui/icons-material/Sync";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, imageUrl } from "../api";
import AmazonManageDialog from "../components/AmazonManageDialog";
import { useStore } from "../store";
import { AmazonCrawlSummary, AmazonLogEntry, AmazonQueueItem, AmazonSettings } from "../types";

export default function AmazonImport() {
  const { reloadProducts, reloadInventory, reloadTransactions, toast } = useStore();

  const [settings, setSettings] = useState<AmazonSettings | null>(null);
  const [cookie, setCookie] = useState("");
  const [queue, setQueue] = useState<AmazonQueueItem[]>([]);
  const [logs, setLogs] = useState<AmazonLogEntry[]>([]);
  const [crawling, setCrawling] = useState(false);
  const [savingCookie, setSavingCookie] = useState(false);
  const [manageItem, setManageItem] = useState<AmazonQueueItem | null>(null);
  const [showAll, setShowAll] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const loadSettings = useCallback(async () => {
    setSettings(await api.get<AmazonSettings>("/api/amazon/settings"));
  }, []);
  const loadQueue = useCallback(async (all?: boolean) => {
    const s = all !== undefined ? all : showAll;
    setQueue(await api.get<AmazonQueueItem[]>(`/api/amazon/queue?status=${s ? "all" : "pending"}`));
  }, [showAll]);
  const loadLogs = useCallback(async () => {
    setLogs(await api.get<AmazonLogEntry[]>("/api/amazon/logs"));
  }, []);

  useEffect(() => {
    loadSettings().catch((e) => toast((e as Error).message, "error"));
    loadQueue().catch(() => undefined);
    loadLogs().catch(() => undefined);
  }, [loadSettings, loadQueue, loadLogs, toast]);

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

  const crawl = async (full = false) => {
    setCrawling(true);
    try {
      const s = await api.post<AmazonCrawlSummary>("/api/amazon/crawl", { full });
      toast(`取得 ${s.fetched}件（自動 ${s.auto} / 要確認 ${s.queued} / スキップ ${s.skipped}）`);
      await Promise.all([loadQueue(), loadSettings(), loadLogs(), reloadProducts(), reloadInventory(), reloadTransactions()]);
    } catch (e) {
      toast((e as Error).message, "error");
      await loadLogs();
    } finally {
      setCrawling(false);
    }
  };

  const clearLogs = async () => {
    await api.del("/api/amazon/logs");
    setLogs([]);
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

  const levelColor: Record<string, string> = {
    info: "inherit",
    warn: "#ed6c02",
    error: "#d32f2f",
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        Amazon購入履歴取込
      </Typography>

      {/* --- 1. Cookie設定 --- */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={1}>
          1. ログインCookie設定
        </Typography>
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>取得手順（cURLコマンドをそのまま貼るだけでOK）:</strong><br />
          1. ブラウザで <strong>Amazon.co.jp</strong> にログインし<br />
          2. <strong>F12</strong> → 「Network」タブを開く<br />
          &nbsp;&nbsp;&nbsp;<a href="https://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first" target="_blank" rel="noreferrer">注文履歴ページ</a>を開く<br />
          3. フィルター欄に <strong>order-history</strong> と入力して対象のリクエストを絞り込む<br />
          4. 表示されたリクエストを<strong>右クリック</strong><br />
          5. 「コピー」→ <strong>「cURL (bash) としてコピー」</strong> を選択<br />
          6. コピーしたテキストを<strong>そのまま</strong>下のテキストボックスに貼り付けて「Cookieを保存」<br />
          <br />
          Cookie の値だけを貼り付けても構いません。セッション切れ時は同じ手順で差し替えてください。
        </Alert>
        <Stack spacing={2} alignItems="flex-start">
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={settings?.cookie_set ? "Cookie設定済み" : "Cookie未設定"}
              color={settings?.cookie_set ? "success" : "default"}
              size="small"
            />
            {settings?.cookie_set && (
              <Typography variant="caption" color="text.secondary">
                {settings.cookie_length}文字 / 先頭: {settings.cookie_preview}
              </Typography>
            )}
          </Stack>
          <TextField
            label="Cookie / cURL コマンド"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            placeholder="cURL コマンドをそのまま貼り付け、または Cookie の値のみ貼り付け"
          />
          <Button variant="contained" disabled={!cookie.trim() || savingCookie} onClick={saveCookie}>
            Cookieを保存
          </Button>
        </Stack>
      </Paper>

      {/* --- 2. クロール実行 --- */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={1}>
          2. 購入履歴を取得
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Button
            variant="contained"
            startIcon={<SyncIcon />}
            disabled={!settings?.cookie_set || crawling}
            onClick={() => crawl(false)}
          >
            {crawling ? "取得中..." : "差分取得"}
          </Button>
          <Button
            variant="outlined"
            startIcon={<SyncIcon />}
            disabled={!settings?.cookie_set || crawling}
            onClick={() => crawl(true)}
          >
            90日分取込
          </Button>
          <Typography variant="body2" color="text.secondary">
            前回同期: {settings?.last_sync ? new Date(settings.last_sync).toLocaleString("ja-JP") : "未実行"}
            {settings?.cron ? ` / 定期実行: ${settings.cron}` : ""}
          </Typography>
        </Stack>
      </Paper>

      {/* --- 3. 実行ログ --- */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography variant="h6">3. 実行ログ</Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<RefreshIcon />} onClick={loadLogs}>更新</Button>
            <Button size="small" color="inherit" startIcon={<DeleteSweepIcon />} onClick={clearLogs}>クリア</Button>
          </Stack>
        </Stack>
        <Box
          ref={logBoxRef}
          sx={{
            bgcolor: "#1e1e1e",
            color: "#d4d4d4",
            fontFamily: "monospace",
            fontSize: "0.75rem",
            p: 1.5,
            borderRadius: 1,
            height: 260,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {logs.length === 0 ? (
            <span style={{ color: "#888" }}>ログなし — 「今すぐ取得」を実行するとここに表示されます</span>
          ) : (
            logs.map((e, i) => (
              <div key={i} style={{ color: levelColor[e.level] }}>
                {new Date(e.ts).toLocaleString("ja-JP", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}{" "}
                [{e.level.toUpperCase()}] {e.msg}
              </div>
            ))
          )}
        </Box>
      </Paper>

      {/* --- 4. 取込待ちリスト --- */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography variant="h6">
            4. 取込待ちリスト（{queue.length}件）
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <FormControlLabel
              control={<Switch size="small" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); loadQueue(e.target.checked); }} />}
              label="全件表示（自動処理済み含む）"
            />
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={async () => {
                if (!confirm("取込履歴と同期日時をリセットします。次回クロール時に過去90日分が再取込されます。よろしいですか？")) return;
                await api.del("/api/amazon/queue");
                await loadQueue();
                await loadSettings();
                toast("取込履歴をリセットしました。「今すぐ取得」で再取込してください。");
              }}
            >
              履歴リセット
            </Button>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={2}>
          マスタに一致した品目は自動で在庫加算済みです。未登録の品目をここで振り分けます。
        </Typography>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 56 }} />
                <TableCell>品目名</TableCell>
                <TableCell>ASIN</TableCell>
                <TableCell>購入日</TableCell>
                <TableCell align="right">数量</TableCell>
                <TableCell align="right">単価</TableCell>
                <TableCell>状態</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {queue.map((q) => (
                <TableRow key={q.id} hover>
                  <TableCell sx={{ p: 1 }}>
                    <Avatar
                      src={q.image_url.startsWith("http") ? q.image_url : q.image_url ? imageUrl(q.image_url) : ""}
                      variant="rounded"
                      sx={{ width: 40, height: 40 }}
                    >
                      📦
                    </Avatar>
                  </TableCell>
                  <TableCell>{q.product_name}</TableCell>
                  <TableCell>{q.asin}</TableCell>
                  <TableCell>{new Date(q.purchased_at).toLocaleDateString("ja-JP")}</TableCell>
                  <TableCell align="right">{q.quantity}</TableCell>
                  <TableCell align="right">¥{q.unit_price.toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={{ pending: "要確認", auto: "自動処理済", managed: "管理中", ignored: "無視" }[q.status] ?? q.status}
                      color={{ pending: "warning", auto: "success", managed: "primary", ignored: "default" }[q.status] as "warning" | "success" | "primary" | "default" ?? "default"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {q.status === "pending" && (
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
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {queue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    取込待ちの品目はありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <AmazonManageDialog
        open={Boolean(manageItem)}
        item={manageItem}
        onClose={() => setManageItem(null)}
        onDone={(id) => {
          setQueue((prev) => prev.filter((q) => q.id !== id));
          loadQueue();
        }}
      />
    </Box>
  );
}
