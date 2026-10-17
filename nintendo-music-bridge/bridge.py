"""ブリッジ API: Nintendo Music の検索・ブラウズ・再生操作を HTTP で外に出す。

- 検索・ゲーム・プレイリストのメタデータは Web 版と同じ公開カタログ API を呼ぶ
  （ログイン不要。調査モードの記録と、ログインなしでの実測で確認した）。
  音源（暗号化メディア）には触れない。
- 再生操作は、ログイン済みの Chrome を CDP で操作する（ページ遷移とボタンのクリック）。
  ボタンは調査モードで記録した aria-label と、Web 版の翻訳データの文言で探す。
  https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent
"""

from __future__ import annotations

import asyncio
import json
import time

import aiohttp

from discover import CDP_PORT

API = "https://api.m.nintendo.com/catalog"
SITE = "https://music.nintendo.com"

# ボタンの文言。Web 版の翻訳データ（公開 JS の en-US / ja-JP）で同じ意味のキーが持つ値をすべて入れる
# （英語は Play / Previous track / Next track、日本語は 再生・再生する / 前の曲・曲戻し / 次の曲・曲送り）
LABELS = {
    "play": ["Play", "再生", "再生する"],
    "previous": ["Previous track", "前の曲", "曲戻し"],
    "next": ["Next track", "次の曲", "曲送り"],
}

# いまの再生状態を読む（ページの状態は変えない）
STATUS_JS = r"""
(() => {
  const a = [...document.querySelectorAll('audio')].find(m => m.currentSrc) || document.querySelector('audio');
  const md = navigator.mediaSession && navigator.mediaSession.metadata;
  return {
    url: location.href,
    title: md ? md.title : null,
    album: md ? md.album : null,
    artwork: md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : null,
    playbackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null,
    paused: a ? a.paused : null,
    ended: a ? a.ended : null,
    position: a ? a.currentTime : null,
    duration: a && isFinite(a.duration) ? a.duration : null,
  };
})()
"""

# クリックする要素の画面上の中心座標を返す。見つからなければ null
FIND_JS = r"""
((kind, L) => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = el => (el.getAttribute('aria-label') || el.innerText || '').trim();
  let el = null;
  if (kind === 'playlist-play') {
    // プレイリストのページ本体（#main-column）の「Play」ボタン。プレーヤーバーや右パネルのものは除く
    const main = document.querySelector('#main-column') || document.body;
    el = [...main.querySelectorAll('button, [role=button]')].find(b => vis(b) && L.play.includes(label(b)));
  } else {
    // プレーヤーバー: Previous track と Next track の間のボタンが再生/一時停止
    const byAria = names => [...document.querySelectorAll('button[aria-label]')]
      .find(b => vis(b) && names.includes(b.getAttribute('aria-label')));
    const prev = byAria(L.previous);
    const next = byAria(L.next);
    if (kind === 'previous') el = prev;
    else if (kind === 'next') el = next;
    else if (prev && next) {
      const all = [...document.querySelectorAll('button')];
      el = all.slice(all.indexOf(prev) + 1, all.indexOf(next)).find(vis) || null;
    }
  }
  if (!el) return null;
  el.scrollIntoView({block: 'center'});
  const r = el.getBoundingClientRect();
  return {x: r.left + r.width / 2, y: r.top + r.height / 2, label: label(el)};
})
"""


def _thumb(o: dict | None) -> str | None:
    return (o or {}).get("thumbnailURL")


def simple_game(g: dict) -> dict:
    return {"id": g.get("id"), "name": g.get("name"), "hardware": g.get("formalHardware"),
            "thumbnail": _thumb(g)}


def simple_playlist(p: dict) -> dict:
    return {"id": p.get("id"), "name": p.get("name"), "type": p.get("type"),
            "tracks_num": p.get("tracksNum", len(p.get("tracks") or [])),
            "game": simple_game(p["game"]) if p.get("game") else None,
            "thumbnail": _thumb(p)}


def simple_track(t: dict) -> dict:
    payloads = ((t.get("media") or {}).get("payloadList") or [])
    duration = next((x.get("durationMillis") for x in payloads if x.get("durationMillis")), None)
    return {"id": t.get("id"), "name": t.get("name"),
            "game": simple_game(t["game"]) if t.get("game") else None,
            "duration_ms": duration, "thumbnail": _thumb(t)}


class Bridge:
    def __init__(self, log, lang: str = "ja-JP", country: str = "JP") -> None:
        self.log = log
        self.lang = lang
        self.country = country
        self.lock = asyncio.Lock()  # 画面操作は同時に1つだけ

    # ------------------------------------------------------------ カタログ
    async def _catalog(self, path: str, **params) -> dict | list:
        q = {"lang": self.lang, "country": self.country, **{k: v for k, v in params.items() if v is not None}}
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20), trust_env=True) as s:
            async with s.get(f"{API}{path}", params=q) as r:
                if r.status != 200:
                    raise RuntimeError(f"カタログ API {path} が {r.status} を返しました: {(await r.text())[:200]}")
                return await r.json(content_type=None)

    async def search(self, q: str, type_: str | None = None, limit: int = 20) -> dict:
        body = await self._catalog("/resources:search", q=q, type=type_, limit=limit)
        out: dict[str, list] = {"games": [], "playlists": [], "tracks": []}
        for item in body.get("items", []):
            if item.get("game"):
                out["games"].append(simple_game(item["game"]))
            elif item.get("officialPlaylist") or item.get("playlist"):
                out["playlists"].append(simple_playlist(item.get("officialPlaylist") or item["playlist"]))
            elif item.get("track"):
                out["tracks"].append(simple_track(item["track"]))
        return out

    async def games(self) -> list[dict]:
        body = await self._catalog("/gameGroups", groupingPolicy="HARDWARE")
        return [{"hardware": h.get("formalHardware"), "games": [simple_game(g) for g in h.get("items", [])]}
                for h in body.get("hardware", [])]

    async def game_playlists(self, game_id: str) -> dict:
        body = await self._catalog(f"/games/{game_id}/relatedPlaylists")
        pls = [body[k] for k in ("allPlaylist", "bestPlaylist") if body.get(k)]
        pls += (body.get("miscPlaylistSet") or {}).get("officialPlaylists", [])
        return {"playlists": [simple_playlist(p) for p in pls]}

    async def playlist(self, playlist_id: str) -> dict:
        body = await self._catalog(f"/officialPlaylists/{playlist_id}")
        return {**simple_playlist(body), "tracks": [simple_track(t) for t in body.get("tracks", [])]}

    # ------------------------------------------------------------ CDP
    async def _page_ws(self, session: aiohttp.ClientSession) -> str:
        async with session.get(f"http://127.0.0.1:{CDP_PORT}/json/list") as r:
            pages = [t for t in await r.json(content_type=None) if t.get("type") == "page"
                     and not t.get("url", "").startswith(("chrome://", "devtools://"))]
        if not pages:
            raise RuntimeError("Chrome のタブが見つかりません")
        # music.nintendo.com のタブを優先
        pages.sort(key=lambda t: "music.nintendo.com" not in t.get("url", ""))
        return pages[0]["webSocketDebuggerUrl"]

    async def _cdp(self, calls: list[tuple[str, dict]]) -> list[dict]:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
            async with s.ws_connect(await self._page_ws(s), max_msg_size=0) as ws:
                results = []
                for i, (method, params) in enumerate(calls, 1):
                    await ws.send_json({"id": i, "method": method, "params": params})
                    async for msg in ws:
                        data = json.loads(msg.data)
                        if data.get("id") == i:
                            if "error" in data:
                                raise RuntimeError(f"{method}: {data['error']}")
                            results.append(data.get("result", {}))
                            break
                return results

    async def _eval(self, expr: str):
        (res,) = await self._cdp([("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                                         "awaitPromise": True})])
        if res.get("exceptionDetails"):
            raise RuntimeError(f"ページ内の処理に失敗しました: {res['exceptionDetails'].get('text')}")
        return res.get("result", {}).get("value")

    async def status(self) -> dict:
        return await self._eval(STATUS_JS)

    async def _click(self, kind: str, timeout: float = 15) -> str:
        deadline = time.monotonic() + timeout
        while True:
            pos = await self._eval(f"({FIND_JS})({json.dumps(kind)}, {json.dumps(LABELS, ensure_ascii=False)})")
            if pos:
                break
            if time.monotonic() > deadline:
                raise RuntimeError(f"画面上に操作するボタン（{kind}）が見つかりませんでした")
            await asyncio.sleep(0.5)
        # 本物のマウス操作と同じ入力イベントでクリックする
        ev = {"x": pos["x"], "y": pos["y"], "button": "left", "clickCount": 1}
        await self._cdp([("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": pos["x"], "y": pos["y"]}),
                         ("Input.dispatchMouseEvent", {"type": "mousePressed", **ev}),
                         ("Input.dispatchMouseEvent", {"type": "mouseReleased", **ev})])
        return pos["label"]

    async def _wait_playing(self, before_title: str | None = None, timeout: float = 15) -> dict:
        deadline = time.monotonic() + timeout
        st: dict = {}
        while time.monotonic() < deadline:
            st = await self.status()
            if st.get("paused") is False and (before_title is None or st.get("title") != before_title):
                return st
            await asyncio.sleep(0.5)
        raise RuntimeError(f"再生が始まりませんでした（状態: {st}）")

    async def play_playlist(self, playlist_id: str, index: int = 0) -> dict:
        async with self.lock:
            await self._cdp([("Page.navigate", {"url": f"{SITE}/{self.lang}/playlist/{playlist_id}/"})])
            await asyncio.sleep(2)
            label = await self._click("playlist-play")
            self.log(f"プレイリスト {playlist_id} の再生ボタン（{label}）を押しました")
            st = await self._wait_playing()
            # 指定の曲まで「次の曲」で送る（曲の行を直接押す方法は調べていないため）
            for _ in range(index):
                title = st.get("title")
                await self._click("next")
                st = await self._wait_playing(before_title=title)
            return st

    async def control(self, action: str) -> dict:
        async with self.lock:
            st = await self.status()
            if action == "pause" and st.get("paused") is False:
                await self._click("playpause")
            elif action == "resume" and st.get("paused") is not False:
                await self._click("playpause")
            elif action in ("next", "previous"):
                title = st.get("title")
                await self._click(action)
                return await self._wait_playing(before_title=title)
            elif action not in ("pause", "resume"):
                raise RuntimeError(f"不明な操作です: {action}")
            await asyncio.sleep(1)
            return await self.status()
