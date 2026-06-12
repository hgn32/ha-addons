"""Suwayomi Server GraphQL API client (BASIC auth)."""
from __future__ import annotations

import httpx

GRAPHQL_PATH = "/api/graphql"

# Delete in batches so a single huge mutation doesn't hit request/processing
# limits on the server side.
_DELETE_CHUNK_SIZE = 500

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)

_DOWNLOADED_CHAPTERS_QUERY = """
query DownloadedChapters {
  chapters(condition: {isDownloaded: true}) {
    totalCount
    nodes { id }
  }
}
"""

_DELETE_DOWNLOADED_MUTATION = """
mutation DeleteDownloadedChapters($ids: [Int!]!) {
  deleteDownloadedChapters(input: {ids: $ids}) {
    chapters { id isDownloaded }
  }
}
"""


class SuwayomiError(Exception):
    """Suwayomi Server unreachable, auth failure, or GraphQL-level error."""


def _graphql(
    base_url: str,
    username: str,
    password: str,
    query: str,
    variables: dict | None = None,
) -> dict:
    url = base_url.rstrip("/") + GRAPHQL_PATH
    # ID/PWD未設定なら認証ヘッダなしでアクセスする（BASIC認証無効なサーバ向け）
    auth = (username, password) if (username or password) else None
    try:
        resp = httpx.post(
            url,
            json={"query": query, "variables": variables or {}},
            auth=auth,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise SuwayomiError(f"Suwayomi Server に接続できません ({url}): {e}") from e
    if resp.status_code in (401, 403):
        if auth is None:
            raise SuwayomiError(
                f"Suwayomi Server が認証を要求しています (HTTP {resp.status_code})。"
                "アドオンの「設定」タブで ID / パスワードを設定してください。"
            )
        raise SuwayomiError(
            f"Suwayomi Server の認証に失敗しました (HTTP {resp.status_code})。"
            "ID / パスワードを確認してください。"
        )
    if resp.status_code != 200:
        raise SuwayomiError(f"Suwayomi Server がエラーを返しました (HTTP {resp.status_code})")
    try:
        body = resp.json()
    except ValueError as e:
        raise SuwayomiError(
            "Suwayomi Server の応答を解析できません。URL が GraphQL API を持つ "
            "Suwayomi Server を指しているか確認してください。"
        ) from e
    errors = body.get("errors")
    if errors:
        messages = "; ".join(
            str(e.get("message", e)) if isinstance(e, dict) else str(e) for e in errors
        )
        raise SuwayomiError(f"GraphQL エラー: {messages}")
    data = body.get("data")
    if not isinstance(data, dict):
        raise SuwayomiError("Suwayomi Server の応答に data がありません")
    return data


def fetch_downloaded_chapter_ids(base_url: str, username: str, password: str) -> list[int]:
    """IDs of every chapter whose pages are currently downloaded."""
    data = _graphql(base_url, username, password, _DOWNLOADED_CHAPTERS_QUERY)
    nodes = (data.get("chapters") or {}).get("nodes") or []
    return [n["id"] for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), int)]


def delete_downloaded_chapters(
    base_url: str, username: str, password: str, ids: list[int]
) -> int:
    """Delete the downloaded files of the given chapters. Returns the number
    of chapters confirmed deleted (isDownloaded=false after the mutation)."""
    deleted = 0
    for i in range(0, len(ids), _DELETE_CHUNK_SIZE):
        chunk = ids[i : i + _DELETE_CHUNK_SIZE]
        data = _graphql(
            base_url, username, password, _DELETE_DOWNLOADED_MUTATION, {"ids": chunk}
        )
        chapters = (data.get("deleteDownloadedChapters") or {}).get("chapters")
        if isinstance(chapters, list):
            deleted += sum(
                1 for c in chapters if isinstance(c, dict) and not c.get("isDownloaded")
            )
        else:
            deleted += len(chunk)
    return deleted
