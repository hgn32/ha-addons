import AddIcon from "@mui/icons-material/Add";
import AddShoppingCartIcon from "@mui/icons-material/AddShoppingCart";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import InventoryIcon from "@mui/icons-material/Inventory";
import LinkIcon from "@mui/icons-material/Link";
import NoPhotographyIcon from "@mui/icons-material/NoPhotography";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import RemoveIcon from "@mui/icons-material/Remove";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, imageUrl } from "../api";
import ProductDialog from "../components/ProductDialog";
import { useIsMobile } from "../hooks";
import { useStore } from "../store";
import { InventoryItem, Product } from "../types";

// カメラ用のJANコードライブラリ(@zxing)は重いので、カメラを開いた時だけ遅延読込する
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
  const { inventory, stockOf, reloadProducts, reloadInventory, reloadTransactions, toast } = useStore();
  const fullScreen = useIsMobile();

  const [mode, setMode] = useState<Mode>("adjust");
  const [cameraOn, setCameraOn] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [current, setCurrent] = useState<InventoryItem | null>(null);
  const [count, setCount] = useState(0);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<CommitLog[]>([]);

  // 「既存品目と紐づける」ダイアログ
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkFilter, setLinkFilter] = useState("");
  const [linking, setLinking] = useState(false);
  // 「Amazonで検索して新規登録」ダイアログ（ProductDialogを初期JAN付きで開く）
  const [newProductOpen, setNewProductOpen] = useState(false);

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
        // 実数量としてそのまま加算（員数換算しない）
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

  // 未登録JANコードを既存品目に紐づける。紐づけ後はスキャン成功と同じ状態（カウント1）にする。
  const linkToProduct = async (item: InventoryItem) => {
    const code = notFound;
    if (!code) return;
    setLinking(true);
    try {
      await api.post(`/api/products/${item.id}/barcodes`, { code });
      await Promise.all([reloadProducts(), reloadInventory()]);
      toast(`「${item.name}」にJANコード ${code} を紐づけました`);
      setLinkOpen(false);
      setNotFound(null);
      beep(true);
      setCurrent(item);
      setCount(1);
      lastScanRef.current = { code, t: Date.now() };
    } catch (e) {
      toast((e as Error).message || "紐づけに失敗しました", "error");
    } finally {
      setLinking(false);
    }
  };

  // Amazon検索から新規作成された品目をそのまま棚卸対象にする
  const handleNewProductCreated = (created: Product) => {
    setNewProductOpen(false);
    setNotFound(null);
    beep(true);
    setCurrent({ ...created, quantity: 0 });
    setCount(1);
    lastScanRef.current = { code: created.jan_code || "", t: Date.now() };
  };

  const filteredForLink = useMemo(() => {
    const q = linkFilter.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.maker.toLowerCase().includes(q) ||
        i.volume.toLowerCase().includes(q) ||
        i.jan_code.toLowerCase().includes(q)
    );
  }, [inventory, linkFilter]);

  const currentStock = current ? stockOf(current.id) : 0;

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
        棚卸
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
          <ToggleButton value="adjust"><InventoryIcon fontSize="small" sx={{ mr: 0.5 }} />数量指定</ToggleButton>
          <ToggleButton value="add"><AddShoppingCartIcon fontSize="small" sx={{ mr: 0.5 }} />追加</ToggleButton>
        </ToggleButtonGroup>
      </Paper>

      {/* 入力 */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            inputRef={inputRef}
            label="JANコード"
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
          <Tooltip title={cameraOn ? "カメラ停止" : "カメラ起動"}>
            <IconButton
              color={cameraOn ? "error" : "default"}
              onClick={() => setCameraOn((v) => !v)}
              sx={{ border: 1, borderColor: cameraOn ? "error.main" : "action.disabled" }}
            >
              {cameraOn ? <NoPhotographyIcon /> : <PhotoCameraIcon />}
            </IconButton>
          </Tooltip>
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
          <Stack spacing={1} sx={{ width: "100%" }}>
            <span>未登録のJANコードです（{notFound}）</span>
            <Stack direction="row" spacing={1} useFlexGap sx={{ width: "100%", flexWrap: "wrap" }}>
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                startIcon={<LinkIcon />}
                onClick={() => { setLinkFilter(""); setLinkOpen(true); }}
              >
                既存品目と紐づけ
              </Button>
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                startIcon={<SearchIcon />}
                onClick={() => setNewProductOpen(true)}
              >
                Amazonで検索
              </Button>
            </Stack>
          </Stack>
        </Alert>
      )}

      {/* 現在のスキャン対象 */}
      {current && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center">
              <Avatar src={current.photo ? imageUrl(current.photo) : undefined} variant="rounded" sx={{ width: 64, height: 64 }} slotProps={{ img: { style: { objectFit: "contain" } } }}>📦</Avatar>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography fontWeight={700} noWrap>{current.name}</Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
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

            <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
              <Tooltip title="キャンセル">
                <IconButton onClick={() => { setCurrent(null); setCount(0); focusInput(); }}>
                  <CloseIcon />
                </IconButton>
              </Tooltip>
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
                  label={l.mode === "adjust" ? "棚卸" : "入庫"}
                  color={l.mode === "adjust" ? "warning" : "success"}
                />
                <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{l.name}</Typography>
                <Typography variant="body2" color="text.secondary">{l.before} → {l.after}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {/* 既存品目と紐づけるダイアログ */}
      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} fullWidth maxWidth="sm" fullScreen={fullScreen}>
        <DialogTitle>既存の品目と紐づける</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            JANコード <strong>{notFound}</strong> を選択した品目に登録します。次回からはスキャンだけで認識されます。
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="品目名・メーカー・JANで絞り込み"
            value={linkFilter}
            onChange={(e) => setLinkFilter(e.target.value)}
            sx={{ mb: 2 }}
          />
          <Stack spacing={1} sx={{ overflowY: "auto" }}>
            {filteredForLink.map((item) => (
              <Card
                key={item.id}
                variant="outlined"
                sx={{ cursor: linking ? "default" : "pointer", "&:hover": { borderColor: "primary.main" } }}
                onClick={() => !linking && linkToProduct(item)}
              >
                <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Avatar src={item.photo ? imageUrl(item.photo) : undefined} variant="rounded" sx={{ width: 40, height: 40 }} slotProps={{ img: { style: { objectFit: "contain" } } }}>📦</Avatar>
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography fontWeight={600} noWrap>{item.name}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        在庫: {item.quantity}
                        {item.jan_code ? ` / JAN: ${item.jan_code}` : ""}
                        {item.maker ? ` / ${item.maker}` : ""}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            ))}
            {filteredForLink.length === 0 && (
              <Typography color="text.secondary" sx={{ textAlign: "center", py: 3 }}>
                該当する品目がありません
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>キャンセル</Button>
        </DialogActions>
      </Dialog>

      {/* Amazonで検索して新規登録（ProductDialogを初期JAN付きで開くと自動検索される） */}
      <ProductDialog
        open={newProductOpen}
        product={null}
        initialJan={notFound ?? undefined}
        onClose={() => setNewProductOpen(false)}
        onCreated={handleNewProductCreated}
      />
    </Box>
  );
}
