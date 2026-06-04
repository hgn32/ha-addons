import { Component, ErrorInfo, ReactNode } from "react";

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null };

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        fontFamily: "monospace",
        padding: "32px",
        maxWidth: "900px",
        margin: "0 auto",
      }}>
        <div style={{
          background: "#d32f2f",
          color: "#fff",
          borderRadius: "8px",
          padding: "16px 24px",
          marginBottom: "16px",
        }}>
          <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>
            アプリがクラッシュしました
          </div>
          <div style={{ fontSize: "14px", opacity: 0.9 }}>
            ページをリロードすると復旧することがあります
          </div>
        </div>

        <div style={{
          background: "#fff3e0",
          border: "1px solid #e65100",
          borderRadius: "8px",
          padding: "16px 24px",
          marginBottom: "16px",
        }}>
          <div style={{ fontWeight: 700, marginBottom: "8px", color: "#e65100" }}>
            {error.name}: {error.message}
          </div>
          <pre style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            fontSize: "12px",
            margin: 0,
            color: "#333",
          }}>
            {error.stack}
          </pre>
        </div>

        {info && (
          <div style={{
            background: "#f5f5f5",
            border: "1px solid #ccc",
            borderRadius: "8px",
            padding: "16px 24px",
            marginBottom: "16px",
          }}>
            <div style={{ fontWeight: 700, marginBottom: "8px", fontSize: "13px" }}>
              Component Stack
            </div>
            <pre style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              fontSize: "12px",
              margin: 0,
              color: "#555",
            }}>
              {info.componentStack}
            </pre>
          </div>
        )}

        <button
          onClick={() => window.location.reload()}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "10px 24px",
            fontSize: "14px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ページをリロード
        </button>
      </div>
    );
  }
}
