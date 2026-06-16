"""FastAPI app: tachibk viewer."""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from . import suwayomi
from .decoder import (
    build_manga_table,
    build_source_table,
    build_summary,
    normalize_for_match,
    parse_tachibk,
)

# --- config ---
_HERE = Path(__file__).parent
_PROJECT_ROOT = _HERE.parent

# Default paths for the integrated Suwayomi Server add-on. The summary viewer
# shares the same addon_config dir (/config) as the Suwayomi server itself.
# Overridable via env vars for non-HA / standalone use.
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/config/backups")).resolve()
ALIASES_FILE = Path(os.environ.get("ALIASES_FILE", "/config/aliases.json")).resolve()

# HA Supervisor writes the add-on options here. Used for the Suwayomi Server
# connection settings; env vars (standalone use) take precedence.
OPTIONS_FILE = Path(os.environ.get("OPTIONS_FILE", "/data/options.json"))

# Initial content for aliases.json when it doesn't exist yet.
# Loaded from app/default_aliases.json (126 entries derived from a sample backup).
_DEFAULT_ALIASES_FILE = _HERE / "default_aliases.json"


def _load_default_aliases() -> dict[str, str]:
    try:
        with open(_DEFAULT_ALIASES_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}


# create dir / file on first run
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
if not ALIASES_FILE.exists():
    ALIASES_FILE.parent.mkdir(parents=True, exist_ok=True)
    ALIASES_FILE.write_text(
        json.dumps(_load_default_aliases(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

_TEMPLATES_DIR = _HERE / "templates"

app = FastAPI(title="tachibk viewer", docs_url=None, redoc_url=None)
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


# Set of normalized titles from the most recently rendered backup. Used by the
# aliases editor to flag entries that aren't referenced by any current title.
# Empty set = no backup has been opened yet (this server lifetime).
_last_seen_normalized_titles: set[str] = set()


# --- helpers ---

def get_suwayomi_config() -> dict[str, str]:
    """Suwayomi Server connection settings (BASIC auth).

    Env vars SUWAYOMI_URL / SUWAYOMI_USERNAME / SUWAYOMI_PASSWORD take
    precedence; otherwise the HA add-on options (/data/options.json) are used.
    """
    opts: dict = {}
    try:
        with open(OPTIONS_FILE, encoding="utf-8") as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            opts = loaded
    except (OSError, json.JSONDecodeError):
        pass

    def pick(env_key: str, opt_key: str) -> str:
        value = os.environ.get(env_key) or opts.get(opt_key) or ""
        return value.strip() if isinstance(value, str) else ""

    return {
        "url": pick("SUWAYOMI_URL", "suwayomi_url").rstrip("/"),
        "username": pick("SUWAYOMI_USERNAME", "suwayomi_username"),
        "password": pick("SUWAYOMI_PASSWORD", "suwayomi_password"),
    }


def suwayomi_missing_auth(cfg: dict[str, str]) -> list[str]:
    """Names (for display) of unset Suwayomi auth settings.

    Warning only — deletion still runs, just without an Authorization header.
    """
    missing = []
    if not cfg["username"]:
        missing.append("ID")
    if not cfg["password"]:
        missing.append("パスワード")
    return missing


def load_aliases() -> dict[str, str]:
    """Read the aliases JSON file. Returns {} on any problem."""
    try:
        with open(ALIASES_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}


def list_backup_files() -> list[dict]:
    """Enumerate .tachibk / .proto.gz files in BACKUP_DIR (newest first)."""
    files = []
    if not BACKUP_DIR.exists():
        return files
    for p in BACKUP_DIR.iterdir():
        if not p.is_file():
            continue
        if p.suffix == ".tachibk" or p.name.endswith(".proto.gz"):
            stat = p.stat()
            files.append({
                "name": p.name,
                "size_kb": round(stat.st_size / 1024, 1),
                "mtime": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                "_mtime_ts": stat.st_mtime,
            })
    files.sort(key=lambda x: x["_mtime_ts"], reverse=True)
    return files


def _safe_path_in_backup_dir(name: str) -> Path:
    """Resolve `name` against BACKUP_DIR, rejecting path-traversal."""
    safe = os.path.basename(name)  # strip any directory components
    p = (BACKUP_DIR / safe).resolve()
    try:
        p.relative_to(BACKUP_DIR)
    except ValueError:
        raise HTTPException(400, "invalid path")
    return p


def _render_view(request: Request, blob: bytes, filename: str) -> HTMLResponse:
    if not blob:
        raise HTTPException(400, "空のファイルです")
    try:
        backup = parse_tachibk(blob)
    except Exception as e:
        raise HTTPException(400, f"バックアップの解析に失敗しました: {e}")
    aliases = load_aliases()
    manga_rows = build_manga_table(backup, aliases)
    source_rows = build_source_table(backup)
    summary = build_summary(backup, filename=filename)

    # Remember which (normalized) titles appear in this backup so that the
    # aliases editor can flag entries that don't apply to the current data.
    global _last_seen_normalized_titles
    _last_seen_normalized_titles = {
        normalize_for_match(m.get("title", "") or "")
        for m in backup.get("backupManga", [])
    }
    _last_seen_normalized_titles.discard("")

    return templates.TemplateResponse(
        request,
        "view.html",
        {
            "summary": summary,
            "manga_json": json.dumps(manga_rows, ensure_ascii=False),
            "source_json": json.dumps(source_rows, ensure_ascii=False),
            "aliases_count": len(aliases),
            "aliases_file": str(ALIASES_FILE),
        },
    )


# --- routes ---

@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    suwayomi_cfg = get_suwayomi_config()
    return templates.TemplateResponse(
        request,
        "upload.html",
        {
            "files": list_backup_files(),
            "backup_dir": str(BACKUP_DIR),
            "aliases_file": str(ALIASES_FILE),
            "aliases_count": len(load_aliases()),
            "suwayomi_url": suwayomi_cfg["url"],
            "suwayomi_missing_auth": suwayomi_missing_auth(suwayomi_cfg),
        },
    )


@app.post("/downloads/delete-all")
def delete_all_downloads() -> JSONResponse:
    """Delete every downloaded chapter on the Suwayomi Server."""
    cfg = get_suwayomi_config()
    if not cfg["url"]:
        return JSONResponse(
            {
                "ok": False,
                "error": "Suwayomi Server の URL が未設定です。"
                "アドオンの「設定」タブで設定してください。",
            },
            status_code=400,
        )
    try:
        ids = suwayomi.fetch_downloaded_chapter_ids(
            cfg["url"], cfg["username"], cfg["password"]
        )
        deleted = suwayomi.delete_downloaded_chapters(
            cfg["url"], cfg["username"], cfg["password"], ids
        )
    except suwayomi.SuwayomiError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)
    return JSONResponse({"ok": True, "found": len(ids), "deleted": deleted})


@app.post("/upload", response_class=HTMLResponse)
async def upload(request: Request, file: UploadFile = File(...)) -> HTMLResponse:
    blob = await file.read()
    return _render_view(request, blob, file.filename or "uploaded")


@app.post("/load", response_class=HTMLResponse)
def load(request: Request, name: str = Form(...)) -> HTMLResponse:
    p = _safe_path_in_backup_dir(name)
    if not p.is_file():
        raise HTTPException(404, f"ファイルが見つかりません: {name}")
    return _render_view(request, p.read_bytes(), p.name)


@app.get("/healthz", response_class=HTMLResponse)
def healthz() -> HTMLResponse:
    return HTMLResponse("ok")


@app.get("/aliases", response_class=HTMLResponse)
def aliases_get(request: Request) -> HTMLResponse:
    aliases_dict = load_aliases()
    entries = _entries_with_usage(aliases_dict)
    return templates.TemplateResponse(
        request,
        "aliases.html",
        {
            "entries": entries,
            "has_backup_context": bool(_last_seen_normalized_titles),
            "unused_count": sum(1 for e in entries if not e["used"]),
            "aliases_file": str(ALIASES_FILE),
            "saved": False,
            "saved_count": 0,
        },
    )


def _entries_with_usage(aliases_dict: dict[str, str]) -> list[dict]:
    """Annotate aliases entries with a 'used' flag.

    Used = the entry's normalized key matches at least one normalized raw_title
    from the most recently opened backup. If no backup has been opened yet,
    every entry is treated as 'used' (we have no information to flag them).
    """
    have_context = bool(_last_seen_normalized_titles)
    out: list[dict] = []
    for k, v in aliases_dict.items():
        if have_context:
            used = normalize_for_match(k) in _last_seen_normalized_titles
        else:
            used = True
        out.append({"key": k, "value": v, "used": used})
    return out


@app.post("/aliases", response_class=HTMLResponse)
async def aliases_save(request: Request) -> HTMLResponse:
    form = await request.form()
    keys = form.getlist("key")
    values = form.getlist("value")
    new_aliases: dict[str, str] = {}
    for k, v in zip(keys, values):
        if not isinstance(k, str) or not isinstance(v, str):
            continue
        k = k.strip()
        if not k:
            continue
        # later duplicates overwrite earlier ones, matching dict semantics
        new_aliases[k] = v.strip()
    ALIASES_FILE.parent.mkdir(parents=True, exist_ok=True)
    ALIASES_FILE.write_text(
        json.dumps(new_aliases, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return templates.TemplateResponse(
        request,
        "aliases.html",
        {
            "entries": _entries_with_usage(new_aliases),
            "has_backup_context": bool(_last_seen_normalized_titles),
            "unused_count": sum(
                1 for k in new_aliases
                if _last_seen_normalized_titles
                and normalize_for_match(k) not in _last_seen_normalized_titles
            ),
            "aliases_file": str(ALIASES_FILE),
            "saved": True,
            "saved_count": len(new_aliases),
        },
    )
