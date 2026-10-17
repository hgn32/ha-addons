#!/usr/bin/env python3
"""Music Assistant の YouTube Music 用 Cookie を取得する Ingress サーバー。

流れ（元にしたデスクトップ版スクリプトと同じ考え方）
  1. /data に置いたプロファイルで Chromium を「普通に」起動する（デバッグポートなし）。
     ログイン状態はプロファイルに残るので、2回目以降はログイン済みで開く。
     画面は Xvfb 上に出し、x11vnc + noVNC で Ingress パネルに映す。
     ユーザーはそこで YouTube Music にログインし、「ログイン完了」を押す。
     リモートデバッグポート付きのブラウザは Google がログインを拒否することがあるため、
     ログイン中はポートを開けない。
     https://dotnetbrowser-support.teamdev.com/docs/guides/troubleshoot/google-signin.html
  2. Chromium のウィンドウを Ctrl+Shift+W で閉じて終了させ（Cookie をディスクへ書き出させる）、
     同じプロファイルを headless + CDP で about:blank だけ開いて再起動し、
     music.youtube.com 宛てに送られる Cookie（httpOnly・パーティション分割 Cookie 含む）を読む。
     YouTube のページは開かないので、ここで Cookie がローテーションされることはない。
     https://chromedevtools.github.io/devtools-protocol/tot/Storage/#method-getCookies
  3. 必須 Cookie を検証して画面に表示する。プロファイルは「ログイン情報を消す」で削除する。

Cookie の値は秘密情報なので HA のログタブには出さない（件数と有無だけ出す）。
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import socket
import time

import aiohttp
from aiohttp import web

PORT = 8099
DISPLAY = ":99"
SCREEN_W, SCREEN_H = 1280, 800
VNC_PORT = 5900
CHROMIUM = "/usr/bin/chromium-browser"
NOVNC_DIR = "/usr/share/novnc"
WWW_DIR = "/www"
# ログイン状態を残すため、プロファイルはアドオンの永続領域 /data に置く。
# 次回は「開始」でログイン済みのブラウザが開くので、そのまま「ログイン完了」を押せばよい
PROFILE_DIR = "/data/chromium-profile"

# MA 公式ドキュメントで必須とされる Cookie と、MA のソースでログイン判定に使われる Cookie
REQUIRED = ("__Secure-3PAPISID", "LOGIN_INFO")
YTM_URL = "https://music.youtube.com/"
# MA の手順で Cookie をコピーする /browse リクエスト（music.youtube.com のページから送られる）と
# 同じ Cookie を集める
COOKIE_HOST = "music.youtube.com"
COOKIE_PATH = "/youtubei/v1/browse"
COOKIE_TOP_LEVEL_SITE = "https://youtube.com"

# 2回の起動で Cookie の暗号鍵を揃えるため、キーリングを使わない basic を明示する。
# コンテナ内は root なので Chromium のサンドボックスは使えない（--no-sandbox）。
COMMON_ARGS = [
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--lang=ja",
]


def log(msg: str) -> None:
    print(f"[ytm-cookie] {msg}", flush=True)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class State:
    def __init__(self) -> None:
        # idle / login / extracting / done / error
        self.phase = "idle"
        self.message = ""
        self.cookie = ""
        self.found: dict[str, bool] = {}
        self.count = 0
        self.http_only = 0
        self.browser: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()


state = State()
display_procs: dict[str, asyncio.subprocess.Process] = {}


# ---------------------------------------------------------------- 画面（Xvfb + x11vnc）
async def ensure_display() -> None:
    xvfb = display_procs.get("xvfb")
    if xvfb is None or xvfb.returncode is not None:
        if xvfb is not None:
            log(f"Xvfb が終了していたため再起動します (終了コード {xvfb.returncode})")
        # 前回の Xvfb が残したロックがあると起動できない
        for p in ("/tmp/.X99-lock", "/tmp/.X11-unix/X99"):
            try:
                os.remove(p)
            except FileNotFoundError:
                pass
        display_procs["xvfb"] = await asyncio.create_subprocess_exec(
            "Xvfb", DISPLAY, "-screen", "0", f"{SCREEN_W}x{SCREEN_H}x24", "-nolisten", "tcp",
            # キーマップの警告が毎回大量に出てログタブが埋まるため捨てる。起動失敗は下で検出する
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        for _ in range(50):
            if os.path.exists("/tmp/.X11-unix/X99"):
                break
            await asyncio.sleep(0.1)
        else:
            raise RuntimeError("Xvfb が起動しませんでした")
    vnc = display_procs.get("x11vnc")
    if vnc is None or vnc.returncode is not None:
        if vnc is not None:
            log(f"x11vnc が終了していたため再起動します (終了コード {vnc.returncode})")
        # -localhost: コンテナ外へは開けない。外からは Ingress（HA の認証付き）経由だけ
        display_procs["x11vnc"] = await asyncio.create_subprocess_exec(
            "x11vnc", "-display", DISPLAY, "-rfbport", str(VNC_PORT), "-localhost",
            "-forever", "-shared", "-nopw", "-quiet",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        for _ in range(50):
            try:
                _, w = await asyncio.open_connection("127.0.0.1", VNC_PORT)
                w.close()
                break
            except OSError:
                await asyncio.sleep(0.1)
        else:
            raise RuntimeError("x11vnc が起動しませんでした")


# ---------------------------------------------------------------- ブラウザ
async def run_quiet(*args: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        *args, env=dict(os.environ, DISPLAY=DISPLAY),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    out, _ = await proc.communicate()
    return out.decode()


async def close_browser_windows(proc: asyncio.subprocess.Process, timeout: float = 20) -> bool:
    """ウィンドウを閉じてブラウザを終了させる。終了できたら True。

    SIGTERM で終了させると、直近（最大30秒ほど）に付いた Cookie がディスクへ
    書き出されないまま終わることを実測で確認した（ページ表示から12秒で SIGTERM → 0件、
    同じ条件でウィンドウを閉じる → 5件）。ユーザーがウィンドウを閉じたときと同じ
    通常の終了処理を通すため、ウィンドウに Ctrl+Shift+W（ウィンドウを閉じる）を送る。
    WM が無いのでフォーカスはポインタ位置に依存する。送る前に明示的にフォーカスする。
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.returncode is not None:
            return True
        windows = (await run_quiet("xdotool", "search", "--onlyvisible", "--pid", str(proc.pid))).split()
        if windows:
            await run_quiet("xdotool", "windowfocus", "--sync", windows[-1])
            await run_quiet("xdotool", "key", "--clearmodifiers", "ctrl+shift+w")
        try:
            await asyncio.wait_for(proc.wait(), 2)
            return True
        except asyncio.TimeoutError:
            pass
    return False


async def stop_browser(proc: asyncio.subprocess.Process | None, timeout: float = 15) -> None:
    """SIGTERM で止める。Cookie の書き出しは保証されないので、取り出しに使うときは
    先に close_browser_windows で閉じること。"""
    if proc is None or proc.returncode is not None:
        return
    proc.send_signal(signal.SIGTERM)
    try:
        await asyncio.wait_for(proc.wait(), timeout)
    except asyncio.TimeoutError:
        log("Chromium が終了しないため強制終了します")
        proc.kill()
        await proc.wait()


def remove_profile(path: str | None) -> None:
    if path:
        shutil.rmtree(path, ignore_errors=True)


async def reset() -> None:
    await stop_browser(state.browser, timeout=5)
    state.browser = None
    state.phase = "idle"
    state.message = ""
    state.cookie = ""
    state.found = {}
    state.count = state.http_only = 0


def clear_singleton_lock() -> None:
    """コンテナの再起動などで前回の Chromium のロックが残っていると起動を拒否されるため消す。
    このアドオンで同じプロファイルを同時に開くことはない（state.lock で直列化している）。"""
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        try:
            os.remove(os.path.join(PROFILE_DIR, name))
        except FileNotFoundError:
            pass


async def forget_login() -> None:
    await reset()
    remove_profile(PROFILE_DIR)
    log("保存していたログイン情報を削除しました")


async def start_login() -> None:
    await reset()
    await ensure_display()
    os.makedirs(PROFILE_DIR, exist_ok=True)
    clear_singleton_lock()
    env = dict(os.environ, DISPLAY=DISPLAY)
    state.browser = await asyncio.create_subprocess_exec(
        CHROMIUM, f"--user-data-dir={PROFILE_DIR}", *COMMON_ARGS,
        "--window-position=0,0", f"--window-size={SCREEN_W},{SCREEN_H}", "--start-maximized",
        YTM_URL, env=env,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    state.phase = "login"
    log("ログイン用のブラウザを起動しました")


async def wait_for_browser_ws(session: aiohttp.ClientSession, port: int,
                              timeout: float = 30) -> str:
    deadline = time.monotonic() + timeout
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            async with session.get(f"http://127.0.0.1:{port}/json/version") as r:
                url = (await r.json(content_type=None)).get("webSocketDebuggerUrl")
            if url:
                return url
        except Exception as e:  # 起動待ち
            last_err = e
        await asyncio.sleep(0.5)
    raise RuntimeError(f"Chromium のデバッグポートに接続できませんでした（{last_err}）")


async def cdp_call(session: aiohttp.ClientSession, ws_url: str, method: str,
                   params: dict | None = None) -> dict:
    # aiohttp は Origin ヘッダーを送らない（Chrome 111 以降は Origin 付きの接続を拒否する）
    async with session.ws_connect(ws_url, max_msg_size=0, timeout=15) as ws:
        await ws.send_json({"id": 1, "method": method, "params": params or {}})
        async for msg in ws:
            data = json.loads(msg.data)
            if data.get("id") == 1:
                if "error" in data:
                    raise RuntimeError(f"{method} 失敗: {data['error']}")
                return data.get("result", {})
    raise RuntimeError(f"{method}: 応答がありませんでした")


async def extract_cookies(profile: str) -> list[dict]:
    port = free_port()
    proc = await asyncio.create_subprocess_exec(
        CHROMIUM, f"--user-data-dir={profile}", *COMMON_ARGS, "--headless=new",
        f"--remote-debugging-port={port}", "about:blank",
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
            browser_ws = await wait_for_browser_ws(session, port)
            result = await cdp_call(session, browser_ws, "Storage.getCookies")
            return [c for c in result.get("cookies", []) if sent_to_browse(c)]
    finally:
        await stop_browser(proc)


def sent_to_browse(c: dict) -> bool:
    """music.youtube.com のページから /browse へのリクエストに付く Cookie か。

    Network.getCookies(urls=[...]) はパーティション分割 Cookie（CHIPS）を返さない。
    youtube.com は VISITOR_INFO1_LIVE 等をトップサイト youtube.com で分割して保存して
    おり（実測: Cookies DB の top_frame_site_key = https://youtube.com）、ブラウザは
    music.youtube.com のページからのリクエストにこれも付ける。ページを開かずに
    同じ組み合わせを得るため、Storage.getCookies で全件取ってここで絞る。
    ドメイン・パスの一致は RFC 6265 5.1.3 / 5.1.4
    https://www.rfc-editor.org/rfc/rfc6265#section-5.1.3
    """
    domain = c.get("domain", "")
    if domain.startswith("."):
        if not (COOKIE_HOST == domain[1:] or COOKIE_HOST.endswith(domain)):
            return False
    elif COOKIE_HOST != domain:
        return False
    path = c.get("path") or "/"
    if not (COOKIE_PATH == path or (COOKIE_PATH.startswith(path)
                                    and (path.endswith("/") or COOKIE_PATH[len(path)] == "/"))):
        return False
    if not c.get("session") and 0 <= c.get("expires", -1) < time.time():
        return False
    key = c.get("partitionKey")
    if c.get("partitionKeyOpaque"):
        return False
    if key is not None:
        if isinstance(key, str):  # 古い CDP は文字列で返す
            return key == COOKIE_TOP_LEVEL_SITE
        return key.get("topLevelSite") == COOKIE_TOP_LEVEL_SITE and not key.get("hasCrossSiteAncestor")
    return True


def build_cookie_header(cookies: list[dict]) -> str:
    seen: set[str] = set()
    parts: list[str] = []
    # ブラウザと同じく path が長いものを先に
    for c in sorted(cookies, key=lambda c: len(c.get("path", "")), reverse=True):
        key = f"{c.get('name')}|{c.get('domain')}|{c.get('path')}"
        if key in seen:
            continue
        seen.add(key)
        parts.append(f"{c['name']}={c['value']}")
    return "; ".join(parts).strip()


async def finish_login() -> None:
    if state.phase != "login":
        raise RuntimeError("ログイン中ではありません")
    state.phase = "extracting"
    try:
        if not await close_browser_windows(state.browser):
            log("ブラウザのウィンドウを閉じられなかったため強制終了します（直前の Cookie が失われている可能性があります）")
            await stop_browser(state.browser)
        state.browser = None
        clear_singleton_lock()
        cookies = await extract_cookies(PROFILE_DIR)
    except Exception as e:
        state.phase = "error"
        state.message = f"Cookie の読み出しに失敗しました: {e}"
        log(state.message)
        return

    names = {c.get("name") for c in cookies}
    state.count = len(cookies)
    state.http_only = sum(1 for c in cookies if c.get("httpOnly"))
    state.found = {n: n in names for n in REQUIRED}
    missing = [n for n in REQUIRED if n not in names]
    log(f"取得した Cookie 数: {state.count}（うち httpOnly {state.http_only}）")
    for n in REQUIRED:
        log(f"  {n}: {'あり' if n in names else 'なし'}")
    if missing:
        state.phase = "error"
        state.message = ("必須 Cookie が足りません: " + ", ".join(missing) +
                         "。ログインが完了してから「ログイン完了」を押したか確認して、やり直してください。")
        log(state.message)
        return
    state.cookie = build_cookie_header(cookies)
    state.phase = "done"
    log("Cookie を取得しました（値は Ingress パネルにだけ表示します）")


# ---------------------------------------------------------------- HTTP
def state_json() -> dict:
    return {
        "phase": state.phase,
        "message": state.message,
        "cookie": state.cookie,
        "found": state.found,
        "count": state.count,
        "http_only": state.http_only,
        "saved": os.path.isdir(os.path.join(PROFILE_DIR, "Default")),
    }


async def api_state(_req: web.Request) -> web.Response:
    if state.phase == "login" and state.browser is not None and state.browser.returncode is not None:
        # ブラウザが勝手に落ちた
        state.phase = "error"
        state.message = f"ブラウザが終了しました (終了コード {state.browser.returncode})。やり直してください。"
        log(state.message)
    return web.json_response(state_json())


def action(fn):
    async def handler(_req: web.Request) -> web.Response:
        if state.lock.locked():
            return web.json_response({"error": "処理中です"}, status=409)
        async with state.lock:
            try:
                await fn()
            except Exception as e:
                log(f"エラー: {e}")
                return web.json_response({"error": str(e)}, status=500)
        return web.json_response(state_json())
    return handler


async def vnc_proxy(req: web.Request) -> web.StreamResponse:
    """noVNC の WebSocket を x11vnc の TCP に中継する（websockify の代わり）。"""
    ws = web.WebSocketResponse(protocols=("binary",), max_msg_size=0)
    await ws.prepare(req)
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", VNC_PORT)
    except OSError:
        await ws.close()
        return ws

    async def tcp_to_ws() -> None:
        while data := await reader.read(65536):
            await ws.send_bytes(data)
        await ws.close()

    task = asyncio.create_task(tcp_to_ws())
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.BINARY:
                writer.write(msg.data)
                await writer.drain()
            elif msg.type == aiohttp.WSMsgType.TEXT:
                writer.write(msg.data.encode())
                await writer.drain()
    finally:
        task.cancel()
        writer.close()
    return ws


async def index(_req: web.Request) -> web.FileResponse:
    return web.FileResponse(os.path.join(WWW_DIR, "index.html"),
                            headers={"Cache-Control": "no-store"})


async def on_startup(_app: web.Application) -> None:
    await ensure_display()
    log("画面（Xvfb / x11vnc）を起動しました")


async def on_cleanup(_app: web.Application) -> None:
    await reset()
    for p in display_procs.values():
        if p.returncode is None:
            p.terminate()


def main() -> None:
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/api/state", api_state)
    app.router.add_post("/api/start", action(start_login))
    app.router.add_post("/api/finish", action(finish_login))
    app.router.add_post("/api/reset", action(reset))
    app.router.add_post("/api/forget", action(forget_login))
    app.router.add_get("/novnc/websockify", vnc_proxy)
    app.router.add_static("/novnc/", NOVNC_DIR)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
