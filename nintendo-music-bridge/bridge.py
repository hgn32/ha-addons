"""ブリッジ: Nintendo Music / YouTube Music の再生操作。

- ログイン済みの Chrome を CDP で操作する（ページ遷移とボタンのクリック）。音源（暗号化メディア）には触れない。
  ボタンは画面の部品の aria-label と、Web 版の翻訳データの文言で探す。
  https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent
"""

from __future__ import annotations

import asyncio
import json
import time

import aiohttp

CDP_PORT = 9222
SITE = "https://music.nintendo.com"

# ボタンの文言。Web 版の翻訳データ（公開 JS の en-US / ja-JP）で同じ意味のキーが持つ値をすべて入れる
# （英語は Play / Previous track / Next track、日本語は 再生・再生する / 前の曲・曲戻し / 次の曲・曲送り）
LABELS = {
    "play": ["Play", "再生", "再生する"],
    "previous": ["Previous track", "前の曲", "曲戻し"],
    "next": ["Next track", "次の曲", "曲送り"],
}

# YouTube Music のプレーヤーの下のボタン。実物の画面（日本語）の部品を記録して確認した:
# aria-label「前へ」「再生」「次へ」の button が並ぶ。英語の画面のラベルは測っていないので入れない
YTM_LABELS = {
    "play": [],
    "previous": ["前へ"],
    "next": ["次へ"],
}

# いまの再生状態を読む（ページの状態は変えない）
STATUS_JS = r"""
(() => {
  // Nintendo Music は <audio>、YouTube Music は <video> で再生する
  const all = [...document.querySelectorAll('audio, video')];
  const a = all.find(m => m.currentSrc && !m.paused) || all.find(m => m.currentSrc) || all[0];
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


# Chrome のページに問い合わせて、この秒数返事が無ければ固まったとみなす
CDP_REPLY_TIMEOUT = 10


class PageHung(Exception):
    def __init__(self, method: str, ws_url: str) -> None:
        super().__init__(method)
        self.method = method
        self.ws_url = ws_url


class Bridge:
    def __init__(self, log, lang: str = "ja-JP") -> None:
        self.log = log
        self.lang = lang
        self.lock = asyncio.Lock()  # 画面操作は同時に1つだけ
        self.recover_lock = asyncio.Lock()
        self.recover_count = 0  # タブを開き直した回数（再生の途中で起きたらやり直すため）
        self._stats_reset()

    # ------------------------------------------------------------ CDP
    async def _pages(self, session: aiohttp.ClientSession) -> list[dict]:
        async with session.get(f"http://127.0.0.1:{CDP_PORT}/json/list") as r:
            return [t for t in await r.json(content_type=None) if t.get("type") == "page"
                    and not t.get("url", "").startswith(("chrome://", "devtools://"))]

    async def _new_tab(self, session: aiohttp.ClientSession, url: str) -> None:
        """ブラウザ全体の CDP で新しいタブを開く（Target.createTarget）。
        https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Target.pdl"""
        async with session.get(f"http://127.0.0.1:{CDP_PORT}/json/version") as r:
            ws_url = (await r.json(content_type=None))["webSocketDebuggerUrl"]
        async with session.ws_connect(ws_url, max_msg_size=0) as ws:
            await ws.send_json({"id": 1, "method": "Target.createTarget", "params": {"url": url}})
            async for msg in ws:
                data = json.loads(msg.data)
                if data.get("id") == 1:
                    if "error" in data:
                        raise RuntimeError(f"Target.createTarget: {data['error']}")
                    return

    async def pause_all(self) -> int:
        """全部のタブの <audio>/<video> を止める（止める・一時停止のとき。操作中のタブ以外で
        鳴っているものも止める）。止めた数を返す。"""
        paused = 0
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            async with s.get(f"http://127.0.0.1:{CDP_PORT}/json/list") as r:
                targets = [t for t in await r.json(content_type=None) if t.get("type") == "page"]
            for t in targets:
                try:
                    async with s.ws_connect(f"ws://127.0.0.1:{CDP_PORT}/devtools/page/{t['id']}",
                                            max_msg_size=0) as ws:
                        await ws.send_json({"id": 1, "method": "Runtime.evaluate", "params": {
                            "expression": "[...document.querySelectorAll('audio, video')]"
                                          ".filter(m => !m.paused).map(m => m.pause()).length",
                            "returnByValue": True}})
                        async for msg in ws:
                            data = json.loads(msg.data)
                            if data.get("id") == 1:
                                paused += data.get("result", {}).get("result", {}).get("value") or 0
                                break
                except Exception:
                    continue  # 閉じかけのタブなど
        return paused

    async def reset_tabs(self) -> None:
        """Chrome が起き直したとき: 前の画面が開き直されて鳴り出すことがあるので、音を止め、
        タブを1つにする。"""
        await self.wait_ready()
        await self.pause_all()
        async with self.lock:
            await self._single_tab()

    async def _single_tab(self) -> None:
        """再生を始める前に、操作するタブ（_page_ws が選ぶもの）だけを残して他のタブを閉じる。
        複数のタブで音が重なって鳴らないようにする。"""
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            # ws://127.0.0.1:9222/devtools/page/<タブの id>
            keep = (await self._page_ws(s)).rsplit("/", 1)[-1]
            async with s.get(f"http://127.0.0.1:{CDP_PORT}/json/list") as r:
                targets = [t for t in await r.json(content_type=None) if t.get("type") == "page"]
            closed = 0
            for t in targets:
                if t.get("id") != keep:
                    async with s.get(f"http://127.0.0.1:{CDP_PORT}/json/close/{t['id']}") as r:
                        closed += r.status == 200
            if closed:
                self.log(f"再生の前に、ほかのタブを {closed} 個閉じました")

    async def _page_ws(self, session: aiohttp.ClientSession) -> str:
        pages = await self._pages(session)
        if not pages:
            # 画面でタブを閉じられたとき。Nintendo Music のトップを開き直す
            self.log("Chrome のタブが無いため、Nintendo Music を開き直します")
            await self._new_tab(session, f"{SITE}/{self.lang}/")
            for _ in range(20):
                await asyncio.sleep(0.5)
                if pages := await self._pages(session):
                    break
            else:
                raise RuntimeError("Chrome のタブを開けませんでした")
        # Nintendo Music / YouTube Music のタブを優先
        pages.sort(key=lambda t: not any(h in t.get("url", "") for h in ("music.nintendo.com", "music.youtube.com")))
        return pages[0]["webSocketDebuggerUrl"]

    async def _cdp(self, calls: list[tuple[str, dict]]) -> list[dict]:
        t0 = time.monotonic()
        try:
            try:
                return await self._cdp_inner(calls)
            except PageHung as e:
                await self._recover(e)
                return await self._cdp_inner(calls)
        finally:
            # 再生開始までの時間の内訳をログに出すため、CDP の1回ごとの所要時間を集める
            dt = time.monotonic() - t0
            self.cdp_stats["n"] += 1
            self.cdp_stats["total"] += dt
            self.cdp_stats["max"] = max(self.cdp_stats["max"], dt)

    def _stats_reset(self) -> None:
        self.cdp_stats = {"n": 0, "total": 0.0, "max": 0.0}

    def _stats_text(self) -> str:
        st = self.cdp_stats
        avg = st["total"] / st["n"] if st["n"] else 0
        return f"CDP {st['n']}回・平均{avg:.2f}秒・最大{st['max']:.2f}秒"

    @staticmethod
    async def _reply(ws, i: int) -> dict:
        async for msg in ws:
            data = json.loads(msg.data)
            if data.get("id") == i:
                return data
        raise RuntimeError("Chrome との接続が切れました")

    async def _cdp_inner(self, calls: list[tuple[str, dict]]) -> list[dict]:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as s:
            ws_url = await self._page_ws(s)
            async with s.ws_connect(ws_url, max_msg_size=0) as ws:
                results = []
                for i, (method, params) in enumerate(calls, 1):
                    await ws.send_json({"id": i, "method": method, "params": params})
                    # 接続のタイムアウト（ClientTimeout）は返事待ちには効かない。Chrome のページが
                    # 返事をしないと、いつまでも待ち続けていた（実機で PlayBGM が止まったまま）
                    try:
                        # Page.navigate は移動が始まるまで返事をしないので長めに待つ
                        wait = CDP_REPLY_TIMEOUT * 2 if method == "Page.navigate" else CDP_REPLY_TIMEOUT
                        data = await asyncio.wait_for(self._reply(ws, i), wait)
                    except asyncio.TimeoutError:
                        raise PageHung(method, ws_url)
                    if "error" in data:
                        raise RuntimeError(f"{method}: {data['error']}")
                    results.append(data.get("result", {}))
                return results

    async def _recover(self, e: "PageHung") -> None:
        """ページが CDP に返事をしないとき、そのタブを捨てて Nintendo Music を開き直す。

        実機で、PlayBGM の途中に Runtime.evaluate が返事をしなくなり、止まったままになった。
        コンテナで alert() が開いたページ・無限ループのページを作って確かめたところ、どちらも
        Page.enable / Page.handleJavaScriptDialog にも返事をしなかったので、ダイアログを閉じる
        方法は使わず、タブごと替える。
        """
        async with self.recover_lock:
            tab_id = e.ws_url.rsplit("/", 1)[-1]
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
                if not any(t.get("id") == tab_id for t in await self._pages(s)):
                    return  # 同時に待っていた別の処理が、もう立て直した
            self.log(f"Chrome のページが {CDP_REPLY_TIMEOUT}秒以上返事をしません（{e.method}）。タブを開き直します")
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
                # 原因を絞るため、そのときの Chrome の中身（タブ以外も含む）を残す
                try:
                    async with s.get(f"http://127.0.0.1:{CDP_PORT}/json/list") as r:
                        targets = await r.json(content_type=None)
                    self.log("そのときの Chrome: " + " / ".join(
                        f"{t.get('type')}{'（固まったタブ）' if t.get('id') == tab_id else ''}"
                        f" {t.get('title', '')[:30]} {t.get('url', '')[:70]}" for t in targets))
                except Exception as ex:
                    self.log(f"Chrome の中身を読めませんでした（{type(ex).__name__}）")
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
                # 先に新しいタブを開く。最後のタブを閉じると Chrome ごと終わる（実測）
                await self._new_tab(s, f"{SITE}/{self.lang}/")
                try:
                    async with s.get(f"http://127.0.0.1:{CDP_PORT}/json/close/{tab_id}") as r:
                        await r.read()
                except Exception:
                    pass
            await asyncio.sleep(2)
            self.recover_count += 1
            self.log("返事をしないタブを閉じて、Nintendo Music を開き直しました")

    async def _eval(self, expr: str):
        (res,) = await self._cdp([("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                                         "awaitPromise": True})])
        if res.get("exceptionDetails"):
            raise RuntimeError(f"ページ内の処理に失敗しました: {res['exceptionDetails'].get('text')}")
        return res.get("result", {}).get("value")

    async def status(self) -> dict:
        return await self._eval(STATUS_JS)

    async def _click(self, kind: str, timeout: float = 15, labels: dict = LABELS) -> str:
        deadline = time.monotonic() + timeout
        while True:
            pos = await self._eval(f"({FIND_JS})({json.dumps(kind)}, {json.dumps(labels, ensure_ascii=False)})")
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

    async def wait_ready(self, timeout: float = 60) -> None:
        """Chrome の CDP が使えるようになるまで待つ（起動直後に再生の指示が来たとき用）。"""
        deadline = time.monotonic() + timeout
        while True:
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3)) as s:
                    await self._page_ws(s)
                return
            except Exception as e:
                if time.monotonic() > deadline:
                    raise RuntimeError(f"Chrome の準備ができませんでした（{e}）")
                await asyncio.sleep(1)

    async def play_nm_url(self, url: str) -> dict:
        """Nintendo Music のプレイリスト等のページを開いて、ページ本体の再生ボタンを押す。"""
        t0 = time.monotonic()
        async with self.lock:
            t_lock = time.monotonic()
            self._stats_reset()
            await self._single_tab()
            await self._cdp([("Page.navigate", {"url": url})])
            t_nav = time.monotonic()
            await asyncio.sleep(2)
            label = await self._click("playlist-play")
            t_click = time.monotonic()
            self.log(f"{url} の再生ボタン（{label}）を押しました")
            st = await self._wait_playing()
            t_end = time.monotonic()
            self.log(f"再生開始まで {t_end - t0:.1f}秒（操作待ち {t_lock - t0:.1f} / ページを開く {t_nav - t_lock:.1f}"
                     f" / ボタンが出るまで {t_click - t_nav:.1f} / 鳴り始めるまで {t_end - t_click:.1f}。{self._stats_text()}）")
            return st

    async def open_site(self, service: str) -> dict:
        """パネルの「開く」ボタン: いまのタブで Nintendo Music / YouTube Music のトップを開く。"""
        url = {"nm": f"{SITE}/{self.lang}/", "ytm": "https://music.youtube.com/"}.get(service)
        if url is None:
            raise ValueError(f"不明なサービスです: {service}")
        async with self.lock:
            await self._cdp([("Page.navigate", {"url": url})])
        return {"ok": True, "url": url}

    async def play_ytm(self, list_id: str) -> dict:
        """YouTube Music のプレイリストを再生する。watch?list= を開くと先頭の曲から自動で再生が始まる
        （Chrome は --autoplay-policy=no-user-gesture-required で起動している）。

        実機で分かったこと:
        - 開く直前まで別の曲が鳴っていると、開いた直後の状態確認がその曲を「再生が始まった」と
          取り違える。開き直した新しいページで、このプレイリストの watch が鳴り始めるまで待つ
        - YouTube Music が自動で作るプレイリスト（RDCLAK5uy_...）は、watch?list= を開くと
          playlist?list= の一覧ページに移され、再生が始まらない。そのときは一覧の先頭の曲の
          リンク（watch?v=...&list=<同じID>）を開く
        """
        t0 = time.monotonic()
        async with self.lock:
            t_lock = time.monotonic()
            self._stats_reset()
            await self._single_tab()
            # 開く前のページに目印を付ける。Page.navigate で開き直すとページ（window）が新しくなり、
            # 目印が消える。曲名で比べると、同じプレイリストを同じ曲から開き直したときに
            # 「前の曲のまま」と取り違えた（実機で確認）
            await self._eval("window.__wmpBefore = true")
            await self._cdp([("Page.navigate", {"url": f"https://music.youtube.com/watch?list={list_id}"})])
            t_nav = time.monotonic()
            self.log(f"YouTube Music のプレイリスト {list_id} を開きました")
            t_sound = None  # URL が合っていて鳴っている（新しいページかの確認の前）
            followed = False
            deadline = time.monotonic() + 30
            st: dict = {}
            recovered = self.recover_count
            while time.monotonic() < deadline:
                await asyncio.sleep(1)
                st = await self.status()
                if self.recover_count != recovered:
                    raise RuntimeError("開いている途中でタブを開き直しました")
                url = st.get("url") or ""
                if "/watch" in url and f"list={list_id}" in url and st.get("paused") is False:
                    t_sound = t_sound or time.monotonic()
                    if not await self._eval("window.__wmpBefore === true"):
                        t_end = time.monotonic()
                        self.log(f"再生開始まで {t_end - t0:.1f}秒（操作待ち {t_lock - t0:.1f} / ページを開く {t_nav - t_lock:.1f}"
                                 f" / 鳴っているのを見つけるまで {t_sound - t_nav:.1f} / 新しいページの確認 {t_end - t_sound:.1f}。"
                                 f"{self._stats_text()}）")
                        return st
                if "/playlist" in url and not followed:
                    href = await self._eval(
                        "(() => { const a = [...document.querySelectorAll('a[href*=\"watch?v=\"]')]"
                        f".find(a => a.href.includes('list={list_id}')); return a ? a.href : null; }})()")
                    if href:
                        followed = True
                        self.log(f"一覧ページに移されたため、先頭の曲を開きます（{href}）")
                        await self._cdp([("Page.navigate", {"url": href})])
            raise RuntimeError(f"再生が始まりませんでした（鳴っているのを見つけたのは"
                               f" {'なし' if t_sound is None else f'{t_sound - t_nav:.1f}秒後'}。"
                               f"{self._stats_text()}。状態: {st}）")

    async def _media(self, action: str) -> None:
        """ページ内の <audio>/<video> を直接操作する（ボタンの作りに依存しない）。"""
        await self._eval("(() => { const m = [...document.querySelectorAll('audio, video')].find(x => x.currentSrc);"
                         f" if (m) m.{'pause' if action == 'pause' else 'play'}(); return !!m; }})()")

    async def control(self, action: str) -> dict:
        async with self.lock:
            if action == "resume":
                await self._single_tab()
            st = await self.status()
            if "music.youtube.com" in (st.get("url") or ""):
                if action in ("pause", "resume"):
                    await self._media(action)
                    await asyncio.sleep(0.5)
                    return await self.status()
                if action in ("next", "previous"):
                    title = st.get("title")
                    await self._click(action, timeout=5, labels=YTM_LABELS)
                    if st.get("paused") is not False:
                        # 一時停止中に押したとき鳴り始めるかは測っていないので、待たずに今の状態を返す
                        await asyncio.sleep(1)
                        return await self.status()
                    return await self._wait_playing(before_title=title)
                raise RuntimeError(f"不明な操作です: {action}")
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
