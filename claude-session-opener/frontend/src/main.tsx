import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme, useMediaQuery } from "@mui/material";
import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

function Root() {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: prefersDark ? "dark" : "light",
          primary: { main: "#c1613c" },
          background: { default: prefersDark ? "#14100e" : "#faf7f3" },
        },
        shape: { borderRadius: 10 },
        typography: {
          // 日本語を含むので、フォントは端末のものに任せる。
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif',
        },
      }),
    [prefersDark],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
