# Playlists, smart collections, the Saved-for-Later system playlist,
# album orphan resolution, and the wishlist ("wanted") store.

import json
import sqlite3

from .helpers import _ensure_smart_names

class PlaylistsMixin:
    # ── Playlists ─────────────────────────────────────────────────────────--
    SAVED_KEY = "saved_for_later"

    def _playlist_count(self, pid: int, kind: str | None = None) -> int:
        # An ALBUM keeps every slot in its denominator: get_playlist renders /
        # plays ALL slots — self-healing orphans and even fully-missing works
        # (§7.2) stay visible — so the list-card count must agree with the detail
        # view and skip the dead-filter (is_album → no `AND s.filename IS NOT
        # NULL`, mirroring get_playlist). Mixes/other kinds count only songs that
        # still exist (mirrors the stats read-filter — dead songs are hidden, not
        # deleted on scan), passing through when the songs table is empty. Single
        # statement → no probe-then-read race. `kind` is passed by list_playlists
        # (already in hand); fetched here when a caller omits it.
        if kind is None:
            row = self.conn.execute(
                "SELECT kind FROM playlists WHERE id = ?", (pid,)
            ).fetchone()
            kind = row[0] if row else None
        if kind == "album":
            return self.conn.execute(
                "SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = ?",
                (pid,),
            ).fetchone()[0]
        return self.conn.execute(
            "SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = ? "
            "AND EXISTS (SELECT 1 FROM songs s WHERE s.filename = ps.filename)",
            (pid,),
        ).fetchone()[0]

    def arrangement_count(self, filename: str):
        """Number of arrangements for a song, or None if the song isn't in the
        library (so callers can skip validation when it can't be checked)."""
        row = self.conn.execute("SELECT arrangements FROM songs WHERE filename = ?", (filename,)).fetchone()
        if not row or not row[0]:
            return None
        try:
            arr = json.loads(row[0])
        except (ValueError, TypeError):
            return None
        return len(arr) if isinstance(arr, list) else None

    def arrangement_entry(self, filename: str, index: int):
        """One arrangement's metadata dict for a library song, or None when
        the song/index is unknown (progression then falls back to guitar)."""
        row = self.conn.execute("SELECT arrangements FROM songs WHERE filename = ?", (filename,)).fetchone()
        if not row or not row[0]:
            return None
        try:
            arr = json.loads(row[0])
        except (ValueError, TypeError):
            return None
        if isinstance(arr, list) and 0 <= index < len(arr) and isinstance(arr[index], dict):
            return arr[index]
        return None

    def list_playlists(self) -> list[dict]:
        from urllib.parse import quote
        rows = self.conn.execute(
            "SELECT id, name, system_key, created_at, updated_at, kind FROM playlists "
            "WHERE rules IS NULL "          # smart collections live in the source picker, not here
            "ORDER BY (system_key IS NULL), name COLLATE NOCASE"
        ).fetchall()
        out = []
        for r in rows:
            pid = r[0]
            # First few still-present songs (in order) → art URLs, for a
            # content-dependent playlist cover (single art / 2x2 mosaic). The
            # JOIN drops dead songs, matching get_playlist's visibility.
            arts = self.conn.execute(
                "SELECT ps.filename FROM playlist_songs ps "
                "JOIN songs s ON s.filename = ps.filename "
                "WHERE ps.playlist_id = ? ORDER BY ps.position LIMIT 4",
                (pid,),
            ).fetchall()
            out.append({
                "id": pid, "name": r[1], "system_key": r[2],
                "created_at": r[3], "updated_at": r[4], "kind": r[5],
                "count": self._playlist_count(pid, r[5]),
                "art_urls": [f"/api/song/{quote(a[0])}/art" for a in arts],
            })
        return out

    def create_playlist(self, name: str, system_key: str | None = None,
                        kind: str | None = None) -> dict:
        with self._lock:
            cur = self.conn.execute(
                "INSERT INTO playlists (name, system_key, kind, created_at, updated_at) "
                "VALUES (?, ?, ?, datetime('now'), datetime('now'))",
                (name, system_key, kind),
            )
            self.conn.commit()
            pid = cur.lastrowid
        return self.get_playlist(pid)

    def saved_playlist_id(self) -> int:
        """Id of the reserved Saved-for-Later playlist, created on first use.
        Tolerates a create race: two concurrent first-use toggles can both see
        no row and try to insert; the unique system_key index makes the loser
        raise IntegrityError, so catch it and re-read the winner's row rather
        than 500."""
        row = self.conn.execute(
            "SELECT id FROM playlists WHERE system_key = ?", (self.SAVED_KEY,)
        ).fetchone()
        if row:
            return row[0]
        try:
            return self.create_playlist("Saved for Later", self.SAVED_KEY)["id"]
        except sqlite3.IntegrityError:
            row = self.conn.execute(
                "SELECT id FROM playlists WHERE system_key = ?", (self.SAVED_KEY,)
            ).fetchone()
            if row:
                return row[0]
            raise

    def rename_playlist(self, pid: int, name: str) -> bool:
        with self._lock:
            cur = self.conn.execute(
                "UPDATE playlists SET name = ?, updated_at = datetime('now') WHERE id = ?",
                (name, pid),
            )
            self.conn.commit()
            return cur.rowcount > 0

    def delete_playlist(self, pid: int) -> bool:
        """Delete a user playlist (system playlists are protected — caller checks)."""
        with self._lock:
            self.conn.execute("DELETE FROM playlist_songs WHERE playlist_id = ?", (pid,))
            cur = self.conn.execute("DELETE FROM playlists WHERE id = ?", (pid,))
            self.conn.commit()
            return cur.rowcount > 0

    # ── Smart collections (feedBack#636 item 2) ───────────────────────────
    @staticmethod
    def _collection_row(r) -> dict:
        rules = {}
        if r[3]:
            try:
                parsed = json.loads(r[3])
                if isinstance(parsed, dict):
                    rules = parsed
            except (ValueError, TypeError):
                rules = {}
        return {"id": r[0], "name": r[1], "system_key": r[2], "rules": rules,
                "created_at": r[4], "updated_at": r[5]}

    def is_collection(self, pid: int) -> bool:
        row = self.conn.execute(
            "SELECT rules IS NOT NULL FROM playlists WHERE id = ?", (pid,)
        ).fetchone()
        return bool(row and row[0])

    def list_collections(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, name, system_key, rules, created_at, updated_at FROM playlists "
            "WHERE rules IS NOT NULL ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [self._collection_row(r) for r in rows]

    def get_collection(self, pid: int) -> dict | None:
        r = self.conn.execute(
            "SELECT id, name, system_key, rules, created_at, updated_at FROM playlists "
            "WHERE id = ? AND rules IS NOT NULL", (pid,)
        ).fetchone()
        return self._collection_row(r) if r else None

    def create_collection(self, name: str, rules: dict) -> dict:
        with self._lock:
            cur = self.conn.execute(
                "INSERT INTO playlists (name, system_key, rules, created_at, updated_at) "
                "VALUES (?, NULL, ?, datetime('now'), datetime('now'))",
                (name, json.dumps(rules or {})),
            )
            self.conn.commit()
            pid = cur.lastrowid
        return self.get_collection(pid)

    def update_collection(self, pid: int, name: str | None = None,
                          rules: dict | None = None) -> dict | None:
        if not self.is_collection(pid):
            return None
        with self._lock:
            if name is not None:
                self.conn.execute("UPDATE playlists SET name = ? WHERE id = ?", (name, pid))
            if rules is not None:
                self.conn.execute("UPDATE playlists SET rules = ? WHERE id = ?",
                                  (json.dumps(rules or {}), pid))
            self.conn.execute("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?", (pid,))
            self.conn.commit()
        return self.get_collection(pid)

    def get_playlist(self, pid: int) -> dict | None:
        # A path-param int outside SQLite's 64-bit range raises OverflowError at
        # bind time (→ 500). Treat it as a miss; every mutating playlist handler
        # gates on this first, so the guard covers them too.
        if not isinstance(pid, int) or not (-(2**63) <= pid < 2**63):
            return None
        # `rules IS NULL` excludes smart collections (#636 item 2): they share
        # the playlists table but their membership is rules-based, so every
        # manual-playlist mutation (add/remove/reorder/cover) that gates on
        # get_playlist uniformly 404s on a collection id — collections are
        # managed only through /api/collections.
        head = self.conn.execute(
            "SELECT id, name, system_key, created_at, updated_at, kind FROM playlists "
            "WHERE id = ? AND rules IS NULL", (pid,)
        ).fetchone()
        if not head:
            return None
        is_album = head[5] == "album"
        # Mixes hide dead songs (race-free; not deleted on scan). An ALBUM keeps
        # every slot: a slot whose pinned chart was deleted self-heals to the
        # work's current preferred at READ (§7.2 orphan-at-play — never a
        # membership rewrite), and reports `missing` when the whole work is gone
        # so the practice set keeps its denominator visible.
        dead_filter = "" if is_album else "AND s.filename IS NOT NULL"
        rows = self.conn.execute(
            f"""SELECT ps.filename, ps.position, s.title, s.artist, s.tuning_name,
                       ps.arrangement, ps.work_key, s.arrangements,
                       (s.filename IS NULL) AS dead
               FROM playlist_songs ps LEFT JOIN songs s ON s.filename = ps.filename
               WHERE ps.playlist_id = ? {dead_filter}
               ORDER BY ps.position, ps.filename""",
            (pid,),
        ).fetchall()
        from urllib.parse import quote
        songs = []
        for r in rows:
            entry = {
                "filename": r[0], "position": r[1],
                "title": r[2] or r[0], "artist": r[3] or "", "tuning_name": r[4] or "",
                "art_url": f"/api/song/{quote(r[0])}/art",
            }
            if is_album:
                entry["arrangement"] = r[5]
                entry["work_key"] = r[6]
                try:
                    entry["arrangements"] = _ensure_smart_names(json.loads(r[7]) if r[7] else [])
                except Exception:
                    entry["arrangements"] = []
                if r[8]:
                    entry.update(self._resolve_album_orphan(r[6]))
            songs.append(entry)
        return {
            "id": head[0], "name": head[1], "system_key": head[2],
            "created_at": head[3], "updated_at": head[4], "songs": songs,
            **({"kind": head[5]} if head[5] else {}),
        }

    def _resolve_album_orphan(self, work_key: str | None) -> dict:
        """A deleted album slot resolves to its work's CURRENT preferred/auto
        pick at read (§7.2): the slot plays `resolved_filename` today, and if
        the pinned file reappears (rescan) it simply resolves back to itself —
        no rewrite in either direction. A work with no charts left reports
        `missing` (the row stays, dimmed, so the set's denominator is honest)."""
        if work_key:
            self._ensure_work_display()
            row = self.conn.execute(
                "SELECT wd.filename, s.title, s.artist, s.tuning_name, s.arrangements "
                "FROM work_display wd JOIN songs s ON s.filename = wd.filename "
                "WHERE wd.effective_work_key = ? AND wd.is_group_representative = 1",
                (work_key,)).fetchone()
            if row:
                from urllib.parse import quote
                try:
                    arrs = _ensure_smart_names(json.loads(row[4]) if row[4] else [])
                except Exception:
                    arrs = []
                return {"resolved_filename": row[0], "title": row[1] or row[0],
                        "artist": row[2] or "", "tuning_name": row[3] or "",
                        "arrangements": arrs,
                        "art_url": f"/api/song/{quote(row[0])}/art",
                        "resolved_from_orphan": True}
        return {"missing": True}

    def add_playlist_song(self, pid: int, filename: str):
        with self._lock:
            # Re-check existence INSIDE the lock: the handler's earlier 404 check
            # is a separate step, so a concurrent delete_playlist could land
            # between them and leave an orphan playlist_songs row. Returning None
            # lets the handler answer 404 instead of inserting an orphan.
            row = self.conn.execute("SELECT kind FROM playlists WHERE id = ?", (pid,)).fetchone()
            if not row:
                return None
            # Album slots stamp the work identity at ADD time (§7.2 "resolved to
            # preferred once at add, pinned thereafter") — it's what lets a
            # later-deleted chart's slot self-heal to the work's current keeper.
            wk = self.work_key_for(filename) if row[0] == "album" else None
            nxt = self.conn.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_songs WHERE playlist_id = ?", (pid,)
            ).fetchone()[0]
            cur = self.conn.execute(
                "INSERT OR IGNORE INTO playlist_songs (playlist_id, filename, position, work_key) "
                "VALUES (?, ?, ?, ?)",
                (pid, filename, nxt, wk),
            )
            self.conn.execute("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?", (pid,))
            self.conn.commit()
            return cur.rowcount > 0

    _SLOT_KEEP = object()   # sentinel: "leave the arrangement pin unchanged"

    def update_playlist_slot(self, pid: int, filename: str,
                             new_filename: str | None = None,
                             arrangement=_SLOT_KEEP):
        """Edit ONE album slot in place (§7.2): pin/clear its arrangement (a
        NAME — names survive rescans; None clears back to full-song) and/or swap
        the slot's chart for another chart of the SAME work, keeping position +
        pin — the per-slot pick is deliberately independent of the work's
        global preferred. Returns the slot's (possibly new) filename, or None
        when the slot doesn't exist, the swap target isn't a chart of the
        slot's work, or it's already in the playlist."""
        with self._lock:
            row = self.conn.execute(
                "SELECT position, work_key FROM playlist_songs "
                "WHERE playlist_id = ? AND filename = ?", (pid, filename)).fetchone()
            if not row:
                return None
            out_fn = filename
            if new_filename and new_filename != filename:
                # Same-work guard: the stored stamp wins (works even when the
                # pinned file is gone); fall back to computing from the row.
                wk_slot = row[1] or self.work_key_for(filename)
                if not wk_slot or self.work_key_for(new_filename) != wk_slot:
                    return None
                if self.conn.execute(
                        "SELECT 1 FROM playlist_songs WHERE playlist_id = ? AND filename = ?",
                        (pid, new_filename)).fetchone():
                    return None
                self.conn.execute(
                    "UPDATE playlist_songs SET filename = ?, work_key = ? "
                    "WHERE playlist_id = ? AND filename = ?",
                    (new_filename, wk_slot, pid, filename))
                out_fn = new_filename
            if arrangement is not self._SLOT_KEEP:
                self.conn.execute(
                    "UPDATE playlist_songs SET arrangement = ? "
                    "WHERE playlist_id = ? AND filename = ?",
                    (arrangement, pid, out_fn))
            self.conn.execute("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?", (pid,))
            self.conn.commit()
        return out_fn

    def remove_playlist_song(self, pid: int, filename: str) -> bool:
        with self._lock:
            cur = self.conn.execute(
                "DELETE FROM playlist_songs WHERE playlist_id = ? AND filename = ?", (pid, filename)
            )
            self.conn.execute("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?", (pid,))
            self.conn.commit()
            return cur.rowcount > 0

    def reorder_playlist(self, pid: int, ordered_filenames: list[str]) -> bool:
        with self._lock:
            for pos, fn in enumerate(ordered_filenames):
                self.conn.execute(
                    "UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND filename = ?",
                    (pos, pid, fn),
                )
            self.conn.execute("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?", (pid,))
            self.conn.commit()
        return True

    def toggle_saved(self, filename: str) -> bool:
        """Add/remove a song on the Saved-for-Later playlist. Returns new state.
        The presence check and the add/remove run under one lock so two
        concurrent toggles of the same song can't both take the add path (or
        both remove) and leave an inconsistent saved state."""
        pid = self.saved_playlist_id()
        with self._lock:
            present = self.conn.execute(
                "SELECT 1 FROM playlist_songs WHERE playlist_id = ? AND filename = ?", (pid, filename)
            ).fetchone() is not None
            if present:
                self.conn.execute(
                    "DELETE FROM playlist_songs WHERE playlist_id = ? AND filename = ?", (pid, filename))
                new_state = False
            else:
                nxt = self.conn.execute(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_songs WHERE playlist_id = ?", (pid,)
                ).fetchone()[0]
                self.conn.execute(
                    "INSERT OR IGNORE INTO playlist_songs (playlist_id, filename, position) VALUES (?, ?, ?)",
                    (pid, filename, nxt))
                new_state = True
            self.conn.execute("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?", (pid,))
            self.conn.commit()
        return new_state

    # ── Wishlist / "wanted" (feedBack#636 item 4) ─────────────────────────
    _WANTED_COLS = ("id", "artist", "title", "source", "source_ref", "note", "created_at")

    def add_wanted(self, artist: str, title: str, source: str = "manual",
                   source_ref: str = "", note: str = "") -> dict:
        """Add a not-owned song to the wishlist (or return the existing row if
        an entry with the same identity is already wanted — idempotent, so a
        re-run of an ownership-diff doesn't duplicate). Returns the row."""
        artist = (artist or "").strip()
        title = (title or "").strip()
        source = (source or "manual").strip() or "manual"
        source_ref = (source_ref or "").strip()
        note = (note or "").strip()
        with self._lock:
            self.conn.execute(
                "INSERT OR IGNORE INTO wanted (artist, title, source, source_ref, note, created_at) "
                "VALUES (?, ?, ?, ?, ?, datetime('now'))",
                (artist, title, source, source_ref, note),
            )
            row = self.conn.execute(
                "SELECT " + ", ".join(self._WANTED_COLS) + " FROM wanted "
                "WHERE artist = ? COLLATE NOCASE AND title = ? COLLATE NOCASE "
                "AND source = ? AND source_ref = ?",
                (artist, title, source, source_ref),
            ).fetchone()
            self.conn.commit()
        return dict(zip(self._WANTED_COLS, row)) if row else {}

    def list_wanted(self) -> list[dict]:
        """All wishlist entries, newest first."""
        rows = self.conn.execute(
            "SELECT " + ", ".join(self._WANTED_COLS) + " FROM wanted "
            "ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return [dict(zip(self._WANTED_COLS, r)) for r in rows]

    def remove_wanted(self, wanted_id: int) -> bool:
        """Drop a wishlist entry by id. Returns True if a row was removed."""
        with self._lock:
            cur = self.conn.execute("DELETE FROM wanted WHERE id = ?", (wanted_id,))
            self.conn.commit()
            return cur.rowcount > 0

    def count_wanted(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM wanted").fetchone()[0]
