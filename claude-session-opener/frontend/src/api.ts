// Ingress のベースパスは実行時にしか分からないので、index.html へ
// server.js が埋め込んだものを使う（埋め込みが無い開発時は空）。
let base = (window as unknown as { __INGRESS_PATH__?: string }).__INGRESS_PATH__ || "";
if (base.includes("{{")) base = "";
export const BASE = base.replace(/\/$/, "");

export interface ApiResult {
  ok: boolean;
  error?: string;
}

export async function post(pathname: string, body: Record<string, unknown>): Promise<ApiResult> {
  try {
    const res = await fetch(`${BASE}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as ApiResult;
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error || `サーバーエラー (${res.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `サーバーに接続できませんでした: ${(e as Error).message}` };
  }
}

export const eventsUrl = () => `${BASE}/api/events`;
export const stateUrl = () => `${BASE}/api/state`;
