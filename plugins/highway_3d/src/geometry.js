// Core constants (palette, K scale, fret/string geometry, camera, timing)
// and the pure chart-math helpers: fret X positions and spacing modes,
// lane/anchor bounds, render-order layering, slide offsets, BPM.

export const PALETTES = {
    default: [
        0xe61f26, 0xecd234, 0x1096e6, 0xf18313,
        0x3fc413, 0xb518d9, 0xff6bd5, 0x6bffe6,
    ],
    neon: [
        0xff0030, 0xffe800, 0x0080ff, 0xff8030,
        0x40ff50, 0xb050ff, 0xff40d0, 0x40ffd0,
    ],
    pastel: [
        0xe89aa0, 0xefdf90, 0x9adfee, 0xefb898,
        0xa6e0a8, 0xc4a6e0, 0xe0a6c8, 0xa6e0d8,
    ],
    colorblind_hc: [
        0xa42424, 0xa3f300, 0x19abfc, 0xda7e41,
        0x30d0a0, 0x7648a7, 0xff6bd5, 0x6bffe6,
    ],
};
export const PALETTE_IDS = Object.keys(PALETTES);
// User-defined per-string colors (core "Highway String Colors" theming).
// Persisted as a JSON hex array under the bg setting key 'customColors';
// when the active palette id is 'custom' the renderer resolves this into
// numeric hex, falling back to the default palette per missing index.
// Mutated in place by _resolveCustomPalette so the reference stays stable.
export let _customPalette = PALETTES.default.slice();
export function _h3dHexToInt(hex) {
    if (typeof hex !== 'string') return null;
    const t = hex.trim().replace(/^#/, '');
    const full = t.length === 3 ? t[0] + t[0] + t[1] + t[1] + t[2] + t[2] : t;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    return parseInt(full, 16);
}
// Numeric (0xRRGGBB) darken/lighten — used to derive the gem-gradient
// top-highlight / bottom-shade stops from a custom per-string base color
// so the note bodies follow the custom palette (mirrors the 2D highway's
// dim/bright derivation). factor 0..1 keeps that fraction of each channel;
// lighten mixes t toward white.
function _clampByteI(n) { return n < 0 ? 0 : (n > 255 ? 255 : Math.round(n)); }
export function _darkenInt(hex, factor) {
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    return (_clampByteI(r * factor) << 16) | (_clampByteI(g * factor) << 8) | _clampByteI(b * factor);
}
export function _lightenInt(hex, t) {
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    return (_clampByteI(r + (255 - r) * t) << 16) | (_clampByteI(g + (255 - g) * t) << 8) | _clampByteI(b + (255 - b) * t);
}
// Default per-string gem gradient stops [topHighlight, bottomShade] —
// sampled from the original colour PNGs. Used verbatim for the built-in
// palettes (and for unchanged slots of a custom palette) so the stock look
// is byte-for-byte preserved; custom slots derive their stops from the
// chosen base color via _lightenInt/_darkenInt. Strings 6/7 have no entry
// and fall back to flat gNote.
export const DEFAULT_GEM_GRADIENTS = [
    [0xec0816, 0xbd0400], // 0 red
    [0xefd20b, 0xceaa00], // 1 yellow
    [0x0b93e9, 0x0e69b2], // 2 blue
    [0xf77b0b, 0xdb5808], // 3 orange
    [0x37c40b, 0x139305], // 4 green
    [0xaf10db, 0x8907af], // 5 violet
];
// Default palette at module scope so out-of-IIFE consumers (e.g. the
// out-of-range warning's reference to "palette size") still have a
// canonical length to compare against.
export const S_COL = PALETTES.default;

const SCALE = 2.25;
export const K = SCALE / 300;
// Horizontal stretch factor for fret X positions.  Increasing this widens
// the lane (frets, board plane, strings, notes, lane strip) without
// affecting K-based vertical dimensions (string gap, note height, camera).
const FRET_SCALE = SCALE * 1.1;

export const NFRETS = 24;
export const NSTR = 6;
/**
 * Pure 12-semitone spacing compresses toward the bridge; multiply each
 * segment **above** this fret by the factor so high positions stay
 * slightly more playable/readable in 3D.
 */
const FRET_SPACING_STRETCH_ABOVE12 = 1.1;
const FRET_SPACING_ANCHOR_F = 12;
// Per-string materials and projection meshes are built via S_COL.map(),
// so the renderer can only address strings 0..S_COL.length-1. Using a
// higher count would index undefined into mGlow/mStr/mSus/projMeshArr.
// Extend S_COL above to support more strings.
export const MAX_RENDER_STRINGS = S_COL.length;

// Resolve the string count for the active arrangement. Prefer
// bundle.stringCount (exposed by feedBack core since #93 — derived
// from notes/chords/tuning, so it works for 5-string bass, 7- and
// 8-string guitar, etc.). Fall back to arrangement-name detection
// for older feedBack cores that don't emit the field. Clamp to the
// palette size so a malformed bundle or a 12-string chart doesn't
// index past the per-string material arrays.
export function resolveStringCount(bundle) {
    const sc = bundle && bundle.stringCount;
    if (Number.isFinite(sc) && sc >= 1) {
        return Math.min(Math.trunc(sc), MAX_RENDER_STRINGS);
    }
    return /bass/i.test(bundle?.songInfo?.arrangement || '') ? 4 : NSTR;
}

/** Chart-format tuning entries are semitone offsets from instrument standard. */
const _NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Open-string MIDI (thick → thin), matched to RS string index 0 low.
const _BASE_OPEN_MIDI_BASS4 = Object.freeze([28, 33, 38, 43]);
const _BASE_OPEN_MIDI_BASS5 = Object.freeze([23, 28, 33, 38, 43]);
const _BASE_OPEN_MIDI_GUITAR6 = Object.freeze([40, 45, 50, 55, 59, 64]);
const _BASE_OPEN_MIDI_GUITAR7 = Object.freeze([35, 40, 45, 50, 55, 59, 64]);
// F#/B/E standard extension — low string is a fifth below RS 7‑string low B.
const _BASE_OPEN_MIDI_GUITAR8 = Object.freeze([28, 35, 40, 45, 50, 55, 59, 64]);

function _baseOpenStringMidis(sc, arrangement) {
    const isBass = /bass/i.test(arrangement || '');
    if (sc === 4 && isBass) return _BASE_OPEN_MIDI_BASS4.slice();
    if (sc === 4) return _BASE_OPEN_MIDI_GUITAR6.slice(0, 4);
    if (sc === 5 && isBass) return _BASE_OPEN_MIDI_BASS5.slice();
    if (sc === 5) return _BASE_OPEN_MIDI_GUITAR6.slice(0, 5);
    if (sc === 7) return _BASE_OPEN_MIDI_GUITAR7.slice();
    if (sc === 8) return _BASE_OPEN_MIDI_GUITAR8.slice();
    if (Number.isFinite(sc) && sc > 8) {
        const out = Array.from(_BASE_OPEN_MIDI_GUITAR8);
        let last = out[out.length - 1];
        while (out.length < sc) {
            last += 5;
            out.push(last);
        }
        return out.slice(0, sc);
    }
    const g6 = _BASE_OPEN_MIDI_GUITAR6.slice();
    if (Number.isFinite(sc) && sc < 6 && sc >= 1) return g6.slice(0, sc);
    return g6;
}

function _midiToPitchLabel(midi) {
    const m = Math.round(midi);
    const octave = Math.floor(m / 12) - 1;
    const n = _NOTE_NAMES_SHARP[(m % 12 + 12) % 12];
    return n + octave;
}

/**
 * @param {number} nEffective string count clamped like nStr / resolveStringCount
 * @param {Record<string, unknown>} songInfo WS song_info blob (subset)
 */
export function _openStringPitchLabelsForTuning(bundle, songInfo, nEffective) {
    const n = Number.isFinite(nEffective) ? Math.min(Math.max(1, Math.trunc(nEffective)), MAX_RENDER_STRINGS) : resolveStringCount(bundle);
    let tuning = (songInfo && songInfo.tuning) || bundle.tuning;
    let cap = songInfo && songInfo.capo;
    cap = Number.isFinite(cap) ? cap : (Number.isFinite(bundle.capo) ? bundle.capo : 0);
    if (!Array.isArray(tuning)) tuning = [];

    const base = _baseOpenStringMidis(n, songInfo?.arrangement);
    const labels = [];
    for (let s = 0; s < n; s++) {
        const offRaw = tuning[s];
        const off = Number.isFinite(offRaw) ? offRaw : 0;
        const midi = (base[s] !== undefined ? base[s] : 40) + off + cap;
        labels.push(_midiToPitchLabel(midi));
    }
    return labels;
}

export const STR_THICK = 0.25 * K;

// Fret wires — bowed metal tubes (backported from highway_babylon's
// "hit-zone fret bars"). All frets share one bowed TubeGeometry whose
// middle (the middle strings) pushes away from the camera so the row of
// frets reads as wrapping a cylindrical neck — chart-format depth cue.
// Negative Z = away from camera (into the highway). All tunable.
export const FRET_BOW_DZ = -1.2 * K;        // middle-of-span Z offset
export const FRET_TUBE_RADIUS = STR_THICK * 0.55; // ~matches old box thickness
export const FRET_TUBE_SEG = 12;            // tubular segments along the curve
export const FRET_TUBE_RADIAL = 6;          // radial segments (cross-section)
// metalness kept moderate, NOT ~1.0: MeshStandardMaterial is PBR and the
// scene has no envMap, so a full-metal fret would reflect black and render
// dark (the nut/headstock use metalness 0.02 for the same reason). At ~0.4
// the lit albedo body survives while the directional light still throws a
// glossy specular streak across the rounded tube. The dim emissive floor
// keeps frets from going muddy far down the (fogged) neck.
export const FRET_METALNESS = 0.4;          // lit steel / brass when gold
export const FRET_ROUGHNESS = 0.3;
export const FRET_EMISSIVE = 0x12141a;      // cool dim floor, never fully black

export const S_BASE = 3 * K;
export const S_GAP = 4 * K;

export const AHEAD = 3.0;
export const BEHIND = 0.5;
// How long a note/chord-frame stays renderable past the hit line while a
// note-state provider (feedBack#254) is attached. The provider's
// hit/miss verdict is asynchronous — the engine-side verifier reports it
// ~0.35-0.5 s after the line — so the default ~50 ms note linger /
// ~0.48 s chord linger lapses before the tint can apply. Drives both
// the outer-loop cull (ndVerdictT0) and the smart drawNote cull below.
export const NOTEDETECT_GEM_VERDICT_WINDOW = 0.75;
// chDt threshold past the hit line at which the chord-frame scan
// gives up on an arpeggio-style frame whose constituents never come
// in. Must be < NOTEDETECT_GEM_VERDICT_WINDOW (the rim's draw life
// in detect mode); placing it at 0.55 s leaves ~0.2 s of the visible
// window for the latch to fire and skip subsequent scans.
export const _ND_UNMATCHED_LATCH_AFTER = 0.55;
// Sample approach offsets dt in [0, AHEAD] into strips. Lane quads use
// z = dZ(dt) + TS*BEHIND = TS*(BEHIND - dt), while notes use z = dZ(n.t-now).
// So note hit line (z=0) aligns with dt=BEHIND, not dt=0. Chart time at
// lane parameter dt is now + dt - BEHIND (same z as a note at that time).
// Each strip’s <anchor> uses that chart time so the blue lane doesn’t
// switch ~BEHIND seconds before the XML <anchor time="…"/>.
export const HWY_LANE_TIME_SLICES = 96;
/** Odd columns (1st/3rd/…) darker teal; even columns brighter blue. */
export const HWY_LANE_STRIPE_ODD_HEX  = 0x103B5C;
export const HWY_LANE_STRIPE_EVEN_HEX = 0x08283C;
/** Lane quad alpha: base + highwayIntensity * scale (readable on dark floor). */
export const HWY_LANE_STRIPE_OP_BASE = 1.0;
export const HWY_LANE_STRIPE_OP_INT  = 0;
/** Venue mode: slight near-lane contrast boost (visual only). */
export const VENUE_LANE_OP_BOOST = 1.1;
/** Venue mode: gem emissive pop (~12%, visual only). */
export const VENUE_GEM_EMISSIVE_MUL = 1.12;
/** Venue steady-state haze coefficient — kept low for raster bg plate. */
export const VENUE_HAZE_STEADY = 0.008;
/** Venue backdrop pushed slightly farther for parallax depth. */
export const VENUE_BACKDROP_DISTANCE_MUL = 1.06;
/** Note travel speed. */
export const TS = 230 * K;

const RENDER_ORDER_LAYER_STACK = Object.freeze([
    'CHORD_FILL',
    'CHORD_STRUM_FILL',
    'CHORD_STRUM_LINE',
    'SUSTAIN_TRAIL',
    'CHORD_FRAME',
    'CHORD_EDGE_GLOW',
    'CONNECTOR_LINE',
    'FRET_COLUMN',
    'ARP_CONNECTOR_LINE',
    'NOTE_OUTLINE',
    'NOTE_CORE',
    'TECHNIQUE_MARKER',
    'BOARD_STRING',
    'BOARD_FRET_WIRE',
    'NOTE_FRET_LABEL',
    'ARP_NOTE_FRET_LABEL',
    'CHORD_FRET_LABEL',
]);
const RENDER_ORDER_LAYER_INDEX = Object.freeze(RENDER_ORDER_LAYER_STACK.reduce(
    (indexByLayer, layerName, layerIndex) => {
        indexByLayer[layerName] = layerIndex;
        return indexByLayer;
    },
    Object.create(null)
));

const RENDER_ORDER_AT_Z_ZERO = 700;
const RENDER_ORDER_FAR_CLAMP = 50;

/**
 * Computes renderOrder from world depth plus a named layer.
 * Closer objects receive larger values and paint over farther objects; the
 * layer stack breaks ties at the same depth, keeping labels above note gems.
 *
 * The layer index is added as a sub-unit fraction (< 1) so the integer
 * depth bucket STRICTLY dominates: a farther object can never outrank a
 * nearer one merely because it sits on a higher layer. Adding the raw index
 * (0..N-1) directly would let the ~N-wide layer span leak across depth
 * buckets and re-introduce far-over-near bleed for notes within ~N draw
 * units of each other. Fraction granularity (1/N ≈ 0.06) stays well above
 * the 0.0001 intra-element sub-increments used at some call sites.
 */
export function renderOrderForLayerAtZ(worldZ, layerName) {
    const layerIndex = RENDER_ORDER_LAYER_INDEX[layerName];
    if (layerIndex === undefined) throw new Error(`Unknown 3D highway depth layer: ${layerName}`);
    const depthRenderOrder = Math.max(
        RENDER_ORDER_FAR_CLAMP,
        Math.round(RENDER_ORDER_AT_Z_ZERO + worldZ / K)
    );
    return depthRenderOrder + layerIndex / RENDER_ORDER_LAYER_STACK.length;
}

/** Match `nextNoteByString` onset to this note (float + chart rounding; avoids ghost / glow flicker). */
export const NEXT_ON_STRING_T_EPS = 0.06;
/** Fixed pre-impact ramp window for lead-note board ghosts (Primary + Upcoming slots). */
export const GHOST_UPCOMING_WIN = 0.6;
/** Ghost starts at this fraction of full size/brightness and grows to 1.0 as it approaches. */
export const PROJ_GROW_MIN = 0.45;
/**
 * 3D highway post-strum tail — chord frame + ghost fret digit share the same
 * hold and fade so timing stays consistent.
 */
export const CHORD_HWY_LINGER_S = 0.75;
/** Linear fade at end of `CHORD_HWY_LINGER_S` (applies to chord UI and board ghost numbers). */
export const CHORD_HWY_FADE_S = 0.32;
export const GHOST_HOLD_AFTER_ONSET = CHORD_HWY_LINGER_S;
export const GHOST_FRET_LBL_FADE_S = CHORD_HWY_FADE_S;
/** Purple lane rails: extend past last matched chord/note so Z reaches frame end. */
export const ARP_HWY_RAIL_END_TAIL_S = 0.38;
/** Keep 0 — chord/note-based ``shapeLo`` already aligns to the visible frame. */
export const ARP_HWY_RAIL_START_LEAD_S = 0;
/** Drives emissive (`mGlow` / accent fill) for notes with `.ac`; matches drawNote `linger` cutoff (0.05). */
export const ACCENT_NOTE_STR_GLOW = 3.55;
export const ACCENT_NOTE_LINGER_EPS = 0.05;
/** Extra emissive layered on accent-only body material (`mAccentCore`), after `strGlow * glowMul`. */
export const ACCENT_NOTE_FILL_BOOST = 2.55;
/** Accent rim draws brighter than normal string-coloured outlines (`mStrHitOutline`). */
export const ACCENT_RIM_BASE_EMISSIVE = 3.45;
/** Outline / core scale bump vs normal gems (accent reads slightly larger). */
export const ACCENT_RIM_XY_SCALE_MUL = 1.09;
export const ACCENT_RIM_Z_SCALE_MUL = 1.06;
// Soft neon-style outer bloom (AdditiveBlending) — layered shells behind outline/core.
export const ACCENT_HALO_OP_NEAR = 0.68;
export const ACCENT_HALO_OP_MID = 0.42;
export const ACCENT_HALO_OP_FAR = 0.24;
export const ACCENT_HALO_XY_INNER = 1.36;
export const ACCENT_HALO_XY_MID = 1.82;
export const ACCENT_HALO_XY_OUTER = 2.32;
export const ACCENT_HALO_Z_INNER = 1.05;
export const ACCENT_HALO_Z_MID = 1.12;
export const ACCENT_HALO_Z_OUTER = 1.22;

/**
 * Post-hit tail fade shared by ghost fret digits and 3D chord UI: full
 * opacity until (holdS − fadeS) after onset, then linear fade over fadeS;
 * canceled when `nextSoon` — for ghosts: next note within `fadeS` of `now`;
 * for chord frame: next chord onset lies in chart time [hold − fade, hold]
 * after the current chord (so fade does not run into a same-window handoff).
 * @param {number} dt chart time minus now (negative once struck)
 * @param {number} fadeS linear fade duration (default: GHOST_FRET_LBL_FADE_S)
 */
export function hwyPostHitTailFadeMul(dt, holdS, nextSoon, fadeS = GHOST_FRET_LBL_FADE_S) {
    if (nextSoon || dt >= 0) return 1;
    const gone = -dt;
    if (gone >= holdS) return 0;
    const fS = Math.min(Math.max(fadeS, 1e-6), holdS);
    const fadeStartT = Math.max(0, holdS - fS);
    if (gone < fadeStartT) return 1;
    return Math.max(0, 1 - (gone - fadeStartT) / fS);
}

// Shorter, flatter notes (joel style)
export const NW = 5 * K, NH = 3 * K, ND = 0.25 * K;
// Sustain-trail X offset for fretted notes. Module-scoped + frozen
// so the hot path's `offsets.length` loop sees a stable singleton
// reference. The standalone-open-string path builds a fresh pair
// each call because its offset magnitude depends on the per-note
// `openWScale` (set in drawNote at line 7367 from the open-string
// body's lane width), so a module-scoped constant can't capture
// it; the allocation is the same one the prior code did via
// `const baseOff = NW * 3 * openWScale` plus the inline `[-, +]`
// literal in the chord-member branch — just consolidated.
export const SINGLE_SUS_OFFSETS = Object.freeze([0]);
export const BEND_HALFSTEP_WORLD_Y = S_GAP * 0.8;
export const VIBRATO_HALF_WAVE_S = 0.08;
// Bend ribbon envelope: fraction of the sustain spent ramping up to
// the bent pitch, and releasing back down (rest is the held plateau).
export const BEND_ENV_RISE_FRAC = 0.35;
export const BEND_ENV_RELEASE_FRAC = 0.30;
export const TREMOLO_BUMP_S = 0.06;

/** Longitudinal samples for sustain-technique prism (indexed BufferGeometry). */
export const SLIDE_RIBBON_SAMPLES = 96;
/** Pre-built index buffer: `SLIDE_RIBBON_SAMPLES` × 8 tris × 3 verts. */
const SLIDE_RIBBON_INDICES = (() => {
    const S = SLIDE_RIBBON_SAMPLES;
    const idx = new Uint16Array(S * 24);
    let o = 0;
    for (let k = 0; k < S; k++) {
        const b = k * 4;
        const nx = (k + 1) * 4;
        // Bottom (-Y outward)
        idx[o++] = b; idx[o++] = b + 1; idx[o++] = nx + 1;
        idx[o++] = b; idx[o++] = nx + 1; idx[o++] = nx;
        // Top (+Y outward)
        idx[o++] = b + 3; idx[o++] = nx + 3; idx[o++] = nx + 2;
        idx[o++] = b + 3; idx[o++] = nx + 2; idx[o++] = b + 2;
        // Left (-X outward)
        idx[o++] = b; idx[o++] = nx; idx[o++] = nx + 3;
        idx[o++] = b; idx[o++] = nx + 3; idx[o++] = b + 3;
        // Right (+X outward)
        idx[o++] = b + 1; idx[o++] = b + 2; idx[o++] = nx + 2;
        idx[o++] = b + 1; idx[o++] = nx + 2; idx[o++] = nx + 1;
    }
    return idx;
})();
// Three r170's setIndex() only wraps plain Arrays into Uint16BufferAttribute;
// typed-array input gets assigned raw onto .index, which trips WebGL's
// byteLength check. Convert once at module init so each pooled geometry
// reuses the same Array reference instead of allocating per mesh.
export const SLIDE_RIBBON_INDICES_ARR = Array.from(SLIDE_RIBBON_INDICES);
const N_RAD = 1.5 * K;
const SW = 2 * K, SH = 1.5 * K;

export const CAM_H_BASE = 190 * K;
export const CAM_DIST_BASE = 240 * K;
export const REF_ASPECT = 16 / 9;
export const FOCUS_D = 600 * K;
export const CAM_LERP_BASE = 0.02;

// Base vertical field of view (deg). THREE's PerspectiveCamera fov is the
// VERTICAL angle; horizontal follows from the aspect ratio. At a normal
// ~16:9 pane this gives a ~102° horizontal cone. On an ultra-wide pane
// (top/bottom 2-player split → full-width/half-height → ~32:9) that
// horizontal cone balloons past 130° and squeezes the fixed-width neck into
// a central sliver. The optional horizontal-FOV-hold path below counters
// that by lowering the effective vertical fov as the pane widens.
export const BASE_VFOV = 70;
// Horizontal-FOV-hold ("Hor+") defaults. At/under HORPLUS_START_ASPECT the
// effective vertical fov equals BASE_VFOV (exact no-op); past it the
// vertical fov drops to keep the horizontal cone ~constant so the neck
// fills a wide pane. HORPLUS_MIN_VFOV floors the result on pathological
// aspects. Engaged only via the window.__h3dAspectTune bridge (default off).
export const HORPLUS_START_ASPECT = 16 / 9;
export const HORPLUS_MIN_VFOV = 28;

// Zoom-dependent framing — height (h*) and depth (dist*) multipliers
// applied to cam.position. Interpolated by `dist`:
//   NEAR = tight view (nut position, span<=4 -> dist~=93*K): lower/closer.
//   FAR  = wide view (midpoint fret 1<->20 -> dist~=141*K): higher/pulled back
//          to fit the whole neck.
// Outside this range the values clamp at the endpoints.
export const CAM_FRAME_DIST_NEAR = 93 * K;
export const CAM_FRAME_DIST_FAR  = 141 * K;
export const CAM_FRAME_H_NEAR = 0.75;
export const CAM_FRAME_H_FAR  = 1.00;
export const CAM_FRAME_D_NEAR = 0.575;
export const CAM_FRAME_D_FAR  = 0.60;
// Fret-row fit guard. The heat-coloured fret-number row is a band drawn
// BELOW the board (at sY(lowest) - S_GAP*1.4). The lower-third framing
// anchors the board CENTRE, not that row, so a tight zoom on a centred span
// (worst mid-neck — fine pushed to either end of the neck) drops the row off
// the bottom edge. Tilt can't add vertical room there (it would only trade a
// bottom clip for a top clip), so camUpdate dollies the camera back just
// enough to bring the row back into frame — auto-sized, capped, hysteretic.
export const FRET_ROW_FIT_NDC_MIN   = -0.86;  // keep the row anchor at/above this NDC y (>-1 = on screen)
export const FRET_ROW_FIT_DEADBAND  = 0.06;   // headroom past the min before the dolly relaxes (anti-hunt)
export const FRET_ROW_FIT_BOOST_MAX = 1.6;    // cap the pull-back so the zoom can't pop (never dolly back > +60%)

// Camera-X targeting (issue #34). The visible AHEAD = 4.0 s window is
// far too coarse for picking where the camera should sit — a single
// 17th-fret bend 2.5 s away yanks tgtX several frets even though the
// immediate playing area hasn't moved. These constants are bounds for
// a smoothing dial (0 = twitchy, 1 = calm); the runtime lerps between
// the pair using the user's `cameraSmoothing` setting.
export const CAM_TGT_BEHIND   = 0.2;   // s behind hit line for X targeting
export const CAM_TGT_AHEAD_T  = 2.0;   // s — twitchy: longer lookahead (more reactive)
export const CAM_TGT_AHEAD_C  = 0.7;   // s — calm: shorter lookahead (ignore distant outliers)
export const CAM_TGT_TAU_T    = 0.35;  // s — twitchy: short recency time-constant
export const CAM_TGT_TAU_C    = 0.9;   // s — calm: longer time-constant (averages more)
export const CAM_TGT_HYST_T   = 0.25;  // frets — twitchy: tiny dead zone
export const CAM_TGT_HYST_C   = 5.0;   // frets — calm: ~5-fret dead zone, wide
                                // enough to swallow chord-to-chord
                                // alternations across a 6-fret span
                                // (e.g. Am ↔ D in first position).

// Zoom (tgtDist) damping. Controlled by its own `zoomSmoothing` setting
// so X-pan and zoom-pull-back can be tuned independently. New users
// (and existing users who never wrote zoomSmoothing) inherit
// cameraSmoothing's value on first read, so default behaviour is
// unchanged from when zoom + X shared a single slider.
export const CAM_DIST_HYST_T  = 0.5;   // fret-span — twitchy: minimal dead zone
export const CAM_DIST_HYST_C  = 5.0;   // fret-span — calm: 5-fret span change required

// Vertical-tilt damping. Drives the tgtLookY self-correction loop in
// camUpdate(): how far the fretboard's NDC Y can drift from
// DESIRED_NDC_Y before we nudge the camera, and how strongly each
// nudge corrects. Twitchy = narrow band + strong correction (re-frame
// aggressively); calm = wide band + weak correction (let small drift
// ride). Driven by `tiltSmoothing`, mirrors cameraSmoothing on first
// read like zoomSmoothing does.
// Bounds chosen so the midpoint (tiltSmoothing=0.5) reproduces the
// pre-PR hardcoded behaviour (band=0.15, str=0.5). Without that, a
// fresh install would silently change the vertical-tilt feel even
// though the PR description promises "default behaviour unchanged."
export const CAM_TILT_BAND_T  = 0.05;  // NDC — twitchy: narrow tolerance
export const CAM_TILT_BAND_C  = 0.25;  // NDC — calm: wide tolerance, fewer corrections
export const CAM_TILT_STR_T   = 0.8;   // multiplier — twitchy: strong nudge per correction
export const CAM_TILT_STR_C   = 0.2;   // multiplier — calm: weak nudge per correction

// Lock-low zoom range. The cameraLockZoom slider (0..1) blends between
// these two multipliers and scales the locked tgtDist. Defaults pick
// 1.0× at slider=0.5 so the previous locked view is the midpoint.
export const CAM_LOCK_ZOOM_MIN = 0.55;  // slider=0 — closest, biggest fretboard
export const CAM_LOCK_ZOOM_MAX = 1.45;  // slider=1 — furthest
export const CAM_LOCK_CENTER_FRET = 6;  // default camera X center (first-position midpoint)

// ── 3D preview: lookahead fret bounds + smoothed focal X / span ─────────
/** User-selectable via `cameraMode`. Legacy `classic` in storage maps to `steady`. */
export const CAMERA_MODE_IDS = ['steady', 'lookahead'];
export const CAM_LOOKAHEAD_SEC = 3.0;       // fallback when no beats/measures are available
export const CAM_LOOKAHEAD_MEASURES = 9;    // lookahead window = N measures ahead
export const CAM_FOCUS_BLEND_RATE = 0.7;
export const CAM_FRET_EDGE_BLEND = 0.1;
export const DEFAULT_LOOKAHEAD_FRET_SPAN = 4;
/** Schmitt: avoid lock↔dynamic flicker when lookahead maxF jitters at the 12th fret. */
export const LOOKAHEAD_LOCK_RELEASE_MAXF = 13;
export const LOOKAHEAD_LOCK_ENGAGE_MAXF = 10;
// Note: we deliberately do NOT scale the camUpdate lerp speed with
// cameraSmoothing. Smoothing widens the hysteresis dead zones so the
// camera stays put through small/repetitive shifts; but when a shift
// *does* clear the gate (a real jump to a far fret), we want the slide
// to be snappy, not lethargic. The dead zone gates "should we move?",
// the BPM-scaled lerp answers "how fast" — keeping those orthogonal
// gives the right feel.

export const FOG_START = 200 * K;
export const FOG_END = 670 * K;

export const DOTS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
export const DDOTS = new Set([12, 24]);
export const INLAY_LABEL_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 22, 24]; // 22 not 21: intentional display choice

// Fret-column reference markers: floor-aligned fret-number sprites
// that scroll toward the hit line every Nth measure. When the chart
// has <anchor>, the row uses the inlay cadence (DOTS) around the
// anchor fret: two marker positions before and three after the
// snapped cadence cell (e.g. anchor fret 7 → 3,5,7,9,12,15).
const FRET_COL_MARKER_ANCHOR_BACK = 2;
const FRET_COL_MARKER_ANCHOR_FWD = 3;

/**
 * @param {number} anchorFret Chart anchor `.fret` (world start fret).
 * @param {number[]} [cadence] Ascending frets (e.g. DOTS).
 * @returns {number[]}
 */
export function fretColumnMarkersForAnchor(anchorFret, cadence = DOTS) {
    const f0 = Math.round(Number(anchorFret));
    if (!Number.isFinite(f0) || cadence.length === 0) return cadence.slice();
    let iBest = 0;
    let dBest = Infinity;
    for (let i = 0; i < cadence.length; i++) {
        const d = Math.abs(cadence[i] - f0);
        if (d < dBest || (d === dBest && cadence[i] < cadence[iBest])) {
            dBest = d;
            iBest = i;
        }
    }
    const i0 = Math.max(0, iBest - FRET_COL_MARKER_ANCHOR_BACK);
    const i1 = Math.min(cadence.length, iBest + FRET_COL_MARKER_ANCHOR_FWD + 1);
    return cadence.slice(i0, i1);
}

// Fast integer key for (t, s) pairs — avoids per-frame string allocation in
// hot-path Set lookups. Encodes chart time in 0.1 ms steps (sufficient for
// chart-format note precision) combined with the string index.
// t range 0–600 s → 0–6,000,000; * 10 + s(0–7) = max 60,000,007 < 2^53 ✓.
// The |0 truncates to int32 but the outer multiply stays in float64, so the
// key is always a safe JS integer for songs ≤ 214,748 s (well above any song).
export function _noteKey(t, s) { return ((t * 10000 + 0.5) | 0) * 10 + s; }

// Binary lower-bound: returns the first index i in arr where arr[i].t >= t.
// Assumes arr is sorted ascending by .t (bundle.notes / bundle.chords always are).
// Byte-identical to core's bundle.lowerBoundT — kept as a local because this
// plugin must run on downlevel hosts whose bundles don't carry the helper
// (it's called from ~30 sites incl. top-level helpers that don't receive a
// bundle). New code that already holds a bundle should prefer
// bundle.lowerBoundT / bundle.lowerBoundTime.
export function lowerBoundT(arr, t) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid].t < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// Last arrangement <anchor> at or before chart time `t` (sorted by .time).
// Mirrors static/highway.js getAnchorAt — until t reaches the first anchor’s
// time, the first anchor still defines fret/width.
// Binary search: this is called inside per-frame loops (lane slicing,
// lookahead sampling, marker spawning), so the linear scan was O(samples *
// numAnchors) on dense charts.
export function getChartAnchorAt(anchorArr, t) {
    if (!anchorArr || !anchorArr.length) return null;
    let lo = 0, hi = anchorArr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (anchorArr[mid].time <= t) lo = mid + 1;
        else hi = mid;
    }
    return lo === 0 ? anchorArr[0] : anchorArr[lo - 1];
}

/** @returns {{ dMin: number, dMax: number } | null} */
export function laneBoundsFromAnchor(anc) {
    if (!anc) return null;
    let fStart = Math.round(Number(anc.fret));
    // Match anchorPlayedFretInclusiveSpan(): fret 0 (and below) clamps
    // to 1, otherwise the lane span ends up one fret narrower than the
    // played-fret span / label highlighting on charts that emit
    // <anchor fret="0" width="N">.
    if (!Number.isFinite(fStart) || fStart < 1) fStart = 1;
    let w = Number(anc.width);
    if (!Number.isFinite(w)) w = 4;
    w = Math.max(1, Math.round(w));
    const fLast = Math.min(NFRETS, fStart + w - 1);
    const dMin = Math.max(0, fStart - 1);
    const dMax = Math.min(NFRETS, fLast);
    return { dMin, dMax };
}

/** Same horizontal span as the dynamic highway lane: anchor at chart time `t`. */
export function anchorLaneBoundsAt(anchorArr, t) {
    if (!anchorArr || !anchorArr.length) return null;
    return laneBoundsFromAnchor(getChartAnchorAt(anchorArr, t));
}

/**
 * Inclusive chart-fret indices for the playing window (anchor `fret` + `width`),
 * e.g. fret=5 width=4 → 5..8. Unlike {@link laneBoundsFromAnchor}'s `dMin`/`dMax`
 * (diagram wire span), these are the labels shown on gems / row numbers.
 * @returns {{ f0: number, f1: number } | null}
 */
function anchorPlayedFretInclusiveSpan(anc) {
    if (!anc) return null;
    let f0 = Math.round(Number(anc.fret));
    if (!Number.isFinite(f0) || f0 < 1) f0 = 1;
    let w = Number(anc.width);
    if (!Number.isFinite(w)) w = 4;
    w = Math.max(1, Math.round(w));
    const f1 = Math.min(NFRETS, f0 + w - 1);
    return { f0, f1 };
}

export function anchorPlayedFretSpanAt(anchorArr, t) {
    if (!anchorArr || !anchorArr.length) return null;
    return anchorPlayedFretInclusiveSpan(getChartAnchorAt(anchorArr, t));
}

export const FRET_COOLDOWN = 0.5; // seconds a lane fret stays active after last note

export const DIAG_LINGER_S    = 0.55;
export const DIAG_ENTRANCE_S  = 0.20;
export const DIAG_CROSSFADE_S = 0.15;
export const DIAG_SIZE_MIN    = 0.08;
export const DIAG_SIZE_MAX    = 0.16;
export const DIAG_CELL_MAX    = 34;
// 'bl' and 'br' removed — diagram is top-only. Legacy localStorage values
// that contain 'bl'/'br' will fall back to BG_DEFAULTS.chordDiagramPosition
// via _bgCoerce (which rejects values not in this list).
export const CHORD_DIAG_POSITION_IDS = ['tl', 'tr'];

/** Default chord-box rim / fill gradient (teal family). */
export const CHORD_BOX_TEAL_HEX = 0x00d2d5;
export const CHORD_BOX_TEAL_DARK_HEX = 0x003c3d;
/** Frame edge quads: premultiplied-ish alpha match (~128/255). */
export const CHORD_BOX_EDGE_ALPHA = 128 / 255;
/** Interior gradient strip alpha on both stops (~32/255). */
export const CHORD_BOX_FILL_GRAD_ALPHA = 32 / 255;
/** Arpeggio interior wash; dedicated gradient tex so teal map doesn’t dominate. */
export const ARPEGGIO_BOX_BLUE_HEX = 0x454BB6;
export const ARPEGGIO_BOX_BLUE_DARK_HEX = 0x2D3190;
/** Arpeggio rim accent and lane tint. */
export const ARPEGGIO_RIM_BLUE_HEX = 0x454BB6;
/** Post-hit chord-frame rim tints driven by the note-state provider
 *  (feedBack#254). Applied only to the teal frame during the linger
 *  fade (chDt <= 0) when a scorer is attached.
 *  Matches the gem hit/miss colours so chord frame and note body
 *  give a consistent signal:
 *    hit  → neon spring-green 0x22ff88 (same as mHitBright).
 *    miss → hot magenta-red 0xff0066 (same as mMissOutline). */
export const CHORD_BOX_HIT_BRIGHT_HEX  = 0x22ff88;
export const CHORD_BOX_MISS_DARK_HEX   = 0xff0066;

/** Fret-number label tints — gold on approaching/active notes, muted blue when idle. */
export const FRET_LABEL_GOLD_HEX = '#D8A636';
export const FRET_LABEL_IDLE_HEX = '#9ab8cc';

/** 3D chord-box rim bars (thin on all chords, including repeats in a sequence). */
export const CHORD_FRAME_RIM_MIN = 0.055;       // × K — floor thickness
export const CHORD_FRAME_RIM_FRAC_H = 0.028;    // × fullChordBoxH
export const CHORD_FRAME_RIM_Z_MIN = 0.048;      // × K — depth squash
export const CHORD_FRAME_RIM_Z_SCAL = 0.68;     // thickZ scales with ft
/**
 * Highway arpeggio frame uses ``inferArpeggioFromNotePattern`` only inside this
 * window around ``ch.t``. Hand-shape spans can cover many seconds and several
 * separate strums of the same voicing; a full-span scan mis-detects arpeggio
 * from beats that belong to different chord rows.
 */
export const ARP_FRAME_ONSET_PAD_S = 0.06;
export const ARP_FRAME_ONSET_CLUSTER_S = 0.26;
/**
 * The chart format encodes fast alternating power chords (e.g. D5/D#5 gallops) as
 * very short ``<handShape>`` rows (~0.05–0.2 s). Note-stream arpeggio
 * inference must not treat strum spread across strings as arpeggio there —
 * it false-triggers lavender highway rails / frames (see Frantic ~2:36).
 */
export const ARP_INFER_MIN_HAND_SHAPE_SPAN_S = 0.21;
/**
 * In a **short** chart window, chord strums (same voicing, strings picked
 * within ~30–45 ms) barely exceed this total spread; real arpeggios in that
 * window are usually slower across strings OR have 4+ plucks.
 */
export const ARP_INFER_STRUM_VS_ARP_SPREAD_MIN_S = 0.047;
/**
 * If more than ``shape.size + ARP_INFER_MULTI_STRUM_HIT_SLACKS`` matching picks
 * sit inside a non-trivial hand-shape window, the chart is almost certainly
 * **repeated strums** of the same chord (or gallops), not one arpeggio sweep.
 */
export const ARP_INFER_MULTI_STRUM_HIT_SLACK = 2;
/** ``timeWin`` span above which we apply the multi-strum hit-count cap. */
export const ARP_INFER_MULTI_STRUM_WIN_MIN_S = 0.26;
/**
 * Minimum staggered hits inside a hand-shape window for note-stream arpeggio
 * inference. A genuine arpeggio sweeps several strings of the held shape;
 * a 2-note melodic motif inside a multi-string ``<handShape>`` (e.g. Jackson 5
 * "I Want You Back" ~0:27 — Fm7 transition fingering with two plucks on
 * strings 4–5) earlier registered as arpeggio and produced a stray lavender
 * chord frame + purple lane outer dividers. Cap at ``min(shape.size, 3)``
 * so 2-string voicings still infer normally and 3+ string templates need
 * a real sweep.
 */
export const ARP_INFER_MIN_HITS_VS_SHAPE_CAP = 3;

/* ======================================================================
 *  Pure helpers
 * ====================================================================== */

// Logarithmic spacing — mirrors real guitar fret geometry (12th root of 2).
const _fretXLog = f => {
    if (f <= 0) return 0;
    const raw = FRET_SCALE - FRET_SCALE / Math.pow(2, f / 12);
    if (f <= FRET_SPACING_ANCHOR_F) return raw;
    const rawAnchor = FRET_SCALE - FRET_SCALE / Math.pow(2, FRET_SPACING_ANCHOR_F / 12);
    return rawAnchor + (raw - rawAnchor) * FRET_SPACING_STRETCH_ABOVE12;
};
// Uniform spacing — same column width per fret (chart-format style).
// Total board width equals the logarithmic NFRETS position for consistency.
const _fretXUniStep = _fretXLog(NFRETS) / NFRETS;
const _fretXUni = f => f <= 0 ? 0 : f * _fretXUniStep;

let _h3dFretUniform = true;
try { _h3dFretUniform = localStorage.getItem('highway_3d.fretSpacing') !== 'logarithmic'; } catch (_) {}
export const fretX = f => _h3dFretUniform ? _fretXUni(f) : _fretXLog(f);

// Applies a validated fret-spacing mode live: rebinds the module-scope
// flag so panels mounted later pick up the new mode, then recomputes the
// fretX-derived scalars. The window setter lives with the other settings
// setters in the settings store.
export function _applyFretSpacingMode(m) {
    _h3dFretUniform = (m !== 'logarithmic');
    _recomputeFretSpacingDerived();
}

export const fretMid = f => (f <= 0 ? -2 * K : (fretX(f - 1) + fretX(f)) / 2);
/** World-space width of fret column (wires f−1 .. f); used to scale row markers past ~12. */
function fretColumnWorldW(f) {
    const fi = Math.round(Number(f));
    if (!Number.isFinite(fi) || fi <= 0) return Math.abs(fretX(1) - fretX(0));
    const lo = Math.min(NFRETS, Math.max(1, fi));
    return Math.abs(fretX(lo) - fretX(lo - 1));
}
/** Reference column (~mid board): prior fixed K-based sprites matched this neighborhood. */
const FRET_LABEL_SCALE_REF_FRET = 5;
// `let` (not `const`): recomputed by _recomputeFretSpacingDerived when the
// user flips Uniform/Logarithmic at runtime so label scaling tracks the
// new geometry without a page reload.
let _fretLabelScaleRefW = Math.max(1e-8, fretColumnWorldW(FRET_LABEL_SCALE_REF_FRET));
export function fretLabelScaleForFret(f) {
    const w = fretColumnWorldW(f);
    const m = w / _fretLabelScaleRefW;
    return Math.max(0.32, Math.min(1.45, m));
}
export const dZ = dt => -dt * TS;

/**
 * Pitched slide uses `sl`, unpitched uses `slu` (slide-to vs unpitched slide fields).
 * Prefer `sl` when both are present — matches RS wire.
 * @returns {{ endFret: number, unpitched: boolean } | null}
 */
export function slideTrailEnd(n) {
    const sl = n.sl;
    const slu = n.slu;
    if (Number.isFinite(sl) && sl >= 0) {
        return { endFret: sl | 0, unpitched: false };
    }
    if (Number.isFinite(slu) && slu >= 0) {
        return { endFret: slu | 0, unpitched: true };
    }
    return null;
}

/**
 * Lateral slide offset along the fretboard during sustain — easing
 * mirrors the pitched/unpitched slide offset convention above.
 * @param {{ endFret: number, unpitched: boolean } | null} [st_] from slideTrailEnd
 */
export function slideOffsetWorldX(n, chartTime, st_) {
    const st = st_ || slideTrailEnd(n);
    if (!st || n.f <= 0 || !(n.sus > 0)) return 0;
    const denom = Math.max(n.sus, 1e-6);
    const p = Math.max(0, Math.min(1, (chartTime - n.t) / denom));
    const startX = fretMid(n.f);
    const endX = fretMid(st.endFret);
    const w = st.unpitched
        ? 1 - Math.sin((1 - p) * Math.PI / 2)
        : Math.pow(Math.sin(p * Math.PI / 2), 3);
    return (endX - startX) * w;
}

// Camera tgtDist building blocks. Both the dynamic (camera-follow)
// and locked (frets 1-12) branches compose tgtDist from these, so
// any future tuning of the base zoom curve or low-fret pullback
// lands in both branches without drift.
//   span    — camDistMax - camDistMin in fret-span units
//   minFret — lowest fretted note in the camera window (or 1 for
//             the locked branch, which assumes nut chords)
export const camBaseDistU = span => 65 + Math.max(span, 4) * 3;
export const camLowFretPullbackU = minFret => Math.max(0, 5 - minFret) * 4;

// World-units-per-fret near mid-neck. Used by the camera-X hysteresis
// gate (issue #34) to convert a fret-equivalent dead zone into world
// units. Pure function of SCALE — hoist out of update()'s hot path.
// `let` (not `const`): recomputed alongside _fretLabelScaleRefW when the
// fret-spacing mode flips at runtime — see _recomputeFretSpacingDerived.
export let FRET_WIDTH_MID = fretX(7) - fretX(6);

// Recompute the fretX-derived scalars baked at module init. Called from
// h3dSetFretSpacing after _h3dFretUniform flips so label scaling and the
// camera hysteresis threshold track the newly chosen spacing — the live
// alternative to the old location.reload(), which ejected the user from
// Settings back to the home screen.
function _recomputeFretSpacingDerived() {
    _fretLabelScaleRefW = Math.max(1e-8, fretColumnWorldW(FRET_LABEL_SCALE_REF_FRET));
    FRET_WIDTH_MID = fretX(7) - fretX(6);
}

export function computeBPM(beats, t) {
    if (!beats || beats.length < 2) return 120;
    let lo = 0, hi = beats.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid].time < t) lo = mid + 1; else hi = mid;
    }
    let closest = lo;
    if (lo === beats.length) closest = beats.length - 1;
    else if (lo > 0 && Math.abs(beats[lo - 1].time - t) < Math.abs(beats[lo].time - t)) closest = lo - 1;
    const start = Math.max(0, closest - 2);
    const end = Math.min(beats.length - 1, closest + 2);
    let sum = 0, count = 0;
    for (let i = start; i < end; i++) {
        const dt = beats[i + 1].time - beats[i].time;
        if (dt > 0) { sum += dt; count++; }
    }
    return count > 0 && sum > 0 ? 60 / (sum / count) : 120;
}

// Build a horizontal gaussian DataTexture for the sustain-rail bloom effect.
// Returns a W×1 RGBA texture where alpha follows exp(-0.5*(u−0.5)²/σ²),
// peaking at 1.0 in the centre. With the default σ=0.28 the edges retain
// ~0.20 alpha (not fully transparent) — a deliberately soft, wide falloff
// so the additive bloom fades gradually rather than cutting off sharply.
// Power-of-two width keeps WebGL mipmapping happy.
export function _makeGaussTex(ThreeLib, w = 128, sigma = 0.28) {
    const data = new Uint8Array(w * 4);
    for (let i = 0; i < w; i++) {
        const u = i / (w - 1);
        const d = (u - 0.5) / sigma;
        const v = Math.exp(-0.5 * d * d);
        const a = Math.round(v * 255);
        data[i * 4]     = 255;
        data[i * 4 + 1] = 255;
        data[i * 4 + 2] = 255;
        data[i * 4 + 3] = a;
    }
    const tex = new ThreeLib.DataTexture(data, w, 1, ThreeLib.RGBAFormat);
    // LinearFilter on both axes so the bloom plane interpolates smoothly
    // when scaled — the default NearestFilter causes visible banding.
    tex.magFilter = ThreeLib.LinearFilter;
    tex.minFilter = ThreeLib.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}
