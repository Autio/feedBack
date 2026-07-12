# Metadata enrichment (P7): song-level enrichment rows (pending queue,
# match/manual/rejected states, review queue, art cache) and the
# artist-level enrichment cache.

import hashlib
import json
import time

class EnrichmentMixin:
    def get_artist_enrichment(self, mb_artist_id: str) -> dict | None:
        """Cached artist-level enrichment row, JSON fields parsed (bad/legacy
        JSON degrades to empty rather than 500ing the links route)."""
        row = self.conn.execute(
            "SELECT mb_artist_id, url_rels, genres, fetched_at "
            "FROM artist_enrichment WHERE mb_artist_id = ?",
            (mb_artist_id,)).fetchone()
        if not row:
            return None

        def _parsed(raw, fallback):
            try:
                v = json.loads(raw) if raw else fallback
            except (TypeError, ValueError):
                return fallback
            return v if isinstance(v, type(fallback)) else fallback

        return {"mb_artist_id": row[0], "url_rels": _parsed(row[1], {}),
                "genres": _parsed(row[2], []), "fetched_at": row[3]}

    def put_artist_enrichment(self, mb_artist_id: str, url_rels: dict,
                              genres: list) -> None:
        """Store (or refresh) the one artist-level cache row."""
        with self._lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO artist_enrichment "
                "(mb_artist_id, url_rels, genres, fetched_at) "
                "VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
                (mb_artist_id, json.dumps(url_rels or {}), json.dumps(genres or [])))
            self.conn.commit()

    # ── Metadata enrichment (P7 — plumbing; the matcher itself is the next
    # slice) ─────────────────────────────────────────────────────────────────

    @staticmethod
    def enrichment_content_hash(artist, title, album, duration) -> str:
        """Identity hash of the metadata a match keys on — normalized
        artist|title|album|duration. Deliberately excludes the filename, so a
        renamed pack keeps its enrichment (rename-survivable), and an unchanged
        hash makes re-enrichment a no-op (idempotent). Whitespace/case-folded
        so trivial edits don't invalidate a match; duration is rounded to whole
        seconds for the same reason."""
        def norm(s):
            return " ".join(str(s or "").lower().split())
        try:
            dur = str(int(round(float(duration or 0))))
        except (TypeError, ValueError):
            dur = "0"
        raw = "|".join([norm(artist), norm(title), norm(album), dur])
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def enrichment_pending(self, limit: int = 500,
                           allowed_keys: frozenset | None = None) -> list[dict]:
        """Songs whose enrichment row needs (re)matching: no row yet, or a
        row whose content_hash no longer matches the song's current metadata
        (an edit changed the identity → re-match), or an `unscanned` row.
        `manual` rows are the user's pinned pick and are NEVER re-queued.
        `matched`/`review`/`failed` rows with an UNCHANGED hash are settled
        here — a review row stands until the user acts, and a failed row
        retries only via the matcher's backoff policy (enrichment_failed_rows)
        rather than being re-queued every pass. An identity edit (say, the
        user fixes the typo that made matching fail) re-queues any of them
        immediately via the hash mismatch.

        `allowed_keys` is the set of per-field auto-apply toggle keys that are
        currently ON. A `matched` row stamped while one of those fields was
        suppressed (its key in `apply_mask`) is re-queued for backfill, so
        re-enabling a field honours the same "nothing forfeited" contract the
        source/art toggles already keep. None = don't apply the mask rule (the
        caller isn't the field-aware matcher, e.g. a plain count)."""
        # Read under _lock: the worker commits on this shared connection under
        # _lock, so an unlocked SELECT could interleave with its execute+commit.
        with self._lock:
            rows = self.conn.execute(
                "SELECT s.filename, s.artist, s.title, s.album, s.year, s.duration, "
                "e.content_hash, e.match_state, e.apply_mask "
                "FROM songs s LEFT JOIN song_enrichment e ON e.filename = s.filename "
                "WHERE s.title != '' AND (e.filename IS NULL "
                "OR e.match_state IN ('unscanned', 'matched', 'review', 'failed')) "
                "ORDER BY s.filename LIMIT ?", (max(1, int(limit)),)).fetchall()
        out = []
        for fn, artist, title, album, year, duration, ehash, state, mask in rows:
            h = self.enrichment_content_hash(artist, title, album, duration)
            # No row yet, still unmatched, or the identity changed under a
            # settled row → needs the matcher. A settled row with an
            # unchanged hash stays settled (idempotence)…
            needs = state is None or state == "unscanned" or ehash != h
            # …EXCEPT a `matched` row that suppressed a field now re-enabled:
            # re-queue it so the newly-allowed field gets backfilled.
            if not needs and state == "matched" and allowed_keys is not None and mask:
                if {k for k in mask.split(",") if k} & allowed_keys:
                    needs = True
            if needs:
                out.append({"filename": fn, "artist": artist, "title": title,
                            "album": album, "year": year, "duration": duration,
                            "content_hash": h, "match_state": state})
        return out

    def upsert_enrichment_stub(self, filename: str, content_hash: str) -> None:
        """Write/refresh a row's identity hash ahead of matching. A row whose
        hash changed drops back to `unscanned` (the old match no longer applies)
        — EXCEPT a `manual` row, which is the user's explicit pick and survives
        metadata edits untouched."""
        with self._lock:
            # Idempotence: skip the UPDATE/commit when the upsert would be a
            # no-op. The no-op matcher (P7) re-stamps every pending row each
            # pass; without this guard an already-settled row would be
            # rewritten every ~5 min, N commits/pass contending with request
            # writes. A `manual` pick never changes here, and a non-manual row
            # whose hash already matches keeps its state+hash — both no-ops.
            cur = self.conn.execute(
                "SELECT content_hash, match_state FROM song_enrichment WHERE filename = ?",
                (filename,)).fetchone()
            if cur is not None:
                old_hash, state = cur
                if state == "manual" or old_hash == content_hash:
                    return
            self.conn.execute(
                "INSERT INTO song_enrichment (filename, content_hash, match_state) "
                "VALUES (?, ?, 'unscanned') "
                "ON CONFLICT(filename) DO UPDATE SET "
                "  match_state = CASE WHEN song_enrichment.match_state = 'manual' "
                "                     THEN song_enrichment.match_state "
                "                     WHEN song_enrichment.content_hash IS NOT excluded.content_hash "
                "                     THEN 'unscanned' "
                "                     ELSE song_enrichment.match_state END, "
                # An identity change restarts the failure backoff too — the
                # accumulated attempts belonged to the OLD identity (e.g. the
                # user just fixed the typo that made matching fail).
                "  attempts = CASE WHEN song_enrichment.match_state = 'manual' "
                "                  THEN song_enrichment.attempts "
                "                  WHEN song_enrichment.content_hash IS NOT excluded.content_hash "
                "                  THEN 0 "
                "                  ELSE song_enrichment.attempts END, "
                "  content_hash = CASE WHEN song_enrichment.match_state = 'manual' "
                "                      THEN song_enrichment.content_hash "
                "                      ELSE excluded.content_hash END",
                (filename, content_hash))
            self.conn.commit()

    def get_enrichment(self, filename: str) -> dict | None:
        # Read under _lock (shared write connection — see enrichment_pending).
        with self._lock:
            row = self.conn.execute(
                "SELECT filename, content_hash, match_state, match_source, match_score, attempts, "
                "mb_recording_id, mb_release_id, mb_artist_id, isrc, "
                "canon_artist, canon_album, canon_title, canon_year, canon_artist_sort, "
                "genres, art_cache_path, art_state, fetched_at, candidates, last_attempt_at, "
                "apply_mask "
                "FROM song_enrichment WHERE filename = ?", (filename,)).fetchone()
        if not row:
            return None
        keys = ("filename", "content_hash", "match_state", "match_source", "match_score",
                "attempts", "mb_recording_id", "mb_release_id", "mb_artist_id", "isrc",
                "canon_artist", "canon_album", "canon_title", "canon_year",
                "canon_artist_sort", "genres", "art_cache_path", "art_state", "fetched_at",
                "candidates", "last_attempt_at", "apply_mask")
        out = dict(zip(keys, row))
        for k in ("genres", "candidates"):
            try:
                out[k] = json.loads(out[k]) if out[k] else []
            except (ValueError, TypeError):
                out[k] = []
        return out

    def enrichment_state_counts(self) -> dict:
        """{match_state: count} over rows whose song still exists (dead rows are
        filtered at read time, matching the never-purged-on-rescan contract)."""
        # Read under _lock (shared write connection — see enrichment_pending).
        with self._lock:
            rows = self.conn.execute(
                "SELECT e.match_state, COUNT(*) FROM song_enrichment e "
                "JOIN songs s ON s.filename = e.filename GROUP BY e.match_state").fetchall()
        return {r[0]: r[1] for r in rows}

    def enrichment_states_for(self, filenames: list[str]) -> dict:
        """{filename: match_state} for the given songs — a never-enriched (or
        unknown) filename is simply absent from the result. Powers the per-tile
        badges on the "Refresh Metadata" batch: the grid polls only the
        filenames in its visible window, not the whole library, so a card can
        animate queued→working→result without a per-song round-trip."""
        if not filenames:
            return {}
        out: dict = {}
        with self._lock:
            # Chunk under SQLite's variable limit so a huge visible window (or a
            # hostile caller) can't overflow the single IN (...) parameter list.
            for i in range(0, len(filenames), 400):
                chunk = filenames[i:i + 400]
                q = ("SELECT filename, match_state FROM song_enrichment "
                     "WHERE filename IN (%s)" % ",".join("?" * len(chunk)))
                for fn, st in self.conn.execute(q, chunk).fetchall():
                    out[fn] = st
        return out

    def _unmatched_set(self, filenames) -> set:
        """The subset of `filenames` whose enrichment landed in the 'failed'
        (no-match) state — feeds the grid's persistent per-card "no match" badge,
        so the misses stay visible at rest (the batch tile only shows while a
        refresh runs). Chunked set membership, like favorite_set."""
        fns = list(filenames)
        out: set = set()
        for i in range(0, len(fns), 400):
            chunk = fns[i:i + 400]
            if not chunk:
                break
            q = ("SELECT filename FROM song_enrichment WHERE match_state = 'failed' "
                 "AND filename IN (%s)" % ",".join("?" * len(chunk)))
            out.update(r[0] for r in self.conn.execute(q, chunk).fetchall())
        return out

    def enrichment_song_row(self, filename: str) -> dict | None:
        """The identity fields the matcher/scorer keys on, for one song."""
        row = self.conn.execute(
            "SELECT filename, artist, title, album, year, duration "
            "FROM songs WHERE filename = ?", (filename,)).fetchone()
        if not row:
            return None
        return dict(zip(("filename", "artist", "title", "album", "year", "duration"), row))

    def enrichment_failed_rows(self, limit: int = 500) -> list[dict]:
        """`failed` rows that MAY retry, with the fields the backoff policy
        (worker-side) needs to decide eligibility. `rejected` rows are the
        user's explicit "none of these" — never auto-retried (an identity
        edit re-queues them through enrichment_pending's hash mismatch
        instead)."""
        rows = self.conn.execute(
            "SELECT s.filename, s.artist, s.title, s.album, s.year, s.duration, "
            "e.attempts, e.last_attempt_at "
            "FROM songs s JOIN song_enrichment e ON e.filename = s.filename "
            "WHERE s.title != '' AND e.match_state = 'failed' "
            "AND COALESCE(e.match_source, '') != 'rejected' "
            "ORDER BY s.filename LIMIT ?", (max(1, int(limit)),)).fetchall()
        out = []
        for fn, artist, title, album, year, duration, attempts, last_at in rows:
            out.append({"filename": fn, "artist": artist, "title": title,
                        "album": album, "year": year, "duration": duration,
                        "content_hash": self.enrichment_content_hash(artist, title, album, duration),
                        "attempts": attempts or 0, "last_attempt_at": last_at})
        return out

    def enrichment_cache_lookup(self, content_hash: str, exclude_filename: str = "") -> dict | None:
        """A settled match for the same identity hash — another chart of the
        same recording already matched/pinned → copy it, no network (design
        §5 step 1: the local match-cache). Only FULLY-applied donors qualify
        (apply_mask empty/NULL): a row that suppressed a display field under an
        auto-apply toggle would otherwise seed siblings with its blanks even
        when the reader's own toggles want that field — so a partial row is
        skipped and the sibling falls through to its own (re-filtered) match."""
        row = self.conn.execute(
            "SELECT match_score, mb_recording_id, mb_release_id, mb_artist_id, isrc, "
            "canon_artist, canon_album, canon_title, canon_year, canon_artist_sort, genres "
            "FROM song_enrichment WHERE content_hash = ? AND filename != ? "
            "AND match_state IN ('matched', 'manual') AND mb_recording_id IS NOT NULL "
            "AND COALESCE(apply_mask, '') = '' "
            "LIMIT 1", (content_hash, exclude_filename or "")).fetchone()
        if not row:
            return None
        try:
            genres = json.loads(row[10]) if row[10] else []
        except (ValueError, TypeError):
            genres = []
        return {
            "score": row[0],
            "recording_id": row[1], "release_id": row[2] or "", "artist_id": row[3] or "",
            "isrc": row[4] or "", "artist": row[5] or "", "album": row[6] or "",
            "title": row[7] or "", "year": row[8] or "", "artist_sort": row[9] or "",
            "genres": genres,
        }

    def apply_enrichment_match(self, filename: str, content_hash: str, state: str,
                               source: str | None = None, score: float | None = None,
                               cand: dict | None = None, candidates: list | None = None,
                               bump_attempts: bool = False,
                               allow_manual_overwrite: bool = False,
                               apply_mask: str | None = None) -> bool:
        """The single writer for every matcher/review outcome. Writes the
        full lifecycle row: state + source + score, the canonical fields a
        confident match supplies (`cand`), and/or the review tier's ranked
        `candidates`. Returns False without touching anything when the row is
        `manual` and the caller isn't explicitly acting for the user — the
        never-overwrite-manual contract lives HERE so no future call path
        can forget it. Art-cache fields are preserved verbatim (they belong
        to the art slice, not the matcher). `apply_mask` (blocked per-field
        keys, from the matcher) is stamped verbatim so enrichment_pending /
        enrichment_cache_lookup can tell a fully-applied match from a
        field-suppressed one; the review/manual writers leave it NULL (a
        confirmed pick applies in full)."""
        cand = cand or {}
        now = time.time()
        with self._lock:
            cur = self.conn.execute(
                "SELECT match_state, attempts, art_cache_path, art_state, fetched_at "
                "FROM song_enrichment WHERE filename = ?", (filename,)).fetchone()
            if cur and cur[0] == "manual" and not allow_manual_overwrite:
                return False
            # An explicit reset to `unscanned` (Refresh metadata) is a fresh
            # start — the failure backoff restarts with the identity, same as
            # the stub upsert's hash-change rule.
            attempts = 0 if state == "unscanned" else (int(cur[1] or 0) if cur else 0)
            if bump_attempts:
                attempts += 1
            fetched_at = (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                          if state in ("matched", "manual", "review")
                          else (cur[4] if cur else None))
            self.conn.execute(
                "INSERT OR REPLACE INTO song_enrichment (filename, content_hash, "
                "match_state, match_source, match_score, attempts, "
                "mb_recording_id, mb_release_id, mb_artist_id, isrc, "
                "canon_artist, canon_album, canon_title, canon_year, canon_artist_sort, "
                "genres, art_cache_path, art_state, fetched_at, candidates, last_attempt_at, "
                "apply_mask) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (filename, content_hash, state, source, score, attempts,
                 cand.get("recording_id") or None, cand.get("release_id") or None,
                 cand.get("artist_id") or None, cand.get("isrc") or None,
                 cand.get("artist") or None, cand.get("album") or None,
                 cand.get("title") or None, cand.get("year") or None,
                 cand.get("artist_sort") or None,
                 json.dumps(cand.get("genres") or []) if cand else "[]",
                 cur[2] if cur else None, cur[3] if cur else None,
                 fetched_at,
                 json.dumps(candidates) if candidates else None,
                 now if state == "failed" else None,
                 apply_mask or None))
            self.conn.commit()
        return True

    def set_enrichment_manual(self, filename: str, cand: dict, source: str = "search") -> bool:
        """User-pinned match (review Accept / manual search-and-pick). The
        highest-authority state: never auto-reset, survives identity edits.
        `source` records HOW it was pinned ('review' = accepted a proposed
        candidate, 'search' = picked from a manual search)."""
        song = self.enrichment_song_row(filename)
        if not song:
            return False
        h = self.enrichment_content_hash(
            song["artist"], song["title"], song["album"], song["duration"])
        return self.apply_enrichment_match(
            filename, h, "manual", source=source, score=1.0, cand=cand,
            allow_manual_overwrite=True)

    def set_enrichment_rejected(self, filename: str) -> bool:
        """User said "none of these candidates" — clear any canonical values
        and park the row as failed/rejected (never auto-retried; an identity
        edit re-queues it). Refused for `manual` rows: un-pinning a pick the
        user explicitly made is not a review-drawer action."""
        row = self.get_enrichment(filename)
        if not row or row["match_state"] not in ("review", "matched"):
            return False
        return self.apply_enrichment_match(
            filename, row["content_hash"], "failed", source="rejected",
            score=None, candidates=row.get("candidates") or None)

    def enrichment_review_queue(self, limit: int = 200,
                                order: str = "missing_first") -> list[dict]:
        """The Match-Review drawer's queue: review-tier rows joined to their
        (still-existing) songs, with the stored candidate list parsed.
        `order` is the user's review-queue preference: 'missing_first'
        (default — charts missing album/year surface first, they gain the
        most from a confirm; complete charts only stand to be re-labelled),
        'artist' (A–Z), or 'recent' (newest files first). Unknown values
        fall back to missing_first."""
        order_sql = {
            "artist": "s.artist COLLATE NOCASE, s.title COLLATE NOCASE, e.filename",
            "recent": "s.mtime DESC, e.filename",
        }.get(order, "((COALESCE(s.album, '') = '') + (COALESCE(s.year, '') = '')) DESC, "
                     "s.artist COLLATE NOCASE, s.title COLLATE NOCASE, e.filename")
        rows = self.conn.execute(
            "SELECT e.filename, s.title, s.artist, s.album, s.year, s.duration, s.mtime, "
            "e.match_score, e.candidates, e.attempts "
            "FROM song_enrichment e JOIN songs s ON s.filename = e.filename "
            "WHERE e.match_state = 'review' "
            "ORDER BY " + order_sql + " "
            "LIMIT ?", (max(1, int(limit)),)).fetchall()
        out = []
        for fn, title, artist, album, year, duration, mtime, score, cands, attempts in rows:
            try:
                candidates = json.loads(cands) if cands else []
            except (ValueError, TypeError):
                candidates = []
            out.append({"filename": fn, "title": title, "artist": artist,
                        "album": album, "year": year, "duration": duration,
                        "mtime": mtime, "match_score": score,
                        "candidates": candidates, "attempts": attempts or 0})
        return out

    def enrichment_art_pending(self, limit: int = 500) -> list[dict]:
        """Matched songs whose cover-art situation hasn't been evaluated yet
        (art_state NULL). The art worker resolves each to 'pack' (song has its
        own art), 'user' (an override exists), 'caa' (fetched), 'none' (the
        release has no cover) or 'error' — any of which settles the row, so
        this never re-offers a song each pass."""
        rows = self.conn.execute(
            "SELECT e.filename, e.mb_release_id "
            "FROM song_enrichment e JOIN songs s ON s.filename = e.filename "
            "WHERE e.match_state IN ('matched', 'manual') "
            "AND e.mb_release_id IS NOT NULL AND e.art_state IS NULL "
            "ORDER BY e.filename LIMIT ?", (max(1, int(limit)),)).fetchall()
        return [{"filename": r[0], "mb_release_id": r[1]} for r in rows]

    def set_enrichment_art(self, filename: str, path: str | None, state: str | None) -> None:
        """Stamp a row's art-cache outcome. Targeted UPDATE (not the match
        writer) so it can never disturb the match lifecycle fields."""
        with self._lock:
            self.conn.execute(
                "UPDATE song_enrichment SET art_cache_path = ?, art_state = ? "
                "WHERE filename = ?", (path, state, filename))
            self.conn.commit()

    def clear_enrichment_art_paths(self, paths: list[str]) -> None:
        """Reset rows whose cached art file was evicted (LRU prune) back to
        unevaluated, so a later pass may re-fetch if the song still qualifies."""
        if not paths:
            return
        with self._lock:
            ph = ",".join("?" * len(paths))
            self.conn.execute(
                f"UPDATE song_enrichment SET art_cache_path = NULL, art_state = NULL "
                f"WHERE art_cache_path IN ({ph})", paths)
            self.conn.commit()

    def _estd_set(self) -> set[str]:
        """Get set of filenames that have a retuned variant (_EStd_ or _DropD_) in the DB."""
        rows = self.conn.execute(
            "SELECT filename FROM songs WHERE filename LIKE '%\\_EStd\\_%' ESCAPE '\\' "
            "OR filename LIKE '%\\_DropD\\_%' ESCAPE '\\'"
        ).fetchall()
        originals = set()
        for (fname,) in rows:
            originals.add(fname.replace("_EStd_", "_").replace("_DropD_", "_"))
        return originals
