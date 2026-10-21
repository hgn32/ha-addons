#!/usr/bin/env python3
"""Web Music Player。

Xvfb 上で公式 Chrome を常駐させ、画面を noVNC で Ingress に出す。
Chrome の音声は PipeWire の出力シンク（player-out）へ出し、そのモニターを MP3 のストリームにして
HA の Cast 連携でスピーカーに再生させる（stream.py）。
再生操作は CDP（リモートデバッグポート）で Chrome を操作する（bridge.py・favorites.py）。
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import shutil
import socket
import time

import aiohttp
from aiohttp import web

from bridge import CDP_PORT, Bridge
from favorites import Favorites, Session
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
           LANGUAGE=NM_LANG.split("-")[0], LANG=NM_LANG.replace("-", "_") + ".UTF-8",
           # PulseAudio 互換の層を使うアプリ（Chrome・parec）の音のバッファを増やす。
           # 小さい単位で何度も受け渡すのをやめて CPU を減らす（実測: 再生中 10.2% → 7.8%、1コア=100%）
           # https://docs.pipewire.org/page_man_pipewire-pulse_1.html
           PULSE_LATENCY_MSEC="100")
procs: dict[str, asyncio.subprocess.Process] = {}
chrome_restarts: list[float] = []


def log(msg: str) -> None:
    print(f"[web-music-player] {msg}", flush=True)


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
    await wait_until(sink_ready, f"PipeWire の出力シンク（{SINK}）", timeout=15)
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
    clear_last_session()
    clean_profile()
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
        # ディスクキャッシュの上限（50MB）。--disk-cache-size はバイトで指定する
        # https://source.chromium.org/chromium/chromium/src/+/main:chrome/common/chrome_switches.h
        "--disk-cache-size=52428800",
        # ブリッジがページを操作するための CDP。127.0.0.1 だけで待ち受ける
        f"--remote-debugging-port={CDP_PORT}",
        "--window-position=0,0", f"--window-size={SCREEN_W},{SCREEN_H}",
        f"https://music.nintendo.com/{NM_LANG}/", stderr_file=CHROME_LOG)
    log("Chrome を起動しました")
    asyncio.create_task(after_chrome_start())


def clear_last_session() -> None:
    """前回のタブを開き直させない。アドオンの再起動のあと、Chrome が前の YouTube Music の画面を
    開き直して勝手に鳴り出した（実機で確認）。タブの復元に使うファイルを消してから起動する。"""
    base = os.path.join(PROFILE_DIR, "Default")
    shutil.rmtree(os.path.join(base, "Sessions"), ignore_errors=True)
    for name in ("Current Session", "Current Tabs", "Last Session", "Last Tabs"):
        try:
            os.remove(os.path.join(base, name))
        except FileNotFoundError:
            pass


# Chrome を起動する前に消すもの（キャッシュと履歴）。ログイン状態（Cookies・Local Storage・IndexedDB）は残す
PROFILE_JUNK = [
    "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache",
    # Service Worker はサイトのキャッシュ（CacheStorage）が大半。消してもサイトが登録し直す
    "Service Worker",
    "History", "History-journal", "Favicons", "Favicons-journal", "Top Sites", "Top Sites-journal",
    "Visited Links", "Shortcuts", "Shortcuts-journal",
    "Network Action Predictor", "Network Action Predictor-journal",
]


def dir_size(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def clean_profile() -> None:
    """Chrome のキャッシュと履歴を消す（Chrome が動いていないときだけ呼ぶ）。"""
    before = dir_size(PROFILE_DIR)
    base = os.path.join(PROFILE_DIR, "Default")
    for name in PROFILE_JUNK:
        path = os.path.join(base, name)
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
    after = dir_size(PROFILE_DIR)
    log(f"Chrome のキャッシュと履歴を消しました（Chrome のデータ {before / 1e6:.0f}MB → {after / 1e6:.0f}MB）")


CACHE_CLEAR_INTERVAL = int(os.environ.get("WMP_CACHE_CLEAR_SEC", 24 * 3600))
CACHE_ORIGINS = ("https://music.nintendo.com", "https://music.youtube.com")


async def clear_cache_daily() -> None:
    """動いている Chrome のキャッシュを1日1回消す（再生中・スピーカーへ出力中は次の機会に回す）。
    https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-clearBrowserCache
    https://chromedevtools.github.io/devtools-protocol/tot/Storage/#method-clearDataForOrigin
    """
    while True:
        await asyncio.sleep(CACHE_CLEAR_INTERVAL)
        while session.active() or streamer.clients:
            await asyncio.sleep(600)
        try:
            before = dir_size(PROFILE_DIR)
            async with bridge.lock:
                await bridge._cdp([("Network.clearBrowserCache", {})] + [
                    ("Storage.clearDataForOrigin", {"origin": o, "storageTypes": "cache_storage,shader_cache"})
                    for o in CACHE_ORIGINS])
            log(f"Chrome のキャッシュを消しました（Chrome のデータ {before / 1e6:.0f}MB → {dir_size(PROFILE_DIR) / 1e6:.0f}MB）")
        except Exception as e:
            log(f"Chrome のキャッシュを消せませんでした: {e}")


async def after_chrome_start() -> None:
    """Chrome が起き直したら、お気に入りの再生は続けられない（画面の状態が失われる）ので終え、
    音を止めてタブを1つにする。"""
    try:
        if session.active():
            await session.end_by_manual("Chrome が起動し直した")
        await bridge.reset_tabs()
    except Exception as e:
        log(f"Chrome の起動後の片付けに失敗しました: {e}")


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
# ホスト自身（HA 本体と host_network のアドオン）以外は断る
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
        "sink": sink_state,  # RUNNING なら Chrome の音が出ている
    })


bridge = Bridge(log, lang=NM_LANG, env=ENV)


def bridge_handler(fn):
    async def handler(req: web.Request) -> web.Response:
        try:
            return web.json_response(await fn(req))
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)
        except Exception as e:
            log(f"ブリッジ API {req.method} {req.path} でエラー: {e}")
            return web.json_response({"error": str(e)}, status=500)
    return handler


streamer = Streamer(log, ENV, SINK, int(os.environ.get("NM_RATE", "48000")), PORT)
ha = HomeAssistant()


async def b_cast(req: web.Request):
    body = await req.json()
    await session.cast_to(body["entity_id"])
    return {"ok": True, "url": streamer.url()}


favs = Favorites()
session = Session(log, bridge, ha, streamer)


async def b_fav_add(req: web.Request):
    body = await req.json()
    return favs.add(body.get("name", ""), body.get("url", ""))


async def b_fav_current(req: web.Request):
    """いま Chrome で開いている画面をお気に入りに追加する。名前は省略時はページの題名から作る。"""
    body = await req.json() if req.can_read_body else {}
    st = await bridge.status()
    title = await bridge._eval("document.title")
    name = (body.get("name") or (title or "").replace(" - YouTube Music", "").strip() or st["url"])[:80]
    return favs.add(name, st["url"])


async def b_fav_move(req: web.Request):
    favs.move(req.match_info["id"], int((await req.json()).get("delta", 0)))
    return favs.list()


async def b_fav_remove(req: web.Request):
    favs.remove(req.match_info["id"])
    return favs.list()


async def b_session_play(req: web.Request):
    body = await req.json()
    await session.start(favs.resolve(body.get("favorites"), bool(body.get("shuffle"))),
                        body.get("entity_id") or None)
    return session.state()


async def b_open(req: web.Request):
    await session.end_by_manual("パネルで別のページを開いた")
    return await bridge.open_site(req.match_info["service"])


async def b_session_stop(_req: web.Request):
    await session.stop()
    return session.state()


async def ev_play(data: dict) -> None:
    """HA のイベント web_music_player_play:
    {"favorites": [名前...], "shuffle": true/false, "entity_id": "media_player.xxx"}
    favorites を省略するとお気に入りの全部。shuffle で順番を混ぜる。"""
    try:
        items = favs.resolve(data.get("favorites"), bool(data.get("shuffle")))
        log("HA から再生の指示を受けました: " + "、".join(it["name"] for it in items)
            + f" → {data.get('entity_id') or '（スピーカー指定なし）'}")
        await session.start(items, data.get("entity_id") or None)
    except Exception as e:
        log(f"HA からの再生の指示を実行できませんでした: {e}")


async def ev_stop(_data: dict) -> None:
    log("HA から停止の指示を受けました")
    await session.stop()


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


# 「いまの画面を記録」の記録。新しい順に INSPECT_KEEP 件まで /data に残す（再起動しても読めるように）
INSPECT_FILE = "/data/inspect.json"
INSPECT_KEEP = 10


def load_inspects() -> list:
    try:
        with open(INSPECT_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


async def api_inspect_take(_req: web.Request) -> web.Response:
    try:
        rep = await bridge.inspect()
    except Exception as e:
        return web.json_response({"error": f"画面を記録できませんでした: {e}"}, status=500)
    reps = [rep] + load_inspects()[: INSPECT_KEEP - 1]
    with open(INSPECT_FILE, "w", encoding="utf-8") as f:
        json.dump(reps, f, ensure_ascii=False)
    log(f"画面を記録しました: {rep.get('title')}（{rep.get('url')}、部品 {len(rep.get('controls') or [])} 個）")
    return web.json_response(rep)


async def api_inspect_list(_req: web.Request) -> web.Response:
    return web.json_response(load_inspects())


async def index(_req: web.Request) -> web.FileResponse:
    return web.FileResponse(os.path.join(WWW_DIR, "index.html"),
                            headers={"Cache-Control": "no-store"})


async def on_startup(app: web.Application) -> None:
    await start_display()
    await start_audio()
    app["watch"] = asyncio.create_task(watch_chrome())
    app["cache"] = asyncio.create_task(clear_cache_daily())
    if ha.token:
        app["events"] = asyncio.create_task(ha.listen_events(
            {"web_music_player_play": ev_play, "web_music_player_stop": ev_stop}, log))


async def on_cleanup(app: web.Application) -> None:
    app["watch"].cancel()
    app["cache"].cancel()
    if "events" in app:
        app["events"].cancel()
    for p in procs.values():
        if p.returncode is None:
            p.terminate()


def main() -> None:
    app = web.Application(middlewares=[only_ingress])
    app.router.add_get("/", index)
    app.router.add_get("/api/status", api_status)
    app.router.add_post("/api/inspect", api_inspect_take)
    app.router.add_get("/api/inspect", api_inspect_list)
    # ブリッジ API（パネルと HA から使う）
    app.router.add_get("/bridge/status", bridge_handler(lambda r: bridge.status()))
    app.router.add_post("/bridge/{action:next|previous}", bridge_handler(
        lambda r: bridge.control(r.match_info["action"])))
    # 一時停止・再開はスピーカーにも同時に指示する（再生セッション中のとき）
    app.router.add_post("/bridge/pause", bridge_handler(lambda r: session.pause()))
    app.router.add_post("/bridge/resume", bridge_handler(lambda r: session.resume()))
    app.router.add_post("/bridge/open/{service}", bridge_handler(b_open))
    app.router.add_get("/bridge/favorites",bridge_handler(lambda r: asyncio.sleep(0, favs.list())))
    app.router.add_post("/bridge/favorites", bridge_handler(b_fav_add))
    app.router.add_post("/bridge/favorites/current", bridge_handler(b_fav_current))
    app.router.add_post("/bridge/favorites/{id}/move", bridge_handler(b_fav_move))
    app.router.add_delete("/bridge/favorites/{id}", bridge_handler(b_fav_remove))
    app.router.add_get("/bridge/session", bridge_handler(lambda r: asyncio.sleep(0, session.state())))
    app.router.add_post("/bridge/session/play", bridge_handler(b_session_play))
    app.router.add_post("/bridge/session/stop", bridge_handler(b_session_stop))
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
