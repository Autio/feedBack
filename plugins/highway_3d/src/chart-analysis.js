// Chord and arpeggio chart analysis: string validation, chord shape
// signatures, hand-shape synth-chord merging, arpeggio inference, and the
// lane outer-rail bounds. Pure chart math over the bundle arrays, cached
// per instance; the factory mirrors the live string count in via
// setStringCount and resets caches on arrangement changes.
import {
    ARP_FRAME_ONSET_CLUSTER_S,
    ARP_FRAME_ONSET_PAD_S,
    ARP_HWY_RAIL_END_TAIL_S,
    ARP_HWY_RAIL_START_LEAD_S,
    ARP_INFER_MIN_HAND_SHAPE_SPAN_S,
    ARP_INFER_MIN_HITS_VS_SHAPE_CAP,
    ARP_INFER_MULTI_STRUM_HIT_SLACK,
    ARP_INFER_MULTI_STRUM_WIN_MIN_S,
    ARP_INFER_STRUM_VS_ARP_SPREAD_MIN_S,
    BEHIND,
    NEXT_ON_STRING_T_EPS,
    S_COL,
} from './geometry.js';

export function createChartAnalysis(initialStringCount) {
    let nStr = initialStringCount;

    // ── Cross-frame caches for chart-static derivations ──────────────
    // The merge + arp-flag fills below depend only on chart-static
    // input arrays (handShapes / chords / chordTemplates / notes),
    // not on `now`. The bundle hands us the same array refs every
    // frame within an arrangement, so we can skip the recompute when
    // the inputs are identity-equal to the previous frame's. On dense
    // arrangements this avoids per-frame Set construction, nested
    // O(hs × notes) scans, and a sort — significant FPS recovery.
    let _mergeCacheResult = null;
    let _mergeCacheChordsRef = null;
    let _mergeCacheHsRef = null;
    let _mergeCacheTplRef = null;
    // Set true once a chart with out-of-range s indices has triggered
    // its warning. Reset only on teardown or when nStr changes (e.g.
    // arrangement switch from guitar to bass) — same-nStr songs share
    // the suppression, which is fine for what is purely a developer
    // aid log.
    let _oobStringWarned = false;

    // Per-string bounds check used by every loop that indexes a
    // per-string array (noteState.*, nextNoteByString, lastFretForString,
    // mStr/mGlow/mSus, ...). Skipping out-of-range s upstream keeps
    // sparse-array extension out of those arrays AND keeps drawNote's
    // material lookup safe in one place.
    function validString(s) {
        const ok = Number.isInteger(s) && s >= 0 && s < nStr;
        if (!ok && !_oobStringWarned) {
            _oobStringWarned = true;
            let msg = '[3D-Hwy] dropping notes with s out of range [0,' + nStr + ')';
            if (nStr === S_COL.length) msg += ' (extended-range chart beyond palette size)';
            console.warn(msg);
        }
        return ok;
    }

    // filter() allocates a new array per chord per frame, even though
    // the vast majority of charts have no out-of-range strings. Scan
    // first; only allocate when there's actually something to drop.
    // The unfiltered array is reused as-is in the common case.
    //
    // Result is cached by ``ch.notes`` identity — call sites (chord
    // render loop, camera pre-pass, strGlow / accent prepasses, cjNext
    // peek) hit the same chord-notes array many times per frame, and
    // the array contents are chart-static for the lifetime of the
    // arrangement. The cache stores either the input array itself
    // (common case) or the filtered copy, so the identity-preservation
    // contract callers depend on is unchanged.
    // NOTE: this cache (and _chordSigCache / _chordShapeCache below) keys on
    // the notes/chord object but its result depends on validString() →
    // nStr. If first computed while nStr is still the default 6 (an early
    // frame before song_info applies stringCount), string-6+ notes get
    // filtered out and would stay gone forever. The nStr-change handler
    // resets all three via _resetStringDependentCaches() so extended-range
    // (7+ string) charts recompute once the real string count arrives.
    let _filterValidNotesCache = new WeakMap();
    function filterValidNotes(notes) {
        const cached = _filterValidNotesCache.get(notes);
        if (cached !== undefined) return cached;
        let filtered = notes;
        for (let i = 0; i < notes.length; i++) {
            if (!validString(notes[i].s)) {
                filtered = notes.filter(cn => validString(cn.s));
                break;
            }
        }
        _filterValidNotesCache.set(notes, filtered);
        return filtered;
    }

    /**
     * Normalized fingering signature for chord repeat-run detection, or null.
     * Cached via WeakMap so the sort+join only runs once per unique chord object
     * across all frames — chart data never changes after load.
     */
    let _chordSigCache = new WeakMap();
    function chordShapeSignature(ch) {
        if (!ch?.notes) return null;
        if (_chordSigCache.has(ch)) return _chordSigCache.get(ch);
        const chordNotes = filterValidNotes(ch.notes);
        let sig = null;
        if (chordNotes.length > 0) {
            sig = chordNotes.slice().sort((a, b) => a.s - b.s).map(n => `${n.s}:${n.f}`).join('|');
        }
        _chordSigCache.set(ch, sig);
        return sig;
    }
    function truthyChartFlag(v) {
        if (v === true || v === 1) return true;
        if (v === '1') return true;
        return typeof v === 'string' && v.toLowerCase() === 'true';
    }

    /** RS / sloppak `hd` (highDensity); tolerate occasional string forms. */
    function chordWireHighDensity(ch) {
        return truthyChartFlag(ch && ch.hd);
    }

    /**
     * Per spec, `displayName` is the UI label for a chord template
     * (defaulting to `name` when the chart didn't set it). Always go
     * through this helper so name vs. displayName drift can't surface
     * the wrong label or break displayName-based dedupe heuristics.
     */
    function chordTemplateLabel(tmpl) {
        if (!tmpl) return '';
        const d = tmpl.displayName;
        if (typeof d === 'string' && d.length > 0) return d;
        const n = tmpl.name;
        return typeof n === 'string' ? n : '';
    }

    /**
     * Arpeggio styling is driven by authored metadata, not by post-hoc
     * note-stream inference. Prefer explicit hand-shape flags and fall back
     * to template markers when present.
     */
    function chordTemplateMarkedArpeggio(cid, chordTemplates) {
        if (cid == null || !chordTemplates) return false;
        const tmpl = chordTemplates[cid] ?? chordTemplates[Number(cid)];
        if (!tmpl) return false;
        if (truthyChartFlag(tmpl.arp) || truthyChartFlag(tmpl.arpeggio)) return true;
        const displayName = typeof tmpl.displayName === 'string' ? tmpl.displayName.toLowerCase() : '';
        if (displayName.includes('-arp')) return true;
        const name = typeof tmpl.name === 'string' ? tmpl.name.toLowerCase() : '';
        return name.endsWith('(arp)') || name.includes(' arpeggio');
    }

    function handShapeMarkedArpeggio(hs, chordTemplates) {
        if (!hs) return false;
        if (truthyChartFlag(hs.arp) || truthyChartFlag(hs.arpeggio)) return true;
        return chordTemplateMarkedArpeggio(hsChordIdNorm(hs), chordTemplates);
    }

    /**
     * Matching hand-shape metadata for a chord onset. ``explicit`` follows
     * authored arpeggio markers only; note inference is handled separately
     * by the callers that still need it for non-visual behavior.
     *
     * Cached per chord: result depends only on (ch, hss, chordTemplates),
     * all chart-static for the lifetime of an arrangement. The cache is
     * swapped on (hss, templates) ref change so an arrangement switch
     * cannot resurrect stale entries. Empty-input case bypasses the cache
     * — it returns a fresh sentinel anyway and isn't hot enough to share.
     */
    const _HINT_NONE = Object.freeze({ explicit: false, covered: false, hs: null });
    let _hintCache = new WeakMap();
    let _hintCacheHsRef = null;
    let _hintCacheTplRef = null;
    function chordHandShapeArpeggioHint(ch, hss, chordTemplates) {
        if (!hss || hss.length === 0) return _HINT_NONE;
        if (_hintCacheHsRef !== hss || _hintCacheTplRef !== chordTemplates) {
            _hintCache = new WeakMap();
            _hintCacheHsRef = hss;
            _hintCacheTplRef = chordTemplates;
        }
        const cached = _hintCache.get(ch);
        if (cached !== undefined) return cached;
        const t = ch.t;
        const cid = ch.id;
        let result = _HINT_NONE;
        for (let i = 0; i < hss.length; i++) {
            const hs = hss[i];
            const tLo = hsStart(hs);
            const tHi = hsEnd(hs);
            if (Number.isNaN(tLo) || Number.isNaN(tHi)) continue;
            if (t + 1e-4 < tLo || t > tHi + 1e-4) continue;
            const hsCid = hsChordIdNorm(hs);
            if (hsCid !== cid && Number(hsCid) !== Number(cid)) continue;
            const explicit = handShapeMarkedArpeggio(hs, chordTemplates);
            result = { explicit, covered: true, hs };
            break;
        }
        _hintCache.set(ch, result);
        return result;
    }

    /** Build ``ch.notes`` from ``chordTemplates[cid].frets`` (-1 omitted). */
    function chordNotesFromTemplate(cid, templates) {
        if (templates == null || cid == null) return [];
        const tmpl = templates[cid] ?? templates[Number(cid)];
        if (!tmpl || !Array.isArray(tmpl.frets)) return [];
        const out = [];
        for (let si = 0; si < tmpl.frets.length; si++) {
            const f = tmpl.frets[si];
            if (f >= 0 && validString(si)) out.push({ s: si, f, sus: 0 });
        }
        return out;
    }

    /**
     * Chart-format fingerpicking passages often have ``<handShape>`` + per-string
     * ``<note>`` rows but **no** ``<chord>`` events. The 3D chord frame / arp
     * styling only runs over ``bundle.chords``, so synthesize minimal chord
     * rows at each hand-shape onset when the chart omits them.
     */
    function mergeHandShapeSynthChords(realChords, handShapes, chordTemplates) {
        if (!handShapes || handShapes.length === 0) return realChords;
        const reals = realChords && realChords.length ? realChords : [];
        const synth = [];
        const seenSynth = new Set();
        const tol = 0.028;
        /**
         * Suppress a synth chord box when a real chord with the **same trimmed
         * display name** played within this window — Custom songs commonly authors
         * several ``<chordTemplate>`` rows that share a display name (with
         * trailing-whitespace IDs) for fingering variants. The follow-up
         * hand-shape with no chord row is a fingering hint, not a new strum
         * (e.g. Jackson 5 "I Want You Back" ~0:27 — Fm7 cid=18 strum followed
         * by Fm7 cid=19 hand-shape, which earlier produced a stacked second
         * "Fm7" label and an extra chord frame).
         */
        const SAME_NAME_RUN_S = 0.5;
        const trimmedTemplateName = (cid) => {
            if (cid == null || !chordTemplates) return '';
            const tmpl = chordTemplates[cid] ?? chordTemplates[Number(cid)];
            // custom songs commonly authors several <chordTemplate> rows that share
            // a displayName for fingering variants; the suppression
            // heuristic in the surrounding code dedupes on the *label*,
            // not the underlying name, so go through chordTemplateLabel.
            return chordTemplateLabel(tmpl).trim();
        };
        outer: for (let i = 0; i < handShapes.length; i++) {
            const hs = handShapes[i];
            const cid = hs.chord_id != null ? hs.chord_id : hs.chordId;
            const st = hs.start_time != null ? hs.start_time : hs.startTime;
            if (cid == null || st == null || Number.isNaN(Number(st))) continue;
            const key = `${cid}|${Number(st).toFixed(3)}`;
            if (seenSynth.has(key)) continue;
            seenSynth.add(key);
            const myName = trimmedTemplateName(cid);
            for (let j = 0; j < reals.length; j++) {
                const ch = reals[j];
                const rid = ch.id;
                const sameId = rid === cid || Number(rid) === Number(cid);
                if (sameId && Math.abs(ch.t - st) <= tol) continue outer;
                // A real strum at the same onset already represents this
                // chord — never synthesize a phantom on top of it. The
                // id/name checks alone miss hand-shapes whose template
                // differs from (or shares no name with) the coincident real
                // chord — e.g. an edited chart that left a stale hand-shape
                // template pointing at the pre-edit shape, which then drew a
                // spurious second power chord beside the real one.
                if (Math.abs(ch.t - st) <= tol) continue outer;
                if (!sameId && myName !== '') {
                    const otherName = trimmedTemplateName(rid);
                    if (otherName === myName
                        && st > ch.t
                        && st - ch.t <= SAME_NAME_RUN_S) {
                        continue outer;
                    }
                }
            }
            const notes = chordNotesFromTemplate(cid, chordTemplates);
            if (notes.length === 0) continue;
            const et = hs.end_time != null ? hs.end_time : hs.endTime;
            synth.push({
                t: st,
                id: cid,
                // `hd` is the chart-format `highDensity` wire field (gallops /
                // repeated strums), not an arpeggio carrier — arpeggio
                // intent is read directly from the hand-shape via
                // chordHandShapeArpeggioHint() downstream. Keep `hd` false
                // so chordWireHighDensity() / label-suppression behave the
                // same as for any other non-gallop chord row.
                hd: false,
                notes,
                /** Hand-shape fill-in (no authored chord row) — skip note-stream arp frame. */
                h3dSynth: true,
                /** Hand-shape end time — used to draw the shape-sustain border for non-arp cases. */
                h3dSynthEnd: et != null ? Number(et) : null,
            });
        }
        if (synth.length === 0) return reals;
        const merged = reals.concat(synth);
        merged.sort((a, b) => {
            const dt = a.t - b.t;
            if (Math.abs(dt) > 1e-6) return dt;
            const ia = Number(a.id);
            const ib = Number(b.id);
            return (ia - ib) || 0;
        });
        return merged;
    }

    /**
     * Merge chart-format ``chordTemplates[id].frets`` with live ``chordNote`` rows.
     * Cached via WeakMap on the chord object — chord data never changes after
     * chart load, so the Map is computed once and reused every frame.
     * The init-time callers (fillArpeggioGhostInferFlags) pass ephemeral `fakeCh`
     * objects that are never seen again, so they bypass the cache naturally.
     */
    let _chordShapeCache = new WeakMap();
    // Reset the validString()/nStr-dependent chord caches. Called when nStr
    // changes so a string count discovered after the first frame (e.g. a
    // 7-string chart whose stringCount arrives in song_info) doesn't leave
    // string-6+ notes filtered out of cached chord shapes/signatures.
    function _resetStringDependentCaches() {
        _filterValidNotesCache = new WeakMap();
        _chordSigCache = new WeakMap();
        _chordShapeCache = new WeakMap();
        // mergeHandShapeSynthChords() is nStr-dependent too: its synth
        // notes come from chordNotesFromTemplate() -> validString(). The
        // merge result is memoised by input identity (not nStr), so force a
        // recompute or string-6+ template notes stay dropped from synth
        // chords after the count grows.
        _mergeCacheResult = null;
    }
    function mergeChordShape(ch, chordNotes, templates) {
        if (_chordShapeCache.has(ch)) return _chordShapeCache.get(ch);
        const shape = new Map();
        const tid = ch && ch.id != null ? ch.id : null;
        const tmpl = (tid != null && templates)
            ? (templates[tid] ?? templates[Number(tid)])
            : null;
        if (tmpl && Array.isArray(tmpl.frets)) {
            for (let si = 0; si < tmpl.frets.length; si++) {
                if (!validString(si)) continue;
                const f = tmpl.frets[si];
                if (f >= 0) shape.set(si, f);
            }
        }
        for (let i = 0; i < chordNotes.length; i++) {
            const cn = chordNotes[i];
            if (!validString(cn.s)) continue;
            if (cn.f < 0) shape.delete(cn.s);
            else shape.set(cn.s, cn.f);
        }
        _chordShapeCache.set(ch, shape);
        return shape;
    }

    function hitTimesQualifyArpeggioSpread(hitTimes) {
        if (hitTimes.length < 2) return false;
        hitTimes.sort((a, b) => a - b);
        const spread = hitTimes[hitTimes.length - 1] - hitTimes[0];
        if (spread >= 0.03) return true;
        return hitTimes.length >= 4 && spread >= 0.016;
    }

    /** RS XML / IPC payloads use snake_case or camelCase field names. */
    function hsStart(hs) {
        if (!hs) return NaN;
        const v = hs.start_time != null ? hs.start_time : hs.startTime;
        if (v == null) return NaN;
        const n = Number(v);
        return Number.isNaN(n) ? NaN : n;
    }
    function hsEnd(hs) {
        if (!hs) return NaN;
        const v = hs.end_time != null ? hs.end_time : hs.endTime;
        if (v == null) return NaN;
        const n = Number(v);
        return Number.isNaN(n) ? NaN : n;
    }
    function hsChordIdNorm(hs) {
        if (!hs) return null;
        const v = hs.chord_id != null ? hs.chord_id : hs.chordId;
        return v == null ? null : v;
    }

    /** ``<handShape>`` chart duration in seconds (snake_case or camelCase XML). */
    function handShapeChartSpanSec(hs) {
        const a = hsStart(hs), b = hsEnd(hs);
        if (Number.isNaN(a) || Number.isNaN(b)) return 0;
        return Math.max(0, b - a);
    }

    /**
     * When ``hd`` is missing/false, detect arpeggio from the **note** stream
     * using the **full voicing** (template ∪ chord notes). RS often stores the
     * plucks only in ``notes[]``, not as duplicate chord rows.
     *
     * @param {{ tLo: number, tHi: number } | null} [timeWin]
     *        When set (e.g. from ``<handShape>`` span), scan staggered picks
     *        across the whole held-shape window — RS often omits ``arp`` and ``hd``.
     */
    // Cached per chord: result depends on (ch, shape, notesArr) and an
    // optional timeWin which itself is a function of the chord's matching
    // <handShape>. Both inputs are chart-static, so the cache invalidates
    // on (notesArr, hss) ref change — `hss` is threaded in purely as the
    // invalidation key for the chord-loop caller, which passes a stable
    // `ch` (reused across frames) and a timeWin that is null until
    // bundle.handShapes arrives over the WS; without the hss check the
    // null-timeWin result would stick once handShapes loaded late. shape
    // comes from mergeChordShape(ch) which is also chart-static, so it
    // doesn't enter the invalidation key directly. The cache deliberately
    // stores boolean results; a sentinel distinguishes "not computed"
    // from "false".
    let _arpInferCache = new WeakMap();
    let _arpInferCacheNotesRef = null;
    let _arpInferCacheHssRef = null;
    function inferArpeggioFromNotePattern(ch, shape, notesArr, timeWin, hss = null) {
        if (!notesArr || notesArr.length === 0 || shape.size < 2) return false;
        if (_arpInferCacheNotesRef !== notesArr || _arpInferCacheHssRef !== hss) {
            _arpInferCache = new WeakMap();
            _arpInferCacheNotesRef = notesArr;
            _arpInferCacheHssRef = hss;
        }
        const cached = _arpInferCache.get(ch);
        if (cached !== undefined) return cached;
        const result = _inferArpeggioFromNotePatternUncached(ch, shape, notesArr, timeWin);
        _arpInferCache.set(ch, result);
        return result;
    }
    function _inferArpeggioFromNotePatternUncached(ch, shape, notesArr, timeWin) {
        const tHi = timeWin ? timeWin.tHi : ch.t + 2.35;
        const tLo = timeWin ? timeWin.tLo : ch.t - 0.28;
        let i2 = lowerBoundT(notesArr, tLo - 0.02);
        const hitTimes = [];
        const hitStrings = new Set();
        for (; i2 < notesArr.length; i2++) {
            const n = notesArr[i2];
            if (n.t > tHi) break;
            if (n.t < tLo) continue;
            if (!validString(n.s)) continue;
            const ef = shape.get(n.s);
            if (ef === undefined || ef !== n.f) continue;
            hitTimes.push(n.t);
            hitStrings.add(n.s);
        }
        if (!hitTimesQualifyArpeggioSpread(hitTimes)) return false;
        // A genuine arpeggio SWEEPS across the held shape, so its standalone
        // notes land on MULTIPLE strings of the shape. When every matching
        // hit is on a single string, this is a repeated single-string run
        // (e.g. a palm-muted gallop hammering the chord's root) that happens
        // to share one string/fret with the chord — NOT an arpeggio. Inferring
        // one here deferred the chord's gems and made the power chord render as
        // just that one repeated note (bar 25 of starlight). Require ≥2 strings.
        if (hitStrings.size < 2) return false;
        // Strumming/gallop rejection — far more hits than the shape has
        // strings means the chord's notes are being re-struck repeatedly
        // (a riff/gallop reusing both power-chord notes), not swept once as
        // an arpeggio. This guard used to live inside `if (timeWin)`, so it
        // was skipped for charts with no hand-shapes (timeWin null) — which
        // let dense two-string gallops over a power chord infer a bogus
        // arpeggio and defer the chord's gems (bar 88 of starlight: a
        // (s5:4,s6:2) chord whose root+fifth recur ~16x over 2 s). Apply it
        // with the actual window span whether or not a hand-shape is present.
        const winSpan = timeWin ? (timeWin.tHi - timeWin.tLo) : (tHi - tLo);
        if (winSpan > ARP_INFER_MULTI_STRUM_WIN_MIN_S
            && hitTimes.length > shape.size + ARP_INFER_MULTI_STRUM_HIT_SLACK) {
            return false;
        }
        if (timeWin) {
            if (winSpan < 0.70 && hitTimes.length < 4) {
                const spread = hitTimes[hitTimes.length - 1] - hitTimes[0];
                if (spread < ARP_INFER_STRUM_VS_ARP_SPREAD_MIN_S) return false;
            }
            // Reject when too few staggered hits for a genuine sweep across
            // the held shape — see ARP_INFER_MIN_HITS_VS_SHAPE_CAP.
            const minHits = Math.min(shape.size, ARP_INFER_MIN_HITS_VS_SHAPE_CAP);
            if (hitTimes.length < minHits) return false;
        }
        return true;
    }

    /**
     * True when standalone note rows already cover every string/fret in the
     * arpeggio shape, so drawing the chord gems too would duplicate the same
     * authored passage.
     */
    // Cached per chord: result depends on (ch, shape, notesArr) — chart-
    // static; the cache invalidates on notesArr ref change. The same
    // ``ch`` may be queried multiple times per frame from the chord
    // render loop (deferChordGems / _deferFallback / suppressSynthChord),
    // so survival across frames is also useful.
    let _arpCoverCache = new WeakMap();
    let _arpCoverCacheNotesRef = null;
    function chordShapeCoveredByStandaloneNotes(ch, shape, notesArr, timeWin) {
        if (!notesArr || notesArr.length === 0 || !shape || shape.size === 0) return false;
        if (_arpCoverCacheNotesRef !== notesArr) {
            _arpCoverCache = new WeakMap();
            _arpCoverCacheNotesRef = notesArr;
        }
        const cached = _arpCoverCache.get(ch);
        if (cached !== undefined) return cached;
        const tLo = (timeWin ? timeWin.tLo : ch.t - ARP_FRAME_ONSET_PAD_S) - NEXT_ON_STRING_T_EPS;
        const tHi = (timeWin ? timeWin.tHi : ch.t + ARP_FRAME_ONSET_CLUSTER_S) + NEXT_ON_STRING_T_EPS;
        let i2 = lowerBoundT(notesArr, tLo);
        const matchedStrings = new Set();
        let result = false;
        for (; i2 < notesArr.length; i2++) {
            const n = notesArr[i2];
            if (n.t > tHi) break;
            if (!validString(n.s) || matchedStrings.has(n.s)) continue;
            const ef = shape.get(n.s);
            if (ef === undefined || ef !== n.f) continue;
            matchedStrings.add(n.s);
            if (matchedStrings.size >= shape.size) { result = true; break; }
        }
        _arpCoverCache.set(ch, result);
        return result;
    }

    /**
     * Notes in an inferred arpeggio passage are charted in ``notes[]`` with
     * staggered times; treat them like chord-cluster notes for chart-format-style
     * board-ghost fret digits (``fromChord`` + template column).
     */
    function arpeggioChordIdForNote(n, handShapes, chordTemplates, notesArr) {
        if (!handShapes || handShapes.length === 0 || !notesArr || notesArr.length === 0) return null;
        if (!validString(n.s)) return null;
        for (let i = 0; i < handShapes.length; i++) {
            const hs = handShapes[i];
            const hsLo = hsStart(hs);
            const hsHi = hsEnd(hs);
            if (Number.isNaN(hsLo) || Number.isNaN(hsHi)) continue;
            if (n.t + 1e-4 < hsLo || n.t > hsHi + 1e-4) continue;
            const cid = hsChordIdNorm(hs);
            if (cid == null) continue;
            const tmpl = chordTemplates?.[cid] ?? chordTemplates?.[Number(cid)];
            if (!tmpl || !Array.isArray(tmpl.frets)) continue;
            const tf = tmpl.frets[n.s];
            if (typeof tf !== 'number' || tf < 0 || n.f !== tf) continue;
            const synthNotes = chordNotesFromTemplate(cid, chordTemplates);
            if (synthNotes.length === 0) continue;
            const fakeCh = { t: hsLo, id: cid, notes: synthNotes };
            const shape = mergeChordShape(fakeCh, synthNotes, chordTemplates);
            const tw = { tLo: hsLo - 0.06, tHi: hsHi + 0.06 };
            if (handShapeChartSpanSec(hs) < ARP_INFER_MIN_HAND_SHAPE_SPAN_S) continue;
            if (inferArpeggioFromNotePattern(fakeCh, shape, notesArr, tw, handShapes)) return cid;
        }
        return null;
    }

    /**
     * Per-frame warmup: ``inferArpeggioFromNotePattern`` depends only on
     * ``handShape × chart``, not on the candidate note — the old path
     * recomputed it for every visible note (O(notecount × hs × notescan)).
     * Fill ``outFlags[i]`` with the boolean once per ``handShapes[i]``.
     */
    function fillArpeggioGhostInferFlags(handShapes, chordTemplates, notesArr, outFlags, outSynthOnsetSet = null) {
        for (let i = 0; i < handShapes.length; i++) {
            let infer = false;
            const hs = handShapes[i];
            if (handShapeChartSpanSec(hs) < ARP_INFER_MIN_HAND_SHAPE_SPAN_S) {
                outFlags[i] = false;
                continue;
            }
            const cid = hsChordIdNorm(hs);
            if (cid != null && notesArr.length > 0) {
                const tmpl = chordTemplates?.[cid] ?? chordTemplates?.[Number(cid)];
                if (tmpl && Array.isArray(tmpl.frets)) {
                    const synthNotes = chordNotesFromTemplate(cid, chordTemplates);
                    if (synthNotes.length > 0) {
                        const hsLo = hsStart(hs);
                        const hsHi = hsEnd(hs);
                        const fakeCh = { t: hsLo, id: cid, notes: synthNotes };
                        const shape = mergeChordShape(fakeCh, synthNotes, chordTemplates);
                        const tw = { tLo: hsLo - 0.06, tHi: hsHi + 0.06 };
                        infer = inferArpeggioFromNotePattern(fakeCh, shape, notesArr, tw, handShapes);
                        // Chord-hold gate: inferArpeggioFromNotePattern can fire true
                        // when open-string notes coincidentally match the template's
                        // open positions but only a SINGLE fretted (f>0) string is
                        // actually played at the handshape onset. Treat that as a
                        // chord hold (not an arpeggio) — clear the arp flag, no
                        // brackets. The original implementation also intended to
                        // record a synthetic sustain extending to hsEnd for the
                        // onset note, but that read-side was never wired up; the
                        // visual decay-before-handshape-end is benign.
                        if (infer) {
                            let _frettedCount = 0;
                            let _onsetNote = null;
                            const _fSeen = new Set();
                            let _ci = lowerBoundT(notesArr, tw.tLo - 0.02);
                            for (; _ci < notesArr.length; _ci++) {
                                const _cn = notesArr[_ci];
                                if (_cn.t > tw.tHi + 0.02) break;
                                if (_cn.t < tw.tLo) continue;
                                if (!validString(_cn.s)) continue;
                                if (shape.get(_cn.s) !== _cn.f) continue;
                                if (_cn.f > 0 && !_fSeen.has(_cn.s)) {
                                    _frettedCount++;
                                    _fSeen.add(_cn.s);
                                    if (_onsetNote === null) _onsetNote = _cn;
                                }
                            }
                            if (_frettedCount <= 1 && _onsetNote !== null) {
                                outFlags[i] = false;
                                continue; // chord hold handled — skip onset-match and outFlags assignment
                            }
                        }
                        // Non-arp template inferred as arpeggio: suppress brackets.
                        // Only explicit arp-marked templates (arp:true / displayName "-arp")
                        // should show [ ] / < > bracket markers.
                        if (infer && outSynthOnsetSet != null
                            && !handShapeMarkedArpeggio(hs, chordTemplates)) {
                            outSynthOnsetSet.add(hsLo);
                        }
                        // Also treat as arp ghost when the hs generated a suppressed
                        // synth chord: any standalone note in the onset window matches
                        // any shape string. Handles patterns where inferArpeggioFromNotePattern
                        // returns false (e.g. repeated arpeggio across a long hs span
                        // triggers the multi-strum rejection), but the player still
                        // needs the "hold this shape" ghost fret numbers on the board.
                        if (!infer) {
                            const _oLo = hsLo - ARP_FRAME_ONSET_PAD_S;
                            const _oHi = hsLo + ARP_FRAME_ONSET_CLUSTER_S;
                            let _oi = lowerBoundT(notesArr, _oLo - 0.02);
                            for (; _oi < notesArr.length; _oi++) {
                                const _on = notesArr[_oi];
                                if (_on.t > _oHi) break;
                                if (_on.t < _oLo) continue;
                                if (shape.get(_on.s) === _on.f) {
                                    infer = true;
                                    // Only suppress brackets when the handshape is NOT an
                                    // explicit arpeggio (arp:true template / displayName "-arp").
                                    // Genuine arp handshapes reached via onset-match still need
                                    // the [ ] bracket markers — only non-arp synth chords are
                                    // "false positives" that should hide the brackets.
                                    if (outSynthOnsetSet != null
                                        && !handShapeMarkedArpeggio(hs, chordTemplates)) {
                                        outSynthOnsetSet.add(hsLo);
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            outFlags[i] = infer;
        }
    }

    // Chart-static WeakMap cache: note object → chord-id (or null sentinel).
    // The result depends only on the note's (t, s, f) and the chart's handShapes
    // + chordTemplates, which never change after load. Keyed by note object so
    // switching songs/arrangements drops the entries with the old array.
    const _ARP_CID_NULL = Object.freeze({});
    const _arpCidCache = new WeakMap();
    function arpeggioChordIdForNoteWithInferCache(n, handShapes, chordTemplates, notesArr, hsInferFlags) {
        const cached = _arpCidCache.get(n);
        if (cached !== undefined) return cached === _ARP_CID_NULL ? null : cached;
        let result = null;
        if (!handShapes || handShapes.length === 0 || !notesArr || notesArr.length === 0 || !hsInferFlags) {
            result = arpeggioChordIdForNote(n, handShapes, chordTemplates, notesArr);
        } else if (validString(n.s)) {
            for (let i = 0; i < handShapes.length; i++) {
                if (!hsInferFlags[i]) continue;
                const hs = handShapes[i];
                const hsLo = hsStart(hs);
                const hsHi = hsEnd(hs);
                if (Number.isNaN(hsLo) || Number.isNaN(hsHi)) continue;
                if (n.t + 1e-4 < hsLo || n.t > hsHi + 1e-4) continue;
                const cid = hsChordIdNorm(hs);
                if (cid == null) continue;
                const tmpl = chordTemplates?.[cid] ?? chordTemplates?.[Number(cid)];
                if (!tmpl || !Array.isArray(tmpl.frets)) continue;
                const tf = tmpl.frets[n.s];
                if (typeof tf !== 'number' || tf < 0 || n.f !== tf) continue;
                result = cid;
                break;
            }
        }
        _arpCidCache.set(n, result === null ? _ARP_CID_NULL : result);
        return result;
    }

    /** Returns {start, end} chart-time bounds of the arpeggio handshape that contains
     *  this note, or null when not found.  Uses hsInferFlags to skip ruled-out
     *  handshapes; falls back to a full scan when hsInferFlags is null. */
    // WeakMap cache — arpHsBoundsForNote result is chart-static (note, handShapes,
    // and hsInferFlags never change after chart load). Each renderer instance has
    // its own WeakMap, so splitscreen panels don't interfere.
    // Sentinel: _ARP_BOUNDS_NULL = {} distinguishes "no matching hs" from "uncached".
    const _ARP_BOUNDS_NULL = Object.freeze({});
    const _arpBoundsCache = new WeakMap();
    function arpHsBoundsForNote(n, handShapes, hsInferFlags) {
        if (!handShapes || handShapes.length === 0) return null;
        const cached = _arpBoundsCache.get(n);
        if (cached !== undefined) return cached === _ARP_BOUNDS_NULL ? null : cached;
        let result = null;
        for (let i = 0; i < handShapes.length; i++) {
            if (hsInferFlags && !hsInferFlags[i]) continue;
            const hs = handShapes[i];
            const lo = hsStart(hs);
            const hi = hsEnd(hs);
            if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
            if (n.t + 1e-4 < lo || n.t > hi + 1e-4) continue;
            result = { start: lo, end: hi };
            break;
        }
        _arpBoundsCache.set(n, result === null ? _ARP_BOUNDS_NULL : result);
        return result;
    }

    function handShapeIsArpeggioForLaneRail(hs, chordTemplates) {
        return handShapeMarkedArpeggio(hs, chordTemplates);
    }

    /**
     * Chart-time window for purple rails: hand-shape span clipped to matching
     * ``chords[].t`` and template notes in the passage — same times that drive
     * the 3D arpeggio frame (``ch.t`` + note stream), avoiding rails that start
     * before the box or end before the last arpeggiated note.
     */
    function effectiveArpRailChartBoundsForHandShape(hs, chords, chordTemplates, notesArr) {
        let shapeLo = hsStart(hs);
        const _hsEndOrig = hsEnd(hs);
        let shapeHi = _hsEndOrig;
        const cid = hsChordIdNorm(hs);
        if (Number.isNaN(shapeLo) || Number.isNaN(shapeHi)) {
            return { shapeLo: 1e9, shapeHi: -1e9 };
        }
        if (notesArr && notesArr.length > 0 && chordTemplates && cid != null) {
            const tmpl = chordTemplates[cid] ?? chordTemplates[Number(cid)];
            if (tmpl && Array.isArray(tmpl.frets)) {
                let tFirst = null;
                let tLast = null;
                for (let i = 0; i < notesArr.length; i++) {
                    const n = notesArr[i];
                    if (n.t + 1e-4 < shapeLo - 0.18 || n.t > shapeHi + 0.45) continue;
                    if (!validString(n.s)) continue;
                    const tf = tmpl.frets[n.s];
                    if (typeof tf !== 'number' || tf < 0 || n.f !== tf) continue;
                    if (tFirst === null || n.t < tFirst) tFirst = n.t;
                    if (tLast === null || n.t > tLast) tLast = n.t;
                }
                if (tFirst != null) shapeLo = Math.max(shapeLo, tFirst);
                if (tLast != null) shapeHi = Math.max(shapeHi, tLast);
            }
        }
        if (chords && chords.length && cid != null) {
            let tMinC = null;
            let tMaxC = null;
            for (let j = 0; j < chords.length; j++) {
                const ch = chords[j];
                if (ch.id !== cid && Number(ch.id) !== Number(cid)) continue;
                if (ch.t + 1e-4 < shapeLo || ch.t > shapeHi + 0.28) continue;
                if (tMinC === null || ch.t < tMinC) tMinC = ch.t;
                if (tMaxC === null || ch.t > tMaxC) tMaxC = ch.t;
            }
            if (tMinC != null) shapeLo = Math.max(shapeLo, tMinC);
            if (tMaxC != null) shapeHi = Math.max(shapeHi, tMaxC);
        }
        shapeLo -= ARP_HWY_RAIL_START_LEAD_S;
        // Only extend past the handshape end when notes/chords genuinely reach
        // beyond it — otherwise the tail would make the rail visually larger
        // than the actual handshape duration (e.g. 0.38 s / 1.3 s ≈ 29% extra).
        if (shapeHi > _hsEndOrig) shapeHi += ARP_HWY_RAIL_END_TAIL_S;
        return { shapeLo, shapeHi };
    }

    /** Cache the authored arpeggio marker per hand shape. */
    function fillLaneRailHandShapeFlags(handShapes, chordTemplates, outFlags) {
        const nHs = handShapes.length;
        for (let i = 0; i < nHs; i++) {
            outFlags[i] = handShapeIsArpeggioForLaneRail(handShapes[i], chordTemplates);
        }
    }

    function fillArpeggioRailShapeBoundsCaches(
        handShapes, chords, chordTemplates, notesArr, laneRailFlags, loOut, hiOut,
    ) {
        const nHs = handShapes.length;
        for (let i = 0; i < nHs; i++) {
            if (!laneRailFlags[i]) continue;
            const b = effectiveArpRailChartBoundsForHandShape(
                handShapes[i], chords, chordTemplates, notesArr,
            );
            loOut[i] = b.shapeLo;
            hiOut[i] = b.shapeHi;
        }
    }

    /** ``[tChartLo,tChartHi]`` chart times that a lane slice covers (see module ``BEHIND`` / approach ``dt``). */
    function arpeggioLaneOuterRailChartIntervalOverlaps(
        tChartLo,
        tChartHi,
        handShapes,
        boundLo,
        boundHi,
        laneRailFlags,
    ) {
        if (!handShapes || handShapes.length === 0) return false;
        if (!laneRailFlags) return false;
        if (tChartHi < tChartLo) {
            const s = tChartLo;
            tChartLo = tChartHi;
            tChartHi = s;
        }
        for (let i = 0; i < handShapes.length; i++) {
            if (!laneRailFlags[i]) continue;
            const shapeLo = boundLo[i];
            const shapeHi = boundHi[i];
            if (tChartHi < shapeLo - 1e-4 || tChartLo > shapeHi + 1e-4) continue;
            return true;
        }
        return false;
    }

    function arpeggioLaneOuterRailLaneSlice(
        dt0, dt1, nowClock,
        handShapes, boundLo, boundHi, laneRailFlags,
    ) {
        const tLo = nowClock + Math.min(dt0, dt1) - BEHIND;
        const tHi = nowClock + Math.max(dt0, dt1) - BEHIND;
        return arpeggioLaneOuterRailChartIntervalOverlaps(
            tLo, tHi, handShapes, boundLo, boundHi, laneRailFlags,
        );
    }

    /**
     * True when **chart time** ``chartT`` falls inside an arpeggio hand-shape.
     * Uses a short end tail only — no ``CHORD_HWY_LINGER_S`` — so purple lane
     * rails match visible highway slices and do not leak after shapes end.
     */
    function arpeggioLaneOuterRailAtChartTime(
        chartT, handShapes, boundLo, boundHi, laneRailFlags,
    ) {
        return arpeggioLaneOuterRailChartIntervalOverlaps(
            chartT, chartT, handShapes, boundLo, boundHi, laneRailFlags,
        );
    }

    /**
     * Same ``chordAccent ? ft *= 1.22`` as the 3D arpeggio chord rim so lane
     * rails match an accented frame when the active hand shape links to a
     * chord row that carries ``.ac`` notes.
     */
    function arpeggioLaneDividerFrameAccentMul(nowT, handShapes, chords, boundLo, boundHi, laneRailFlags) {
        if (!handShapes || handShapes.length === 0 || !chords || chords.length === 0) return 1;
        if (!laneRailFlags) return 1;
        for (let i = 0; i < handShapes.length; i++) {
            if (!laneRailFlags[i]) continue;
            const shapeLo = boundLo[i];
            const shapeHi = boundHi[i];
            if (nowT + 1e-4 < shapeLo || nowT > shapeHi + 1e-4) continue;

            const cid = hsChordIdNorm(handShapes[i]);
            if (cid == null) return 1;
            for (let j = 0; j < chords.length; j++) {
                const ch = chords[j];
                if (ch.id !== cid && Number(ch.id) !== Number(cid)) continue;
                if (Math.abs(ch.t - hsStart(handShapes[i])) > 0.12) continue;
                const chordNotes = ch.notes ? filterValidNotes(ch.notes) : [];
                if (chordNotes.some(cn => cn.ac)) return 1.22;
                return 1;
            }
            return 1;
        }
        return 1;
    }
    // Frame gate: skip the merge when inputs are identity-equal to the last
    // frame's; mergeHandShapeSynthChords is chart-static.
    function mergeHandShapeSynthChordsCached(chords, handShapes, chordTemplates) {
        if (_mergeCacheResult !== null
            && _mergeCacheChordsRef === chords
            && _mergeCacheHsRef === handShapes
            && _mergeCacheTplRef === chordTemplates) {
            return _mergeCacheResult;
        }
        const merged = mergeHandShapeSynthChords(chords, handShapes, chordTemplates);
        _mergeCacheResult = merged;
        _mergeCacheChordsRef = chords;
        _mergeCacheHsRef = handShapes;
        _mergeCacheTplRef = chordTemplates;
        return merged;
    }

    return {
        setStringCount(n) { nStr = n; },
        rearmOobWarning() { _oobStringWarned = false; },
        _resetStringDependentCaches,
        arpHsBoundsForNote,
        arpeggioChordIdForNoteWithInferCache,
        arpeggioLaneDividerFrameAccentMul,
        arpeggioLaneOuterRailAtChartTime,
        arpeggioLaneOuterRailLaneSlice,
        chordHandShapeArpeggioHint,
        chordShapeCoveredByStandaloneNotes,
        chordShapeSignature,
        chordTemplateLabel,
        chordTemplateMarkedArpeggio,
        chordWireHighDensity,
        fillArpeggioGhostInferFlags,
        fillArpeggioRailShapeBoundsCaches,
        fillLaneRailHandShapeFlags,
        filterValidNotes,
        handShapeChartSpanSec,
        hsEnd,
        hsStart,
        inferArpeggioFromNotePattern,
        mergeChordShape,
        mergeHandShapeSynthChords,
        mergeHandShapeSynthChordsCached,
        validString,
    };
}
