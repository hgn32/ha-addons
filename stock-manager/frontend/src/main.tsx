import CssBaseline from "@mui/material/CssBaseline";
import { createTheme, ThemeProvider, useMediaQuery } from "@mui/material";
import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { StoreProvider } from "./store";

function Root() {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: prefersDark ? "dark" : "light",
          primary: { main: "#2563eb" },
          background: { default: prefersDark ? "#111827" : "#f4f6f9" },
        },
        shape: { borderRadius: 10 },
      }),
    [prefersDark]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <StoreProvider>
          <App />
        </StoreProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
