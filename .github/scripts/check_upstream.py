#!/usr/bin/env python3
"""各アドオンが載せている上流の最新版を調べ、Markdown のレポートを出す。

使い方:
    python3 .github/scripts/check_upstream.py \
        --manifest .github/upstream-checks.yaml \
        --state .github/upstream-state.json \
        --report report.md

定義の書き方は .github/upstream-checks.yaml のコメントを参照。

- pin があるもの   … ファイルに書かれた版と上流の最新を比べる
- pin が無いもの   … `:latest` のように動くタグ。前回チェック時の値と比べ、
                     動いていたら「リビルドすれば取り込める」として記録する。
                     記録は config.json の version が上がる(= 再 publish した)まで
                     残り、毎月「未取り込み」として報告される。

ネットワークが理由で個別のチェックが失敗しても、他のチェックは続行して
レポートの「エラー」節にまとめる(月次ジョブが1件の失敗で無報告になるのを防ぐ)。
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

import yaml

USER_AGENT = "ha-addons-upstream-check"
TIMEOUT = 30

GITHUB_API = "https://api.github.com"
NPM_REGISTRY = "https://registry.npmjs.org"
DOCKERHUB_API = "https://hub.docker.com/v2"

MANIFEST_ACCEPT = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)


class CheckError(Exception):
    """1件のチェックだけを失敗させる(全体は止めない)エラー。"""


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
def http(url: str, headers: dict | None = None, method: str = "GET"):
    req = urllib.request.Request(url, method=method)
    req.add_header("User-Agent", USER_AGENT)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        return urllib.request.urlopen(req, timeout=TIMEOUT)
    except urllib.error.HTTPError as err:
        body = err.read(500).decode("utf-8", "replace").strip()
        raise CheckError(f"HTTP {err.code} {url}\n{body}") from err
    except urllib.error.URLError as err:
        raise CheckError(f"接続失敗 {url}: {err.reason}") from err


def http_json(url: str, headers: dict | None = None):
    with http(url, headers) as res:
        return json.load(res)


def github_headers() -> dict:
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("UPSTREAM_REPO_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


# --------------------------------------------------------------------------
# バージョン比較
# --------------------------------------------------------------------------
def version_key(value: str):
    """"1.9.14" や "3.13-alpine3.23" を数値列にして比較できるようにする。"""
    return [int(part) for part in re.findall(r"\d+", value)] or [0]


def normalize(value: str) -> str:
    """先頭の v を落として比較する ("v4.107.0" と "4.107.0" を同じ扱いにする)。"""
    return re.sub(r"^v(?=\d)", "", value.strip())


def unordered(value: str) -> bool:
    """ダイジェストやコミット SHA のように、大小を比べられない値か。"""
    return value.startswith("sha256:") or bool(re.fullmatch(r"[0-9a-f]{40}", value))


def is_held(check: dict, latest: str) -> bool:
    """`hold:` で「この版は見送る」と書かれていて、まだそれ以下かどうか。

    バージョンのように順序が付けられるものは、保留した版**以下**なら保留のまま。
    それより新しいものが上流に出たら保留は自動で切れて、また報告される。
    ダイジェストやコミット SHA は大小が無いので、完全一致のときだけ保留する。
    """
    hold = check.get("hold")
    if hold in (None, ""):
        return False
    hold = str(hold)
    if normalize(hold) == normalize(latest):
        return True
    if unordered(latest) or unordered(hold):
        return False
    return version_key(normalize(latest)) <= version_key(normalize(hold))


def pick_latest(tags: list[str], tag_regex: str) -> str:
    matched = []
    pattern = re.compile(tag_regex)
    for tag in tags:
        found = pattern.match(tag)
        if found:
            matched.append(found.group(1) if found.groups() else tag)
    if not matched:
        raise CheckError(f"{tag_regex} に一致するタグが無い(全 {len(tags)} 件)")
    return max(matched, key=version_key)


# --------------------------------------------------------------------------
# 各 kind の取得
# --------------------------------------------------------------------------
def latest_github_release(check: dict) -> str:
    repo = check["repo"]
    tag_regex = check.get("tag_regex")
    if not tag_regex:
        data = http_json(f"{GITHUB_API}/repos/{repo}/releases/latest", github_headers())
        return data["tag_name"]
    data = http_json(
        f"{GITHUB_API}/repos/{repo}/releases?per_page=100", github_headers()
    )
    tags = [
        rel["tag_name"]
        for rel in data
        if not rel.get("draft") and not rel.get("prerelease")
    ]
    return pick_latest(tags, tag_regex)


def latest_github_head(check: dict) -> str:
    repo = check["repo"]
    data = http_json(f"{GITHUB_API}/repos/{repo}/commits?per_page=1", github_headers())
    if not data:
        raise CheckError(f"{repo} にコミットが無い")
    return data[0]["sha"]


def latest_docker_tag(check: dict) -> str:
    image = check["image"]
    if "/" not in image:
        image = f"library/{image}"
    tags: list[str] = []
    url = f"{DOCKERHUB_API}/repositories/{image}/tags?page_size=100"
    for _ in range(5):  # 500 件も見れば十分。無限ページングを避ける
        data = http_json(url)
        tags.extend(item["name"] for item in data.get("results", []))
        url = data.get("next")
        if not url:
            break
    return pick_latest(tags, check["tag_regex"])


def registry_endpoint(image: str) -> tuple[str, str, str, str]:
    """"ghcr.io/foo/bar:tag" を (registry, name, tag, 認証URL) に分解する。"""
    reference, _, tag = image.partition(":")
    tag = tag or "latest"
    parts = reference.split("/")
    if parts[0] in ("ghcr.io", "docker.io", "registry-1.docker.io") or "." in parts[0]:
        registry, name = parts[0], "/".join(parts[1:])
    else:
        registry, name = "docker.io", reference
    if registry in ("docker.io", "registry-1.docker.io"):
        if "/" not in name:
            name = f"library/{name}"
        return (
            "registry-1.docker.io",
            name,
            tag,
            "https://auth.docker.io/token?service=registry.docker.io"
            f"&scope=repository:{name}:pull",
        )
    return (
        registry,
        name,
        tag,
        f"https://{registry}/token?service={registry}"
        f"&scope=repository:{urllib.parse.quote(name)}:pull",
    )


def registry_token(auth_url: str) -> str:
    data = http_json(auth_url)
    return data.get("token") or data.get("access_token") or ""


def latest_digest(check: dict) -> str:
    registry, name, tag, auth_url = registry_endpoint(check["image"])
    token = registry_token(auth_url)
    url = f"https://{registry}/v2/{name}/manifests/{urllib.parse.quote(tag)}"
    headers = {"Accept": MANIFEST_ACCEPT, "Authorization": f"Bearer {token}"}
    with http(url, headers) as res:
        digest = res.headers.get("Docker-Content-Digest")
        body = res.read()
    if digest:
        return digest
    # ダイジェストヘッダを返さないレジストリ向けの保険
    import hashlib

    return "sha256:" + hashlib.sha256(body).hexdigest()


def latest_ghcr_tag(check: dict) -> str:
    image = check["image"]
    if "." not in image.split("/")[0]:
        image = f"ghcr.io/{image}"  # レジストリ省略時は ghcr.io
    registry, name, _, auth_url = registry_endpoint(image)
    token = registry_token(auth_url)
    headers = {"Authorization": f"Bearer {token}"}
    tags: list[str] = []
    url = f"https://{registry}/v2/{name}/tags/list?n=1000"
    for _ in range(10):
        with http(url, headers) as res:
            data = json.load(res)
            link = res.headers.get("Link", "")
        tags.extend(data.get("tags") or [])
        found = re.search(r"<([^>]+)>;\s*rel=\"next\"", link)
        if not found:
            break
        url = urllib.parse.urljoin(f"https://{registry}", found.group(1))
    return pick_latest(tags, check["tag_regex"])


def latest_npm(check: dict) -> str:
    package = urllib.parse.quote(check["package"], safe="@")
    data = http_json(f"{NPM_REGISTRY}/{package}/latest")
    return data["version"]


FETCHERS = {
    "github_release": latest_github_release,
    "github_head": latest_github_head,
    "docker_tag": latest_docker_tag,
    "ghcr_tag": latest_ghcr_tag,
    "digest": latest_digest,
    "npm": latest_npm,
}


# --------------------------------------------------------------------------
# リポジトリ側の読み取り
# --------------------------------------------------------------------------
def read_pin(root: str, pin: dict) -> str:
    path = os.path.join(root, pin["file"])
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except OSError as err:
        raise CheckError(f"pin ファイルを読めない: {pin['file']} ({err})") from err
    found = re.search(pin["regex"], text, re.MULTILINE)
    if not found:
        raise CheckError(f"{pin['file']} が {pin['regex']} に一致しない")
    return found.group(1)


def app_version(root: str, app: str) -> str:
    path = os.path.join(root, app, "config.json")
    try:
        with open(path, encoding="utf-8") as handle:
            return str(json.load(handle).get("version", ""))
    except (OSError, ValueError):
        return ""


def short(value: str, width: int = 24) -> str:
    value = value.strip()
    if value.startswith("sha256:"):
        return value[7:19]
    if re.fullmatch(r"[0-9a-f]{40}", value):
        return value[:12]
    return value if len(value) <= width else value[: width - 1] + "…"


# --------------------------------------------------------------------------
# 判定
# --------------------------------------------------------------------------
def apply_hold(check: dict, result: dict, latest: str) -> dict:
    """`hold:` の指定を結果に反映する。

    要対応 (update / rebuild) だったものだけを「保留」に落とす。状態ファイルは
    そのまま更新してあるので、hold を外せば本来の状態 (リビルド待ち等) に戻る。
    すでに追いついているのに hold が残っている場合は、消してよい印を付ける。
    """
    if not check.get("hold"):
        return result
    result["hold"] = str(check["hold"])
    result["hold_reason"] = check.get("hold_reason", "")
    if result["status"] in ("update", "rebuild") and is_held(check, latest):
        result["status"] = "hold"
    elif result["status"] == "ok":
        result["hold_stale"] = True
    return result


def evaluate(check: dict, root: str, state: dict, today: str) -> dict:
    app = check["app"]
    key = f"{app}/{check['id']}"
    label = check.get("label") or check["id"]
    result = {
        "app": app,
        "key": key,
        "label": label,
        "category": check.get("category", "upstream"),
        "note": check.get("note", ""),
        "info": bool(check.get("info")),
        "app_version": app_version(root, app),
    }

    latest = FETCHERS[check["kind"]](check)
    result["latest"] = latest

    if check.get("info"):
        result["current"] = "-"
        result["status"] = "info"
        return result

    if check.get("pin"):
        # ファイルに版が書いてあるもの。状態ファイルは使わない
        current = read_pin(root, check["pin"])
        result["current"] = current
        result["status"] = (
            "ok" if normalize(current) == normalize(latest) else "update"
        )
        return apply_hold(check, result, latest)

    # 動くタグ / 常に最新を入れるもの。前回チェック時からの変化を見る
    entry = state.get(key)
    if entry is None:
        state[key] = {
            "value": latest,
            "seen_at": today,
            "app_version": result["app_version"],
            "pending": False,
        }
        result["current"] = latest
        result["status"] = "first"
        return apply_hold(check, result, latest)

    if entry.get("value") != latest:
        entry.update(
            value=latest,
            seen_at=today,
            app_version=result["app_version"],
            pending=True,
        )
    elif entry.get("pending") and entry.get("app_version") != result["app_version"]:
        # config.json の version が上がった = リビルドして publish 済み
        entry.update(pending=False, app_version=result["app_version"])

    result["current"] = entry.get("value")
    result["seen_at"] = entry.get("seen_at", "")
    result["status"] = "rebuild" if entry.get("pending") else "ok"
    return apply_hold(check, result, latest)


# --------------------------------------------------------------------------
# レポート
# --------------------------------------------------------------------------
STATUS_LABEL = {
    "update": "🔺 上流に新しい版",
    "rebuild": "🔁 リビルド待ち",
    "hold": "⏸ 保留中",
    "first": "🆕 今回から記録",
    "ok": "✅ 最新",
    "info": "ℹ️ 参考",
    "error": "⚠️ 失敗",
}

HOLD_HOWTO = (
    "見送ると決めたものは `.github/upstream-checks.yaml` の該当エントリに "
    "`hold: \"<見送る版>\"` (と任意で `hold_reason:`) を足してください。"
    "その版以下の間は⏸へ落ちて通知されず、上流がそれより新しくなると自動で戻ります。"
    "ダイジェスト(`sha256:...`)やコミット SHA は完全一致のときだけ保留になります。"
)


def table(rows: list[dict], with_seen: bool = False) -> list[str]:
    lines = [
        "| アドオン | 対象 | いま | 上流の最新 | 状態 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        current = short(str(row.get("current", "-")))
        latest = short(str(row.get("latest", "-")))
        status = STATUS_LABEL[row["status"]]
        if with_seen and row.get("seen_at"):
            status += f" ({row['seen_at']} に検知)"
        if row["status"] == "hold":
            status += f" (`{short(row.get('hold', ''))}` まで)"
        if row.get("hold_stale"):
            status += " — `hold` は消してよい"
        note = f"<br>{row['note']}" if row.get("note") else ""
        if row["status"] == "hold" and row.get("hold_reason"):
            note += f"<br>理由: {row['hold_reason']}"
        lines.append(
            f"| `{row['app']}` (v{row['app_version']}) | {row['label']}{note} "
            f"| `{current}` | `{latest}` | {status} |"
        )
    return lines


def build_report(results: list[dict], errors: list[dict], today: str) -> tuple[str, int]:
    updates = [r for r in results if r["status"] == "update"]
    rebuilds = [r for r in results if r["status"] == "rebuild"]
    holds = [r for r in results if r["status"] == "hold"]
    rest = [r for r in results if r["status"] in ("ok", "first", "info")]
    actionable = len(updates) + len(rebuilds)

    out = [f"最終チェック: **{today}** (UTC)", ""]
    if actionable:
        out += [f"対応が要るもの: **{actionable} 件**", ""]
    else:
        out += ["対応が要るものはありません。", ""]

    if updates:
        out += [
            "## 🔺 上流に新しい版がある",
            "",
            "ピンしている版より新しいものが出ている。取り込むなら",
            "ピンを書き換えて `config.json` の `version` を上げ、`CHANGELOG.md` を更新する。",
            "",
        ] + table(updates) + [""]

    if rebuilds:
        out += [
            "## 🔁 上流は動いたがリビルドしていない",
            "",
            "`:latest` / `:stable` のように動くタグや、ビルド時に最新を入れるもの。",
            "ファイルは変わらないので、`config.json` の `version` を上げて",
            "リビルドしないと HA 側は古いイメージのまま。",
            "",
        ] + table(rebuilds, with_seen=True) + [""]

    if holds:
        out += [
            "## ⏸ 保留中 (見送ると決めたもの)",
            "",
            "`hold:` が書いてあるので通知しない。上流が保留した版より新しくなれば",
            "自動でここから外れて 🔺 に戻る。",
            "",
        ] + table(holds) + [""]

    if rest:
        out += ["## その他 (対応不要)", "", "<details><summary>一覧を開く</summary>", ""]
        out += table(rest)
        out += ["", "</details>", ""]

    if errors:
        out += [
            "## ⚠️ 調べられなかったもの",
            "",
            "| アドオン | 対象 | 内容 |",
            "| --- | --- | --- |",
        ]
        for err in errors:
            message = err["message"].replace("\n", " ").replace("|", "\\|")
            out.append(f"| `{err['app']}` | {err['label']} | {short(message, 200)} |")
        out.append("")

    out += [
        "---",
        "",
        f"**今回は見送るとき**: {HOLD_HOWTO}",
        "",
        "この Issue は `.github/workflows/upstream-check.yaml` が毎月書き換えています。"
        "定義は `.github/upstream-checks.yaml`。",
    ]
    return "\n".join(out), actionable


# --------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=".github/upstream-checks.yaml")
    parser.add_argument("--state", default=".github/upstream-state.json")
    parser.add_argument("--report", default="upstream-report.md")
    parser.add_argument("--root", default=".")
    parser.add_argument(
        "--no-state-write",
        action="store_true",
        help="状態ファイルを書き換えない(お試し実行用)",
    )
    args = parser.parse_args()

    with open(args.manifest, encoding="utf-8") as handle:
        manifest = yaml.safe_load(handle)
    checks = manifest.get("checks") or []

    state = {}
    if os.path.exists(args.state):
        with open(args.state, encoding="utf-8") as handle:
            state = json.load(handle)

    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    results: list[dict] = []
    errors: list[dict] = []

    for check in checks:
        label = check.get("label") or check["id"]
        if check["kind"] not in FETCHERS:
            errors.append(
                {
                    "app": check["app"],
                    "label": label,
                    "message": f"未知の kind: {check['kind']}",
                }
            )
            continue
        try:
            results.append(evaluate(check, args.root, state, today))
        except CheckError as err:
            errors.append({"app": check["app"], "label": label, "message": str(err)})
        except Exception as err:  # 想定外でも他のチェックは続ける
            errors.append(
                {
                    "app": check["app"],
                    "label": label,
                    "message": f"{type(err).__name__}: {err}",
                }
            )

    report, actionable = build_report(results, errors, today)
    with open(args.report, "w", encoding="utf-8") as handle:
        handle.write(report + "\n")

    if not args.no_state_write:
        with open(args.state, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")

    summary = os.environ.get("GITHUB_OUTPUT")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"actionable={actionable}\n")
            handle.write(f"errors={len(errors)}\n")

    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
