"""お気に入りリストと、そこから選んだプレイリストを順にスピーカーで流す再生セッション。

お気に入りは /data/favorites.json に [{"id", "name", "url"}] で保存する。
URL から Nintendo Music / YouTube Music を判別する:
- Nintendo Music: music.nintendo.com のゲーム・プレイリストのページ。ページを開いて再生ボタンを押す
- YouTube Music: list= を含む URL（playlist?list=... / watch?...&list=...）。watch?list= を開いて自動再生させる
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import secrets
import time
from urllib.parse import parse_qs, urlsplit

FAV_FILE = "/data/favorites.json"
# 再生が止まったままこの秒数続いたら、そのプレイリストは終わったとみなす（利用者が一時停止したときは除く）
END_IDLE_SECONDS = 15


# Nintendo Music で、開いてページ本体の再生ボタンを押せば流れるページ。
# ルートは Web 版の JS のルート表（"/:lang/game/:gameId"、"/:lang/playlist/:playlistId" 等）で確認した。
# ユーザープレイリスト（/:lang/user-playlist/...）は、再生ボタンで流れるかを実機で確かめていないので受け付けない
NM_PAGES = ("game", "playlist")


def normalize(url: str) -> str:
    """共有リンクを、アプリで開ける URL に直す。

    共有リンク https://music.nintendo.com/shared/<lang>/<国>/officialPlaylists/<ID> は
    share.music.nintendo.com の紹介ページへ飛ぶだけで再生できない。紹介ページの中のリンクは
    https://music.nintendo.com/<lang>/playlist/<ID>/ なので、そちらにする（実測）。
    """
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    seg = [s for s in parts.path.split("/") if s]
    if host in ("music.nintendo.com", "share.music.nintendo.com"):
        if host == "music.nintendo.com" and seg[:1] == ["shared"]:
            seg = seg[1:]
        if len(seg) == 4 and seg[2] == "officialPlaylists":
            return f"https://music.nintendo.com/{seg[0]}/playlist/{seg[3]}/"
    return url.strip()


def detect(url: str) -> tuple[str, str]:
    """(サービス, 再生に使う値) を返す。対応していない URL なら ValueError。"""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    if host == "music.nintendo.com":
        seg = [s for s in parts.path.split("/") if s]
        if len(seg) == 3 and seg[1] in NM_PAGES:
            return "nm", url.strip()
        raise ValueError("Nintendo Music は、ゲームかプレイリストのページの URL を指定してください"
                         "（例: https://music.nintendo.com/ja-JP/playlist/... 。共有リンクも使えます）")
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
        out = []
        for it in self.items:
            try:
                service = detect(it["url"])[0]
            except ValueError:
                service = "unsupported"  # 以前の版で登録できた、いまは再生できない URL
            out.append({**it, "service": service})
        return out

    def add(self, name: str, url: str) -> dict:
        url = normalize(url)
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

    def resolve(self, keys: list[str] | str | None, shuffle: bool = False) -> list[dict]:
        """名前または id で引く（HA からは名前で指定する）。見つからない名前があれば ValueError。

        keys を省略（空）したときは、お気に入りの全部を並び順で返す。shuffle なら順番を混ぜる。
        """
        if isinstance(keys, str):
            keys = [keys]
        if not keys:
            out = list(self.items)
            if not out:
                raise ValueError("お気に入りが1つも登録されていません")
        else:
            out = []
            for k in keys:
                it = next((it for it in self.items if it["name"] == k or it["id"] == k), None)
                if it is None:
                    raise ValueError(f"お気に入りに「{k}」がありません")
                out.append(it)
        if shuffle:
            random.shuffle(out)
        return out


# スピーカーからの接続がこの秒数切れたままなら、スピーカー側で止められたとみなす
SPEAKER_GONE_SECONDS = 30


class Session:
    """お気に入りのプレイリストを順に再生し、スピーカーへ流す。

    いまストリームを流しているスピーカー（speaker）はここで1つだけ持つ。パネルの
    「スピーカーで再生」もここを通すので、2台で同時に鳴ることはない。
    """

    def __init__(self, log, bridge, ha, streamer) -> None:
        self.log = log
        self.bridge = bridge
        self.ha = ha
        self.streamer = streamer
        self.task: asyncio.Task | None = None
        self.entity_id: str | None = None
        self.speaker: str | None = None
        self.cast_at = 0.0
        self.queue: list[dict] = []
        self.current: dict | None = None
        self.user_paused = False
        self.watch: asyncio.Task | None = None
        self.shuffle_tracks = False

    def active(self) -> bool:
        return self.task is not None and not self.task.done()

    def state(self) -> dict:
        return {"active": self.active(),
                "entity_id": self.entity_id,
                "speaker": self.speaker,
                "current": self.current["name"] if self.current else None,
                "remaining": [it["name"] for it in self.queue]}

    # ------------------------------------------------------------ スピーカー
    async def cast_to(self, entity_id: str) -> None:
        """スピーカーでストリームを再生させる。別のスピーカーで流していたら、そちらは止める。"""
        if self.speaker == entity_id and self.streamer.clients > 0:
            return  # もう流れている。Cast し直すと数秒途切れるのでしない
        if self.speaker and self.speaker != entity_id:
            await self._stop_speaker()
        await self.ha.play_url(entity_id, self.streamer.url())
        self.speaker = entity_id
        self.cast_at = time.monotonic()
        self.log(f"{entity_id} でストリームの再生を始めました")
        if self.watch is None or self.watch.done():
            self.watch = asyncio.create_task(self._watch_speaker())

    async def _stop_speaker(self) -> None:
        if not self.speaker:
            return
        try:
            await self.ha.call(self.speaker, "media_stop")
        except Exception as e:
            self.log(f"{self.speaker} の停止に失敗しました: {e}")
        self.speaker = None

    async def _watch_speaker(self) -> None:
        """スピーカー側で止められた（HA・本体の操作、入力の切り替え等）ら、こちらも止める。
        止めないと Chrome が鳴り続け、お気に入りも誰も聞いていないまま次へ進んでいく。"""
        while self.speaker:
            await asyncio.sleep(5)
            if not self.speaker or self.user_paused or self.streamer.clients > 0:
                continue
            gone = time.monotonic() - max(self.cast_at, self.streamer.last_disconnect)
            if gone >= SPEAKER_GONE_SECONDS:
                self.log(f"{self.speaker} がストリームを{SPEAKER_GONE_SECONDS}秒以上取りに来ないため、"
                         "スピーカー側で止められたとみなして再生を止めます")
                self.speaker = None
                await self._cancel()
                try:
                    await self.bridge.pause_all()
                except Exception:
                    pass
                return

    # ------------------------------------------------------------ 操作
    async def _cancel(self) -> None:
        if self.active():
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
        self.task = None
        self.current = None
        self.queue = []

    async def start(self, items: list[dict], entity_id: str | None, shuffle_tracks: bool = False) -> None:
        """お気に入りを順に再生する。前の再生中なら切り替える。
        entity_id を省いたときは、いま流しているスピーカーがあればそのまま流し続ける。"""
        await self._cancel()
        self.queue = list(items)
        self.entity_id = entity_id
        self.shuffle_tracks = shuffle_tracks  # プレイリストの中の曲もシャッフルで再生する
        self.user_paused = False
        self.task = asyncio.create_task(self._run())

    async def end_by_manual(self, what: str) -> None:
        """パネルから手で別のものを再生・表示したとき。お気に入りの順送りだけを終える（スピーカーはそのまま）。"""
        if self.active():
            await self._cancel()
            self.log(f"{what}ため、お気に入りの再生を終えました（スピーカーへの出力は続けます）")

    async def stop(self) -> None:
        """止める（HA のイベント・パネルの停止）。お気に入りの再生中でなくても、全部のタブの音と
        スピーカーを止める。"""
        await self._cancel()
        try:
            await self.bridge.pause_all()
        except Exception as e:
            self.log(f"Chrome の停止に失敗しました: {e}")
        await self._stop_speaker()
        self.log("再生を止めました")

    async def pause(self) -> None:
        self.user_paused = True
        # スピーカーはため込んだ分を持ったまま止まるので、先に止めると体感の遅れが小さい
        if self.speaker:
            await self.ha.call(self.speaker, "media_pause")
        try:
            # 再生ボタンの表示も「一時停止中」にするため、まずページのボタンで止める
            await self.bridge.control("pause")
        finally:
            # ボタンが見つからなくても、ほかのタブの分も含めて音は必ず止める
            await self.bridge.pause_all()

    async def resume(self) -> None:
        await self.bridge.control("resume")
        if self.speaker:
            await self.ha.call(self.speaker, "media_play")
            # 一時停止中にスピーカーが接続を切っていることがある。取りに来直すまで猶予を与える
            self.cast_at = time.monotonic()
        self.user_paused = False

    async def _play(self, item: dict) -> None:
        service, value = detect(item["url"])
        await self.bridge.wait_ready()
        for attempt in (1, 2):
            recovered = self.bridge.recover_count
            try:
                if service == "nm":
                    await self.bridge.play_nm_url(value, shuffle=self.shuffle_tracks)
                else:
                    await self.bridge.play_ytm(value, shuffle=self.shuffle_tracks)
                return
            except Exception as e:
                # 開いている途中でページが固まり、タブを開き直した（実機で YouTube Music から
                # 別の YouTube Music を開いたときに2回起きた）。開き直したタブでもう一度だけ試す
                if attempt == 1 and self.bridge.recover_count != recovered:
                    self.log(f"「{item['name']}」の途中でタブを開き直したため、もう一度開きます（{e}）")
                    continue
                raise

    async def _wait_finished(self, item: dict) -> None:
        service, value = detect(item["url"])
        idle_since = None
        first_title = None   # このお気に入りで最初に流れた曲
        others = False       # 最初の曲以外を流したか
        last = None          # 前回見た (曲名, 再生位置, 長さ)
        while True:
            await asyncio.sleep(2)
            try:
                st = await self.bridge.status()
            except Exception:
                continue
            title, pos, dur = st.get("title"), st.get("position"), st.get("duration")
            if service == "nm" and title and st.get("paused") is False and not self.user_paused:
                # Nintendo Music がリピート再生だと、プレイリストの最後から頭に戻って止まらない
                # （実機で、90秒の1曲だけのプレイリストが 57秒→45秒後に20秒 と頭に戻った）。
                # 一周したら終わりとみなす:
                # - 最初の曲以外を流したあとで、最初の曲に戻ってきた
                # - 1曲だけのとき、曲の終わり近くから頭に戻った
                first_title = first_title or title
                if title != first_title:
                    others = True
                elif others:
                    self.log(f"「{item['name']}」を一周しました（最初の曲に戻ったため次へ）")
                    return
                elif (last and last[0] == title and pos is not None and last[1] is not None and dur
                      and last[1] >= dur - 15 and pos < last[1] - 5):
                    self.log(f"「{item['name']}」を一周しました（曲の最後から頭に戻ったため次へ）")
                    return
                last = (title, pos, dur)
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
                    await self.cast_to(self.entity_id)
                first = False
                await self._wait_finished(item)
            self.log("お気に入りの再生がすべて終わりました")
            try:
                await self.bridge.pause_all()
            except Exception:
                pass
            await self._stop_speaker()
        finally:
            self.current = None
