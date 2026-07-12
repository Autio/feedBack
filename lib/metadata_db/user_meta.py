# Personal per-song user metadata: favorites, user difficulty/notes,
# practice tags, per-field metadata overrides + locks, and the
# batch user-meta editor.

from .helpers import _artist_title_from_filename, _normalize_tag

class UserMetaMixin:
    def is_favorite(self, filename: str) -> bool:
        return self.conn.execute("SELECT 1 FROM favorites WHERE filename = ?", (filename,)).fetchone() is not None

    def toggle_favorite(self, filename: str) -> bool:
        """Toggle favorite status. Returns new state."""
        with self._lock:
            if self.is_favorite(filename):
                self.conn.execute("DELETE FROM favorites WHERE filename = ?", (filename,))
                self.conn.commit()
                return False
            else:
                self.conn.execute("INSERT OR IGNORE INTO favorites VALUES (?)", (filename,))
                self.conn.commit()
                return True

    # ── Personal per-song metadata: user-difficulty / notes / tags ───────────
    # All keyed by the on-disk `songs` filename and kept OUT of the shared
    # feedpak file. Likes are the `favorites` heart, deliberately NOT duplicated
    # here. Reads are lock-free (WAL); writes take self._lock like the rest.
    def get_song_user_meta(self, filename: str) -> dict:
        """{'user_difficulty', 'notes', 'tags'} for one song (tags sorted)."""
        row = self.conn.execute(
            "SELECT user_difficulty, notes FROM song_user_meta WHERE filename = ?",
            (filename,)).fetchone()
        tags = [r[0] for r in self.conn.execute(
            "SELECT tag FROM song_tags WHERE filename = ? ORDER BY tag COLLATE NOCASE",
            (filename,)).fetchall()]
        return {
            "user_difficulty": (row[0] if row else None),
            "notes": ((row[1] if row else None) or ""),
            "tags": tags,
        }

    def set_song_user_meta(self, filename: str, *,
                           user_difficulty="__keep__", notes="__keep__") -> dict:
        """Partial upsert of the personal fields. Pass a value to set it, None to
        clear it, or leave it out (sentinel `__keep__`) to preserve the current
        one. When nothing personal remains the row is dropped so an
        unset-everything leaves no empty shell. Returns the merged meta."""
        with self._lock:
            cur = self.conn.execute(
                "SELECT user_difficulty, notes FROM song_user_meta WHERE filename = ?",
                (filename,)).fetchone()
            cur_diff = cur[0] if cur else None
            cur_notes = cur[1] if cur else None
            new_diff = cur_diff if user_difficulty == "__keep__" else user_difficulty
            new_notes = cur_notes if notes == "__keep__" else notes
            if new_diff is None and not (new_notes or "").strip():
                self.conn.execute("DELETE FROM song_user_meta WHERE filename = ?", (filename,))
            else:
                self.conn.execute(
                    "INSERT INTO song_user_meta (filename, user_difficulty, notes, updated_at) "
                    "VALUES (?, ?, ?, datetime('now')) "
                    "ON CONFLICT(filename) DO UPDATE SET "
                    "user_difficulty = excluded.user_difficulty, "
                    "notes = excluded.notes, updated_at = excluded.updated_at",
                    (filename, new_diff, (new_notes or None)))
            self.conn.commit()
        return self.get_song_user_meta(filename)

    # ── Per-field metadata overrides + locks (Fix-metadata popup) ─────────────
    def get_song_overrides(self, filename: str) -> dict:
        """{field: {"value": str|None, "locked": bool}} for one song."""
        rows = self.conn.execute(
            "SELECT field, value, locked FROM song_field_override WHERE filename = ?",
            (filename,)).fetchall()
        return {r[0]: {"value": r[1], "locked": bool(r[2])} for r in rows}

    def set_song_override(self, filename: str, field: str, *,
                          value="__keep__", locked="__keep__") -> dict:
        """Partial upsert of one field's override value and/or lock. Pass a
        value/locked to set it or leave the sentinel to keep the current one. A
        row with neither a value nor a lock is dropped (no empty shell). Returns
        the song's full override map."""
        with self._lock:
            cur = self.conn.execute(
                "SELECT value, locked FROM song_field_override WHERE filename = ? AND field = ?",
                (filename, field)).fetchone()
            new_val = (cur[0] if cur else None) if value == "__keep__" else value
            new_lock = (bool(cur[1]) if cur else False) if locked == "__keep__" else bool(locked)
            new_val = (new_val or "").strip() or None
            if new_val is None and not new_lock:
                self.conn.execute(
                    "DELETE FROM song_field_override WHERE filename = ? AND field = ?",
                    (filename, field))
            else:
                self.conn.execute(
                    "INSERT INTO song_field_override (filename, field, value, locked, updated_at) "
                    "VALUES (?, ?, ?, ?, datetime('now')) "
                    "ON CONFLICT(filename, field) DO UPDATE SET "
                    "value = excluded.value, locked = excluded.locked, updated_at = excluded.updated_at",
                    (filename, field, new_val, 1 if new_lock else 0))
            self.conn.commit()
        return self.get_song_overrides(filename)

    def locked_fields(self, filename: str) -> set:
        """The catalog fields the user LOCKED for a song (Fix-metadata popup).
        An automatic match must never (re)canonicalize these, and gap-fill must
        never write them to the file. Locked read (the enrichment worker calls
        it), minimal projection."""
        with self._lock:
            return {r[0] for r in self.conn.execute(
                "SELECT field FROM song_field_override WHERE filename = ? AND locked = 1",
                (filename,)).fetchall()}

    def clear_song_override(self, filename: str, field: str) -> dict:
        """Remove a field's override + lock entirely (revert to the resolved
        pack/matched value)."""
        with self._lock:
            self.conn.execute(
                "DELETE FROM song_field_override WHERE filename = ? AND field = ?",
                (filename, field))
            self.conn.commit()
        return self.get_song_overrides(filename)

    def overrides_map(self, filenames) -> dict:
        """{filename: {field: {value, locked}}} for a batch — feeds the grid's
        effective-value resolution (display slice). Chunked under SQLite's
        variable limit."""
        fns = list(filenames)
        out: dict = {}
        for i in range(0, len(fns), 400):
            chunk = fns[i:i + 400]
            if not chunk:
                break
            q = ("SELECT filename, field, value, locked FROM song_field_override "
                 "WHERE filename IN (%s)" % ",".join("?" * len(chunk)))
            for fn, field, value, locked in self.conn.execute(q, chunk).fetchall():
                out.setdefault(fn, {})[field] = {"value": value, "locked": bool(locked)}
        return out

    def _romaji_display(self, filename: str, artist: str, title: str):
        """English-base display fallback. A blank-artist CDLC pack named
        'Artist_Title_v1_p' has no readable name (artist blank; title = the raw
        filename), and a match would fill it with the artist's NATIVE script
        (kanji/kana). Surface the author's own romaji parsed from the filename
        instead, so an English base reads 'Junko Yagami - BAY CITY'. Only kicks in
        when the pack has no artist of its own — a real pack artist is untouched."""
        if (artist or "").strip():
            return artist, title
        d = _artist_title_from_filename(filename)
        return (d["artist"], d["title"]) if d else (artist, title)

    def pack_fields(self, filename: str) -> dict:
        """The stored (pack) values for the overridable catalog fields — the
        Fix-metadata popup shows these behind each override as the 'revert to
        pack' reference + the Yours/Pack provenance. Empty strings for a missing
        song so the popup always has a value to render."""
        keys = ("title", "artist", "album", "year", "genre")
        row = self.conn.execute(
            "SELECT title, artist, album, year, genre FROM songs WHERE filename = ?",
            (filename,)).fetchone()
        vals = {k: ((row[i] or "") if row else "") for i, k in enumerate(keys)}
        # Baseline the author's romaji (from the filename) for a blank-artist pack,
        # so the Details tab's Pack reference matches what the grid shows.
        vals["artist"], vals["title"] = self._romaji_display(filename, vals["artist"], vals["title"])
        return vals

    # Effective genre = a per-song genre OVERRIDE (Fix-metadata popup) else the
    # scanned pack genre. Applied at FILTER/FACET time (like the P4 artist alias)
    # so a corrected genre is browsable — the correlated subquery is used ONLY
    # when genre overrides actually exist; the common case stays on the plain
    # indexed `genre` column. Genre stays a library-only overlay (it isn't a
    # write-to-file field), so it never touches the pack.
    _EFFECTIVE_GENRE_SQL = (
        "COALESCE((SELECT o.value FROM song_field_override o "
        "WHERE o.filename = songs.filename AND o.field = 'genre' "
        "AND o.value IS NOT NULL AND o.value != ''), genre)"
    )

    def _has_genre_overrides(self) -> bool:
        return self.conn.execute(
            "SELECT 1 FROM song_field_override WHERE field = 'genre' "
            "AND value IS NOT NULL AND value != '' LIMIT 1").fetchone() is not None

    def _effective_genre_expr(self) -> str:
        """`genre` normally; the override-aware COALESCE only when overrides exist."""
        return self._EFFECTIVE_GENRE_SQL if self._has_genre_overrides() else "genre"

    def set_song_tags(self, filename: str, tags) -> list:
        """Replace ALL of a song's tags with the given set (each normalized;
        blanks + case-dupes dropped). Full-replace so the whole personal-meta
        blob edits as a unit. Returns the stored tag list (sorted, like reads)."""
        norm: list = []
        seen: set = set()
        for t in (tags or []):
            nt = _normalize_tag(t)
            if nt and nt not in seen:
                seen.add(nt)
                norm.append(nt)
        # Bound the number of tags so one PUT can't write unbounded rows.
        # Per-tag length is already capped in _normalize_tag; cap the count too.
        norm = norm[:50]
        with self._lock:
            self.conn.execute("DELETE FROM song_tags WHERE filename = ?", (filename,))
            if norm:
                self.conn.executemany(
                    "INSERT OR IGNORE INTO song_tags (filename, tag, created_at) "
                    "VALUES (?, ?, datetime('now'))",
                    [(filename, t) for t in norm])
            self.conn.commit()
        return self.get_song_user_meta(filename)["tags"]

    def all_tags(self) -> list:
        """[{tag, count}] over songs that still exist, most-used first — powers
        the tag filter UI. Excludes tags whose only songs were deleted."""
        rows = self.conn.execute(
            "SELECT tag, COUNT(*) c FROM song_tags "
            "WHERE filename IN (SELECT filename FROM songs) "
            "GROUP BY tag ORDER BY c DESC, tag COLLATE NOCASE").fetchall()
        return [{"tag": r[0], "count": r[1]} for r in rows]

    def user_meta_map(self, filenames) -> dict:
        """Batch {filename: user_difficulty} for a set of rows (set values
        only). Lets query_page / query_artists embed difficulty without an
        N+1. Chunked under SQLite's variable limit — query_artists can pass
        every song across 50 artists, well past a single IN (...)."""
        fns = list(filenames)
        out: dict = {}
        for i in range(0, len(fns), 400):
            chunk = fns[i:i + 400]
            if not chunk:
                break
            ph = ",".join("?" * len(chunk))
            rows = self.conn.execute(
                f"SELECT filename, user_difficulty FROM song_user_meta "
                f"WHERE filename IN ({ph}) AND user_difficulty IS NOT NULL", chunk).fetchall()
            for fn, diff in rows:
                out[fn] = diff
        return out

    def tags_map(self, filenames) -> dict:
        """Batch {filename: [tags]} for a page of rows."""
        fns = list(filenames)
        if not fns:
            return {}
        ph = ",".join("?" * len(fns))
        rows = self.conn.execute(
            f"SELECT filename, tag FROM song_tags WHERE filename IN ({ph}) "
            f"ORDER BY tag COLLATE NOCASE", fns).fetchall()
        out: dict = {}
        for fn, tag in rows:
            out.setdefault(fn, []).append(tag)
        return out

    def purge_song_user_data(self, filename: str) -> None:
        """Drop all personal rows for a deleted song. Called by delete_song
        INSIDE the caller's `meta_db._lock` — must not re-acquire the lock."""
        self.conn.execute("DELETE FROM song_user_meta WHERE filename = ?", (filename,))
        self.conn.execute("DELETE FROM song_tags WHERE filename = ?", (filename,))
        self.conn.execute("DELETE FROM song_field_override WHERE filename = ?", (filename,))

    def batch_user_meta(self, filenames, *, set_difficulty="__keep__",
                        add_tags=None, remove_tags=None) -> int:
        """Apply personal-meta edits across MANY songs in one transaction —
        the bulk-edit primitive behind the batch bar. Additive by design so a
        bulk action never silently clobbers per-song data the user can't see:

        - `set_difficulty`: an int 1–5 sets it on every song; `None` clears it
          on every song; the `__keep__` sentinel leaves each song's own value
          untouched (mixed-state "leave unchanged"). Notes are preserved; a row
          that ends up difficulty-less AND notes-less is dropped (no empty shell,
          matching set_song_user_meta).
        - `add_tags` / `remove_tags`: tag sets ADDED to / REMOVED from each song
          (never a full-replace — bulk must not wipe a song's other tags). A tag
          in both add and remove resolves to add (explicit set wins).

        Returns the count of songs touched. Caller normalizes tags is NOT
        assumed — we normalize here so the endpoint and the DB agree."""
        add = []
        seen: set = set()
        for t in (add_tags or []):
            nt = _normalize_tag(t)
            if nt and nt not in seen:
                seen.add(nt)
                add.append(nt)
        rem = {nt for nt in (_normalize_tag(t) for t in (remove_tags or [])) if nt}
        rem -= set(add)  # add wins a conflict
        fns = list(dict.fromkeys(filenames or []))  # dedupe, keep order
        if not fns:
            return 0
        with self._lock:
            for fn in fns:
                if set_difficulty != "__keep__":
                    cur = self.conn.execute(
                        "SELECT notes FROM song_user_meta WHERE filename = ?",
                        (fn,)).fetchone()
                    cur_notes = cur[0] if cur else None
                    if set_difficulty is None and not (cur_notes or "").strip():
                        self.conn.execute(
                            "DELETE FROM song_user_meta WHERE filename = ?", (fn,))
                    else:
                        self.conn.execute(
                            "INSERT INTO song_user_meta (filename, user_difficulty, notes, updated_at) "
                            "VALUES (?, ?, ?, datetime('now')) "
                            "ON CONFLICT(filename) DO UPDATE SET "
                            "user_difficulty = excluded.user_difficulty, "
                            "updated_at = excluded.updated_at",
                            (fn, set_difficulty, cur_notes))
                if rem:
                    ph = ",".join("?" * len(rem))
                    self.conn.execute(
                        f"DELETE FROM song_tags WHERE filename = ? AND tag IN ({ph})",
                        [fn, *rem])
                if add:
                    self.conn.executemany(
                        "INSERT OR IGNORE INTO song_tags (filename, tag, created_at) "
                        "VALUES (?, ?, datetime('now'))",
                        [(fn, t) for t in add])
            self.conn.commit()
        return len(fns)

    def favorite_set(self) -> set[str]:
        return {r[0] for r in self.conn.execute("SELECT filename FROM favorites").fetchall()}
