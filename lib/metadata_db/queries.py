# Library query engine: WHERE-clause builders (search, filters, grouped
# member-match law), the paged grid query (query_page), and the artist/
# album/stats aggregate queries.

import contextlib
import json

from .helpers import _tuning_group_key_sql, _ensure_smart_names, _normalize_tag
from .cursors import _KEYSET_SORTS, _decode_cursor, _effective_keyset_sort, _keyset_seek

class QueriesMixin:
    # Manifest-allowed filter values. Whitelisted before binding so a
    # malformed query string can't push arbitrary text through to SQL —
    # parameters are bound, but capping the input space is still cheap
    # defense-in-depth (see feedBack#129).
    _ALLOWED_ARRANGEMENT_NAMES = {"Lead", "Rhythm", "Bass", "Combo"}
    # Per-smart-type list of (sql_op, sql_param) pairs appended to the SQL
    # name-fallback branch (key-absent smart_name). Covers legacy raw names
    # and load_song()'s synthesised display names that map to each smart type.
    _SMART_NULL_FALLBACK_EXTRAS: dict[str, tuple[tuple[str, str], ...]] = {
        "Lead": (("=", "Combo"), ("LIKE", "Alt. Combo%"), ("LIKE", "Bonus Combo%")),
        "Bass": (("=", "Bass 2"),),
    }
    # Stem ids match the bare strings sloppak manifests use today —
    # `full`, `guitar`, `bass`, `drums`, `vocals`, `piano`, `other`. The
    # frontend filter UI omits `full` (it's the always-on fallback mix
    # and would match every sloppak), but the server-side whitelist
    # keeps it so a hand-rolled API client can still ask for it.
    _ALLOWED_STEM_IDS = {"full", "guitar", "bass", "drums", "vocals", "piano", "other"}

    @classmethod
    def _smart_null_extras(cls, arr_type: str) -> tuple[str, list[str]]:
        """Return (sql_fragment, bound_params) for the extra raw-name terms to
        OR into the key-absent NULL-smart_name fallback branch for arr_type.
        Empty when no extras are defined."""
        terms = cls._SMART_NULL_FALLBACK_EXTRAS.get(arr_type, ())
        fragment = "".join(
            f" OR json_extract(value, '$.name') {op} ?" for op, _ in terms
        )
        return fragment, [val for _, val in terms]

    def _build_where(self, q: str = "", favorites_only: bool = False,
                     format_filter: str = "",
                     artist_filter: str = "",
                     album_filter: str = "",
                     arrangements_has: list[str] | None = None,
                     arrangements_lacks: list[str] | None = None,
                     stems_has: list[str] | None = None,
                     stems_lacks: list[str] | None = None,
                     has_lyrics: int | None = None,
                     tunings: list[str] | None = None,
                     mastery: list[str] | None = None,
                     tags_has: list[str] | None = None,
                     user_difficulty_in: list[str] | None = None,
                     match_states: list[str] | None = None,
                     genre: list[str] | None = None,
                     naming_mode: str = "legacy",
                     include_intrinsic: bool = True) -> tuple[str, list]:
        """Shared WHERE-clause builder for query_page / query_artists /
        query_stats. Returns (where_sql, params). Leading 'WHERE' is
        included so callers paste it directly. See feedBack#129/#69.

        Clauses are two classes (the §7.1 filter law): work-identity +
        practice-state predicates live here; CHART-INTRINSIC predicates
        (format / arrangements / stems / lyrics / tuning) are built by
        `_build_intrinsic_where` and appended when `include_intrinsic`.
        Grouped queries pass include_intrinsic=False and re-apply the
        intrinsic set as a match-if-ANY-member subquery instead.
        """
        where = "WHERE title != ''"
        params: list = []
        if favorites_only:
            where += " AND filename IN (SELECT filename FROM favorites)"
        if artist_filter:
            # The dropdown/tree list CANONICAL names (query_artists), so a filter
            # value is canonical — expand it to every raw variant aliased to it so
            # picking "AC/DC" returns songs tagged "ACDC" too. `artist IN (...)`
            # keeps the artist index (keyset-safe), unlike a per-row COALESCE.
            variants = self._raw_variants_for(artist_filter)
            ph = ",".join(["?"] * len(variants))
            where += f" AND artist COLLATE NOCASE IN ({ph})"
            params += variants
        if album_filter:
            where += " AND album = ? COLLATE NOCASE"
            params.append(album_filter)
        # Genre facet (primary genre column, populated from the feedpak `genres`
        # list on scan). OR within the selected set.
        if genre:
            _gph = ",".join(["?"] * len(genre))
            where += f" AND ({self._effective_genre_expr()}) COLLATE NOCASE IN ({_gph})"
            params += list(genre)
        # Mastery bands = best accuracy across a song's arrangements (song_stats,
        # a separate table -> correlated subquery). mastered >= 0.9, in_progress =
        # attempted but < 0.9, not_started = no score. OR within the selected set.
        if mastery:
            _msub = "(SELECT MAX(best_accuracy) FROM song_stats s WHERE s.filename = songs.filename)"
            _bands = {
                "mastered": f"{_msub} >= 0.9",
                "in_progress": f"({_msub} IS NOT NULL AND {_msub} < 0.9)",
                "not_started": f"{_msub} IS NULL",
            }
            _sel = [_bands[b] for b in mastery if b in _bands]
            if _sel:
                where += " AND (" + " OR ".join(_sel) + ")"
        # Personal practice tags (song_tags) — any-of. EXISTS-style IN keeps it a
        # predicate on `songs` (keyset-safe, no row multiplication). Normalized to
        # match how tags are stored.
        _tags = [t for t in (_normalize_tag(x) for x in (tags_has or [])) if t]
        if _tags:
            ph = ",".join(["?"] * len(_tags))
            where += (" AND filename IN (SELECT filename FROM song_tags "
                      f"WHERE tag IN ({ph}))")
            params += _tags
        # Personal user-difficulty (song_user_meta) — any-of over the 1..5 set.
        _diffs = []
        for d in (user_difficulty_in or []):
            try:
                di = int(d)
            except (TypeError, ValueError):
                continue
            if 1 <= di <= 5:
                _diffs.append(di)
        if _diffs:
            ph = ",".join(["?"] * len(_diffs))
            where += (" AND filename IN (SELECT filename FROM song_user_meta "
                      f"WHERE user_difficulty IN ({ph}))")
            params += _diffs
        # Match facet (P8) = the song's enrichment lifecycle state, from the
        # separate song_enrichment table (same EXISTS idiom as mastery above).
        # 'matched' folds in 'manual' (a user pin IS a match); 'pending' means
        # no verdict yet (no row, or still unscanned). OR within the set.
        if match_states:
            _esub = "SELECT 1 FROM song_enrichment e WHERE e.filename = songs.filename"
            _mstates = {
                "review": f"EXISTS ({_esub} AND e.match_state = 'review')",
                "matched": f"EXISTS ({_esub} AND e.match_state IN ('matched', 'manual'))",
                "unmatched": f"EXISTS ({_esub} AND e.match_state = 'failed')",
                "pending": f"NOT EXISTS ({_esub} AND e.match_state != 'unscanned')",
            }
            _msel = [_mstates[b] for b in match_states if b in _mstates]
            if _msel:
                where += " AND (" + " OR ".join(_msel) + ")"
        if q:
            _qlike = f"%{q}%"
            _qterms = ("title LIKE ? COLLATE NOCASE OR artist LIKE ? COLLATE NOCASE "
                       "OR album LIKE ? COLLATE NOCASE")
            _qparams = [_qlike] * 3
            # Alias-aware artist term (launch polish): searching the CANONICAL
            # name ("AC/DC") must also find songs whose raw tag is a merged
            # variant ("ACDC") — expand via the artist_alias table. Pure
            # predicate (keyset-safe); probe-guarded so the common no-aliases
            # library keeps the exact original 3-term query.
            if self.conn.execute("SELECT 1 FROM artist_alias LIMIT 1").fetchone() is not None:
                _qterms += (" OR artist COLLATE NOCASE IN (SELECT raw_name FROM artist_alias "
                            "WHERE canonical_name LIKE ? COLLATE NOCASE)")
                _qparams.append(_qlike)
            where += f" AND ({_qterms})"
            params += _qparams
        if include_intrinsic:
            ifrag, iparams = self._build_intrinsic_where(
                "songs", format_filter=format_filter,
                arrangements_has=arrangements_has, arrangements_lacks=arrangements_lacks,
                stems_has=stems_has, stems_lacks=stems_lacks,
                has_lyrics=has_lyrics, tunings=tunings, naming_mode=naming_mode)
            where += ifrag
            params += iparams
        return where, params

    def _build_intrinsic_where(self, alias: str, format_filter: str = "",
                               arrangements_has: list[str] | None = None,
                               arrangements_lacks: list[str] | None = None,
                               stems_has: list[str] | None = None,
                               stems_lacks: list[str] | None = None,
                               has_lyrics: int | None = None,
                               tunings: list[str] | None = None,
                               naming_mode: str = "legacy") -> tuple[str, list]:
        """CHART-INTRINSIC predicates (format / arrangements / stems / lyrics /
        tuning) as ' AND …' fragments against an explicit table alias. Flat
        queries apply them to `songs` directly; grouped queries evaluate them
        against each work member `m` inside an EXISTS (§7.1 filter law — a
        work matches when ANY of its charts does, so a song you own in Drop D
        isn't hidden because your preferred chart is E Standard)."""
        where = ""
        params: list = []
        if format_filter:
            where += f" AND {alias}.format = ?"
            params.append(format_filter)
        # arrangements_has / arrangements_lacks: OR within axis (any-of).
        # Uses JSON1's json_each which yields one row per arrangement, then
        # matches the relevant field. The whole subquery is wrapped in EXISTS
        # so we don't multiply rows in the outer SELECT.
        #
        # Smart mode: each requested type (Lead/Rhythm/Bass) matches against
        # smart_name when present. "Lead" matches smart_name in
        # ('Lead', 'Alt. Lead', 'Alt. Lead N', 'Bonus Lead', 'Bonus Lead N').
        # Falls back to matching `name` for older rows without smart_name.
        # Legacy mode: matches `name` directly (original behaviour).
        arr_has = [a for a in (arrangements_has or []) if a in self._ALLOWED_ARRANGEMENT_NAMES]
        if arr_has and naming_mode == "smart":
            # Smart mode subsumes "Combo" into "Lead" — normalize here so a
            # hand-rolled API client matches the client-side behaviour and
            # the SQL doesn't need a "Combo" smart-type branch.
            arr_has = list(dict.fromkeys("Lead" if a == "Combo" else a for a in arr_has))
        if arr_has:
            if naming_mode == "smart":
                clauses = []
                for arr_type in arr_has:
                    # Extra raw-name fragments matched only in the key-absent
                    # NULL-smart_name fallback branch — they cover the legacy
                    # display names that map to this smart type:
                    #   Lead: "Combo" (combined guitar) + Alt./Bonus Combo
                    #   Bass: "Bass 2" (load_song synthesises for real_bass_22)
                    extra_null, extra_null_params = self._smart_null_extras(arr_type)
                    # json_type() returns NULL when the key is absent and the
                    # string 'null' when the key exists with explicit JSON null
                    # (set by the scanner for ambiguous duplicate-name rows).
                    # Name-fallback only applies to key-absent rows so an
                    # explicit null suppresses the fallback and lets the
                    # background rescan resolve the ambiguity authoritatively.
                    clauses.append(
                        "(json_extract(value, '$.smart_name') IS NOT NULL AND ("
                        f"json_extract(value, '$.smart_name') = ? OR "
                        f"json_extract(value, '$.smart_name') LIKE ? OR "
                        f"json_extract(value, '$.smart_name') LIKE ?"
                        ")) OR ("
                        "json_type(value, '$.smart_name') IS NULL AND ("
                        "json_extract(value, '$.name') = ? OR "
                        "json_extract(value, '$.name') LIKE ? OR "
                        f"json_extract(value, '$.name') LIKE ?{extra_null}))"
                    )
                    params += [
                        arr_type,
                        f"Alt. {arr_type}%",
                        f"Bonus {arr_type}%",
                        arr_type,
                        f"Alt. {arr_type}%",
                        f"Bonus {arr_type}%",
                    ] + extra_null_params
                where += (
                    f" AND EXISTS (SELECT 1 FROM json_each({alias}.arrangements) WHERE "
                    + " OR ".join(f"({c})" for c in clauses)
                    + ")"
                )
            else:
                placeholders = ",".join(["?"] * len(arr_has))
                where += (f" AND EXISTS (SELECT 1 FROM json_each({alias}.arrangements) "
                          f"WHERE json_extract(value, '$.name') IN ({placeholders}))")
                params += arr_has
        arr_lacks = [a for a in (arrangements_lacks or []) if a in self._ALLOWED_ARRANGEMENT_NAMES]
        if arr_lacks and naming_mode == "smart":
            arr_lacks = list(dict.fromkeys("Lead" if a == "Combo" else a for a in arr_lacks))
        if arr_lacks:
            if naming_mode == "smart":
                clauses = []
                for arr_type in arr_lacks:
                    extra_null, extra_null_params = self._smart_null_extras(arr_type)
                    # See "has" branch above for the json_type rationale.
                    # Extra branch (vs `has`): an explicit smart_name=null
                    # arrangement is ambiguous; we don't know whether it's
                    # `arr_type` or not. Be conservative and treat it as
                    # potentially matching, so `arrangements_lacks` excludes
                    # the parent row instead of falsely claiming it lacks
                    # `arr_type`. The background rescan resolves the ambiguity.
                    clauses.append(
                        "(json_extract(value, '$.smart_name') IS NOT NULL AND ("
                        f"json_extract(value, '$.smart_name') = ? OR "
                        f"json_extract(value, '$.smart_name') LIKE ? OR "
                        f"json_extract(value, '$.smart_name') LIKE ?"
                        ")) OR ("
                        "json_type(value, '$.smart_name') = 'null'"
                        ") OR ("
                        "json_type(value, '$.smart_name') IS NULL AND ("
                        "json_extract(value, '$.name') = ? OR "
                        "json_extract(value, '$.name') LIKE ? OR "
                        f"json_extract(value, '$.name') LIKE ?{extra_null}))"
                    )
                    params += [
                        arr_type,
                        f"Alt. {arr_type}%",
                        f"Bonus {arr_type}%",
                        arr_type,
                        f"Alt. {arr_type}%",
                        f"Bonus {arr_type}%",
                    ] + extra_null_params
                where += (
                    f" AND NOT EXISTS (SELECT 1 FROM json_each({alias}.arrangements) WHERE "
                    + " OR ".join(f"({c})" for c in clauses)
                    + ")"
                )
            else:
                placeholders = ",".join(["?"] * len(arr_lacks))
                where += (f" AND NOT EXISTS (SELECT 1 FROM json_each({alias}.arrangements) "
                          f"WHERE json_extract(value, '$.name') IN ({placeholders}))")
                params += arr_lacks
        stems_h = [s for s in (stems_has or []) if s in self._ALLOWED_STEM_IDS]
        if stems_h:
            placeholders = ",".join(["?"] * len(stems_h))
            where += (f" AND EXISTS (SELECT 1 FROM json_each({alias}.stem_ids) "
                      f"WHERE value IN ({placeholders}))")
            params += stems_h
        stems_l = [s for s in (stems_lacks or []) if s in self._ALLOWED_STEM_IDS]
        if stems_l:
            placeholders = ",".join(["?"] * len(stems_l))
            where += (f" AND NOT EXISTS (SELECT 1 FROM json_each({alias}.stem_ids) "
                      f"WHERE value IN ({placeholders}))")
            params += stems_l
        if has_lyrics in (0, 1):
            where += f" AND {alias}.has_lyrics = ?"
            params.append(has_lyrics)
        if tunings:
            # Keep the input cap conservative (32) so a hostile caller
            # can't blow out the parameter list. Real tuning sets in the
            # wild number in the low double digits.
            tn = [t for t in tunings if isinstance(t, str) and t][:32]
            if tn:
                placeholders = ",".join(["?"] * len(tn))
                # Match the same grouping key tuning_names() returns so a single
                # "Custom Tuning" pill selects exactly its offset set while named
                # tunings still match by name.
                where += (f" AND {_tuning_group_key_sql(alias)} "
                          f"COLLATE NOCASE IN ({placeholders})")
                params += tn
        return where, params

    # Under group=1, chart-intrinsic filters match if ANY member of the work
    # matches (§7.1 filter law). A pure predicate on the representative scan —
    # no GROUP BY, no row multiplication — so the keyset cursor stays valid.
    def _grouped_member_match(self, intrinsic_frag: str, intrinsic_params: list) -> tuple[str, list]:
        if not intrinsic_frag:
            return "", []
        return ((" AND EXISTS (SELECT 1 FROM songs m JOIN work_display mw ON mw.filename = m.filename "
                 "WHERE mw.effective_work_key = (SELECT w0.effective_work_key FROM work_display w0 "
                 "WHERE w0.filename = songs.filename)" + intrinsic_frag + ")"),
                list(intrinsic_params))

    # Predicate that narrows a query to one representative chart per work — the
    # keyset-safe grouping filter (see query_page / query_stats).
    _GROUP_REP_PREDICATE = " AND filename IN (SELECT filename FROM work_display WHERE is_group_representative = 1)"

    def query_page(self, q: str = "", page: int = 0, size: int = 24,
                   sort: str = "artist", direction: str = "asc",
                   favorites_only: bool = False,
                   format_filter: str = "",
                   artist_filter: str = "",
                   album_filter: str = "",
                   arrangements_has: list[str] | None = None,
                   arrangements_lacks: list[str] | None = None,
                   stems_has: list[str] | None = None,
                   stems_lacks: list[str] | None = None,
                   has_lyrics: int | None = None,
                   tunings: list[str] | None = None,
                   mastery: list[str] | None = None,
                   tags_has: list[str] | None = None,
                   user_difficulty_in: list[str] | None = None,
                   match_states: list[str] | None = None,
                   genre: list[str] | None = None,
                   after: str | None = None,
                   group: bool = False,
                   naming_mode: str = "legacy") -> tuple[list[dict], int]:
        """Server-side paginated search. Returns (songs, total_count).

        `after` is an opaque keyset cursor (the last row of the previous page).
        When supplied and the sort can keyset, the page is fetched with a
        WHERE-seek instead of OFFSET — O(page), independent of depth. Unknown
        sorts / bad cursors fall back to OFFSET, so it's always safe.

        `group` collapses a work's charts to one card (P5a): it adds a single
        `WHERE is_group_representative = 1` predicate over the materialized
        work_display, so the total counts WORKS not charts and the keyset seek /
        sort / A–Z all stay correct over the representative subset. Each grouped
        row carries `chart_count` (the ⚑ N).

        Filter law under grouping (P5e, §7.1): work-identity (artist/album/q)
        + practice-state (favorites/mastery/tags/difficulty) predicates stay on
        the representative row (identity ≈ the work; practice-state anchors on
        the preferred chart), while CHART-INTRINSIC predicates (format/
        arrangements/stems/lyrics/tuning) match if ANY member of the work does
        — and when the representative itself doesn't match, the row carries a
        `display_chart` override so the card can show/play the matching one."""
        where, params = self._build_where(
            q=q, favorites_only=favorites_only, format_filter=format_filter,
            artist_filter=artist_filter, album_filter=album_filter,
            arrangements_has=arrangements_has, arrangements_lacks=arrangements_lacks,
            stems_has=stems_has, stems_lacks=stems_lacks,
            has_lyrics=has_lyrics, tunings=tunings, mastery=mastery,
            tags_has=tags_has, user_difficulty_in=user_difficulty_in,
            match_states=match_states, genre=genre,
            naming_mode=naming_mode, include_intrinsic=not group,
        )
        ifrag, iparams = "", []
        if group:
            self._ensure_work_display()
            ifrag, iparams = self._build_intrinsic_where(
                "m", format_filter=format_filter,
                arrangements_has=arrangements_has, arrangements_lacks=arrangements_lacks,
                stems_has=stems_has, stems_lacks=stems_lacks,
                has_lyrics=has_lyrics, tunings=tunings, naming_mode=naming_mode)
            mfrag, mparams = self._grouped_member_match(ifrag, iparams)
            where += mfrag
            params += mparams
            where += self._GROUP_REP_PREDICATE

        sort_map = {
            # Artist sorts order WITHIN an artist by title (the tree view's
            # artist -> album -> title feel) instead of raw filename — the
            # "list is organised, cards look random" report. Direction is
            # baked per entry (the legacy `dir=desc` append would otherwise
            # land on the title term); title stays ascending under Z->A.
            "artist": "artist COLLATE NOCASE ASC, title COLLATE NOCASE ASC",
            "artist-desc": "artist COLLATE NOCASE DESC, title COLLATE NOCASE ASC",
            "title": "title COLLATE NOCASE", "title-desc": "title COLLATE NOCASE DESC",
            "recent": "mtime DESC",
            # Tuning sort uses musical distance from E Standard
            # (feedBack#22 — was alphabetical). `tuning_sort_key` is
            # the sum of per-string offsets, so |sort_key| is the
            # magnitude of the down/up-tune. ABS ascending puts E
            # Standard (0) first, then ±2 (Drop D, F Standard), then
            # ±6 (Eb Standard, F# Standard), and so on. Within a
            # magnitude tier we break ties by signed key ASC so the
            # negative (down-tuned) variant comes before the positive
            # (up-tuned) one — Eb Standard before F Standard, matching
            # how the app groups its tuning list. Final tiebreak by
            # name keeps the order fully deterministic.
            #
            # Leading term pushes pre-migration / unscanned rows to
            # the bottom — without it ABS(0) collides with E
            # Standard's 0 and unindexed rows would sort first.
            # COALESCE on every column the clause references guards
            # against NULL values — SQLite's literal-constant ADD
            # COLUMN does backfill on most versions, but raw SQL
            # inserts that bypass `put()`, edge-case migration paths,
            # or future code that writes None could still leave NULLs
            # behind, and a NULL `tuning_name` in `(tuning_name = '')`
            # evaluates to NULL itself (which sorts ahead of 0 in
            # ASC), defeating the push-to-bottom intent.
            "tuning": (
                "(COALESCE(tuning_name, '') = '') ASC, "
                "ABS(COALESCE(tuning_sort_key, 0)), "
                "COALESCE(tuning_sort_key, 0) ASC, "
                "COALESCE(tuning_name, '') COLLATE NOCASE"
            ),
            # Year sort (feedBack#128). Empty-year rows pushed to the
            # bottom for both directions; otherwise CAST so '2010' >
            # '2005' rather than alphabetic.
            "year": "(year = '') ASC, CAST(year AS INTEGER) ASC",
            "year-desc": "(year = '') ASC, CAST(year AS INTEGER) DESC",
            # Album track order: authored track number (disc, then track); songs
            # with no number fall to the bottom, ordered by title. Used by the
            # album detail view. Alpha-by-title is the fallback when unauthored.
            "track": "(track_number IS NULL) ASC, COALESCE(disc, 1), track_number, title COLLATE NOCASE",
            # Mastery = best accuracy across a song's arrangements, from the
            # separate song_stats table (so via a correlated subquery — this sort
            # drops to OFFSET paging, like tuning/year). Unscored ("not started")
            # songs push to the BOTTOM in both directions (the IS NULL term);
            # ascending is "needs practice first" (weakest measured first),
            # descending is "most mastered first".
            "mastery": (
                "((SELECT MAX(best_accuracy) FROM song_stats s WHERE s.filename = songs.filename) IS NULL) ASC, "
                "(SELECT MAX(best_accuracy) FROM song_stats s WHERE s.filename = songs.filename) ASC"
            ),
            "mastery-desc": (
                "((SELECT MAX(best_accuracy) FROM song_stats s WHERE s.filename = songs.filename) IS NULL) ASC, "
                "(SELECT MAX(best_accuracy) FROM song_stats s WHERE s.filename = songs.filename) DESC"
            ),
            # Personal difficulty rating (song_user_meta.user_difficulty, 1..5 —
            # manually set or seeded by the difficulty_tagger plugin), via a
            # correlated subquery like mastery above (drops to OFFSET paging).
            # Unrated songs push to the bottom in both directions.
            "difficulty": (
                "((SELECT user_difficulty FROM song_user_meta u WHERE u.filename = songs.filename) IS NULL) ASC, "
                "(SELECT user_difficulty FROM song_user_meta u WHERE u.filename = songs.filename) ASC"
            ),
            "difficulty-desc": (
                "((SELECT user_difficulty FROM song_user_meta u WHERE u.filename = songs.filename) IS NULL) ASC, "
                "(SELECT user_difficulty FROM song_user_meta u WHERE u.filename = songs.filename) DESC"
            ),
        }
        if group and sort in ("mastery", "mastery-desc"):
            # Sort law (§7.1): mastery aggregates MAX across the WHOLE group —
            # a song surfaces on any chart you've touched, even when the
            # preferred chart is unplayed. Mastery never keysets (OFFSET
            # paging), so the aggregate can't disturb a cursor. The recency
            # ("Recently Added") aggregate is deliberately NOT applied: mtime
            # IS a keyset sort, so its aggregate would need materializing into
            # work_display to stay cursor-safe — deferred until wanted (the
            # auto-pick's `newest` factor already surfaces new charts of
            # unplayed works; played works stay put by the sticky rule).
            _gm = ("(SELECT MAX(st.best_accuracy) FROM song_stats st "
                   "JOIN work_display sw ON sw.filename = st.filename "
                   "WHERE sw.effective_work_key = (SELECT w1.effective_work_key "
                   "FROM work_display w1 WHERE w1.filename = songs.filename))")
            sort_map["mastery"] = f"({_gm} IS NULL) ASC, {_gm} ASC"
            sort_map["mastery-desc"] = f"({_gm} IS NULL) ASC, {_gm} DESC"
        # Fold the legacy `dir=desc` toggle into the canonical sort key BEFORE
        # the lookup, so the ORDER BY is built from the effective sort — mirrors
        # what `_effective_keyset_sort` does on the cursor side. Needed because
        # the artist clause now bakes in `ASC` (for the title secondary), so the
        # ` DESC` append below is suppressed and would otherwise silently ignore
        # `sort=artist&dir=desc` (return A→Z). Only artist/title fold (they have
        # `-desc` twins); tuning/year/mastery keep their own dir handling.
        eff = _effective_keyset_sort(sort, direction)
        order = sort_map.get(eff, "artist COLLATE NOCASE")
        # Legacy `dir=desc` toggle: only safe to append on simple sort
        # clauses that don't already encode a direction. Compound /
        # multi-term entries above (artist, tuning, year, year-desc) bake their
        # ASC/DESC into the clause, so a global ` DESC` append would
        # produce invalid SQL like `CAST(year AS INTEGER) ASC DESC`.
        # Skip the append in that case — clients flipping direction on
        # those sorts use the explicit `-desc` sort key instead. (For
        # artist/title the fold above already picked the `-desc` clause.)
        if direction == "desc" and " ASC" not in order and " DESC" not in order:
            order += " DESC"
        # Unique, deterministic tiebreak → a TOTAL order. Without it, rows with
        # an equal sort key can reshuffle between OFFSET pages (skip/dupe); it's
        # also what makes keyset seeking correct.
        order += ", filename"

        # Grouped reads filter through the materialized work_display (the
        # `is_group_representative=1` predicate). rebuild_work_display does
        # DELETE→INSERT→commit under self._lock, so a lock-free reader on
        # another thread (shared conn, check_same_thread=False) could land its
        # SELECT in the mid-rebuild window and see 0 rows. Hold self._lock
        # across the representative COUNT+SELECT so it can't overlap a rebuild.
        # _ensure_work_display already rebuilt above under its own lock (and
        # self._lock is NOT reentrant), so we must NOT nest it here. Ungrouped
        # reads stay lock-free (WAL) via nullcontext.
        read_guard = self._lock if group else contextlib.nullcontext()
        with read_guard:
            total = self.conn.execute(f"SELECT COUNT(*) FROM songs {where}", params).fetchone()[0]

            cols = ("SELECT filename, title, artist, album, year, duration, tuning, "
                    "arrangements, has_lyrics, mtime, format, stem_count, stem_ids, "
                    "tuning_name, tuning_offsets FROM songs ")
            cursor = _decode_cursor(after) if after else None
            eff_sort = _effective_keyset_sort(sort, direction)
            if cursor and eff_sort in _KEYSET_SORTS:
                # Keyset seek: rows strictly after the cursor in the total order
                # `<col> <dir>, filename ASC` (NULL-aware, so == OFFSET exactly).
                col, collate, primary_dir = _KEYSET_SORTS[eff_sort]
                seek, seek_params = _keyset_seek(col, collate, primary_dir, cursor[0], cursor[1])
                seek_where = where + (" AND " if where else " WHERE ") + seek
                rows = self.conn.execute(
                    f"{cols}{seek_where} ORDER BY {order} LIMIT ?",
                    params + seek_params + [size],
                ).fetchall()
            else:
                rows = self.conn.execute(
                    f"{cols}{where} ORDER BY {order} LIMIT ? OFFSET ?",
                    params + [size, page * size],
                ).fetchall()

        estd = self._estd_set()
        favs = self.favorite_set()
        songs = []
        for r in rows:
            songs.append({
                "filename": r[0], "title": r[1], "artist": r[2], "album": r[3],
                "year": r[4], "duration": r[5], "tuning": r[6],
                "arrangements": _ensure_smart_names(json.loads(r[7]) if r[7] else []),
                "has_lyrics": bool(r[8]), "mtime": r[9],
                "format": r[10] or "archive",
                "stem_count": int(r[11] or 0),
                "stem_ids": json.loads(r[12]) if r[12] else [],
                "tuning_name": r[13] or "",
                "tuning_offsets": r[14] or "",
                "has_estd": r[0] in estd, "favorite": r[0] in favs,
            })
        # Personal layer (difficulty + tags) rides along like `favorite`, so a
        # card can badge it without a second request. Notes stay OUT of the list
        # payload (they can be long) — fetch per-song via /user-meta. Batched to
        # avoid an N+1 over the page.
        fns = [s["filename"] for s in songs]
        udm = self.user_meta_map(fns)
        tgm = self.tags_map(fns)
        # Enrichment "no match" (failed) set for the page, so a card can show a
        # persistent "no match" badge — the Refresh-Metadata batch's transient
        # per-tile state only paints while a pass runs. Cheap set membership like
        # favs/estd, so the misses stay visible at rest.
        um = self._unmatched_set(fns)
        # Per-song display OVERRIDES (Fix-metadata popup, slice 3). "Grid shows
        # only overrides": the effective cell is the user's override else the
        # pack value — a matched MusicBrainz canon NEVER silently re-titles a
        # card (canon lives in the Details drawer + art). Overlaid in Python
        # over the visible window, keyset-safe exactly like the P4 alias re-label
        # below: the seek still runs on the raw column (the one overridable
        # keyset column, title, stashes its raw value for the cursor — see
        # _sort_title / next_library_cursor).
        omap = self.overrides_map(fns)
        # Canonical artist at display (P4): re-label the card's artist through the
        # alias override so "ACDC" reads as "AC/DC". Display-only — the row's sort
        # position (raw artist) is untouched, so a card can show a canonical name
        # that differs from its A–Z bucket for cross-letter aliases; the full
        # sort/rail reindex under aliases is the P5a materialization pass.
        amap = self.alias_map()
        for s in songs:
            s["user_difficulty"] = udm.get(s["filename"])
            s["tags"] = tgm.get(s["filename"], [])
            s["unmatched"] = s["filename"] in um
            if amap:
                s["artist"] = amap.get((s.get("artist") or "").lower(), s.get("artist"))
            # English-base romaji fallback: a blank-artist CDLC pack shows nothing
            # useful (artist blank; title = the raw filename). Surface the author's
            # romaji from the "Artist_Title_v1_p" filename so the card reads
            # "Junko Yagami — BAY CITY", never blank or native script. Display-only;
            # a user override (below) still wins. Keyset-safe: stash the raw title
            # for the cursor before replacing it.
            if not (s.get("artist") or "").strip():
                r_artist, r_title = self._romaji_display(s["filename"], s.get("artist"), s.get("title"))
                if r_title != s.get("title") and "_sort_title" not in s:
                    s["_sort_title"] = s["title"]
                s["artist"], s["title"] = r_artist, r_title
            # Override wins over the pack AND the alias re-label — it's the user's
            # explicit per-song choice. Only a non-empty override VALUE replaces a
            # cell; a lock-only row (value None) leaves the displayed value alone.
            ov = omap.get(s["filename"])
            if ov:
                for field in ("title", "artist", "album", "year"):
                    cell = ov.get(field)
                    val = cell.get("value") if cell else None
                    if val:
                        if field == "title" and "_sort_title" not in s:
                            s["_sort_title"] = s["title"]   # raw title, for the keyset cursor
                        s[field] = val
        # Grouped rows carry the ⚑ N (chart_count) + the work_key from the
        # materialized read-model, so the card can render the "N charts" chip and
        # address the Charts drawer (GET /api/work/{work_key}/charts) without a
        # second request — plus `is_split` (P5e) so the ⋮ menu can offer the
        # "Rejoin other versions" undo on a split-out chart.
        if group and fns:
            ph = ",".join("?" * len(fns))
            wd = {r[0]: (r[1], r[2], r[3]) for r in self.conn.execute(
                "SELECT filename, group_size, work_key, effective_work_key "
                f"FROM work_display WHERE filename IN ({ph})", fns).fetchall()}
            splits = {r[0] for r in self.conn.execute(
                f"SELECT filename FROM chart_group_split WHERE filename IN ({ph})", fns).fetchall()}
            eff_by_fn = {}
            for s in songs:
                gs, wk, eff = wd.get(s["filename"], (1, None, None))
                s["chart_count"] = gs
                s["work_key"] = wk
                s["is_split"] = s["filename"] in splits
                if eff:
                    eff_by_fn[s["filename"]] = eff
            if ifrag:
                self._attach_display_charts(songs, eff_by_fn, ifrag, iparams)
        return songs, total

    def _attach_display_charts(self, songs: list[dict], eff_by_fn: dict,
                               intrinsic_frag: str, intrinsic_params: list) -> None:
        """§7.1: when chart-intrinsic filters admit a work through a member the
        REPRESENTATIVE doesn't itself satisfy, the card 'switches its displayed
        chart to a matching one'. The row (sort keys, cursor identity, the
        mastery/favorite anchor) stays the representative's — only the
        display/play facts ride along under `display_chart`, so keyset paging
        and the practice-state anchor are untouched. `intrinsic_frag`/`params`
        are the member-aliased ('m') predicates already built by the caller."""
        keys = sorted(set(eff_by_fn.values()))
        if not keys:
            return
        ph = ",".join("?" * len(keys))
        rows = self.conn.execute(
            "SELECT mw.effective_work_key, m.filename, m.title, m.duration, m.tuning, "
            "m.arrangements, m.has_lyrics, m.mtime, m.format, m.stem_count, m.stem_ids, "
            "m.tuning_name, m.tuning_offsets "
            "FROM songs m JOIN work_display mw ON mw.filename = m.filename "
            f"WHERE mw.effective_work_key IN ({ph}){intrinsic_frag} "
            "ORDER BY mw.is_group_representative DESC, m.mtime DESC, m.filename",
            keys + list(intrinsic_params)).fetchall()
        best: dict = {}
        for r in rows:
            best.setdefault(r[0], r)   # rep-first, then newest — one match per work
        for s in songs:
            m = best.get(eff_by_fn.get(s["filename"]))
            if not m or m[1] == s["filename"]:
                continue   # the representative itself matches (or nothing does)
            s["display_chart"] = {
                "filename": m[1], "title": m[2] or m[1], "duration": m[3],
                "tuning": m[4],
                "arrangements": _ensure_smart_names(json.loads(m[5]) if m[5] else []),
                "has_lyrics": bool(m[6]), "mtime": m[7],
                "format": m[8] or "archive",
                "stem_count": int(m[9] or 0),
                "stem_ids": json.loads(m[10]) if m[10] else [],
                "tuning_name": m[11] or "", "tuning_offsets": m[12] or "",
            }

    def query_artists(self, letter: str = "", q: str = "",
                      favorites_only: bool = False,
                      page: int = 0, size: int = 50,
                      format_filter: str = "",
                      artist_filter: str = "",
                      album_filter: str = "",
                      arrangements_has: list[str] | None = None,
                      arrangements_lacks: list[str] | None = None,
                      stems_has: list[str] | None = None,
                      stems_lacks: list[str] | None = None,
                      has_lyrics: int | None = None,
                      tunings: list[str] | None = None,
                      naming_mode: str = "legacy") -> tuple[list[dict], int]:
        """Get artists grouped by letter with their albums and songs. Returns (artists, total_artists)."""
        where, params = self._build_where(
            q=q, favorites_only=favorites_only, format_filter=format_filter,
            artist_filter=artist_filter, album_filter=album_filter,
            arrangements_has=arrangements_has, arrangements_lacks=arrangements_lacks,
            stems_has=stems_has, stems_lacks=stems_lacks,
            has_lyrics=has_lyrics, tunings=tunings, naming_mode=naming_mode,
        )
        # Canonicalize artists at display when aliases exist (P4): dedupe / group /
        # letter / order on the EFFECTIVE artist so "ACDC" + "AC/DC" list as one
        # entry. With no aliases, `art_expr` stays the plain (indexed) `artist`
        # column, so the common case pays zero subquery cost.
        has_aliases = self.conn.execute("SELECT 1 FROM artist_alias LIMIT 1").fetchone() is not None
        art_expr = self._EFFECTIVE_ARTIST_SQL if has_aliases else "artist"

        if letter == "#":
            where += f" AND ({art_expr}) NOT GLOB '[A-Za-z]*'"
        elif letter:
            where += f" AND UPPER(SUBSTR(({art_expr}), 1, 1)) = ?"
            params.append(letter.upper())

        # Get paginated distinct (effective) artists
        total_artists = self.conn.execute(
            f"SELECT COUNT(DISTINCT ({art_expr}) COLLATE NOCASE) FROM songs {where}", params
        ).fetchone()[0]

        artist_rows = self.conn.execute(
            f"SELECT DISTINCT ({art_expr}) COLLATE NOCASE as a FROM songs {where} ORDER BY a LIMIT ? OFFSET ?",
            params + [size, page * size]
        ).fetchall()
        artist_names = [r[0] for r in artist_rows]

        if not artist_names:
            return [], total_artists

        # Fetch songs for these (effective) artists only
        placeholders = ",".join(["?"] * len(artist_names))
        song_where = f"{where} AND ({art_expr}) COLLATE NOCASE IN ({placeholders})"
        song_params = params + artist_names

        rows = self.conn.execute(
            f"SELECT filename, title, ({art_expr}) as artist, album, year, duration, tuning, arrangements, has_lyrics, "
            f"format, stem_count, stem_ids, tuning_name "
            f"FROM songs {song_where} ORDER BY ({art_expr}) COLLATE NOCASE, album COLLATE NOCASE, title COLLATE NOCASE",
            song_params
        ).fetchall()

        # Group into artist -> album -> songs
        from collections import OrderedDict
        estd = self._estd_set()
        favs = self.favorite_set()
        # Personal difficulty rides along here too (feedBack#810 follow-up),
        # same batched pattern as query_page — without this the tree view's
        # difficulty badge silently never renders (song.user_difficulty was
        # always undefined for every row).
        udm = self.user_meta_map([r[0] for r in rows])
        artists = OrderedDict()
        for r in rows:
            artist = r[2] or "Unknown Artist"
            album = r[3] or "Unknown Album"
            akey = artist.lower()
            if akey not in artists:
                artists[akey] = {"name": artist, "albums": OrderedDict()}
            bkey = album.lower()
            if bkey not in artists[akey]["albums"]:
                artists[akey]["albums"][bkey] = {"name": album, "songs": []}
            artists[akey]["albums"][bkey]["songs"].append({
                "filename": r[0], "title": r[1], "artist": r[2], "album": r[3],
                "year": r[4], "duration": r[5], "tuning": r[6],
                "arrangements": _ensure_smart_names(json.loads(r[7]) if r[7] else []),
                "has_lyrics": bool(r[8]),
                "format": r[9] or "archive",
                "stem_count": int(r[10] or 0),
                "stem_ids": json.loads(r[11]) if r[11] else [],
                "tuning_name": r[12] or "",
                "has_estd": r[0] in estd,
                "favorite": r[0] in favs,
                "user_difficulty": udm.get(r[0]),
            })

        # Pick most common name variant per artist/album
        result = []
        for akey, aval in artists.items():
            albums = []
            for bkey, bval in aval["albums"].items():
                albums.append({"name": bval["name"], "songs": bval["songs"]})
            result.append({"name": aval["name"], "album_count": len(albums),
                           "song_count": sum(len(a["songs"]) for a in albums), "albums": albums})
        return result, total_artists

    def query_albums(self, q="", favorites_only=False, format_filter="",
                     artist_filter="", album_filter="",
                     arrangements_has=None, arrangements_lacks=None,
                     stems_has=None, stems_lacks=None,
                     has_lyrics=None, tunings=None, mastery=None,
                     match_states=None, genre=None,
                     naming_mode="legacy", page=0, size=120):
        """Distinct (artist, album) groups with a track count + a representative
        cover song, for the album-condensed browse (paged by album). Rows with no
        album name are excluded -- they can't form an album card. Same filters as
        query_page."""
        where, params = self._build_where(
            q=q, favorites_only=favorites_only, format_filter=format_filter,
            artist_filter=artist_filter, album_filter=album_filter,
            arrangements_has=arrangements_has, arrangements_lacks=arrangements_lacks,
            stems_has=stems_has, stems_lacks=stems_lacks,
            has_lyrics=has_lyrics, tunings=tunings, mastery=mastery,
            match_states=match_states, genre=genre,
            naming_mode=naming_mode,
        )
        awhere = where + " AND album IS NOT NULL AND album != ''"
        total = self.conn.execute(
            f"SELECT COUNT(*) FROM (SELECT 1 FROM songs {awhere} "
            f"GROUP BY artist COLLATE NOCASE, album COLLATE NOCASE)", params
        ).fetchone()[0]
        rows = self.conn.execute(
            f"SELECT artist, album, COUNT(*) AS n, MIN(filename) AS cover "
            f"FROM songs {awhere} "
            f"GROUP BY artist COLLATE NOCASE, album COLLATE NOCASE "
            f"ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE LIMIT ? OFFSET ?",
            params + [size, page * size]
        ).fetchall()
        return ([{"artist": r[0] or "Unknown Artist", "album": r[1] or "Unknown Album",
                  "count": int(r[2] or 0), "cover": r[3]} for r in rows], total)

    def query_stats(self, favorites_only: bool = False,
                    q: str = "", format_filter: str = "",
                    artist_filter: str = "",
                    album_filter: str = "",
                    arrangements_has: list[str] | None = None,
                    arrangements_lacks: list[str] | None = None,
                    stems_has: list[str] | None = None,
                    stems_lacks: list[str] | None = None,
                    has_lyrics: int | None = None,
                    tunings: list[str] | None = None,
                    match_states: list[str] | None = None,
                    sort: str = "artist",
                    want_sort_letters: bool = False,
                    group: bool = False,
                    naming_mode: str = "legacy") -> dict:
        """Aggregate stats for the letter bar. Accepts the same filter
        params as query_page so the letter counts stay synchronized
        with the grid when filters are active.

        `group` (P5a) restricts every count to one representative chart per work
        (the same predicate query_page uses), so `total_songs` and the jump-rail
        `sort_letters` count WORKS not charts and stay in lockstep with the
        grouped grid.

        `sort` selects the column the v3 jump rail's `sort_letters`
        breakdown keys on (artist for artist sorts, title for title
        sorts) so the rail's present-letters match the grid's actual
        order; other sorts fall back to artist (the rail is hidden for
        them client-side anyway). The legacy `letters` field is always
        the artist breakdown, unchanged, for the dashboard + classic tree.

        `sort_letters` is computed (and the key included) ONLY when
        `want_sort_letters` is set — the jump rail opts in, while the
        dashboard / v2 tree read only `letters` and skip the extra
        per-letter aggregate scan."""
        where, params = self._build_where(
            q=q, favorites_only=favorites_only, format_filter=format_filter,
            artist_filter=artist_filter, album_filter=album_filter,
            arrangements_has=arrangements_has, arrangements_lacks=arrangements_lacks,
            stems_has=stems_has, stems_lacks=stems_lacks,
            has_lyrics=has_lyrics, tunings=tunings, match_states=match_states,
            naming_mode=naming_mode,
            include_intrinsic=not group,
        )
        if group:
            # Same filter law as query_page (§7.1): chart-intrinsic predicates
            # match-if-ANY-member, applied identically here so the letter-bar
            # counts stay in lockstep with the grouped grid.
            self._ensure_work_display()
            ifrag, iparams = self._build_intrinsic_where(
                "m", format_filter=format_filter,
                arrangements_has=arrangements_has, arrangements_lacks=arrangements_lacks,
                stems_has=stems_has, stems_lacks=stems_lacks,
                has_lyrics=has_lyrics, tunings=tunings, naming_mode=naming_mode)
            mfrag, mparams = self._grouped_member_match(ifrag, iparams)
            where += mfrag
            params += mparams
            where += self._GROUP_REP_PREDICATE
        # Grouped stat counts filter through work_display (same
        # is_group_representative=1 predicate as query_page); hold self._lock
        # across these representative SELECTs so they can't observe a
        # mid-rebuild empty table (see query_page for the full rationale).
        # _ensure_work_display already rebuilt above under its own lock, so we
        # do NOT nest it here (self._lock is non-reentrant). Ungrouped reads
        # stay lock-free (WAL) via nullcontext.
        read_guard = self._lock if group else contextlib.nullcontext()
        with read_guard:
            total = self.conn.execute(f"SELECT COUNT(*) FROM songs {where}", params).fetchone()[0]
            # NOCASE collation here mirrors `query_artists` and the per-
            # letter `COUNT(DISTINCT artist COLLATE NOCASE)` below — without
            # it, an artist stored under two different casings would inflate
            # `total_artists` against the letter-bar breakdown the UI
            # renders next to it.
            artist_count = self.conn.execute(
                f"SELECT COUNT(DISTINCT artist COLLATE NOCASE) FROM songs {where}", params
            ).fetchone()[0]
            rows = self.conn.execute(
                f"SELECT UPPER(SUBSTR(artist, 1, 1)) as letter, COUNT(DISTINCT artist COLLATE NOCASE) "
                f"FROM songs {where} GROUP BY letter", params
            ).fetchall()
        letters = {}
        for letter, count in rows:
            count = int(count or 0)
            if count <= 0:
                continue
            key = str(letter or "")
            if key.isascii() and key.isalpha():
                letters[key] = letters.get(key, 0) + count
            else:
                letters["#"] = letters.get("#", 0) + count
        result = {"total_songs": total, "total_artists": artist_count, "letters": letters}
        # Active-sort letter buckets for the v3 jump rail. Counts SONGS (the
        # grid's unit, unlike `letters` which counts distinct artists) per
        # first-letter bucket of the column the active sort keys on, so a tap
        # on a present letter always finds a card. Non-A–Z first chars bucket
        # under '#'. Only artist/title sorts are alphabetical; anything else
        # keys on artist here but the client hides the rail for it. Computed
        # only when the caller opts in, so non-rail callers skip the scan.
        if want_sort_letters:
            sort_col = "title" if sort in ("title", "title-desc") else "artist"
            # Same representative-SELECT lock guard as the counts above.
            with read_guard:
                sort_rows = self.conn.execute(
                    f"SELECT UPPER(SUBSTR(COALESCE({sort_col}, ''), 1, 1)) AS letter, COUNT(*) "
                    f"FROM songs {where} GROUP BY letter", params
                ).fetchall()
            sort_letters: dict[str, int] = {}
            for letter, count in sort_rows:
                count = int(count or 0)
                if count <= 0:
                    continue
                key = str(letter or "")
                bucket = key if (key.isascii() and key.isalpha()) else "#"
                sort_letters[bucket] = sort_letters.get(bucket, 0) + count
            result["sort_letters"] = sort_letters
        return result
