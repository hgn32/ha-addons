"""
Pure-Python decoder for Mihon/Tachiyomi/Suwayomi .tachibk backup files.

A .tachibk file is a gzip-compressed protobuf message. This module decodes
the wire format directly using a hand-written schema; no protoc required.

Schema source: Mihon proto definition (mihonapp/mihon issue #1074),
verified against a real Suwayomi-generated backup.
"""
from __future__ import annotations

import gzip
import struct
import unicodedata
from datetime import datetime, timezone

# --- protobuf wire types ---
WT_VARINT = 0
WT_FIXED64 = 1
WT_LENGTH = 2
WT_FIXED32 = 5


def _read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7
        if shift > 63:
            raise ValueError("varint too long")


def _decode_field(buf: bytes, pos: int):
    tag, pos = _read_varint(buf, pos)
    fnum, wt = tag >> 3, tag & 0x07
    if wt == WT_VARINT:
        v, pos = _read_varint(buf, pos)
    elif wt == WT_FIXED64:
        v = struct.unpack_from("<Q", buf, pos)[0]
        pos += 8
    elif wt == WT_LENGTH:
        ln, pos = _read_varint(buf, pos)
        v = bytes(buf[pos:pos + ln])
        pos += ln
    elif wt == WT_FIXED32:
        v = struct.unpack_from("<I", buf, pos)[0]
        pos += 4
    else:
        raise ValueError(f"unknown wire type {wt} at {pos}")
    return fnum, wt, v, pos


# --- schema ---
# (field_number -> (name, type, repeated))
SCHEMA: dict[str, dict[int, tuple[str, str, bool]]] = {
    "Backup": {
        1: ("backupManga", "message:BackupManga", True),
        2: ("backupCategories", "message:BackupCategory", True),
        100: ("backupBrokenSources", "message:BrokenBackupSource", True),
        101: ("backupSources", "message:BackupSource", True),
        104: ("backupPreferences", "message:BackupPreference", True),
        105: ("backupSourcePreferences", "message:BackupSourcePreferences", True),
    },
    "BackupManga": {
        1: ("source", "int64", False),
        2: ("url", "string", False),
        3: ("title", "string", False),
        4: ("artist", "string", False),
        5: ("author", "string", False),
        6: ("description", "string", False),
        7: ("genre", "string", True),
        8: ("status", "int32", False),
        9: ("thumbnailUrl", "string", False),
        13: ("dateAdded", "int64", False),
        14: ("viewer", "int32", False),
        16: ("chapters", "message:BackupChapter", True),
        17: ("categories", "int64", True),
        18: ("tracking", "message:BackupTracking", True),
        100: ("favorite", "bool", False),
        101: ("chapterFlags", "int32", False),
        102: ("brokenHistory", "message:BrokenBackupHistory", True),
        103: ("viewer_flags", "int32", False),
        104: ("history", "message:BackupHistory", True),
        105: ("updateStrategy", "enum:UpdateStrategy", False),
        106: ("lastModifiedAt", "int64", False),
        107: ("favoriteModifiedAt", "int64", False),
        108: ("excludedScanlators", "string", True),
    },
    "BackupCategory": {
        1: ("name", "string", False),
        2: ("order", "int64", False),
        100: ("flags", "int64", False),
    },
    "BrokenBackupSource": {
        0: ("name", "string", False),
        1: ("sourceId", "int64", False),
    },
    "BackupSource": {
        1: ("name", "string", False),
        2: ("sourceId", "int64", False),
    },
    "BackupPreference": {
        1: ("key", "string", False),
        2: ("value", "message:PreferenceValue", False),
    },
    "BackupSourcePreferences": {
        1: ("sourceKey", "string", False),
        2: ("prefs", "message:BackupPreference", True),
    },
    "BackupChapter": {
        1: ("url", "string", False),
        2: ("name", "string", False),
        3: ("scanlator", "string", False),
        4: ("read", "bool", False),
        5: ("bookmark", "bool", False),
        6: ("lastPageRead", "int64", False),
        7: ("dateFetch", "int64", False),
        8: ("dateUpload", "int64", False),
        9: ("chapterNumber", "float", False),
        10: ("sourceOrder", "int64", False),
        11: ("lastModifiedAt", "int64", False),
    },
    "BackupTracking": {
        1: ("syncId", "int32", False),
        2: ("libraryId", "int64", False),
        3: ("mediaIdInt", "int32", False),
        4: ("trackingUrl", "string", False),
        5: ("title", "string", False),
        6: ("lastChapterRead", "float", False),
        7: ("totalChapters", "int32", False),
        8: ("score", "float", False),
        9: ("status", "int32", False),
        10: ("startedReadingDate", "int64", False),
        11: ("finishedReadingDate", "int64", False),
        100: ("mediaId", "int64", False),
    },
    "BrokenBackupHistory": {
        0: ("url", "string", False),
        1: ("lastRead", "int64", False),
        2: ("readDuration", "int64", False),
    },
    "BackupHistory": {
        1: ("url", "string", False),
        2: ("lastRead", "int64", False),
        3: ("readDuration", "int64", False),
    },
    "PreferenceValue": {
        1: ("type", "string", False),
        2: ("value", "bytes", False),
    },
}

ENUMS = {
    "UpdateStrategy": {0: "ALWAYS_UPDATE", 1: "ONLY_FETCH_ONCE"},
}

# Mihon/Tachiyomi tracker syncId for AniList
ANILIST_SYNC_ID = 2

# Noisy suffixes that the source attaches to manga titles. They get stripped
# from the raw title before looking up in aliases, so users only need a single
# alias entry per work regardless of the source's suffix.
_SUFFIXES_TO_STRIP: tuple[str, ...] = (
    " (Raw – Free)",
    "(Raw – Free)",
    " - RAW",
)


def _strip_known_suffix(title: str) -> str:
    """Remove a known noisy suffix from a title (case preserved for display)."""
    for suf in _SUFFIXES_TO_STRIP:
        if title.endswith(suf):
            return title[: -len(suf)].rstrip()
    return title


def normalize_for_match(s: str) -> str:
    """Normalize a title for case/width/whitespace-insensitive alias matching.

    Pipeline:
      1. Unicode NFKC (full-width -> half-width and compatibility forms)
      2. lowercase
      3. repeatedly strip the known noisy suffixes, with trailing-whitespace
         trim between iterations so chained suffixes (e.g. " - RAW (Raw – Free)")
         are all peeled off
      4. remove ALL remaining whitespace inside the string
         - so "Natte Shimau" and "NATTESHIMAU" become the same key

    The aliases.json file itself is NEVER rewritten with this normalization;
    it is only applied at lookup time on both sides.
    """
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s).lower()
    norm_suffixes = [unicodedata.normalize("NFKC", suf).lower()
                     for suf in _SUFFIXES_TO_STRIP]
    # Strip suffix, trim trailing whitespace, retry. Stop when no suffix matches.
    while True:
        s_stripped = s.rstrip()
        for nsuf in norm_suffixes:
            if s_stripped.endswith(nsuf):
                s = s_stripped[: -len(nsuf)]
                break
        else:
            break
    # remove ALL whitespace
    s = "".join(s.split())
    return s


# Additional suffixes stripped ONLY when computing the duplicate-detection key.
# These mark format variants of the same work (e.g. comic adaptation marker).
# Not used for alias lookup, not used for display.
_DUP_EXTRA_SUFFIXES: tuple[str, ...] = (
    "@comic",       # also covers "＠comic" / "＠ＣＯＭＩＣ" via NFKC
    "THE COMIC",
)


def _key_for_dup(alias_title: str) -> str:
    """Build a duplicate-detection key from an alias_title.

    Starts from normalize_for_match(), then repeatedly strips the extra
    duplicate-detection suffixes ('@comic', 'THE COMIC' and their full-width
    variants) so that, e.g., 'X', 'X@comic', and 'X THE COMIC' all share one key.
    """
    s = normalize_for_match(alias_title)
    if not s:
        return ""
    # Pre-normalize the suffix list once (NFKC + lower + space-strip)
    norm_suffixes = ["".join(unicodedata.normalize("NFKC", suf).lower().split())
                     for suf in _DUP_EXTRA_SUFFIXES]
    norm_suffixes = [n for n in norm_suffixes if n]
    # Loop because titles may legitimately end with multiple markers stacked.
    while True:
        for nsuf in norm_suffixes:
            if s.endswith(nsuf):
                s = s[: -len(nsuf)]
                break
        else:
            break
    return s


def _decode_message(buf: bytes, msg_name: str) -> dict:
    schema = SCHEMA.get(msg_name)
    if schema is None:
        return {}
    pos = 0
    out: dict = {}
    while pos < len(buf):
        try:
            fnum, wt, val, pos = _decode_field(buf, pos)
        except (IndexError, ValueError):
            break
        info = schema.get(fnum)
        if info is None:
            # unknown field – ignore (e.g. Suwayomi-specific 9000/9001)
            continue
        name, ftype, repeated = info
        decoded = _decode_value(val, wt, ftype)
        if repeated:
            out.setdefault(name, []).append(decoded)
        else:
            out[name] = decoded
    return out


def _decode_value(val, wire_type, ftype):
    if ftype.startswith("message:"):
        return _decode_message(val, ftype.split(":", 1)[1])
    if ftype.startswith("enum:"):
        return ENUMS.get(ftype.split(":", 1)[1], {}).get(val, val)
    if ftype == "string":
        if isinstance(val, (bytes, bytearray)):
            return val.decode("utf-8", "replace")
        return str(val)
    if ftype == "bytes":
        return bytes(val) if isinstance(val, (bytes, bytearray)) else val
    if ftype == "bool":
        return bool(val)
    if ftype == "int32":
        if val >= (1 << 31):
            val -= (1 << 32)
        return val
    if ftype == "int64":
        if val >= (1 << 63):
            val -= (1 << 64)
        return val
    if ftype in ("uint32", "uint64"):
        return val
    if ftype == "float" and wire_type == WT_FIXED32:
        return struct.unpack("<f", struct.pack("<I", val))[0]
    if ftype == "double" and wire_type == WT_FIXED64:
        return struct.unpack("<d", struct.pack("<Q", val))[0]
    return val


# --- public api ---

def parse_tachibk(blob: bytes) -> dict:
    """Decompress (if gzip) and decode a .tachibk / .proto.gz blob."""
    if blob[:2] == b"\x1f\x8b":
        blob = gzip.decompress(blob)
    return _decode_message(blob, "Backup")


def _ms_to_datetime_str(ms: int | None) -> str:
    """Format ms-since-epoch as 'YYYY-MM-DD HH:MM' (UTC). Empty if 0/invalid."""
    if not ms:
        return ""
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
    except (OSError, OverflowError, ValueError):
        return ""


def _build_source_lookup(backup: dict) -> tuple[dict[int, str], set[int]]:
    """Return (sourceId -> name, set of brokenSourceIds)."""
    names: dict[int, str] = {}
    broken_ids: set[int] = set()
    for s in backup.get("backupSources", []):
        sid = s.get("sourceId")
        if sid is not None:
            names[sid] = s.get("name") or f"unknown ({sid})"
    for s in backup.get("backupBrokenSources", []):
        sid = s.get("sourceId")
        if sid is not None:
            names.setdefault(sid, (s.get("name") or "broken") + f" ({sid})")
            broken_ids.add(sid)
    return names, broken_ids


def build_manga_table(backup: dict, aliases: dict[str, str] | None = None) -> list[dict]:
    """Rows for the manga table.

    Columns:
      raw_title       title as stored in backup
      alias_title     display name from aliases dict (empty if none)
      source          resolved source name
      chapters_total  number of chapters in backup
      has_anilist     true if any tracking entry has syncId == AniList(2)
      anilist_url     AniList tracking URL (empty if none); used for duplicate detection
      latest_fetched  max chapter.dateFetch as 'YYYY-MM-DD HH:MM' (UTC)
      url             manga relative url (used as tooltip)
      is_duplicate    true if this row likely points at the same work as another row,
                      detected by matching AniList URL or matching certain alias_title
                      (an alias whose value does NOT start with '?')
    """
    aliases = aliases or {}
    # Build lookup table: normalized key -> alias value.
    # Later entries overwrite earlier ones if their normalized form collides.
    normalized_aliases: dict[str, str] = {}
    for k, v in aliases.items():
        nk = normalize_for_match(k)
        if nk:
            normalized_aliases[nk] = v
    source_names, _ = _build_source_lookup(backup)

    rows: list[dict] = []
    for m in backup.get("backupManga", []):
        chapters = m.get("chapters", []) or []
        tracking = m.get("tracking", []) or []
        latest_fetched_ms = max((c.get("dateFetch", 0) for c in chapters), default=0)
        sid = m.get("source")
        raw_title = m.get("title", "") or ""
        match_key = normalize_for_match(raw_title)
        # Fallback when no alias hits: show the raw title with known noisy
        # suffixes stripped (case preserved).
        display_fallback = _strip_known_suffix(raw_title.strip())
        alias_title = normalized_aliases.get(match_key) or display_fallback
        anilist_url = ""
        for t in tracking:
            if t.get("syncId") == ANILIST_SYNC_ID and t.get("trackingUrl"):
                anilist_url = t["trackingUrl"]
                break
        rows.append({
            "raw_title": raw_title,
            "alias_title": alias_title,
            "source": source_names.get(sid, f"unknown ({sid})") if sid is not None else "",
            "chapters_total": len(chapters),
            "has_anilist": bool(anilist_url),
            "anilist_url": anilist_url,
            "latest_fetched": _ms_to_datetime_str(latest_fetched_ms),
            "url": m.get("url", "") or "",
            "is_duplicate": False,  # filled in below
        })

    # --- duplicate detection ---
    # Build keys per row, then mark rows that share any key with another row.
    # Keys considered:
    #   ("anilist", url)   - AniList trackingUrl is unique per work
    #   ("alias",   key)   - same alias_title under _key_for_dup
    #                        (skip values that start with '?' = uncertain)
    keys_per_row: list[list[tuple[str, str]]] = []
    for r in rows:
        keys: list[tuple[str, str]] = []
        if r["anilist_url"]:
            keys.append(("anilist", r["anilist_url"]))
        at = r["alias_title"]
        if at and not at.startswith("?"):
            dk = _key_for_dup(at)
            if dk:
                keys.append(("alias", dk))
        keys_per_row.append(keys)

    counts: dict[tuple[str, str], int] = {}
    for keys in keys_per_row:
        for k in keys:
            counts[k] = counts.get(k, 0) + 1
    for r, keys in zip(rows, keys_per_row):
        if any(counts[k] >= 2 for k in keys):
            r["is_duplicate"] = True

    return rows


def build_source_table(backup: dict) -> list[dict]:
    """Rows for the source table.

    Columns:
      name            source name
      source_id       sourceId as string (int64 doesn't fit in JS number)
      manga_count     number of manga using this source
      latest_fetched  max dateFetch over all chapters of all manga in this source
      broken          true if listed in backupBrokenSources
    """
    source_names, broken_ids = _build_source_lookup(backup)

    # initialize all known sources (including broken & currently-unused) with 0
    per_src: dict[int, dict] = {
        sid: {
            "name": name,
            "manga_count": 0,
            "latest_fetched_ms": 0,
            "broken": sid in broken_ids,
        }
        for sid, name in source_names.items()
    }

    for m in backup.get("backupManga", []):
        sid = m.get("source")
        if sid is None:
            continue
        if sid not in per_src:
            per_src[sid] = {
                "name": f"unknown ({sid})",
                "manga_count": 0,
                "latest_fetched_ms": 0,
                "broken": False,
            }
        per_src[sid]["manga_count"] += 1
        chapters = m.get("chapters", []) or []
        lf = max((c.get("dateFetch", 0) for c in chapters), default=0)
        if lf > per_src[sid]["latest_fetched_ms"]:
            per_src[sid]["latest_fetched_ms"] = lf

    rows = []
    for sid, data in per_src.items():
        rows.append({
            "source_id": str(sid),
            "name": data["name"],
            "manga_count": data["manga_count"],
            "latest_fetched": _ms_to_datetime_str(data["latest_fetched_ms"]),
            "broken": data["broken"],
        })
    return rows


def build_summary(backup: dict, filename: str = "") -> dict:
    return {
        "filename": filename,
        "manga_count": len(backup.get("backupManga", [])),
        "sources_count": len(backup.get("backupSources", [])),
        "broken_sources_count": len(backup.get("backupBrokenSources", [])),
        "categories": [c.get("name", "") for c in backup.get("backupCategories", [])],
    }
