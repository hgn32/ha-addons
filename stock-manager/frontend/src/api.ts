// Resolve the HA Ingress base path injected into index.html at serve time.
// In dev (or when not behind Ingress) the placeholder is left untouched, so we
// fall back to an empty base.
let base = (window as unknown as { __INGRESS_PATH__?: string }).__INGRESS_PATH__ || "";
if (base === "__INGRESS_PATH__") base = "";
export const BASE = base.replace(/\/$/, "");

export const imageUrl = (photo: string): string => `${BASE}/images/${photo}`;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${url}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || err.message || res.statusText || "エラーが発生しました");
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  del: (url: string) => request<void>("DELETE", url),
};
