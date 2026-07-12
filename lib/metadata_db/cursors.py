# Keyset (cursor) pagination helpers for the library grid
# (feedBack#636 item 3): opaque cursor encoding, seek-predicate
# construction, and the sort whitelist that can keyset cleanly.

import json

# ── Keyset (cursor) pagination for the library grid (feedBack#636 item 3) ─────
# Forward-only, O(page) deep paging that doesn't grow with OFFSET. Only simple
# single-column sorts can keyset cleanly (the compound tuning/year sorts fall
# back to OFFSET). Every sort gets a unique `filename` tiebreak so the order is
# TOTAL — which also fixes a latent OFFSET skip/dupe across equal-key rows.
# (column, collate-clause, primary-direction) — tiebreak is always `filename` ASC.
_KEYSET_SORTS = {
    # artist/artist-desc left OUT deliberately: their ORDER BY carries a
    # title secondary (so cards within an artist read alphabetically, like
    # the tree view) which a two-term (value, filename) cursor can't seek
    # correctly — they page by OFFSET, which is measured-trivial at real
    # library sizes. Restore them with a composite sort-key column if
    # 50k-song libraries ever make OFFSET hurt.
    "title": ("title", "COLLATE NOCASE", "ASC"),
    "title-desc": ("title", "COLLATE NOCASE", "DESC"),
    "recent": ("mtime", "", "DESC"),
}
# Index into a query_page row tuple for each keyset column (see the SELECT in
# query_page: filename, title, artist, ... mtime at 9).
_KEYSET_ROW_IDX = {"artist": 2, "title": 1, "mtime": 9}


def _encode_cursor(values: list) -> str:
    import base64
    return base64.urlsafe_b64encode(json.dumps(values).encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str):
    """Decode an opaque keyset cursor to [sort_value, filename], or None if it's
    malformed (a bad cursor degrades to the first page, never 500s)."""
    import base64
    try:
        out = json.loads(base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8"))
    except (ValueError, TypeError):
        return None
    return out if isinstance(out, list) and len(out) == 2 else None


def _effective_keyset_sort(sort: str, direction: str) -> str:
    """Fold the legacy `dir=desc` toggle into the canonical keyset sort key, so
    the seek/cursor direction matches the ORDER BY that same toggle produces
    (without this, `sort=artist&dir=desc` would seek with `>` against a DESC
    order → gaps/dupes)."""
    if direction == "desc" and sort in ("artist", "title"):
        return sort + "-desc"
    return sort


def _keyset_seek(col: str, collate: str, primary_dir: str, cv, fn: str):
    """(sql, params) for 'rows strictly after (cv, fn)' in the total order
    `<col> <primary_dir>, filename ASC`, matching SQLite's NULL placement
    (NULLs sort first in ASC, last in DESC) so keyset is exactly OFFSET-
    equivalent even for NULL sort keys."""
    ce = f"{col} {collate}".strip()
    if primary_dir == "ASC":   # NULLs first
        if cv is None:
            return (f"(({col} IS NULL AND filename > ?) OR {col} IS NOT NULL)", [fn])
        return (f"({col} IS NOT NULL AND ({ce} > ? OR ({ce} = ? AND filename > ?)))",
                [cv, cv, fn])
    # DESC — NULLs last
    if cv is None:
        return (f"({col} IS NULL AND filename > ?)", [fn])
    return (f"({col} IS NULL OR ({col} IS NOT NULL AND "
            f"({ce} < ? OR ({ce} = ? AND filename > ?))))", [cv, cv, fn])


def next_library_cursor(sort: str, last_song: dict | None) -> str | None:
    """The cursor for the last row of a page, so the next request resumes after
    it. None when the sort can't keyset or the page was empty."""
    if sort not in _KEYSET_SORTS or not last_song:
        return None
    col = _KEYSET_SORTS[sort][0]
    key = "mtime" if col == "mtime" else col
    if key not in last_song or "filename" not in last_song:
        return None
    # A title display-override (Fix-metadata popup) replaces last_song["title"]
    # for the card, but the keyset seek runs on the RAW title column — resume
    # from the raw value query_page stashed (present only when the last row's
    # title was overridden), so paging never skips/dupes.
    val = (last_song["_sort_title"] if (key == "title" and "_sort_title" in last_song)
           else last_song[key])
    return _encode_cursor([val, last_song["filename"]])
