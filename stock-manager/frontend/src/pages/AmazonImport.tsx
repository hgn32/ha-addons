import BlockIcon from "@mui/icons-material/Block";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import InventoryIcon from "@mui/icons-material/Inventory";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import RefreshIcon from "@mui/icons-material/Refresh";
import SyncIcon from "@mui/icons-material/Sync";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
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
  const [serverRunning, setServerRunning] = useState(false);
  const [savingCookie, setSavingCookie] = useState(false);
  const [notifyTesting, setNotifyTesting] = useState(false);
  const [manageItem, setManageItem] = useState<AmazonQueueItem | null>(null);
  const [enrichRetrying, setEnrichRetrying] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);

  // クロール実行中か（UI操作 or バックグラウンド/定期実行のどちらでも）
  const running = crawling || serverRunning;
  const prevRunningRef = useRef(false);

  const loadSettings = useCallback(async () => {
    setSettings(await api.get<AmazonSettings>("/api/amazon/settings"));
  }, []);
  const loadQueue = useCallback(async () => {
    setQueue(await api.get<AmazonQueueItem[]>("/api/amazon/queue?status=pending"));
  }, []);
  const loadLogs = useCallback(async () => {
    setLogs(await api.get<AmazonLogEntry[]>("/api/amazon/logs"));
  }, []);

  useEffect(() => {
    loadSettings().catch((e) => toast((e as Error).message, "error"));
    loadQueue().catch(() => undefined);
    loadLogs().catch(() => undefined);
  }, [loadSettings, loadQueue, loadLogs, toast]);

  // 実行ログ・実行状態を定期ポーリングして随時更新する。
  // これにより、クロール完了前でも進捗ログがリアルタイムに見える。
  useEffect(() => {
    let active = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const [logsData, status] = await Promise.all([
          api.get<AmazonLogEntry[]>("/api/amazon/logs"),
          api.get<{ running: boolean }>("/api/amazon/status"),
        ]);
        if (!active) return;
        setLogs(logsData);
        setServerRunning(status.running);
      } catch {
        // ポーリング失敗は無視（次回再試行）
      }
    };
    const id = window.setInterval(tick, 2500);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // クロールが完了した瞬間（実行中→停止）に一覧・設定を自動リフレッシュする。
  // 定期実行(cron)で取り込まれた分も、画面を開いたままで反映される。
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      loadQueue().catch(() => undefined);
      loadSettings().catch(() => undefined);
      reloadProducts().catch(() => undefined);
      reloadInventory().catch(() => undefined);
      reloadTransactions().catch(() => undefined);
    }
    prevRunningRef.current = running;
  }, [running, loadQueue, loadSettings, reloadProducts, reloadInventory, reloadTransactions]);

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
      toast(`取得 ${s.fetched}件（確認待ち ${s.queued} / スキップ ${s.skipped}）`);
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

  // HA通知のテスト送信。設定済みのnotifyサービスへ1件送り、結果を表示する。
  const notifyTest = async () => {
    setNotifyTesting(true);
    try {
      const r = await api.post<{ ok: boolean; skipped?: boolean; status?: number; detail?: string; service?: string }>(
        "/api/amazon/notify-test"
      );
      if (r.ok) {
        toast(`通知を送信しました（notify.${r.service}）。Home Assistantで通知を確認してください。`);
      } else {
        toast(`通知失敗${r.status ? ` (${r.status})` : ""}: ${r.detail || "不明なエラー"}`, "error");
      }
      await loadLogs();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setNotifyTesting(false);
    }
  };

  const enrichRetry = async () => {
    setEnrichRetrying(true);
    try {
      const r = await api.post<{ total: number; success: number }>("/api/amazon/enrich-retry", {});
      toast(`補完リトライ完了: ${r.success}/${r.total}件成功`);
      await loadQueue();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setEnrichRetrying(false);
    }
  };

  const enrichFailedCount = queue.filter(q => q.enrich_failed).length;

  const skip = async (item: AmazonQueueItem) => {
    try {
      await api.post(`/api/amazon/queue/${item.id}/skip`, {});
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
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
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
            slotProps={{ htmlInput: { style: { resize: "vertical" } } }}
          />
          <Button variant="contained" disabled={!cookie.trim() || savingCookie} onClick={saveCookie}>
            Cookieを保存
          </Button>
        </Stack>
      </Paper>

      {/* --- 2. クロール実行 --- */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Typography variant="h6" mb={1}>
          2. 購入履歴を取得
        </Typography>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              sx={{ flexShrink: 0 }}
              startIcon={running ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              disabled={!settings?.cookie_set || running}
              onClick={() => crawl(false)}
            >
              {running ? "取得中..." : "差分取得"}
            </Button>
            <Button
              variant="outlined"
              sx={{ flexShrink: 0 }}
              startIcon={<SyncIcon />}
              disabled={!settings?.cookie_set || running}
              onClick={() => crawl(true)}
            >
              90日分取込
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              sx={{ flexShrink: 0 }}
              startIcon={notifyTesting ? <CircularProgress size={16} color="inherit" /> : <NotificationsActiveIcon />}
              disabled={notifyTesting}
              onClick={notifyTest}
            >
              通知テスト
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            前回同期: {settings?.last_sync ? new Date(settings.last_sync).toLocaleString("ja-JP") : "未実行"}
            {settings?.cron ? ` / 定期実行: ${settings.cron}` : ""}
          </Typography>
        </Stack>
      </Paper>

      {/* --- 3. 実行ログ --- */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1} flexWrap="wrap" gap={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6">3. 実行ログ</Typography>
            {running && <Chip size="small" color="primary" label="実行中…" />}
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<RefreshIcon />} onClick={loadLogs}>更新</Button>
            <Button size="small" color="inherit" startIcon={<DeleteSweepIcon />} onClick={clearLogs}>クリア</Button>
          </Stack>
        </Stack>
        {running && <LinearProgress sx={{ mb: 1 }} />}
        <Box
          ref={logBoxRef}
          sx={{
            bgcolor: "#1e1e1e",
            color: "#d4d4d4",
            fontFamily: "monospace",
            fontSize: "0.75rem",
            p: 1.5,
            borderRadius: 1,
            minHeight: 260,
            overflowY: "auto",
            resize: "vertical",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {logs.length === 0 ? (
            <span style={{ color: "#888" }}>ログなし — 「差分取得」を実行すると進捗がここにリアルタイム表示されます</span>
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
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
          <Typography variant="h6" sx={{ flexShrink: 0 }}>
            4. 取込待ちリスト（{queue.length}件）
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {enrichFailedCount > 0 && (
              <Button
                size="small"
                variant="outlined"
                color="warning"
                disabled={enrichRetrying}
                startIcon={enrichRetrying ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
                onClick={enrichRetry}
                sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
              >
                補完リトライ ({enrichFailedCount})
              </Button>
            )}
            <Button
              size="small"
              color="error"
              variant="outlined"
              sx={{ flexShrink: 0 }}
              onClick={async () => {
                if (!confirm("取込待ちリストをすべて削除します。同期日時は保持されるため、次回クロールは差分取得になります。よろしいですか？")) return;
                await api.del("/api/amazon/queue");
                await loadQueue();
                toast("取込待ちリストをクリアしました。");
              }}
            >
              履歴リセット
            </Button>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={2}>
          購入履歴を取り込む品目を1件ずつ確認します。在庫に追加するか、削除するかを選択してください。
        </Typography>
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 48, p: 1 }} />
                <TableCell>品目名</TableCell>
                <TableCell />
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
                  <TableCell>
                    <Typography variant="body2" component="span">
                      {q.product_name}
                      {q.enrich_failed && (
                        <Chip size="small" label="補完失敗" color="warning" variant="outlined" sx={{ ml: 0.5, height: 16, fontSize: "0.6rem", verticalAlign: "middle" }} />
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {q.asin} · {new Date(q.purchased_at).toLocaleDateString("ja-JP")} · {q.quantity}個
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ p: 1 }}>
                    <Stack direction="column" spacing={0.5} alignItems="stretch">
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<InventoryIcon />}
                          sx={{ whiteSpace: "nowrap" }}
                          onClick={() => setManageItem(q)}
                        >
                          追加
                        </Button>
                        <Button
                          size="small"
                          color="inherit"
                          variant="outlined"
                          startIcon={<BlockIcon />}
                          sx={{ whiteSpace: "nowrap" }}
                          onClick={() => skip(q)}
                        >
                          削除
                        </Button>
                      </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {queue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4, color: "text.secondary" }}>
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
