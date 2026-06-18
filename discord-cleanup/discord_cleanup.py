#!/usr/bin/env python3
"""
Discord Chat Cleanup Script
指定チャンネルの一定期間より古いメッセージを削除する
BotをDiscordサーバに追加する方法
 Developer Portal -> App -> Oauth2 -> Botを選択 -> メッセージを管理を選択 -> 生成されたURLにアクセス
 対象のDiscordのチャネルに権限を付け、チャネルIDをコピーしてアドオンの設定に登録
"""

import os
import time
import requests
from datetime import datetime, timezone, timedelta

BOT_TOKEN   = os.environ.get("BOT_TOKEN", "")
CHANNEL_IDS = os.environ.get("CHANNEL_IDS", "").split()
KEEP_DAYS   = int(os.environ.get("KEEP_DAYS", "30"))
DRY_RUN     = os.environ.get("DRY_RUN", "false").lower() == "true"

HEADERS = {
    "Authorization": f"Bot {BOT_TOKEN}",
    "Content-Type": "application/json",
}

# Discord の bulk delete は 14 日以内のメッセージのみ対応
# それ以上古いものは 1 件ずつ削除
BULK_DELETE_LIMIT_DAYS = 13  # 余裕を持って 13 日


def log(msg: str):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {msg}", flush=True)


def get_messages(channel_id: str, before: str = None) -> list:
    """チャンネルのメッセージを最大100件取得"""
    url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
    params = {"limit": 100}
    if before:
        params["before"] = before

    resp = requests.get(url, headers=HEADERS, params=params)
    if resp.status_code == 200:
        return resp.json()
    elif resp.status_code == 429:
        retry_after = resp.json().get("retry_after", 1)
        log(f"  レート制限中... {retry_after:.1f}秒待機")
        time.sleep(retry_after + 0.5)
        return get_messages(channel_id, before)
    else:
        log(f"  メッセージ取得エラー: {resp.status_code} {resp.text}")
        return []


def bulk_delete(channel_id: str, message_ids: list):
    """14日以内のメッセージをまとめて削除（最大100件）"""
    if DRY_RUN:
        log(f"  [DRY RUN] bulk delete: {len(message_ids)} 件")
        return True

    url = f"https://discord.com/api/v10/channels/{channel_id}/messages/bulk-delete"
    resp = requests.post(url, headers=HEADERS, json={"messages": message_ids})
    if resp.status_code == 204:
        return True
    elif resp.status_code == 429:
        retry_after = resp.json().get("retry_after", 1)
        log(f"  レート制限中... {retry_after:.1f}秒待機")
        time.sleep(retry_after + 0.5)
        return bulk_delete(channel_id, message_ids)
    else:
        log(f"  bulk delete エラー: {resp.status_code} {resp.text}")
        return False


def delete_single(channel_id: str, message_id: str):
    """1件ずつ削除（14日以上古いメッセージ用）"""
    if DRY_RUN:
        log(f"  [DRY RUN] 単件削除: {message_id}")
        return True

    url = f"https://discord.com/api/v10/channels/{channel_id}/messages/{message_id}"
    resp = requests.delete(url, headers=HEADERS)
    if resp.status_code == 204:
        return True
    elif resp.status_code == 429:
        retry_after = resp.json().get("retry_after", 1)
        log(f"  レート制限中... {retry_after:.1f}秒待機")
        time.sleep(retry_after + 0.5)
        return delete_single(channel_id, message_id)
    elif resp.status_code == 404:
        # すでに削除済み
        return True
    else:
        log(f"  単件削除エラー ({message_id}): {resp.status_code} {resp.text}")
        return False


def snowflake_to_datetime(snowflake_id: str) -> datetime:
    """Discord Snowflake ID から UTC datetime を得る"""
    DISCORD_EPOCH = 1420070400000
    timestamp_ms = (int(snowflake_id) >> 22) + DISCORD_EPOCH
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)


def cleanup_channel(channel_id: str):
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    bulk_cutoff = datetime.now(timezone.utc) - timedelta(days=BULK_DELETE_LIMIT_DAYS)

    log(f"チャンネル {channel_id} の処理開始 (cutoff: {cutoff.strftime('%Y-%m-%d')})")

    total_deleted = 0
    last_id = None

    while True:
        messages = get_messages(channel_id, before=last_id)
        if not messages:
            break

        # 削除対象のみ抽出（cutoff より古いもの）
        old_messages = [m for m in messages if snowflake_to_datetime(m["id"]) < cutoff]

        if not old_messages:
            # このページに削除対象がなければ終了
            # （メッセージは新しい順なので、古いものに当たるまでページングが必要な場合もある）
            if len(messages) < 100:
                break
            last_id = messages[-1]["id"]
            continue

        # bulk delete 対象（14日以内）と単件削除対象（それ以上古い）に分類
        bulk_ids = [
            m["id"] for m in old_messages
            if snowflake_to_datetime(m["id"]) >= bulk_cutoff
        ]
        single_ids = [
            m["id"] for m in old_messages
            if snowflake_to_datetime(m["id"]) < bulk_cutoff
        ]

        # Bulk delete (2件以上必要)
        for i in range(0, len(bulk_ids), 100):
            chunk = bulk_ids[i:i+100]
            if len(chunk) == 1:
                single_ids.append(chunk[0])  # 1件は単件削除へ
            elif chunk:
                if bulk_delete(channel_id, chunk):
                    total_deleted += len(chunk)
                    log(f"  bulk delete: {len(chunk)} 件削除")
                time.sleep(1)

        # 単件削除
        for msg_id in single_ids:
            if delete_single(channel_id, msg_id):
                total_deleted += 1
            time.sleep(0.5)  # 単件削除はレート制限に注意

        if len(messages) < 100:
            break
        last_id = messages[-1]["id"]
        time.sleep(0.5)

    log(f"チャンネル {channel_id} 完了: {total_deleted} 件削除{'（DRY RUN）' if DRY_RUN else ''}")
    return total_deleted


def main():
    if not BOT_TOKEN:
        log("エラー: BOT_TOKEN が設定されていません")
        return

    if not CHANNEL_IDS or CHANNEL_IDS == [""]:
        log("エラー: CHANNEL_IDS が設定されていません")
        return

    log("=" * 50)
    log(f"Discord Cleanup 開始 | 保持期間: {KEEP_DAYS} 日 | 対象: {len(CHANNEL_IDS)} チャンネル")
    if DRY_RUN:
        log("※ DRY RUN モード: 実際には削除しません")
    log("=" * 50)

    total = 0
    for ch_id in CHANNEL_IDS:
        ch_id = ch_id.strip()
        if ch_id:
            total += cleanup_channel(ch_id)

    log(f"全チャンネル完了: 合計 {total} 件削除")


if __name__ == "__main__":
    main()