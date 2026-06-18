import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import SearchIcon from "@mui/icons-material/Search";
import { useCallback, useEffect, useState } from "react";
import { useForm, Controller, type FieldPath } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { api, imageUrl } from "../api";
import { useIsMobile } from "../hooks";
import { useStore } from "../store";
import { Product } from "../types";

// 値が入っているときはラベルを上に固定（shrink）する。
// react-hook-form の setValue で自動入力した値は MUI が検知できず、
// ラベルが入力文字と重なるため、watch した値で明示的に shrink させる。
const shrinkLabel = (value: unknown) => ({ inputLabel: { shrink: Boolean(value) || undefined } });

// Amazonの商品名は「メーカー名 商品名」のように先頭にメーカー名が付くことが多いため、
// 取込時に重複表示を避けられるよう先頭のメーカー名と区切り文字を取り除く。
function stripMakerPrefix(name: string, maker: string): string {
  const trimmedName = name.trim();
  const trimmedMaker = maker.trim();
  if (!trimmedMaker || trimmedName.length <= trimmedMaker.length) return trimmedName;
  if (!trimmedName.toLowerCase().startsWith(trimmedMaker.toLowerCase())) return trimmedName;
  const rest = trimmedName
    .slice(trimmedMaker.length)
    .replace(/^[\s\-–—:：,、・/／|｜]+/, "")
    .trim();
  return rest || trimmedName;
}

// Amazon画像は縦長など様々なアスペクト比のため、Avatarでも切り取らず全体を表示する。
const containImgSlotProps = { img: { style: { objectFit: "contain" as const } } };

// JAN/ASINごとの員数を編集するインライン入力。フォーカスを外す or Enterで保存する。
function PieceCountInput({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = () => {
    const n = Math.max(1, parseInt(draft, 10) || 1);
    setDraft(String(n));
    if (n !== value) onSave(n);
  };
  return (
    <TextField
      label="員数"
      type="number"
      size="small"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      slotProps={{ htmlInput: { min: 1 } }}
      sx={{ width: 84, flexShrink: 0 }}
    />
  );
}

interface Props {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  initialJan?: string;
  onCreated?: (product: Product) => void;
}

interface ProductAsin {
  id: string;
  asin: string;
  piece_count: number;
}

interface ProductBarcode {
  id: string;
  code: string;
  piece_count: number;
}

const schema = yup.object({
  name: yup.string().required("名は必須です"),
  volume: yup.string().default(""),
  piece_count: yup.number().integer().min(1).default(1),
  warn_quantity: yup
    .number()
    .transform((value, original) => (original === "" || original === null || Number.isNaN(value) ? 1 : value))
    .integer()
    .min(0)
    .default(1),
  maker: yup.string().default(""),
  jan_code: yup.string().default(""),
  amazon_asin: yup.string().default(""),
  amazon_url: yup.string().default(""),
  category_id: yup.string().default(""),
  location_id: yup.string().default(""),
  note: yup.string().default(""),
});

type FormValues = yup.InferType<typeof schema>;

export default function ProductDialog({ open, product, onClose, initialJan, onCreated }: Props) {
  const { categories, locations, reloadProducts, reloadInventory, toast } = useStore();
  const fullScreen = useIsMobile();
  const [file, setFile] = useState<File | null>(null);
  const [fetchUrl, setFetchUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchingPhoto, setFetchingPhoto] = useState(false);
  const [searchingJan, setSearchingJan] = useState(false);
  const [tab, setTab] = useState(0);
  const [asins, setAsins] = useState<ProductAsin[]>([]);
  const [newAsin, setNewAsin] = useState("");
  const [newAsinPiece, setNewAsinPiece] = useState("1");
  const [barcodes, setBarcodes] = useState<ProductBarcode[]>([]);
  const [newBarcode, setNewBarcode] = useState("");
  const [newBarcodePiece, setNewBarcodePiece] = useState("1");

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { name: "", volume: "", piece_count: 1, warn_quantity: 1, maker: "", jan_code: "", amazon_asin: "", amazon_url: "", category_id: "", location_id: "", note: "" },
  });

  useEffect(() => {
    if (open) {
      setTab(0);
      reset({
        name: product?.name ?? "",
        volume: product?.volume ?? "",
        piece_count: product?.piece_count ?? 1,
        warn_quantity: product?.warn_quantity ?? 1,
        maker: product?.maker ?? "",
        jan_code: product?.jan_code ?? initialJan ?? "",
        amazon_asin: product?.amazon_asin ?? "",
        amazon_url: product?.amazon_url ?? "",
        category_id: product?.category_id ?? "",
        location_id: product?.location_id ?? "",
        note: product?.note ?? "",
      });
      setFile(null);
      setFetchUrl("");
      setNewAsin("");
      setNewAsinPiece("1");
      setNewBarcode("");
      setNewBarcodePiece("1");
      if (product) {
        api.get<ProductAsin[]>(`/api/products/${product.id}/asins`).then(setAsins).catch(() => setAsins([]));
        api.get<ProductBarcode[]>(`/api/products/${product.id}/barcodes`).then(setBarcodes).catch(() => setBarcodes([]));
      } else {
        setAsins([]);
        setBarcodes([]);
      }
    }
  }, [open, product, reset, initialJan]);

  const watchedAmazonUrl = watch("amazon_url");
  const watchedJan = watch("jan_code");
  const watchedName = watch("name");
  const watchedMaker = watch("maker");
  const watchedAsin = watch("amazon_asin");

  const preview = file ? URL.createObjectURL(file) : product?.photo ? imageUrl(product.photo) : "";

  const openAmazonUrl = () => {
    if (watchedAmazonUrl) window.open(watchedAmazonUrl, "_blank", "noopener,noreferrer");
  };

  // JANコードでAmazonを検索してフォームを自動入力する（スクレイピング方式）。
  const runJanSearch = useCallback(async (rawJan: string) => {
    const jan = (rawJan || "").trim();
    if (!jan) return;
    setSearchingJan(true);
    try {
      const data = await api.post<{ name: string; maker: string; jan_code: string; asin: string; product_url: string; image_url: string }>("/api/amazon/search-by-jan", { jan });
      const fields: [FieldPath<FormValues>, string][] = [
        ["name", stripMakerPrefix(data.name, data.maker)],
        ["maker", data.maker],
        ["jan_code", data.jan_code || jan],
        ["amazon_asin", data.asin],
        ["amazon_url", data.product_url],
      ];
      for (const [field, value] of fields) {
        if (value) setValue(field, value);
      }
      if (data.image_url) {
        try {
          const res = await fetch(data.image_url);
          const blob = await res.blob();
          const ext = data.image_url.split(".").pop()?.split("?")[0] ?? "jpg";
          setFile(new File([blob], `amazon_photo.${ext}`, { type: blob.type }));
        } catch {
          // 画像取込失敗は無視
        }
      }
      toast("Amazonから商品情報を取込みました");
    } catch (e) {
      toast((e as Error).message || "Amazon検索に失敗しました", "error");
    } finally {
      setSearchingJan(false);
    }
  }, [setValue, toast]);

  // 新規 + 初期JAN指定時（棚卸からの新規登録）はAmazon検索を自動実行
  useEffect(() => {
    if (open && !product && initialJan) {
      runJanSearch(initialJan);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product, initialJan]);

  const handleFetchProduct = async () => {
    if (!fetchUrl.trim()) return;
    setFetching(true);
    try {
      const data = await api.post<{ name: string; maker: string; jan_code: string; asin: string; product_url: string; image_url: string }>("/api/amazon/fetch-product", { url: fetchUrl });
      const fields: [FieldPath<FormValues>, string][] = [
        ["name", stripMakerPrefix(data.name, data.maker)],
        ["maker", data.maker],
        ["jan_code", data.jan_code],
        ["amazon_asin", data.asin],
        ["amazon_url", data.product_url],
      ];
      for (const [field, value] of fields) {
        if (value) setValue(field, value);
      }
      if (data.image_url) {
        try {
          const res = await fetch(data.image_url);
          const blob = await res.blob();
          const ext = data.image_url.split(".").pop()?.split("?")[0] ?? "jpg";
          setFile(new File([blob], `amazon_photo.${ext}`, { type: blob.type }));
        } catch {
          // 写真取込失敗は無視
        }
      }
      toast("品目情報を取込みました");
    } catch (e) {
      toast((e as Error).message || "取込に失敗しました", "error");
    } finally {
      setFetching(false);
    }
  };

  const addAsin = async () => {
    if (!product || !newAsin.trim()) return;
    try {
      const row = await api.post<ProductAsin>(`/api/products/${product.id}/asins`, {
        asin: newAsin.trim().toUpperCase(),
        piece_count: Math.max(1, parseInt(newAsinPiece, 10) || 1),
      });
      setAsins((prev) => [...prev.filter((a) => a.id !== row.id), row]);
      setNewAsin("");
      setNewAsinPiece("1");
      toast("ASINを追加しました");
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  // ASINごとの員数を更新（在庫加算時の換算に使う）
  const updateAsinPiece = async (asinId: string, pieceCount: number) => {
    setAsins((prev) => prev.map((a) => (a.id === asinId ? { ...a, piece_count: pieceCount } : a)));
    try {
      await api.patch(`/api/products/asins/${asinId}`, { piece_count: pieceCount });
    } catch (e) {
      toast((e as Error).message || "員数の更新に失敗しました", "error");
    }
  };

  const removeAsin = async (asinId: string) => {
    if (!product) return;
    try {
      await api.del(`/api/products/asins/${asinId}`);
      setAsins((prev) => prev.filter((a) => a.id !== asinId));
      toast("ASINを削除しました");
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  // 追加JAN/JANコードの追加・削除（色違い等で複数JANを持つケース）
  const addBarcode = async () => {
    if (!product || !newBarcode.trim()) return;
    try {
      await api.post(`/api/products/${product.id}/barcodes`, {
        code: newBarcode.trim(),
        mode: "additional",
        piece_count: Math.max(1, parseInt(newBarcodePiece, 10) || 1),
      });
      const list = await api.get<ProductBarcode[]>(`/api/products/${product.id}/barcodes`);
      setBarcodes(list);
      setNewBarcode("");
      setNewBarcodePiece("1");
      toast("JANコードを追加しました");
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  // JANコードごとの員数を更新（スキャン入庫時の換算に使う）
  const updateBarcodePiece = async (barcodeId: string, pieceCount: number) => {
    setBarcodes((prev) => prev.map((b) => (b.id === barcodeId ? { ...b, piece_count: pieceCount } : b)));
    try {
      await api.patch(`/api/products/barcodes/${barcodeId}`, { piece_count: pieceCount });
    } catch (e) {
      toast((e as Error).message || "員数の更新に失敗しました", "error");
    }
  };

  const removeBarcode = async (barcodeId: string) => {
    if (!product) return;
    try {
      await api.del(`/api/products/barcodes/${barcodeId}`);
      setBarcodes((prev) => prev.filter((b) => b.id !== barcodeId));
      toast("JANコードを削除しました");
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  const handleFetchPhoto = async () => {
    const url = watchedAmazonUrl;
    if (!url) return;
    setFetchingPhoto(true);
    try {
      const data = await api.post<{ image_url: string }>("/api/amazon/fetch-product", { url });
      if (!data.image_url) return toast("画像URLが取得できませんでした", "error");
      const res = await fetch(data.image_url);
      const blob = await res.blob();
      const ext = data.image_url.split(".").pop()?.split("?")[0] ?? "jpg";
      const f = new File([blob], `amazon_photo.${ext}`, { type: blob.type });
      setFile(f);
      toast("画像を取り込みました");
    } catch (e) {
      toast((e as Error).message || "画像取込に失敗しました", "error");
    } finally {
      setFetchingPhoto(false);
    }
  };

  const onSubmit = async (data: FormValues) => {
    const fd = new FormData();
    (Object.keys(data) as (keyof FormValues)[]).forEach((k) => fd.append(k, String(data[k] ?? "")));
    if (file) fd.append("photo", file);
    try {
      let created: Product | null = null;
      if (product) {
        await api.put(`/api/products/${product.id}`, fd);
        toast("品目を更新しました");
      } else {
        created = await api.post<Product>("/api/products", fd);
        toast("品目を追加しました");
      }
      await Promise.all([reloadProducts(), reloadInventory()]);
      if (created) onCreated?.(created);
      onClose();
    } catch (e) {
      toast((e as Error).message || "エラーが発生しました", "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{product ? "品目編集" : "品目追加"}</DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}>
        <Tab label="基本情報" />
        {product && <Tab label={`JANコード (${barcodes.length})`} />}
        {product && <Tab label={`ASIN (${asins.length})`} />}
      </Tabs>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          {tab === 0 && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {searchingJan && (
                <Box>
                  <LinearProgress sx={{ mb: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    AmazonをJANコードで検索しています…
                  </Typography>
                </Box>
              )}
              {/* Amazon URLから取込（全幅） */}
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <TextField
                  label="Amazon URLから取込"
                  placeholder="https://www.amazon.co.jp/dp/..."
                  fullWidth
                  value={fetchUrl}
                  onChange={(e) => setFetchUrl(e.target.value)}
                  size="small"
                />
                <IconButton
                  color="primary"
                  onClick={handleFetchProduct}
                  disabled={fetching || !fetchUrl.trim()}
                >
                  <CloudDownloadIcon />
                </IconButton>
              </Stack>

              {/* 2カラム（狭い画面では1カラム）にして古いHD画面でもスクロール不要に */}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
                {/* 左カラム */}
                <Stack spacing={2} sx={{ flex: 1, width: "100%" }}>
                  <TextField
                    label="品目名"
                    required
                    fullWidth
                    {...register("name")}
                    slotProps={shrinkLabel(watchedName)}
                    error={!!errors.name}
                    helperText={errors.name?.message}
                  />
                  <Stack direction="row" spacing={2}>
                    <TextField label="内容量" fullWidth placeholder="例: 500ml、1kg、100g×3" {...register("volume")} />
                    <TextField
                      label="員数" type="number" sx={{ width: 100, flexShrink: 0 }}
                      slotProps={{ htmlInput: { min: 1 } }}
                      {...register("piece_count", { valueAsNumber: true })}
                    />
                  </Stack>
                  <TextField
                    label="警告在庫数"
                    type="number"
                    sx={{ width: 200 }}
                    slotProps={{ htmlInput: { min: 0 } }}
                    helperText="在庫がこの数で警告、下回るとエラー表示"
                    {...register("warn_quantity", { valueAsNumber: true })}
                  />
                  <TextField label="メーカー" fullWidth {...register("maker")} slotProps={shrinkLabel(watchedMaker)} />
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <TextField label="JANコード（主）" fullWidth {...register("jan_code")} slotProps={shrinkLabel(watchedJan)} />
                    <IconButton
                      color="primary"
                      aria-label="JANコードでAmazon検索して取込"
                      disabled={!watchedJan || searchingJan}
                      onClick={() => runJanSearch(getValues("jan_code"))}
                    >
                      <SearchIcon />
                    </IconButton>
                  </Stack>
                  <TextField label="Amazon ASIN (メイン)" fullWidth {...register("amazon_asin")} slotProps={shrinkLabel(watchedAsin)} />
                </Stack>

                {/* 右カラム */}
                <Stack spacing={2} sx={{ flex: 1, width: "100%" }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <TextField label="Amazon URL" fullWidth {...register("amazon_url")} slotProps={shrinkLabel(watchedAmazonUrl)} />
                    <IconButton
                      color="info"
                      aria-label="Amazon URLを別タブで開く"
                      disabled={!watchedAmazonUrl}
                      onClick={openAmazonUrl}
                    >
                      <OpenInNewIcon />
                    </IconButton>
                  </Stack>
                  <Controller
                    name="category_id"
                    control={control}
                    render={({ field }) => (
                      <TextField select label="品目カテゴリ" fullWidth {...field}>
                        <MenuItem value="">----</MenuItem>
                        {categories.map((c) => (
                          <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                  <Controller
                    name="location_id"
                    control={control}
                    render={({ field }) => (
                      <TextField select label="置き場" fullWidth {...field}>
                        <MenuItem value="">----</MenuItem>
                        {locations.map((l) => (
                          <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                  <TextField label="メモ" fullWidth multiline minRows={2} slotProps={{ htmlInput: { style: { resize: "vertical" } } }} {...register("note")} />
                </Stack>
              </Stack>

              {/* 写真（全幅） */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Avatar src={preview} variant="rounded" sx={{ width: 64, height: 64 }} slotProps={containImgSlotProps}>
                  📦
                </Avatar>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                  <IconButton component="label" color="primary">
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    <PhotoCameraIcon />
                  </IconButton>
                  <Button
                    variant="outlined"
                    startIcon={<CloudDownloadIcon />}
                    disabled={!watchedAmazonUrl || fetchingPhoto}
                    onClick={handleFetchPhoto}
                  >
                    {fetchingPhoto ? "取込中..." : "Amazonから"}
                  </Button>
                </Stack>
              </Box>
            </Stack>
          )}

          {tab === 1 && product && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                色違い等で複数のJANコードがある場合に追加します。ここに登録したコードはJANコードスキャン時にこの品目として認識されます。
                員数は、そのJANコードをスキャンして入庫した際に1スキャンあたり加算する実在庫数です。
              </Typography>
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>主JANコード（「基本情報」タブで編集）— スキャン入庫は1個ずつ加算</Typography>
                <Typography sx={{ fontWeight: 600 }}>{watchedJan || "未設定"}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>追加のJANコード</Typography>
                <Stack spacing={1}>
                  {barcodes.length === 0 && (
                    <Typography variant="body2" color="text.disabled">追加のJANコードはありません</Typography>
                  )}
                  {barcodes.map((b) => (
                    <Stack key={b.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography sx={{ flexGrow: 1, fontFamily: "monospace", wordBreak: "break-all" }}>{b.code}</Typography>
                      <PieceCountInput value={b.piece_count} onSave={(n) => updateBarcodePiece(b.id, n)} />
                      <IconButton color="error" size="small" onClick={() => removeBarcode(b.id)} aria-label="削除">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                <TextField
                  label="JANコード追加"
                  placeholder="例: 4901234567890"
                  size="small"
                  value={newBarcode}
                  onChange={(e) => setNewBarcode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBarcode(); } }}
                  fullWidth
                />
                <TextField
                  label="員数"
                  type="number"
                  size="small"
                  value={newBarcodePiece}
                  onChange={(e) => setNewBarcodePiece(e.target.value)}
                  slotProps={{ htmlInput: { min: 1 } }}
                  sx={{ width: 84, flexShrink: 0 }}
                />
                <IconButton color="primary" onClick={addBarcode} disabled={!newBarcode.trim()}>
                  <AddIcon />
                </IconButton>
              </Stack>
            </Stack>
          )}

          {tab === 2 && product && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                紐づいたASINはAmazonクロール時に自動でこの品目に在庫加算されます。
                員数は、そのASINを1つ購入したときに加算する実在庫数です（容量違い・まとめ買いの換算に使用）。
              </Typography>
              <Box>
                <Stack spacing={1}>
                  {asins.length === 0 && (
                    <Typography variant="body2" color="text.disabled">ASINが登録されていません</Typography>
                  )}
                  {asins.map((a) => (
                    <Stack key={a.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <Typography sx={{ flexGrow: 1, fontFamily: "monospace", wordBreak: "break-all" }}>{a.asin}</Typography>
                      <PieceCountInput value={a.piece_count} onSave={(n) => updateAsinPiece(a.id, n)} />
                      <IconButton color="error" size="small" onClick={() => removeAsin(a.id)} aria-label="削除">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                <TextField
                  label="ASIN追加"
                  placeholder="B0XXXXXXXXXX"
                  size="small"
                  value={newAsin}
                  onChange={(e) => setNewAsin(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="員数"
                  type="number"
                  size="small"
                  value={newAsinPiece}
                  onChange={(e) => setNewAsinPiece(e.target.value)}
                  slotProps={{ htmlInput: { min: 1 } }}
                  sx={{ width: 84, flexShrink: 0 }}
                />
                <IconButton color="primary" onClick={addAsin} disabled={!newAsin.trim()}>
                  <AddIcon />
                </IconButton>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>キャンセル</Button>
          {tab === 0 && (
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              保存
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
