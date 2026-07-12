# Core song-library cache: DB connection, schema creation, migrations,
# the songs-table get/put/count/delete_missing cache API, and the
# startup-time DB-restore/integrity helpers.

import json
import logging
import os
import sqlite3
import threading

from pathlib import Path

log = logging.getLogger("feedBack.server")

def _sqlite_file_integrity_ok(path: Path) -> bool:
    """True if `path` is a SQLite database that opens and passes
    `PRAGMA quick_check`. Used to gate a DB restore so a truncated or
    corrupt snapshot can never overwrite the live library DB."""
    try:
        with open(path, "rb") as f:
            if f.read(16) != b"SQLite format 3\x00":   # cheap header gate, no full read
                return False
    except OSError:
        return False
    conn = None
    try:
        conn = sqlite3.connect(str(path))
        row = conn.execute("PRAGMA quick_check").fetchone()
        return bool(row) and row[0] == "ok"
    except sqlite3.Error:
        return False
    finally:
        if conn is not None:
            conn.close()
        # quick_check on a non-WAL file makes no sidecars, but a malformed
        # file can; sweep them so a probe never litters config_dir.
        for suffix in ("-wal", "-shm"):
            try:
                path.with_name(path.name + suffix).unlink()
            except FileNotFoundError:
                pass


def _apply_pending_db_restore(config_dir: Path) -> None:
    """Swap in a library DB restored from a settings bundle, if one is
    staged. A settings import writes the restored snapshot to
    `web_library.db.restore` rather than over the live DB (the running
    server holds the old file open, and a stale `-wal`/`-shm` could be
    replayed onto a fresh main file → corruption). The swap happens here,
    at startup, BEFORE the connection opens: delete the old DB and its WAL
    sidecars, then rename the staged snapshot into place. The snapshot is a
    fully-checkpointed single file (SQLite online-backup API), so it needs
    no sidecars of its own. Idempotent and a no-op when nothing is staged.

    The staged file is re-validated here before anything is destroyed: a
    restore that fails its integrity check is discarded and the live DB is
    left untouched, so a bad bundle can never brick startup or lose data."""
    pending = config_dir / "web_library.db.restore"
    if not pending.exists():
        return
    if not _sqlite_file_integrity_ok(pending):
        log.error("pending library DB restore failed its integrity check; "
                  "discarding it and keeping the existing database")
        try:
            pending.unlink()
        except FileNotFoundError:
            pass
        return
    for suffix in ("", "-wal", "-shm"):
        try:
            (config_dir / f"web_library.db{suffix}").unlink()
        except FileNotFoundError:
            pass
    os.replace(pending, config_dir / "web_library.db")
    log.info("applied pending library DB restore from settings import")


class CoreMixin:
    def __init__(self, config_dir: Path):
        config_dir.mkdir(parents=True, exist_ok=True)
        _apply_pending_db_restore(config_dir)
        self.db_path = str(config_dir / "web_library.db")
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS songs (
                filename TEXT PRIMARY KEY,
                mtime REAL,
                size INTEGER,
                title TEXT,
                artist TEXT,
                album TEXT,
                year TEXT,
                duration REAL,
                tuning TEXT,
                arrangements TEXT,
                has_lyrics INTEGER DEFAULT 0,
                format TEXT DEFAULT 'archive',
                stem_count INTEGER DEFAULT 0,
                stem_ids TEXT DEFAULT '[]',
                tuning_name TEXT DEFAULT '',
                tuning_sort_key INTEGER DEFAULT 0,
                tuning_offsets TEXT DEFAULT '',
                genre TEXT DEFAULT '',
                track_number INTEGER,
                disc INTEGER
            )
        """)
        # Idempotent migrations for installs that predate each column.
        for ddl in (
            "ALTER TABLE songs ADD COLUMN format TEXT DEFAULT 'archive'",
            "ALTER TABLE songs ADD COLUMN stem_count INTEGER DEFAULT 0",
            # feedBack#129: per-stem filter needs the id list, not just count.
            "ALTER TABLE songs ADD COLUMN stem_ids TEXT DEFAULT '[]'",
            # feedBack#69 + #22: denormalized canonical tuning name + numeric
            # sort key (sum of offsets). The existing `tuning` text column
            # stays — these are caches, repopulated on rescan.
            "ALTER TABLE songs ADD COLUMN tuning_name TEXT DEFAULT ''",
            "ALTER TABLE songs ADD COLUMN tuning_sort_key INTEGER DEFAULT 0",
            # feedBack#867: raw per-string offsets (space-joined ints) so the
            # v3 client can render target notes and the Tuning filter can keep
            # distinct custom tunings distinct (tuning_name collapses them all
            # to "Custom Tuning"). Cache; repopulated on rescan.
            "ALTER TABLE songs ADD COLUMN tuning_offsets TEXT DEFAULT ''",
            # Primary genre from the feedpak `genres` list (spec 1.12.0). Cache;
            # repopulated on rescan.
            "ALTER TABLE songs ADD COLUMN genre TEXT DEFAULT ''",
            # Album track order from the feedpak `track`/`disc` fields (spec
            # 1.12.0). NULL when the pack doesn't author them; the album view
            # falls back to title order. Cache; repopulated on rescan.
            "ALTER TABLE songs ADD COLUMN track_number INTEGER",
            "ALTER TABLE songs ADD COLUMN disc INTEGER",
        ):
            try:
                self.conn.execute(ddl)
            except sqlite3.OperationalError:
                pass
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist COLLATE NOCASE)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title COLLATE NOCASE)")
        # Composite (sort col, filename) indexes cover the grid's ORDER BY +
        # its unique filename tiebreak — for both the OFFSET scan and keyset
        # seek (feedBack#636 item 3). idx_songs_artist/title above stay for the
        # distinct-artist / letter-bar aggregates.
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_artist_fn ON songs(artist COLLATE NOCASE, filename)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_title_fn ON songs(title COLLATE NOCASE, filename)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_mtime_fn ON songs(mtime, filename)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_tuning_name ON songs(tuning_name COLLATE NOCASE)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre COLLATE NOCASE)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_tuning_sort_key ON songs(tuning_sort_key)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_songs_year ON songs(year)")
        self.conn.execute("CREATE TABLE IF NOT EXISTS favorites (filename TEXT PRIMARY KEY)")
        # Personal, per-song metadata that must NEVER travel in the shared
        # feedpak file: a light 1–5 user-difficulty (planning only — distinct
        # from the authored 1–10 difficulty bands) + freeform notes. Likes are
        # NOT here — they stay the existing `favorites` heart (Christian's call).
        # A SEPARATE table (not `songs` columns) so a rescan's
        # `INSERT OR REPLACE INTO songs` can't wipe it; keyed by the same on-disk
        # filename as every other personal table. Additive + idempotent.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS song_user_meta (
                filename TEXT PRIMARY KEY,
                user_difficulty INTEGER,   -- 1..5, NULL = unset
                notes TEXT,
                updated_at TEXT
            )
        """)
        # Free-form personal practice tags ("warm-ups", "riffs to nail") — an
        # intent practice-set primitive (Play-all-over-a-tag comes later). Tags
        # are normalized lowercase on write so "Rock"/"rock" don't split. Peer
        # of song_user_meta; same never-clobber rationale.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS song_tags (
                filename TEXT NOT NULL,
                tag TEXT NOT NULL,
                created_at TEXT,
                PRIMARY KEY (filename, tag)
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_song_tags_tag ON song_tags(tag COLLATE NOCASE)")
        # Per-field metadata OVERRIDES + LOCKS (the Fix-metadata popup). A
        # reversible DISPLAY overlay, never written to the pack: `value` is the
        # user's corrected value for a catalog field (title/artist/album/year/
        # genre), `locked=1` pins the field so a metadata refresh / auto-match
        # never changes what's shown for it (Plex-style field lock). Effective
        # display value = override → matched-MusicBrainz → pack → derived.
        # Filename-keyed → purged with the song on delete_song, NEVER on a
        # rescan (delete_missing), so an edit survives re-import like every other
        # local layer.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS song_field_override (
                filename TEXT NOT NULL,
                field TEXT NOT NULL,        -- title|artist|album|year|genre
                value TEXT,                 -- corrected value (NULL = lock only, no override)
                locked INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT,
                PRIMARY KEY (filename, field)
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_field_override_fn ON song_field_override(filename)")
        # Artist-name aliases (P4): "ACDC" → "AC/DC", "the beatles" → "The Beatles".
        # A CANONICALIZATION OVERRIDE applied AT DISPLAY only — the scanner-derived
        # `songs.artist` and the feedpak files are never rewritten (a rescan can't
        # fight the user; one alias row fixes every matching song at once). Keyed by
        # the raw artist string (COLLATE NOCASE so case variants collapse), so it is
        # NOT filename-keyed → never touched by delete_missing/delete_song (an alias
        # outlives the songs that motivated it, ready for re-import). mb_artist_id is
        # reserved for a future confident MusicBrainz match (unused now).
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS artist_alias (
                raw_name TEXT PRIMARY KEY COLLATE NOCASE,
                canonical_name TEXT NOT NULL,
                mb_artist_id TEXT,
                updated_at TEXT
            )
        """)
        # ── Multi-chart grouping (P5a) ───────────────────────────────────────
        # A "work" is a song that may be charted by several feedpaks; each chart
        # stays its own `songs` row (unchanged), but they GROUP under a shared
        # work_key = normalize(artist+title). Two sparse, never-purged-on-rescan
        # override tables + one MATERIALIZED read-model so the grid can group
        # server-side without a query-time GROUP BY (which would kill the keyset
        # seek / A–Z / virtualization — see query_page).
        #
        # chart_group_pref: your chosen "keeper" chart per work (sparse; unset ⇒
        # auto-pick). Keyed by work_key, NOT filename, so it survives a chart's
        # rescan; an orphaned preferred (file gone) degrades to auto-pick.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS chart_group_pref (
                work_key TEXT PRIMARY KEY,
                preferred_filename TEXT NOT NULL,
                updated_at TEXT
            )
        """)
        # chart_group_split: "these aren't the same song" escape hatch — a chart
        # gets its own unique split_key so it stands alone as a singleton work.
        # Filename-keyed → purged with the song on delete_song.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS chart_group_split (
                filename TEXT PRIMARY KEY,
                split_key TEXT NOT NULL,
                updated_at TEXT
            )
        """)
        # work_display: the MATERIALIZED representative-filter read-model, rebuilt
        # from songs + the two override tables. One row per song:
        #   effective_work_key    = split_key if split else work_key
        #   is_group_representative = 1 for the keeper (pref or auto-pick) of a work
        #   group_size            = the ⚑ N charts in the work
        # Grouping-ON is then just `WHERE is_group_representative = 1` (keyset-safe).
        # A derived cache: filename-keyed, rebuilt on demand (dirty flag) — safe to
        # drop/rebuild, so it's purged on delete and re-materialized after a scan.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS work_display (
                filename TEXT PRIMARY KEY,
                work_key TEXT NOT NULL,
                effective_work_key TEXT NOT NULL,
                is_group_representative INTEGER NOT NULL DEFAULT 1,
                group_size INTEGER NOT NULL DEFAULT 1
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_work_display_rep ON work_display(is_group_representative)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_work_display_eff ON work_display(effective_work_key)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_work_display_wk ON work_display(work_key)")
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS loops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                name TEXT NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # fee[dB]ack v0.3.0 — single-user player profile (id=1), streak, and the
        # unified XP store. Peers of favorites/loops; additive + idempotent.
        # `player_hash` is a future-leaderboard identity label (SHA-256 of the
        # first display name + a once-generated salt), never an auth credential.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                display_name TEXT,
                avatar_path TEXT,
                player_hash TEXT,
                player_salt TEXT,
                onboarded INTEGER NOT NULL DEFAULT 0,
                created_at TEXT
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS profile_progress (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                current_streak INTEGER NOT NULL DEFAULT 0,
                best_streak INTEGER NOT NULL DEFAULT 0,
                last_active_date TEXT          -- YYYY-MM-DD (local)
            )
        """)
        # Unified XP store: the single source of truth the profile badge reads.
        # Song-play, minigames, and tutorials all feed THIS via award_xp() — no
        # second XP curve (lib/xp.py owns the math).
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS xp_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                xp INTEGER NOT NULL DEFAULT 0,
                total_awards INTEGER NOT NULL DEFAULT 0,
                minigames_seeded INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT
            )
        """)
        # Per-source XP ledger: the unified `xp` total above is a single number,
        # but a source (minigames, tutorials, song-play, …) needs to know its own
        # contribution so it can be reset/reversed independently (a minigames
        # profile-reset must subtract only its share, not song-play XP).
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS xp_sources (
                source TEXT PRIMARY KEY,
                xp INTEGER NOT NULL DEFAULT 0
            )
        """)
        # Per-song/arrangement practice stats (best score + accuracy, plays,
        # last position for Continue-Playing). Fed by the highway note-detection
        # scorer via POST /api/stats. Additive + idempotent; a 0.2.9 build
        # tolerates it and the new build opens an old db without it.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS song_stats (
                filename TEXT NOT NULL,
                arrangement INTEGER NOT NULL DEFAULT 0,
                plays INTEGER NOT NULL DEFAULT 0,
                best_score INTEGER NOT NULL DEFAULT 0,
                best_accuracy REAL NOT NULL DEFAULT 0,
                last_score INTEGER NOT NULL DEFAULT 0,
                last_accuracy REAL NOT NULL DEFAULT 0,
                last_position REAL NOT NULL DEFAULT 0,
                last_played_at TEXT,
                updated_at TEXT,
                PRIMARY KEY (filename, arrangement)
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_song_stats_recent ON song_stats(last_played_at DESC)")
        # Playlists + the reserved "Saved for Later" system playlist. Additive.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                system_key TEXT,            -- 'saved_for_later' for reserved playlists, else NULL
                created_at TEXT,
                updated_at TEXT
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS playlist_songs (
                playlist_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (playlist_id, filename)
            )
        """)
        self.conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_system_key ON playlists(system_key) WHERE system_key IS NOT NULL")
        # Smart collections (feedBack#636 item 2): a playlist row whose `rules`
        # JSON is non-NULL is a smart/dynamic collection — its membership is the
        # LIVE result of those library filter params, not a stored song list.
        # It surfaces as a registered library provider (the v3 source picker),
        # so it inherits the whole Songs UI. Additive, idempotent migration.
        try:
            self.conn.execute("ALTER TABLE playlists ADD COLUMN rules TEXT")
        except sqlite3.OperationalError:
            pass
        # Curated album (P6, metadata-design §7.2): a playlists row with
        # kind='album' is a hand-picked, ORDERED practice set of works with a
        # chosen chart per slot — the repeatable gameplay loop. Reuses the
        # playlist machinery wholesale (membership/order/cover/queue); the whole
        # schema delta is this `kind` discriminator plus two per-slot columns:
        # `arrangement` = the pinned arrangement NAME (names survive rescans;
        # the client resolves name→index at play), `work_key` = stamped at
        # add-time so a slot whose pinned chart is later deleted can self-heal
        # to the work's CURRENT preferred at read (never rewritten). Additive,
        # idempotent — same pattern as `rules` above.
        for _ddl in ("ALTER TABLE playlists ADD COLUMN kind TEXT",
                     "ALTER TABLE playlist_songs ADD COLUMN arrangement TEXT",
                     "ALTER TABLE playlist_songs ADD COLUMN work_key TEXT"):
            try:
                self.conn.execute(_ddl)
            except sqlite3.OperationalError:
                pass
        # Wishlist / "wanted" (feedBack#636 item 4): a persisted, actionable
        # list of songs the user does NOT own yet — the *arr "Wanted/Monitored"
        # analogue. Unlike playlists (which reference owned local songs by
        # filename), a wanted entry has no local file, so it lives in its own
        # table keyed by descriptive identity. Producers (the find_more plugin's
        # ownership-diff, or a manual add) POST here; the consuming UI reads it.
        # Additive + idempotent.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS wanted (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                artist TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '',      -- e.g. 'find_more', 'manual'
                source_ref TEXT NOT NULL DEFAULT '',  -- opaque id/url within that source
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT
            )
        """)
        # Identity = (artist, title, source, source_ref), case-insensitive on
        # the human fields, so re-running an ownership-diff doesn't duplicate.
        self.conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_wanted_identity "
            "ON wanted(artist COLLATE NOCASE, title COLLATE NOCASE, source, source_ref)"
        )
        # Metadata-enrichment cache (P7, library-metadata design §4/§5/§6): one
        # row per song holding its match lifecycle + the canonical values a
        # confident match supplies. A CACHE/OVERRIDE layer — canonical values
        # are displayed, NEVER auto-written into the pack file. Never purged on
        # rescan (only by the explicit per-song delete); re-derivable, so a lost
        # row just re-enriches. `content_hash` keys the row to the metadata a
        # match depends on (normalized artist|title|album|duration — NOT the
        # filename), which makes enrichment idempotent AND rename-survivable.
        # match_state lifecycle: unscanned → matched(source,score) | manual |
        # failed. A `manual` row is the user's pinned pick — NEVER auto-reset;
        # `failed` retries on backoff via `attempts` (the matcher, P8, owns
        # that policy). Additive + idempotent.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS song_enrichment (
                filename TEXT PRIMARY KEY,
                content_hash TEXT,
                match_state TEXT NOT NULL DEFAULT 'unscanned',
                match_source TEXT,
                match_score REAL,
                attempts INTEGER NOT NULL DEFAULT 0,
                mb_recording_id TEXT,
                mb_release_id TEXT,
                mb_artist_id TEXT,
                isrc TEXT,
                canon_artist TEXT,
                canon_album TEXT,
                canon_title TEXT,
                canon_year TEXT,
                canon_artist_sort TEXT,
                genres TEXT,
                art_cache_path TEXT,
                art_state TEXT,
                fetched_at TEXT
            )
        """)
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_enrichment_hash ON song_enrichment(content_hash)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_enrichment_state ON song_enrichment(match_state)")
        # P8 (the matcher): `candidates` holds the review tier's ranked
        # candidate list (JSON) so the Match-Review drawer never re-queries
        # MusicBrainz just to render; `last_attempt_at` anchors the failed-row
        # retry backoff (epoch seconds). Idempotent ALTERs, same pattern as
        # the `songs` migrations above.
        # R1 scraper options: `apply_mask` records which per-field auto-apply
        # toggles were OFF (suppressed) when an AUTOMATIC match settled the row,
        # as a canonical sorted comma-joined marker of blocked keys (''/NULL =
        # nothing suppressed). It keeps the per-field toggles to the same
        # "nothing forfeited" contract as the source/art toggles: re-enabling a
        # field re-queues affected `matched` rows for backfill (enrichment_pending)
        # and a partially-applied row is barred from seeding siblings
        # (enrichment_cache_lookup). Idempotent ALTER, same pattern as above.
        for ddl in (
            "ALTER TABLE song_enrichment ADD COLUMN candidates TEXT",
            "ALTER TABLE song_enrichment ADD COLUMN last_attempt_at REAL",
            "ALTER TABLE song_enrichment ADD COLUMN apply_mask TEXT",
        ):
            try:
                self.conn.execute(ddl)
            except sqlite3.OperationalError:
                pass
        # Artist-level enrichment cache (artist pages, launch charrette §5):
        # ONE row per matched MusicBrainz artist holding the whitelisted
        # url-relations (external links) + MB genres from a single throttled
        # artist lookup, fetched lazily on the first artist-page links request
        # and refreshed only on demand. Keyed by mb_artist_id (NOT the display
        # name), so alias merges / renames never orphan it. Never purged on
        # rescan — like song_enrichment, it is re-derivable but expensive
        # (rate-limited) to re-fetch. Additive + idempotent.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS artist_enrichment (
                mb_artist_id TEXT PRIMARY KEY,
                url_rels TEXT,
                genres TEXT,
                fetched_at TEXT
            )
        """)
        # Progression (spec 010): instrument paths, challenges, quests, the
        # Decibels wallet, and the cosmetics shop. Targets/titles live in the
        # bundled content (data/progression/); these tables hold only player
        # state (counters, completion timestamps, spend, ownership) so content
        # edits update live displays without migrations. Additive + idempotent.
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS progression_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                calibration_status TEXT NOT NULL DEFAULT 'pending',  -- pending|completed|skipped
                calibration_completed_at TEXT,
                created_at TEXT
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS player_paths (
                path_id TEXT PRIMARY KEY,          -- 'guitar' | 'bass' | 'drums' | future
                level INTEGER NOT NULL DEFAULT 0,
                selected_at TEXT
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS challenge_progress (
                challenge_id TEXT PRIMARY KEY,     -- namespaced 'guitar.l1.clean-run'
                path_id TEXT NOT NULL,
                level INTEGER NOT NULL,            -- the level whose set this belongs to
                count INTEGER NOT NULL DEFAULT 0,
                progress_detail TEXT,              -- JSON, e.g. {"seen": [...]} for distinct goals
                completed_at TEXT
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS quest_state (
                period_type TEXT NOT NULL,         -- 'daily' | 'weekly'
                period_key TEXT NOT NULL,          -- '2026-06-12' | '2026-W24'
                quest_id TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                reward_db INTEGER NOT NULL DEFAULT 0,  -- snapshot at instantiation
                progress_detail TEXT,
                completed_at TEXT,
                PRIMARY KEY (period_type, period_key, quest_id)
            )
        """)
        # Spend is tracked separately from xp_profile.xp on purpose: the xp
        # total stays the monotonic lifetime-earned stat (db_earned goals,
        # xp_sources reset semantics) and balance = MAX(0, xp - spent).
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS wallet (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                spent INTEGER NOT NULL DEFAULT 0
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS shop_owned (
                item_id TEXT PRIMARY KEY,
                cost_paid INTEGER NOT NULL DEFAULT 0,
                acquired_at TEXT
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS shop_equipped (
                slot TEXT PRIMARY KEY,             -- 'theme' | 'avatar_frame'
                item_id TEXT
            )
        """)
        # Ensure the singleton rows exist so reads never special-case "no row".
        self.conn.execute("INSERT OR IGNORE INTO profile (id, onboarded, created_at) VALUES (1, 0, datetime('now'))")
        self.conn.execute("INSERT OR IGNORE INTO profile_progress (id) VALUES (1)")
        self.conn.execute("INSERT OR IGNORE INTO xp_profile (id, xp, total_awards, updated_at) VALUES (1, 0, 0, datetime('now'))")
        self.conn.execute("INSERT OR IGNORE INTO progression_state (id, created_at) VALUES (1, datetime('now'))")
        self.conn.execute("INSERT OR IGNORE INTO wallet (id) VALUES (1)")
        self.conn.commit()
        self._lock = threading.Lock()
        # work_display (P5a) is a derived cache; True forces a (re)build on the
        # first grouped query and after any songs churn (put / delete / rescan).
        self._work_display_dirty = True
        # One-time repair of pre-fix rows written under URL-encoded filenames
        # (idempotent: a no-op once every row is canonical).
        self._migrate_decode_stat_filenames()

    def _song_exists(self, filename: str) -> bool:
        return self.conn.execute(
            "SELECT 1 FROM songs WHERE filename = ?", (filename,)).fetchone() is not None

    def _canonical_song_filename(self, filename: str) -> str:
        """Map a (possibly URL-encoded) filename to the `songs` library key.

        The recorder relays encodeURIComponent'd names ('/'→'%2F', ' '→'%20'),
        but `songs` keys on the decoded on-disk path. Decoding is LIBRARY-AWARE so
        a real filename that legitimately contains literal %XX is never corrupted:
        prefer the form that already exists in `songs`, and decode only when the
        decoded form resolves to a real song. When NEITHER form is in the library
        (e.g. a play recorded before the library scan finishes) keep the stored
        name unchanged — the next-startup migration canonicalizes it once the song
        is scanned, rather than risk corrupting a real %XX name now."""
        if not isinstance(filename, str):
            return filename
        if self._song_exists(filename):
            return filename                      # already a real library key (may contain %)
        from urllib.parse import unquote
        decoded = unquote(filename)
        if decoded != filename and self._song_exists(decoded):
            return decoded                       # encoded → real library key
        return filename                          # neither in library: leave as-is (heals on migrate)

    def _migrate_decode_stat_filenames(self):
        """Rewrite URL-encoded song_stats.filename rows to the decoded
        library-path key (the form `songs` uses). Pre-fix, the recorder stored
        encodeURIComponent'd names, so every recorded best was invisible to the
        reads that filter on `filename IN (SELECT filename FROM songs)`. Merge on
        collision — two encoded rows decoding to the same name, or an encoded row
        meeting an already-decoded one — with the same best=max / plays=sum /
        last-wins semantics as song_score.merge_stats, so the (filename,
        arrangement) primary key is never violated.

        Library-aware via the shared _canonical_song_filename rule: only decode a
        row when the decoded form is a real song, so a correctly-stored name
        containing literal %XX is never rewritten, and dead-song/orphan rows
        (neither form in the library) are left exactly as-is."""
        cols = self._STATS_COLS
        with self._lock:
            rows = [dict(zip(cols, r)) for r in self.conn.execute(
                "SELECT " + ", ".join(cols) + " FROM song_stats").fetchall()]
            canon = self._canonical_song_filename
            if all(canon(r["filename"]) == r["filename"] for r in rows):
                return  # every row already canonical (or an untouchable orphan)
            merged: dict = {}
            for r in rows:
                key = (canon(r["filename"]), int(r["arrangement"]))
                cur = merged.get(key)
                if cur is None:
                    merged[key] = dict(r, filename=key[0], arrangement=key[1])
                    continue
                # Most-recently-updated row wins the "last_*"/position fields.
                def _stamp(x):
                    return str(x.get("updated_at") or x.get("last_played_at") or "")
                newer = r if _stamp(r) >= _stamp(cur) else cur
                merged[key] = {
                    "filename": key[0], "arrangement": key[1],
                    "plays": (cur["plays"] or 0) + (r["plays"] or 0),
                    "best_score": max(cur["best_score"] or 0, r["best_score"] or 0),
                    "best_accuracy": max(cur["best_accuracy"] or 0.0, r["best_accuracy"] or 0.0),
                    "last_score": newer["last_score"], "last_accuracy": newer["last_accuracy"],
                    "last_position": newer["last_position"],
                    "last_played_at": newer["last_played_at"], "updated_at": newer["updated_at"],
                }
            # Atomic swap: clear and reinsert the canonicalized set in one txn.
            try:
                self.conn.execute("DELETE FROM song_stats")
                self.conn.executemany(
                    "INSERT INTO song_stats (" + ", ".join(cols) + ") VALUES ("
                    + ", ".join("?" * len(cols)) + ")",
                    [tuple(m[c] for c in cols) for m in merged.values()],
                )
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise

    def get(self, filename: str, mtime: float, size: int) -> dict | None:
        cache_key = str(filename)
        with self._lock:
            row = self.conn.execute(
                "SELECT mtime, size, title, artist, album, year, duration, tuning, arrangements, has_lyrics, "
                "format, stem_count, stem_ids, tuning_name, tuning_sort_key, tuning_offsets "
                "FROM songs WHERE filename = ?", (cache_key,)
            ).fetchone()
        if row and row[0] == mtime and row[1] == size and row[2]:
            return {
                "title": row[2], "artist": row[3], "album": row[4],
                "year": row[5], "duration": row[6], "tuning": row[7],
                "arrangements": json.loads(row[8]) if row[8] else [],
                "has_lyrics": bool(row[9]),
                "format": row[10] or "archive",
                "stem_count": int(row[11] or 0),
                "stem_ids": json.loads(row[12]) if row[12] else [],
                "tuning_name": row[13] or "",
                "tuning_sort_key": int(row[14] or 0),
                "tuning_offsets": row[15] or "",
            }
        return None

    def put(self, filename: str, mtime: float, size: int, meta: dict):
        with self._lock:
            self.conn.execute(
                "INSERT OR REPLACE INTO songs "
                "(filename, mtime, size, title, artist, album, year, duration, tuning, arrangements, "
                "has_lyrics, format, stem_count, stem_ids, tuning_name, tuning_sort_key, tuning_offsets, genre, track_number, disc) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (filename, mtime, size, meta.get("title", ""), meta.get("artist", ""),
                 meta.get("album", ""), meta.get("year", ""), meta.get("duration", 0),
                 meta.get("tuning", ""), json.dumps(meta.get("arrangements", [])),
                 1 if meta.get("has_lyrics") else 0,
                 meta.get("format", "archive"),
                 int(meta.get("stem_count", 0) or 0),
                 json.dumps(meta.get("stem_ids", []) or []),
                 meta.get("tuning_name", "") or "",
                 int(meta.get("tuning_sort_key", 0) or 0),
                 meta.get("tuning_offsets", "") or "",
                 meta.get("genre", "") or "",
                 meta.get("track_number"),
                 meta.get("disc")),
            )
            self.conn.commit()
            # A song's identity may have changed → the grouping read-model is stale.
            self._work_display_dirty = True

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM songs WHERE title != ''").fetchone()[0]

    def delete_missing(self, current_filenames: set[str]):
        """Remove `songs` rows for files no longer on disk.

        Deliberately does NOT purge song_stats / playlist_songs here: a scan is a
        point-in-time snapshot, so a song that briefly disappears mid-scan (e.g.
        a directory-form .sloppak being overwritten via rmtree-then-extract, or a
        delete+reupload) and returns under the same filename would otherwise lose
        its stats/playlist membership permanently. Instead, stats are purged on
        the EXPLICIT delete path (DELETE /api/song) and dead-song rows are
        filtered at read time (recent_stats / continue_session /
        best_accuracy_map gate on the song still existing)."""
        with self._lock:
            db_files = {r[0] for r in self.conn.execute("SELECT filename FROM songs").fetchall()}
            stale = db_files - current_filenames
            if stale:
                self.conn.executemany("DELETE FROM songs WHERE filename = ?", [(f,) for f in stale])
                self.conn.commit()
                self._work_display_dirty = True   # membership changed → regroup
            # Report both deltas from the one query we already ran: rows pruned,
            # and how many current files are genuinely new (not yet in the DB),
            # so a scan can surface an "N added / M removed" summary.
            return {"removed": len(stale), "added": len(current_filenames - db_files)}
