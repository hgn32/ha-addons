#!/usr/bin/env python3
"""Nintendo Music Bridge（フェーズ0）。

Xvfb 上で公式 Chrome を常駐させ、画面を noVNC で Ingress に出す。
Chrome の音声は PipeWire の VBAN 送信シンク（vban-sender-ma）へ出し、
Music Assistant の VBAN Receiver プラグインで受ける。

フェーズ0は「Linux の公式 Chrome で Nintendo Music の Web 版が再生でき、
その音が MA のスピーカーで鳴るか」を確かめるための最小構成。
CDP（リモートデバッグポート）やブリッジ API はフェーズ1以降で足す。
"""

from __future__ import annotations

import asyncio
import os
import time

import aiohttp
from aiohttp import web

PORT = 8481
# host_network なので、ホストの他のサービスとぶつかりにくい番号にする
DISPLAY = ":91"
SCREEN_W, SCREEN_H = 1280, 800
VNC_PORT = 5911
CHROME = "/usr/bin/google-chrome-stable"
PROFILE_DIR = "/data/chrome-profile"
START_URL = "https://music.nintendo.com/"
SINK = "vban-sender-ma"
NOVNC_DIR = "/usr/share/novnc"
WWW_DIR = "/www"

# PipeWire と Chrome は D-Bus のセッションバスを探す。無いとログタブがエラー行で埋まるので
# コンテナ内に自前のセッションバスを立てる
DBUS_ADDR = "unix:path=/run/user/0/bus"
ENV = dict(os.environ, DISPLAY=DISPLAY, XDG_RUNTIME_DIR="/run/user/0",
           DBUS_SESSION_BUS_ADDRESS=DBUS_ADDR)
procs: dict[str, asyncio.subprocess.Process] = {}
chrome_restarts: list[float] = []


def log(msg: str) -> None:
    print(f"[nintendo-music] {msg}", flush=True)


async def run_quiet(*args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, env=ENV, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await proc.communicate()
    return proc.returncode, out.decode(errors="replace")


async def wait_until(check, what: str, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if await check():
            return
        await asyncio.sleep(0.2)
    raise RuntimeError(f"{what} が起動しませんでした")


async def spawn(name: str, *args: str, quiet: bool = True) -> None:
    procs[name] = await asyncio.create_subprocess_exec(
        *args, env=ENV,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL if quiet else None)


# ---------------------------------------------------------------- 起動
async def start_display() -> None:
    for p in (f"/tmp/.X{DISPLAY[1:]}-lock", f"/tmp/.X11-unix/X{DISPLAY[1:]}"):
        try:
            os.remove(p)
        except FileNotFoundError:
            pass
    # Xvfb のキーマップ警告は毎回大量に出るので捨てる。起動失敗は下で検出する
    await spawn("xvfb", "Xvfb", DISPLAY, "-screen", "0", f"{SCREEN_W}x{SCREEN_H}x24", "-nolisten", "tcp")

    async def x_ready() -> bool:
        return os.path.exists(f"/tmp/.X11-unix/X{DISPLAY[1:]}")
    await wait_until(x_ready, "Xvfb")

    # -localhost: host_network でも LAN には開けない。外からは Ingress（HA の認証付き）経由だけ
    await spawn("x11vnc", "x11vnc", "-display", DISPLAY, "-rfbport", str(VNC_PORT), "-localhost",
                "-forever", "-shared", "-nopw", "-quiet")

    async def vnc_ready() -> bool:
        try:
            _, w = await asyncio.open_connection("127.0.0.1", VNC_PORT)
            w.close()
            return True
        except OSError:
            return False
    await wait_until(vnc_ready, "x11vnc")


async def start_audio() -> None:
    try:
        os.remove("/run/user/0/bus")
    except FileNotFoundError:
        pass
    await spawn("dbus", "dbus-daemon", "--session", f"--address={DBUS_ADDR}", "--nofork", "--nopidfile")

    async def bus_ready() -> bool:
        return os.path.exists("/run/user/0/bus")
    await wait_until(bus_ready, "D-Bus")
    await spawn("pipewire", "pipewire", quiet=False)
    await asyncio.sleep(0.5)
    await spawn("wireplumber", "wireplumber")
    await spawn("pipewire-pulse", "pipewire-pulse")

    async def sink_ready() -> bool:
        code, out = await run_quiet("pactl", "list", "short", "sinks")
        return code == 0 and SINK in out
    await wait_until(sink_ready, f"PipeWire の VBAN 送信シンク（{SINK}）", timeout=15)
    code, out = await run_quiet("pactl", "set-default-sink", SINK)
    if code != 0:
        raise RuntimeError(f"既定の出力を {SINK} にできませんでした: {out.strip()}")
    log(f"音声の出力先を {SINK} にしました")


def clear_singleton_lock() -> None:
    # コンテナ再起動後に前回のロックが残っていると Chrome が起動を拒否する
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        try:
            os.remove(os.path.join(PROFILE_DIR, name))
        except FileNotFoundError:
            pass


async def start_chrome() -> None:
    os.makedirs(PROFILE_DIR, exist_ok=True)
    clear_singleton_lock()
    await spawn(
        "chrome", CHROME,
        f"--user-data-dir={PROFILE_DIR}",
        # コンテナ内は root なのでサンドボックスは使えない
        "--no-sandbox",
        "--no-first-run", "--no-default-browser-check",
        "--password-store=basic",
        "--disable-dev-shm-usage",
        "--autoplay-policy=no-user-gesture-required",
        "--lang=ja",
        "--window-position=0,0", f"--window-size={SCREEN_W},{SCREEN_H}",
        START_URL)
    log("Chrome を起動しました")


async def watch_chrome() -> None:
    """Chrome が落ちたら起動し直す。短時間に落ち続けるときは間隔を空ける。"""
    while True:
        proc = procs.get("chrome")
        if proc is not None:
            code = await proc.wait()
            log(f"Chrome が終了しました（終了コード {code}）。起動し直します")
        now = time.monotonic()
        chrome_restarts[:] = [t for t in chrome_restarts if now - t < 300] + [now]
        if len(chrome_restarts) > 5:
            log("5分間に5回以上落ちたため、60秒待ってから起動し直します")
            await asyncio.sleep(60)
        try:
            await start_chrome()
        except Exception as e:
            log(f"Chrome を起動できませんでした: {e}")
            await asyncio.sleep(10)


# ---------------------------------------------------------------- HTTP
# host_network なので 0.0.0.0 で待つと LAN からも見える。Ingress の中継元
# （Supervisor: 172.30.32.2）とホスト自身以外は断る
# 「172.30.32.2 以外は拒否すること」は HA 開発者ドキュメントのアドオン Ingress 節の要件
# https://git.sudo.is/home-assistant/developers.home-assistant/src/branch/children/docs/add-ons/presentation.md
# 同じ穴（Ingress 用の画面が LAN から認証なしで見えた）: https://securelayer7.net/lab/cve-2026-59177-esphome-device-builder-unauthenticated-ingress-lan-access
ALLOWED_PEERS = {"172.30.32.2", "127.0.0.1", "::1"}


@web.middleware
async def only_ingress(req: web.Request, handler):
    if req.remote not in ALLOWED_PEERS:
        return web.Response(status=403, text="Forbidden")
    return await handler(req)


async def api_status(_req: web.Request) -> web.Response:
    chrome = procs.get("chrome")
    code, out = await run_quiet("pactl", "list", "short", "sinks")
    sink_state = ""
    for line in out.splitlines():
        cols = line.split("\t")
        if len(cols) >= 5 and cols[1] == SINK:
            sink_state = cols[4]
    return web.json_response({
        "chrome": chrome is not None and chrome.returncode is None,
        "sink": sink_state,  # RUNNING なら音が VBAN で出ている
    })


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


async def on_startup(app: web.Application) -> None:
    await start_display()
    await start_audio()
    app["watch"] = asyncio.create_task(watch_chrome())


async def on_cleanup(app: web.Application) -> None:
    app["watch"].cancel()
    for p in procs.values():
        if p.returncode is None:
            p.terminate()


def main() -> None:
    app = web.Application(middlewares=[only_ingress])
    app.router.add_get("/", index)
    app.router.add_get("/api/status", api_status)
    app.router.add_get("/novnc/websockify", vnc_proxy)
    app.router.add_static("/novnc/", NOVNC_DIR)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
