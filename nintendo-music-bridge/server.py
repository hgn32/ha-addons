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
import ipaddress
import os
import socket
import time

import aiohttp
from aiohttp import web

from bridge import Bridge
from discover import CDP_PORT, Discoverer
from stream import HomeAssistant, Streamer

PORT = 8481
# host_network なので、ホストの他のサービスとぶつかりにくい番号にする
DISPLAY = ":91"
SCREEN_W, SCREEN_H = 1280, 800
VNC_PORT = 5911
CHROME = "/usr/bin/google-chrome-stable"
PROFILE_DIR = "/data/chrome-profile"
SINK = "player-out"
NOVNC_DIR = "/usr/share/novnc"
WWW_DIR = "/www"

# PipeWire と Chrome は D-Bus のセッションバスを探す。無いとログタブがエラー行で埋まるので
# コンテナ内に自前のセッションバスを立てる
DBUS_ADDR = "unix:path=/run/user/0/bus"
# 言語（アドオン設定の lang）。Nintendo Music のページと Chrome の画面の言語に使う。
# Linux の Chrome は --lang ではなく環境変数 LANGUAGE で画面の言語を決める
NM_LANG = os.environ.get("NM_LANG", "ja-JP")
ENV = dict(os.environ, DISPLAY=DISPLAY, XDG_RUNTIME_DIR="/run/user/0",
           DBUS_SESSION_BUS_ADDRESS=DBUS_ADDR,
           LANGUAGE=NM_LANG.split("-")[0], LANG=NM_LANG.replace("-", "_") + ".UTF-8")
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


async def spawn(name: str, *args: str, quiet: bool = True, stderr_file: str | None = None) -> None:
    err = asyncio.subprocess.DEVNULL if quiet else None
    if stderr_file:
        err = open(stderr_file, "wb")
    procs[name] = await asyncio.create_subprocess_exec(
        *args, env=ENV, stdout=asyncio.subprocess.DEVNULL, stderr=err)
    if stderr_file:
        err.close()


CHROME_LOG = "/tmp/chrome-stderr.log"


def chrome_log_tail(n: int = 15) -> str:
    """Chrome の標準エラーの末尾（落ちた理由をログタブに出すため）。"""
    try:
        with open(CHROME_LOG, "rb") as f:
            lines = f.read().decode(errors="replace").splitlines()
    except OSError:
        return ""
    return "\n".join("  " + line for line in lines[-n:])


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
    # シンクが見えても、WirePlumber が既定の出力を扱えるようになる前だと
    # "Failure: Not supported" で断られることがある（実測）。通るまで待つ
    last = ""

    async def default_set() -> bool:
        nonlocal last
        code, out = await run_quiet("pactl", "set-default-sink", SINK)
        last = out.strip()
        if code != 0:
            return False
        code, out = await run_quiet("pactl", "get-default-sink")
        return code == 0 and out.strip() == SINK
    try:
        await wait_until(default_set, "既定の出力の切り替え", timeout=20)
    except RuntimeError:
        raise RuntimeError(f"既定の出力を {SINK} にできませんでした: {last}")
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
        # HA のアドオンは Docker 既定の seccomp で動き、Chrome のサンドボックスが名前空間を
        # 作れない（実測: "Failed to move to new namespace ... Operation not permitted"）。
        # その警告バーは --test-type で隠す
        "--no-sandbox", "--test-type",
        # 落ちたあとの起動で「ページを復元しますか？」の吹き出しを出さない
        "--hide-crash-restore-bubble",
        "--no-first-run", "--no-default-browser-check",
        "--password-store=basic",
        "--disable-dev-shm-usage",
        "--autoplay-policy=no-user-gesture-required",
        # 調査モード・ブリッジ API がページを観察・操作するための CDP。127.0.0.1 だけで待ち受ける
        f"--remote-debugging-port={CDP_PORT}",
        "--window-position=0,0", f"--window-size={SCREEN_W},{SCREEN_H}",
        f"https://music.nintendo.com/{NM_LANG}/", stderr_file=CHROME_LOG)
    log("Chrome を起動しました")


async def watch_chrome() -> None:
    """Chrome が落ちたら起動し直す。短時間に落ち続けるときは間隔を空ける。"""
    while True:
        proc = procs.get("chrome")
        if proc is not None:
            code = await proc.wait()
            xvfb = procs.get("xvfb")
            if xvfb is not None and xvfb.returncode is not None:
                # アドオンの停止中は、Xvfb も同時に止められて Chrome が "Missing X server" で
                # 起動できず、落ち続けていた（実機のログ）。停止中ならこの間に打ち切られる
                await asyncio.sleep(5)
                log("画面（Xvfb）が止まっているため、Chrome は起動し直しません。アドオンを再起動してください")
                return
            log(f"Chrome が終了しました（終了コード {code}）。起動し直します")
            if code != 0 and (tail := chrome_log_tail()):
                log("Chrome の最後の出力:\n" + tail)
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
# host_network なので 0.0.0.0 で待つと LAN からも見える。HA の内部ネットワーク
# （Supervisor の Ingress 中継 172.30.32.2 と他のアドオン。ha-mcp などは自分の IP から直接来る）と
# ホスト自身（HA 本体・Music Assistant は host_network）以外は断る
# 「172.30.32.2 以外は拒否すること」は HA 開発者ドキュメントのアドオン Ingress 節の要件
# https://git.sudo.is/home-assistant/developers.home-assistant/src/branch/children/docs/add-ons/presentation.md
# 同じ穴（Ingress 用の画面が LAN から認証なしで見えた）: https://securelayer7.net/lab/cve-2026-59177-esphome-device-builder-unauthenticated-ingress-lan-access
ALLOWED_NETS = [ipaddress.ip_network(n) for n in ("172.30.32.0/23", "127.0.0.0/8", "::1/128")]


denied_logged: set[str | None] = set()
_local_cache: dict[str, bool] = {}


def is_this_host(ip: str) -> bool:
    """接続元がこのホスト自身の IP か（host_network なのでホストのインターフェースが見える）。

    ホスト上のプロセス（host_network の ha-mcp 等）が 172.30.32.1 宛てにつなぐと、送信元が
    ホストの LAN 側 IP になる（実測: 192.168.100.210）。自分の IP にしか bind できないことで判定する。
    LAN の他機器は TCP 接続でホストの IP を名乗れないので、これで LAN を許すことにはならない。
    """
    if ip not in _local_cache:
        fam = socket.AF_INET6 if ":" in ip else socket.AF_INET
        try:
            with socket.socket(fam, socket.SOCK_STREAM) as sock:
                sock.bind((ip, 0))
            _local_cache[ip] = True
        except OSError:
            _local_cache[ip] = False
    return _local_cache[ip]


@web.middleware
async def only_ingress(req: web.Request, handler):
    try:
        allowed = (any(ipaddress.ip_address(req.remote) in n for n in ALLOWED_NETS)
                   or is_this_host(req.remote))
    except ValueError:
        allowed = False
    # スピーカー（Cast）は LAN 側から音声ストリームを取りに来る。URL のトークンは stream.py で確認する
    if not allowed and req.path.startswith("/stream/"):
        allowed = True
    if not allowed:
        if req.remote not in denied_logged:
            denied_logged.add(req.remote)
            log(f"許可していない接続元からのアクセスを拒否しました: {req.remote} {req.method} {req.path}")
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
        "send_rate": rate_stats,
    })


discoverer = Discoverer(log)


async def api_discover(req: web.Request) -> web.Response:
    action = req.match_info["action"]
    try:
        if action == "start":
            discoverer.start()
        elif action == "stop":
            await discoverer.stop()
            log("調査モードを終了しました")
        elif action == "dom":
            await discoverer.snapshot_dom()
        elif action != "report":
            return web.json_response({"error": "不明な操作です"}, status=404)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"running": discoverer.running, "count": len(discoverer.entries),
                              "report": discoverer.report()})


bridge = Bridge(log, lang=NM_LANG, country=os.environ.get("NM_COUNTRY", "JP"))


def bridge_handler(fn):
    async def handler(req: web.Request) -> web.Response:
        try:
            return web.json_response(await fn(req))
        except Exception as e:
            log(f"ブリッジ API {req.method} {req.path} でエラー: {e}")
            return web.json_response({"error": str(e)}, status=500)
    return handler


async def b_play(req: web.Request):
    body = await req.json()
    return await bridge.play_playlist(body["playlist_id"], int(body.get("index", 0)))


streamer = Streamer(log, ENV, SINK, int(os.environ.get("NM_RATE", "48000")), PORT)
ha = HomeAssistant()


async def b_cast(req: web.Request):
    body = await req.json()
    url = streamer.url()
    await ha.play_url(body["entity_id"], url)
    log(f"{body['entity_id']} にストリームの再生を指示しました")
    return {"ok": True, "url": url}


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


rate_stats: dict = {}


async def measure_rate() -> None:
    """VBAN 送信シンクに流れている音のサンプル数を数え、1分ごとに実際のレートをログに出す。

    MA の VBAN Receiver は設定したレート（48000）で消費するので、送る側がそれより少ないと
    数分で受信側のバッファが底をつき、音が途切れる。検証環境では 47600〜47970 Hz と
    ばらついたため、実機の値を見て対策を決める。音が流れていない間（無音・停止中）は数えない。
    """
    rate_target = int(os.environ.get("NM_RATE", "48000"))
    while True:
        proc = await asyncio.create_subprocess_exec(
            "parec", "-d", f"{SINK}.monitor", "--raw", "--format=s16le",
            f"--rate={rate_target}", "--channels=2", "--latency-msec=100",
            env=ENV, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        frames, t0 = 0, time.monotonic()
        try:
            while chunk := await proc.stdout.read(65536):
                frames += len(chunk) // 4
                now = time.monotonic()
                if now - t0 >= 60:
                    _, out = await run_quiet("pactl", "list", "short", "sinks")
                    running = any(l.split("\t")[1:2] == [SINK] and "RUNNING" in l for l in out.splitlines())
                    hz = frames / (now - t0)
                    rate_stats.update(hz=round(hz, 1), at=time.strftime("%H:%M:%S"), running=running)
                    if running:
                        log(f"送信レート: {hz:.1f} Hz（設定 {rate_target} Hz、差 {(hz / rate_target - 1) * 100:+.3f}%）")
                    frames, t0 = 0, now
        finally:
            if proc.returncode is None:
                proc.kill()
        await asyncio.sleep(5)


async def on_startup(app: web.Application) -> None:
    await start_display()
    await start_audio()
    app["watch"] = asyncio.create_task(watch_chrome())
    app["rate"] = asyncio.create_task(measure_rate())


async def on_cleanup(app: web.Application) -> None:
    app["watch"].cancel()
    app["rate"].cancel()
    for p in procs.values():
        if p.returncode is None:
            p.terminate()


def main() -> None:
    app = web.Application(middlewares=[only_ingress])
    app.router.add_get("/", index)
    app.router.add_get("/api/status", api_status)
    app.router.add_post("/api/discover/{action}", api_discover)
    # ブリッジ API（Music Assistant のプロバイダ・HA のオートメーションから使う）
    app.router.add_get("/bridge/search", bridge_handler(
        lambda r: bridge.search(r.query["q"], r.query.get("type"), int(r.query.get("limit", 20)))))
    app.router.add_get("/bridge/games", bridge_handler(lambda r: bridge.games()))
    app.router.add_get("/bridge/games/{id}/playlists", bridge_handler(
        lambda r: bridge.game_playlists(r.match_info["id"])))
    app.router.add_get("/bridge/playlists/{id}", bridge_handler(lambda r: bridge.playlist(r.match_info["id"])))
    app.router.add_get("/bridge/status", bridge_handler(lambda r: bridge.status()))
    app.router.add_post("/bridge/play", bridge_handler(b_play))
    app.router.add_post("/bridge/{action:pause|resume|next|previous}", bridge_handler(
        lambda r: bridge.control(r.match_info["action"])))
    app.router.add_get("/bridge/players", bridge_handler(lambda r: ha.players()))
    app.router.add_post("/bridge/cast", bridge_handler(b_cast))
    # スピーカーが取りに来る音声ストリーム（LAN から受け付ける）
    app.router.add_route("GET", "/stream/{token}/live.mp3", streamer.handle)
    app.router.add_get("/novnc/websockify", vnc_proxy)
    app.router.add_static("/novnc/", NOVNC_DIR)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
