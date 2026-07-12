# Gamification and practice history: player profile, unified XP store,
# streaks, progression (paths/challenges/quests/wallet/shop), per-song
# practice stats, recommenders, and the Continue-Playing session.

import hashlib
import json
import secrets

from .helpers import MASTERY_ACCURACY, _as_int

class GamificationMixin:
    # ── Player profile (fee[dB]ack v0.3.0) ─────────────────────────────────
    def get_profile(self) -> dict:
        row = self.conn.execute(
            "SELECT display_name, avatar_path, player_hash, onboarded FROM profile WHERE id = 1"
        ).fetchone()
        if not row:
            return {"display_name": None, "avatar_url": None, "player_hash": None, "onboarded": False}
        return {
            "display_name": row[0],
            "avatar_url": row[1],
            "player_hash": row[2],
            "onboarded": bool(row[3]),
        }

    def set_profile(self, display_name: str, avatar_url: str | None) -> dict:
        """Set/update the display name (+ avatar). Computes player_hash ONCE
        from the first name + a stored random salt; it stays stable across
        later name changes. Marks onboarded=1."""
        with self._lock:
            cur = self.conn.execute(
                "SELECT player_hash, player_salt FROM profile WHERE id = 1"
            ).fetchone()
            player_hash = cur[0] if cur else None
            salt = cur[1] if cur else None
            if not player_hash:
                salt = secrets.token_hex(16)
                player_hash = hashlib.sha256((display_name + salt).encode("utf-8")).hexdigest()
            self.conn.execute(
                "UPDATE profile SET display_name = ?, "
                "avatar_path = COALESCE(?, avatar_path), "
                "player_hash = ?, player_salt = ?, onboarded = 1 WHERE id = 1",
                (display_name, avatar_url, player_hash, salt),
            )
            self.conn.commit()
        return self.get_profile()

    # ── Unified XP store ────────────────────────────────────────────────────
    def get_xp(self) -> int:
        row = self.conn.execute("SELECT xp FROM xp_profile WHERE id = 1").fetchone()
        return int(row[0]) if row else 0

    def award_xp(self, amount: int, source: str | None = None) -> int:
        """Add XP to the unified store; returns the new total. `amount` may be
        NEGATIVE — used internally to REVERSE a failed award (the total and the
        per-source bucket both clamp at 0). `source` (when given) is tracked in
        the xp_sources ledger so it can be reset independently.

        Service boundary: the plugin hook (context["award_xp"]) passes this
        straight through, so coerce defensively — bad input (bool, NaN/Inf,
        non-integral, out-of-int64-range) must neither raise NOR mutate state.
        _as_int rejects bool/non-integral; bad → no-op (0)."""
        try:
            amount = _as_int(amount)
        except (TypeError, ValueError, OverflowError):
            amount = 0
        amount = max(-10_000_000, min(amount, 10_000_000))
        with self._lock:
            # MAX(0, …) clamps the result so a reversal can't drive XP negative.
            self.conn.execute(
                "UPDATE xp_profile SET xp = MAX(0, xp + ?), "
                "total_awards = total_awards + ?, updated_at = datetime('now') WHERE id = 1",
                (amount, 1 if amount > 0 else 0),
            )
            if source:
                self.conn.execute(
                    "INSERT INTO xp_sources (source, xp) VALUES (?, MAX(0, ?)) "
                    "ON CONFLICT(source) DO UPDATE SET xp = MAX(0, xp + ?)",
                    (source, amount, amount),
                )
            self.conn.commit()
            row = self.conn.execute("SELECT xp FROM xp_profile WHERE id = 1").fetchone()
        return int(row[0]) if row else 0

    def reset_source_xp(self, source: str) -> dict:
        """Subtract a single source's tracked contribution from the unified
        total and zero its bucket (e.g. a minigames profile-reset removes only
        minigames XP, leaving song-play/tutorials XP intact). Returns progress."""
        with self._lock:
            row = self.conn.execute("SELECT xp FROM xp_sources WHERE source = ?", (source,)).fetchone()
            amt = int(row[0]) if row and row[0] else 0
            if amt:
                self.conn.execute(
                    "UPDATE xp_profile SET xp = MAX(0, xp - ?), updated_at = datetime('now') WHERE id = 1",
                    (amt,),
                )
            self.conn.execute("UPDATE xp_sources SET xp = 0 WHERE source = ?", (source,))
            self.conn.commit()
        return self.get_progress()

    def seed_xp_once(self, amount: int, marker: str = "minigames") -> bool:
        """One-time seed of the unified store from a pre-unification source
        (e.g. the minigames plugin's profile.json), so existing earned XP is
        preserved. No-ops if already seeded or the store already has XP.
        Returns True if it seeded."""
        # Same no-raise / no-silent-mutate contract as award_xp(): this is a
        # plugin-facing service (context["seed_xp"]). _as_int rejects bool /
        # non-integral; bad input becomes a 0 (no-op) seed rather than raising.
        try:
            amount = _as_int(amount)
        except (TypeError, ValueError, OverflowError):
            amount = 0
        amount = max(0, min(amount, 10_000_000))
        if marker != "minigames":
            return False
        with self._lock:
            row = self.conn.execute(
                "SELECT xp, minigames_seeded FROM xp_profile WHERE id = 1"
            ).fetchone()
            xp_now, seeded = (row[0], row[1]) if row else (0, 0)
            if seeded or xp_now > 0 or amount <= 0:
                if not seeded:
                    self.conn.execute("UPDATE xp_profile SET minigames_seeded = 1 WHERE id = 1")
                    self.conn.commit()
                return False
            self.conn.execute(
                "UPDATE xp_profile SET xp = ?, minigames_seeded = 1, updated_at = datetime('now') WHERE id = 1",
                (amount,),
            )
            # Record the seeded amount in the source ledger too, so a later
            # minigames reset subtracts the migrated XP rather than orphaning it.
            self.conn.execute(
                "INSERT INTO xp_sources (source, xp) VALUES (?, ?) "
                "ON CONFLICT(source) DO UPDATE SET xp = xp + ?",
                (marker, amount, amount),
            )
            self.conn.commit()
        return True

    # ── Streak ──────────────────────────────────────────────────────────────
    def record_active_day(self, today: str) -> dict:
        """Mark `today` (YYYY-MM-DD, local) as an active day. Any session on a
        calendar day keeps the streak: yesterday→+1, today→unchanged, gap or
        first-ever→reset to 1. Updates best_streak."""
        from datetime import date, timedelta
        with self._lock:
            row = self.conn.execute(
                "SELECT current_streak, best_streak, last_active_date FROM profile_progress WHERE id = 1"
            ).fetchone()
            cur, best, last = (row[0], row[1], row[2]) if row else (0, 0, None)
            if last != today:
                try:
                    yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
                except ValueError:
                    yesterday = None
                cur = cur + 1 if (last and last == yesterday) else 1
                best = max(best or 0, cur)
                self.conn.execute(
                    "UPDATE profile_progress SET current_streak = ?, best_streak = ?, last_active_date = ? WHERE id = 1",
                    (cur, best, today),
                )
                self.conn.commit()
                last = today
        return {"current_streak": cur, "best_streak": best, "last_active_date": last}

    def get_progress(self) -> dict:
        """The full profile-badge payload: XP/level (lib/xp) + streak."""
        from xp import progress as _xp_progress
        p = self.conn.execute(
            "SELECT current_streak, best_streak, last_active_date FROM profile_progress WHERE id = 1"
        ).fetchone()
        cur, best, last = (p[0], p[1], p[2]) if p else (0, 0, None)
        out = _xp_progress(self.get_xp())
        out.update({"current_streak": cur, "best_streak": best, "last_active_date": last})
        return out

    # ── Progression (spec 010): paths, challenges, quests, wallet, shop ────
    # Lock discipline: self._lock is NOT reentrant and award_xp() takes it, so
    # record_progression_event() applies state inside the lock but awards quest
    # dB (and re-enters for quest_completed goals) only after releasing it.

    def get_progression_state(self) -> dict:
        row = self.conn.execute(
            "SELECT calibration_status, calibration_completed_at FROM progression_state WHERE id = 1"
        ).fetchone()
        status = row[0] if row else "pending"
        return {"calibration_status": status, "calibration_completed_at": row[1] if row else None}

    def skip_calibration(self) -> dict:
        """pending → skipped (no-op once completed/skipped). Either way the
        player holds onboarding rank 1 afterwards."""
        with self._lock:
            self.conn.execute(
                "UPDATE progression_state SET calibration_status = 'skipped' "
                "WHERE id = 1 AND calibration_status = 'pending'"
            )
            self.conn.commit()
        return self.get_progression_state()

    def get_player_paths(self) -> dict:
        """{path_id: level} for every selected path."""
        rows = self.conn.execute("SELECT path_id, level FROM player_paths").fetchall()
        return {r[0]: int(r[1]) for r in rows}

    def add_player_paths(self, path_ids) -> dict:
        """Select paths (idempotent; re-adding never resets a level)."""
        with self._lock:
            for pid in path_ids:
                self.conn.execute(
                    "INSERT OR IGNORE INTO player_paths (path_id, level, selected_at) "
                    "VALUES (?, 0, datetime('now'))",
                    (pid,),
                )
            self.conn.commit()
        return self.get_player_paths()

    def get_challenge_state(self) -> dict:
        """{challenge_id: {count, completed, detail}} for every touched challenge."""
        rows = self.conn.execute(
            "SELECT challenge_id, count, progress_detail, completed_at FROM challenge_progress"
        ).fetchall()
        out = {}
        for cid, count, detail, completed_at in rows:
            try:
                parsed = json.loads(detail) if detail else None
            except (ValueError, TypeError):
                parsed = None
            out[cid] = {
                "count": int(count or 0),
                "completed": completed_at is not None,
                "completed_at": completed_at,
                "detail": parsed,
            }
        return out

    def ensure_quest_period(self, content, now) -> None:
        """Lazily instantiate the current daily/weekly quest rows (deterministic
        per period key; rewards snapshot so live quests survive content edits)."""
        import progression as progression_mod
        keys = progression_mod.period_keys(now)
        with self._lock:
            for period_type in ("daily", "weekly"):
                cfg = (content.get("quests") or {}).get(period_type) or {}
                pool = cfg.get("pool") or {}
                count = int(cfg.get("count") or 0)
                if not pool or count < 1:
                    continue
                key = keys[period_type]
                exists = self.conn.execute(
                    "SELECT 1 FROM quest_state WHERE period_type = ? AND period_key = ? LIMIT 1",
                    (period_type, key),
                ).fetchone()
                if exists:
                    continue
                for qid in progression_mod.select_quests(pool.keys(), period_type, key, count):
                    self.conn.execute(
                        "INSERT OR IGNORE INTO quest_state "
                        "(period_type, period_key, quest_id, reward_db) VALUES (?, ?, ?, ?)",
                        (period_type, key, qid, int(pool[qid].get("reward_db") or 0)),
                    )
            self.conn.commit()

    def get_quest_rows(self, period_keys_map: dict) -> list:
        """Current-period quest instances as snapshot/API rows."""
        out = []
        for period_type, key in period_keys_map.items():
            rows = self.conn.execute(
                "SELECT quest_id, count, reward_db, progress_detail, completed_at "
                "FROM quest_state WHERE period_type = ? AND period_key = ? ORDER BY quest_id",
                (period_type, key),
            ).fetchall()
            for qid, count, reward, detail, completed_at in rows:
                try:
                    parsed = json.loads(detail) if detail else None
                except (ValueError, TypeError):
                    parsed = None
                out.append({
                    "period_type": period_type,
                    "period_key": key,
                    "quest_id": qid,
                    "count": int(count or 0),
                    "reward_db": int(reward or 0),
                    "detail": parsed,
                    "completed": completed_at is not None,
                    "completed_at": completed_at,
                })
        return out

    def get_wallet(self) -> dict:
        """{balance, lifetime_db, spent} — see the wallet table comment for
        why spend never mutates xp_profile.xp."""
        import progression as progression_mod
        row = self.conn.execute("SELECT spent FROM wallet WHERE id = 1").fetchone()
        spent = int(row[0]) if row and row[0] else 0
        lifetime = self.get_xp()
        return {
            "balance": progression_mod.wallet_balance(lifetime, spent),
            "lifetime_db": lifetime,
            "spent": spent,
        }

    def buy_shop_item(self, item: dict) -> tuple:
        """Atomic purchase: balance check + spend + ownership in one
        transaction. Returns ("ok"|"owned"|"insufficient", wallet)."""
        with self._lock:
            owned = self.conn.execute(
                "SELECT 1 FROM shop_owned WHERE item_id = ?", (item["id"],)
            ).fetchone()
            if owned:
                status = "owned"
            else:
                xp_row = self.conn.execute("SELECT xp FROM xp_profile WHERE id = 1").fetchone()
                spent_row = self.conn.execute("SELECT spent FROM wallet WHERE id = 1").fetchone()
                balance = max(0, int(xp_row[0] if xp_row else 0) - int(spent_row[0] if spent_row else 0))
                cost = int(item.get("cost") or 0)
                if cost < 0:
                    status = "invalid"
                elif balance < cost:
                    status = "insufficient"
                else:
                    self.conn.execute(
                        "UPDATE wallet SET spent = spent + ? WHERE id = 1", (cost,)
                    )
                    self.conn.execute(
                        "INSERT INTO shop_owned (item_id, cost_paid, acquired_at) "
                        "VALUES (?, ?, datetime('now'))",
                        (item["id"], cost),
                    )
                    self.conn.commit()
                    status = "ok"
        return status, self.get_wallet()

    def get_owned_items(self) -> dict:
        rows = self.conn.execute(
            "SELECT item_id, cost_paid, acquired_at FROM shop_owned"
        ).fetchall()
        return {r[0]: {"cost_paid": int(r[1] or 0), "acquired_at": r[2]} for r in rows}

    def get_equipped(self) -> dict:
        rows = self.conn.execute("SELECT slot, item_id FROM shop_equipped").fetchall()
        return {r[0]: r[1] for r in rows if r[1]}

    def equip_item(self, slot: str, item_id) -> dict:
        """Equip an owned item into a slot (item_id=None unequips)."""
        with self._lock:
            if item_id is None:
                self.conn.execute("DELETE FROM shop_equipped WHERE slot = ?", (slot,))
            else:
                self.conn.execute(
                    "INSERT INTO shop_equipped (slot, item_id) VALUES (?, ?) "
                    "ON CONFLICT(slot) DO UPDATE SET item_id = excluded.item_id",
                    (slot, item_id),
                )
            self.conn.commit()
        return self.get_equipped()

    def progression_snapshot(self, content, now) -> dict:
        """The plain-dict state view lib/progression.evaluate_event reads."""
        import progression as progression_mod
        keys = progression_mod.period_keys(now)
        streak_row = self.conn.execute(
            "SELECT current_streak FROM profile_progress WHERE id = 1"
        ).fetchone()
        return {
            "calibration_status": self.get_progression_state()["calibration_status"],
            "paths": self.get_player_paths(),
            "challenges": self.get_challenge_state(),
            "quests": self.get_quest_rows(keys),
            "streak": int(streak_row[0]) if streak_row and streak_row[0] else 0,
            "xp_total": self.get_xp(),
        }

    def record_progression_event(self, event_type: str, payload, content,
                                 now=None, _depth: int = 0) -> dict:
        """The single progression choke point: evaluate one event, persist the
        deltas, award quest dB, and re-enter once for quest_completed goals.
        Returns a toast-ready summary."""
        import progression as progression_mod
        from datetime import datetime as _dt
        now = now or _dt.now()
        self.ensure_quest_period(content, now)
        snapshot = self.progression_snapshot(content, now)
        outcome = progression_mod.evaluate_event(
            {"type": event_type, "payload": payload or {}}, content, snapshot
        )
        keys = progression_mod.period_keys(now)
        challenge_index = content.get("challenge_index") or {}
        quest_pools = content.get("quests") or {}

        summary = {
            "challenges_completed": [],
            "quests_completed": [],
            "level_ups": list(outcome["level_ups"]),
            "calibration_completed": bool(outcome["calibration_completed"]),
        }
        with self._lock:
            for ch in outcome["challenges"]:
                detail = json.dumps(ch["detail"]) if ch.get("detail") else None
                self.conn.execute(
                    "INSERT INTO challenge_progress "
                    "(challenge_id, path_id, level, count, progress_detail, completed_at) "
                    "VALUES (?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END) "
                    "ON CONFLICT(challenge_id) DO UPDATE SET "
                    "count = excluded.count, progress_detail = excluded.progress_detail, "
                    "completed_at = COALESCE(challenge_progress.completed_at, excluded.completed_at)",
                    (ch["challenge_id"], ch["path_id"], ch["level"], ch["count"],
                     detail, 1 if ch["completed"] else 0),
                )
                if ch["completed"]:
                    info = challenge_index.get(ch["challenge_id"]) or {}
                    title = (info.get("challenge") or {}).get("title") or ch["challenge_id"]
                    summary["challenges_completed"].append(
                        {"id": ch["challenge_id"], "title": title, "path_id": ch["path_id"]}
                    )
            for lu in outcome["level_ups"]:
                # Guard on the old level so a stale evaluation can't double-bump.
                self.conn.execute(
                    "UPDATE player_paths SET level = ? WHERE path_id = ? AND level = ?",
                    (lu["new_level"], lu["path_id"], lu["new_level"] - 1),
                )
            # Only quests whose row actually TRANSITIONED to completed in this
            # call get rewarded/re-entered. The pure outcome was computed from
            # a pre-lock snapshot, so a concurrent event may have completed the
            # same quest first — its guarded UPDATE (completed_at IS NULL)
            # then touches 0 rows here, and paying it again would double-award
            # Decibels and double-advance quest_completed challenges.
            newly_completed_quests = []
            for q in outcome["quests"]:
                detail = json.dumps(q["detail"]) if q.get("detail") else None
                cur = self.conn.execute(
                    "UPDATE quest_state SET count = ?, progress_detail = ?, "
                    "completed_at = COALESCE(completed_at, CASE WHEN ? THEN datetime('now') END) "
                    "WHERE period_type = ? AND period_key = ? AND quest_id = ? AND completed_at IS NULL",
                    (q["count"], detail, 1 if q["completed"] else 0,
                     q["period_type"], keys.get(q["period_type"], ""), q["quest_id"]),
                )
                if q["completed"] and cur.rowcount > 0:
                    newly_completed_quests.append(q)
            if outcome["calibration_completed"]:
                self.conn.execute(
                    "UPDATE progression_state SET calibration_status = 'completed', "
                    "calibration_completed_at = datetime('now') "
                    "WHERE id = 1 AND calibration_status != 'completed'"
                )
            self.conn.commit()

        # Quest awards + bounded re-entry, outside the lock (award_xp locks).
        for q in newly_completed_quests:
            pool = (quest_pools.get(q["period_type"]) or {}).get("pool") or {}
            qdef = pool.get(q["quest_id"]) or {}
            summary["quests_completed"].append({
                "id": q["quest_id"],
                "title": qdef.get("title") or q["quest_id"],
                "period_type": q["period_type"],
                "reward_db": q["reward_db"],
            })
            if q["reward_db"]:
                self.award_xp(q["reward_db"], "quests")
            if _depth < 1:
                sub = self.record_progression_event(
                    "quest_completed",
                    {"period_type": q["period_type"], "quest_id": q["quest_id"]},
                    content, now=now, _depth=_depth + 1,
                )
                summary["challenges_completed"].extend(sub["challenges_completed"])
                summary["quests_completed"].extend(sub["quests_completed"])
                summary["level_ups"].extend(sub["level_ups"])

        summary["mastery_rank"] = progression_mod.mastery_rank(
            self.get_progression_state()["calibration_status"], self.get_player_paths()
        )
        return summary

    # ── Per-song practice stats ───────────────────────────────────────────---
    _STATS_COLS = (
        "filename", "arrangement", "plays", "best_score", "best_accuracy",
        "last_score", "last_accuracy", "last_position", "last_played_at", "updated_at",
    )

    def _stats_row(self, filename: str, arrangement: int) -> dict | None:
        r = self.conn.execute(
            "SELECT " + ", ".join(self._STATS_COLS) +
            " FROM song_stats WHERE filename = ? AND arrangement = ?",
            (filename, int(arrangement)),
        ).fetchone()
        return dict(zip(self._STATS_COLS, r)) if r else None

    # Constant SQL fragment restricting stats reads to songs that still exist.
    # Unconditional: a genuinely empty (but scanned) library must still hide
    # stale stats/playlist ghosts. We rely on `songs` NEVER being transiently
    # empty mid-scan — /api/rescan/full bumps mtime to force a full re-scan
    # rather than DELETEing rows — so the only times `songs` is empty are a
    # fresh install (no stats anyway) or a truly empty library (ghosts should be
    # hidden). Race-free orphan handling: dead-song stats are hidden here, never
    # deleted on scan (see delete_missing).
    _EXISTING_SONG_FILTER = " AND filename IN (SELECT filename FROM songs) "

    def _existing_song_filter(self) -> str:
        return self._EXISTING_SONG_FILTER

    def record_session(self, filename: str, arrangement: int, *, score: int,
                       accuracy: float, last_position=None) -> dict:
        """Record a scored play: plays += 1, best_* = max, last_* = new."""
        from song_score import merge_stats
        with self._lock:
            existing = self._stats_row(filename, int(arrangement))
            merged = merge_stats(existing, {
                "score": score, "accuracy": accuracy, "last_position": last_position,
            })
            self.conn.execute(
                """INSERT INTO song_stats
                       (filename, arrangement, plays, best_score, best_accuracy,
                        last_score, last_accuracy, last_position, last_played_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?,
                           strftime('%Y-%m-%d %H:%M:%f','now'), strftime('%Y-%m-%d %H:%M:%f','now'))
                   ON CONFLICT(filename, arrangement) DO UPDATE SET
                       plays = excluded.plays,
                       best_score = excluded.best_score,
                       best_accuracy = excluded.best_accuracy,
                       last_score = excluded.last_score,
                       last_accuracy = excluded.last_accuracy,
                       last_position = excluded.last_position,
                       last_played_at = excluded.last_played_at,
                       updated_at = excluded.updated_at""",
                (filename, int(arrangement), merged["plays"], merged["best_score"],
                 merged["best_accuracy"], merged["last_score"], merged["last_accuracy"],
                 merged["last_position"]),
            )
            self.conn.commit()
        return self._stats_row(filename, int(arrangement))

    def touch_position(self, filename: str, arrangement: int, last_position: float) -> dict:
        """Persist just the resume position (no plays/score change), so
        Continue-Playing works for non-scored plays. Also stamps
        last_played_at — both /api/stats/recent and /api/session/continue
        filter/order on it, so a position-only touch must set it or the song
        never surfaces as 'recent' / 'continue playing'."""
        with self._lock:
            self.conn.execute(
                """INSERT INTO song_stats (filename, arrangement, last_position,
                                           last_played_at, updated_at)
                   VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f','now'),
                           strftime('%Y-%m-%d %H:%M:%f','now'))
                   ON CONFLICT(filename, arrangement) DO UPDATE SET
                       last_position = excluded.last_position,
                       last_played_at = excluded.last_played_at,
                       updated_at = excluded.updated_at""",
                (filename, int(arrangement), float(last_position)),
            )
            self.conn.commit()
        return self._stats_row(filename, int(arrangement))

    def get_song_stats(self, filename: str) -> dict:
        """Best/last/plays across all arrangements of a song, plus per-arrangement rows."""
        rows = self.conn.execute(
            "SELECT " + ", ".join(self._STATS_COLS) +
            " FROM song_stats WHERE filename = ? ORDER BY arrangement",
            (filename,),
        ).fetchall()
        arr = [dict(zip(self._STATS_COLS, r)) for r in rows]
        best_acc = max((a["best_accuracy"] for a in arr), default=0.0)
        best_score = max((a["best_score"] for a in arr), default=0)
        plays = sum(a["plays"] for a in arr)
        return {
            "filename": filename,
            "best_accuracy": best_acc,
            "best_score": best_score,
            "plays": plays,
            "arrangements": arr,
        }

    def recent_stats(self, limit: int = 12) -> list[dict]:
        """Recently-played rows (most recent first) for 'Jump back in'."""
        limit = max(1, min(100, int(limit)))
        rows = self.conn.execute(
            "SELECT " + ", ".join(self._STATS_COLS) +
            " FROM song_stats WHERE last_played_at IS NOT NULL " +
            self._existing_song_filter() +
            "ORDER BY last_played_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(zip(self._STATS_COLS, r)) for r in rows]

    def best_accuracy_map(self) -> dict:
        """{filename: best_accuracy} across all arrangements, for batch-badging
        the library grid in one request. Includes every SCORED song (plays > 0)
        — even a genuine 0% best — but excludes resume-only rows (plays == 0,
        which carry a default best_accuracy of 0 and shouldn't badge)."""
        rows = self.conn.execute(
            "SELECT filename, MAX(best_accuracy), SUM(plays) FROM song_stats "
            "WHERE 1=1 " + self._existing_song_filter() +   # skip dead songs (race-free)
            "GROUP BY filename"
        ).fetchall()
        return {r[0]: r[1] for r in rows if r[2] and r[2] > 0}

    def top_stats(self, limit: int = 5) -> list[dict]:
        """Top scored songs (best score first) for the profile 'Your best
        scores' panel. Aggregated per-song across arrangements (best score,
        best accuracy, total plays), only SCORED songs (plays > 0), dead songs
        skipped. Mirrors best_accuracy_map's grouping; enriched with metadata
        by the /api/stats/top route."""
        limit = max(1, min(50, int(limit)))
        rows = self.conn.execute(
            "SELECT filename, MAX(best_score), MAX(best_accuracy), SUM(plays) "
            "FROM song_stats WHERE 1=1 " + self._existing_song_filter() +   # skip dead songs
            "GROUP BY filename HAVING SUM(plays) > 0 "
            "ORDER BY MAX(best_score) DESC, MAX(best_accuracy) DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [
            {"filename": r[0], "best_score": r[1], "best_accuracy": r[2], "plays": r[3]}
            for r in rows
        ]

    # ── FUTURE ENHANCEMENT (revisit once the feedpak difficulty spec is locked) ──
    # The library-metadata design (§8) calls for user-difficulty to be
    # PER-ARRANGEMENT ("easy on bass ≠ easy on lead") and SEEDED FROM the authored/
    # derived difficulty so it's never blank. Neither ships here on purpose:
    #   • personal difficulty is currently per-FILENAME (P1's song_user_meta);
    #     per-arrangement is a P1-schema + Details-drawer (P2) re-scope; and
    #   • there is NO authored/derived difficulty field on `songs` yet — that waits
    #     on the feedpak difficulty spec (the #37-family FEP), which is unmerged.
    # So this recommender ships the growth-edge PAYOFF now and degrades gracefully
    # (an unrated song is treated as mid). When the feedpak difficulty field lands,
    # revisit: (1) seed unset user-difficulty from authored instead of assuming mid,
    # and (2) score per (filename, arrangement) rather than per song.
    @staticmethod
    def _growth_edge_score(best_accuracy: float, user_difficulty) -> float:
        """The 'practice next' score = difficulty-appropriateness × proximity to
        mastery. Peaks where a song is BOTH at a productive challenge level (the
        mid difficulty band) AND close to — but not yet at — mastery (the
        goal-gradient push). An UNSET personal difficulty is treated as mid, so
        the recommender still works before anything is rated (it degrades to
        closest-to-mastery-first) — see P3 notes: authored/derived difficulty
        seeding waits on the feedpak difficulty spec.

        diff_weight: 3 → 1.0, 2/4 → 0.8, 1/5 → 0.6 (extremes deprioritized, never
        zeroed — you grow on the challenging middle, not the trivially easy or the
        frustratingly hard). Never writes anything."""
        d = user_difficulty if user_difficulty is not None else 3
        weight = 1.0 - abs(d - 3) * 0.2
        return weight * (best_accuracy or 0.0)

    def growth_edge_suggestions(self, limit: int = 8) -> list[dict]:
        """Attempted-but-not-yet-mastered songs ranked by the growth-edge score —
        the 'Keep practicing' recommender that replaces recency-only ordering.
        Song-level (best accuracy across arrangements, like the badge); the
        suggested `arrangement` is the one you're closest to mastering, so the
        shelf opens the version worth pushing. Read-only."""
        limit = max(1, min(24, int(limit)))
        rows = self.conn.execute(
            "SELECT filename, arrangement, best_accuracy, plays, last_played_at "
            "FROM song_stats WHERE 1=1 " + self._existing_song_filter()
        ).fetchall()
        # Aggregate per song: best accuracy + the arrangement that owns it, total
        # plays, most-recent play (used as a stable tiebreak).
        agg: dict = {}
        for fn, arr, acc, plays, lp in rows:
            a = agg.get(fn)
            if a is None:
                a = agg[fn] = {"acc": None, "arr": 0, "plays": 0, "lp": None}
            a["plays"] += (plays or 0)
            if acc is not None and (a["acc"] is None or acc > a["acc"]):
                a["acc"] = acc
                a["arr"] = arr
            if lp and (not a["lp"] or lp > a["lp"]):
                a["lp"] = lp
        cands = [(fn, a) for fn, a in agg.items()
                 if a["plays"] > 0 and a["acc"] is not None and a["acc"] < MASTERY_ACCURACY]
        if not cands:
            # Two different empties (launch polish): attempts exist but
            # everything attempted is mastered → an empty shelf is honest;
            # NOTHING attempted yet (day one) → "starter" picks instead, so
            # the library home invites a first play rather than dead-ending.
            if any(a["plays"] > 0 and a["acc"] is not None for a in agg.values()):
                return []
            return self.starter_suggestions(limit)
        diffs = self.user_meta_map([fn for fn, _ in cands])   # {filename: 1..5}
        out = []
        for fn, a in cands:
            d = diffs.get(fn)
            out.append({
                "filename": fn,
                "best_accuracy": a["acc"],
                "arrangement": a["arr"],
                "last_played_at": a["lp"],
                "user_difficulty": d,
                "growth_score": round(self._growth_edge_score(a["acc"], d), 6),
            })
        out.sort(key=lambda r: (r["growth_score"], r["last_played_at"] or "", r["filename"]), reverse=True)
        return out[:limit]

    def starter_suggestions(self, limit: int = 8) -> list[dict]:
        """Day-one 'Start here' picks for a library with no practice attempts
        yet: up to 8 approachable songs — sensible length (90s–480s, so intros/
        jingles and 10-minute epics don't lead), shortest first, filename as a
        stable tiebreak. Same row shape as the growth-edge rows plus a
        `starter: true` marker so the client renders the invitational 'Start
        here' shelf instead of 'Keep practicing'. Read-only."""
        limit = max(1, min(8, int(limit)))
        rows = self.conn.execute(
            "SELECT filename FROM songs WHERE title != '' "
            "AND duration >= 90 AND duration <= 480 "
            "ORDER BY duration ASC, filename ASC LIMIT ?", (limit,)).fetchall()
        return [{
            "filename": r[0],
            "best_accuracy": None,
            "arrangement": None,
            "last_played_at": None,
            "user_difficulty": None,
            "growth_score": 0.0,
            "starter": True,
        } for r in rows]

    def continue_session(self) -> dict | None:
        """Most-recently-played song (from song_stats) + metadata, for the
        Continue-Playing card. Null when nothing has been played."""
        row = self.conn.execute(
            "SELECT filename, arrangement, last_position FROM song_stats "
            "WHERE last_played_at IS NOT NULL " +
            self._existing_song_filter() +   # skip dead songs (race-free)
            "ORDER BY last_played_at DESC LIMIT 1"
        ).fetchone()
        if not row:
            return None
        filename, arrangement, last_position = row
        meta = self.conn.execute(
            "SELECT title, artist, tuning_name, duration FROM songs WHERE filename = ?", (filename,)
        ).fetchone()
        title, artist, tuning_name, duration = meta if meta else (None, None, None, None)
        from urllib.parse import quote
        return {
            "filename": filename, "arrangement": arrangement,
            "title": title or filename, "artist": artist or "",
            "tuning_name": tuning_name or "", "duration": duration or 0,
            "last_position": last_position,
            "art_url": f"/api/song/{quote(filename)}/art",
        }
