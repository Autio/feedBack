// The library module: the Favorites screen (grid + artist tree + A-Z rail +
// pagination), selection/keyboard-nav state, the scan banner, and the
// library-provider plumbing. The legacy #home library screen this module also
// used to drive was removed (the v3 Songs screen — static/v3/songs.js —
// replaced it), so everything here is favorites-scoped or shared plumbing.
//
// Originally the single biggest slice of the carve out of app.js.
//
// A LOW module: it imports only leaves (./dom.js, ./format.js, ./library-state.js,
// ./tuning-display.js — all four import nothing themselves) and needs NO host hooks at
// all. It calls nothing in app.js. That is not luck; it is why this cluster was picked.
// Two entry points that WOULD have dragged the playback core in here were deliberately
// left behind in app.js:
//
//   * syncLibrarySong    reaches showScreen/playSong
//   * _handleLibArrowNav Enter on a selected row plays the song
//
// Both are one hop from the library and app.js is the root, so it imports from both sides
// for free. Pulling them in would have swallowed playSong, showScreen and the whole
// remaining core — I measured it: the closure jumps from 145 declarations to 189.
//
// ─── ON THE EXPORT LIST ──────────────────────────────────────────────────────
//
// Many exports CANNOT be found by a call-graph scan. They are referenced
// only from app.js's TOP-LEVEL statements — the Object.assign(window, {...}) contract and
// the scattered window.X = X lines — which live outside every function, so a closure walk
// over declarations never sees them. Among them are the two handler names that this module
// composes AT RUNTIME into onclick="" strings (filterFavTreeLetter, goFavTreePage): the
// favorites A-Z rail and its pagination. No static tool can see those at all. Miss them
// and the rail silently stops working on click, with nothing failing in CI.
import { _escAttr, _isElementVisible, esc } from './dom.js';
import { formatTime } from './format.js';
import { L } from './library-state.js';
import { displayTuningName } from './tuning-display.js';

// `_libNavItems` is consulted on every arrow / Enter / Space / Home /
// End / activation press, including during autorepeat. Re-running
// `querySelectorAll` + visibility filtering on every keypress is the
// dominant cost on large libraries (hundreds of nodes × per-keypress
// layout reads), so the result is memoised against a generation
// counter that's bumped only when the underlying DOM actually
// changes shape: render functions and `_toggleHeader` bump
// `_libNavGeneration`. Cache misses fall through to a fresh query.
let _libNavGeneration = 0;

let _libNavItemsCache = { gen: -1, items: [], container: null, mode: null, scope: null };

export function _bumpLibNavGeneration() { _libNavGeneration++; }

export function _libNavItems() {
    const active = document.querySelector('.screen.active');
    if (!active) return { items: [], container: null, mode: null };
    let tree, grid;
    if (active.id === 'favorites') {
        tree = document.getElementById('fav-tree');
        grid = document.getElementById('fav-grid');
    } else {
        return { items: [], container: null, mode: null };
    }
    const treeMode = tree && !tree.classList.contains('hidden');
    const scope = treeMode ? tree : grid;
    // Cache key includes the active container — switching grid↔tree
    // must miss even if the generation hasn't ticked.
    if (
        _libNavItemsCache.gen === _libNavGeneration &&
        _libNavItemsCache.scope === scope &&
        scope && document.body.contains(scope)
    ) {
        return {
            items: _libNavItemsCache.items,
            container: _libNavItemsCache.container,
            mode: _libNavItemsCache.mode,
        };
    }
    let items, container, mode;
    if (treeMode) {
        // List mode — include artist headers, album headers, and song
        // rows so arrow nav still works when artists/albums are
        // collapsed (only the headers are visible then). Filter to
        // the currently-displayed nodes so collapsed children don't
        // count as targets the keyboard can land on.
        const all = Array.from(tree.querySelectorAll(
            '.artist-header, .album-header, .song-row[data-play], .song-row[data-library-song][tabindex="0"]'
        ));
        items = all.filter(_isElementVisible);
        container = tree;
        mode = 'list';
    } else {
        items = Array.from((grid || document).querySelectorAll('.song-card[data-play], .song-card[data-library-song][tabindex="0"]'));
        container = grid;
        mode = 'grid';
    }
    _libNavItemsCache = { gen: _libNavGeneration, items, container, mode, scope };
    return { items, container, mode };
}

// Tracked separately from `document.activeElement` so the persistent
// `.selected` highlight survives focus drifting elsewhere (clicks
// outside the grid, drawer opening, etc). Also lets us avoid a global
// `querySelectorAll('.selected')` on every arrow press — large
// libraries make that a noticeable hot path.
export let _lastLibSelected = null;

// One-shot flag set in `showScreen` when the user enters Favorites.
// Consumed by the very next favorites render so the restored
// selection scrolls into view exactly once on screen entry
// (player → favorites, hard reload). Routine re-renders driven by
// search / sort changes leave the user's scroll position
// alone — the highlight still re-applies, but they aren't yanked.
export const _libScrollOnNextRender = { favorites: false };

// localStorage key for "remember the last selection across reloads
// and after returning from the player". Only song-row / song-card
// selections are persisted — header selections in the tree are
// ephemeral by design (re-derived from arrow nav).
const _FAV_SELECTED_KEY = 'feedBack.favLastSelected';

function _selectedKeyForActiveScreen() {
    const active = document.querySelector('.screen.active');
    if (!active) return null;
    if (active.id === 'favorites') return _FAV_SELECTED_KEY;
    return null;
}

function _persistLibSelection(el) {
    if (!el || !el.dataset) return;
    // Both local entries (data-play) and remote entries (data-library-song,
    // no data-play yet) are persisted so the selection highlight survives a
    // library re-render after sync or provider switch.
    const isLocal = !!el.dataset.play;
    const isRemote = !isLocal && !!el.dataset.librarySong;
    if (!isLocal && !isRemote) return;
    const key = _selectedKeyForActiveScreen();
    if (!key) return;
    // Stored as JSON `{f, a, p, s}`:
    //   f — encoded filename (local entries); drives data-play restore.
    //   a — artist, for future cross-page restore.
    //   p — encoded provider id; prevents cross-provider collisions.
    //   s — encoded song id (remote entries); drives data-library-song restore.
    // Older bare-string and {f,a}/{f,a,p} formats are still tolerated in
    // `_loadPersistedLibSelection`.
    const artist = el.dataset.artist || '';
    const provider = el.dataset.libraryProvider || '';
    // For synced provider entries (data-play + data-library-song both present),
    // persist both f and s so _restoreLibSelection can match the card by either
    // attribute after a post-sync re-render.
    const payload = isLocal
        ? { f: el.dataset.play, a: artist, p: provider, s: el.dataset.librarySong || '' }
        : { f: '', a: artist, p: provider, s: el.dataset.librarySong };
    try {
        localStorage.setItem(key, JSON.stringify(payload));
    } catch { /* private mode / quota */ }
}

function _loadPersistedLibSelection(key) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { return null; }
    if (!raw) return null;
    // Tolerate the older bare-string format (just the encoded
    // filename) — older builds wrote that and we'd rather upgrade
    // silently than orphan the user's saved selection.
    if (raw[0] !== '{') return { f: raw, a: '', p: '', s: '' };
    try {
        const o = JSON.parse(raw);
        return (o && typeof o === 'object') ? { f: o.f || '', a: o.a || '', p: o.p || '', s: o.s || '' } : null;
    } catch { return null; }
}

export function _setLibSelection(el, { focus = true } = {}) {
    if (!el) return;
    // Only the previously-tracked element needs its `.selected` class
    // cleared. classList.remove on an element that no longer carries
    // the class is a no-op, so a stale `_lastLibSelected` from a
    // re-render is harmless. Avoids the global `querySelectorAll`
    // pass that the earlier implementation ran on every keypress.
    if (_lastLibSelected && _lastLibSelected !== el) {
        _lastLibSelected.classList.remove('selected');
    }
    el.classList.add('selected');
    _lastLibSelected = el;
    // Save song selections to localStorage so a reload (or returning
    // from the player) can restore the highlight. Headers don't get
    // persisted — they don't carry a stable id and the tree's auto-
    // open heuristic re-derives them on each render anyway.
    _persistLibSelection(el);
    if (focus) {
        // `preventScroll: true` skips the browser's native focus-scroll,
        // then we run a single `scrollIntoView` so we don't double-jank
        // when the element is partially in view. The browser's default
        // focus scroll uses `block: 'nearest'` too but isn't smoothable
        // and can interact poorly with sticky headers.
        el.focus({ preventScroll: true });
    }
    _scrollSelectionIntoView(el);
}

// Scroll the selected element to keep it inside a margin from the
// viewport edges. Plain `scrollIntoView({block:'nearest'})` only
// reacts when the element is fully off-screen, so during arrow nav
// the selection drifts to the edge and stays partially visible
// until it falls off — feels laggy. Centering when the row enters
// the buffer zone keeps it comfortably on-screen as the user holds
// the arrow keys.
const _SCROLL_EDGE_MARGIN = 96;

function _scrollSelectionIntoView(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < _SCROLL_EDGE_MARGIN || r.bottom > vh - _SCROLL_EDGE_MARGIN) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
}

function _restoreLibSelection(scopeEl, { scroll = true } = {}) {
    // Re-apply the persistent `.selected` class to whichever song
    // matches the saved filename. For the tree we also walk up and
    // open every collapsed ancestor so the restored row is actually
    // visible — the user shouldn't have to hunt for their place
    // inside a collapsed artist node.
    if (!scopeEl) return null;
    const saved = _loadPersistedLibSelection(_FAV_SELECTED_KEY);
    if (!saved || (!saved.f && !saved.s)) return null;
    // Match by dataset values — both stored and DOM values are in the
    // encoded form, so no decoding is needed. Avoid interpolating persisted
    // data into CSS selectors so malformed localStorage can't make
    // querySelector throw and break rendering.
    //
    // Local entries: match data-play (f) + data-library-provider (p) when p
    // is present to avoid cross-provider collisions on the same filename.
    // Remote entries: match data-library-song (s) + data-library-provider (p).
    // When f is present but no data-play card matches (e.g. the file has not
    // been downloaded on this load), fall back to the s (provider song-id) so
    // a previously-synced remote selection can still be restored.
    let el = null;
    if (saved.f) {
        const candidates = scopeEl.querySelectorAll('.song-card[data-play], .song-row[data-play]');
        el = Array.from(candidates).find((node) => {
            if (node.dataset.play !== saved.f) return false;
            if (saved.p && node.dataset.libraryProvider !== saved.p) return false;
            return true;
        });
    }
    if (!el && saved.s) {
        const candidates = scopeEl.querySelectorAll('.song-card[data-library-song], .song-row[data-library-song]');
        el = Array.from(candidates).find((node) => {
            if (node.dataset.librarySong !== saved.s) return false;
            if (saved.p && node.dataset.libraryProvider !== saved.p) return false;
            return true;
        });
    }
    if (!el) return null;
    // Open every collapsed ancestor in the tree so the restored row
    // is on-screen; harmless on the grid since cards have no such
    // ancestors. Sync `aria-expanded` on the matching header inside
    // each ancestor too — bypassing `_toggleHeader` here would leave
    // assistive tech reporting "collapsed" while the visual is open.
    let n = el.parentElement;
    while (n && n !== scopeEl) {
        if (n.classList.contains('artist-row') || n.classList.contains('album-group')) {
            n.classList.add('open');
            const header = Array.from(n.children).find(c => c.classList.contains('artist-header') || c.classList.contains('album-header'));
            if (header) header.setAttribute('aria-expanded', 'true');
        }
        n = n.parentElement;
    }
    if (_lastLibSelected && _lastLibSelected !== el) {
        _lastLibSelected.classList.remove('selected');
    }
    el.classList.add('selected');
    _lastLibSelected = el;
    // Center the restored element in the viewport so the user's eye
    // lands on it instead of having to scan up from the bottom edge.
    // `block: 'center'` is forgiving of items already on-screen — the
    // browser only scrolls when needed to bring the requested
    // alignment into view.
    // Skip when the caller opts out (e.g. during search/filter/sort
    // re-renders, where the user's scroll position should be left
    // alone and only the `.selected` class is re-applied).
    if (scroll) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    return el;
}

export function _moveSelectionInItems(items, deltaIdx) {
    // Items are passed in by the caller so we don't re-query the DOM
    // twice per keypress (handler queries `_libNavItems`, then we'd
    // query it again).
    if (!items.length) return false;
    const current = document.activeElement && items.includes(document.activeElement)
        ? document.activeElement
        : (_lastLibSelected && items.includes(_lastLibSelected) ? _lastLibSelected : null);
    let idx = current ? items.indexOf(current) : -1;
    let next;
    if (idx === -1) {
        // No current selection — first arrow lands on the first item
        // regardless of direction. Saves a press.
        next = items[0];
    } else {
        next = items[Math.max(0, Math.min(items.length - 1, idx + deltaIdx))];
    }
    _setLibSelection(next);
    return true;
}

// Tree-view expand/collapse persistence. Three states:
//   '1'  → user asked to expand all
//   '0'  → user asked to collapse all
//   null → no explicit choice; renderTreeInto's existing heuristic
//          (auto-open when search active or few artists) wins
const _FAV_TREE_EXPAND_KEY = 'feedBack.favTreeExpand';

const _LIB_TREE_EXPAND_VALUES = new Set(['1', '0']);

function _readPersistedChoice(key, allowed, fallback) {
    try {
        const v = localStorage.getItem(key);
        return v !== null && allowed.has(v) ? v : fallback;
    } catch {
        return fallback;
    }
}

function _writePersistedChoice(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode / quota */ }
}

export function _libraryProviderApi() {
    const api = window.feedBack && window.feedBack.libraryProviders;
    return api && typeof api === 'object' ? api : null;
}

function _libraryProviderSnapshot() {
    const api = _libraryProviderApi();
    if (api && typeof api.snapshot === 'function') return api.snapshot();
    return { available: false, current: 'local', providers: [{ id: 'local', label: 'My Library', kind: 'local', capabilities: ['library.read', 'art.read', 'song.play'], default: true }] };
}

function _providerById(providerId) {
    const api = _libraryProviderApi();
    if (api && typeof api.providerById === 'function') return api.providerById(providerId);
    return (_libraryProviderSnapshot().providers || []).find(provider => provider.id === providerId) || null;
}

function _activeLibraryProvider() {
    const api = _libraryProviderApi();
    if (api && typeof api.activeProvider === 'function') return api.activeProvider();
    const snapshot = _libraryProviderSnapshot();
    return _providerById(snapshot.current) || _providerById('local') || (snapshot.providers || [])[0];
}

export function _activeLibraryProviderId() {
    const api = _libraryProviderApi();
    if (api && typeof api.activeProviderId === 'function') return api.activeProviderId();
    return (_activeLibraryProvider() || {}).id || 'local';
}

function _isLocalLibraryProvider(providerId) {
    const api = _libraryProviderApi();
    if (api && typeof api.isLocal === 'function') return api.isLocal(providerId);
    const provider = _providerById(providerId);
    return providerId === 'local' || (provider && provider.kind === 'local');
}

export function _providerSupports(providerId, capability) {
    const api = _libraryProviderApi();
    if (api && typeof api.supports === 'function') return api.supports(providerId, capability);
    const provider = _providerById(providerId);
    return !!provider && Array.isArray(provider.capabilities) && provider.capabilities.includes(capability);
}

function _resetLibraryProviderViewState() {
    L.libEpoch++;
    L.currentPage = 0;
    L.treeStats = null;
    L.tuningNames = null;
}

export async function loadLibraryProviders({ restoreSaved = false, reloadOnChange = false } = {}) {
    const beforeProviderId = _activeLibraryProviderId();
    const api = _libraryProviderApi();
    if (api && typeof api.refresh === 'function') {
        await api.refresh({ restoreSaved });
    }

    const afterProviderId = _activeLibraryProviderId();
    if (reloadOnChange && afterProviderId !== beforeProviderId) {
        _resetLibraryProviderViewState();
        loadLibrary(0);
    }
}

function _libraryProviderIdForSong(song, fallbackProviderId) {
    return String(
        song.provider_id || song.providerId || song.library_provider_id ||
        song.libraryProviderId || song.provider || fallbackProviderId || 'local'
    );
}

export function _librarySongId(song) {
    const songId = song.song_id || song.songId || song.remote_id || song.remoteId || song.id || song.filename || '';
    return String(songId || '');
}

export function _libraryLocalFilename(song, providerId) {
    if (_isLocalLibraryProvider(providerId)) return song.filename ? String(song.filename) : '';
    const filename = song.local_filename || song.localFilename || song.synced_filename ||
        song.syncedFilename || song.play_filename || song.playFilename || '';
    if (filename) return String(filename);
    const state = _librarySyncState(providerId, _librarySongId(song));
    return state && state.status === 'synced' && state.localFilename ? String(state.localFilename) : '';
}

function _libraryDisplayFilename(song, providerId) {
    return _libraryLocalFilename(song, providerId) || _librarySongId(song) || 'Unknown song';
}

function _librarySongTitle(song, providerId) {
    const fallback = _libraryDisplayFilename(song, providerId);
    return song.title || fallback.replace(/_p\.archive$/i, '').replace(/_/g, ' ');
}

export function _librarySongArtUrl(song, providerId) {
    const explicitArt = song.art_url || song.artUrl || song.cover_url || song.coverUrl;
    if (explicitArt) return _safeImageUrl(explicitArt);
    const version = song.mtime ? `?v=${Math.floor(song.mtime)}` : '';
    const localFilename = _libraryLocalFilename(song, providerId);
    if (localFilename) return `/api/song/${encodeURIComponent(localFilename)}/art${version}`;
    if (_isLocalLibraryProvider(providerId)) return '';
    if (!_providerSupports(providerId, 'art.read')) return '';
    const songId = _librarySongId(song);
    return songId ? `/api/library/providers/${encodeURIComponent(providerId)}/songs/${encodeURIComponent(songId)}/art${version}` : '';
}

function _safeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw, window.location.origin);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
        return '';
    }
}

const _librarySyncStates = new Map();

function _librarySyncKey(providerId, songId) {
    // JSON.stringify avoids delimiter collision: a newline in either value
    // would make "${p}\n${s}" ambiguous, but JSON-serialised arrays are
    // always distinct for distinct (providerId, songId) pairs.
    return JSON.stringify([providerId, songId]);
}

export function _librarySyncState(providerId, songId) {
    return _librarySyncStates.get(_librarySyncKey(providerId, songId)) || null;
}

function _librarySyncStatusText(state) {
    if (!state) return '';
    if (state.status === 'syncing') return 'Loading package...';
    if (state.status === 'synced') return state.message || 'Ready to play';
    if (state.status === 'error') return state.message ? `Load failed: ${state.message}` : 'Load failed';
    return '';
}

function _librarySyncStatusClass(state, layout) {
    const base = layout === 'inline'
        ? 'library-sync-status inline-block text-[11px] ml-1'
        : 'library-sync-status block mt-1 text-[11px] leading-snug';
    if (!state) return `${base} hidden text-gray-500`;
    if (state.status === 'error') return `${base} text-red-300`;
    if (state.status === 'synced') return `${base} text-green-300`;
    return `${base} text-gray-400`;
}

function _librarySyncStatusMarkup(providerId, songId, layout = 'block') {
    const state = _librarySyncState(providerId, songId);
    return `<span data-library-sync-status role="status" aria-live="polite" data-library-sync-provider="${encodeURIComponent(providerId)}" data-library-sync-song="${encodeURIComponent(songId)}" class="${_librarySyncStatusClass(state, layout)}">${esc(_librarySyncStatusText(state))}</span>`;
}

const PAGE_SIZE = 24;

// Tree letter selection persists across reloads / coming back from
// the player so the user lands on the same alphabet group they
// picked. Validation: any single uppercase letter, or `#` for
// non-alphabetical artists, or `''` for the All bucket.
const _FAV_TREE_LETTER_KEY = 'feedBack.favTreeLetter';

function _readPersistedLetter(key) {
    let v = null;
    try { v = localStorage.getItem(key); } catch { return ''; }
    if (v === null) return '';
    return (v === '' || v === '#' || /^[A-Z]$/.test(v)) ? v : '';
}

function _writePersistedLetter(key, value) {
    try { localStorage.setItem(key, value || ''); } catch { /* private mode / quota */ }
}

// ── Arrangement naming mode (smart vs legacy) ─────────────────────────
//
// In smart mode 'Combo' is subsumed into 'Lead'; legacy keeps the
// original four values. Governs the arrangement badges the favorites
// grid/tree render and the naming_mode query param the player sends.
// In-memory cache so a localStorage.setItem failure (private mode / quota /
// disabled storage) still keeps the chosen mode for the rest of the session.
// Initialised lazily from localStorage on first read.
let _arrangementNamingMode = null;

export function _getArrangementNamingMode() {
    if (_arrangementNamingMode === 'smart' || _arrangementNamingMode === 'legacy') {
        return _arrangementNamingMode;
    }
    try {
        _arrangementNamingMode = localStorage.getItem('arrangementNamingMode') === 'legacy' ? 'legacy' : 'smart';
    } catch (_) {
        _arrangementNamingMode = 'smart';
    }
    return _arrangementNamingMode;
}

export function _onNamingModeChange(value) {
    const mode = value === 'legacy' ? 'legacy' : 'smart';
    _arrangementNamingMode = mode;
    try { localStorage.setItem('arrangementNamingMode', mode); } catch (_) {}
    // Drop cached stats and bump the epoch so the next favorites / folder
    // render refetches with the new naming mode.
    L.libEpoch++;
    L.currentPage = 0;
    L.treeStats = null;
    loadLibrary(0);
}

function _arrangementBadgeHtml(arrangement, nm) {
    const label = (nm === 'smart' && arrangement.smart_name) ? arrangement.smart_name : arrangement.name;
    const cls = label.includes('Lead')   ? 'bg-red-900/40 text-red-300' :
                label.includes('Rhythm') ? 'bg-blue-900/40 text-blue-300' :
                label.includes('Bass')   ? 'bg-green-900/40 text-green-300' :
                'bg-dark-600 text-gray-400';
    return `<span class="px-1.5 py-0.5 rounded ${cls}">${esc(label)}</span>`;
}

export async function loadLibrary() {
    // The legacy #home grid/tree this used to drive is gone — the v3 Songs
    // screen (static/v3/songs.js) fetches its own data. The one shared surface
    // left is the plugin-provided folder view, which renders into
    // #lib-folder-tree inside the v3 Songs screen: refresh it when visible so
    // rescans, favorite toggles, and metadata edits still propagate.
    if (window.folderLibrary) {
        const treeEl = document.getElementById('lib-folder-tree');
        if (treeEl && !treeEl.classList.contains('hidden')) {
            await window.folderLibrary.load();
        }
    }
}

async function _fetchJsonOrThrow(url) {
    const resp = await fetch(url);
    const raw = await resp.text();
    let data = {};
    let parseError = null;
    if (raw) {
        try {
            data = JSON.parse(raw);
        } catch (error) {
            parseError = error;
        }
    }
    if (!resp.ok) {
        const detail = String(data.detail || data.error || data.message || '').trim();
        throw new Error(detail || `HTTP ${resp.status}`);
    }
    if (parseError) throw new Error('Malformed JSON response');
    return data;
}

function _setLibraryOfflineMessage(containerId, countId, message) {
    const container = document.getElementById(containerId);
    const count = document.getElementById(countId);
    if (count) count.textContent = 'Source appears offline';
    if (container) {
        container.innerHTML = `<div class="rounded-xl border border-red-900/30 bg-red-900/10 px-4 py-6 text-sm text-red-300">${esc(message || 'This source appears to be offline.')}</div>`;
    }
}

function formatBadge(fmt, stemCount) {
    if (fmt === 'sloppak' && (stemCount || 0) > 1) {
        return `<span class="fmt-badge absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-900/80 text-purple-200 border border-purple-700">STEMS</span>`;
    }
    if (fmt === 'sloppak') {
        return `<span class="fmt-badge absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/80 text-green-200 border border-green-700">FEEDPAK</span>`;
    }
    if (fmt === 'loose') {
        return `<span class="fmt-badge absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/80 text-amber-200 border border-amber-700">FOLDER</span>`;
    }
    return '';
}

function formatBadgeInline(fmt, stemCount) {
    if (fmt === 'sloppak' && (stemCount || 0) > 1) {
        return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-900/60 text-purple-300">STEMS</span>`;
    }
    if (fmt === 'sloppak') {
        return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/60 text-green-300">FEEDPAK</span>`;
    }
    if (fmt === 'loose') {
        return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-900/60 text-amber-300">FOLDER</span>`;
    }
    return '';
}

export function renderGridCards(songs, containerId = 'fav-grid', mode = 'replace') {
    const grid = document.getElementById(containerId);
    const screenProviderId = containerId.startsWith('fav') ? 'local' : _activeLibraryProviderId();
    const html = songs.map(song => {
        const providerId = _libraryProviderIdForSong(song, screenProviderId);
        const localFilename = _libraryLocalFilename(song, providerId);
        const songId = _librarySongId(song);
        const title = _librarySongTitle(song, providerId);
        const artist = song.artist || '';
        const duration = song.duration ? formatTime(song.duration) : '';
        const tuningRaw = song.tuning || song.tuning_name || '';
        const tuning = displayTuningName(tuningRaw);
        const artUrl = _librarySongArtUrl(song, providerId);
        const isLocalProvider = _isLocalLibraryProvider(providerId);
        const isSloppak = song.format === 'sloppak';
        // Use the canonical display label (displayTuningName names raw offset
        // strings too), not the raw token, so a row whose tuning is stored as
        // offsets still qualifies for the "Convert to E Standard" button.
        const stdRetune = isLocalProvider && localFilename && !isSloppak && tuning && !song.has_estd &&
            ['Eb Standard', 'D Standard', 'C# Standard', 'C Standard'].includes(tuning);
        const retuneBtn = stdRetune
            ? `<button data-retune="${encodeURIComponent(localFilename)}" data-title="${encodeURIComponent(title)}" data-tuning="${_escAttr(tuning)}" data-target="E Standard"
                class="retune-btn mt-2 w-full px-2 py-1.5 bg-gold/10 hover:bg-gold/20 border border-gold/20 rounded-lg text-xs font-medium text-gold transition">
                ⬆ Convert to E Standard</button>`
            : '';
        const fmtBadge = formatBadge(song.format, song.stem_count);
        const syncStatus = !localFilename ? _librarySyncStatusMarkup(providerId, songId) : '';
        const actionButtons = isLocalProvider && localFilename
            ? `${editBtn(song)}${heartBtn(localFilename, song.favorite)}`
            : '';
        const canSync = !localFilename && _providerSupports(providerId, 'song.sync');
        const isInteractive = !!localFilename || canSync;
        const providerAttr = `data-library-provider="${encodeURIComponent(providerId)}"`;
        // For provider-backed entries, keep data-library-song alongside
        // data-play once the song is synced so _restoreLibSelection can
        // still match the persisted remote selection after a re-render.
        const songAttr = !isLocalProvider ? ` data-library-song="${encodeURIComponent(songId)}"` : '';
        const entryAttrs = localFilename
            ? `data-play="${encodeURIComponent(localFilename)}" ${providerAttr}${songAttr}`
            : `data-library-provider="${encodeURIComponent(providerId)}" data-library-song="${encodeURIComponent(songId)}"`;
        const ariaAction = localFilename ? 'Play' : 'Load and play';
        const ariaLabel = `${ariaAction} ${title || _libraryDisplayFilename(song, providerId)}${artist ? ' by ' + artist : ''}`;
        const displayLabel = `${title || _libraryDisplayFilename(song, providerId)}${artist ? ' by ' + artist : ''}`;
        const interactiveAttrs = isInteractive
            ? `tabindex="0" role="button" aria-label="${_escAttr(ariaLabel)}"`
            : `role="listitem" aria-label="${_escAttr(displayLabel)}"`;
        const artHtml = artUrl
            ? `<img src="${_escAttr(artUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                <span class="placeholder" style="display:none">🎸</span>`
            : `<span class="placeholder" style="display:flex">🎸</span>`;
        return `<div class="song-card group" ${entryAttrs} data-artist="${_escAttr(artist || '')}" ${interactiveAttrs}>
            <div class="card-art">
                ${artHtml}
                ${fmtBadge}
            </div>
            <div class="p-4">
                <div class="flex items-start justify-between gap-1">
                    <div class="min-w-0">
                        <h3 class="text-sm font-semibold text-white truncate group-hover:text-accent-light transition">${esc(title)}</h3>
                        <p class="text-xs text-gray-500 truncate mt-0.5">${esc(artist)}</p>
                    </div>
                    <div class="flex gap-1">
                        ${actionButtons}
                    </div>
                </div>
                <div class="flex items-center flex-wrap gap-1.5 mt-3 text-xs">
                    ${(() => { const _nm = _getArrangementNamingMode(); return (song.arrangements || []).map(a => _arrangementBadgeHtml(a, _nm)).join(''); })()}
                    ${tuning ? `<span class="px-1.5 py-0.5 rounded ${tuning === 'E Standard' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'}">${esc(tuning)}</span>` : ''}
                    ${song.has_lyrics ? `<span class="px-1.5 py-0.5 bg-purple-900/30 rounded text-purple-300">Lyrics</span>` : ''}
                    ${song.user_difficulty != null ? `<span class="px-1.5 py-0.5 bg-blue-900/30 rounded text-blue-300" title="Your difficulty rating">◆${esc(song.user_difficulty)}</span>` : ''}
                    ${duration ? `<span class="text-gray-600">${duration}</span>` : ''}
                </div>
                ${retuneBtn}
                ${syncStatus}
            </div>
        </div>`;
    }).join('');
    if (mode === 'append') {
        grid.insertAdjacentHTML('beforeend', html);
    } else {
        grid.innerHTML = html;
    }
    // Items list invalidation: any DOM mutation to the grid changes
    // the result of the next `_libNavItems` call.
    _bumpLibNavGeneration();
    // Re-apply the persistent selection after a fresh render so the
    // user's last picked card stays highlighted across reloads / a
    // round-trip through the player. Skip this during `append` mode
    // (infinite scroll) so restoring selection can't re-center the
    // viewport and yank the user away from the newly loaded page.
    // When a search input is focused the user is actively filtering —
    // re-apply the highlight but don't move the viewport (they didn't
    // leave the page and their scroll position should be preserved).
    if (mode !== 'append' && containerId.startsWith('fav')) {
        // Scroll only on the first render after a screen entry —
        // routine search / sort renders re-apply the highlight
        // without moving the viewport. The flag is one-shot and
        // consumed here.
        const scroll = _libScrollOnNextRender.favorites;
        if (scroll) _libScrollOnNextRender.favorites = false;
        _restoreLibSelection(grid, { scroll });
    }
}

const TREE_PAGE_SIZE = 50;

// Renders the favorites artist/album tree (the only tree left — the legacy
// library tree went with the #home screen).
export async function renderTreeInto(containerId, countId, stats, letter, q, page, expectedEpoch = L.libEpoch) {
    if (page === undefined) page = _favTreePage || 0;
    const container = document.getElementById(containerId);
    const screenProviderId = 'local';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
    const chevron = `<svg class="chevron w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>`;

    // These handler NAMES are composed into onclick="" strings at runtime, so
    // they must stay published on window (see app.js's contract block).
    const letterFn = 'filterFavTreeLetter';
    const pageFn = 'goFavTreePage';
    let html = '<div class="flex flex-wrap gap-1 mb-6">';
    html += `<button onclick="${letterFn}('')" class="px-2 py-1 rounded text-xs transition ${
        !letter ? 'bg-accent text-white' : 'bg-dark-700 text-gray-400 hover:text-white'
    }">All</button>`;
    for (const l of letters) {
        const count = stats.letters[l] || 0;
        const active = letter === l;
        html += `<button onclick="${letterFn}('${l}')" class="px-2 py-1 rounded text-xs transition ${
            active ? 'bg-accent text-white' :
            count ? 'bg-dark-700 text-gray-300 hover:text-white' :
            'bg-dark-700/50 text-gray-700 cursor-default'
        }" ${count ? '' : 'disabled'}>${l}</button>`;
    }
    html += '</div>';

    // Fetch artists for the selected letter/all
    const params = new URLSearchParams();
    if (letter) params.set('letter', letter);
    if (q) params.set('q', q);
    params.set('favorites', '1');
    params.set('page', page);
    params.set('size', TREE_PAGE_SIZE);
    let data;
    try {
        data = await _fetchJsonOrThrow(`/api/library/artists?${params}`);
    } catch (error) {
        if (expectedEpoch !== L.libEpoch) return;
        _setLibraryOfflineMessage(containerId, countId, error.message || 'This source appears to be offline.');
        return;
    }
    if (expectedEpoch !== L.libEpoch) return;
    const artists = data.artists || [];
    const totalArtists = data.total_artists || 0;
    const totalPages = Math.ceil(totalArtists / TREE_PAGE_SIZE);

    let songCount = 0, artistCount = artists.length;
    for (const a of artists) songCount += a.song_count;
    const pageInfo = totalPages > 1 ? ` · Page ${page + 1} of ${totalPages}` : '';
    document.getElementById(countId).textContent =
        `${totalArtists} artists (${songCount} songs on this page)${pageInfo}`;

    // A previous Expand/Collapse-All click is persisted as '1'/'0' and
    // overrides the auto-open heuristic for both artists and albums.
    // Falsy / unset key → fall back to the existing heuristic (open
    // when there's an active search or few rows).
    const savedExpand = _readPersistedChoice(_FAV_TREE_EXPAND_KEY, _LIB_TREE_EXPAND_VALUES, null);
    const forceArtistOpen = savedExpand === '1';
    const forceArtistClosed = savedExpand === '0';

    for (const artist of artists) {
        const heuristicOpen = q || artists.length <= 5;
        const isOpen = forceArtistOpen ? true : forceArtistClosed ? false : heuristicOpen;
        const openClass = isOpen ? ' open' : '';
        const artistAria = _escAttr(`Toggle artist ${artist.name}`);
        html += `<div class="artist-row${openClass}">`;
        html += `<div class="artist-header" tabindex="0" role="button" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="${artistAria}" onclick="_onHeaderClick(this)">`;
        html += chevron;
        html += `<span class="text-white font-semibold text-sm flex-1">${esc(artist.name)}</span>`;
        html += `<span class="text-xs text-gray-600">${artist.song_count} song${artist.song_count !== 1 ? 's' : ''} · ${artist.album_count} album${artist.album_count !== 1 ? 's' : ''}</span>`;
        html += `</div><div class="artist-body">`;

        for (const album of artist.albums) {
            const albumSongs = Array.isArray(album.songs) ? album.songs : [];
            const artSong = albumSongs[0] || {};
            const artProviderId = _libraryProviderIdForSong(artSong, screenProviderId);
            const artUrl = _librarySongArtUrl(artSong, artProviderId);
            const albumHeuristicOpen = q || artist.albums.length === 1;
            const albumIsOpen = forceArtistOpen ? true : forceArtistClosed ? false : albumHeuristicOpen;
            const albumOpen = albumIsOpen ? ' open' : '';
            const albumAria = _escAttr(`Toggle album ${album.name}`);
            html += `<div class="album-group${albumOpen}">`;
            html += `<div class="album-header" tabindex="0" role="button" aria-expanded="${albumIsOpen ? 'true' : 'false'}" aria-label="${albumAria}" onclick="_onHeaderClick(this)">`;
            html += chevron;
            if (artUrl) html += `<img src="${_escAttr(artUrl)}" alt="" class="album-art-sm" loading="lazy" onerror="this.style.display='none'">`;
            html += `<span class="text-gray-300 text-sm flex-1">${esc(album.name)}</span>`;
            html += `<span class="text-xs text-gray-600">${albumSongs.length}</span>`;
            html += `</div><div class="album-body">`;

            for (const song of albumSongs) {
                const providerId = _libraryProviderIdForSong(song, screenProviderId);
                const localFilename = _libraryLocalFilename(song, providerId);
                const songId = _librarySongId(song);
                const title = _librarySongTitle(song, providerId);
                const duration = song.duration ? formatTime(song.duration) : '';
                const tuningRaw = song.tuning || song.tuning_name || '';
                const tuning = displayTuningName(tuningRaw);
                const isLocalProvider = _isLocalLibraryProvider(providerId);
                const isSloppak = song.format === 'sloppak';
                const stdRetune = isLocalProvider && localFilename && !isSloppak && tuningRaw && !song.has_estd &&
                    ['Eb Standard', 'D Standard', 'C# Standard', 'C Standard'].includes(tuningRaw);
                const canSyncRow = !localFilename && _providerSupports(providerId, 'song.sync');
                const isInteractiveRow = !!localFilename || canSyncRow;
                const providerAttr = `data-library-provider="${encodeURIComponent(providerId)}"`;
                // Keep data-library-song alongside data-play for provider-backed
                // entries once synced so _restoreLibSelection can still find the
                // card after a post-sync re-render.
                const rowSongAttr = !isLocalProvider ? ` data-library-song="${encodeURIComponent(songId)}"` : '';
                const rowAttrs = localFilename
                    ? `data-play="${encodeURIComponent(localFilename)}" ${providerAttr}${rowSongAttr}`
                    : `data-library-provider="${encodeURIComponent(providerId)}" data-library-song="${encodeURIComponent(songId)}"`;
                const ariaAction = localFilename ? 'Play' : 'Load and play';
                const rowAria = _escAttr(`${ariaAction} ${title}${artist.name ? ' by ' + artist.name : ''}`);
                const rowDisplayLabel = `${title}${artist.name ? ' by ' + artist.name : ''}`;
                const rowInteractiveAttrs = isInteractiveRow
                    ? `tabindex="0" role="button" aria-label="${rowAria}"`
                    : `role="listitem" aria-label="${_escAttr(rowDisplayLabel)}"`;
                html += `<div class="song-row" ${rowAttrs} data-artist="${_escAttr(artist.name || '')}" ${rowInteractiveAttrs}>`;
                html += `<div class="flex-1 min-w-0 flex items-center gap-2"><span class="text-sm text-white truncate block">${esc(title)}</span>${formatBadgeInline(song.format, song.stem_count)}</div>`;
                html += `<div class="flex items-center gap-1.5 flex-shrink-0 text-xs">`;
                { const _nm = _getArrangementNamingMode();
                  for (const arrangement of (song.arrangements || []))
                      html += _arrangementBadgeHtml(arrangement, _nm); }
                if (tuning)
                    html += `<span class="px-1.5 py-0.5 rounded ${tuning === 'E Standard' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'}">${esc(tuning)}</span>`;
                if (song.has_lyrics)
                    html += `<span class="px-1.5 py-0.5 bg-purple-900/30 rounded text-purple-300">Lyrics</span>`;
                if (song.user_difficulty != null)
                    html += `<span class="px-1.5 py-0.5 bg-blue-900/30 rounded text-blue-300" title="Your difficulty rating">◆${esc(song.user_difficulty)}</span>`;
                if (duration)
                    html += `<span class="text-gray-600 w-10 text-right">${duration}</span>`;
                if (stdRetune)
                    html += `<button data-retune="${encodeURIComponent(localFilename)}" data-title="${encodeURIComponent(title)}" data-tuning="${_escAttr(tuningRaw)}" data-target="E Standard"
                        class="retune-btn px-1.5 py-0.5 bg-gold/10 hover:bg-gold/20 border border-gold/20 rounded text-gold" title="Convert to E Standard">E</button>`;
                if (isLocalProvider && localFilename) {
                    html += editBtn(song);
                    html += heartBtn(localFilename, song.favorite);
                } else if (!localFilename) {
                    html += _librarySyncStatusMarkup(providerId, songId, 'inline');
                }
                html += `</div></div>`;
            }
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    // Pagination
    if (totalPages > 1) {
        html += '<div class="flex items-center justify-center gap-2 py-6">';
        html += `<button onclick="${pageFn}(0)" class="px-3 py-1.5 rounded-lg text-xs ${page === 0 ? 'text-gray-600' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}" ${page === 0 ? 'disabled' : ''}>« First</button>`;
        html += `<button onclick="${pageFn}(${page - 1})" class="px-3 py-1.5 rounded-lg text-xs ${page === 0 ? 'text-gray-600' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}" ${page === 0 ? 'disabled' : ''}>‹ Prev</button>`;
        const start = Math.max(0, page - 2);
        const end = Math.min(totalPages, start + 5);
        for (let i = start; i < end; i++) {
            html += `<button onclick="${pageFn}(${i})" class="px-3 py-1.5 rounded-lg text-xs ${i === page ? 'bg-accent text-white' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}">${i + 1}</button>`;
        }
        html += `<button onclick="${pageFn}(${page + 1})" class="px-3 py-1.5 rounded-lg text-xs ${page >= totalPages - 1 ? 'text-gray-600' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}" ${page >= totalPages - 1 ? 'disabled' : ''}>Next ›</button>`;
        html += `<button onclick="${pageFn}(${totalPages - 1})" class="px-3 py-1.5 rounded-lg text-xs ${page >= totalPages - 1 ? 'text-gray-600' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}" ${page >= totalPages - 1 ? 'disabled' : ''}>Last »</button>`;
        html += '</div>';
    }

    container.innerHTML = html;
    // Items list invalidation — see grid render counterpart.
    _bumpLibNavGeneration();
    // Re-apply the persisted selection. For the tree we also expand
    // every collapsed ancestor of the saved row so the highlight is
    // actually visible — see _restoreLibSelection. Scroll only on
    // the first render after a screen entry (one-shot flag set in
    // showScreen) so routine renders don't yank the viewport.
    const scroll = _libScrollOnNextRender.favorites;
    if (scroll) _libScrollOnNextRender.favorites = false;
    _restoreLibSelection(container, { scroll });
}

function _toggleAllInTree(containerId, expand, persistKey) {
    // Scope the open/close to the named tree's container so toggling
    // Library doesn't flip the (offscreen) Favorites DOM and vice
    // versa — they share `.artist-row` / `.album-group` classes.
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.artist-row').forEach(el => el.classList.toggle('open', expand));
    container.querySelectorAll('.album-group').forEach(el => el.classList.toggle('open', expand));
    // Bulk open/close changes which song-rows pass the visibility
    // filter in `_libNavItems` — same reason `_toggleHeader` bumps
    // the generation. Without this, a stale cached items list from
    // before the toggle would let arrow nav step into now-hidden
    // rows.
    _bumpLibNavGeneration();
    // Persist the explicit choice so the next page reload (or letter
    // change, which re-runs renderTreeInto) honors it instead of
    // falling back to the auto-open heuristic. Stored as '1'/'0' so a
    // missing key reliably means "no explicit choice".
    _writePersistedChoice(persistKey, expand ? '1' : '0');
}

export function toggleAllFavoriteArtists(expand) {
    _toggleAllInTree('fav-tree', expand, _FAV_TREE_EXPAND_KEY);
}

// Toggle an artist/album header's parent `.open` state and keep
// `aria-expanded` on the header itself in sync so screen readers
// announce the collapsed/expanded transition correctly. Used by
// both the inline onclick (mouse) and the keyboard handlers.
export function _toggleHeader(headerEl) {
    if (!headerEl) return;
    const parent = headerEl.parentElement;
    if (!parent) return;
    parent.classList.toggle('open');
    headerEl.setAttribute('aria-expanded', parent.classList.contains('open') ? 'true' : 'false');
    // Toggling open/closed changes which song-rows pass the
    // visibility filter in `_libNavItems`, so the cached items list
    // is now stale.
    _bumpLibNavGeneration();
}

// Called by the inline onclick on artist- and album-headers so the
// mouse-click path also syncs the persistent `.selected` state —
// keeps arrow-nav resuming from the last-clicked header rather than
// from a stale highlight on a different element.
export function _onHeaderClick(el) {
    _toggleHeader(el);
    _setLibSelection(el, { focus: false });
}

// ── Favorites ────────────────────────────────────────────────────────────
let favView = 'grid';

let favPage = 0;

let _favTreeLetter = _readPersistedLetter(_FAV_TREE_LETTER_KEY);

let _favTreePage = 0;

let _favDebounce = null;

function heartBtn(filename, isFav) {
    return `<button data-fav="${encodeURIComponent(filename)}" class="fav-btn text-lg leading-none transition ${isFav ? 'text-red-500' : 'text-gray-600 hover:text-red-400'}" title="Toggle favorite">${isFav ? '&#9829;' : '&#9825;'}</button>`;
}

export function editBtn(song) {
    return `<button data-edit='${JSON.stringify({f:song.filename,t:song.title||'',a:song.artist||'',al:song.album||'',y:song.year||''}).replace(/'/g,"&#39;")}' class="edit-btn text-gray-600 hover:text-accent-light transition" title="Edit metadata"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>`;
}

export async function toggleFavorite(filename) {
    const resp = await fetch('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
    });
    const data = await resp.json();
    // Refresh whichever view is active
    const activeScreen = document.querySelector('.screen.active');
    if (activeScreen?.id === 'favorites') loadFavorites();
    else loadLibrary();
    return data.favorite;
}

export function setFavView(view) {
    favView = view;
    document.getElementById('fav-grid').classList.toggle('hidden', view !== 'grid');
    document.getElementById('fav-tree').classList.toggle('hidden', view !== 'tree');
    document.querySelectorAll('.fav-grid-ctrl').forEach(el => el.classList.toggle('hidden', view !== 'grid'));
    document.querySelectorAll('.fav-tree-ctrl').forEach(el => el.classList.toggle('hidden', view !== 'tree'));
    document.getElementById('fav-view-grid-btn').className = `px-3 py-2.5 text-sm transition ${view === 'grid' ? 'text-accent-light' : 'text-gray-600 hover:text-gray-400'}`;
    document.getElementById('fav-view-tree-btn').className = `px-3 py-2.5 text-sm transition ${view === 'tree' ? 'text-accent-light' : 'text-gray-600 hover:text-gray-400'}`;
    const pag = document.getElementById('fav-pagination');
    if (pag && view !== 'grid') pag.innerHTML = '';
    // Grid vs tree changes which container `_libNavItems` resolves
    // to — drop the items cache so the next keypress re-derives
    // against the now-active container.
    _bumpLibNavGeneration();
    loadFavorites();
}

export async function loadFavorites() {
    if (favView === 'grid') await loadFavGridPage(favPage);
    else await loadFavTreeView();
}

export function filterFavorites() {
    clearTimeout(_favDebounce);
    _favDebounce = setTimeout(() => { favPage = 0; _favTreeLetter = ''; loadFavorites(); }, 250);
}

export function sortFavorites() { favPage = 0; loadFavorites(); }

async function loadFavGridPage(page = 0) {
    const q = document.getElementById('fav-filter').value.trim();
    const sort = document.getElementById('fav-sort').value;
    favPage = page;
    const params = new URLSearchParams({ q, page, size: PAGE_SIZE, sort, favorites: 1 });
    const resp = await fetch(`/api/library?${params}`);
    const data = await resp.json();
    const totalPages = Math.ceil((data.total || 0) / PAGE_SIZE);
    document.getElementById('fav-count').textContent =
        `${data.total || 0} favorites · Page ${favPage + 1} of ${Math.max(1, totalPages)}`;
    renderGridCards(data.songs || [], 'fav-grid');
    renderFavPagination(totalPages);
}

function renderFavPagination(totalPages) {
    let pag = document.getElementById('fav-pagination');
    if (!pag) {
        pag = document.createElement('div');
        pag.id = 'fav-pagination';
        pag.className = 'flex items-center justify-center gap-2 py-6';
        document.getElementById('fav-grid').after(pag);
    }
    if (totalPages <= 1) { pag.innerHTML = ''; return; }
    let html = '';
    html += `<button onclick="goFavPage(0)" class="px-3 py-1.5 rounded-lg text-xs ${favPage === 0 ? 'text-gray-600 cursor-default' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}" ${favPage === 0 ? 'disabled' : ''}>« First</button>`;
    html += `<button onclick="goFavPage(${favPage - 1})" class="px-3 py-1.5 rounded-lg text-xs ${favPage === 0 ? 'text-gray-600 cursor-default' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}" ${favPage === 0 ? 'disabled' : ''}>‹ Prev</button>`;
    const start = Math.max(0, favPage - 2);
    const end = Math.min(totalPages, start + 5);
    for (let i = start; i < end; i++) {
        html += `<button onclick="goFavPage(${i})" class="px-3 py-1.5 rounded-lg text-xs ${i === favPage ? 'bg-accent text-white' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}">${i + 1}</button>`;
    }
    html += `<button onclick="goFavPage(${favPage + 1})" class="px-3 py-1.5 rounded-lg text-xs ${favPage >= totalPages - 1 ? 'text-gray-600 cursor-default' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}" ${favPage >= totalPages - 1 ? 'disabled' : ''}>Next ›</button>`;
    html += `<button onclick="goFavPage(${totalPages - 1})" class="px-3 py-1.5 rounded-lg text-xs ${favPage >= totalPages - 1 ? 'text-gray-600 cursor-default' : 'bg-dark-600 text-gray-300 hover:bg-dark-500'}" ${favPage >= totalPages - 1 ? 'disabled' : ''}>Last »</button>`;
    pag.innerHTML = html;
}

export function goFavPage(p) { loadFavGridPage(Math.max(0, p)); }

async function loadFavTreeView() {
    if (!L.favTreeStats) {
        const resp = await fetch('/api/library/stats?favorites=1');
        L.favTreeStats = await resp.json();
    }
    const q = document.getElementById('fav-filter').value.trim();
    const letter = _favTreeLetter;
    await renderTreeInto('fav-tree', 'fav-count', L.favTreeStats, letter, q);
}

export function filterFavTreeLetter(letter) {
    _favTreeLetter = (_favTreeLetter === letter) ? '' : letter;
    _favTreePage = 0;
    _writePersistedLetter(_FAV_TREE_LETTER_KEY, _favTreeLetter);
    loadFavTreeView();
}

export function goFavTreePage(p) {
    _favTreePage = Math.max(0, p);
    loadFavTreeView();
}

let _uploadScanPoller = null;

export function _pollScanAndRefresh(statusEl) {
    const setStatus = (s) => { if (statusEl) statusEl.textContent = s; };
    if (_uploadScanPoller) _uploadScanPoller.stop();

    const MAX_FAILURES = 5;
    const INTERVAL_MS = 1000;
    let stopped = false;
    let timerId = null;
    let failures = 0;
    const stop = () => {
        stopped = true;
        if (timerId) { clearTimeout(timerId); timerId = null; }
        if (_uploadScanPoller && _uploadScanPoller.stop === stop) _uploadScanPoller = null;
    };
    _uploadScanPoller = { stop };

    const tick = async () => {
        timerId = null;
        try {
            const sr = await fetch('/api/scan-status');
            if (!sr.ok) throw new Error(`HTTP ${sr.status}`);
            const sd = await sr.json();
            if (stopped) return;
            failures = 0;
            if (sd.running) {
                const cur = sd.current ? ` · ${sd.current}` : '';
                setStatus(`${sd.done} / ${sd.total} scanned${cur}...`);
            } else {
                stop();
                if (sd.error) setStatus(`Error: ${sd.error}`);
                else setStatus('Done!');
                L.treeStats = null;
                L.tuningNames = null;
                // Mirror the delete path: refresh whichever collection is
                // currently visible. Overwriting a favorited song while
                // viewing Favorites otherwise leaves a stale entry.
                const activeScreen = document.querySelector('.screen.active');
                if (activeScreen?.id === 'favorites') loadFavorites();
                else loadLibrary();
                return;
            }
        } catch (e) {
            if (stopped) return;
            failures++;
            if (failures >= MAX_FAILURES) {
                stop();
                setStatus(`Scan status unavailable: ${e.message || e}`);
                return;
            }
        }
        if (!stopped) timerId = setTimeout(tick, INTERVAL_MS);
    };
    timerId = setTimeout(tick, INTERVAL_MS);
}

export async function rescanLibrary() {
    const btn = document.getElementById('btn-rescan');
    const status = document.getElementById('rescan-status');
    btn.disabled = true;
    btn.textContent = 'Scanning...';
    status.textContent = '';
    const resp = await fetch('/api/rescan', { method: 'POST' });
    const data = await resp.json();
    status.textContent = data.message;
    // Poll until done
    const poll = setInterval(async () => {
        const sr = await fetch('/api/scan-status');
        const sd = await sr.json();
        if (sd.running) {
            const cur = sd.current ? ` · ${sd.current}` : '';
            status.textContent = `${sd.done} / ${sd.total} scanned${cur}...`;
        } else {
            clearInterval(poll);
            btn.disabled = false;
            btn.textContent = 'Rescan Library';
            status.textContent = sd.error ? `Error: ${sd.error}` : 'Done!';
            L.treeStats = null;
            L.tuningNames = null;  // re-fetch on next drawer open
            loadLibrary();
            // Tell the v3 Songs grid the library changed so it reloads instead of
            // keeping a cached (e.g. pre-DLC, empty) grid until an app restart.
            if (window.feedBack) window.feedBack.emit('library:changed', { reason: 'rescan' });
        }
    }, 1000);
}

export async function fullRescanLibrary() {
    if (!confirm('This will clear the entire library cache and re-scan all songs. This can take a long time with large libraries. Continue?')) return;
    const btn = document.getElementById('btn-full-rescan');
    const status = document.getElementById('rescan-status');
    btn.disabled = true;
    btn.textContent = 'Clearing...';
    const resp = await fetch('/api/rescan/full', { method: 'POST' });
    const data = await resp.json();
    btn.textContent = 'Scanning...';
    status.textContent = data.message;
    const poll = setInterval(async () => {
        const sr = await fetch('/api/scan-status');
        const sd = await sr.json();
        if (sd.running) {
            const cur = sd.current ? ` · ${sd.current}` : '';
            status.textContent = `${sd.done} / ${sd.total} scanned${cur}...`;
        } else {
            clearInterval(poll);
            btn.disabled = false;
            btn.textContent = 'Full Rescan';
            status.textContent = sd.error ? `Error: ${sd.error}` : 'Done!';
            L.treeStats = null;
            L.tuningNames = null;  // re-fetch on next drawer open
            loadLibrary();
            // Tell the v3 Songs grid the library changed so it reloads instead of
            // keeping a cached (e.g. pre-DLC, empty) grid until an app restart.
            if (window.feedBack) window.feedBack.emit('library:changed', { reason: 'rescan' });
        }
    }, 1000);
}

export function _removeLibCardsForFilename(filename) {
    // The grid uses data-play="<encoded filename>" on each card; the
    // tree's song rows use the same attribute. encodeURIComponent
    // matches what renderGridCards / the tree renderer emit.
    const encoded = encodeURIComponent(filename);
    const selector = `[data-play="${CSS.escape(encoded)}"]`;
    let removed = 0;
    for (const el of document.querySelectorAll(selector)) {
        el.remove();
        removed++;
    }
    if (removed === 0) return;
    // Decrement the visible count badge the favorites views populated.
    // Counts come from the server's `total` so this is a
    // best-effort estimate until the next refetch, but it keeps the
    // displayed number consistent with what's on screen right now.
    for (const id of ['fav-count']) {
        const el = document.getElementById(id);
        if (!el) continue;
        const m = (el.textContent || '').match(/^(\d+)/);
        if (!m) continue;
        const next = Math.max(0, parseInt(m[1], 10) - removed);
        el.textContent = (el.textContent || '').replace(/^\d+/, String(next));
    }
    _bumpLibNavGeneration();
}

export function _setLibrarySyncState(providerId, songId, state) {
    _librarySyncStates.set(_librarySyncKey(providerId, songId), state);
    _renderLibrarySyncState(providerId, songId);
}

function _renderLibrarySyncState(providerId, songId) {
    const state = _librarySyncState(providerId, songId);
    // Filter via dataset rather than building a CSS attribute selector —
    // CSS.escape is absent in some test environments and older runtimes,
    // and provider/song IDs are not constrained to CSS-safe strings.
    const encodedProvider = encodeURIComponent(providerId);
    const encodedSong = encodeURIComponent(songId);
    for (const status of document.querySelectorAll('[data-library-sync-status]')) {
        if (status.dataset.librarySyncProvider !== encodedProvider) continue;
        if (status.dataset.librarySyncSong !== encodedSong) continue;
        const layout = status.classList.contains('ml-1') ? 'inline' : 'block';
        status.className = _librarySyncStatusClass(state, layout);
        status.textContent = _librarySyncStatusText(state);
    }
}

// ── Scan banner (non-blocking) ──────────────────────────────────────────
function showScanBanner() {
    if (document.getElementById('scan-banner')) return;
    const el = document.createElement('div');
    el.id = 'scan-banner';
    el.className = 'fixed bottom-0 left-0 right-0 z-50 bg-dark-700/95 backdrop-blur border-t border-gray-700 px-6 py-3 flex items-center gap-4';
    el.innerHTML = `
        <div class="flex-1">
            <div class="flex items-center gap-3 mb-1">
                <span class="text-sm font-semibold text-white">Importing Library</span>
                <span class="text-xs text-gray-400" id="scan-progress">0 / 0</span>
            </div>
            <div class="progress-bar"><div class="fill" id="scan-bar" style="width:0%"></div></div>
            <p class="text-xs text-gray-500 mt-1 truncate" id="scan-file">Starting...</p>
            <p class="text-xs text-blue-400/70 mt-1 hidden" id="scan-first-note">First-time import — results are cached for future launches</p>
        </div>
        <button onclick="hideScanBanner()" class="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 rounded-lg text-xs text-gray-400 transition flex-shrink-0">Dismiss</button>`;
    document.body.appendChild(el);
}

export function hideScanBanner() {
    const el = document.getElementById('scan-banner');
    if (el) el.remove();
}

let _scanPollId = null;

async function pollScanStatus() {
    try {
        const resp = await fetch('/api/scan-status');
        const data = await resp.json();
        if (data.stage === 'error' && data.error) {
            // Surface the error in the banner and stop polling.
            showScanBanner();
            const file = document.getElementById('scan-file');
            const prog = document.getElementById('scan-progress');
            const firstNote = document.getElementById('scan-first-note');
            if (file) { file.textContent = 'Scan failed: ' + data.error; file.classList.add('text-red-400'); }
            if (prog) prog.textContent = 'Error';
            if (firstNote) firstNote.classList.add('hidden');
            clearInterval(_scanPollId);
            _scanPollId = null;
            return;
        }
        if (data.running) {
            showScanBanner();
            const pct = data.total > 0 ? Math.round(data.done / data.total * 100) : 0;
            const bar = document.getElementById('scan-bar');
            const prog = document.getElementById('scan-progress');
            const file = document.getElementById('scan-file');
            const firstNote = document.getElementById('scan-first-note');
            if (bar) bar.style.width = pct + '%';
            if (prog) prog.textContent = `${data.done} / ${data.total} (${pct}%)`;
            if (file) {
                const name = (data.current || '').replace(/_p\.archive$/i, '').replace(/_/g, ' ');
                file.textContent = name || (data.stage === 'listing' ? 'Listing DLC folder...' : 'Processing...');
            }
            if (firstNote) firstNote.classList.toggle('hidden', !data.is_first_scan);
        } else {
            if (document.getElementById('scan-banner')) {
                hideScanBanner();
                L.treeStats = null;  // Refresh stats
                loadLibrary();
            }
            clearInterval(_scanPollId);
            _scanPollId = null;
        }
    } catch (e) { /* ignore */ }
}

export async function checkScanAndLoad() {
    const resp = await fetch('/api/scan-status');
    const data = await resp.json();
    if (data.running) {
        showScanBanner();
        const firstNote = document.getElementById('scan-first-note');
        if (firstNote) firstNote.classList.toggle('hidden', !data.is_first_scan);
        _scanPollId = setInterval(pollScanStatus, 1000);
    }
    loadLibrary();
}
