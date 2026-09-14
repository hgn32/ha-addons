import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import LinearProgress from "@mui/material/LinearProgress";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import AccountCard from "./AccountCard";
import { eventsUrl } from "./api";
import type { ViewState } from "./types";

export default function App() {
  const [state, setState] = useState<ViewState | null>(null);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const es = new EventSource(eventsUrl());
    es.onopen = () => setConnected(true);
    es.onmessage = (event) => {
      try {
        setState(JSON.parse(event.data) as ViewState);
        setConnected(true);
      } catch {
        /* 壊れた行は無視して次の更新を待つ */
      }
    };
    // EventSource は自動で再接続するので、ここでは表示を切り替えるだけ。
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return (
    <Box sx={{ minHeight: "100vh", pb: 6 }}>
      <AppBar position="static" elevation={0}>
        <Toolbar variant="dense">
          <Typography variant="h6" component="h1" sx={{ fontSize: "1.05rem" }}>
            Claude 認証（長期トークン）
          </Typography>
        </Toolbar>
      </AppBar>
      {!connected && <LinearProgress color="warning" />}

      <Container maxWidth="sm" sx={{ pt: 2 }}>
        <Stack spacing={2}>
          {!connected && (
            <Alert severity="warning">
              アドオンとの接続が切れています。再接続しています…
            </Alert>
          )}

          {state?.notifyProblem && (
            <Alert severity="error">
              Home Assistant への通知に失敗しています。{state.notifyProblem}
            </Alert>
          )}

          {state && !state.notifyEnabled && (
            <Alert severity="info">
              設定タブで「Home Assistant へ通知する」が無効になっています。実行が失敗しても通知は出ません。
            </Alert>
          )}

          {state === null && <Typography color="text.secondary">読み込み中…</Typography>}

          {state && state.accounts.length === 0 && (
            <Alert severity="warning">
              アカウントが設定されていません。アドオンの設定タブで accounts を追加してください。
            </Alert>
          )}

          {state?.accounts.map((account) => (
            <AccountCard key={account.slug} account={account} onToast={setToast} />
          ))}

          <Typography variant="caption" color="text.secondary">
            実行ログは Home Assistant の「ログ」タブに出ます。詳しい使い方はアドオンの README を参照してください。
          </Typography>
        </Stack>
      </Container>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" variant="filled" onClose={() => setToast("")}>
          {toast}
        </Alert>
      </Snackbar>
    </Box>
  );
}
