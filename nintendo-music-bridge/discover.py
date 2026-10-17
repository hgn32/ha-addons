"""調査モード: ログイン済みの Chrome で Web 版自身が呼ぶ API と画面の部品を記録する。

ブリッジ API（検索・プレイリスト・再生）を推測で書かないための下調べ。
Chrome の DevTools Protocol（CDP）でページを観察するだけで、ページの操作はしない。
https://chromedevtools.github.io/devtools-protocol/tot/Network/

記録しないもの（秘密情報）:
- リクエストヘッダ（Authorization 等）
- api.m.nintendo.com の /catalog/ 以外のレスポンス本文（ライセンス・権利トークン・セッション）
- クエリの値のうちトークンらしいもの
"""

from __future__ import annotations

import asyncio
import json
import time
from urllib.parse import parse_qsl, urlsplit

import aiohttp

CDP_PORT = 9222
API_HOST = "api.m.nintendo.com"
# YouTube Music の Web 版が呼ぶ API（music.youtube.com/youtubei/v1/...）
YTM_HOST = "music.youtube.com"
SECRET_HINTS = ("token", "auth", "key", "secret", "session", "license", "sig")
MAX_ENTRIES = 300

# 画面の部品（ボタン・リンク・メディア要素）を集めるスクリプト。ページの状態は変えない
DOM_SCRIPT = r"""
(() => {
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      testid: el.getAttribute('data-testid') || undefined,
      text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60) || undefined,
      href: el.getAttribute('href') || undefined,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80) || undefined,
      visible: r.width > 0 && r.height > 0,
    };
  };
  const controls = [...document.querySelectorAll('button, a[href], [role=button], [role=slider], input')]
    .map(pick).filter(c => c.visible);
  const media = [...document.querySelectorAll('audio, video')].map(m => ({
    tag: m.tagName.toLowerCase(), paused: m.paused, currentTime: m.currentTime,
    duration: m.duration, ended: m.ended, src: (m.currentSrc || '').slice(0, 40),
    hasMediaKeys: !!m.mediaKeys,
  }));
  return { url: location.href, title: document.title, controls, media,
           mediaSession: navigator.mediaSession && navigator.mediaSession.metadata ? {
             title: navigator.mediaSession.metadata.title,
             artist: navigator.mediaSession.metadata.artist,
             album: navigator.mediaSession.metadata.album,
             playbackState: navigator.mediaSession.playbackState } : null };
})()
"""


def shape(v, depth: int = 0):
    """JSON の形を残して中身を縮める（配列は先頭2件、文字列は60文字）。"""
    if depth > 8:
        return "…"
    if isinstance(v, dict):
        return {k: ("<秘匿>" if any(h in k.lower() for h in SECRET_HINTS) else shape(x, depth + 1))
                for k, x in v.items()}
    if isinstance(v, list):
        return [shape(x, depth + 1) for x in v[:2]] + ([f"…ほか{len(v) - 2}件"] if len(v) > 2 else [])
    if isinstance(v, str) and len(v) > 60:
        return v[:60] + "…"
    return v


def redact_query(url: str) -> dict:
    parts = urlsplit(url)
    query = {k: ("<秘匿>" if any(h in k.lower() for h in SECRET_HINTS) else v)
             for k, v in parse_qsl(parts.query, keep_blank_values=True)}
    return {"path": parts.path, "query": query}


class Discoverer:
    def __init__(self, log) -> None:
        self.log = log
        self.entries: list[dict] = []
        self.task: asyncio.Task | None = None
        self.started_at = 0.0

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def start(self) -> None:
        if self.running:
            return
        self.entries = []
        self.started_at = time.time()
        self.task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
        self.task = None

    def add(self, kind: str, data: dict) -> None:
        if len(self.entries) < MAX_ENTRIES:
            self.entries.append({"t": round(time.time() - self.started_at, 1), "kind": kind, **data})

    async def _page_ws(self, session: aiohttp.ClientSession) -> str:
        async with session.get(f"http://127.0.0.1:{CDP_PORT}/json/list") as r:
            pages = [t for t in await r.json(content_type=None)
                     if t.get("type") == "page" and ("music.nintendo.com" in t.get("url", "") or "music.youtube.com" in t.get("url", ""))]
        if not pages:
            raise RuntimeError("Nintendo Music / YouTube Music のタブが見つかりません")
        return pages[0]["webSocketDebuggerUrl"]

    async def _run(self) -> None:
        try:
            async with aiohttp.ClientSession() as session:
                ws_url = await self._page_ws(session)
                async with session.ws_connect(ws_url, max_msg_size=0) as ws:
                    await self._loop(ws)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.add("error", {"message": str(e)})
            self.log(f"調査モードでエラー: {e}")

    async def _loop(self, ws) -> None:
        next_id = 0
        pending: dict[int, asyncio.Future] = {}
        requests: dict[str, dict] = {}

        async def call(method: str, params: dict | None = None) -> dict:
            nonlocal next_id
            next_id += 1
            fut = asyncio.get_running_loop().create_future()
            pending[next_id] = fut
            await ws.send_json({"id": next_id, "method": method, "params": params or {}})
            return await asyncio.wait_for(fut, 15)

        async def fetch_body(req_id: str, info: dict) -> None:
            try:
                res = await call("Network.getResponseBody", {"requestId": req_id})
                body = json.loads(res.get("body", ""))
                self.add("response", {**info, "body": shape(body)})
            except Exception as e:
                self.add("response", {**info, "body": f"<読めませんでした: {e}>"})

        async def reader() -> None:
            async for msg in ws:
                data = json.loads(msg.data)
                if "id" in data:
                    fut = pending.pop(data["id"], None)
                    if fut and not fut.done():
                        if "error" in data:
                            fut.set_exception(RuntimeError(str(data["error"])))
                        else:
                            fut.set_result(data.get("result", {}))
                    continue
                method, p = data.get("method"), data.get("params", {})
                if method == "Network.requestWillBeSent":
                    url = p["request"]["url"]
                    host = urlsplit(url).hostname
                    if host == API_HOST or (host == YTM_HOST and "/youtubei/" in url):
                        info = {"method": p["request"]["method"], **redact_query(url)}
                        requests[p["requestId"]] = info
                        self.add("request", info)
                elif method == "Network.loadingFinished":
                    info = requests.pop(p["requestId"], None)
                    if info and (info["path"].startswith("/catalog/") and info["method"] == "GET"
                                 or info["path"].startswith("/youtubei/")):
                        asyncio.create_task(fetch_body(p["requestId"], info))
                elif method == "Page.frameNavigated" and not p["frame"].get("parentId"):
                    self.add("navigate", {"url": p["frame"]["url"]})

        read_task = asyncio.create_task(reader())
        try:
            await call("Network.enable")
            await call("Page.enable")
            self.log("調査モードを開始しました")
            await read_task
        finally:
            read_task.cancel()

    async def snapshot_dom(self) -> None:
        """いまの画面の部品を記録する（調査中でなくても使える）。"""
        async with aiohttp.ClientSession() as session:
            ws_url = await self._page_ws(session)
            async with session.ws_connect(ws_url, max_msg_size=0) as ws:
                await ws.send_json({"id": 1, "method": "Runtime.evaluate",
                                    "params": {"expression": DOM_SCRIPT, "returnByValue": True}})
                async for msg in ws:
                    data = json.loads(msg.data)
                    if data.get("id") == 1:
                        value = data.get("result", {}).get("result", {}).get("value")
                        if self.started_at == 0:
                            self.started_at = time.time()
                        self.add("dom", value or {"error": str(data)})
                        return

    def report(self) -> str:
        return json.dumps({"entries": self.entries}, ensure_ascii=False, indent=1)
