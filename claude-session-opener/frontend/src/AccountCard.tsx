import { useEffect, useState } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import KeyIcon from "@mui/icons-material/Key";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { post } from "./api";
import type { AccountView } from "./types";

const PHASE_TEXT: Record<string, string> = {
  starting: "認証 URL を発行しています…",
  retrying: "やり直しています。新しい認証 URL を取得しています…",
  submitting: "コードを確認しています…",
  finishing: "トークンを受け取っています…",
};

const SOURCE_TEXT: Record<string, string> = {
  schedule: "毎日の実行",
  manual: "手動実行",
  verify: "トークンの動作確認",
};

function TokenChip({ account }: { account: AccountView }) {
  if (!account.token.present) {
    return <Chip size="small" color="warning" label="トークン未設定" />;
  }
  const left = account.token.daysLeft;
  if (left === null) return <Chip size="small" color="success" label="トークンあり" />;
  if (left <= 0) return <Chip size="small" color="error" label="期限切れ" />;
  return (
    <Chip
      size="small"
      color={left <= 14 ? "warning" : "success"}
      label={`残り約 ${left} 日`}
    />
  );
}

export default function AccountCard({
  account,
  onToast,
}: {
  account: AccountView;
  onToast: (message: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(0);
  const [screenOpen, setScreenOpen] = useState(false);

  const { flow, run } = account;
  // 通信中（pending）はどのボタンも押させない。
  // 発行・削除・手動実行は、サーバー側が何か動かしている間も押させない。
  // 発行フローの中の入力欄と送信は「入力待ち」のときだけ触れる
  // （フロー実行中というだけで全部止めると、コードを入れる欄まで無効になる）。
  const idleBusy = account.busy || pending !== null;
  const flowBusy = pending !== null || flow.phase !== "waiting";

  // エラーが出たら CLI の画面を開いて見せる（畳んだままだと気付けない）。
  useEffect(() => {
    if (flow.error) setScreenOpen(true);
  }, [flow.error]);

  // 認証 URL が発行し直されたら、手元のコードはもう通らないので消す。
  useEffect(() => {
    if (flow.urlRotated) setCode("");
  }, [flow.urlRotated, flow.url]);

  useEffect(() => {
    if (!flow.active) setCode("");
  }, [flow.active]);

  // 押した瞬間から、サーバーの新しい状態が届くまでボタンを止める。
  // POST の応答だけで解除すると、SSE が届くまでの一瞬だけ押せてしまう。
  useEffect(() => {
    setPending(null);
  }, [account]);

  // 状態が届かないまま固まらないための保険。
  useEffect(() => {
    if (pending === null) return undefined;
    const timer = window.setTimeout(() => setPending(null), 8000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  const call = async (name: string, pathname: string, body: Record<string, unknown> = {}) => {
    setPending(name);
    const res = await post(pathname, { account: account.slug, ...body });
    if (!res.ok) {
      setPending(null);
      if (res.error) onToast(res.error);
    }
    return res.ok;
  };

  const canReadClipboard =
    typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

  const pasteCode = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCode(text.trim());
    } catch {
      onToast("クリップボードを読めませんでした。入力欄に直接貼り付けてください。");
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(flow.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast("コピーできませんでした。URL を選択してコピーしてください。");
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    const ok = await call("submit", "/api/token/submit", { code });
    if (ok) setCode("");
  };

  const saveManualToken = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manualToken.trim()) return;
    const ok = await call("save", "/api/token/save", { token: manualToken });
    if (ok) setManualToken("");
  };

  const notice = account.notice && account.notice.id !== dismissedNotice ? account.notice : null;
  const progressPhase = PHASE_TEXT[flow.phase];
  const showProgress = flow.active && flow.phase !== "waiting";

  return (
    <Card variant="outlined">
      <CardHeader
        title={account.name}
        subheader={`毎日 ${account.scheduleTime} (UTC) に実行`}
        action={<Box sx={{ pt: 1, pr: 1 }}><TokenChip account={account} /></Box>}
        titleTypographyProps={{ variant: "h6", fontSize: "1.05rem" }}
      />
      {showProgress && <LinearProgress />}
      <CardContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          {notice && (
            <Alert severity={notice.kind} onClose={() => setDismissedNotice(notice.id)}>
              <Box sx={{ whiteSpace: "pre-line" }}>{notice.text}</Box>
            </Alert>
          )}

          {flow.active ? (
            <Stack spacing={2}>
              {flow.error && (
                <Alert severity="error">
                  <AlertTitle>コードが通りませんでした</AlertTitle>
                  <Box sx={{ whiteSpace: "pre-line" }}>{flow.error}</Box>
                  {flow.urlRotated && (
                    <Box sx={{ mt: 1 }}>
                      認証 URL が新しくなりました。<b>下の URL を開き直して、コードを取り直して</b>ください。
                      前の URL で取ったコードはもう使えません。
                    </Box>
                  )}
                </Alert>
              )}

              {progressPhase && (
                <Typography variant="body2" color="text.secondary">
                  {progressPhase}
                </Typography>
              )}

              {flow.url && (
                <Stack spacing={1}>
                  <Typography variant="subtitle2">1. この URL をブラウザで開いて認証する</Typography>
                  <TextField
                    value={flow.url}
                    size="small"
                    fullWidth
                    slotProps={{ input: { readOnly: true, sx: { fontSize: "0.8rem" } } }}
                    onFocus={(event) => event.target.select()}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ContentCopyIcon />}
                      onClick={copyUrl}
                    >
                      {copied ? "コピーしました" : "URL をコピー"}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<OpenInNewIcon />}
                      href={flow.url}
                      target="_blank"
                      rel="noopener"
                    >
                      開く
                    </Button>
                  </Stack>
                </Stack>
              )}

              {flow.url && (
                <Box component="form" onSubmit={submitCode}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">2. 表示されたコードを貼り付けて送信する</Typography>
                    <TextField
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="認証コードを貼り付け"
                      size="small"
                      fullWidth
                      autoComplete="off"
                      spellCheck={false}
                      disabled={flowBusy}
                      slotProps={{ input: { sx: { fontSize: "0.85rem" } } }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button
                        type="submit"
                        variant="contained"
                        loading={pending === "submit" || flow.phase === "submitting"}
                        disabled={flowBusy || !code.trim()}
                      >
                        送信
                      </Button>
                      {canReadClipboard && (
                        <Button
                          variant="outlined"
                          startIcon={<ContentPasteIcon />}
                          onClick={pasteCode}
                          disabled={flowBusy}
                        >
                          貼り付け
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                </Box>
              )}

              {flow.screen && (
                <Accordion
                  disableGutters
                  elevation={0}
                  expanded={screenOpen}
                  onChange={(_, open) => setScreenOpen(open)}
                  sx={{ bgcolor: "transparent" }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                      CLI の画面（うまくいかないときの手がかり）
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0 }}>
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 1,
                        fontSize: "0.72rem",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        bgcolor: "action.hover",
                        borderRadius: 1,
                        maxHeight: 240,
                        overflow: "auto",
                      }}
                    >
                      {flow.screen}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              <Box>
                <Button
                  color="inherit"
                  size="small"
                  loading={pending === "cancel"}
                  onClick={() => call("cancel", "/api/token/cancel")}
                >
                  中止する
                </Button>
              </Box>
            </Stack>
          ) : (
            <Stack spacing={2}>
              {!account.token.present && (
                <Alert severity="warning">
                  長期トークンが未設定です。Claude Pro/Max のアカウントで1年有効なトークンを発行してください。
                </Alert>
              )}
              {account.token.present &&
                account.token.daysLeft !== null &&
                account.token.daysLeft <= 14 && (
                  <Alert severity={account.token.daysLeft <= 0 ? "error" : "warning"}>
                    {account.token.daysLeft <= 0
                      ? "長期トークンの有効期限が切れています。発行し直してください。"
                      : `長期トークンは残り約 ${account.token.daysLeft} 日で切れます。`}
                  </Alert>
                )}

              {account.token.present && (
                <Typography variant="caption" color="text.secondary">
                  保存されているトークン: {account.token.length} 文字
                  （中身は表示しません。アカウント間で文字数が違う場合は、
                  取り込みが途中で切れています）
                </Typography>
              )}

              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                <Button
                  variant="contained"
                  startIcon={<KeyIcon />}
                  loading={pending === "start"}
                  disabled={idleBusy}
                  onClick={() => call("start", "/api/token/start")}
                >
                  {account.token.present ? "長期トークンを再発行" : "長期トークンを発行"}
                </Button>
                {account.token.present && (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteOutlinedIcon />}
                    disabled={idleBusy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    削除
                  </Button>
                )}
              </Stack>

              <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent" }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    手元で発行したトークンを貼り付ける
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 0 }}>
                  <Box component="form" onSubmit={saveManualToken}>
                    <Stack spacing={1}>
                      <Typography variant="body2" color="text.secondary">
                        パソコンのターミナルで <code>claude setup-token</code> を実行し、表示されたトークンを貼り付けても登録できます。
                      </Typography>
                      <TextField
                        value={manualToken}
                        onChange={(event) => setManualToken(event.target.value)}
                        placeholder="sk-ant-..."
                        size="small"
                        fullWidth
                        autoComplete="off"
                        spellCheck={false}
                        disabled={idleBusy}
                        slotProps={{ input: { sx: { fontSize: "0.85rem" } } }}
                      />
                      <Box>
                        <Button
                          type="submit"
                          variant="outlined"
                          loading={pending === "save"}
                          disabled={idleBusy || !manualToken.trim()}
                        >
                          トークンを保存
                        </Button>
                      </Box>
                    </Stack>
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Stack>
          )}

          <Divider />

          <Stack spacing={1}>
            <Typography variant="subtitle2">実行の状態</Typography>
            {run.running ? (
              <Alert severity="info" icon={false}>
                実行しています…
              </Alert>
            ) : run.at ? (
              <Alert severity={run.ok ? "success" : "error"}>
                <AlertTitle sx={{ fontSize: "0.85rem" }}>
                  {run.at}
                  {run.source && SOURCE_TEXT[run.source] ? `（${SOURCE_TEXT[run.source]}）` : ""}
                </AlertTitle>
                <Box sx={{ wordBreak: "break-word" }}>{run.summary}</Box>
                {run.detail && (
                  <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent", mt: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 0 }}>
                      <Typography variant="body2">詳しい内容を見る</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0 }}>
                      <Box
                        component="pre"
                        sx={{
                          m: 0,
                          p: 1,
                          fontSize: "0.72rem",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          bgcolor: "action.hover",
                          borderRadius: 1,
                          maxHeight: 220,
                          overflow: "auto",
                        }}
                      >
                        {run.detail}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                )}
              </Alert>
            ) : (
              <Typography variant="body2" color="text.secondary">
                このアドオンを起動してからの実行はまだありません。
              </Typography>
            )}

            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                loading={pending === "run" || run.running}
                disabled={idleBusy || !account.token.present}
                onClick={() => call("run", "/api/run")}
              >
                今すぐ実行して確認
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<NotificationsActiveIcon />}
                loading={pending === "test"}
                disabled={pending !== null}
                onClick={() => call("test", "/api/notify/test")}
              >
                テスト通知を送る
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<NetworkCheckIcon />}
                loading={pending === "diagnose"}
                disabled={pending !== null}
                onClick={() => call("diagnose", "/api/diagnose")}
              >
                接続を確認
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </CardContent>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>長期トークンを削除しますか？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            「{account.name}」の長期トークンを削除します。削除すると毎日の実行ができなくなります。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>やめる</Button>
          <Button
            color="error"
            loading={pending === "delete"}
            onClick={async () => {
              await call("delete", "/api/token/delete");
              setConfirmDelete(false);
            }}
          >
            削除する
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
