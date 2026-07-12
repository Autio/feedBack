# Shared module-level helpers: tuning grouping key, smart-arrangement
# naming/sorting, filename-derived artist/title seed, tag normalisation,
# strict int coercion, and the song-mastery threshold constant.

import math
import re

from song import compute_smart_names

# Canonical Tuning-filter grouping key (feedBack#867). tuning_name collapses
# every non-standard tuning to "Custom Tuning"; for those rows we key on the
# raw offsets so distinct customs stay distinct, while named tunings keep
# grouping by name (stable across the offsets-column migration). Used by both
# the tuning-names listing and the filter WHERE so the contract matches.
def _tuning_group_key_sql(alias: str) -> str:
    """The tuning grouping key (name for named tunings, raw offsets for
    customs) against an explicit table alias — the grouped filter law (§7.1)
    evaluates chart-intrinsic predicates inside a member subquery, where bare
    column names would resolve against the wrong scope."""
    return (f"CASE WHEN {alias}.tuning_name = 'Custom Tuning' AND COALESCE({alias}.tuning_offsets, '') != '' "
            f"THEN {alias}.tuning_offsets ELSE {alias}.tuning_name END")


# ── SQLite metadata cache ─────────────────────────────────────────────────────

def _ensure_smart_names(arrangements: list[dict]) -> list[dict]:
    """Fill in missing ``smart_name`` fields and sort arrangements by smart order.

    Applied to every library query result so the client always receives
    arrangements in priority order:
      Lead → Alt. Lead [1,2,…] → Bonus Lead [1,2,…]
      → Rhythm → Alt. Rhythm → Bonus Rhythm
      → Bass → Alt. Bass → Bonus Bass → other

    Rows scanned before the smart-naming feature was introduced don't carry a
    ``smart_name`` key.  The background scanner automatically rescans those rows
    to populate the field from authoritative manifest JSON path flags.

    In the meantime this function provides a best-effort on-the-fly computation.
    However, when multiple arrangements share the same name (e.g. two "Combo"
    tracks in a archive that bundles all path flags as zero), name-based inference
    cannot distinguish Lead from Rhythm — so we emit ``smart_name: null`` and
    let the UI fall back to the legacy name until the background rescan corrects
    the row.  Arrangements that already have the field are never modified.
    """
    if not arrangements:
        return arrangements

    # Fill in missing smart_name values.
    if not all("smart_name" in a for a in arrangements):
        # Detect duplicate raw names across ALL arrangements (not just the
        # missing subset).  A duplicate anywhere means the name-based fallback
        # may assign the same smart type a scanned row already owns — emit
        # None for the missing entries and let the legacy name show through
        # until the background rescan corrects them.
        # Coerce to str so a malformed cached row with a list/dict name
        # doesn't blow up the set() conversion (and every query that hits it).
        all_names = [
            a.get("name", "") if isinstance(a.get("name"), str) else str(a.get("name", ""))
            for a in arrangements
        ]
        has_duplicates = len(all_names) != len(set(all_names))
        if has_duplicates:
            for a in arrangements:
                if "smart_name" not in a:
                    a["smart_name"] = None
        else:
            # No duplicates — name-based fallback is safe.
            from song import Arrangement as _ArrCls
            arr_objs = [
                _ArrCls(
                    name=a.get("name", ""),
                    path_lead=a.get("_path_lead", False),
                    path_rhythm=a.get("_path_rhythm", False),
                    path_bass=a.get("_path_bass", False),
                    bonus_arr=a.get("_bonus_arr", False),
                    represent=a.get("_represent", 0),
                )
                for a in arrangements
            ]
            smart = compute_smart_names(arr_objs)
            for a, sn in zip(arrangements, smart):
                if "smart_name" not in a:
                    a["smart_name"] = sn

    # Always sort by smart priority order so the client receives a consistent
    # list regardless of how the DB row was originally stored.
    # _arr_smart_sort_key is defined later in this module but resolved at
    # call-time, so the forward reference is safe.
    arrangements.sort(key=_arr_smart_sort_key)
    return arrangements

# Song-level "mastered" threshold — best accuracy across a song's arrangements
# at/above this counts as in your repertoire. One number shared by the green
# accuracy badge, the Repertoire meter, the mastery filter/sort, and the P3
# growth-edge recommender (matches the frontend MASTERY_ACCURACY).
MASTERY_ACCURACY = 0.9


_SMART_TYPE_BASE: dict[str, int] = {"Lead": 0, "Rhythm": 10, "Bass": 20}


def _arr_smart_sort_key(entry: dict) -> tuple[int, int]:
    """Sort key for arrangement entries ordered by smart naming priority.

    Order: Lead → Alt. Lead [1,2,…] → Bonus Lead [1,2,…]
           → Rhythm → Alt. Rhythm → Bonus Rhythm
           → Bass → Alt. Bass → Bonus Bass → other (stable fallback)
    """
    sn = entry.get("smart_name")
    if not sn:
        return (99, 0)
    for label, base in _SMART_TYPE_BASE.items():
        if sn == label:
            return (base, 0)
        alt_prefix = f"Alt. {label}"
        if sn == alt_prefix:
            return (base + 1, 0)
        if sn.startswith(alt_prefix + " "):
            suffix = sn[len(alt_prefix) + 1:]
            return (base + 1, int(suffix) if suffix.isdigit() else 0)
        bonus_prefix = f"Bonus {label}"
        if sn == bonus_prefix:
            return (base + 2, 0)
        if sn.startswith(bonus_prefix + " "):
            suffix = sn[len(bonus_prefix) + 1:]
            return (base + 2, int(suffix) if suffix.isdigit() else 0)
    return (99, 0)


# Strips a trailing tag parenthetical from a filename stem — "(440Hz)",
# "(Live)", "(No Lead)", the retune/arrangement noise CDLC names carry.
_FN_TAG_RE = re.compile(r"\s*\([^)]*\)")


def _artist_title_from_filename(filename: str) -> dict | None:
    """Derive artist + title from the CDLC filename convention
    'Artist_Song-Title_v1_p.feedpak' — spaces written as hyphens WITHIN a
    field, underscores separating Artist | Title | version/arrangement. Used
    ONLY as a match SEED for packs whose own `artist` field is blank (a large
    slice of community charts): text search needs an artist, and the filename
    reliably carries it. This never becomes displayed metadata — the shown
    values still come from the confirmed MusicBrainz match (provenance
    'matched'), so nothing estimated is presented as author-set; if no match is
    found, the pack stays exactly as-is. Returns None when the name doesn't fit
    the convention (so a non-CDLC pack falls through untouched)."""
    base = filename.replace("\\", "/").rsplit("/", 1)[-1]
    base = base.rsplit(".", 1)[0]                 # drop the extension
    base = _FN_TAG_RE.sub("", base).strip()       # drop "(440Hz)" etc.
    parts = [p for p in base.split("_") if p]
    if len(parts) < 2:
        return None
    artist = parts[0].replace("-", " ").strip()
    title = parts[1].replace("-", " ").strip()
    if not artist or not title:
        return None
    return {"artist": artist, "title": title}


def _normalize_tag(tag) -> str:
    """Canonical form for a personal practice tag: trimmed, lowercased,
    internal whitespace collapsed, length-capped. Lowercasing is what keeps
    "Rock"/"rock" from splitting into two tags. Non-strings → ''."""
    if not isinstance(tag, str):
        return ""
    return " ".join(tag.strip().lower().split())[:60]


def _as_int(value) -> int:
    """Coerce a JSON value to an int, REJECTING bool and non-integral numbers
    so e.g. 1.9 / True don't silently truncate to 1. Accepts ints, integral
    floats (1.0), and integer-shaped strings ("5"); raises ValueError otherwise."""
    if isinstance(value, bool):
        raise ValueError("bool is not an integer")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            raise ValueError("non-integral float")
        return int(value)
    if isinstance(value, str):
        return int(value)   # int("5") ok; int("1.9")/"nan"/"inf" raise ValueError
    raise ValueError("not an integer")
