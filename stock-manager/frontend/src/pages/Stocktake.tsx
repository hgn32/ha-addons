import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, imageUrl } from "../api";
import { useStore } from "../store";
import { InventoryItem } from "../types";

// カメラ用のバーコードライブラリ(@zxing)は重いので、カメラを開いた時だけ遅延読込する
const BarcodeScanner = lazy(() => import("../components/BarcodeScanner"));

type Mode = "adjust" | "add";

interface CommitLog {
  name: string;
  before: number;
  after: number;
  mode: Mode;
  at: number;
}

// スキャン音（成功/失敗）。WebAudioで軽いビープを鳴らす。
function beep(ok: boolean): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.2));
    osc.onended = () => ctx.close();
  } catch {
    // 音が出せない環境は無視
  }
}

export default function Stocktake() {
  const { stockOf, reloadInventory, reloadTransactions, toast } = useStore();

  const [mode, setMode] = useState<Mode>("adjust");
  const [cameraOn, setCameraOn] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [current, setCurrent] = useState<InventoryItem | null>(null);
  const [count, setCount] = useState(0);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<CommitLog[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<{ code: string; t: number }>({ code: "", t: 0 });
  // 最新stateをコールバックから参照するためのref
  const currentRef = useRef<InventoryItem | null>(null);
  currentRef.current = current;

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;

      // カメラ連続検出/誤連打対策: 同一コードの2秒以内の再検出は無視
      const now = Date.now();
      if (lastScanRef.current.code === code && now - lastScanRef.current.t < 2000) return;
      lastScanRef.current = { code, t: now };

      try {
        const product = await api.get<InventoryItem>(`/api/products/by-barcode/${encodeURIComponent(code)}`);
        setNotFound(null);
        beep(true);
        const cur = currentRef.current;
        if (cur && cur.id === product.id) {
          // 同じ品目を連続スキャン → カウントを1つ増やす
          setCount((c) => c + 1);
        } else {
          // 別の品目に切り替え（カウントは1から）
          setCurrent(product);
          setCount(1);
        }
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("該当") || msg.includes("ありません")) {
          setNotFound(code);
          beep(false);
        } else {
          toast(msg || "検索に失敗しました", "error");
        }
      }
    },
    [toast]
  );

  // カメラ未使用時はスキャナ/手入力にフォーカスを保つ
  useEffect(() => {
    if (!cameraOn) focusInput();
  }, [cameraOn, current, focusInput]);

  const commit = async () => {
    if (!current) return;
    if (!(count >= 0)) return;
    setBusy(true);
    const before = stockOf(current.id);
    try {
      if (mode === "adjust") {
        await api.post("/api/inventory/adjust", { product_id: current.id, quantity: count });
      } else {
        // 実数量としてそのまま加算（入り数換算しない）
        await api.post("/api/inventory/add", { product_id: current.id, quantity: count, by_piece: false });
      }
      const after = mode === "adjust" ? count : before + count;
      setLogs((prev) => [{ name: current.name, before, after, mode, at: Date.now() }, ...prev].slice(0, 20));
      toast(mode === "adjust" ? `「${current.name}」を ${count} に調整しました` : `「${current.name}」に ${count} 追加しました`);
      await Promise.all([reloadInventory(), reloadTransactions()]);
      setCurrent(null);
      setCount(0);
      lastScanRef.current = { code: "", t: 0 };
      focusInput();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    } finally {
      setBusy(false);
    }
  };

  const currentStock = current ? stockOf(current.id) : 0;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
        簡単棚卸し（バーコード）
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        バーコードをスキャンして在庫を登録します。USBバーコードリーダー（キーボード入力）や手入力にも対応。
      </Typography>

      {/* モード選択 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>登録方法</Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={mode}
          onChange={(_, v: Mode | null) => v && setMode(v)}
        >
          <ToggleButton value="adjust">数えた数にする（棚卸し）</ToggleButton>
          <ToggleButton value="add">数えた数を追加（入庫）</ToggleButton>
        </ToggleButtonGroup>
      </Paper>

      {/* 入力 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            inputRef={inputRef}
            label="バーコード（JANコード）"
            placeholder="スキャン または 手入力して Enter"
            size="small"
            fullWidth
            autoFocus
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCode(manualCode);
                setManualCode("");
              }
            }}
          />
          <Button
            variant={cameraOn ? "contained" : "outlined"}
            startIcon={<PhotoCameraIcon />}
            onClick={() => setCameraOn((v) => !v)}
            sx={{ whiteSpace: "nowrap" }}
          >
            {cameraOn ? "カメラ停止" : "カメラ"}
          </Button>
        </Stack>
        {cameraOn && (
          <Box sx={{ mt: 2 }}>
            <Suspense fallback={<Typography variant="body2" color="text.secondary">カメラを起動中...</Typography>}>
              <BarcodeScanner onDetected={handleCode} onError={(m) => { toast(m, "error"); setCameraOn(false); }} />
            </Suspense>
          </Box>
        )}
      </Paper>

      {notFound && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setNotFound(null)}>
          未登録のバーコードです（{notFound}）。品目マスタにJANコードを登録してください。
        </Alert>
      )}

      {/* 現在のスキャン対象 */}
      {current && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center">
              <Avatar src={current.photo ? imageUrl(current.photo) : undefined} variant="rounded" sx={{ width: 64, height: 64 }}>📦</Avatar>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography fontWeight={700} noWrap>{current.name}</Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap">
                  <Chip size="small" label={`現在在庫: ${currentStock}`} />
                  {current.piece_count > 1 && <Chip size="small" variant="outlined" label={`${current.piece_count}個入`} />}
                </Stack>
              </Box>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ mt: 2 }}>
              <IconButton color="error" onClick={() => setCount((c) => Math.max(0, c - 1))}>
                <RemoveIcon />
              </IconButton>
              <TextField
                type="number"
                label={mode === "adjust" ? "実在庫数" : "追加数"}
                value={count}
                onChange={(e) => setCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                slotProps={{ htmlInput: { min: 0, style: { textAlign: "center" } } }}
                sx={{ width: 120 }}
              />
              <IconButton color="success" onClick={() => setCount((c) => c + 1)}>
                <AddIcon />
              </IconButton>
            </Stack>

            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 1 }}>
              {mode === "adjust"
                ? `在庫を ${currentStock} → ${count} に調整します`
                : `在庫を ${currentStock} → ${currentStock + count} に加算します`}
            </Typography>

            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button fullWidth color="inherit" onClick={() => { setCurrent(null); setCount(0); focusInput(); }}>
                キャンセル
              </Button>
              <Button
                fullWidth
                variant="contained"
                color={mode === "adjust" ? "warning" : "success"}
                startIcon={<CheckCircleIcon />}
                disabled={busy}
                onClick={commit}
              >
                確定
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* 直近の確定ログ */}
      {logs.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>直近の登録</Typography>
          <Stack spacing={0.5}>
            {logs.map((l, i) => (
              <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ fontSize: "0.85rem" }}>
                <Chip
                  size="small"
                  label={l.mode === "adjust" ? "棚卸し" : "入庫"}
                  color={l.mode === "adjust" ? "warning" : "success"}
                />
                <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{l.name}</Typography>
                <Typography variant="body2" color="text.secondary">{l.before} → {l.after}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
