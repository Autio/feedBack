"""SQLite metadata cache for the chart library — the `MetadataDB` class and
the query helpers it owns (keyset paging cursors, the tuning grouping key,
smart-arrangement naming, tag normalisation).

Extracted verbatim from ``server.py`` (R3), then split into domain modules;
``server.py`` still owns the ``meta_db`` singleton. This package only supplies
the class, so nothing here touches config paths at import time — the caller
passes ``config_dir`` in. ``MetadataDB`` is assembled from per-domain mixins
(core / user_meta / gamification / artists / playlists / enrichment / queries)
that share one connection, one lock, and one class namespace, so cross-domain
``self._helper()`` calls behave exactly as they did in the single module.

Logs through the ``feedBack.server`` logger, unchanged from when this code
lived in ``server.py``, so existing log filters and caplog assertions still
resolve to the same logger object.
"""

import logging

from .artists import ArtistsMixin
from .core import CoreMixin, _apply_pending_db_restore, _sqlite_file_integrity_ok
from .cursors import (
    _KEYSET_ROW_IDX,
    _KEYSET_SORTS,
    _decode_cursor,
    _effective_keyset_sort,
    _encode_cursor,
    _keyset_seek,
    next_library_cursor,
)
from .enrichment import EnrichmentMixin
from .gamification import GamificationMixin
from .helpers import (
    MASTERY_ACCURACY,
    _FN_TAG_RE,
    _SMART_TYPE_BASE,
    _arr_smart_sort_key,
    _artist_title_from_filename,
    _as_int,
    _ensure_smart_names,
    _normalize_tag,
    _tuning_group_key_sql,
)
from .playlists import PlaylistsMixin
from .queries import QueriesMixin
from .user_meta import UserMetaMixin

log = logging.getLogger("feedBack.server")


class MetadataDB(CoreMixin, UserMetaMixin, GamificationMixin, ArtistsMixin,
                 PlaylistsMixin, EnrichmentMixin, QueriesMixin):
    """The one library-metadata store. Domain mixins each own a table family;
    ``CoreMixin.__init__`` opens the connection and creates every table."""


__all__ = [
    "MetadataDB",
    "MASTERY_ACCURACY",
    "next_library_cursor",
    "log",
    "_apply_pending_db_restore",
    "_arr_smart_sort_key",
    "_artist_title_from_filename",
    "_as_int",
    "_decode_cursor",
    "_effective_keyset_sort",
    "_encode_cursor",
    "_ensure_smart_names",
    "_keyset_seek",
    "_normalize_tag",
    "_sqlite_file_integrity_ok",
    "_tuning_group_key_sql",
    "_FN_TAG_RE",
    "_KEYSET_ROW_IDX",
    "_KEYSET_SORTS",
    "_SMART_TYPE_BASE",
]
