"""スピーカーへの出力: Chrome の音を MP3 のストリームにして、HA の Cast 連携でスピーカーに再生させる。

- ストリーム: PipeWire の出力シンクのモニターを parec で読み、ffmpeg で MP3 にして HTTP で流す
  （インターネットラジオと同じ形。スピーカーが自分で取りに来る）
- スピーカーは LAN 側から取りに来るので、/stream/<トークン>/ だけは LAN からも受け付ける。
  トークンは推測できない乱数で、/data に保存して再起動後も同じ URL にする
- 再生の指示は HA の media_player.play_media を Supervisor 経由の Core API で呼ぶ
  https://contributors.home-assistant.io/apps/guides/communication/
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import socket
import time

import aiohttp
from aiohttp import web

TOKEN_FILE = "/data/stream_token"
CORE_API = "http://supervisor/core/api"


def stream_token() -> str:
    try:
        with open(TOKEN_FILE) as f:
            tok = f.read().strip()
        if tok:
            return tok
    except OSError:
        pass
    tok = secrets.token_hex(16)
    with open(TOKEN_FILE, "w") as f:
        f.write(tok)
    return tok


def lan_ip() -> str:
    """このホストの LAN 側 IP（スピーカーが取りに来る宛先）。既定経路の送信元アドレスを使う。"""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        # UDP の connect はパケットを送らない。経路の決定だけに使う
        s.connect(("192.0.2.1", 9))
        return s.getsockname()[0]


class Streamer:
    def __init__(self, log, env: dict, sink: str, rate: int, port: int) -> None:
        self.log = log
        self.env = env
        self.sink = sink
        self.rate = rate
        self.port = port
        self.token = stream_token()
        self.clients = 0
        self.last_disconnect = 0.0  # 最後にスピーカーの接続が切れた時刻（time.monotonic）

    def url(self) -> str:
        return f"http://{lan_ip()}:{self.port}/stream/{self.token}/live.mp3"

    async def handle(self, req: web.Request) -> web.StreamResponse:
        if req.match_info.get("token") != self.token:
            raise web.HTTPNotFound()
        resp = web.StreamResponse(headers={
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-cache, no-store",
            "icy-name": "Web Music Player",
        })
        await resp.prepare(req)
        if req.method == "HEAD":
            return resp
        # parec（出力シンクのモニター）→ ffmpeg（MP3）を1本のパイプでつなぐ
        cmd = (f"parec -d {self.sink}.monitor --raw --format=s16le --rate={self.rate} --channels=2 "
               f"--latency-msec=50 | ffmpeg -hide_banner -loglevel error -f s16le -ar {self.rate} -ac 2 "
               f"-i pipe:0 -c:a libmp3lame -b:a 256k -f mp3 pipe:1")
        proc = await asyncio.create_subprocess_shell(
            cmd, env=self.env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True)
        self.clients += 1
        self.log(f"スピーカーへの出力を開始しました（接続元 {req.remote}、接続中 {self.clients}）")
        try:
            while chunk := await proc.stdout.read(16384):
                await resp.write(chunk)
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            self.clients -= 1
            self.last_disconnect = time.monotonic()
            try:
                os.killpg(proc.pid, 15)
            except ProcessLookupError:
                pass
            err = (await proc.stderr.read()).decode(errors="replace").strip()
            await proc.wait()
            self.log(f"スピーカーへの出力を終了しました（接続元 {req.remote}）" + (f": {err[-300:]}" if err else ""))
        return resp


class HomeAssistant:
    """Supervisor 経由で HA Core の REST API を呼ぶ（config の homeassistant_api: true が必要）。"""

    def __init__(self) -> None:
        self.token = os.environ.get("SUPERVISOR_TOKEN", "")
        self.base = os.environ.get("NM_CORE_API", CORE_API)

    async def _req(self, method: str, path: str, json=None):
        if not self.token:
            raise RuntimeError("HA の API を使えません（SUPERVISOR_TOKEN がありません）")
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as s:
            async with s.request(method, f"{self.base}{path}", json=json,
                                 headers={"Authorization": f"Bearer {self.token}"}) as r:
                if r.status >= 400:
                    raise RuntimeError(f"HA の API {path} が {r.status} を返しました: {(await r.text())[:200]}")
                return await r.json(content_type=None)

    async def players(self) -> list[dict]:
        states = await self._req("GET", "/states")
        return sorted(({"entity_id": s["entity_id"],
                        "name": s.get("attributes", {}).get("friendly_name") or s["entity_id"],
                        "state": s.get("state")}
                       for s in states if s["entity_id"].startswith("media_player.")),
                      key=lambda p: p["name"])

    async def play_url(self, entity_id: str, url: str) -> None:
        # media_content_type は Chromecast の contentType にそのまま渡る（HA の cast の
        # async_play_media → pychromecast の play_media）ので、MIME タイプにする。以前は "music" を
        # 渡していた。https://www.home-assistant.io/integrations/cast/ には「media_content_type を
        # 中身に合った型にする」とある。stream_type は pychromecast の既定が LIVE なので指定しない
        # https://github.com/home-assistant-libs/pychromecast/blob/master/pychromecast/controllers/media.py
        await self._req("POST", "/services/media_player/play_media", json={
            "entity_id": entity_id,
            "media_content_id": url,
            "media_content_type": "audio/mpeg",
            "extra": {"metadata": {"metadataType": 3, "title": "Web Music Player"}},  # 3 = MusicTrack
        })

    async def call(self, entity_id: str, service: str) -> None:
        """media_player の操作（media_pause / media_play / media_stop など）。"""
        await self._req("POST", f"/services/media_player/{service}", json={"entity_id": entity_id})

    async def listen_events(self, handlers: dict, log) -> None:
        """HA のイベントを WebSocket で受け取り、event_type ごとの関数を呼ぶ。切れたらつなぎ直す。
        https://contributors.home-assistant.io/core/internals/websocket-api/
        アドオンからは ws://supervisor/core/websocket に SUPERVISOR_TOKEN で接続する
        https://contributors.home-assistant.io/apps/guides/communication/
        """
        ws_url = os.environ.get("NM_CORE_WS", "ws://supervisor/core/websocket")
        delay = 5
        while True:
            try:
                async with aiohttp.ClientSession() as s:
                    async with s.ws_connect(ws_url, heartbeat=30) as ws:
                        msg = await ws.receive_json()
                        if msg.get("type") != "auth_required":
                            raise RuntimeError(f"想定外の応答: {msg}")
                        await ws.send_json({"type": "auth", "access_token": self.token})
                        msg = await ws.receive_json()
                        if msg.get("type") != "auth_ok":
                            raise RuntimeError(f"HA の認証に失敗しました: {msg}")
                        for i, event_type in enumerate(handlers, 1):
                            await ws.send_json({"id": i, "type": "subscribe_events", "event_type": event_type})
                        log("HA のイベント（" + " / ".join(handlers) + "）を待ち受けています")
                        delay = 5
                        async for m in ws:
                            if m.type != aiohttp.WSMsgType.TEXT:
                                continue
                            data = json.loads(m.data)
                            if data.get("type") == "result" and not data.get("success"):
                                log(f"HA のイベントの購読に失敗しました: {data}")
                            if data.get("type") != "event":
                                continue
                            ev = data.get("event", {})
                            fn = handlers.get(ev.get("event_type"))
                            if fn:
                                asyncio.create_task(fn(ev.get("data") or {}))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log(f"HA との接続が切れました（{e}）。{delay}秒後につなぎ直します")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)
