# Artist-name canonicalization (aliases, merge), artist pages, and the
# multi-chart work-grouping engine (work_display rebuild, chart
# preference/split, work/chart lookups).

import json
import re

from .helpers import _ensure_smart_names, MASTERY_ACCURACY

class ArtistsMixin:
    # ── Artist-name canonicalization (P4) ─────────────────────────────────────
    # "Apply at display": resolve songs.artist through the artist_alias override
    # for the deduped dropdown/tree (query_artists) — else keep the raw name. The
    # correlated PK-lookup subquery is fine for the offset-paged catalog; the grid
    # FILTER instead expands a canonical name to its raw variants (index-friendly,
    # keyset-safe), and the grid DISPLAY re-labels rows in Python via alias_map().
    _EFFECTIVE_ARTIST_SQL = (
        "COALESCE((SELECT aa.canonical_name FROM artist_alias aa "
        "WHERE aa.raw_name = songs.artist COLLATE NOCASE), songs.artist)"
    )

    def alias_map(self) -> dict:
        """{raw_name_lower: canonical_name} for every alias — one read to re-label
        a page of grid rows without an N+1. Lowercased keys so the lookup matches
        the raw artist case-insensitively (the table is COLLATE NOCASE)."""
        return {r[0].lower(): r[1] for r in self.conn.execute(
            "SELECT raw_name, canonical_name FROM artist_alias").fetchall()}

    def effective_artist(self, raw: str, amap: dict | None = None) -> str:
        """Canonical display name for a raw artist (alias override else itself)."""
        if raw is None:
            return raw
        amap = self.alias_map() if amap is None else amap
        return amap.get(raw.lower(), raw)

    def _single_hop_canonical(self, name: str) -> str | None:
        """The stored canonical for a raw name (a SINGLE hop), or None if `name`
        is not itself an alias key. Case-insensitive (the table is COLLATE NOCASE)
        — the shared primitive the chain-flatteners reuse."""
        if not name:
            return None
        row = self.conn.execute(
            "SELECT canonical_name FROM artist_alias WHERE raw_name = ? COLLATE NOCASE",
            (name,)).fetchone()
        return row[0] if row else None

    def _terminal_canonical(self, name: str) -> str:
        """Follow the alias chain from `name` to its TERMINAL canonical — the first
        name that is not itself an alias key — so transitive chains (raw → mid →
        … → terminal) collapse to one hop. A visited-set breaks cycles: if we come
        back to a name already seen we return the last name reached rather than
        looping. Reuses the single-hop primitive."""
        seen: set = set()
        cur = name
        while True:
            key = (cur or "").lower()
            if key in seen:
                return cur           # cycle — stop, return where we are
            seen.add(key)
            nxt = self._single_hop_canonical(cur)
            if nxt is None or (nxt or "").lower() == key:
                return cur           # not an alias key (or self) → terminal
            cur = nxt

    def _raw_variants_for(self, canonical: str) -> list:
        """Every raw artist string that should match a filter on `canonical`: the
        canonical name itself plus all raw names aliased to it (case-insensitive).
        Lets the artist filter be `artist IN (...)` — uses the artist index and is
        keyset-safe, instead of a per-row COALESCE subquery."""
        rows = self.conn.execute(
            "SELECT raw_name FROM artist_alias WHERE canonical_name = ? COLLATE NOCASE",
            (canonical,)).fetchall()
        seen, out = set(), []
        for name in [canonical, *[r[0] for r in rows]]:
            k = (name or "").lower()
            if name and k not in seen:
                seen.add(k)
                out.append(name)
        return out

    def list_artist_aliases(self) -> list:
        """All alias rows (raw → canonical), canonical then raw, for the Tidy-up
        'current merges' list."""
        rows = self.conn.execute(
            "SELECT raw_name, canonical_name, mb_artist_id FROM artist_alias "
            "ORDER BY canonical_name COLLATE NOCASE, raw_name COLLATE NOCASE").fetchall()
        return [{"raw_name": r[0], "canonical_name": r[1], "mb_artist_id": r[2]} for r in rows]

    def _set_artist_alias_locked(self, raw_name: str, canonical_name: str,
                                 mb_artist_id: str | None = None) -> dict:
        """Core upsert — assumes self._lock is HELD and does NOT commit (so the
        single set and the batch merge can share one transaction). Flattens chains
        and guards cycles:

        * A self-alias (raw == canonical) DROPs any existing row (the UI un-merge).
        * Otherwise `canonical` is resolved to its TERMINAL canonical, so setting a
          new hop onto an existing chain collapses to one hop rather than growing a
          two-hop chain that grouping/filtering would then split.
        * Cycle guard: if that terminal IS `raw`, storing would loop the chain back
          on itself — we no-op and report it so the caller can surface a failure.
        * Forward-flatten: any existing rows whose canonical == `raw` are re-pointed
          to the new terminal, so previously-merged variants follow `raw` onward.

        Returns a result dict {ok, raw_name, canonical_name, ...}."""
        raw = (raw_name or "").strip()
        canon = (canonical_name or "").strip()
        if not raw or not canon:
            raise ValueError("raw_name and canonical_name are required")
        if raw.lower() == canon.lower():
            self.conn.execute("DELETE FROM artist_alias WHERE raw_name = ? COLLATE NOCASE", (raw,))
            return {"ok": True, "raw_name": raw, "canonical_name": raw, "unmerged": True}
        terminal = self._terminal_canonical(canon)
        if (terminal or "").lower() == raw.lower():
            # raw → … → raw would be a cycle; refuse rather than corrupt the chain.
            return {"ok": False, "reason": "cycle", "raw_name": raw,
                    "canonical_name": canon, "terminal": terminal}
        self.conn.execute(
            "INSERT INTO artist_alias (raw_name, canonical_name, mb_artist_id, updated_at) "
            "VALUES (?, ?, ?, datetime('now')) "
            "ON CONFLICT(raw_name) DO UPDATE SET "
            "canonical_name = excluded.canonical_name, "
            "mb_artist_id = excluded.mb_artist_id, updated_at = excluded.updated_at",
            (raw, terminal, mb_artist_id))
        # Re-point any variants that were previously merged INTO raw onto the new
        # terminal (raw itself now aliases onward, so it can't stay a canonical).
        self.conn.execute(
            "UPDATE artist_alias SET canonical_name = ?, updated_at = datetime('now') "
            "WHERE canonical_name = ? COLLATE NOCASE AND raw_name != ? COLLATE NOCASE",
            (terminal, raw, terminal))
        return {"ok": True, "raw_name": raw, "canonical_name": terminal}

    def set_artist_alias(self, raw_name: str, canonical_name: str,
                         mb_artist_id: str | None = None) -> dict:
        """Upsert one raw→canonical override (chain-flattened, cycle-guarded — see
        _set_artist_alias_locked). Returns the result dict."""
        with self._lock:
            result = self._set_artist_alias_locked(raw_name, canonical_name, mb_artist_id)
            self.conn.commit()
        return result

    def remove_artist_alias(self, raw_name: str) -> None:
        with self._lock:
            self.conn.execute("DELETE FROM artist_alias WHERE raw_name = ? COLLATE NOCASE", (raw_name,))
            self.conn.commit()

    def merge_artists(self, raw_names, canonical_name: str) -> int:
        """Point several raw artist names at one canonical (the Tidy-up merge).
        Skips the canonical's own self-alias. Returns the count of aliases written.
        ATOMIC: the whole batch runs under one lock and one commit, so a mid-batch
        cycle rejection can't leave a half-applied merge."""
        canon = (canonical_name or "").strip()
        if not canon:
            raise ValueError("canonical_name is required")
        n = 0
        with self._lock:
            for raw in (raw_names or []):
                r = (raw or "").strip()
                if r and r.lower() != canon.lower():
                    result = self._set_artist_alias_locked(r, canon)
                    if result.get("ok"):
                        n += 1
            self.conn.commit()
        return n

    def raw_artists(self, limit: int = 2000) -> list:
        """Distinct RAW artist names in the library with song counts + their
        current canonical (for the Tidy-up picker — you merge raw variants). Raw,
        not effective, so both 'ACDC' and 'AC/DC' show as separate mergeable rows."""
        limit = max(1, min(10000, int(limit)))
        amap = self.alias_map()
        rows = self.conn.execute(
            "SELECT artist, COUNT(*) c FROM songs WHERE artist IS NOT NULL AND artist != '' "
            "GROUP BY artist COLLATE NOCASE ORDER BY c DESC, artist COLLATE NOCASE LIMIT ?",
            (limit,)).fetchall()
        return [{"name": r[0], "count": r[1],
                 "canonical": amap.get((r[0] or "").lower(), r[0])} for r in rows]

    # ── Artist pages (launch charrette PR-B) ─────────────────────────────────
    # The artist page is "X *in your library*" — a shelf plus your relationship
    # to it, never a discography browser (locked position 1). Everything here
    # reads LOCAL rows only; the external-links layer (artist_enrichment) is a
    # separate lazy cache keyed by mb_artist_id.

    def artist_known_mb_id(self, variants: list) -> str | None:
        """The artist's MusicBrainz id, if any of their songs' enrichment rows
        carry one. Only `matched`/`manual` rows count (partial coverage is the
        contract — degrade gracefully); the most common id wins so one stray
        wrong match can't out-vote the rest of the shelf."""
        if not variants:
            return None
        ph = ",".join(["?"] * len(variants))
        row = self.conn.execute(
            f"SELECT e.mb_artist_id, COUNT(*) c FROM song_enrichment e "
            f"JOIN songs s ON s.filename = e.filename "
            f"WHERE s.artist COLLATE NOCASE IN ({ph}) "
            f"AND e.match_state IN ('matched', 'manual') "
            f"AND e.mb_artist_id IS NOT NULL AND e.mb_artist_id != '' "
            f"GROUP BY e.mb_artist_id ORDER BY c DESC, e.mb_artist_id LIMIT 1",
            variants).fetchone()
        return row[0] if row else None

    def artist_page(self, name: str) -> dict:
        """The all-LOCAL artist-page payload: canonical name (alias-aware),
        the raw variants it merges, song/album counts, the albums list, the
        mastered count (DENOMINATOR LAW, locked position 2: every number
        counts songs YOU OWN — the WHERE is `artist IN (your variants)` over
        `songs`, never anything external), mb_artist_id when known, header-
        mosaic art, similar-in-library via genre co-occurrence (locked
        position 3: only artists already in the library, empty → hidden), and
        the play-all file list. An unknown name returns a zero-count page (an
        unmatched artist is still a fully functional page)."""
        from urllib.parse import quote
        canonical = self._terminal_canonical((name or "").strip())
        variants = self._raw_variants_for(canonical)
        ph = ",".join(["?"] * len(variants)) if variants else "?"
        rows = self.conn.execute(
            f"SELECT filename, title, album, year, genre FROM songs "
            f"WHERE title != '' AND artist COLLATE NOCASE IN ({ph}) "
            f"ORDER BY album COLLATE NOCASE, (track_number IS NULL) ASC, "
            f"COALESCE(disc, 1), track_number, title COLLATE NOCASE",
            variants or [canonical]).fetchall()
        # Albums: distinct non-empty album names in shelf order, each with the
        # earliest authored year, a track count, and a representative cover
        # song (the first row → also the mosaic's source).
        albums: dict = {}
        album_order: list = []
        for fn, _t, album, year, _g in rows:
            key = (album or "").strip()
            if not key:
                continue
            k = key.lower()
            if k not in albums:
                albums[k] = {"name": key, "year": (year or ""), "count": 0, "cover": fn}
                album_order.append(k)
            albums[k]["count"] += 1
            if not albums[k]["year"] and year:
                albums[k]["year"] = year
        album_list = [albums[k] for k in album_order]
        # "also shown as": the raw variants actually present in the library
        # (the canonical itself is the headline, so it's excluded).
        vrows = self.conn.execute(
            f"SELECT artist, COUNT(*) FROM songs "
            f"WHERE title != '' AND artist COLLATE NOCASE IN ({ph}) "
            f"GROUP BY artist COLLATE NOCASE ORDER BY COUNT(*) DESC",
            variants or [canonical]).fetchall()
        shown_as = [{"name": r[0], "count": r[1]} for r in vrows
                    if (r[0] or "").lower() != (canonical or "").lower()]
        # Mastered / practice presence — over THIS artist's library songs only.
        mastered = 0
        has_stats = False
        fns = [r[0] for r in rows]
        if fns:
            fph = ",".join(["?"] * len(fns))
            srows = self.conn.execute(
                f"SELECT filename, MAX(best_accuracy) FROM song_stats "
                f"WHERE filename IN ({fph}) GROUP BY filename", fns).fetchall()
            has_stats = len(srows) > 0
            mastered = sum(1 for _fn, acc in srows
                           if acc is not None and acc >= MASTERY_ACCURACY)
        # Similar in your library: other artists sharing songs.genre values,
        # ranked by distinct shared genres then by how many of their songs sit
        # in those genres. Raw artist rows are folded through the alias map so
        # "ACDC" and "AC/DC" rank as one artist; self is excluded either way.
        genres = sorted({(r[4] or "").strip().lower() for r in rows} - {""})
        similar: list = []
        if genres:
            gph = ",".join(["?"] * len(genres))
            grows = self.conn.execute(
                f"SELECT artist, COUNT(DISTINCT lower(genre)), COUNT(*) FROM songs "
                f"WHERE title != '' AND genre != '' AND lower(genre) IN ({gph}) "
                f"AND artist IS NOT NULL AND artist != '' "
                f"GROUP BY artist COLLATE NOCASE", genres).fetchall()
            amap = self.alias_map()
            agg: dict = {}
            for raw, shared, n in grows:
                canon = amap.get((raw or "").lower(), raw)
                if (canon or "").lower() == (canonical or "").lower():
                    continue
                cur = agg.setdefault((canon or "").lower(),
                                     {"artist": canon, "shared_genres": 0, "count": 0})
                cur["shared_genres"] = max(cur["shared_genres"], shared)
                cur["count"] += n
            similar = sorted(
                agg.values(),
                key=lambda a: (-a["shared_genres"], -a["count"], (a["artist"] or "").lower())
            )[:5]
        # Header mosaic (locked position 10: MB hosts no artist images — the
        # default is a mosaic of OWNED album art via the playlist-cover
        # grammar): one representative song per album first, then fill from
        # the remaining songs, up to 4.
        seen: set = set()
        art_files: list = []
        for al in album_list:
            if al["cover"] not in seen:
                seen.add(al["cover"])
                art_files.append(al["cover"])
            if len(art_files) >= 4:
                break
        if len(art_files) < 4:
            for fn in fns:
                if fn not in seen:
                    seen.add(fn)
                    art_files.append(fn)
                if len(art_files) >= 4:
                    break
        return {
            "artist": canonical,
            "variants": shown_as,
            "song_count": len(rows),
            "album_count": len(album_list),
            "mastered_count": mastered,
            "has_stats": has_stats,
            "albums": album_list,
            "mb_artist_id": self.artist_known_mb_id(variants),
            "similar": similar,
            "art_urls": [f"/api/song/{quote(fn)}/art" for fn in art_files],
            # Play-all seed (album/track order, same as the rows above).
            # Bounded so a pathological library can't balloon the payload.
            "files": fns[:1000],
        }

    # ── Multi-chart grouping engine (P5a) ────────────────────────────────────
    @staticmethod
    def _norm_token(s, fold_the=False):
        """Fold a name to a comparison token: strip diacritics + punctuation +
        whitespace, lowercase, optionally drop a leading 'the ' (artist names)."""
        import re
        import unicodedata
        raw = str(s or "")
        s = unicodedata.normalize("NFKD", raw)
        s = "".join(c for c in s if not unicodedata.combining(c)).lower()
        if fold_the:
            s = re.sub(r"^the\s+", "", s)
        folded = re.sub(r"[^a-z0-9]+", "", s)
        if folded:
            return folded
        # All-non-Latin titles (CJK/Cyrillic/Greek/Arabic) fold to "" above,
        # which would collapse every such song into one bogus work. Fall back to
        # the raw text lowercased with whitespace collapsed so distinct titles
        # keep distinct keys. Latin names always hit the `folded` branch, so
        # their behavior is unchanged.
        return re.sub(r"\s+", " ", raw.strip().lower())

    @classmethod
    def _work_key(cls, artist, title) -> str:
        """Identity of a musical WORK = normalize(artist)+'|'+normalize(title).
        Recording-MBID identity is a later enrichment upgrade (§3); this text key
        groups the common 'same song, several charts' case now."""
        return cls._norm_token(artist, fold_the=True) + "|" + cls._norm_token(title)

    def _alias_map_if_exists(self) -> dict:
        """{raw_artist_lower: canonical} from P4's artist_alias when that table is
        present, so work_key groups across artist aliases (ACDC/AC/DC) once P4 is
        merged; {} (→ raw artist) when it isn't. Forward-compatible, no hard P4 dep."""
        try:
            rows = self.conn.execute("SELECT raw_name, canonical_name FROM artist_alias").fetchall()
        except Exception:
            return {}
        return {r[0].lower(): r[1] for r in rows}

    @staticmethod
    def _pick_representative(members: list, prefs: dict) -> str:
        """The keeper chart of a group: the user's chart_group_pref when its file
        is present, else auto-pick = MOST-PLAYED (history-sticky, §7.1: real
        practice wins — a newer/'more complete' import must not silently take
        the pick from the chart your reps accrued on, and a one-off try of an
        alternate can't out-rank a practiced incumbent) → most-complete
        (arrangements) → newest → filename. An all-unplayed group therefore
        still picks by completeness. `members` = dicts {fn, wk, arr, plays, mtime}."""
        if members:
            pref = prefs.get(members[0]["wk"])
            if pref and any(m["fn"] == pref for m in members):
                return pref
        best = min(members, key=lambda m: (-m["plays"], -m["arr"], -m["mtime"], m["fn"]))
        return best["fn"]

    def _load_work_members(self):
        """Read songs + overrides → ({effective_work_key: [member dicts]}, prefs)."""
        amap = self._alias_map_if_exists()
        splits = dict(self.conn.execute(
            "SELECT filename, split_key FROM chart_group_split").fetchall())
        prefs = dict(self.conn.execute(
            "SELECT work_key, preferred_filename FROM chart_group_pref").fetchall())
        plays = dict(self.conn.execute(
            "SELECT filename, SUM(plays) FROM song_stats GROUP BY filename").fetchall())
        groups: dict = {}
        for fn, artist, title, arr_json, mtime in self.conn.execute(
                "SELECT filename, artist, title, arrangements, mtime FROM songs WHERE title != ''"):
            wk = self._work_key(amap.get((artist or "").lower(), artist), title)
            eff = splits.get(fn) or wk
            try:
                arr = len(json.loads(arr_json)) if arr_json else 0
            except Exception:
                arr = 0
            groups.setdefault(eff, []).append(
                {"fn": fn, "wk": wk, "arr": arr, "plays": int(plays.get(fn) or 0), "mtime": mtime or 0})
        return groups, prefs

    def rebuild_work_display(self) -> None:
        """Full re-materialization of work_display from songs + the override
        tables. O(n) — cheap enough to run lazily after any songs churn."""
        with self._lock:
            groups, prefs = self._load_work_members()
            out = []
            for eff, members in groups.items():
                rep = self._pick_representative(members, prefs)
                n = len(members)
                for m in members:
                    out.append((m["fn"], m["wk"], eff, 1 if m["fn"] == rep else 0, n))
            self.conn.execute("DELETE FROM work_display")
            if out:
                self.conn.executemany(
                    "INSERT INTO work_display (filename, work_key, effective_work_key, "
                    "is_group_representative, group_size) VALUES (?, ?, ?, ?, ?)", out)
            self.conn.commit()
            self._work_display_dirty = False

    def _ensure_work_display(self) -> None:
        """(Re)build the read-model when a change marked it dirty (or it's never
        been built). Called at the top of every grouped query."""
        if getattr(self, "_work_display_dirty", True):
            self.rebuild_work_display()

    def work_key_for(self, filename: str):
        """work_key of a song (from its current artist+title), or None if absent."""
        row = self.conn.execute(
            "SELECT artist, title FROM songs WHERE filename = ?", (filename,)).fetchone()
        if not row:
            return None
        amap = self._alias_map_if_exists()
        return self._work_key(amap.get((row[0] or "").lower(), row[0]), row[1])

    def set_chart_preferred(self, work_key: str, filename: str) -> None:
        """Pick the keeper chart of a work. Incremental: re-flips
        is_group_representative within the work's (non-split) group only —
        group_size is unchanged — so no full rebuild."""
        with self._lock:
            self.conn.execute(
                "INSERT INTO chart_group_pref (work_key, preferred_filename, updated_at) "
                "VALUES (?, ?, datetime('now')) "
                "ON CONFLICT(work_key) DO UPDATE SET "
                "preferred_filename = excluded.preferred_filename, updated_at = excluded.updated_at",
                (work_key, filename))
            if not self._work_display_dirty:
                members = [r[0] for r in self.conn.execute(
                    "SELECT filename FROM work_display WHERE effective_work_key = ?",
                    (work_key,)).fetchall()]
                if filename in members:
                    self.conn.execute(
                        "UPDATE work_display SET is_group_representative = "
                        "CASE WHEN filename = ? THEN 1 ELSE 0 END "
                        "WHERE effective_work_key = ?", (filename, work_key))
                else:
                    # pref target isn't a current member (orphan/split) — reconcile
                    # on the next lazy rebuild rather than leave it half-applied.
                    self._work_display_dirty = True
            self.conn.commit()

    def clear_chart_preferred(self, work_key: str) -> None:
        """Reset a work to auto-pick; lazy full rebuild."""
        with self._lock:
            self.conn.execute("DELETE FROM chart_group_pref WHERE work_key = ?", (work_key,))
            self._work_display_dirty = True
            self.conn.commit()

    def split_chart(self, filename: str) -> None:
        """'These aren't the same' — give a chart a unique split_key so it stands
        alone as a singleton work. Lazy full rebuild (the old group's membership +
        sizes shift)."""
        wk = self.work_key_for(filename) or filename
        with self._lock:
            self.conn.execute(
                "INSERT INTO chart_group_split (filename, split_key, updated_at) "
                "VALUES (?, ?, datetime('now')) "
                "ON CONFLICT(filename) DO UPDATE SET "
                "split_key = excluded.split_key, updated_at = excluded.updated_at",
                (filename, f"{wk}#split#{filename}"))
            self._work_display_dirty = True
            self.conn.commit()

    def unsplit_chart(self, filename: str) -> None:
        """Undo a split — the chart rejoins its work. Lazy full rebuild."""
        with self._lock:
            self.conn.execute("DELETE FROM chart_group_split WHERE filename = ?", (filename,))
            self._work_display_dirty = True
            self.conn.commit()

    def work_charts(self, work_key: str) -> dict:
        """Every chart in a work (P5b) — the Charts drawer's data. Members are the
        work's CURRENT (non-split) group: work_display rows whose effective_work_key
        matches. Each carries its effective title/artist, arrangements, tuning,
        format, best accuracy, and the representative/preferred flags so the drawer
        can label 'Preferred — your pick' vs 'Preferred (auto)'."""
        self._ensure_work_display()
        amap = self._alias_map_if_exists()
        pref_row = self.conn.execute(
            "SELECT preferred_filename FROM chart_group_pref WHERE work_key = ?", (work_key,)).fetchone()
        pref_fn = pref_row[0] if pref_row else None
        rows = self.conn.execute(
            "SELECT wd.filename, wd.is_group_representative, s.title, s.artist, s.album, s.year, "
            "s.arrangements, s.tuning_name, s.tuning, s.format, "
            "(SELECT MAX(best_accuracy) FROM song_stats st WHERE st.filename = wd.filename AND st.plays > 0) "
            "FROM work_display wd JOIN songs s ON s.filename = wd.filename "
            "WHERE wd.effective_work_key = ? "
            "ORDER BY wd.is_group_representative DESC, s.title COLLATE NOCASE, s.filename",
            (work_key,)).fetchall()
        charts = []
        for fn, is_rep, title, artist, album, year, arr_json, tuning_name, tuning, fmt, best in rows:
            try:
                arrangements = _ensure_smart_names(json.loads(arr_json) if arr_json else [])
            except Exception:
                arrangements = []
            charts.append({
                "filename": fn,
                "title": title or fn,
                "artist": amap.get((artist or "").lower(), artist) or "",
                "album": album or "", "year": year or "",
                "arrangements": arrangements,
                "tuning_name": tuning_name or "", "tuning": tuning or "",
                "format": fmt or "archive",
                "best_accuracy": best,
                "is_representative": bool(is_rep),
                "is_preferred": (fn == pref_fn),
            })
        return {
            "work_key": work_key,
            "count": len(charts),
            "preferred_filename": pref_fn,
            # Whether the keeper is your explicit pick or the auto-pick — drives the
            # drawer's "Preferred — your pick" vs "Preferred (auto)" label.
            "preferred_source": "user" if pref_fn else "auto",
            "charts": charts,
        }

    def chart_work(self, filename: str) -> dict:
        """The work a chart belongs to (P5d): its EFFECTIVE work_key (a split
        chart resolves to its own singleton key) + how many charts share it.
        Lets an opener resolve group membership for rows that didn't come from
        a grouped query — the tree view's rows ride the ungrouped artists
        endpoint, so they carry no chart_count/work_key annotation."""
        key = self._canonical_song_filename(filename)
        self._ensure_work_display()
        row = self.conn.execute(
            "SELECT effective_work_key, group_size FROM work_display WHERE filename = ?",
            (key,)).fetchone()
        if not row:
            return {"filename": key, "work_key": None, "chart_count": 0, "is_split": False}
        split = self.conn.execute(
            "SELECT 1 FROM chart_group_split WHERE filename = ?", (key,)).fetchone()
        return {"filename": key, "work_key": row[0], "chart_count": row[1],
                "is_split": bool(split)}
