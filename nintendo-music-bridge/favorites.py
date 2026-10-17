"""お気に入りリストと、そこから選んだプレイリストを順にスピーカーで流す再生セッション。

お気に入りは /data/favorites.json に [{"id", "name", "url"}] で保存する。
URL から Nintendo Music / YouTube Music を判別する:
- Nintendo Music: music.nintendo.com のページ（プレイリスト・ユーザープレイリスト等）。ページを開いて再生ボタンを押す
- YouTube Music: list= を含む URL（playlist?list=... / watch?...&list=...）。watch?list= を開いて自動再生させる
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
from urllib.parse import parse_qs, urlsplit

FAV_FILE = "/data/favorites.json"
# 再生が止まったままこの秒数続いたら、そのプレイリストは終わったとみなす（利用者が一時停止したときは除く）
END_IDLE_SECONDS = 15


def detect(url: str) -> tuple[str, str]:
    """(サービス, 再生に使う値) を返す。対応していない URL なら ValueError。"""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    if host == "music.nintendo.com":
        return "nm", url.strip()
    if host in ("music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com"):
        lst = parse_qs(parts.query).get("list", [""])[0]
        if lst:
            return "ytm", lst
        raise ValueError("YouTube Music の URL には list=（プレイリスト）が必要です")
    raise ValueError("Nintendo Music（music.nintendo.com）か YouTube Music（music.youtube.com）の URL を指定してください")


class Favorites:
    def __init__(self) -> None:
        self.items: list[dict] = []
        try:
            with open(FAV_FILE) as f:
                self.items = json.load(f)
        except (OSError, ValueError):
            self.items = []

    def _save(self) -> None:
        tmp = FAV_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.items, f, ensure_ascii=False, indent=1)
        os.replace(tmp, FAV_FILE)

    def list(self) -> list[dict]:
        return [{**it, "service": detect(it["url"])[0]} for it in self.items]

    def add(self, name: str, url: str) -> dict:
        detect(url)
        name = name.strip()
        if not name:
            raise ValueError("名前を入れてください")
        if any(it["name"] == name for it in self.items):
            raise ValueError(f"「{name}」はもうあります（HA からは名前で選ぶので、重ならない名前にしてください）")
        item = {"id": secrets.token_hex(4), "name": name, "url": url.strip()}
        self.items.append(item)
        self._save()
        return item

    def remove(self, fav_id: str) -> None:
        self.items = [it for it in self.items if it["id"] != fav_id]
        self._save()

    def move(self, fav_id: str, delta: int) -> None:
        i = next(i for i, it in enumerate(self.items) if it["id"] == fav_id)
        j = max(0, min(len(self.items) - 1, i + delta))
        self.items.insert(j, self.items.pop(i))
        self._save()

    def resolve(self, keys: list[str] | str) -> list[dict]:
        """名前または id で引く（HA からは名前で指定する）。見つからない名前があれば ValueError。"""
        if isinstance(keys, str):
            keys = [keys]
        out = []
        for k in keys:
            it = next((it for it in self.items if it["name"] == k or it["id"] == k), None)
            if it is None:
                raise ValueError(f"お気に入りに「{k}」がありません")
            out.append(it)
        return out


class Session:
    """お気に入りのプレイリストを順に再生し、スピーカーへ流す。"""

    def __init__(self, log, bridge, ha, streamer) -> None:
        self.log = log
        self.bridge = bridge
        self.ha = ha
        self.streamer = streamer
        self.task: asyncio.Task | None = None
        self.entity_id: str | None = None
        self.queue: list[dict] = []
        self.current: dict | None = None
        self.user_paused = False

    def state(self) -> dict:
        return {"active": self.task is not None and not self.task.done(),
                "entity_id": self.entity_id,
                "current": self.current["name"] if self.current else None,
                "remaining": [it["name"] for it in self.queue]}

    async def start(self, items: list[dict], entity_id: str | None) -> None:
        await self.stop(quiet=True)
        self.queue = list(items)
        self.entity_id = entity_id
        self.user_paused = False
        self.task = asyncio.create_task(self._run())

    async def stop(self, quiet: bool = False) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
            if not quiet:
                try:
                    await self.bridge.control("pause")
                except Exception:
                    pass
                if self.entity_id:
                    try:
                        await self.ha.call(self.entity_id, "media_stop")
                    except Exception as e:
                        self.log(f"スピーカーの停止に失敗しました: {e}")
                self.log("再生を止めました")
        self.task = None
        self.current = None
        self.queue = []

    async def pause(self) -> None:
        self.user_paused = True
        # スピーカーはため込んだ分を持ったまま止まるので、先に止めると体感の遅れが小さい
        if self.entity_id and self.state()["active"]:
            await self.ha.call(self.entity_id, "media_pause")
        await self.bridge.control("pause")

    async def resume(self) -> None:
        await self.bridge.control("resume")
        if self.entity_id and self.state()["active"]:
            await self.ha.call(self.entity_id, "media_play")
        self.user_paused = False

    async def _play(self, item: dict) -> None:
        service, value = detect(item["url"])
        await self.bridge.wait_ready()
        if service == "nm":
            await self.bridge.play_nm_url(value)
        else:
            await self.bridge.play_ytm(value)

    async def _wait_finished(self, item: dict) -> None:
        service, value = detect(item["url"])
        idle_since = None
        while True:
            await asyncio.sleep(2)
            try:
                st = await self.bridge.status()
            except Exception:
                continue
            if service == "ytm":
                # プレイリストを最後まで再生すると、YouTube Music は関連曲の自動再生に移り、
                # URL の list= が別のもの（ラジオ）に変わる。そうなったら次へ進む
                lst = parse_qs(urlsplit(st.get("url") or "").query).get("list", [""])[0]
                if lst and lst != value:
                    self.log(f"「{item['name']}」の最後まで再生しました（自動再生に移ったため次へ）")
                    return
            playing = st.get("paused") is False
            if playing or self.user_paused:
                idle_since = None
                continue
            idle_since = idle_since or time.monotonic()
            if time.monotonic() - idle_since >= END_IDLE_SECONDS:
                self.log(f"「{item['name']}」の再生が終わりました")
                return

    async def _run(self) -> None:
        try:
            first = True
            while self.queue:
                item = self.queue.pop(0)
                self.current = item
                self.log(f"「{item['name']}」を再生します（{item['url']}）")
                try:
                    await self._play(item)
                except Exception as e:
                    self.log(f"「{item['name']}」を再生できませんでした: {e}")
                    continue
                if first and self.entity_id:
                    await self.ha.play_url(self.entity_id, self.streamer.url())
                    self.log(f"{self.entity_id} でストリームの再生を始めました")
                    first = False
                await self._wait_finished(item)
            self.log("お気に入りの再生がすべて終わりました")
            try:
                await self.bridge.control("pause")
            except Exception:
                pass
            if self.entity_id and not first:
                await self.ha.call(self.entity_id, "media_stop")
        finally:
            self.current = None
