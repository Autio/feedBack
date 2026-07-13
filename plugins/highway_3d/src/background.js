// Background and venue subsystem: the shared audio analyser bridge, scene
// color themes, the venue stage scene (POV plates, motion, silhouette), the
// localStorage settings store, and every window.h3dBgSet* settings setter.
import {
    CAMERA_MODE_IDS,
    CHORD_DIAG_POSITION_IDS,
    FOG_END,
    FOG_START,
    K,
    MAX_RENDER_STRINGS,
    PALETTES,
    PALETTE_IDS,
    VENUE_BACKDROP_DISTANCE_MUL,
    VENUE_HAZE_STEADY,
    _applyFretSpacingMode,
    _h3dHexToInt,
} from './geometry.js';
import { T } from './three-loader.js';

/* ======================================================================
 *  Background animations (issue #13)
 *
 *  Audio-reactive ambient scenery in the fog band beyond the highway.
 *  Module-level singletons share an AudioContext + AnalyserNode tap on
 *  the feedBack core <audio id="audio"> element across all panel
 *  instances; per-panel settings live in localStorage with a global
 *  fallback so settings.html drives a single default while per-panel
 *  overrides (h3d_bg_panel<idx>_*) can be set for splitscreen layouts.
 *
 *  Caveat: createMediaElementSource() can only be called once per
 *  element. 3dhighway owns that source for now; future plugins
 *  needing an analyser will have to share through a core API.
 * ====================================================================== */

// Returned from _bgReadBands when reactive=false or analyser
// unavailable; shared so the per-frame non-reactive path doesn't
// allocate. Declared up-front because _bgBandsCache initializes to
// it during the same IIFE execution pass.
export const BG_ZERO_BANDS = Object.freeze({ bass: 0, mid: 0, treble: 0 });

// Module-level AudioContext singleton. Intentionally never torn
// down: createMediaElementSource(<audio>) is irrevocable — once
// called, the element's audio is permanently routed through this
// context for the page's lifetime. Closing the context would
// silence playback. The leak (one AudioContext + one AnalyserNode,
// a few KB) is the cost of having a plugin tap audio at all.
let _bgAudio = null;
// The core (#audio-tap) cache is held separately from the stems cache so
// we can switch back to it without re-calling createMediaElementSource on
// #audio — that call is one-shot per element, and a second one throws
// InvalidStateError (which would then be marked permanent and disable
// reactivity forever on legacy songs after any sloppak detour).
let _bgAudioCore = null;
let _bgAudioFailedAt = 0;  // performance.now() of last failure, 0 = never

// Test hook: drops every cached analyser bridge (used by the __test API).
export function _bgResetAnalyserBridgeForTest() {
    _bgBridgeKeys.clear(); _bgAudio = null; _bgAudioCore = null; _bgAudioFailedAt = 0;
}
const _BG_AUDIO_RETRY_MS = 1000;
// _bgReadBands sums bins 0..7 (bass), 8..39 (mid), 40..127 (treble),
// so the frequency buffer must hold at least 128 bins regardless of
// the source analyser's fftSize.
const BG_FREQ_BINS = 128;
const _bgBridgeKeys = new Map();

window.h3dSetFretSpacing = mode => {
    // Validate against the two supported modes before persisting so an
    // unexpected input can't leave an invalid value in localStorage. No-op
    // when the stored mode is already what was requested.
    const m = mode === 'logarithmic' ? 'logarithmic' : 'uniform';
    try {
        if (localStorage.getItem('highway_3d.fretSpacing') === m) return;
        localStorage.setItem('highway_3d.fretSpacing', m);
    } catch (_) {}
    // Apply live rather than reloading the page: a reload reboots the SPA
    // to the home screen, ejecting the user from Settings. Broadcast the
    // change so every mounted panel rebuilds its board.
    _applyFretSpacingMode(m);
    _bgEmitChange('fretSpacing');
};
function _bgRecordAudioBridge(bridgeId, legacySurface, outcome = 'handled', reason = '', status = 'used') {
    const key = `${outcome}:${status}:${reason}`;
    if (_bgBridgeKeys.get(bridgeId) === key) return;
    _bgBridgeKeys.set(bridgeId, key);
    const session = window.feedBack && window.feedBack.audioSession;
    if (!session || typeof session.recordBridgeHit !== 'function') return;
    try {
        session.recordBridgeHit({
            domain: 'audio-mix',
            bridgeId,
            legacySurface,
            participantId: 'highway_3d',
            outcome,
            status,
            reason,
        });
    } catch (_) { /* diagnostics are best-effort */ }
}

export function _bgGetAnalyser() {
    // Prefer the stems plugin's side-chain analyser when a sloppak is
    // loaded. As of feedBack-plugin-stems 0.5.0 (sample-locked playback)
    // the #audio element is a silent virtual transport on sloppaks, so
    // tapping it sees only silence; the stems mix is exposed at
    // window.feedBack.stems.getAnalyser() instead. The stems plugin
    // creates and destroys that AnalyserNode per song, so we re-check
    // each call and key the cache on its identity — when the node
    // changes (song switch), the cache is replaced automatically.
    const stemsApi = window.feedBack && window.feedBack.stems;
    const stemsAnalyser = (stemsApi && typeof stemsApi.getAnalyser === 'function')
        ? stemsApi.getAnalyser() : null;
    if (stemsAnalyser) {
        if (!_bgAudio || _bgAudio.source !== 'stems' || _bgAudio.analyser !== stemsAnalyser) {
            // Adopt the live stems analyser. Do NOT close its context — it's
            // shared with stem playback and the stems plugin owns its
            // lifecycle. No play-event resume hooks either; the stems
            // plugin manages context resume itself.
            _bgAudio = {
                ctx: stemsAnalyser.context,
                analyser: stemsAnalyser,
                // _bgReadBands reads bins 0..127 unconditionally. Always
                // allocate at least 128 bytes so a smaller analyser (e.g.
                // fftSize < 256) can't leave undefined values in the loop.
                freq: new Uint8Array(Math.max(BG_FREQ_BINS, stemsAnalyser.frequencyBinCount)),
                source: 'stems',
            };
            _bgRecordAudioBridge('audio-mix.analyser', 'window.feedBack.stems.getAnalyser', 'handled', '', 'stems');
        }
        return _bgAudio;
    }
    // No sloppak active — drop a stale stems-sourced cache, restoring the
    // core-tap cache if we'd already built one. Without this, the next
    // step would try to createMediaElementSource(#audio) a second time
    // (one-shot per element) and throw InvalidStateError — disabling
    // reactivity for the rest of the page lifetime.
    if (_bgAudio && _bgAudio.source === 'stems') _bgAudio = _bgAudioCore;

    if (_bgAudio && !_bgAudio.failed) return _bgAudio;
    if (_bgAudio && _bgAudio.failed) {
        // Distinguish permanent failures from transient ones.
        // InvalidStateError on createMediaElementSource means the
        // <audio> element is already tapped by another consumer —
        // there's no recovering from that without a page reload, so
        // don't retry. Transient failures (NotAllowedError before
        // first user gesture, etc.) get a once-per-second retry so
        // reactivity recovers once the blocking condition clears.
        if (_bgAudio.permanent) return null;
        if (performance.now() - _bgAudioFailedAt < _BG_AUDIO_RETRY_MS) return null;
    }
    const audio = document.getElementById('audio');
    if (!audio) return null;
    // Shared tap: createMediaElementSource is one-shot per element, so
    // the FIRST visualizer to tap #audio publishes it at
    // window.__feedBackAudioTap and every later one (this plugin, the
    // drum/keys 3D highways) adopts it instead of throwing
    // InvalidStateError when visualizers are switched or mixed in
    // splitscreen.
    const sharedTap = window.__feedBackAudioTap;
    if (sharedTap && sharedTap.analyser && sharedTap.mediaEl === audio) {
        _bgAudio = {
            ctx: sharedTap.ctx,
            analyser: sharedTap.analyser,
            freq: new Uint8Array(Math.max(BG_FREQ_BINS, sharedTap.analyser.frequencyBinCount)),
            source: 'core',
        };
        _bgAudioCore = _bgAudio;
        _bgRecordAudioBridge('audio-mix.analyser', 'shared #audio analyser tap', 'handled', '', 'core');
        return _bgAudio;
    }
    // Hoist ctx out of the try so we can close() it if a later step
    // throws (e.g. createMediaElementSource on an element that
    // already has a source node). Otherwise the AudioContext leaks.
    let ctx = null;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('Web Audio API not available');
        ctx = new Ctx();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        _bgAudio = { ctx, analyser, freq: new Uint8Array(Math.max(BG_FREQ_BINS, analyser.frequencyBinCount)), source: 'core' };
        try { window.__feedBackAudioTap = { ctx, analyser, mediaEl: audio }; } catch (_) {}
        _bgRecordAudioBridge('audio-mix.analyser', 'HTMLAudioElement analyser tap', 'handled', '', 'core');
        // Remember the core analyser so a later stems-then-back-to-core
        // transition can re-use it instead of re-tapping #audio (which
        // would throw InvalidStateError on the one-shot per element).
        _bgAudioCore = _bgAudio;
        // Browsers with autoplay restrictions hand back a suspended
        // AudioContext; createMediaElementSource then routes the
        // <audio> through that suspended graph and playback goes
        // silent (and the analyser reads zeros) until we resume.
        // Try once now (fine if the page already had a user gesture)
        // and again on every play event so the first successful
        // user-initiated play unblocks the graph.
        const resume = () => {
            if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                ctx.resume().catch(() => { /* no gesture yet, retry on next play */ });
            }
        };
        resume();
        audio.addEventListener('play', resume);
        return _bgAudio;
    } catch (e) {
        if (ctx && typeof ctx.close === 'function') {
            try { ctx.close(); } catch (_) { /* close errors during failure path are noise */ }
        }
        console.warn('[3D-Hwy] failed to set up audio analyser:', e);
        const permanent = !!(e && e.name === 'InvalidStateError');
        _bgRecordAudioBridge('audio-mix.analyser', 'HTMLAudioElement analyser tap', 'failed', e && e.message ? e.message : String(e), permanent ? 'permanent-failure' : 'transient-failure');
        _bgAudio = { failed: true, permanent };
        _bgAudioFailedAt = performance.now();
        return null;
    }
}

// Bands cache: in splitscreen, every panel asks for bands per frame.
// The analyser is shared, so the answer is identical — cache for a
// few ms so 4-up splitscreen pays one getByteFrequencyData + one sum
// pass per frame instead of four.
const _BG_BANDS_CACHE_MS = 5;
let _bgBandsLastT = -Infinity;
// Mutable cache reused across reads — refreshing in place keeps the
// per-frame allocation count at zero. Style.update() uses the bands
// synchronously within the same frame so the live-mutation contract
// is safe.
const _bgBandsCache = { bass: 0, mid: 0, treble: 0 };
export function _bgReadBands() {
    const a = _bgGetAnalyser();
    if (!a) return BG_ZERO_BANDS;
    const t = performance.now();
    if (t - _bgBandsLastT < _BG_BANDS_CACHE_MS) return _bgBandsCache;
    _bgBandsLastT = t;
    a.analyser.getByteFrequencyData(a.freq);
    let bass = 0, mid = 0, treble = 0;
    for (let i = 0; i < 8; i++) bass += a.freq[i];
    for (let i = 8; i < 40; i++) mid += a.freq[i];
    for (let i = 40; i < 128; i++) treble += a.freq[i];
    _bgBandsCache.bass = bass / (8 * 255);
    _bgBandsCache.mid = mid / (32 * 255);
    _bgBandsCache.treble = treble / (88 * 255);
    return _bgBandsCache;
}

export const BG_DEFAULTS = { style: 'particles', intensity: 0.5, reactive: true, palette: 'default', bgTheme: 'default', hwTheme: 'default', showFretOnNote: true, fretNumberGhostScope: 'chords', cameraSmoothing: 0.5, zoomSmoothing: 0.5, tiltSmoothing: 0.5, cameraLockLow: false, cameraLockZoom: 0.5, cameraMode: 'lookahead', nutHeadstockVisible: true, tuningLabelsVisible: true, nutColor: '#f5f3f0', headstockColor: '#d4b48a', textSize: 0.5, vibrancy: 0.85, glow: 0.25, customImageDataUrl: '', customImageName: '', customVideoName: '', chordDiagramVisible: true, chordDiagramSize: 0.5, chordDiagramPosition: 'tl', fretColumnMarkerCadence: 1, projectionVisible: true, inlayLabelsVisible: false, sectionLabelsOnHighway: false, sectionHudVisible: false, sectionHudPosition: 'tr', sectionHudSize: 0.5, toneHudVisible: false, toneHudPosition: 'tl', toneHudSize: 0.5, fpsVisible: false, fretDividersVisible: true, slideArrowApproachVisible: true, slideArrowNeckVisible: true, slideArrowChainPreviewVisible: true, hitFx: 0.7, sparks: true, cinematic: true, verdictMarks: true, timingFx: true, streakFx: true, bloom: true };
// User-selectable, persistable bg styles — must mirror settings.html's
// VALID_STYLES. 'venue' is deliberately NOT here: it is an internal effective
// style reached only via _venueSceneOverride (the viz-picker Venue flow), so
// _bgCoerce must reject a stored h3d_bg_style='venue' — otherwise venue could
// mount outside that flow and settings.html (which can't represent 'venue')
// would be unable to switch back. BG_STYLES still has a 'venue' renderer entry.
const BG_STYLE_IDS = ['off', 'particles', 'silhouettes', 'lights', 'geometric', 'butterchurn', 'image', 'video'];
// Scene color themes — TWO INDEPENDENT AXES sharing one palette family.
// The combined `BG_THEMES` table below is the single source of truth; each
// entry carries the colors for BOTH axes, but the two axes are selected and
// applied SEPARATELY (two dropdowns, two settings keys):
//   • BACKGROUND axis (setting key `bgTheme`) owns:
//       clear — WebGL clear color (the empty background behind everything)
//       fog   — distance fog tint (kept === clear so the horizon dissolves
//               cleanly instead of showing a seam)
//   • HIGHWAY axis (setting key `hwTheme`) owns:
//       board   — the fretboard / highway-surface plane color
//       lane    — the lit highway lane strip under the gems (optional)
//       laneDim — the lane's dimmer alternating row (optional)
// Because both axes read from the SAME id-set (the keys of this table), ANY
// background id can mix with ANY highway id (e.g. Deep Focus background +
// Cathode Green highway); picking the SAME id in both gives the original
// "matched" combined look. _bgBackgroundColors()/_bgHighwayColors() below
// are the per-axis accessors; both fall back to 'default' for unknown ids.
// 'default' reproduces the original look byte-for-byte on BOTH axes, so
// existing users (and anyone who never touches either setting) see no
// change. A migration in _bgLoadSettings() makes an existing single-`bgTheme`
// pick drive BOTH axes until the user diverges them, so upgrades are
// visually identical too. All themes keep the board very dark and the
// background dark so the bright per-string note gems, lane, and labels
// retain contrast. NOTE: settings.html mirrors these ids in its
// VALID_BG_THEMES set (shared by both dropdowns) — keep them in sync.
// Optional `lane` / `laneDim` fields retint the lit highway lane strip + its
// dimmer alternating row. A theme that omits them falls back to the stock
// blue lane (HWY_LANE_STRIPE_ODD_HEX / _EVEN_HEX); only 'default' relies on
// that fallback (so its output stays byte-identical). Every other theme sets
// its own lane so the Highway axis is visibly distinct entry-to-entry — the
// near-black neutral boards alone aren't separable, so the lane carries it.
// See _applyBgTheme().
const BG_THEMES = {
    default:    { clear: 0x101820, fog: 0x101820, board: 0x08080e },
    // Cool navy surface + a brighter pure-blue lane, so it reads distinct
    // from 'default' (neutral board + stock teal-blue lane) on the Highway axis.
    midnight:   { clear: 0x0a0e1a, fog: 0x0a0e1a, board: 0x080d1c, lane: 0x244fae, laneDim: 0x122a5e },
    // Lighter NEUTRAL-grey surface + a steel-grey lane — the only mid-dark
    // neutral board, so the surface itself is visibly different from the
    // near-black neutrals around it (board kept dark enough for gem contrast).
    charcoal:   { clear: 0x16181c, fog: 0x16181c, board: 0x141417, lane: 0x525a66, laneDim: 0x282d34 },
    deeppurple: { clear: 0x140a1e, fog: 0x140a1e, board: 0x0b0610, lane: 0x3a1f6e, laneDim: 0x1f1040 },
    forest:     { clear: 0x0a1614, fog: 0x0a1614, board: 0x06100c, lane: 0x15602a, laneDim: 0x0a3318 },
    // Warm dark neutral (espresso/umber) — the first non-cool scene.
    warmslate:  { clear: 0x1c130b, fog: 0x1c130b, board: 0x0e0805, lane: 0x5e3a12, laneDim: 0x341f0a },
    // Recessive near-black neutral (a hair above #000000, ~zero chroma) —
    // maximizes gem-vs-board contrast; a clean stage/stream look. Purest-dark
    // board + a clean steel-cyan lane (brighter/cooler than 'default's muted
    // teal-blue) so the Highway axis reads clearly distinct from default.
    deepfocus:  { clear: 0x0c0c0d, fog: 0x0c0c0d, board: 0x060606, lane: 0x2f7fa0, laneDim: 0x163c4e },
    // Calm dark teal — blue-dominant so it reads distinct from the navy
    // 'midnight' and the green 'forest'.
    deepsea:    { clear: 0x06222b, fog: 0x06222b, board: 0x03141a, lane: 0x0e5a63, laneDim: 0x063338 },
    // Retro CRT glow — a warm AMBER phosphor cast (the classic amber
    // terminal). Amber rather than green so a phosphor board can't crush
    // green/teal gems, and so it stays clearly distinct from 'forest' and
    // 'deepsea'. Board stays very dark / low-chroma to keep gems popping.
    cathode:    { clear: 0x140b03, fog: 0x140b03, board: 0x0c0702, lane: 0x6e4a0e, laneDim: 0x3a2806 },
    // Retro CRT GREEN phosphor — leaned more saturated / cyan-green than
    // 'forest' so it reads as a terminal, not woodland (dRGB 35 vs forest,
    // 32 vs deepsea). Phosphor-green board + green lane. Verified to keep
    // green/teal gems legible (green-on-green floor CR ~2.2).
    cathodegreen: { clear: 0x07301a, fog: 0x07301a, board: 0x031a0c, lane: 0x0e6e2a, laneDim: 0x073a18 },
    // Warm hearth — the first warm-RED scene, pairs with the Ember/Sunrise
    // strings. Deep red, pushed away from the amber 'cathode'/'warmslate'
    // (dRGB ~26 from cathode). Ember-red lane.
    hearth:     { clear: 0x280806, fog: 0x280806, board: 0x1a0606, lane: 0x7a2410, laneDim: 0x3f1409 },
};
const BG_THEME_IDS = Object.keys(BG_THEMES);
// Shared lookup for the combined entry (both axes are keyed by the same id
// set, so a single id list / coerce check validates either axis).
function _bgThemeColors(id) { return BG_THEMES[id] || BG_THEMES.default; }
// Per-axis accessors. Background reads clear/fog; highway reads
// board/lane/laneDim. They alias the same table — splitting at read-time
// keeps one source of truth while letting the two dropdowns pick freely.
export function _bgBackgroundColors(id) { return _bgThemeColors(id); }
export function _bgHighwayColors(id) { return _bgThemeColors(id); }
const VENUE_SCENE_ASSET_BASE = '/static/assets/venue/themes/small-club/';
const VENUE_BG_PLATE_WEBP = 'bg-plate.webp';
const VENUE_INSTRUMENT_PLATES = {
    guitar: { webp: 'guitar-pov-bg.webp' },
    bass: { webp: 'bass-pov-bg.webp' },
    drums: { webp: 'drums-pov-bg.webp' },
    piano: { webp: 'piano-pov-bg.webp' },
    vocals: { webp: 'vocals-pov-bg.webp' },
};
export let _venueSceneOverride = false;
let _venueMoodState = 'idle';
let _venueInstrumentPov = 'guitar';
let _venueMotionMode = 'subtle';
let _venuePlateUrl = '';
let _venueSceneAssetsLoaded = false;
let _venueSceneLoadFailed = false;
const _venueTextureCache = new Map();

function _bgVenueMoodCoeffs(state) {
    const s = String(state || 'idle').toLowerCase();
    if (s === 'fire' || s === 'strong') {
        return { light: 1.0, crowd: 0, haze: 0.012, warmth: 1.02 };
    }
    if (s === 'recovery' || s === 'smoke') {
        return { light: 0.55, crowd: 0, haze: 0.032, warmth: 0.94 };
    }
    return { light: 0.72, crowd: 0, haze: VENUE_HAZE_STEADY, warmth: 0.96 };
}

function _venueResolvePovFromInput(input) {
    if (typeof window !== 'undefined' && window.v3VenueInstrumentPov &&
        typeof window.v3VenueInstrumentPov.resolveVenueInstrumentPov === 'function') {
        return window.v3VenueInstrumentPov.resolveVenueInstrumentPov(input);
    }
    const s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s) return 'guitar';
    if (/\b(drums?)\b/.test(s)) return 'drums';
    if (/\b(bass)\b/.test(s)) return 'bass';
    if (/\b(piano|keys|keyboard)\b/.test(s)) return 'piano';
    if (/\b(karaoke|vocal|vocals|lyric|lyrics|sing|singing)\b/.test(s)) return 'vocals';
    if (/\b(lead|rhythm|guitar|combo)\b/.test(s)) return 'guitar';
    return 'guitar';
}

function _venueMotionProfile(mode) {
    if (typeof window !== 'undefined' && window.v3VenueMoodFx &&
        typeof window.v3VenueMoodFx.venueMotionProfile === 'function') {
        return window.v3VenueMoodFx.venueMotionProfile(mode);
    }
    const m = String(mode || 'subtle').toLowerCase();
    if (m === 'off') {
        return { breathe: 0, parallax: 0, hazeDrift: 0, warmthPulse: 0, shimmer: 0 };
    }
    if (m === 'full') {
        return { breathe: 0.014, parallax: 0.010, hazeDrift: 0.020, warmthPulse: 0.028, shimmer: 0.10 };
    }
    return { breathe: 0.005, parallax: 0.004, hazeDrift: 0.007, warmthPulse: 0.010, shimmer: 0.04 };
}

function _venuePrefersReducedMotion() {
    if (typeof window !== 'undefined' && window.v3VenueMoodFx &&
        typeof window.v3VenueMoodFx.prefersReducedMotion === 'function') {
        return window.v3VenueMoodFx.prefersReducedMotion();
    }
    return false;
}

function _venueEffectiveMotionMode() {
    if (!_venueSceneOverride) return 'off';
    if (_venuePrefersReducedMotion()) return 'off';
    return _venueMotionMode;
}

function _venueApplyFakeDepthMotion(s, coeffs, t) {
    const motion = _venueMotionProfile(_venueEffectiveMotionMode());
    if (!motion.breathe && !motion.parallax && !motion.hazeDrift && !motion.warmthPulse) {
        if (s.haze && s.haze.mesh) {
            s.haze.mesh.position.set(s.haze.baseX, s.haze.baseY, s.haze.baseZ);
        }
        return motion;
    }
    const breath = Math.sin(t * 0.38);
    const parallax = Math.sin(t * 0.21);
    const shimmer = Math.sin(t * 0.55);
    if (s.backdrop && s.backdrop.loaded && s.backdrop.mesh) {
        const mesh = s.backdrop.mesh;
        const vh = s.backdrop.lastVisibleHeight || 1;
        const vw = s.backdrop.lastVisibleWidth || vh;
        const offX = parallax * motion.parallax * vh;
        const offY = breath * motion.breathe * vh * 0.35;
        mesh.position.x += offX;
        mesh.position.y += offY;
        const scaleMul = 1 + breath * motion.breathe * 2.5;
        mesh.scale.set(vw * scaleMul, vh * scaleMul, 1);
        if (s.backdrop.mat) {
            const warm = coeffs.warmth;
            const warmPulse = 1 + shimmer * motion.warmthPulse;
            s.backdrop.mat.color.setRGB(
                warm * warmPulse,
                warm * 0.98 * warmPulse,
                warm * 0.95 * (1 + shimmer * motion.warmthPulse * 0.6),
            );
        }
    } else if (s.backdrop && s.backdrop.mat) {
        const warm = coeffs.warmth;
        s.backdrop.mat.color.setRGB(warm, warm * 0.98, warm * 0.95);
    }
    if (s.haze && s.haze.mesh) {
        const driftX = Math.sin(t * 0.18) * motion.hazeDrift * 8 * K;
        const driftY = Math.cos(t * 0.14) * motion.hazeDrift * 4 * K;
        s.haze.mesh.position.set(
            s.haze.baseX + driftX,
            s.haze.baseY + driftY,
            s.haze.baseZ,
        );
        if (s.haze.mat) {
            const baseOp = (s.haze.baseOp || VENUE_HAZE_STEADY) * (coeffs.haze / VENUE_HAZE_STEADY);
            s.haze.mat.opacity = baseOp * (1 + shimmer * motion.shimmer * 0.12);
        }
    }
    return motion;
}

function _venuePlateUrlChain(pov) {
    const plate = VENUE_INSTRUMENT_PLATES[pov] || VENUE_INSTRUMENT_PLATES.guitar;
    const base = VENUE_SCENE_ASSET_BASE;
    return [
        base + plate.webp,
        base + VENUE_BG_PLATE_WEBP,
    ];
}

function _venueLoadCachedTexture(loader, url, onSuccess, onFail) {
    const cached = _venueTextureCache.get(url);
    if (cached) {
        onSuccess(cached, url);
        return;
    }
    loader.load(
        url,
        (tex) => {
            _venueTextureCache.set(url, tex);
            onSuccess(tex, url);
        },
        undefined,
        onFail,
    );
}

function _venueApplyPlateTexture(backdrop, tex, url) {
    backdrop.tex = tex;
    backdrop.plateUrl = url;
    _venuePlateUrl = url;
    backdrop.mat.map = tex;
    backdrop.mat.needsUpdate = true;
    if (backdrop.applyCoverCrop) backdrop.applyCoverCrop();
    backdrop.loaded = true;
    backdrop.mesh.visible = true;
}

function _venueLoadPlateForPov(loader, pov, backdrop, onSuccess, onFail) {
    const chain = _venuePlateUrlChain(pov);
    let idx = 0;
    function tryNext() {
        if (idx >= chain.length) {
            onFail();
            return;
        }
        const url = chain[idx++];
        _venueLoadCachedTexture(loader, url, (tex, loadedUrl) => {
            _venueApplyPlateTexture(backdrop, tex, loadedUrl);
            onSuccess(tex, loadedUrl);
        }, tryNext);
    }
    tryNext();
}

export function _venueSwapPlateIfNeeded(s) {
    if (!s || s.failed || s.plateLoading || !s.loader || !s.backdrop) return;
    const pov = _venueInstrumentPov;
    if (s.instrumentPov === pov && s.backdrop.loaded) return;
    s.plateLoading = true;
    _venueLoadPlateForPov(
        s.loader,
        pov,
        s.backdrop,
        () => {
            s.instrumentPov = pov;
            s.plateLoading = false;
            s.loaded = true;
            _venueSceneAssetsLoaded = true;
            _venueSceneLoadFailed = false;
            // The POV may have changed while this load was in flight (the
            // plateLoading latch made concurrent swaps no-op). Re-sync to the
            // current target so the backdrop isn't stranded on a stale plate.
            if (_venueInstrumentPov !== pov) _venueSwapPlateIfNeeded(s);
        },
        () => {
            s.plateLoading = false;
            if (s.backdrop.loaded) return;
            s.failed = true;
            _venueSceneLoadFailed = true;
            _venueSceneAssetsLoaded = false;
            console.warn('[venue-scene] failed to load venue bg plate for pov ' + pov);
            _venueSceneOverride = false;
            _bgEmitChange('venueScene');
            try {
                if (typeof window !== 'undefined' && window.v3VenueScene3d &&
                    typeof window.v3VenueScene3d.onAssetsFailed === 'function') {
                    window.v3VenueScene3d.onAssetsFailed('failed to load venue bg plate');
                }
            } catch (_) { /* visual-only */ }
        },
    );
}
const FRET_NUMBER_GHOST_SCOPE_IDS = ['chords', 'all'];

/**
 * localStorage panel key for per-panel background settings ('main' or
 * 'panel<index>'). Defensive on the splitscreen global-name rename in flight,
 * and throw-safe on panelIndexFor — same as _freeCamFor — so a misbehaving
 * splitscreen build can't take down background-settings resolution. Only a
 * non-negative integer index yields a 'panel<N>' key; anything else (null,
 * NaN, negative, non-integer) falls back to 'main' so a bad index can never
 * mint a bogus "panelNaN"-style key.
 * @param {HTMLCanvasElement} canvas this renderer's highway canvas
 * @returns {string} 'main' or 'panel<index>'
 */
export function _bgPanelKey(canvas) {
    const ss = window.feedBackSplitscreen || window.slopsmithSplitscreen;
    let idx = null;
    if (ss && typeof ss.panelIndexFor === 'function') {
        try { idx = ss.panelIndexFor(canvas); } catch (e) { idx = null; }
    }
    return (Number.isInteger(idx) && idx >= 0) ? 'panel' + idx : 'main';
}

/**
 * Camera Director bridge resolver. Prefers THIS panel's per-panel camera under
 * splitscreen (window.__h3dCamCtlPanels[panelIndex]) and falls back to the
 * single global (window.__h3dCamCtl); returns null when Camera Director is
 * absent → 100% stock framing. Defensive on the splitscreen global-name rename
 * in flight (feedBackSplitscreen vs slopsmithSplitscreen); throw-safe on
 * panelIndexFor. Mirrors the panel resolution in _bgPanelKey.
 * @param {HTMLCanvasElement} canvas this renderer's highway canvas
 * @returns {object|null} the resolved free-camera bridge, or null
 */
export function _freeCamFor(canvas) {
    const map = window.__h3dCamCtlPanels;
    if (map) {
        const ss = window.feedBackSplitscreen || window.slopsmithSplitscreen;
        if (ss && typeof ss.panelIndexFor === 'function') {
            try {
                const i = ss.panelIndexFor(canvas);
                // Only a non-negative integer indexes the map (same hardening
                // as _bgPanelKey) — a non-int / negative / string index must not
                // resolve an unintended/inherited property; fall through then.
                if (Number.isInteger(i) && i >= 0 && map[i]) return map[i];
            } catch (e) { /* ignore */ }
        }
    }
    return window.__h3dCamCtl || null;
}
// In-memory fallback for when localStorage is blocked (private mode,
// sandboxed iframes, some test runners). _bgWriteGlobal stages the
// value here unconditionally, so it always reflects the most recent
// in-session intent — _bgReadSetting prefers it over the global
// localStorage slot to avoid serving a stale persisted value when
// a write failed silently (quota exceeded, etc.). Per-panel
// localStorage overrides still win because they're an explicit
// per-instance opt-out and shouldn't be shadowed by a global edit.
export const _bgMemFallback = Object.create(null);
export function _bgReadSetting(panelKey, key) {
    let panelVal = null;
    let globalVal = null;
    try {
        // 'palette' + 'customColors' are GLOBAL-only: the per-panel palette
        // control was removed in favour of the global "Highway String Colors"
        // UI, so a panel must never be shadowed by a stale per-panel override
        // (h3d_bg_panel<idx>_palette / _customColors). Neither is a
        // BG_DEFAULTS key, so per-panel scoping never applied to them.
        if (key !== 'palette' && key !== 'customColors') {
            panelVal = localStorage.getItem('h3d_bg_' + panelKey + '_' + key);
        }
        globalVal = localStorage.getItem('h3d_bg_' + key);
    } catch (_) { /* storage blocked — both stay null */ }
    if (panelVal !== null && panelVal !== undefined) return _bgCoerce(key, panelVal);
    // Prefer the in-memory staged value over the persisted global slot.
    // _bgWriteGlobal always writes to _bgMemFallback first, so the
    // memory value is at least as fresh as the persisted one.
    if (key in _bgMemFallback) return _bgCoerce(key, _bgMemFallback[key]);
    if (globalVal !== null && globalVal !== undefined) return _bgCoerce(key, globalVal);
    return BG_DEFAULTS[key];
}
// Shared "stored string -> bool" coercion for every boolean
// setting. Mirrors settings.html's coerceBool so the renderer and
// the UI hydration always agree on what a corrupted/unknown value
// means (fall back to default rather than silently flipping to
// false). Add new boolean keys to BG_DEFAULTS and they pick this
// up via the dispatch below.
const _BG_BOOL_KEYS = new Set(['reactive', 'showFretOnNote', 'cameraLockLow', 'inlayLabelsVisible', 'sectionLabelsOnHighway', 'sectionHudVisible', 'nutHeadstockVisible', 'tuningLabelsVisible', 'projectionVisible', 'chordDiagramVisible', 'fpsVisible', 'toneHudVisible', 'fretDividersVisible', 'slideArrowApproachVisible', 'slideArrowNeckVisible', 'slideArrowChainPreviewVisible', 'sparks', 'cinematic', 'verdictMarks', 'timingFx', 'streakFx', 'bloom']);
function _bgCoerceBool(val, fallback) {
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return fallback;
}
// Settings stored as 0..1 floats. cameraSmoothing controls X-pan
// hysteresis; zoomSmoothing the zoom dead zone; tiltSmoothing the
// vertical-tilt deadband + correction strength. All three slider-
// shaped settings share the same parse + clamp behaviour.
const _BG_FLOAT_KEYS = new Set(['intensity', 'cameraSmoothing', 'zoomSmoothing', 'tiltSmoothing', 'cameraLockZoom', 'textSize', 'vibrancy', 'glow', 'chordDiagramSize', 'sectionHudSize', 'toneHudSize', 'hitFx']);
function _bgCoerce(key, val) {
    if (_BG_FLOAT_KEYS.has(key)) {
        const n = parseFloat(val);
        return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : BG_DEFAULTS[key];
    }
    if (_BG_BOOL_KEYS.has(key)) return _bgCoerceBool(val, BG_DEFAULTS[key]);
    if (key === 'style') return BG_STYLE_IDS.includes(val) ? val : BG_DEFAULTS.style;
    if (key === 'palette') return (PALETTE_IDS.includes(val) || val === 'custom') ? val : BG_DEFAULTS.palette;
    if (key === 'bgTheme') return BG_THEME_IDS.includes(val) ? val : BG_DEFAULTS.bgTheme;
    // Highway axis shares the same id-set as the background axis.
    if (key === 'hwTheme') return BG_THEME_IDS.includes(val) ? val : BG_DEFAULTS.hwTheme;
    if (key === 'chordDiagramPosition')
        return CHORD_DIAG_POSITION_IDS.includes(val) ? val : BG_DEFAULTS.chordDiagramPosition;
    if (key === 'sectionHudPosition')
        return ['tl', 'tr', 'bl', 'br'].includes(val) ? val : BG_DEFAULTS.sectionHudPosition;
    if (key === 'toneHudPosition')
        return ['tl', 'tr', 'bl', 'br'].includes(val) ? val : BG_DEFAULTS.toneHudPosition;
    if (key === 'cameraMode') {
        if (val === 'classic') val = 'steady';
        return CAMERA_MODE_IDS.includes(val) ? val : BG_DEFAULTS.cameraMode;
    }
    if (key === 'fretNumberGhostScope')
        return FRET_NUMBER_GHOST_SCOPE_IDS.includes(val) ? val : BG_DEFAULTS.fretNumberGhostScope;
    if (key === 'nutColor' || key === 'headstockColor') {
        if (typeof val !== 'string') return BG_DEFAULTS[key];
        const t = val.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
        return BG_DEFAULTS[key];
    }
    if (key === 'fretColumnMarkerCadence') {
        const n = parseInt(val, 10);
        if (!Number.isFinite(n)) return BG_DEFAULTS.fretColumnMarkerCadence;
        return Math.max(0, Math.min(16, n));
    }
    return val;
}

// Mirror-at-first-read fallback: returns true if the user has ever
// explicitly written `key` (per-panel, in-memory, or global). When
// false, callers should treat the value as "unset" — useful for
// zoomSmoothing / tiltSmoothing which inherit cameraSmoothing's
// value the first time they're read so existing users who calmed
// the camera don't lose calmness on the new axes by default.
export function _bgHasStored(panelKey, key) {
    try {
        if (localStorage.getItem('h3d_bg_' + panelKey + '_' + key) != null) return true;
    } catch (_) {}
    if (key in _bgMemFallback) return true;
    try {
        if (localStorage.getItem('h3d_bg_' + key) != null) return true;
    } catch (_) {}
    return false;
}
function _bgWriteGlobal(key, val) {
    const s = String(val);
    // Stage in memory FIRST so _bgReadSetting's "memory beats global
    // localStorage" precedence has a true freshness guarantee even
    // if localStorage.setItem throws partway through. Without this
    // ordering, a quota exception thrown after the persisted slot
    // was already mutated would leave a stale value in localStorage
    // that's newer than _bgMemFallback.
    _bgMemFallback[key] = s;
    try { localStorage.setItem('h3d_bg_' + key, s); } catch (_) { /* storage blocked */ }
    _bgEmitChange(key);
}

// Pub-sub so settings.html can update live across all panel instances.
const _bgListeners = new Set();
export function _bgSubscribe(fn) { _bgListeners.add(fn); }
export function _bgUnsubscribe(fn) { _bgListeners.delete(fn); }
function _bgEmitChange(key) {
    for (const fn of _bgListeners) {
        try { fn(key); } catch (e) { console.error('[3D-Hwy] bg listener threw', e); }
    }
}

// Settings.html setters — global keys; per-panel overrides via direct
// localStorage edits today, runtime UI in a follow-up.
window.h3dBgSetStyle = (v) => _bgWriteGlobal('style', v);
window.h3dBgSetIntensity = (v) => _bgWriteGlobal('intensity', v);
window.h3dBgSetReactive = (v) => _bgWriteGlobal('reactive', !!v);
window.h3dBgSetPalette = (v) => _bgWriteGlobal('palette', v);
// BACKGROUND scene-color axis (clear + fog only). Validated against
// BG_THEME_IDS in _bgCoerce; the listener re-applies clear/fog live and
// independently of the highway axis.
window.h3dBgSetBgTheme = (v) => {
    const s = String(v);
    _bgWriteGlobal('bgTheme', BG_THEME_IDS.includes(s) ? s : BG_DEFAULTS.bgTheme);
};
// HIGHWAY scene-color axis (board + lane + laneDim). Same id-set as the
// background axis, so any highway can mix with any background. The listener
// re-applies the board plane + lane live and independently.
window.h3dBgSetHwTheme = (v) => {
    const s = String(v);
    _bgWriteGlobal('hwTheme', BG_THEME_IDS.includes(s) ? s : BG_DEFAULTS.hwTheme);
};
// Apply a user-defined per-string color set (core theming UI). `hexArray`
// is up to 8 hex strings; invalid/missing entries fall back to the default
// palette per index. Writes the colors, then flips the palette to 'custom'
// — the palette listener retints all materials + rebuilds the board live.
// Pass null/[] then h3dBgSetPalette('default') to revert.
window.h3dBgSetStringColors = (hexArray) => {
    const arr = Array.isArray(hexArray) ? hexArray : [];
    const norm = [];
    for (let i = 0; i < MAX_RENDER_STRINGS; i++) {
        const n = _h3dHexToInt(arr[i]);
        norm[i] = (n != null) ? '#' + n.toString(16).padStart(6, '0') : null;
    }
    _bgWriteGlobal('customColors', JSON.stringify(norm));
    _bgWriteGlobal('palette', 'custom');
};
window.h3dBgSetShowFretOnNote = (v) => _bgWriteGlobal('showFretOnNote', !!v);
window.h3dBgSetFretNumberGhostScope = (v) => {
    const s = String(v);
    _bgWriteGlobal('fretNumberGhostScope', FRET_NUMBER_GHOST_SCOPE_IDS.includes(s) ? s : BG_DEFAULTS.fretNumberGhostScope);
};
window.h3dBgSetCameraSmoothing = (v) => _bgWriteGlobal('cameraSmoothing', v);
window.h3dBgSetZoomSmoothing = (v) => _bgWriteGlobal('zoomSmoothing', v);
window.h3dBgSetTiltSmoothing = (v) => _bgWriteGlobal('tiltSmoothing', v);
window.h3dBgSetCameraLockLow = (v) => _bgWriteGlobal('cameraLockLow', !!v);
window.h3dBgSetCameraLockZoom = (v) => _bgWriteGlobal('cameraLockZoom', v);
window.h3dBgSetCameraMode = (v) => {
    let s = String(v);
    if (s === 'classic') s = 'steady';
    _bgWriteGlobal('cameraMode', s);
};
window.h3dBgSetNutHeadstockVisible = (v) => _bgWriteGlobal('nutHeadstockVisible', !!v);
window.h3dBgSetTuningLabelsVisible = (v) => _bgWriteGlobal('tuningLabelsVisible', !!v);
window.h3dBgSetNutColor = (v) => _bgWriteGlobal('nutColor', v);
window.h3dBgSetHeadstockColor = (v) => _bgWriteGlobal('headstockColor', v);
window.h3dBgSetTextSize = (v) => _bgWriteGlobal('textSize', v);
window.h3dBgSetVibrancy = (v) => _bgWriteGlobal('vibrancy', v);
window.h3dBgSetGlow     = (v) => _bgWriteGlobal('glow', v);
window.h3dBgSetHitFx        = (v) => _bgWriteGlobal('hitFx', v);
window.h3dBgSetSparks       = (v) => _bgWriteGlobal('sparks', !!v);
window.h3dBgSetCinematic    = (v) => _bgWriteGlobal('cinematic', !!v);
window.h3dBgSetVerdictMarks = (v) => _bgWriteGlobal('verdictMarks', !!v);
window.h3dBgSetTimingFx     = (v) => _bgWriteGlobal('timingFx', !!v);
window.h3dBgSetStreakFx     = (v) => _bgWriteGlobal('streakFx', !!v);
window.h3dBgSetBloom        = (v) => _bgWriteGlobal('bloom', !!v);
window.h3dBgSetToneHudVisible   = (v) => _bgWriteGlobal('toneHudVisible', !!v);
window.h3dBgSetToneHudPosition  = (v) => _bgWriteGlobal('toneHudPosition', v);
window.h3dBgSetToneHudSize      = (v) => _bgWriteGlobal('toneHudSize', v);
window.h3dBgSetFpsVisible           = (v) => _bgWriteGlobal('fpsVisible', !!v);
window.h3dBgSetFretDividersVisible  = (v) => _bgWriteGlobal('fretDividersVisible', !!v);
window.h3dBgSetChordDiagramVisible  = (v) => _bgWriteGlobal('chordDiagramVisible', !!v);
window.h3dBgSetChordDiagramSize     = (v) => _bgWriteGlobal('chordDiagramSize', v);
window.h3dBgSetChordDiagramPosition = (v) => _bgWriteGlobal('chordDiagramPosition', v);
window.h3dBgSetFretColumnMarkerCadence = (v) => _bgWriteGlobal('fretColumnMarkerCadence', v);
window.h3dBgSetInlayLabelsVisible = (v) => _bgWriteGlobal('inlayLabelsVisible', !!v);
window.h3dBgSetSectionLabelsOnHighway = (v) => _bgWriteGlobal('sectionLabelsOnHighway', !!v);
window.h3dBgSetSectionHudVisible      = (v) => _bgWriteGlobal('sectionHudVisible', !!v);
window.h3dBgSetSectionHudPosition     = (v) => _bgWriteGlobal('sectionHudPosition', v);
window.h3dBgSetSectionHudSize         = (v) => _bgWriteGlobal('sectionHudSize', v);
window.h3dBgSetProjectionVisible      = (v) => _bgWriteGlobal('projectionVisible', !!v);
window.h3dBgSetSlideArrowApproachVisible = (v) => _bgWriteGlobal('slideArrowApproachVisible', !!v);
window.h3dBgSetSlideArrowNeckVisible     = (v) => _bgWriteGlobal('slideArrowNeckVisible', !!v);
window.h3dBgSetSlideArrowChainPreviewVisible = (v) => _bgWriteGlobal('slideArrowChainPreviewVisible', !!v);
// Custom image asset for the 'image' bg style (#19). Composite setter:
// writes both the data URL (the bytes that drive the texture) and the
// display filename, each emitting a change event. The listener
// rebuilds on customImageDataUrl change when the image style is
// active; customImageName is display-only and skips rebuild.
window.h3dBgSetCustomImage = (asset) => {
    const a = asset || {};
    _bgWriteGlobal('customImageDataUrl', a.dataUrl || '');
    _bgWriteGlobal('customImageName', a.name || '');
};
window.h3dBgClearCustomImage = () => {
    _bgWriteGlobal('customImageDataUrl', '');
    _bgWriteGlobal('customImageName', '');
};
// Custom video asset for the 'video' bg style (#19 follow-up).
// Bytes live on disk under {config_dir}/plugin_uploads/highway_3d/
// and are served by routes.py — localStorage only stores the
// filename, which the renderer maps to the served URL. Single
// global slot; the file picker in settings.html POSTs to the
// upload route and then calls this setter with the response name.
window.h3dBgSetCustomVideo = (asset) => {
    _bgWriteGlobal('customVideoName', (asset && asset.name) || '');
};
window.h3dBgClearCustomVideo = () => _bgWriteGlobal('customVideoName', '');
window.h3dVenueSceneSetActive = (on) => {
    const next = !!on;
    if (_venueSceneOverride === next) return;
    _venueSceneOverride = next;
    if (!next) {
        _venueSceneAssetsLoaded = false;
        _venueSceneLoadFailed = false;
    }
    _bgEmitChange('venueScene');
};
window.h3dVenueSceneSetMood = (state) => {
    _venueMoodState = String(state || 'idle').toLowerCase();
};
window.h3dVenueSceneSetInstrumentPov = (input) => {
    const next = _venueResolvePovFromInput(input);
    if (_venueInstrumentPov === next) return;
    _venueInstrumentPov = next;
    _bgEmitChange('venueInstrumentPov');
};
window.h3dVenueSceneSetMotionMode = (mode) => {
    const next = String(mode || 'subtle').toLowerCase();
    const allowed = { off: 1, subtle: 1, full: 1 };
    _venueMotionMode = allowed[next] ? next : 'subtle';
};
window.h3dVenueSceneGetState = () => {
    const motionMode = _venueEffectiveMotionMode();
    const motionProfile = _venueMotionProfile(motionMode);
    return {
        active: _venueSceneOverride,
        mood: _venueMoodState,
        instrumentPov: _venueInstrumentPov,
        motionMode: _venueMotionMode,
        motionEffective: motionMode,
        motionEnabled: motionMode !== 'off',
        motionIntensity: motionProfile.breathe + motionProfile.parallax + motionProfile.hazeDrift,
        motionProfile,
        plateUrl: _venuePlateUrl || null,
        assetsLoaded: _venueSceneAssetsLoaded,
        loadFailed: _venueSceneLoadFailed,
    };
};
// Back-compat alias for any caller that picked up the original
// (inconsistent) name during this PR's review window.
window.h3dSetPalette = window.h3dBgSetPalette;

// Procedural silhouette bitmap, drawn once and shared across panels.
// The Canvas2D bitmap is module-level (cheap, CPU-only); each layer
// wraps it in its own CanvasTexture so per-layer texture.offset.x
// can drive a seam-free scroll without coupling to other layers /
// panels (a shared CanvasTexture would synchronize all offsets).
let _silCanvas = null;
function _bgEnsureSilhouetteCanvas() {
    if (_silCanvas) return _silCanvas;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 64;
    const cx = c.getContext('2d');
    if (!cx) {
        // Restrictive environments (some sandboxed iframes, headless
        // tests) can return null. Without a guard, the clearRect/
        // fillRect calls below would throw TypeError and the silhouette
        // style would never become available.
        throw new Error('[3D-Hwy] 2D canvas context unavailable for silhouette texture');
    }
    cx.clearRect(0, 0, c.width, c.height);
    cx.fillStyle = '#000814';
    let x = 0;
    while (x < c.width) {
        const w = 8 + Math.random() * 30;
        const h = 20 + Math.random() * 40;
        cx.fillRect(x, c.height - h, w, h);
        x += w + Math.random() * 10;
    }
    _silCanvas = c;
    return c;
}

// Helpers shared by the asset-driven bg styles (image, video).
// Both render a "stage backdrop" plane that's full-bleed: sized
// each frame to fill the camera's view frustum at a fixed
// distance and positioned to track the camera (so the user's
// image/video reads as the entire visible BG, with highway and
// notes painting on top via renderOrder).
//
// Distance is chosen far enough back that no note ever lands
// beyond it; depthWrite=false on the plane material plus
// renderOrder=-1 means notes still paint on top regardless.
const BG_BACKDROP_DISTANCE = FOG_END * 0.95;

// Module-level scratch vector reused each frame to avoid GC
// churn from per-frame Vector3 allocation. Only valid for the
// duration of a single update() call.
const _bgBackdropTmp = (() => {
    // Lazily created when T is available (T isn't bound at module
    // parse time — initScene assigns it inside loadThree().then).
    // Returning a getter that allocates on first read keeps the
    // dependency timing clean.
    let v = null;
    return () => v || (v = new T.Vector3());
})();

// Frustum-fit a plane mesh: scale a unit PlaneGeometry to exactly
// fill the camera's view at the configured distance, then position
// it `distance` units in front of the camera and orient it so the
// texture faces the camera. Called whenever cam.aspect changes
// (resize) and to position-track the camera each frame.
function _bgFitBackdropPlane(state) {
    const cam = state.cam;
    const d = state.distance;
    const halfFovRad = cam.fov * Math.PI / 360;
    const visibleHeight = 2 * Math.tan(halfFovRad) * d;
    const visibleWidth = visibleHeight * cam.aspect;
    if (state.lastAspect !== cam.aspect ||
        state.lastVisibleHeight !== visibleHeight) {
        state.mesh.scale.set(visibleWidth, visibleHeight, 1);
        state.lastAspect = cam.aspect;
        state.lastVisibleHeight = visibleHeight;
        state.lastVisibleWidth = visibleWidth;
        // Aspect change shifts the cover-crop ratio; re-apply.
        if (state.applyCoverCrop) state.applyCoverCrop();
    }
    // Track camera each frame: position = cam.position +
    // cam.forward * distance, orient toward camera.
    const fwd = cam.getWorldDirection(_bgBackdropTmp());
    state.mesh.position.copy(cam.position).addScaledVector(fwd, d);
    state.mesh.lookAt(cam.position);
}

// Cover-crop a texture to the plane aspect: the larger axis fills
// the plane (cropped if needed), centered. For wider-than-plane
// textures the X offset is left at the centered value but the
// image style's drift loop overwrites it per frame; the video
// style leaves it centered.
function _bgCoverCrop(tex, srcW, srcH, planeAspect) {
    if (srcW <= 0 || srcH <= 0) return;
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
    const srcAspect = srcW / srcH;
    if (srcAspect > planeAspect) {
        tex.repeat.x = planeAspect / srcAspect;
        tex.offset.x = (1 - tex.repeat.x) * 0.5;
    } else {
        tex.repeat.y = srcAspect / planeAspect;
        tex.offset.y = (1 - tex.repeat.y) * 0.5;
    }
    tex.needsUpdate = true;
}

// Background-style registry. Each entry returns a per-panel state
// object from build() and reads from it in update() / teardown().
// T (THREE) is set by the time these are invoked (initScene runs
// inside loadThree().then).
export const BG_STYLES = {
    off: {
        build() { return null; },
        update() {},
        teardown() {},
    },
    particles: {
        build(scene, settings) {
            const N = Math.max(20, Math.floor(80 + 200 * settings.intensity));
            const positions = new Float32Array(N * 3);
            for (let i = 0; i < N; i++) {
                positions[i * 3] = (Math.random() - 0.5) * 800 * K;
                positions[i * 3 + 1] = (Math.random() - 0.4) * 80 * K;
                // Spawn within the visible fog range. Fog reaches
                // its far limit at FOG_END * 1.2 from the camera,
                // and cam.position.z is updated each frame in
                // camUpdate() (`dist * 0.75`, where dist tracks
                // aspectScale). Anything beyond that camera-relative
                // distance gets fully fogged out, so the cutoff in
                // world z is dynamic — the earlier "push past notes"
                // fix placed particles at -FOG_END * (0.95..1.20)
                // which sat past fog far at any camera z, making
                // them invisible. renderOrder = -1 on the bg stage
                // already keeps particles behind notes regardless
                // of z, so depth-based separation wasn't needed and
                // was actively breaking visibility.
                positions[i * 3 + 2] = -FOG_START - Math.random() * (FOG_END - FOG_START) * 0.85;
            }
            const geo = new T.BufferGeometry();
            geo.setAttribute('position', new T.BufferAttribute(positions, 3));
            const mat = new T.PointsMaterial({
                // size 5*K (bumped from 1.5*K). At distance ~700*K
                // with sizeAttenuation the prior sprite shrank
                // below 2 pixels — practically invisible against
                // dark fog. 5*K reads as a small bright dot.
                // Build-time opacity is overridden every frame in
                // update() — the runtime formula is the source of
                // truth.
                color: 0xa0c0ff, size: 5 * K, transparent: true,
                blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
            });
            const points = new T.Points(geo, mat);
            scene.add(points);
            return { points, geo, mat, N };
        },
        update(s, bands, dt) {
            const positions = s.geo.attributes.position.array;
            const dx = dt * (3 + bands.mid * 12) * K;
            for (let i = 0; i < s.N; i++) {
                positions[i * 3] += dx;
                if (positions[i * 3] > 400 * K) positions[i * 3] -= 800 * K;
            }
            s.geo.attributes.position.needsUpdate = true;
            // Bumped opacity floor 0.4 → 0.55 + treble headroom
            // 0.4 → 0.45 so particles read as visible specks even
            // when bgReactive is false / treble≈0 (was effectively
            // 0.4 floor, below noise floor against dark fog).
            s.mat.opacity = 0.55 + bands.treble * 0.45;
        },
        teardown(s) {
            if (!s) return;
            s.points.parent?.remove(s.points);
            s.geo.dispose();
            s.mat.dispose();
        },
    },
    silhouettes: {
        build(scene, settings) {
            const canvas = _bgEnsureSilhouetteCanvas();
            // Inside the visible fog range. Fog far = FOG_END * 1.2
            // from the camera, and cam.position.z is dynamic
            // (camUpdate() sets `dist * 0.75`). renderOrder = -1
            // on the bg stage handles "behind notes" regardless
            // of z. Spread the three layers across the back half
            // of the visible fog band for parallax separation.
            const depths = [-FOG_END * 0.55, -FOG_END * 0.70, -FOG_END * 0.85];
            const layers = [];
            const allocated = [];
            try {
                for (const z of depths) {
                    // Per-layer CanvasTexture wrapping the shared
                    // canvas: lets each layer scroll independently
                    // via texture.offset.x without coupling to its
                    // siblings or to other panels.
                    const tex = new T.CanvasTexture(canvas);
                    tex.wrapS = T.RepeatWrapping;
                    const geo = new T.PlaneGeometry(800 * K, 50 * K);
                    const mat = new T.MeshBasicMaterial({
                        map: tex, transparent: true, opacity: 0.4, depthWrite: false,
                    });
                    const mesh = new T.Mesh(geo, mat);
                    mesh.position.set(0, -10 * K, z);
                    scene.add(mesh);
                    // Parallax: nearer layers move more than farther
                    // ones (perspective). distance = -z; small d ->
                    // large parallax. Scaled so the nearest sits
                    // around 0.32 and farthest around 0.18.
                    const distance = -z;
                    const parallax = Math.max(0.05, 1 - distance / (FOG_END * 1.4));
                    const layer = { mesh, geo, mat, tex, z, drift: 0, parallax };
                    layers.push(layer);
                    allocated.push(layer);
                }
                return { layers, intensity: settings.intensity };
            } catch (e) {
                // Build threw partway — clean up any per-layer
                // textures we already created. _bgMountStyle's catch
                // disposes the stage tree's meshes, but a partial-
                // build's CanvasTextures aren't reachable from any
                // mesh yet, so this catch owns them.
                for (const L of allocated) {
                    L.tex?.dispose?.();
                }
                throw e;
            }
        },
        update(s, bands, dt) {
            // Intensity multiplier: 0 dims to ~50% of base, 1
            // brightens to ~120%. Below-base values still leave the
            // silhouettes faintly visible so users know the style
            // is on; above-base lets the layers read as a real
            // backdrop on louder passages.
            const intensityMul = 0.5 + s.intensity * 0.7;
            for (const L of s.layers) {
                // Scroll via texture.offset.x with RepeatWrapping —
                // unbounded, no modulus snap. The mesh stays put;
                // the texture wraps continuously across the visible
                // surface. (offset is in normalized texture space,
                // so we keep it small and let the wrap do the job.)
                L.drift += dt * (0.05 + bands.mid * 0.15) * L.parallax;
                L.mat.map.offset.x = L.drift;
                L.mesh.position.y = -10 * K + bands.bass * 4 * K;
                L.mat.opacity = (0.25 + 0.5 * L.parallax) * intensityMul;
            }
        },
        teardown(s) {
            if (!s) return;
            for (const L of s.layers) {
                L.mesh.parent?.remove(L.mesh);
                L.geo.dispose();
                L.mat.dispose();
                L.tex.dispose();
            }
        },
    },
    lights: {
        build(scene, settings) {
            // Lights count scales 6 → 14 over intensity 0 → 1.
            // _bgCoerce clamps intensity to [0,1] before it reaches
            // here, so no further clamp is needed.
            const N = Math.floor(6 + 8 * settings.intensity);
            const lights = [];
            // Palette comes from the calling panel's settings so
            // each splitscreen panel picks its own (issue #10).
            // Falls back to the default palette if the caller
            // doesn't supply one (e.g. an older code path).
            const palette = settings.palette || PALETTES.default;
            for (let i = 0; i < N; i++) {
                const color = palette[i % palette.length];
                // 30*K plane reads as a real stage glow at distance.
                // Build-time opacity is overridden every frame in
                // update() — the runtime formula is the source of
                // truth.
                const geo = new T.PlaneGeometry(30 * K, 30 * K);
                const mat = new T.MeshBasicMaterial({
                    color, transparent: true,
                    blending: T.AdditiveBlending, depthWrite: false,
                });
                const mesh = new T.Mesh(geo, mat);
                mesh.position.set(
                    (Math.random() - 0.5) * 600 * K,
                    (Math.random() - 0.3) * 80 * K,
                    // Inside visible fog range; renderOrder = -1
                    // keeps lights behind notes regardless of z.
                    -FOG_START - Math.random() * (FOG_END - FOG_START) * 0.85
                );
                scene.add(mesh);
                lights.push({ mesh, geo, mat, baseScale: 1 + Math.random() * 0.5, phase: Math.random() * Math.PI * 2 });
            }
            return { lights };
        },
        update(s, bands, dt, t) {
            // Bumped opacity floor 0.35 → 0.55 + treble headroom
            // 0.3 → 0.4 so lights read as visible stage glows at
            // distance instead of faint specks (was effectively
            // 0.35 floor since the build-time bump was overridden
            // by this formula).
            for (const L of s.lights) {
                const pulse = 1 + bands.bass * 1.5 + Math.sin(t * 1.5 + L.phase) * 0.2;
                L.mesh.scale.set(L.baseScale * pulse, L.baseScale * pulse, 1);
                L.mat.opacity = 0.55 + bands.treble * 0.4;
            }
        },
        teardown(s) {
            if (!s) return;
            for (const L of s.lights) {
                L.mesh.parent?.remove(L.mesh);
                L.geo.dispose();
                L.mat.dispose();
            }
        },
    },
    geometric: {
        build(scene, settings) {
            const meshes = [];
            // Bumped opacity floor (0.25 → 0.45) + ceiling so the
            // wireframes read as real shapes instead of barely-
            // there ghosts at low intensity.
            const op = 0.45 + 0.25 * settings.intensity;
            const ico = new T.Mesh(
                new T.IcosahedronGeometry(30 * K, 1),
                new T.MeshBasicMaterial({ color: 0x6080c0, wireframe: true, transparent: true, opacity: op, depthWrite: false }),
            );
            // Inside visible fog range; renderOrder = -1 keeps
            // wireframes behind notes regardless of z.
            ico.position.set(-100 * K, 30 * K, -FOG_END * 0.65);
            scene.add(ico);
            meshes.push(ico);
            const torus = new T.Mesh(
                new T.TorusGeometry(22 * K, 4 * K, 6, 12),
                new T.MeshBasicMaterial({ color: 0xc06080, wireframe: true, transparent: true, opacity: op * 0.9, depthWrite: false }),
            );
            torus.position.set(120 * K, 20 * K, -FOG_END * 0.75);
            scene.add(torus);
            meshes.push(torus);
            return { meshes };
        },
        update(s, bands, dt) {
            const speed = 0.2 + bands.mid * 0.4;
            const pulse = 1 + bands.bass * 0.25;
            for (const m of s.meshes) {
                m.rotation.x += dt * speed * 0.3;
                m.rotation.y += dt * speed * 0.4;
                m.scale.setScalar(pulse);
            }
        },
        teardown(s) {
            if (!s) return;
            for (const m of s.meshes) {
                m.parent?.remove(m);
                m.geometry.dispose();
                m.material.dispose();
            }
        },
    },
    // Venue visualization — generated small-club raster bg plate
    // behind the highway. Activated via h3dVenueSceneSetActive(true)
    // when Visualization = Venue; does not persist as a user bg style.
    venue: {
        build(scene, settings) {
            const coeffs = _bgVenueMoodCoeffs(_venueMoodState);
            const state = {
                backdrop: null,
                haze: null,
                loader: null,
                instrumentPov: _venueInstrumentPov,
                plateLoading: false,
                pending: 1,
                loaded: false,
                failed: false,
            };

            function _venueMarkLoaded() {
                state.pending--;
                if (state.pending <= 0 && !state.failed) {
                    state.loaded = true;
                    _venueSceneAssetsLoaded = true;
                    _venueSceneLoadFailed = false;
                    try {
                        if (typeof window !== 'undefined' && window.v3VenueScene3d &&
                            typeof window.v3VenueScene3d.onAssetsLoaded === 'function') {
                            window.v3VenueScene3d.onAssetsLoaded();
                        }
                    } catch (_) { /* visual-only */ }
                }
            }
            function _venueMarkFailed(msg) {
                if (state.failed) return;
                state.failed = true;
                _venueSceneLoadFailed = true;
                _venueSceneAssetsLoaded = false;
                console.warn('[venue-scene] ' + msg);
                _venueSceneOverride = false;
                _bgEmitChange('venueScene');
                try {
                    if (typeof window !== 'undefined' && window.v3VenueScene3d &&
                        typeof window.v3VenueScene3d.onAssetsFailed === 'function') {
                        window.v3VenueScene3d.onAssetsFailed(msg);
                    }
                } catch (_) { /* visual-only */ }
            }

            const loader = new T.TextureLoader();
            state.loader = loader;
            const backdrop = {
                mesh: null, geo: null, mat: null, tex: null,
                cam: settings.cam, distance: BG_BACKDROP_DISTANCE * VENUE_BACKDROP_DISTANCE_MUL,
                lastAspect: 0, lastVisibleHeight: 0, lastVisibleWidth: 0, loaded: false,
            };
            backdrop.geo = new T.PlaneGeometry(1, 1);
            backdrop.mat = new T.MeshBasicMaterial({
                color: 0xffffff, transparent: false, depthWrite: false, fog: false,
            });
            backdrop.mesh = new T.Mesh(backdrop.geo, backdrop.mat);
            backdrop.mesh.visible = false;
            scene.add(backdrop.mesh);
            state.backdrop = backdrop;
            backdrop.applyCoverCrop = function () {
                if (!backdrop.tex || !backdrop.tex.image) return;
                _bgCoverCrop(
                    backdrop.tex,
                    backdrop.tex.image.width || 0,
                    backdrop.tex.image.height || 0,
                    backdrop.cam.aspect,
                );
            };
            _venueLoadPlateForPov(
                loader,
                _venueInstrumentPov,
                backdrop,
                () => _venueMarkLoaded(),
                () => _venueMarkFailed('failed to load small-club bg plate'),
            );

            const hazeGeo = new T.PlaneGeometry(280 * K, 40 * K);
            const hazeMat = new T.MeshBasicMaterial({
                color: 0x101820, transparent: true, opacity: coeffs.haze,
                depthWrite: false, fog: false,
            });
            const hazeMesh = new T.Mesh(hazeGeo, hazeMat);
            hazeMesh.position.set(0, -12 * K, -FOG_END * 0.70);
            scene.add(hazeMesh);
            state.haze = {
                mesh: hazeMesh, geo: hazeGeo, mat: hazeMat, baseOp: coeffs.haze,
                baseX: 0, baseY: -12 * K, baseZ: -FOG_END * 0.70,
            };

            return state;
        },
        update(s, bands, dt, t) {
            if (!s || s.failed) return;
            _venueSwapPlateIfNeeded(s);
            const coeffs = _bgVenueMoodCoeffs(_venueMoodState);
            if (s.backdrop && s.backdrop.loaded) {
                _bgFitBackdropPlane(s.backdrop);
            }
            const motion = _venueApplyFakeDepthMotion(s, coeffs, t);
            if (s.backdrop && s.backdrop.loaded && s.backdrop.mat && !motion.breathe && !motion.warmthPulse) {
                const warm = coeffs.warmth;
                s.backdrop.mat.color.setRGB(warm, warm * 0.98, warm * 0.95);
            }
            if (s.haze && s.haze.mat && !motion.hazeDrift && !motion.shimmer) {
                s.haze.mat.opacity = (s.haze.baseOp || VENUE_HAZE_STEADY)
                    * (coeffs.haze / VENUE_HAZE_STEADY);
            }
        },
        teardown(s) {
            if (!s) return;
            _venueSceneAssetsLoaded = false;
            for (const key of ['backdrop', 'haze']) {
                const p = s[key];
                if (!p) continue;
                p.mesh?.parent?.remove(p.mesh);
                p.geo?.dispose?.();
                if (p.mat) {
                    p.mat.map = null;
                    p.mat.dispose?.();
                }
            }
            // Dispose the cached plate textures too — the module-level cache
            // otherwise keeps every loaded POV plate GPU-resident for the
            // page lifetime (steady VRAM growth across POV/arrangement swaps).
            try {
                _venueTextureCache.forEach((tex) => { tex?.dispose?.(); });
            } catch (_) { /* visual-only */ }
            _venueTextureCache.clear();
        },
    },
    // Custom image backdrop (#19). User uploads a JPG/PNG/WebP
    // through settings.html; the bytes are persisted as a base64
    // data URL in localStorage under h3d_bg_customImageDataUrl and
    // passed in via settings.customImageDataUrl. Renders as a
    // PlaneGeometry in the silhouette parallax band, "cover" cropped
    // (via texture.repeat / offset) so non-matching aspects fill
    // the plane without distortion. Slow horizontal drift on
    // texture.offset.x for life. When no asset is uploaded, build
    // returns null and the style is inert (settings.html disables
    // the picker option in that case).
    image: {
        build(scene, settings) {
            // Upfront validation: only accept the same raster image
            // formats settings.html lets the user upload (jpeg /
            // png / webp). Without this, a corrupt localStorage
            // value (truncated base64, wrong scheme, plain string)
            // OR an unsupported type (e.g. data:image/svg+xml)
            // reaches TextureLoader and can fail asynchronously
            // after the plane has been mounted — a silent black
            // backdrop with no clear cause. Returning null here
            // treats invalid bytes the same as "no asset uploaded":
            // style is inert, the user can clear and re-upload
            // from settings.html.
            const dataUrl = (typeof settings.customImageDataUrl === 'string')
                ? settings.customImageDataUrl.trim() : '';
            if (!/^data:image\/(jpeg|png|webp);/i.test(dataUrl)) return null;
            // Renderer-side encoded-length cap. settings.html
            // enforces the same limit on upload, but a manually
            // edited localStorage value (or legacy data from
            // before the upload guard existed) could still feed
            // an arbitrarily large data URL into TextureLoader
            // and burn memory / CPU during decode. Treat overlong
            // values as "no asset" — style is inert, user can
            // clear and re-upload from settings.
            if (dataUrl.length > 2.5 * 1024 * 1024) return null;
            // Renderer-side decompression-bomb caps. Mirror
            // settings.html's upload-time guard so a manual
            // localStorage edit (or legacy data from before that
            // guard existed) can't sneak a 50000×50000 PNG past
            // and OOM the GPU on texture upload.
            const MAX_IMAGE_DIM = 4096;
            const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
            // Full-bleed backdrop: unit plane, scaled per frame in
            // _bgFitBackdropPlane to fill the camera's view at
            // BG_BACKDROP_DISTANCE. fog: false so the backdrop
            // shows in full color; notes drawn on top still pick
            // up atmospheric fog as before.
            const state = {
                mesh: null, geo: null, mat: null, tex: null,
                drift: 0.5, intensity: settings.intensity, loaded: false,
                cam: settings.cam, distance: BG_BACKDROP_DISTANCE,
                lastAspect: 0, lastVisibleHeight: 0,
            };
            // Helper closure for cover-crop refresh — called both
            // on async decode (initial) and from _bgFitBackdropPlane
            // when the camera aspect changes (resize).
            state.applyCoverCrop = function () {
                if (!state.tex || !state.tex.image) return;
                _bgCoverCrop(
                    state.tex,
                    state.tex.image.width  || 0,
                    state.tex.image.height || 0,
                    state.cam.aspect,
                );
            };
            const tex = new T.TextureLoader().load(
                dataUrl,
                (loaded) => {
                    // Image dimensions are only known after async decode.
                    const imgW = loaded.image?.width  || 0;
                    const imgH = loaded.image?.height || 0;
                    if (imgW > MAX_IMAGE_DIM || imgH > MAX_IMAGE_DIM || (imgW * imgH) > MAX_IMAGE_PIXELS) {
                        // Bail before the texture gets uploaded to
                        // the GPU (Three.js uploads on first render
                        // of a visible mesh — hiding the mesh here
                        // skips that). Disposing the texture too,
                        // belt-and-suspenders, in case anything
                        // else holds a reference.
                        console.warn('[3D-Hwy] custom image dimensions too large to render', imgW + 'x' + imgH);
                        if (state.mesh) state.mesh.visible = false;
                        loaded.dispose();
                        return;
                    }
                    state.applyCoverCrop();
                    // Reset drift to the centered triangle-wave
                    // phase now that repeat.x is final. Without
                    // this reset, drift accumulated during the
                    // async decode would phase-shift the initial
                    // offset by a non-deterministic amount —
                    // wider images would open at whatever crop
                    // the elapsed-decode-time happened to land on.
                    state.drift = 0.5;
                    state.loaded = true;
                },
                undefined,
                // Async-failure path: the upfront regex catches the
                // common "corrupted/truncated bytes" case, but a
                // valid-looking data URL can still fail to decode
                // (e.g. wrong MIME / unsupported codec). Hide the
                // mesh so we don't paint a frozen blank plane on
                // top of fog, and log so the failure isn't silent.
                (err) => {
                    console.error('[3D-Hwy] custom image decode failed', err);
                    if (state.mesh) state.mesh.visible = false;
                },
            );
            tex.colorSpace = T.SRGBColorSpace;
            // ClampToEdge on both axes — user uploads are non-
            // power-of-two in general, and WebGL1 rejects RepeatWrapping
            // on NPOT textures (renders black or emits GL errors). The
            // drift logic below uses a triangle-wave so the offset
            // stays inside [0, 1-repeat] and never needs wrap.
            tex.wrapS = T.ClampToEdgeWrapping;
            tex.wrapT = T.ClampToEdgeWrapping;
            // User uploads aren't power-of-two in general; mipmaps
            // are noisy for a single static backdrop and burn memory.
            tex.generateMipmaps = false;
            tex.minFilter = T.LinearFilter;
            tex.magFilter = T.LinearFilter;
            const geo = new T.PlaneGeometry(1, 1);
            const mat = new T.MeshBasicMaterial({
                map: tex, transparent: false, depthWrite: false, fog: false,
            });
            const mesh = new T.Mesh(geo, mat);
            scene.add(mesh);
            state.mesh = mesh;
            state.geo  = geo;
            state.mat  = mat;
            state.tex  = tex;
            // Initial fit so the first frame is correctly sized
            // and positioned, even if update() hasn't run yet.
            _bgFitBackdropPlane(state);
            return state;
        },
        update(s, bands, dt) {
            if (!s) return;
            // Track camera position / aspect every frame. The
            // helper resizes the plane and refreshes cover-crop
            // when aspect changes, and re-positions the plane to
            // stay BG_BACKDROP_DISTANCE in front of the camera.
            _bgFitBackdropPlane(s);
            // Skip drift advance until the texture has finished
            // decoding. Without this guard, drift accumulates
            // during the async load while repeat.x is still 1
            // (its default), and once the cover-crop applies the
            // image opens at a phase-shifted offset whose value
            // depends on how long the decode took — the
            // "centered start" intent becomes non-deterministic.
            if (!s.loaded) return;
            // Triangle-wave ping-pong drift inside the cropped slack.
            // ClampToEdge on wrapS means we cannot wrap across the
            // texture boundary (would render edge pixels stretched);
            // ping-pong oscillates the visible window between the
            // image's left and right edges, which gives the same
            // "alive" feel without the WebGL1 NPOT-Repeat hazard.
            // Slack is the horizontal margin between the cropped
            // window and the texture edges; for taller-than-plane
            // images repeat.x stays 1, slack collapses to 0, and
            // the offset stays at 0 — the image sits still, which
            // is correct (it's already filling horizontally).
            s.drift += dt * 0.02 * s.intensity;
            const slack = Math.max(0, 1 - s.tex.repeat.x);
            // Period of 2 drift units ≈ 100 s at intensity = 0.5;
            // gentle, cinematic. cyc ∈ [0, 2), tri ∈ [0, 1] then back.
            const cyc = ((s.drift % 2) + 2) % 2;
            const tri = cyc < 1 ? cyc : 2 - cyc;
            s.tex.offset.x = tri * slack;
        },
        teardown(s) {
            if (!s) return;
            s.mesh.parent && s.mesh.parent.remove(s.mesh);
            s.geo.dispose();
            s.mat.dispose();
            // This style owns the texture lifecycle (per the comment
            // at _bgDisposeGroupTree: tree dispose does NOT touch
            // material.map textures).
            s.tex.dispose();
        },
    },
    // Custom video backdrop (#19 follow-up). User uploads a
    // .mp4/.webm via settings.html; routes.py stores it on disk and
    // serves a same-origin URL (avoids CORS taint on VideoTexture).
    // localStorage holds only the filename — bytes live in
    // {config_dir}/plugin_uploads/highway_3d/. Per-panel video
    // element so each panel can mount/teardown independently;
    // browsers cache the video bytes after first fetch so multi-
    // panel splitscreen pays only the decoder cost, not the
    // network or disk-read cost.
    video: {
        build(scene, settings) {
            // Lowercase before validation so a manual localStorage
            // edit like `current.MP4` doesn't pass a case-insensitive
            // regex check and then 404 against the server, which
            // only ever produces and serves lowercase
            // current.<ext> (the upload route lowercases the
            // extension; routes.py's GET pattern is case-sensitive).
            const filename = (typeof settings.customVideoName === 'string')
                ? settings.customVideoName.trim().toLowerCase() : '';
            // Strict pattern matches routes.py's deterministic
            // single-slot naming. Any other shape (corrupt
            // localStorage, future schema change) → style is
            // inert, no <video> created, no orphan request to a
            // 404 endpoint.
            if (!/^current\.(mp4|webm)$/.test(filename)) return null;
            const url = '/api/plugins/highway_3d/files/' + filename;

            // Track partial allocations so a throw between any of
            // them can clean up. _bgMountStyle's failure path
            // disposes the stage tree but explicitly does NOT
            // dispose textures (per the comment at
            // _bgDisposeGroupTree), and the <video> element is
            // parented to document.body — not the stage — so
            // neither would be reached without an explicit catch.
            let videoEl = null, tex = null, geo = null, mat = null, mesh = null;
            try {
                // muted + playsInline + autoplay is the cross-
                // browser recipe that bypasses gesture requirements
                // (Chrome, Firefox, Safari desktop + mobile).
                // preload='auto' lets the first frame land before
                // play() is called. src is deliberately NOT set
                // yet — we want every piece of state (mesh, tex)
                // to exist before the browser can fire
                // loadedmetadata or error events on a cached
                // resource. The handlers close over state.tex /
                // state.mesh; setting src first would create a
                // window where a fast cache hit could fire an
                // event into half-initialized state.
                videoEl = document.createElement('video');
                // No crossOrigin attribute: the URL is same-origin
                // (/api/plugins/highway_3d/files/…), so VideoTexture
                // never sees a tainted canvas. Setting
                // `crossOrigin = "anonymous"` would also strip
                // cookies from the fetch, which would 401 against
                // any cookie-protected feedBack deployment. If
                // this ever needs to fetch cross-origin, switch
                // to `use-credentials` AND have the server send
                // the matching CORS headers.
                videoEl.muted = true;
                videoEl.playsInline = true;
                videoEl.loop = true;
                videoEl.autoplay = true;
                videoEl.preload = 'auto';
                videoEl.style.display = 'none';
                document.body.appendChild(videoEl);

                // Build mesh + texture before registering listeners
                // and before setting src. By the time loadedmetadata
                // or error can fire, state.tex and state.mesh are
                // both populated.
                tex = new T.VideoTexture(videoEl);
                tex.colorSpace = T.SRGBColorSpace;
                tex.wrapS = T.ClampToEdgeWrapping;
                tex.wrapT = T.ClampToEdgeWrapping;
                tex.minFilter = T.LinearFilter;
                tex.magFilter = T.LinearFilter;
                tex.generateMipmaps = false;
                geo = new T.PlaneGeometry(1, 1);
                mat = new T.MeshBasicMaterial({
                    map: tex, transparent: false, depthWrite: false, fog: false,
                });
                mesh = new T.Mesh(geo, mat);
                scene.add(mesh);

                // Full-bleed backdrop: scaled and positioned each
                // frame in update() via _bgFitBackdropPlane.
                // cam + distance + lastAspect / lastVisibleHeight
                // power that helper.
                const state = {
                    videoEl, mesh, geo, mat, tex,
                    cam: settings.cam, distance: BG_BACKDROP_DISTANCE,
                    lastAspect: 0, lastVisibleHeight: 0,
                };
                state.applyCoverCrop = function () {
                    if (!state.videoEl) return;
                    _bgCoverCrop(
                        state.tex,
                        state.videoEl.videoWidth  || 0,
                        state.videoEl.videoHeight || 0,
                        state.cam.aspect,
                    );
                };

                // Cover-crop math runs on loadedmetadata since
                // video dimensions aren't known until then.
                // _bgFitBackdropPlane will also re-apply when the
                // camera aspect changes.
                videoEl.addEventListener('loadedmetadata', () => {
                    state.applyCoverCrop();
                });
                videoEl.addEventListener('error', () => {
                    // Fired for: codec unsupported, 404 from
                    // server, truncated file, etc. Hide the mesh
                    // so we don't paint a frozen blank plane on
                    // top of fog.
                    console.error('[3D-Hwy] custom video load failed', videoEl.error);
                    state.mesh.visible = false;
                });

                // Set src last — this is what triggers the async
                // load. With handlers and state in place, any
                // synchronous-feeling event from a cached resource
                // is still safely received and handled.
                videoEl.src = url;

                // play() can reject for transient reasons (tab
                // backgrounded at mount time, low-power mode,
                // brief autoplay-policy timing window) even with
                // muted + autoplay set — but the browser retries
                // on its own once conditions improve (visibility
                // change, foregrounding, gesture). Real load /
                // codec failures come through the `error` event
                // we registered above and DO hide the mesh. So
                // just log here and leave the mesh visible; the
                // next ready frame will paint.
                videoEl.play().catch((err) => {
                    console.warn('[3D-Hwy] custom video play() rejected (will retry on visibility/gesture)', err);
                });
                // Initial fit so the first frame is correctly
                // sized and positioned even before update() runs.
                _bgFitBackdropPlane(state);
                return state;
            } catch (err) {
                // Best-effort cleanup of whatever was allocated
                // before the throw. Each step is independently
                // guarded so a secondary failure (e.g. dispose
                // throwing on an already-disposed object) can't
                // mask the original error.
                try {
                    if (videoEl) {
                        videoEl.pause();
                        videoEl.removeAttribute('src');
                        videoEl.load();
                        if (videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
                    }
                } catch (_) { /* ignore */ }
                try { if (mesh && mesh.parent) mesh.parent.remove(mesh); } catch (_) { /* ignore */ }
                try { if (geo) geo.dispose(); } catch (_) { /* ignore */ }
                try { if (mat) mat.dispose(); } catch (_) { /* ignore */ }
                try { if (tex) tex.dispose(); } catch (_) { /* ignore */ }
                throw err;
            }
        },
        update(s) {
            if (!s) return;
            // VideoTexture auto-updates from the playing element —
            // Three.js samples the current frame each render. No
            // per-frame texture mutation here. Drift on offset.x
            // is intentionally omitted: the video's own motion is
            // the "life", drifting the crop on top would feel
            // busy and compete with playback. The only per-frame
            // work is keeping the plane camera-locked and resized
            // when aspect changes (handled inside the helper).
            _bgFitBackdropPlane(s);
        },
        teardown(s) {
            if (!s) return;
            if (s.videoEl) {
                try { s.videoEl.pause(); } catch (_) {}
                s.videoEl.removeAttribute('src');
                // load() with no src tells the browser to release
                // any decoder/buffer state for this element.
                try { s.videoEl.load(); } catch (_) {}
                if (s.videoEl.parentNode) s.videoEl.parentNode.removeChild(s.videoEl);
            }
            if (s.mesh) s.mesh.parent && s.mesh.parent.remove(s.mesh);
            if (s.geo) s.geo.dispose();
            if (s.mat) s.mat.dispose();
            if (s.tex) s.tex.dispose();
        },
    },
};

/* ======================================================================
 *  Per-instance counter
 * ====================================================================== */



/* ======================================================================
 *  Factory — feedBack#36 setRenderer contract
 * ====================================================================== */
