// 3D Highway visualization plugin — Three.js note highway.
// Visual layer from joel's prototype (vibrant palette, glowing strings,
// fret heat, dynamic lane, chord frame-boxes, per-note connector labels,
// board projection, outline+core note meshes) adapted into the
// feedBackViz setRenderer contract (feedBack#36) so it works in the
// main player and per-panel in splitscreen without any architectural
// changes.

import { _nextAspectPaneUid, _aspectPaneKey, _aspectRegisterPane, _resolveTuneFor } from './aspect-panel.js';
import { createChartAnalysis } from './chart-analysis.js';
import { createTextSprites } from './text-sprites.js';
import {
    BG_DEFAULTS,
    BG_STYLES,
    BG_ZERO_BANDS,
    _bgBackgroundColors,
    _bgGetAnalyser,
    _bgHasStored,
    _bgHighwayColors,
    _bgMemFallback,
    _bgPanelKey,
    _bgReadBands,
    _bgReadSetting,
    _bgResetAnalyserBridgeForTest,
    _bgSubscribe,
    _bgUnsubscribe,
    _freeCamFor,
    _venueSceneOverride,
    _venueSwapPlateIfNeeded,
} from './background.js';
import {
    ACCENT_HALO_OP_FAR,
    ACCENT_HALO_OP_MID,
    ACCENT_HALO_OP_NEAR,
    ACCENT_HALO_XY_INNER,
    ACCENT_HALO_XY_MID,
    ACCENT_HALO_XY_OUTER,
    ACCENT_HALO_Z_INNER,
    ACCENT_HALO_Z_MID,
    ACCENT_HALO_Z_OUTER,
    ACCENT_NOTE_FILL_BOOST,
    ACCENT_NOTE_LINGER_EPS,
    ACCENT_NOTE_STR_GLOW,
    ACCENT_RIM_BASE_EMISSIVE,
    ACCENT_RIM_XY_SCALE_MUL,
    ACCENT_RIM_Z_SCALE_MUL,
    AHEAD,
    ARPEGGIO_BOX_BLUE_DARK_HEX,
    ARPEGGIO_BOX_BLUE_HEX,
    ARPEGGIO_RIM_BLUE_HEX,
    ARP_FRAME_ONSET_CLUSTER_S,
    ARP_FRAME_ONSET_PAD_S,
    ARP_HWY_RAIL_END_TAIL_S,
    ARP_HWY_RAIL_START_LEAD_S,
    ARP_INFER_MIN_HAND_SHAPE_SPAN_S,
    ARP_INFER_MIN_HITS_VS_SHAPE_CAP,
    ARP_INFER_MULTI_STRUM_HIT_SLACK,
    ARP_INFER_MULTI_STRUM_WIN_MIN_S,
    ARP_INFER_STRUM_VS_ARP_SPREAD_MIN_S,
    BASE_VFOV,
    BEHIND,
    BEND_ENV_RELEASE_FRAC,
    BEND_ENV_RISE_FRAC,
    BEND_HALFSTEP_WORLD_Y,
    CAM_DIST_BASE,
    CAM_DIST_HYST_C,
    CAM_DIST_HYST_T,
    CAM_FOCUS_BLEND_RATE,
    CAM_FRAME_DIST_FAR,
    CAM_FRAME_DIST_NEAR,
    CAM_FRAME_D_FAR,
    CAM_FRAME_D_NEAR,
    CAM_FRAME_H_FAR,
    CAM_FRAME_H_NEAR,
    CAM_FRET_EDGE_BLEND,
    CAM_H_BASE,
    CAM_LERP_BASE,
    CAM_LOCK_CENTER_FRET,
    CAM_LOCK_ZOOM_MAX,
    CAM_LOCK_ZOOM_MIN,
    CAM_LOOKAHEAD_MEASURES,
    CAM_LOOKAHEAD_SEC,
    CAM_TGT_AHEAD_C,
    CAM_TGT_AHEAD_T,
    CAM_TGT_BEHIND,
    CAM_TGT_HYST_C,
    CAM_TGT_HYST_T,
    CAM_TGT_TAU_C,
    CAM_TGT_TAU_T,
    CAM_TILT_BAND_C,
    CAM_TILT_BAND_T,
    CAM_TILT_STR_C,
    CAM_TILT_STR_T,
    CHORD_BOX_EDGE_ALPHA,
    CHORD_BOX_FILL_GRAD_ALPHA,
    CHORD_BOX_HIT_BRIGHT_HEX,
    CHORD_BOX_MISS_DARK_HEX,
    CHORD_BOX_TEAL_DARK_HEX,
    CHORD_BOX_TEAL_HEX,
    CHORD_FRAME_RIM_FRAC_H,
    CHORD_FRAME_RIM_MIN,
    CHORD_FRAME_RIM_Z_MIN,
    CHORD_FRAME_RIM_Z_SCAL,
    CHORD_HWY_FADE_S,
    CHORD_HWY_LINGER_S,
    DDOTS,
    DEFAULT_GEM_GRADIENTS,
    DEFAULT_LOOKAHEAD_FRET_SPAN,
    DIAG_CELL_MAX,
    DIAG_CROSSFADE_S,
    DIAG_ENTRANCE_S,
    DIAG_LINGER_S,
    DIAG_SIZE_MAX,
    DIAG_SIZE_MIN,
    DOTS,
    FOCUS_D,
    FOG_END,
    FOG_START,
    FRET_BOW_DZ,
    FRET_COOLDOWN,
    FRET_EMISSIVE,
    FRET_LABEL_GOLD_HEX,
    FRET_LABEL_IDLE_HEX,
    FRET_METALNESS,
    FRET_ROUGHNESS,
    FRET_ROW_FIT_BOOST_MAX,
    FRET_ROW_FIT_DEADBAND,
    FRET_ROW_FIT_NDC_MIN,
    FRET_TUBE_RADIAL,
    FRET_TUBE_RADIUS,
    FRET_TUBE_SEG,
    FRET_WIDTH_MID,
    GHOST_FRET_LBL_FADE_S,
    GHOST_HOLD_AFTER_ONSET,
    GHOST_UPCOMING_WIN,
    HORPLUS_MIN_VFOV,
    HORPLUS_START_ASPECT,
    HWY_LANE_STRIPE_EVEN_HEX,
    HWY_LANE_STRIPE_ODD_HEX,
    HWY_LANE_STRIPE_OP_BASE,
    HWY_LANE_STRIPE_OP_INT,
    HWY_LANE_TIME_SLICES,
    INLAY_LABEL_FRETS,
    K,
    LOOKAHEAD_LOCK_ENGAGE_MAXF,
    LOOKAHEAD_LOCK_RELEASE_MAXF,
    MAX_RENDER_STRINGS,
    ND,
    NEXT_ON_STRING_T_EPS,
    NFRETS,
    NH,
    NOTEDETECT_GEM_VERDICT_WINDOW,
    NSTR,
    NW,
    PALETTES,
    PROJ_GROW_MIN,
    REF_ASPECT,
    SINGLE_SUS_OFFSETS,
    SLIDE_RIBBON_INDICES_ARR,
    SLIDE_RIBBON_SAMPLES,
    STR_THICK,
    S_BASE,
    S_COL,
    S_GAP,
    TREMOLO_BUMP_S,
    TS,
    VENUE_GEM_EMISSIVE_MUL,
    VENUE_LANE_OP_BOOST,
    VIBRATO_HALF_WAVE_S,
    _ND_UNMATCHED_LATCH_AFTER,
    _customPalette,
    _darkenInt,
    _h3dHexToInt,
    _lightenInt,
    _makeGaussTex,
    _noteKey,
    _openStringPitchLabelsForTuning,
    anchorLaneBoundsAt,
    anchorPlayedFretSpanAt,
    camBaseDistU,
    camLowFretPullbackU,
    computeBPM,
    dZ,
    fretColumnMarkersForAnchor,
    fretLabelScaleForFret,
    fretMid,
    fretX,
    getChartAnchorAt,
    hwyPostHitTailFadeMul,
    laneBoundsFromAnchor,
    lowerBoundT,
    renderOrderForLayerAtZ,
    resolveStringCount,
    slideOffsetWorldX,
    slideTrailEnd,
} from './geometry.js';
import { _registerTunerShortcut, _ssActive, _ssIsCanvasFocused } from './splitscreen.js';
import { T, loadThree } from './three-loader.js';

// Monotonic id for renderer instances (one per panel under splitscreen).
let _nextInstanceId = 0;

function createFactory() {
    const _instanceId = ++_nextInstanceId;

    // Chord/arpeggio chart analysis (per-instance caches live in the module).
    // Text-sprite material caches (per instance; disposed in teardown).
    const _textSprites = createTextSprites();
    const {
        _meshMatForGhostFretDigit,
        _spriteMat2MeshMat,
        bendChevronMat,
        darkenHex,
        fretHandMuteXSpriteMat,
        naturalHarmonicMat,
        palmMuteXSpriteMat,
        pinchHarmonicMat,
        slideArrowMat,
        triMat,
        txtMat,
    } = _textSprites;

    const _chartAnalysis = createChartAnalysis(NSTR);
    const {
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
    } = _chartAnalysis;

    // ── Per-instance Three.js state ───────────────────────────────────
    let scene = null, cam = null, ren = null;
    let wrap = null;
    // WebGL context-loss recovery. Switching the active window / alt-tabbing
    // (especially on Windows) can trigger a GPU context reset; with no
    // handler the lost context escalates into a render-process crash. The
    // listeners (bound in initScene on ren.domElement, removed in teardown)
    // preventDefault the loss so the browser keeps the context restorable,
    // _ctxLost gates draw() off the dead context, and on restore we reset the
    // viewport + resume (Three re-uploads scene resources on the next render).
    let _ctxLost = false;
    let _onCtxLost = null, _onCtxRestored = null;
    // highway:visibility listener (feedBack#246). Hides the .h3d-wrap
    // overlay when feedBack's canvas is display:none'd (splitscreen
    // case). Without this, the wrap is a *sibling* of #highway so
    // hiding #highway leaves the WebGL scene painting full-screen.
    // Bound in initScene after wrap creation, unbound in destroy().
    let _visibilityHandler = null;
    // highway:canvas-replaced listener — keeps highwayCanvas up to
    // date across context-type swaps (e.g. swapping back to a 2D
    // viz). The visibility handler's identity gate (event.detail.
    // canvas === highwayCanvas) would otherwise stop matching
    // after the swap; this listener follows the documented plugin
    // contract from CLAUDE.md.
    let _canvasReplacedHandler = null;
    let ambLight = null, dirLight = null;
    let fretG = null, tuningLblG = null, noteG = null, beatG = null, lblG = null;
    let gNote = null, gSus = null, gBeat = null, gTapChevron = null;
    // Per-string gradient gem geometries (index 0..5). Built in initScene
    // from sampled colour PNGs; each carries a per-vertex colour attribute.
    let gNoteGrad = [];
    let mStr = [], mGlow = [], mSus = [], mStrHitOutline = [], mAccentOutline = [], mAccentCore = [], mAccentHaloNear = [], mAccentHaloMid = [], mAccentHaloFar = [];
    // Pre-built accent-halo shell descriptors per string. Populated after
    // mAccentHaloFar/Mid/Near are materialised; consumed in drawNote()'s
    // hot path so the inner per-note `accentShells = [...]` array literal
    // (3 plain-object allocations per accent gem per frame) is replaced
    // by a stable read. Index 0 = outer, 1 = mid, 2 = near.
    let _accentShellsByString = [];
    let mWhiteOutline = null, mSusOutline = null;
    // Dedicated sustain-trail outline material for the hit verdict.
    // Drawn at opacity 0.45 — lower than mSusOutline (0.75) so the
    // bright green emissive doesn't tint the body interior, and the
    // verdict shows mostly on the outline fringe past the body edges.
    // Only the hit-side rim ships; the verdict on miss is carried by
    // mMissOutline (the gem-border material) instead of a dedicated
    // sustain outline — matches the "outline-only verdict, body retains
    // string colour" doctrine for the rest of the rendering path.
    let mHitSusOutline = null;
    // Shared materials for the legato technique meshes — one per geometry
    // type, reused across every pooled mesh instance to avoid per-mesh
    // material allocation in dense HO/PO/tap passages. Allocated in
    // initScene() alongside the other scene materials and disposed in
    // teardown.
    let mTapChevron = null;
    // Barre indicator material (white vertical line at the barre fret
    // during chord linger). Promoted from inline pool-factory authoring
    // to a named module-scope reference so _applyGlow() can mutate
    // emissiveIntensity in place when the user drags the glow slider.
    let mBarre = null;
    // Notedetect feedback outlines (issue #9). Created in initScene
    // alongside mWhiteOutline; swapped onto the note's outline mesh
    // when a recent notedetect:hit / :miss event matches the note's
    // (s, f, t). The miss gem border uses mMissOutline; the hit side
    // uses per-string mHitBright[s] for the cyan-shifted flash.
    let mMissOutline = null;
    // Per-string hit verdict material used for outline + lateral face fill.
    // Built in initScene() after mGlow. Array share the same material
    // instances so outline and face fill always match exactly.
    let mHitBright = [], mHitBrightArrays = [];
    // [verdict glow] Per-frame accumulation of the note-state provider's
    // alpha (note_detect drives this from the live input level for held
    // sustains, and as a time-fade for fresh strikes). Applied at the top of
    // update() to scale the verdict-glow materials' emissiveIntensity so the
    // gem brightness tracks how hard the string is actually ringing. Stays
    // at "no provider" (vg = 1, unchanged brightness) for the legacy event
    // path or when note_detect is off.
    let _ndVerdictMaxAlpha = 0;
    let _ndVerdictSawAlpha = false;
    // Magenta-red face fill for miss — see initScene() for construction
    // (uses mMissOutline ×4 + mEdgeTransparent ×2).
    let mMissEdgeArrays = null;
    let mEdgeTransparent = null;
    let pSusOutline = null, pNoteEdge = null;
    let projMeshArr = null;
    let _probe = null;
    /** Snapshotted in update() for drawNote() ghost / glow (single source vs per-caller isNext). */
    let _drawNextByString = null;
    /** Most-recent past event time per string (within 0.6 s back), for _nextAnyT deadline. */
    let _drawRecentByString = null;
    /** Snapshotted in update() — drawNote() is a sibling of update(), not nested in its closure. */
    let _drawChordTemplates = null;
    /** Teaching marks sd/ch overlay pref (§6.2.2), mirrored from the 2D
     * highway's `teachingMarksVisible` bundle flag. */
    let _drawTeachingMarks = false;
    /** Fret-hand finger (fg) hint pref, mirrored from the 2D highway's
     * `fingerHintsVisible` bundle flag — default on (shown unless an explicit
     * false), hideable independently of the sd/ch overlays. */
    let _showFingerHints = true;
    let _laneTargetColor = null;
    let _renderScale = 1;
    let lyricsCanvas = null, lyricsCtx = null;
    // FPS counter overlay. EMA-smoothed over ~30 frames so the readout doesn't
    // jitter every rAF tick. Controlled by the 'fpsVisible' setting (BG_DEFAULTS).
    // Legacy 'h3d_showFps' localStorage key and window.h3dShowFps are no longer
    // consulted — use the Settings → 3D Highway — Camera → Show FPS counter checkbox.
    let _fpsLastT = 0;
    let _fpsEma = 0;
    let _fpsDisplay = 0;
    let _fpsLastSampleT = 0;
    // The FPS readout is pinned top-right of the highway overlay — the same
    // corner the v3 player chrome stacks its persistent "Up Next" pill and
    // live-performance HUD into, on a higher layer that paints over the
    // canvas. So out of the box the readout sits *behind* that chrome and
    // can't be read (exactly when you've turned it on to judge perf). Rather
    // than relocate it (testers look top-right), we drop it just BELOW
    // whichever of that chrome is showing. Refs are resolved once and cached
    // — never a per-frame querySelector (see CLAUDE.md "never run DOM queries
    // on a per-frame path") — and re-resolved only when a node detaches.
    let _v3HudEls = null;
    // Returns the bottom edge (in overlay-canvas px, which are 1:1 CSS px on
    // this overlay) of the lowest visible top-right v3 chrome element, or 0
    // when none apply (classic v2 UI, or all hidden). Only called while the
    // FPS readout is actually drawn, so the layout reads cost nothing in the
    // common (counter-off) case.
    function _v3TopRightChromeBottom() {
        if (typeof document === 'undefined' || !highwayCanvas) return 0;
        // Only the v3 chrome stacks persistent HUD elements over the canvas's
        // top-right. Gate on the documented detector so this is a strict no-op
        // in classic v2 (where 'hud-time' also exists but sits elsewhere).
        if (!(window.feedBack && window.feedBack.uiVersion === 'v3')) return 0;
        if (!_v3HudEls || _v3HudEls.some((el) => el && !el.isConnected)) {
            _v3HudEls = ['v3-upnext', 'v3-live-performance-hud', 'hud-time']
                .map((id) => document.getElementById(id));
        }
        const top = highwayCanvas.getBoundingClientRect().top;
        let maxBottom = 0;
        for (const el of _v3HudEls) {
            // offsetParent === null ⇒ display:none (a `.hidden` pill/HUD) or
            // not laid out — don't duck under something that isn't shown.
            if (!el || el.offsetParent === null) continue;
            const b = el.getBoundingClientRect().bottom - top;
            if (b > maxBottom) maxBottom = b;
        }
        return maxBottom;
    }
    let _diagChord            = null;
    // Chord diagram render cache. Keys: static layout inputs joined as a
    // string. Values: OffscreenCanvas (or <canvas>) rendered at opacity=1
    // entranceT=1 — composited each frame via drawImage + globalAlpha.
    // Cleared on canvas resize (bx/by depend on canvasW/H/lyricsBottom)
    // and on teardown/destroy.
    const _diagRenderCache = new Map();
    // Cap chosen to cover the ~5–6 active chord shapes per phrase while
    // keeping the cached-OffscreenCanvas footprint bounded (~50 MB per
    // panel at typical 1920×1080). A structural fix — caching a
    // tightly-sized box surface instead of the full overlay canvas —
    // is tracked as a follow-up.
    const _DIAG_CACHE_MAX  = 6;
    let pSusRail = null, gSusRail = null, mSusRailBase = null;
    let pSusRailBloom = null, gSusRailBloom = null, mSusRailBloomBase = null, _bloomGaussTex = null;
    let pTechPlane = null, gTechPlane = null;

    // ── InstancedMesh for PM/FH X markers ────────────────────────────────
    // Replaces pTechPlane pool entries for PM and FH mute techniques,
    // collapsing O(visible-muted-notes) draw calls to 2 per type.
    // pTechPlane pool is still used for H/P triangles, harmonics and bends.
    let imPMTech = null, imFHTech = null;
    let _imGPMTech = null, _imGFHTech = null; // cloned geometries (own instanceAlpha attr)
    let _imPMTechMat = null, _imFHTechMat = null;
    const IM_TECH_CAP = 256;
    const _imPMTechAlphaArr = new Float32Array(IM_TECH_CAP);
    const _imFHTechAlphaArr = new Float32Array(IM_TECH_CAP);
    let _imPMTechCount = 0, _imFHTechCount = 0;

    // ── InstancedMesh for chord strum indicators ──────────────────────────
    // Replaces pPMXFill, pMuteXLines, pFHXFill, pFHXLines pools.
    // Fixed renderOrder per type — no per-instance sort needed.
    let imPMXFill = null, imPMXLines = null, imFHXFill = null, imFHXLines = null;
    let _imPMXFillMat = null, _imPMXLinesMat = null;
    let _imFHXFillMat = null, _imFHXLinesMat = null;
    const IM_STRUM_CAP = 64;
    const _imPMXFillAlphaArr  = new Float32Array(IM_STRUM_CAP);
    const _imPMXLinesAlphaArr = new Float32Array(IM_STRUM_CAP);
    const _imFHXFillAlphaArr  = new Float32Array(IM_STRUM_CAP);
    const _imFHXLinesAlphaArr = new Float32Array(IM_STRUM_CAP);
    let _imPMXFillCount = 0, _imPMXLinesCount = 0, _imFHXFillCount = 0, _imFHXLinesCount = 0;

    // Temporaries for InstancedMesh matrix composition — allocated once in
    // initScene() after Three.js loads, reused every frame without allocation.
    let _imM4 = null, _imPos = null, _imSca = null, _imQ = null, _imAZ = null, _imColor = null;

    let _diagPrev             = null;
    let _diagPrevOpacity      = 0;
    let _diagPrevStartOpacity = 0;
    let _diagPrevStartT       = null;  // bundle.currentTime when crossfade began (drives rewindable fade)
    let _diagEntranceT        = 1.0;
    let _diagLastKey          = null;  // chord identity: name + '|' + frets.join(',')
    // Per-wave cache for fret-column reference markers. Keyed by the
    // wave's beat timestamp. We snapshot { hasLow, hasHigh, fretList,
    // anchorKeyed } at first sight of a wave so its render gate stays consistent through the
    // wave's flight even as activeFrets shifts mid-song. Entries are
    // pruned each frame once their wave has passed `now`.
    let _fretMarkerWaveCache = new Map();
    // Per-frame booleans: handShapes[i] passes inferArpeggioFromNotePattern
    // once (see fillArpeggioGhostInferFlags) so the note loop skips O(hs×notes)
    // rescans — ref fillArpeggioGhostInferFlags in update().
    let _arpGhostHsInferScratch = [];
    // Handshape start-times where ghost fret numbers show but [ ] brackets are suppressed
    // (synth-chord onset-match cases — not genuine arpeggios).
    let _arpSynthOnsetHsSet = new Set();
    /** Per-frame: ``handShapeIsArpeggioForLaneRail`` baked once — lane slices were O(96 × hs × infer). */
    let _arpLaneRailHsScratch = [];
    let _arpRailBoundLoScratch = [];
    let _arpRailBoundHiScratch = [];


    // Fret connector-label visibility cache: tracks which (time, fret)
    // pairs may show their indicator number per the measure-skip rule
    // (show only the first note with a given fret in a measure; suppress
    // the same fret for the following measure, then allow it again).
    let _fretLabelAllowed = new Set();
    let _fretLabelNotesRef = null;
    // Cache of measure-start times (beats with measure !== -1), rebuilt when
    // the beats array changes. Drives the camera lookahead window
    // (CAM_LOOKAHEAD_MEASURES measures instead of a fixed number of seconds).
    let _measureStarts = [];
    let _measureStartsRef = null;
    // Frame-level dedup: tracks which (40ms-rounded-time, fret) pairs have already
    // rendered a label this frame so that multiple strings at the same fret/onset
    // (arpeggio chords, synthetic chords) never produce stacked duplicate labels.
    const _frameLabeledKeys = new Set();

    let _arpGhostInferRefHs = null;
    let _arpGhostInferRefNotes = null;
    let _arpGhostInferRefTpl = null;

    // Slide-target gem suppression. A Set of "t_s" keys for notes in
    // bundle.notes that are the linkNext destination of a preceding note
    // (single or chord). The gem is suppressed (skipBody=true) but the
    // sustain/slide trail still renders so the slide motion stays visible.
    let _slideTargetSet = null;
    let _slideTargetNotesRef = null;
    let _slideTargetChordsRef = null;

    let _laneRailFlagsRefHs = null;
    let _laneRailFlagsRefTpl = null;

    let _laneRailBoundsRefHs = null;
    let _laneRailBoundsRefChords = null;
    let _laneRailBoundsRefTpl = null;
    let _laneRailBoundsRefNotes = null;
    let _lastHwW = 0, _lastHwH = 0;
    // Frame counter for throttling the CSS-box drift check in draw()
    // (getBoundingClientRect is a forced layout read; see the comment
    // at the check).
    let _boxCheckCountdown = 0;
    // Last logical (CSS px) size handed to applySize(). #highway is a
    // flex:1 item, so its real rendered box (canvasSize()) can change as
    // the player layout settles after a song opens WITHOUT the backing
    // store (canvas.width) changing — which the _lastHwW/H check below
    // would miss. Tracking the applied logical size lets draw() detect
    // that CSS-box drift and re-frame, instead of the user having to
    // un/re-maximize the window.
    let _appliedW = 0, _appliedH = 0;
    // Last pane aspect (w/h) handed to the camera, cached so camUpdate can
    // recompute the horizontal-FOV-hold each frame (and react to live
    // __h3dAspectTune edits) without waiting for a resize. 0 until first
    // applySize().
    let _paneAspect = 0;
    // Per-instance fallback id for the wide-pane tuner's pane key, used only
    // when this pane has no arrangement name to key by. Assigned once in
    // init(); overrides keyed off arrangement persist across songs, this
    // fallback is session-only.
    let _paneUid = 0;
    // True once applySize() has pinned the .h3d-wrap overlay to the
    // highway canvas's offset box. Stays false while the canvas has no
    // layout yet (init() can run before #highway has a real box, where
    // applySize falls back to the parent-panel size and only sets the
    // wrap height). The rAF loop re-pins once the canvas lays out even
    // when the logical render size is unchanged — otherwise the overlay
    // would stay at top:0;left:0;right:0 and expose a strip of #highway.
    let _wrapPinned = false;
    let mBeatM = null, mBeatQ = null;
    // Shared (non-clone) materials and geometries that pool factories
    // reference but that aren't guaranteed to be reachable via
    // scene.traverse() — e.g. mLaneEven is only reached if at least one
    // even-numbered fret stripe ever spawns. Track them here so teardown
    // disposes the GPU resource regardless.
    const _ownedSharedMats = [];
    const _ownedSharedGeos = [];

    // Background animation state (issue #13). bgGroup is the parent
    // container for all bg meshes so teardown is one remove + dispose
    // pass. bgState is the active style's per-panel state object.
    let bgGroup = null, bgStage = null, bgState = null;
    let bgMountedStyleId = null;
    let bgStyleId = 'particles', bgIntensity = 0.5, bgReactive = true;
    // Active scene color theme (background + highway surface). Read in
    // _bgLoadSettings, applied by _applyBgTheme (clear + fog + board plane).
    let bgThemeId = 'default';   // BACKGROUND axis (clear + fog)
    let hwThemeId = 'default';   // HIGHWAY axis (board + lane + laneDim)
    // Board (fretboard/highway-surface) plane material — kept so the theme
    // can recolor it live without rebuilding the board. Set in buildBoard().
    let _boardPlaneMat = null;
    // Per-render opt-out for plugins borrowing the highway as a viz: when the
    // mount bundle sets bgReactive === false, suppress the audio-reactive
    // background for THIS instance only (no shared h3d_bg_* write). Captured
    // from the bundle in init(); applied in _bgLoadSettings() so it survives
    // later setting reloads. See init() for the rationale.
    let _bgReactiveOptOut = false;
    // Active palette for this panel (issue #10). Materials and per-
    // frame color reads inside createFactory all consult this rather
    // than the module-level S_COL, so a palette swap re-tints the
    // panel live without touching module-level state.
    let activePalette = PALETTES.default;
    // Content signature of the colors last applied to materials; lets
    // _bgLoadSettings force a retint when the in-place custom palette
    // changes values without changing array identity.
    let _bgPaletteSig = '';
    // Fret digits on the board ghost (hollow preview at Z=0), not on
    // flying note bodies — see fretNumberGhostScope for chord-hand vs all.
    let showFretOnNote = false;
    let fretNumberGhostScope = 'chords';
    // Camera-X smoothing dial (issue #34). 0 = twitchy (track every
    // upcoming fret), 1 = calm (ignore small intra-cluster shifts).
    // Cached here and refreshed via the bg listener to avoid a
    // per-frame localStorage hit inside update().
    let cameraSmoothing = 0.5;
    // Per-axis follow-ups: zoom (tgtDist hysteresis) and vertical-tilt
    // (tgtLookY NDC self-correction) each get their own dial. Same
    // 0..1 shape; same caching pattern. Both mirror cameraSmoothing's
    // value when not explicitly stored, so existing users who only
    // ever moved the camera-smoothing slider get the same calmness on
    // the new axes by default.
    let zoomSmoothing = 0.5;
    let tiltSmoothing = 0.5;
    // Camera lock: when true, pin the camera to a fixed wide view of
    // frets 1-12 unless an upcoming note would otherwise be off-screen.
    // The lock disengages while any note above fret 12 is in the
    // lookahead window so the camera can briefly widen to include it,
    // then re-engages once the high note ages out.
    let cameraLockLow = false;
    // Zoom-level for the locked view. Slider 0..1 maps to a multiplier
    // on the locked tgtDist: 0 → CAM_LOCK_ZOOM_MIN (closest, biggest
    // fretboard), 0.5 → 1.0× (the default locked view), 1 → CAM_LOCK_ZOOM_MAX
    // (furthest). Inactive when the lock isn't engaged.
    let cameraLockZoom = 0.5;
    /** 'steady' = recency-weighted centroid + hysteresis (#34); 'lookahead' = wide preview window + smooth focal. */
    let cameraMode = BG_DEFAULTS.cameraMode;
    // Global text-size multiplier for in-scene text sprites (chord
    // names, fret labels, section banners, technique markers, etc.).
    // Slider is 0..1; mapped to a 0.5..1.5× multiplier with 0.5 = 1.0×
    // (current default behaviour). _textSizeMul is the materialized
    // multiplier — refreshed once per frame at the top of update()
    // and consumed by every text-sprite scale.set call inside update
    // and drawNote.
    let textSize = 0.5;
    let _textSizeMul = 1.0;
    let _textSizeMulApplied = -1;
    // Visual look dials (issue: pastel/washed-out feel + too-much-glow
    // complaint). vibrancy raises idle string/note opacity and de-whites
    // the hit-note body; glow scales every emissive contribution +
    // projection glow layer opacity. Sliders are 0..1; defaults lean
    // vivid + minimal-glow to match the requested out-of-box look.
    // _vibrancyIdleOp / _vibrancyProjOp are cached so
    // updateStringHighlights() and drawNote() don't recompute the
    // linear blend every frame.
    let vibrancy            = BG_DEFAULTS.vibrancy;
    let glowMul             = BG_DEFAULTS.glow;
    let _hitFx              = BG_DEFAULTS.hitFx;
    let _sparks             = BG_DEFAULTS.sparks;
    let _cinematic          = BG_DEFAULTS.cinematic;
    let _verdictMarks       = BG_DEFAULTS.verdictMarks;
    let _timingFx           = BG_DEFAULTS.timingFx;
    let _streakFx           = BG_DEFAULTS.streakFx;
    let _bloom              = BG_DEFAULTS.bloom;
    let _composer = null, _bloomPass = null, _bloomLoad = null, _bloomW = 0, _bloomH = 0;
    let _sparkPts = null, _sparkPos = null, _sparkCol = null, _sparkVel = null, _sparkLife = null;
    const _SPARK_N = 256;
    const _sparkSeen = new Map();     // note-key -> expiry; one burst per hit
    let _juiceLastT = 0;              // frame-dt clock for the juice layer
    let _streakHits = 0, _streakHeat = 0;  // #7 consecutive-hit escalation
    let fpsVisible           = BG_DEFAULTS.fpsVisible;
    let fretDividersVisible  = BG_DEFAULTS.fretDividersVisible;
    let chordDiagramVisible  = BG_DEFAULTS.chordDiagramVisible;
    let chordDiagramSize     = BG_DEFAULTS.chordDiagramSize;
    let chordDiagramPosition = BG_DEFAULTS.chordDiagramPosition;
    let fretColumnMarkerCadence = BG_DEFAULTS.fretColumnMarkerCadence;
    let inlayLabelsVisible = BG_DEFAULTS.inlayLabelsVisible;
    let sectionLabelsOnHighway = BG_DEFAULTS.sectionLabelsOnHighway;
    let sectionHudVisible      = BG_DEFAULTS.sectionHudVisible;
    let sectionHudPosition     = BG_DEFAULTS.sectionHudPosition;
    let sectionHudSize         = BG_DEFAULTS.sectionHudSize;
    let toneHudVisible         = BG_DEFAULTS.toneHudVisible;
    let toneHudPosition        = BG_DEFAULTS.toneHudPosition;
    let toneHudSize            = BG_DEFAULTS.toneHudSize;
    let nutHeadstockVisible    = BG_DEFAULTS.nutHeadstockVisible;
    let tuningLabelsVisible    = BG_DEFAULTS.tuningLabelsVisible;
    let nutColor               = BG_DEFAULTS.nutColor;
    let headstockColor         = BG_DEFAULTS.headstockColor;
    let projectionVisible      = BG_DEFAULTS.projectionVisible;   // board "note preview" ghost on the fretboard
    let slideArrowApproachVisible = BG_DEFAULTS.slideArrowApproachVisible; // slide-direction arrow riding with the note/gem
    let slideArrowNeckVisible      = BG_DEFAULTS.slideArrowNeckVisible;    // slide-direction arrow preview on the neck
    let slideArrowChainPreviewVisible = BG_DEFAULTS.slideArrowChainPreviewVisible; // early neck preview for chained/multi-leg slides
    let _vibrancyIdleOp = 0.4  + 0.6  * BG_DEFAULTS.vibrancy;
    let _vibrancyProjOp = 0.15 + 0.35 * BG_DEFAULTS.vibrancy;
    // Custom image asset (issue #19). Data URL is the bytes that
    // drive the 'image' bg style's texture; name is display-only
    // metadata that settings.html shows next to the file picker.
    let bgCustomImageDataUrl = '';
    let bgCustomImageName = '';
    // Custom video asset (issue #19 follow-up). Stores the
    // server-side filename only; bytes live on disk via routes.py.
    // The renderer composes the served URL from this filename in
    // BG_STYLES.video.build.
    let bgCustomVideoName = '';
    let _bgListener = null;
    let _bgLastT = 0;  // ms timestamp for dt

    // Notedetect feedback (issue #9). Per-panel mark queues populated
    // by two event sources: (a) legacy `notedetect:hit` /
    // `notedetect:miss` window CustomEvents, and (b) FeedBack
    // event-bus `note:hit` / `note:miss` events (subscribed in
    // initScene() when window.feedBack exposes both `on` and `off`).
    // Both sources feed the same _ndPushMark() helper which dedupes
    // dual emissions. drawNote looks up its (s, f, t) against these
    // arrays each frame and swaps the outline material when a match
    // is current. Marks expire after _ND_TTL_MS so the visual flash
    // is brief. Marks self-prune unconditionally in the listener and
    // once per frame in update() to keep the arrays small.
    const _ND_TTL_MS = 500;
    const _ND_TIME_EPS = 0.01;
    let _ndHitMarks = [];
    let _ndMissMarks = [];
    let _ndOnHit = null, _ndOnMiss = null;
    let _ndOnBusHit = null, _ndOnBusMiss = null;
    let _ndLabels = [];
    // Per-chord-occurrence verdict latch for the chord-frame rim
    // tint. Once a chord is observed all-hit/active during its linger
    // fade we latch 'green' here so subsequent frames can't undo it
    // as individual constituent glows decay and getNoteState starts
    // returning null again (which would otherwise flicker the rim
    // back to red mid-linger). Keyed by `${ch.id}|${ch.t}` — ch.id
    // alone is the chord *template* id and is reused across every
    // occurrence of the same shape, so id-only latching would bleed
    // a single clean grab onto every later occurrence of that chord.
    // Pre-hit-line invalidation (chDt > 0 path in the rim selection)
    // evicts a chord's latch the next time it's seen approaching, so
    // loops/rewinds re-judge from scratch and the Map can't grow
    // beyond the current pre-hit-line frontier. Also cleared in
    // destroy().
    let _chordVerdicts = new Map();
    // Previous-frame `now` for the chord-verdicts pruner — on a
    // backward seek the latches behind that time become "future"
    // entries the forward-only prune can't reach, so we wipe the
    // map instead of paying an O(n) scan per frame to find them.
    let _chordVerdictsLastNow = null;
    // Numeric encoding for the _chordVerdicts key — replaces
    // ``${ch.id}|${ch.t}`` which allocated a string per chord per
    // frame in detect mode. Encoded so the key is monotonic in
    // chord time and the prune sweep can compare keys directly
    // (no parseFloat / String.slice). The time component sits in
    // the upper bits; chord-template ids share the lower 1e6 slot
    // and ch.id == null reserves idSlot 0 (no real chord id can
    // collide with it because real ids encode as id + 1).
    // ``time * 1e4`` keeps a 0.1 ms resolution — more than enough
    // to disambiguate distinct chord onsets — and stays under the
    // safe-integer limit for any realistic song length.
    const _CV_KEY_TIME_MUL = 1e4;
    const _CV_KEY_TIME_SLOT = 1e6;
    function _encodeChordVerdictKey(ch) {
        const tSlot = Math.round(ch.t * _CV_KEY_TIME_MUL) * _CV_KEY_TIME_SLOT;
        const idSlot = ch.id != null ? ((Number(ch.id) | 0) + 1) : 0;
        return tSlot + idSlot;
    }
    // Per-frame timestamp captured by update() and used by its
    // prune pass for the notedetect mark arrays. drawNote itself
    // no longer reads it — pruning lives once per frame so
    // drawNote's hot path is just the bounded (s, f, t) match.
    let _ndFrameNowMs = 0;
    // feedBack#254 — core's per-note judgment provider, captured
    // from `bundle.getNoteState` at the top of each update(). When
    // present it's authoritative over the event-driven marks above:
    // 'hit'/'active' → bright string-tinted outline (mGlow[s]) +
    // bright body + glowing sustain trail + a contained sparkle on
    // the overlay (a held sustain keeps glowing/sparkling for as
    // long as it stays 'active'); 'miss' → red outline (mMissOutline)
    // + suppressed body. null on cores without the API or songs
    // with no scorer registered. Older note_detect builds that only
    // emit notedetect:hit/miss events still work via _ndHitMarks.
    let _ndGetNoteState = null;
    let _ndHasProvider = false;  // true iff a note-state provider is registered (feedBack#254)
    // Sustain verdict latch — persists a provider's hit/miss verdict for the
    // full duration of a sustained note. Once hitGlowDuration expires the
    // provider stops returning state; the latch re-injects the last verdict
    // so the green/red color stays alive until susEnd.
    // Key: Math.round(n.t * 1e4) * 10 + n.s  (matches _ghostPrevBuf scheme)
    // Value: 'hit' | 'hit-live' | 'miss'  ('hit-live' = a live provider hit,
    // tagged live:true, which is NOT re-injected once the provider goes
    // silent — see the live-latch handling in the per-gem loop below).
    let _susVerdictLatch = new Map();

    // ── Score FX (notedetect game-scoring layer, notedetect ≥1.13) ──
    // Two channels: (1) per-note "+N" score pops, sourced from the
    // note-state provider's new { points, mult, popKey } fields at the
    // moment a gem's verdict lands; (2) session-level bursts/pulses from
    // the new `notedetect:fx` event (streak milestones, multiplier tier
    // changes, streak breaks). Everything renders on the 2D overlay
    // canvas (same layer as drawNotedetectLabels) — no Three.js objects,
    // no txtMat() cache entries, nothing to dispose. Pools are fixed-
    // size slot arrays created once per factory instance; when all slots
    // are busy a new effect is simply dropped.
    const _FX_POP_LIFE_MS = 700;
    const _FX_BURST_LIFE_MS = 900;
    const _FX_BURST_N = 36;
    const _fxPops = Array.from({ length: 24 }, () => (
        { active: false, x: 0, y: 0, z: 0, bornMs: 0, text: '', mult: 1 }
    ));
    const _fxBursts = Array.from({ length: 4 }, () => ({
        active: false, bornMs: 0,
        px: new Float32Array(_FX_BURST_N), py: new Float32Array(_FX_BURST_N),
        vx: new Float32Array(_FX_BURST_N), vy: new Float32Array(_FX_BURST_N),
    }));
    // popKey -> expiry ms. Dedupes pops (chord members share the chord's
    // popKey; sustains keep returning points for the whole glow window).
    const _fxSeen = new Map();
    let _fxOnFx = null;          // notedetect:fx listener (window)
    let _fxOnSkin = null;        // notedetect:skin bus listener
    // Generation counter: bumped by teardown() so the deferred window-
    // copy fallback (a zero-delay task the listener removal can't cancel)
    // bails instead of re-arming ring/burst state after teardown — or,
    // worse, leaking a stale event into a subsequent init's fresh state.
    let _fxGen = 0;
    let _fxLastFxDetail = null;  // reference dedup: window + instanceRoot dispatches share one detail
    // Details seen via element-scoped (bubbled) dispatch. A WeakSet, not a
    // single slot: one judged hit can emit several fx in the same task
    // (milestone + multiplier tier-up), and the deferred window-copy
    // fallback for the FIRST must still see that its element copy arrived
    // after the SECOND overwrote any last-detail slot. GC reclaims
    // entries once notedetect drops the detail objects.
    let _fxElemSeen = new WeakSet();
    let _fxRingMs = -1e9;        // multiplier ring-pulse anchor
    let _fxRingMult = 1;
    let _fxBreakMs = -1e9;       // streak-break flicker anchor
    // Canvas-side palette per notedetect skin (mirrors the accents in
    // notedetect's assets/plugin.css; fonts are document-loaded by that
    // stylesheet so the overlay canvas can use the family names).
    const _FX_PALETTES = {
        neon:    { accent: '#00f0ff', accent2: '#ff2ec4', miss: '#ff4444', font: 'Orbitron' },
        esports: { accent: '#e8b43a', accent2: '#f5f5f4', miss: '#f87171', font: 'Rajdhani' },
        metal:   { accent: '#ffb347', accent2: '#ff6b35', miss: '#ef4444', font: 'Russo One' },
    };
    let _fxPalette = _FX_PALETTES.neon;
    function _fxResolvePalette() {
        let skin = null;
        try { skin = localStorage.getItem('feedBack_notedetect_skin'); } catch (e) {}
        _fxPalette = _FX_PALETTES[skin] || _FX_PALETTES.neon;
    }
    function _fxSpawnPop(popKey, points, mult, x, y, z) {
        if (_fxSeen.has(popKey)) return;
        const nowMs = _ndFrameNowMs || performance.now();
        _fxSeen.set(popKey, nowMs + 4000);
        for (let i = 0; i < _fxPops.length; i++) {
            const p = _fxPops[i];
            if (p.active) continue;
            p.active = true;
            p.x = x; p.y = y; p.z = z;
            p.bornMs = nowMs;
            p.text = '+' + points;
            p.mult = mult || 1;
            return;
        }
    }
    function _fxSpawnBurst(nowMs) {
        for (let i = 0; i < _fxBursts.length; i++) {
            const b = _fxBursts[i];
            if (b.active) continue;
            b.active = true;
            b.bornMs = nowMs;
            for (let j = 0; j < _FX_BURST_N; j++) {
                const a = (j / _FX_BURST_N) * Math.PI * 2;
                const sp = 2 + (j % 5) * 0.8;
                b.px[j] = 0; b.py[j] = 0;
                b.vx[j] = Math.cos(a) * sp;
                b.vy[j] = Math.sin(a) * sp - 1.2;
            }
            return;
        }
    }
    function _fxHandle(d) {
        // Reference dedup — notedetect dispatches the SAME detail object
        // on window and on its instanceRoot; whichever arrives first wins.
        if (d === _fxLastFxDetail) return;
        _fxLastFxDetail = d;
        const nowMs = performance.now();
        if (d.fxType === 'milestone') {
            _fxSpawnBurst(nowMs);
        } else if (d.fxType === 'multiplier' && d.mult > (d.prevMult || 1)) {
            _fxRingMs = nowMs;
            _fxRingMult = d.mult;
        } else if (d.fxType === 'streakBreak') {
            _fxBreakMs = nowMs;
        }
    }

    // Object pools
    let pNote, pSus, pLbl, pBeat, pSec;
    let pFretLbl, pLane, pLaneDivider;
    // Shared materials/geometry for the lane stripes — see initScene().
    // Hoisted so draw() can reference them when assigning per-stripe.
    let mLaneOdd = null, mLaneEven = null, gLanePlane = null;
    /** Lane fret dividers: default white vs arpeggio frame tint on outer wires only. */
    let mLaneDivider = null, mLaneDividerArp = null, mLaneDividerExt = null;
    /** Shared XY plane for ghost fret digits (lies on board like proj, not billboarding). */
    let gGhostFretPlane = null, pGhostFretLbl = null;
    // Anchor-driven lane scratch buffers. Per-frame the loop builds up
    // to HWY_LANE_TIME_SLICES segments, but consecutive slices that share
    // an anchor (the common case) collapse into the same entry. Held as
    // four parallel arrays so the per-frame work allocates nothing once
    // the buffers reach their steady-state size.
    const _laneSegDMin = [];
    const _laneSegDMax = [];
    const _laneSegZ0 = [];
    const _laneSegZ1 = [];
    /** Chart-time span per merged lane segment (for per-slice arpeggio rail tint). */
    const _laneSegTLo = [];
    const _laneSegTHi = [];
    const _laneSegArp = [];
    let _laneSegLen = 0;
    let pChordBox, pChordFrameFill, pChordLbl, pBarreLine, pArpBracket, pPMXFill, pFHXFill;
    let gPMXFill = null; // shared geometry for PM X fill — disposed in teardown
    let gFHXFill = null; // shared geometry for FH X fill — disposed in teardown
    let gPMXLines = null, pMuteXLines = null; // PM X lines combined geometry (8 segs as quads)
    let gFHXLines = null, pFHXLines = null;   // FH X lines combined geometry
    let pNoteFretLabel, pConnectorLine, pDropLine, pTapChevron, pAccentHalo;
    let pTeachMarkLbl;  // teaching marks fg/sd label sprites (§6.2.2)
    let pHaloBar = null, gHaloBar = null; // gradient halo bar geometry — replaces per-shell pChordAccentHalo
    let gArpBracket = null; // shared 1×1×1 box geometry for pArpBracket; built once, disposed in teardown
    let pSusRibbon = null, pSusRibbonOl = null;
    let pFretColMarker;
    /** Horizontal gradient for chord box interior fill. */
    let chordFrameGradTex = null;
    /** Lavender gradient for arpeggio box interior (cyan × lavender blend — fades back to cyan). */
    let chordFrameGradTexArp = null;

    // Dynamic glowing string meshes (BoxGeometry, one per string)
    let stringLines = [];
    // Static thin-line glow layer behind each string (one Line per
    // string). Retained so _applyVibrancy() can mutate opacity in
    // place — without this the layer stays at its built-in opacity
    // until the next palette change rebuilds buildBoard().
    let stringLineGlows = [];
    // One MeshStandardMaterial per fret wire (index = fret 0..NFRETS).
    // Updated each frame to gold when inside the active anchor range,
    // gray otherwise. Reset to [] on every buildBoard() rebuild.
    let fretWireMats = [];
    // Shared bowed TubeGeometry for all fret wires (centered at x=0;
    // each fret mesh only differs by position). Disposed on rebuild +
    // teardown. See FRET_BOW_DZ constants.
    let fretTubeGeo = null;
    /** Nut + headstock 3D subtree; visibility toggled from settings without rebuild. */
    let nutHeadstockGroup = null;
    /** Left edge X of drawable string meshes; updated in buildBoard() at nut / fret junction. */
    let boardStringStartX = fretX(0);
    /** Open-string label column X — over headstock, left of nut (set in buildBoard()). */
    let boardTuningLabelX = -4.2 * K;
    // Fret inlay number label sprites (one per INLAY_LABEL_FRETS entry).
    // Retained so update() can rescale them live when _textSizeMul changes.
    let _inlayLabels = [];
    // Cloned SpriteMaterials for the inlay labels — disposed on rebuild and
    // destroy() to prevent GPU leaks across palette changes or panel reuse.
    let _inlayMats = [];
    // Open-string tuning labels beside the headstock (issue: per-song tuning).
    let _tuningLabelSprites = [], _tuningLabelMats = [];
    let _lastOpenStringLblSig = '';
    // Cheap-key cache for _syncOpenStringPitchLabels: skip the expensive
    // labels-array + signature-string build when the inputs that actually
    // change the labels haven't changed reference/value since last frame.
    let _lastSyncTuningRef = undefined;
    let _lastSyncBundleTuningRef = undefined;
    let _lastSyncCapo = NaN;
    let _lastSyncArrIdx = undefined;
    let _lastSyncPaletteRef = null;
    let _lastSyncNStr = -1;
    let _lastSyncTextSizeMul = NaN;
    let _lastSyncStartX = NaN;
    let _lastSyncLabelX = NaN;
    // Scratch Color used by _applyVibrancy() to avoid allocating a
    // fresh THREE.Color each time the user drags a slider.
    // Allocated lazily once Three.js is loaded inside initScene().
    let _paletteColorTmp = null;
    // Per-fret last-active timestamp for lane persistence
    let fretLastActiveTime = new Array(NFRETS + 1).fill(0);

    // Active string count for the current arrangement (resolved each
    // frame from bundle.stringCount and clamped to MAX_RENDER_STRINGS).
    let nStr = NSTR;

    // ── Per-frame scratch arrays (hoisted to avoid per-frame allocation) ─────
    // Sized to MAX_RENDER_STRINGS / NFRETS+1 — always large enough for any
    // arrangement. We fill only [0..nStr) each frame and reset with .fill().
    // Holding these at closure scope keeps them in a GC root; the engine can
    // keep them hot in L1/L2 across frames, and no allocation pressure from
    // update() itself.
    const _scrStringSustain      = new Array(MAX_RENDER_STRINGS).fill(false);
    const _scrStringAnticipation = new Array(MAX_RENDER_STRINGS).fill(0);
    const _scrFretHeat           = new Array(NFRETS + 1).fill(0);
    const _scrStrGlow            = new Array(MAX_RENDER_STRINGS).fill(0.5);
    const _scrAccentFillBoost    = new Array(MAX_RENDER_STRINGS).fill(0);
    const _scrNextNoteByString   = new Array(MAX_RENDER_STRINGS).fill(null);
    const _scrLastFretForString  = new Array(MAX_RENDER_STRINGS).fill(undefined);
    // Scratch buffer for the recent-past-event prepass (~0.6 s back) — avoids
    // re-allocating a per-string Array every frame. Re-filled with -Infinity
    // at the top of each prepass run.
    const _scrRecentByString     = new Array(MAX_RENDER_STRINGS).fill(-Infinity);
    // Scratch buffers for the ghost-preview gap prepass — refilled each
    // frame to avoid the `new Array(nStr)` + `Object.create(null)` churn.
    // The Map is cleared at the top of the prepass; live entries are
    // consumed by drawNote() reads later in the same frame.
    const _scrGhostLastT         = new Array(MAX_RENDER_STRINGS).fill(-Infinity);
    const _scrGhostPrevBuf       = new Map();
    // Per-string count of upcoming-ghost slots (1/2) claimed so far this
    // frame (board ghost — up to 3 simultaneous previews per string).
    // Reset to 0 each frame alongside the other pool .reset() calls.
    const _scrGhostUpcomingCount = new Array(MAX_RENDER_STRINGS).fill(0);
    // Hoisted scratch for the arp-bracket dedupe within a single draw().
    // Keys are `${chordId}:${occurrenceStart}` strings (cheap to build, low
    // cardinality per frame); values are Sets of string-indices that have
    // already drawn brackets in the AHEAD note-stream pass. Cleared at the
    // top of every chord pass so the Set objects (and the outer Map) are
    // reused across frames instead of reallocated.
    const _scrNoteStreamBracketStrings = new Map();
    // Scratch object reused for chord-note drawNote calls so `{ ...cn, t: ch.t }`
    // doesn't allocate a new object per chord note per frame.
    const _scrChordNote = {};
    // Scratch objects for the nextNoteByString prepass — chord notes need
    // a merged `{ ...cn, t: ch.t }` object, but spread allocates every frame.
    // One scratch object per string (max MAX_RENDER_STRINGS) is safe because:
    // (a) the prepass writes each string's entry at most once per frame,
    // (b) drawNote() reads nxFrame.t before the next frame's prepass can overwrite.
    const _scrNextNoteByStringData = Array.from({ length: MAX_RENDER_STRINGS }, () => ({}));
    // Reusable Set for arpeggio persistence key lookup — cleared each frame
    // instead of reallocating a new Set.
    const _scrArpPersistKeys = new Set();
    // Reusable Set for active-fret cooldown tracking — cleared each frame.
    const _scrActiveFrets = new Set();
    // Reusable scratch for barre atMinFretStrings computation — avoids the
    // [...chShape].filter().map().sort() chain (3 allocations per chord per frame).
    const _scrAtMinFretArr = new Array(MAX_RENDER_STRINGS).fill(0);
    let _scrAtMinFretLen = 0;
    // Sorted scalar view of "next event time per string ∪ recent event
    // time per string" — populated once per frame in update() after
    // _drawNextByString and _drawRecentByString are set. drawNote() and
    // the chord render loop both need "earliest event time strictly
    // greater than t" to deadline-cap gem visibility; the previous
    // implementation re-scanned both per-string arrays (2 * nStr
    // lookups) per note/chord per frame, which is hot in dense
    // PM/FH/arpeggio passages. With this scratch the same query is
    // O(log N) over at most 2 * MAX_RENDER_STRINGS = 16 entries via
    // _firstEventTimeGreaterThan(). Capacity is fixed (Float64Array)
    // to keep the buffer in stable memory; _scrEventTimesLen tracks
    // the live prefix.
    const _scrEventTimes    = new Float64Array(MAX_RENDER_STRINGS * 2);
    let   _scrEventTimesLen = 0;
    function _firstEventTimeGreaterThan(t) {
        let lo = 0, hi = _scrEventTimesLen;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (_scrEventTimes[mid] <= t) lo = mid + 1;
            else hi = mid;
        }
        return lo < _scrEventTimesLen ? _scrEventTimes[lo] : Infinity;
    }

    // Camera state
    let _leftyCached = false;
    const xFret = f => (_leftyCached ? -fretX(f) : fretX(f));
    const xFretMid = f => (_leftyCached ? -fretMid(f) : fretMid(f));
    const boardSpanX = () => {
        const x0 = xFret(0);
        const xN = xFret(NFRETS);
        return {
            min: Math.min(x0, xN),
            max: Math.max(x0, xN),
            center: (x0 + xN) / 2,
            width: Math.abs(xN - x0),
        };
    };

    let tgtX = xFretMid(CAM_LOCK_CENTER_FRET), curX = xFretMid(CAM_LOCK_CENTER_FRET);
    let tgtDist = CAM_DIST_BASE, curDist = CAM_DIST_BASE;
    // Dolly-back multiplier applied to the curDist lerp target by camUpdate's
    // fret-row fit guard. 1 = no extra pull-back (the common case); rises
    // toward FRET_ROW_FIT_BOOST_MAX only when a tight, centred zoom would push
    // the fret-number row past the bottom edge, then relaxes back to 1.
    let _fretRowFitBoost = 1;
    // Last committed lowFretBonus contribution baked into tgtDist
    // (see candidateDist block — bonus is applied on top of the
    // hysteresis-gated base).
    let prevLowFretBonus = 0;
    // Tracks whether the camera lock was active on the previous
    // frame, so the dynamic branch can bypass zoom hysteresis on
    // the first frame after a lock release. Without this, a >12
    // fret note that disengaged the lock could be swallowed by
    // the dead zone and the camera would fail to widen — a UX
    // promise of the lock toggle.
    let prevLockActive = false;
    let tgtLookY = 0, curLookY = 0;   // lerped look-at Y for self-correcting camera
    let aspectScale = 1;
    // _camSnapped / _camPreScanned / _songKey: together they gate the first-data snap.
    //
    // On the first update() frame where bundle.notes is available,
    // _camPreScanned is set and the full notes array is scanned (O(N), once)
    // to check whether ANY fretted note (f > 0) exists.  If none do (e.g. an
    // all-open-string bass arrangement), _camSnapped is set to true immediately
    // so the per-frame pre-pass is disabled for the entire song.
    //
    // For charts that do have fretted notes, a lightweight O(window) pre-pass
    // runs before any drawNote() call on every frame until the first frame
    // where fretted notes appear in the camera targeting window (preWSum > 0).
    // At that point curX/curDist are snapped directly to the computed targets,
    // eliminating the camera swoop for songs with long silent intros.
    //
    // Once _camSnapped is true it is never cleared for the current song; the
    // pre-pass is a permanent no-op thereafter and the camera reverts to
    // normal lerp-based tracking for the rest of the song.
    //
    // _songKey tracks the active song/arrangement so the snap state resets
    // automatically when the user switches songs or arrangements via
    // reconnect() (which does not call renderer.destroy/init).
    let _camSnapped = false;
    let _camPreScanned = false;
    let _songKey = null;
    // Smooth lookahead camera: fused world-X and displayed fret-span.
    let _lookaheadCamX = xFretMid(CAM_LOCK_CENTER_FRET);
    let _lookaheadFretSpan = DEFAULT_LOOKAHEAD_FRET_SPAN;
    let _lookaheadCamPrevNow = null;
    let _lookaheadLowBonusU = 0;
    let _lookaheadHiNeckLatch = false;

    // ── Sub-frame clock smoothing ─────────────────────────────────────
    // bundle.currentTime is the browser's audio.currentTime, which only
    // refreshes every ~20–23 ms — coarser than a 60/144 Hz rAF frame. Fed
    // straight into note Z-positions it makes the whole highway step in
    // micro-jumps (1–2 static frames, then a jump), most visible as a
    // "stutter" across a dense wall of repeated chords even when FPS is
    // steady. smoothNow() interpolates forward with performance.now()
    // between distinct audio samples (mirroring core highway.js
    // getTime()), tracking the observed playback rate so the speed slider
    // stays accurate, and falls back to the raw value on pause / seek /
    // stall so the scroll never drifts against silent audio.
    let _clkAudioT = NaN;   // last distinct bundle.currentTime sample
    let _clkPerf = NaN;     // performance.now() when that sample arrived
    let _clkRate = 1;       // observed chart-seconds per real-second
    let _frameNow = 0;      // smoothed time for THIS frame (update → camUpdate)

    // Low-overdraw sustain rendering (DEFAULT since perf profiling on
    // dense palm-mute / fret-hand-mute passages). Those sections are GPU
    // fill-bound: the transparent sustain trails/rails stack many blended
    // fragments. Profiling (pinned A/B loop) showed ren.render() p50 at
    // ~7.5 ms vs ~5.9 ms with all the sustain extras off. The additive
    // rail bloom halo (wide gaussian planes, additive blending) is the
    // single most expensive per-pixel contributor, so the lean default
    // drops ONLY the bloom. The trail/ribbon white OUTLINE (mSusOutline,
    // with hit/miss colour) is kept — it's a thin, cheap layer and gives
    // tails their border, so it's worth the small fill cost. Opt back into
    // the full look (re-enable the rail bloom) per browser, no rebuild:
    //   localStorage.h3d_full_sus = '1'   // re-enable rail bloom halo
    //   delete localStorage.h3d_full_sus  // back to lean default
    // Polled at ~1 Hz at the top of update() (perf: localStorage reads
    // are synchronous) so the console flag still takes effect live.
    // The bloom pool/material/gaussian texture are kept intact
    // (still pinned by the bloom unit tests and used by the opt-out path).
    let _leanSus = true;
    let _leanSusPollCounter = 0;

    // Lifecycle flags
    let _isReady = false;
    let _destroyed = false;
    let _invertedCached = false;
    let _invertedForBoard = false;
    let _leftyForBoard = false;
    let _initToken = 0;
    let highwayCanvas = null;

    // ── Focus state (splitscreen dim) ─────────────────────────────────
    let _focusSubscribed = false;
    let _isFocused = true;
    const _onFocusChange = () => _updateFocusState();

    function _unsubscribeFocus() {
        if (!_focusSubscribed) return;
        const ss = window.feedBackSplitscreen;
        if (ss && typeof ss.offFocusChange === 'function') ss.offFocusChange(_onFocusChange);
        _focusSubscribed = false;
    }

    function _updateFocusState() {
        if (_destroyed || !_isReady) return;
        const focused = _ssIsCanvasFocused(highwayCanvas);
        if (focused === _isFocused) return;
        _isFocused = focused;
        if (ambLight) ambLight.intensity = focused ? 0.85 : 0.4;
        if (dirLight) dirLight.intensity = focused ? 0.8 : 0.35;
    }

    // ── String-to-Y (respects invert) ─────────────────────────────────
    const sY = s => S_BASE + (_invertedCached ? s : (nStr - 1 - s)) * S_GAP;


    function _disposeOpenStringPitchSprites() {
        // Tuning-label materials are clones of cached txtMat() entries, so
        // they share the .map (CanvasTexture) with the canonical txtCache
        // material. Disposing the map here would invalidate every other
        // material that references the same cached glyph; teardown()'s
        // txtCache loop is the single owner of those textures.
        for (const m of _tuningLabelMats) {
            try { m.dispose(); } catch (_) { /* idempotent */ }
        }
        _tuningLabelMats = [];
        _tuningLabelSprites = [];
        _lastOpenStringLblSig = '';
        if (!tuningLblG) return;
        while (tuningLblG.children.length) tuningLblG.remove(tuningLblG.children[0]);
    }

    function _openStringLabelSignature(bundle, labels) {
        const si = bundle && bundle.songInfo;
        const tun = si && si.tuning;
        let tStr = '';
        if (Array.isArray(tun)) tStr = tun.slice(0, labels.length).join(',');
        else if (bundle && Array.isArray(bundle.tuning)) tStr = bundle.tuning.slice(0, labels.length).join(',');
        const capo =
            si && Number.isFinite(si.capo) ? si.capo
                : (bundle && Number.isFinite(bundle.capo) ? bundle.capo : '');
        const arrIdx = si && si.arrangement_index != null ? si.arrangement_index : '';
        let palSig = '';
        const nLab = labels.length;
        if (activePalette) {
            // activePalette entries are numeric hex (PALETTES) or already hex strings;
            // convert without instantiating T.Color per string — this signature is
            // built every frame inside _syncOpenStringPitchLabels.
            const lim = Math.min(activePalette.length, nLab);
            for (let i = 0; i < lim; i++) {
                if (i > 0) palSig += '/';
                const c = activePalette[i];
                palSig += typeof c === 'number' ? (c >>> 0).toString(16) : String(c);
            }
        }
        return `${nStr}|${capo}|${tStr}|${arrIdx}|${labels.join(',')}|${palSig}|${_textSizeMul.toFixed(3)}|${boardStringStartX.toFixed(6)}|${boardTuningLabelX.toFixed(6)}`;
    }

    function _syncOpenStringPitchLabels(bundle) {
        if (!tuningLblG || !T || !bundle) return;
        if (!tuningLabelsVisible) {
            tuningLblG.visible = false;
            if (_tuningLabelSprites.length) _disposeOpenStringPitchSprites();
            _lastOpenStringLblSig = '';
            return;
        }
        tuningLblG.visible = true;
        // Cheap-key fast path: compare the inputs that drive the label content
        // against last frame. The signature string + labels array build are
        // both per-frame allocators, so skipping them when nothing changed
        // saves a chunk of GC pressure in the hot render loop.
        const si = bundle.songInfo;
        const tunRef = (si && Array.isArray(si.tuning)) ? si.tuning : null;
        const bundleTunRef = Array.isArray(bundle.tuning) ? bundle.tuning : null;
        const capo =
            si && Number.isFinite(si.capo) ? si.capo
                : (Number.isFinite(bundle.capo) ? bundle.capo : NaN);
        const arrIdx = si && si.arrangement_index != null ? si.arrangement_index : undefined;
        if (
            _tuningLabelSprites.length === nStr &&
            _lastSyncTuningRef === tunRef &&
            _lastSyncBundleTuningRef === bundleTunRef &&
            Object.is(_lastSyncCapo, capo) &&
            _lastSyncArrIdx === arrIdx &&
            _lastSyncPaletteRef === activePalette &&
            _lastSyncNStr === nStr &&
            _lastSyncTextSizeMul === _textSizeMul &&
            _lastSyncStartX === boardStringStartX &&
            _lastSyncLabelX === boardTuningLabelX
        ) return;
        // One of the inputs changed — fall through to the canonical signature
        // check (catches value-equal-but-different-ref tuning arrays).
        const labels = _openStringPitchLabelsForTuning(bundle, si, nStr);
        const sig = _openStringLabelSignature(bundle, labels);
        // Refresh cheap-key cache regardless of signature outcome so future
        // frames can fast-path even when the sig matched.
        _lastSyncTuningRef = tunRef;
        _lastSyncBundleTuningRef = bundleTunRef;
        _lastSyncCapo = capo;
        _lastSyncArrIdx = arrIdx;
        _lastSyncPaletteRef = activePalette;
        _lastSyncNStr = nStr;
        _lastSyncTextSizeMul = _textSizeMul;
        _lastSyncStartX = boardStringStartX;
        _lastSyncLabelX = boardTuningLabelX;
        if (sig === _lastOpenStringLblSig && _tuningLabelSprites.length === nStr) return;
        _disposeOpenStringPitchSprites();
        _lastOpenStringLblSig = sig;
        // Left of nut/cordas — centered on headstock mass so text does not sit on the strings.
        const labelX = boardTuningLabelX;
        const zLabel = -0.08 * K;
        const scalePx = 2.42 * _textSizeMul * K;
        for (let s = 0; s < nStr; s++) {
            const hex = '#' + new T.Color(activePalette[s % activePalette.length]).getHexString();
            const mat = txtMat(labels[s] || '?', hex, false, 'noteFret').clone();
            mat.depthTest = false;
            mat.depthWrite = false;
            mat.transparent = true;
            const sp = new T.Sprite(mat);
            sp.center.set(0, 0.5);
            sp.scale.set(scalePx, scalePx, 1);
            sp.position.set(labelX, sY(s), zLabel);
            sp.renderOrder = 8;
            tuningLblG.add(sp);
            _tuningLabelSprites.push(sp);
            _tuningLabelMats.push(mat);
        }
    }

    // ── Object pool ────────────────────────────────────────────────────
    // ── Opt-in perf bench harness (feedBack#226) ──────────────────────
    // Enable with `?h3dbench=1` on the player URL. Aggregates per-segment
    // timings of update() into a console.log every _PB_REPORT_MS.
    //
    // When the bench is OFF, pbBeg/pbEnd/pbReportTick are bound to a
    // single shared empty function literal when this renderer
    // instance is created (createHighway() runs once per panel, not
    // once per module load) — V8 typically inlines empty bodies and
    // the call sites have minimized overhead in the hot path.
    // (Previously they had `if (!_perfBench) return;` guards, which
    // still cost a function-call frame per mark site per frame;
    // Copilot review on #413.) Inlining is a JIT heuristic, not a
    // language guarantee.
    const _perfBench = (() => {
        try { return new URLSearchParams(location.search).get('h3dbench') === '1'; }
        catch (_) { return false; }
    })();
    let pbBeg, pbEnd, pbReportTick;
    if (_perfBench) {
        const _PB_NAMES = ['frame', 'state', 'next', 'mat', 'noteDraw', 'chordDraw', 'render'];
        const _pbStart = new Float64Array(_PB_NAMES.length);
        const _pbAcc = _PB_NAMES.map(() => []);
        const _PB_REPORT_MS = 5000;
        let _pbReportStart = 0;
        let _pbFrameCount = 0;
        pbBeg = function pbBeg(idx) { _pbStart[idx] = performance.now(); };
        pbEnd = function pbEnd(idx) {
            _pbAcc[idx].push(performance.now() - _pbStart[idx]);
        };
        pbReportTick = function pbReportTick() {
            const now = performance.now();
            if (_pbReportStart === 0) {
                // First call: discard the sample(s) that already
                // landed in _pbAcc from the very first frame's
                // pbEnd() calls, so fps and segment stats span the
                // same frame set on every reported window.
                _pbReportStart = now;
                _pbFrameCount = 0;
                for (let i = 0; i < _PB_NAMES.length; i++) _pbAcc[i].length = 0;
                return;
            }
            _pbFrameCount++;
            if (now - _pbReportStart < _PB_REPORT_MS) return;
            const dur = now - _pbReportStart;
            const fps = (_pbFrameCount / dur * 1000).toFixed(1);
            const parts = [];
            for (let i = 0; i < _PB_NAMES.length; i++) {
                const arr = _pbAcc[i];
                if (!arr.length) { parts.push(`${_PB_NAMES[i]}=-`); continue; }
                arr.sort((a, b) => a - b);
                const n = arr.length;
                // Nearest-rank: ceil(p · n) - 1, clamped to [0, n-1].
                // Avoids the off-by-one where Math.floor(n * 0.95)
                // returns the last element (effectively the max)
                // for small samples (e.g. n=20 → idx 19).
                const p50 = arr[Math.max(0, Math.ceil(0.50 * n) - 1)];
                const p95 = arr[Math.max(0, Math.ceil(0.95 * n) - 1)];
                const mx = arr[n - 1];
                parts.push(`${_PB_NAMES[i]} p50=${p50.toFixed(2)} p95=${p95.toFixed(2)} max=${mx.toFixed(2)}`);
                arr.length = 0;
            }
            console.log(`[h3dbench] ${fps}fps (${_pbFrameCount} frames) over ${(dur/1000).toFixed(1)}s — ${parts.join(' | ')}`);
            _pbReportStart = now;
            _pbFrameCount = 0;
        };
    } else {
        pbBeg = pbEnd = pbReportTick = function () {};
    }

    function pool(parent, mk) {
        const a = [];
        let n = 0;
        return {
            get() {
                if (n < a.length) {
                    const o = a[n++];
                    o.visible = true;
                    if (o.center && o.center.isVector2) o.center.set(0.5, 0.5);
                    return o;
                }
                const o = mk(); parent.add(o); a.push(o); n++; return o;
            },
            reset() { for (let i = 0; i < n; i++) a[i].visible = false; n = 0; },
            // Pre-allocate `cap` slots at construction so the first dense
            // playback frames don't pay the new-Mesh allocation cost
            // mid-RAF (felt as a stall on 7/8-string charts where the
            // visible-note count outruns the lazy-grow path). Lazy growth
            // past `cap` still works — this is amortisation, not a cap.
            //
            // Coerce `cap` to a non-negative int32: a float would still
            // work but a callsite passing `Infinity` (or `NaN`) would
            // otherwise spin the while-loop until OOM. `cap | 0`
            // truncates floats, clamps Infinity → 0, and turns NaN → 0;
            // Math.max(0, …) keeps negatives out.
            warm(cap) {
                // Local rename to avoid shadowing the pool's outer
                // `n` (the in-use index advanced by get() / reset()).
                const targetLen = Math.max(0, cap | 0);
                while (a.length < targetLen) { const o = mk(); o.visible = false; parent.add(o); a.push(o); }
                return this;
            },
        };
    }

    // Returns indices of the longest consecutive run in a sorted integer
    // array as { start, len } — `sorted[start..start+len)` is the run.
    // Avoids the two per-call sub-array allocations of the previous
    // implementation (best + cur arrays grown via .push), at the cost
    // of one small 2-key result object. Net: callers in the chord-
    // diagram render path no longer churn arrays per visible chord.
    function longestConsecutiveRun(sorted) {
        let bestStart = -1, bestLen = 0;
        let curStart = -1, curLen = 0;
        for (let i = 0; i < sorted.length; i++) {
            if (curLen === 0 || sorted[i] === sorted[curStart + curLen - 1] + 1) {
                if (curLen === 0) curStart = i;
                curLen++;
            } else {
                if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
                curStart = i; curLen = 1;
            }
        }
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
        return { start: bestStart, len: bestLen };
    }

    /* ── Lyrics overlay (2D canvas on top of WebGL) ─────────────────── */
    function drawChordDiagram(ctx, opts) {
        const {
            name, frets,
            opacity = 1,
            entranceT = 1.0,
            canvasW = 600, canvasH = 400,
            inverted = false,
            sizeSlider = 0.5,
            position = 'tl',
            nStr = 6,
            lyricsBottom = 0,
            stackOffset = 0,
        } = opts;

        // Responsive sizing — CELL derived from panel height + user slider.
        // COLS is the resolved string count from the caller (via resolveStringCount)
        // so bass (4), extended (7/8) arrangements render correctly.
        const COLS = nStr, ROWS = 4;
        // Minimum column span required for PATH B (bracket extension / detection).
        // Math.min(COLS-1, 4) scales with string count:
        //   4-string bass → 3  (max possible span, so 2-4-4-2 shapes qualify)
        //   6-string      → 4  (excludes D major span=2 / common 2-string coincidences)
        //   8-string      → 4  (muted outer strings still leave span ≥ 4 for real barres)
        const MIN_BARRE_SPAN = Math.min(COLS - 1, 4);
        // Maps diagram column index → chord-template frets-array index.
        // Templates are high-e-first: frets[0]=high e, frets[COLS-1]=low E.
        // Non-inverted display (col 0 = high e): getStrIdx(0) = 0        → frets[0]      = high e.
        // Inverted display     (col 0 = low E):  getStrIdx(0) = COLS-1   → frets[COLS-1] = low E.
        const getStrIdx = col => inverted ? (COLS - 1 - col) : col;
        const sizeF  = DIAG_SIZE_MIN + (DIAG_SIZE_MAX - DIAG_SIZE_MIN) * sizeSlider;

        // startFret / isFirstPos must be known before CELL so that fretLabelW
        // can be measured and factored into the width cap.  The old
        // canvasW/(COLS+1.5) guard only approximated 2*PAD and ignored the
        // extra left padding reserved for non-first-position "Nfr" labels.
        const playedFrets = frets.filter(f => f > 0);
        const minFret     = playedFrets.length > 0 ? Math.min(...playedFrets) : 1;
        const startFret   = Math.max(1, minFret);
        const isFirstPos  = startFret === 1;

        // Phase 1 — height + hard-cap estimate, used only to size the label font.
        // Cap against the vertical space available below lyricsBottom so that the
        // diagram does not overflow into the lyrics banner on short split panels with
        // wrapped lyric rows.  Only top-corner positions can overlap the lyrics banner,
        // so lyricsBottom is only subtracted when position is 'tl' or 'tr'; for 'bl'
        // and 'br' the full canvas height is available.
        // Clamp to at least 1 so font/box calculations never receive 0-px input
        // on very short panels (e.g. tiny split cells < 44 px tall).
        const isTopCorner = position === 'tl' || position === 'tr';
        const availH  = canvasH - (isTopCorner ? lyricsBottom : 0);
        const cellEst = Math.max(1, Math.min(
            Math.round(availH * sizeF / (ROWS + 3)),
            DIAG_CELL_MAX,
        ));
        // Extra left padding for the "Nfr" label on non-first-position chords.
        // Measured with ctx.measureText at cellEst so the estimate is exact.
        let fretLabelW = 0;
        if (!isFirstPos) {
            // Measure inside a save/restore so this font assignment does not
            // leak to the caller (the outer ctx.save() happens after CELL is derived).
            ctx.save();
            ctx.font = `italic ${Math.round(cellEst * 0.55)}px sans-serif`;
            fretLabelW = Math.ceil(ctx.measureText(startFret + 'fr').width) + 6;
            ctx.restore();
        }

        // Phase 2 — final CELL: cap against panel height, hard max, and panel width.
        // Two width constraints are needed because PAD has a hard floor of 6:
        //   A) when PAD = CELL*0.65 (large CELL):  CELL*(COLS+0.3) + fretLabelW ≤ canvasW
        //   B) when PAD = 6 floor (small CELL):    CELL*(COLS-1)  + 12 + fretLabelW ≤ canvasW
        // Both are included so boxW ≤ canvasW in every regime.
        // fretLabelW was measured at cellEst ≥ CELL, so the cap is conservative.
        const CELL   = Math.max(1, Math.min(
            cellEst,
            Math.floor((canvasW - fretLabelW) / (COLS + 0.3)),
            Math.floor((canvasW - 2 * 6 - fretLabelW) / Math.max(1, COLS - 1)),
        ));
        const HEADER = Math.round(CELL * 1.6);
        const MARKER = Math.round(CELL * 0.7);
        const DOT_R  = CELL * 0.3;
        const PAD    = Math.max(6, Math.round(CELL * 0.65));
        const gridW  = CELL * (COLS - 1);
        const gridH  = CELL * ROWS;

        const PAD_L  = PAD + fretLabelW;

        const boxW   = gridW + PAD_L + PAD;
        const boxH   = HEADER + MARKER + gridH + PAD;

        // Anchor to chosen corner. Top positions get extra vertical offset
        // to clear the timeline plugin and song name displayed at the top.
        // lyricsBottom is the actual bottom Y of the lyrics banner (returned by
        // drawLyrics), so TOP_Y steps down past all lyric rows regardless of
        // how many wrap lines the current panel width produces.
        const E    = PAD;
        const TOP_Y = Math.round(Math.max(E + canvasH * 0.06, lyricsBottom + E));
        let bx, by;
        if      (position === 'tr') { bx = canvasW - boxW - E; by = TOP_Y + stackOffset; }
        else if (position === 'bl') { bx = E; by = canvasH - boxH - E - stackOffset; }
        else if (position === 'br') { bx = canvasW - boxW - E; by = canvasH - boxH - E - stackOffset; }
        else                        { bx = E; by = TOP_Y + stackOffset; }

        // Clamp so the box never bleeds off-canvas on narrow panels or wide string counts.
        bx = Math.max(0, Math.min(canvasW - boxW, bx));
        by = Math.max(0, Math.min(canvasH - boxH, by));

        // Guard: the canvasH–boxH clamp above can push `by` above lyricsBottom when
        // wrapped lyrics consume nearly the full panel height.  This applies to ALL
        // corner positions: a bottom-corner diagram anchored near the canvas bottom can
        // still reach up into the lyrics banner on very short or narrow panels where
        // boxH is larger than the space below the lyrics.  In those cases skip drawing
        // entirely rather than painting on top of the lyrics banner.
        if (lyricsBottom > 0 && by < lyricsBottom) return 0;

        const gx = bx + PAD_L, gy = by + HEADER + MARKER;

        // Ease-out quadratic entrance scale: 0.85 → 1.0.
        const scale = 1 - 0.15 * (1 - entranceT) * (1 - entranceT);

        ctx.save();
        ctx.globalAlpha = opacity;

        if (scale !== 1.0) {
            const cx = bx + boxW / 2, cy = by + boxH / 2;
            ctx.translate(cx, cy);
            ctx.scale(scale, scale);
            ctx.translate(-cx, -cy);
        }

        // Background + border.
        ctx.fillStyle = 'rgba(8, 14, 22, 0.88)';
        ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 7); ctx.stroke();

        // Split-root typography: "Dm7" → "D" large bold + "m7" smaller.
        const rootMatch = name.match(/^([A-G][#b]?)(.*)/);
        const root    = rootMatch ? rootMatch[1] : name;
        const quality = rootMatch ? rootMatch[2] : '';
        const rootSize = Math.round(CELL * 1.25);
        const qualSize = Math.round(rootSize * 0.65);
        ctx.textBaseline = 'middle';
        const nameY = by + HEADER * 0.55;
        ctx.font = `bold ${rootSize}px sans-serif`;
        const rootW = ctx.measureText(root).width;
        ctx.font = `${qualSize}px sans-serif`;
        const qualW = quality ? ctx.measureText(quality).width : 0;
        const nameBlockW = rootW + (quality ? qualW + 2 : 0);
        const nameStartX = bx + boxW / 2 - nameBlockW / 2;
        ctx.fillStyle = '#e8d080';
        ctx.font = `bold ${rootSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(root, nameStartX, nameY);
        if (quality) {
            ctx.font = `${qualSize}px sans-serif`;
            ctx.fillStyle = 'rgba(232,208,128,0.75)';
            ctx.fillText(quality, nameStartX + rootW + 2, nameY);
        }

        // Nut: CELL-proportional filled rect + subtle highlight line.
        // Thickness is 40% of CELL, floored at 2 px so it stays visible on
        // the smallest diagrams (CELL=1 on compact split panels).
        const NUT_H = Math.round(Math.max(2, CELL * 0.4));
        if (isFirstPos) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(gx, gy - NUT_H, gridW, NUT_H);
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillRect(gx, gy - NUT_H, gridW, Math.max(1, Math.round(NUT_H * 0.25)));
        }

        // Fret label for non-first-position chords.
        if (!isFirstPos) {
            ctx.fillStyle = 'rgba(220,200,120,0.9)';
            ctx.font = `italic ${Math.round(CELL * 0.55)}px sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(startFret + 'fr', gx - 4, gy + CELL * 0.5);
        }

        // Fret lines.
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
        for (let r = (isFirstPos ? 1 : 0); r <= ROWS; r++) {
            ctx.beginPath();
            ctx.moveTo(gx, gy + r * CELL);
            ctx.lineTo(gx + gridW, gy + r * CELL);
            ctx.stroke();
        }

        // String lines with varying weight: low E heavier, high e lighter.
        // With getStrIdx(col) = col (non-inverted): col 0 (high e) → strIdx=0 → t=0 thin;
        // col COLS-1 (low E) → strIdx=COLS-1 → t=1 thick. Inverted mode naturally mirrors.
        // Weights scale with CELL so strings never bleed into adjacent columns on
        // small-CELL diagrams (e.g. CELL=1 on compact split panels).
        for (let col = 0; col < COLS; col++) {
            const strIdx = getStrIdx(col);
            const t = COLS > 1 ? strIdx / (COLS - 1) : 1;  // 1=low E (thick), 0=high e (thin); guard COLS=1
            ctx.lineWidth = Math.max(0.5, CELL * (0.05 + t * 0.10));
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.beginPath();
            ctx.moveTo(gx + col * CELL, gy);
            ctx.lineTo(gx + col * CELL, gy + ROWS * CELL);
            ctx.stroke();
        }

        // Barre detection — two complementary paths:
        //
        // PATH A (F-shape / mini-barre): at least two ADJACENT columns are at startFret.
        //   Bracket is initially set to the consecutive run's own endpoints (not the full
        //   startFretCols range) so isolated bass notes at the same fret can't pull the
        //   bracket across an open gap (e.g. "2 0 2 2 0 0" stays bracketed at cols 2..3).
        //
        // PATH B (full-span barre / extension):
        //   When PATH A fired: extend the bracket outward to the full outer startFret span
        //     if the span ≥ MIN_BARRE_SPAN and every column between the outer startFret
        //     columns is fretted (f > 0).
        //   When PATH A did NOT fire: detect standalone full barres (e.g. x24442, x46654)
        //     where only the two outermost strings sit at startFret.  An additional check
        //     ensures that no intermediate column is itself at startFret — this rules out
        //     alternating-fret voicings like "1 3 1 3 1 0" (col 2 at startFret would fire
        //     incorrectly) while still catching B-major-style shapes where the barre
        //     finger covers only the outer two strings.
        //
        // Templates are high-e-first: frets[0]=high e, frets[COLS-1]=low E.
        // Examples (6-string, MIN_BARRE_SPAN=4):
        //   F major [1,1,2,3,3,1]: PATH A run=[4,5] → bracket 4..5; PATH B span=5, all fretted → extends to 0..5 ✓
        //   B major x24442:        PATH A no run; PATH B span=4, all fretted, no inner at startFret → 1..5 ✓
        //   mini-A  x02220:        PATH A run=[2,3,4] → bracket 2..4; PATH B span=2<4 → no extension ✓
        //   D major xx0232:        PATH A run length=1 → no PATH A; PATH B span<4 → no bracket ✓
        //   2 0 2 2 0 0:           PATH A run=[2,3] → bracket 2..3; PATH B span=3<4 → no extension ✓
        //   1 3 1 3 1 0:           PATH A no run; PATH B: inner col 2 at startFret → no bracket ✓
        const startFretCols = [];
        for (let col = 0; col < COLS; col++) {
            if (frets[getStrIdx(col)] === startFret) startFretCols.push(col);
        }
        const barreRun = longestConsecutiveRun(startFretCols);
        let hasBarreArc = barreRun.len >= 2;   // PATH A
        let barreMinCol = hasBarreArc ? startFretCols[barreRun.start] : -1;
        let barreMaxCol = hasBarreArc ? startFretCols[barreRun.start + barreRun.len - 1] : -1;

        if (startFretCols.length >= 2) {             // PATH B
            const minC = startFretCols[0];
            const maxC = startFretCols[startFretCols.length - 1];
            if (maxC - minC >= MIN_BARRE_SPAN) {
                let allFretted = true;
                for (let col = minC; col <= maxC; col++) {
                    if (frets[getStrIdx(col)] <= 0) { allFretted = false; break; }
                }
                if (allFretted) {
                    if (hasBarreArc) {
                        // PATH A fired: always safe to extend to full outer span.
                        barreMinCol = minC;
                        barreMaxCol = maxC;
                    } else {
                        // PATH A did not fire: only draw a bracket when no intermediate
                        // column sits at startFret.  Intermediate startFret columns would
                        // indicate a scattered/alternating voicing rather than a clean
                        // outer-edge barre (e.g. "1 3 1 3 1 0" has col 2 at startFret).
                        let noInnerAtStartFret = true;
                        for (let col = minC + 1; col < maxC; col++) {
                            if (frets[getStrIdx(col)] === startFret) { noInnerAtStartFret = false; break; }
                        }
                        if (noInnerAtStartFret) {
                            hasBarreArc = true;
                            barreMinCol = minC;
                            barreMaxCol = maxC;
                        }
                    }
                }
            }
        }
        if (hasBarreArc) {
            const barreY   = gy + CELL * 0.5;
            const capH     = CELL * 0.22;  // vertical offset from barreY to the bracket line
            const capHalf  = Math.max(1, Math.round(CELL * 0.3)); // half-height of the vertical end caps
            // Straight bracket: a horizontal line with short vertical end caps.
            // Stroke scales with CELL so it doesn't swamp tiny cells (floor at 1 px).
            ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(1, CELL * 0.2);
            ctx.beginPath();
            ctx.moveTo(gx + barreMinCol * CELL, barreY - capH);
            ctx.lineTo(gx + barreMaxCol * CELL, barreY - capH);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(gx + barreMinCol * CELL, barreY - capH - capHalf);
            ctx.lineTo(gx + barreMinCol * CELL, barreY - capH + capHalf);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(gx + barreMaxCol * CELL, barreY - capH - capHalf);
            ctx.lineTo(gx + barreMaxCol * CELL, barreY - capH + capHalf);
            ctx.stroke();
        }

        // Open/muted markers + finger dots.
        // Non-inverted: col 0 = high e → getStrIdx(0)=0 → frets[0]; col COLS-1 = low E → frets[COLS-1].
        // Inverted:     col 0 = low E → getStrIdx(0)=COLS-1 → frets[COLS-1]; col COLS-1 = high e → frets[0].
        for (let col = 0; col < COLS; col++) {
            const f = frets[getStrIdx(col)];
            const sx = gx + col * CELL;
            const markerY = gy - MARKER * 0.5;
            if (f < 0) {
                const r = CELL * 0.20;
                ctx.strokeStyle = '#cc4444'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(sx - r, markerY - r); ctx.lineTo(sx + r, markerY + r); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(sx + r, markerY - r); ctx.lineTo(sx - r, markerY + r); ctx.stroke();
            } else if (f === 0) {
                ctx.strokeStyle = '#88bbff'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(sx, markerY, CELL * 0.22, 0, Math.PI * 2); ctx.stroke();
            } else {
                const row = f - startFret;
                if (row >= 0 && row < ROWS) {
                    const isBarreCol = hasBarreArc && f === startFret &&
                                       col >= barreMinCol && col <= barreMaxCol;
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = Math.min(4, CELL * 0.4);
                    ctx.shadowOffsetX = Math.max(0.5, CELL * 0.1);
                    ctx.shadowOffsetY = Math.max(0.5, CELL * 0.1);
                    ctx.fillStyle = isBarreCol ? 'rgba(255,255,255,0.85)' : '#ffffff';
                    ctx.beginPath();
                    ctx.arc(sx, gy + row * CELL + CELL * 0.5, DOT_R, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
                }
            }
        }
        ctx.restore();
        return boxH;
    }

    // Cached wrapper for drawChordDiagram. When entranceT === 1 (scale
    // transform is identity) the diagram is rendered once to an
    // OffscreenCanvas and reused every subsequent frame via drawImage +
    // globalAlpha. During the 0.2 s entrance animation (entranceT < 1)
    // the scale transform is non-trivial so we fall through to a fresh
    // render — that window is ~12 frames at 60 fps, negligible.
    //
    // Returns boxH (diagram card height in px) so the draw loop can
    // accumulate per-corner stack offsets when multiple overlays share
    // the same corner position.
    function _drawDiagramCached(ctx, opts) {
        const { opacity = 1, entranceT = 1.0, canvasW, canvasH } = opts;
        if (opacity <= 0) return 0;
        if (entranceT < 1.0) {
            return drawChordDiagram(ctx, opts) || 0;
        }
        const { name, frets, nStr, inverted, sizeSlider, position, lyricsBottom = 0, stackOffset = 0 } = opts;
        const key = name + '|' + (frets || []).join(',') + '|' + nStr + '|' +
                    (inverted ? 1 : 0) + '|' + sizeSlider + '|' + position + '|' +
                    canvasW + '|' + canvasH + '|' + lyricsBottom + '|' + stackOffset;
        let entry = _diagRenderCache.get(key);
        if (!entry) {
            let oc;
            try { oc = new OffscreenCanvas(canvasW, canvasH); }
            catch (_) { oc = document.createElement('canvas'); oc.width = canvasW; oc.height = canvasH; }
            const boxH = drawChordDiagram(oc.getContext('2d'), { ...opts, opacity: 1, entranceT: 1 }) || 0;
            if (_diagRenderCache.size >= _DIAG_CACHE_MAX) {
                _diagRenderCache.delete(_diagRenderCache.keys().next().value);
            }
            entry = { oc, boxH };
            _diagRenderCache.set(key, entry);
        }
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.drawImage(entry.oc, 0, 0);
        ctx.restore();
        return entry.boxH;
    }

    // Two-line section card. Top line is "Now: <current>", bottom line
    // is "Up Next: <next> in <countdown>". Explicit labels disambiguate
    // current vs upcoming — earlier single-line variant rendered both
    // states with the same word and was confusing during playback.
    //
    // Returns boxH on draw, 0 when nothing rendered. Position / size
    // mirror the chord-diagram contract: 'tl' / 'tr' / 'bl' / 'br'
    // anchor corners, sizeSlider in [0,1] scales card height.
    //
    // Hidden when:
    //   - no sections array, or
    //   - playback has not yet reached the first section AND there's
    //     no upcoming-only fallback rendered (we still show "Up Next"
    //     during the pre-roll so the user sees what's coming).
    function drawSectionHud(ctx, opts) {
        const {
            sections, currentTime,
            canvasW, canvasH,
            position = 'tr',
            sizeSlider = 0.5,
            lyricsBottom = 0,
            stackOffset = 0,
        } = opts;
        if (!sections || !sections.length) return 0;

        // sections are time-ordered server-side; single forward scan.
        let curIdx = -1;
        for (let i = 0; i < sections.length; i++) {
            if (sections[i].time <= currentTime) curIdx = i;
            else break;
        }
        const cur  = curIdx >= 0 ? sections[curIdx] : null;
        const next = (curIdx + 1 < sections.length) ? sections[curIdx + 1] : null;
        // Pre-first-section: nothing playing yet but next is coming —
        // still useful to render "Up Next" alone so the user gets the
        // anticipatory cue during the song's intro silence.
        if (!cur && !next) return 0;

        const nowName = cur ? cur.name : '';
        // Render countdown as a separate span so it can take a calmer
        // grey-white treatment while the section name itself stays
        // cyan. Combining them into one string would inherit the cyan
        // fill across both, defeating the visual hierarchy promised
        // in the FR.
        let nextName = '';
        let nextCountdown = '';
        if (next) {
            const dt = next.time - currentTime;
            nextName = next.name;
            nextCountdown = dt > 10
                ? 'in ' + Math.round(dt) + 's'
                : 'in ' + Math.max(0, dt).toFixed(1) + 's';
        }

        const sizeF = 0.65 + 0.85 * sizeSlider; // 0.65 .. 1.5
        const baseH = Math.max(34, Math.min(72, Math.round(canvasH * 0.085 * sizeF)));
        const PAD_X = Math.round(baseH * 0.45);
        const PAD_Y = Math.round(baseH * 0.20);
        // Per-text-element scale applied to nameSize / tagSize / lineH
        // when the unscaled card would overflow a narrow panel
        // (splitscreen quad layout, ultra-tall portrait). Computed
        // below from the measured contentW vs the available width.
        let textScale = 1.0;
        const baseLineH    = Math.round(baseH * 0.46);
        const baseNameSize = Math.round(baseH * 0.36);
        const baseTagSize  = Math.round(baseH * 0.24);
        const baseTagGap   = Math.round(baseH * 0.14);

        const TAG_NOW  = 'Now:';
        const TAG_NEXT = 'Up Next:';

        // Phase-1 measurement at the unscaled font sizes — used to
        // decide whether textScale needs to drop, and to lay out the
        // final draw at whatever scale we land on.
        ctx.save();
        ctx.font = `${baseTagSize}px sans-serif`;
        const tagNowWBase  = ctx.measureText(TAG_NOW).width;
        const tagNextWBase = ctx.measureText(TAG_NEXT).width;
        const countdownWBase = nextCountdown ? ctx.measureText(nextCountdown).width : 0;
        ctx.font = `bold ${baseNameSize}px sans-serif`;
        const nowNameWBase  = nowName  ? ctx.measureText(nowName).width  : 0;
        const nextNameWBase = nextName ? ctx.measureText(nextName).width : 0;
        ctx.restore();

        const lineNowWBase  = nowName  ? tagNowWBase  + baseTagGap + nowNameWBase  : 0;
        const lineNextWBase = nextName
            ? tagNextWBase + baseTagGap + nextNameWBase
              + (nextCountdown ? baseTagGap + countdownWBase : 0)
            : 0;
        const contentWBase  = Math.max(lineNowWBase, lineNextWBase);
        const numLines = (nowName ? 1 : 0) + (nextName ? 1 : 0);
        if (numLines === 0) return 0;

        // Target width budget: cap at canvasW - 16 and reserve PAD_X
        // either side. If contentWBase exceeds the budget, scale the
        // font proportionally — clamped to 0.55 so labels stay legible
        // even on extreme split-panel widths.
        const maxBoxW = Math.max(40, canvasW - 16);
        const availContentW = Math.max(1, maxBoxW - PAD_X * 2);
        if (contentWBase > availContentW) {
            textScale = Math.max(0.55, availContentW / contentWBase);
        }

        const lineH    = Math.max(1, Math.round(baseLineH    * textScale));
        const nameSize = Math.max(1, Math.round(baseNameSize * textScale));
        const tagSize  = Math.max(1, Math.round(baseTagSize  * textScale));
        const TAG_GAP  = Math.max(1, Math.round(baseTagGap   * textScale));

        // Phase-2 re-measurement at the scaled font sizes for the
        // final layout. measureText doesn't scale linearly with font
        // size on every glyph, so re-measuring is cheaper than
        // multiplying the base widths by textScale and risking a
        // half-pixel overflow.
        ctx.save();
        ctx.font = `${tagSize}px sans-serif`;
        const tagNowW  = ctx.measureText(TAG_NOW).width;
        const tagNextW = ctx.measureText(TAG_NEXT).width;
        const countdownW = nextCountdown ? ctx.measureText(nextCountdown).width : 0;
        ctx.font = `bold ${nameSize}px sans-serif`;
        const nowNameW  = nowName  ? ctx.measureText(nowName).width  : 0;
        const nextNameW = nextName ? ctx.measureText(nextName).width : 0;
        ctx.restore();

        const lineNowW  = nowName  ? tagNowW  + TAG_GAP + nowNameW  : 0;
        const lineNextW = nextName
            ? tagNextW + TAG_GAP + nextNameW + (nextCountdown ? TAG_GAP + countdownW : 0)
            : 0;
        const contentW = Math.max(lineNowW, lineNextW);

        const boxW = Math.min(maxBoxW, Math.round(contentW + PAD_X * 2));
        const boxH = Math.round(numLines * lineH + PAD_Y * 2);

        const E = Math.round(baseH * 0.25);
        const TOP_Y = Math.round(Math.max(E + canvasH * 0.06, lyricsBottom + E));
        let bx, by;
        if      (position === 'tr') { bx = canvasW - boxW - E; by = TOP_Y + stackOffset; }
        else if (position === 'bl') { bx = E; by = canvasH - boxH - E - stackOffset; }
        else if (position === 'br') { bx = canvasW - boxW - E; by = canvasH - boxH - E - stackOffset; }
        else                        { bx = E; by = TOP_Y + stackOffset; }
        bx = Math.max(0, Math.min(canvasW - boxW, bx));
        by = Math.max(0, Math.min(canvasH - boxH, by));
        // Suppress overlap with the wrapped lyrics banner regardless
        // of corner. Bottom-corner cards on short panels can still
        // reach up into the banner once boxH exceeds the space below
        // the lyrics — same shape the chord diagram uses.
        if (lyricsBottom > 0 && by < lyricsBottom) return 0;

        ctx.save();
        ctx.fillStyle = 'rgba(8, 14, 22, 0.88)';
        ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 7); ctx.stroke();

        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        // Layout each line with tag left-aligned, name in cyan after a
        // small gap. Both lines share the same x origin (bx + PAD_X)
        // so the tag column visually aligns vertically.
        const lineX = bx + PAD_X;
        let lineY = by + PAD_Y + lineH / 2;
        const TAG_COLOR = 'rgba(180,190,205,0.85)';
        const NAME_COLOR = '#00cccc';
        const TIME_COLOR = 'rgba(220,225,235,0.9)';

        if (nowName) {
            ctx.font = `${tagSize}px sans-serif`;
            ctx.fillStyle = TAG_COLOR;
            ctx.fillText(TAG_NOW, lineX, lineY);
            ctx.font = `bold ${nameSize}px sans-serif`;
            ctx.fillStyle = NAME_COLOR;
            ctx.fillText(nowName, lineX + tagNowW + TAG_GAP, lineY);
            lineY += lineH;
        }
        if (nextName) {
            ctx.font = `${tagSize}px sans-serif`;
            ctx.fillStyle = TAG_COLOR;
            ctx.fillText(TAG_NEXT, lineX, lineY);
            const nextX = lineX + tagNextW + TAG_GAP;
            ctx.font = `bold ${nameSize}px sans-serif`;
            ctx.fillStyle = NAME_COLOR;
            ctx.fillText(nextName, nextX, lineY);
            if (nextCountdown) {
                ctx.font = `${tagSize}px sans-serif`;
                ctx.fillStyle = TIME_COLOR;
                ctx.fillText(nextCountdown, nextX + nextNameW + TAG_GAP, lineY);
            }
        }
        ctx.restore();
        return boxH;
    }

    // Tone-change HUD — card showing the active tone and the next upcoming
    // tone with a countdown. Mirrors drawSectionHud's layout contract
    // (position, size slider, lyricsBottom) but uses an amber accent colour
    // so it reads as distinct from the cyan section card.
    function drawToneHud(ctx, opts) {
        const {
            toneChanges, toneBase = '',
            currentTime,
            canvasW, canvasH,
            position = 'tl',
            sizeSlider = 0.5,
            lyricsBottom = 0,
            stackOffset = 0,
        } = opts;

        // Resolve active tone: toneBase before all changes, else the most
        // recent change at or before currentTime.
        // toneChanges items use { t, name } (not { time, name }) — both
        // the legacy import path (server.py xml_tone_changes) and the sloppak
        // path (lib/tones.py sloppak_tone_changes) emit "t" as the key.
        let curName = toneBase;
        let nextChange = null;
        if (toneChanges && toneChanges.length) {
            for (let i = 0; i < toneChanges.length; i++) {
                if (toneChanges[i].t <= currentTime) {
                    curName = toneChanges[i].name;
                } else {
                    nextChange = toneChanges[i];
                    break;
                }
            }
        }
        if (!curName && !nextChange) return 0;

        let nextName = '';
        let nextCountdown = '';
        if (nextChange) {
            const dt = nextChange.t - currentTime;
            nextName = nextChange.name;
            nextCountdown = dt > 10
                ? 'in ' + Math.round(dt) + 's'
                : 'in ' + Math.max(0, dt).toFixed(1) + 's';
        }

        const sizeF = 0.65 + 0.85 * sizeSlider;
        const baseH = Math.max(34, Math.min(72, Math.round(canvasH * 0.085 * sizeF)));
        const PAD_X = Math.round(baseH * 0.45);
        const PAD_Y = Math.round(baseH * 0.20);
        let textScale = 1.0;
        const baseLineH    = Math.round(baseH * 0.46);
        const baseNameSize = Math.round(baseH * 0.36);
        const baseTagSize  = Math.round(baseH * 0.24);
        const baseTagGap   = Math.round(baseH * 0.14);

        const TAG_CUR  = 'Tone:';
        const TAG_NEXT = 'Next:';

        ctx.save();
        ctx.font = `${baseTagSize}px sans-serif`;
        const tagCurWBase  = ctx.measureText(TAG_CUR).width;
        const tagNextWBase = ctx.measureText(TAG_NEXT).width;
        const countdownWBase = nextCountdown ? ctx.measureText(nextCountdown).width : 0;
        ctx.font = `bold ${baseNameSize}px sans-serif`;
        const curNameWBase  = curName  ? ctx.measureText(curName).width  : 0;
        const nextNameWBase = nextName ? ctx.measureText(nextName).width : 0;
        ctx.restore();

        const lineCurWBase  = curName  ? tagCurWBase  + baseTagGap + curNameWBase  : 0;
        const lineNextWBase = nextName
            ? tagNextWBase + baseTagGap + nextNameWBase
              + (nextCountdown ? baseTagGap + countdownWBase : 0)
            : 0;
        const contentWBase = Math.max(lineCurWBase, lineNextWBase);
        const numLines = (curName ? 1 : 0) + (nextName ? 1 : 0);
        if (numLines === 0) return 0;

        const maxBoxW = Math.max(40, canvasW - 16);
        const availContentW = Math.max(1, maxBoxW - PAD_X * 2);
        if (contentWBase > availContentW) {
            textScale = Math.max(0.55, availContentW / contentWBase);
        }

        const lineH    = Math.max(1, Math.round(baseLineH    * textScale));
        const nameSize = Math.max(1, Math.round(baseNameSize * textScale));
        const tagSize  = Math.max(1, Math.round(baseTagSize  * textScale));
        const TAG_GAP  = Math.max(1, Math.round(baseTagGap   * textScale));

        ctx.save();
        ctx.font = `${tagSize}px sans-serif`;
        const tagCurW  = ctx.measureText(TAG_CUR).width;
        const tagNextW = ctx.measureText(TAG_NEXT).width;
        const countdownW = nextCountdown ? ctx.measureText(nextCountdown).width : 0;
        ctx.font = `bold ${nameSize}px sans-serif`;
        const curNameW  = curName  ? ctx.measureText(curName).width  : 0;
        const nextNameW = nextName ? ctx.measureText(nextName).width : 0;
        ctx.restore();

        const lineCurW  = curName  ? tagCurW  + TAG_GAP + curNameW  : 0;
        const lineNextW = nextName
            ? tagNextW + TAG_GAP + nextNameW + (nextCountdown ? TAG_GAP + countdownW : 0)
            : 0;
        const contentW = Math.max(lineCurW, lineNextW);

        const boxW = Math.min(maxBoxW, Math.round(contentW + PAD_X * 2));
        const boxH = Math.round(numLines * lineH + PAD_Y * 2);

        const E = Math.round(baseH * 0.25);
        const TOP_Y = Math.round(Math.max(E + canvasH * 0.06, lyricsBottom + E));
        let bx, by;
        if      (position === 'tr') { bx = canvasW - boxW - E; by = TOP_Y + stackOffset; }
        else if (position === 'bl') { bx = E; by = canvasH - boxH - E - stackOffset; }
        else if (position === 'br') { bx = canvasW - boxW - E; by = canvasH - boxH - E - stackOffset; }
        else                        { bx = E; by = TOP_Y + stackOffset; } // 'tl' default
        bx = Math.max(0, Math.min(canvasW - boxW, bx));
        by = Math.max(0, Math.min(canvasH - boxH, by));
        if (lyricsBottom > 0 && by < lyricsBottom) return 0;

        ctx.save();
        ctx.fillStyle = 'rgba(8, 14, 22, 0.88)';
        ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 7); ctx.stroke();

        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        const lineX = bx + PAD_X;
        let lineY = by + PAD_Y + lineH / 2;
        const TAG_COLOR  = 'rgba(180,190,205,0.85)';
        const NAME_COLOR = '#ff9a3c'; // amber — distinct from section cyan
        const TIME_COLOR = 'rgba(220,225,235,0.9)';

        if (curName) {
            ctx.font = `${tagSize}px sans-serif`;
            ctx.fillStyle = TAG_COLOR;
            ctx.fillText(TAG_CUR, lineX, lineY);
            ctx.font = `bold ${nameSize}px sans-serif`;
            ctx.fillStyle = NAME_COLOR;
            ctx.fillText(curName, lineX + tagCurW + TAG_GAP, lineY);
            lineY += lineH;
        }
        if (nextName) {
            ctx.font = `${tagSize}px sans-serif`;
            ctx.fillStyle = TAG_COLOR;
            ctx.fillText(TAG_NEXT, lineX, lineY);
            const nextX = lineX + tagNextW + TAG_GAP;
            ctx.font = `bold ${nameSize}px sans-serif`;
            ctx.fillStyle = NAME_COLOR;
            ctx.fillText(nextName, nextX, lineY);
            if (nextCountdown) {
                ctx.font = `${tagSize}px sans-serif`;
                ctx.fillStyle = TIME_COLOR;
                ctx.fillText(nextCountdown, nextX + nextNameW + TAG_GAP, lineY);
            }
        }
        ctx.restore();
        return boxH;
    }

    // Lyrics layout cache — measureText per syllable + row wrapping
    // only changes when the displayed line(s), font size, or canvas
    // width change, not per frame. Keyed below; the per-frame work is
    // just drawing over the cached widths.
    let _lyrRowsCache = null;

    function drawLyrics(lyrics, currentTime, ctx, W, H) {
        if (!lyrics._lines) {
            const lines = [];
            let line = null, word = null;
            const flushWord = () => { if (word && word.length) line.words.push(word); word = null; };
            const flushLine = () => { flushWord(); if (line && line.words.length) lines.push(line); line = null; };
            for (let i = 0; i < lyrics.length; i++) {
                const l = lyrics[i];
                const raw = l.w || '';
                const endsLine = raw.endsWith('+');
                const continuesWord = raw.endsWith('-');
                if (line && i > 0 && l.t - (lyrics[i - 1].t + lyrics[i - 1].d) > 4.0) flushLine();
                if (!line) line = { words: [], start: l.t, end: l.t + l.d };
                if (!word) word = [];
                word.push(l);
                line.end = Math.max(line.end, l.t + l.d);
                if (!continuesWord) flushWord();
                if (endsLine) flushLine();
            }
            flushLine();
            lyrics._lines = lines;
        }
        const allLines = lyrics._lines;
        if (!allLines.length) return 0;

        let currentIdx = -1;
        for (let i = 0; i < allLines.length; i++) {
            if (allLines[i].start <= currentTime) currentIdx = i;
            else break;
        }
        if (currentIdx === -1) {
            if (allLines[0].start - currentTime > 2.0) return 0;
            currentIdx = 0;
        }
        const currentLine = allLines[currentIdx];
        const nextLine = allLines[currentIdx + 1] || null;
        const gapToNext = nextLine ? (nextLine.start - currentLine.end) : Infinity;
        if (currentTime > currentLine.end + 0.5 && gapToNext > 3.0) return 0;

        const linesToShow = [currentLine];
        if (nextLine && gapToNext <= 3.0) linesToShow.push(nextLine);

        const fontSize = Math.max(18, H * 0.028) | 0;
        const lineY = H * 0.04;
        const sylText = s => { const t = s.w || ''; return (t.endsWith('+') || t.endsWith('-')) ? t.slice(0, -1) : t; };

        ctx.font = `bold ${fontSize}px sans-serif`;
        let rows, spaceWidth, bgWidth;
        const _lc = _lyrRowsCache;
        if (_lc && _lc.lyricsRef === lyrics && _lc.idx === currentIdx
            && _lc.shown === linesToShow.length
            && _lc.fontSize === fontSize && _lc.W === W) {
            rows = _lc.rows; spaceWidth = _lc.spaceWidth; bgWidth = _lc.bgWidth;
        } else {
            spaceWidth = ctx.measureText(' ').width;
            const maxWidth = W * 0.8;

            rows = [];
            for (const authoredLine of linesToShow) {
                let row = [], rowWidth = 0;
                for (const wordSyls of authoredLine.words) {
                    const parts = [];
                    let wordWidth = 0;
                    for (const s of wordSyls) {
                        const text = sylText(s);
                        const w = ctx.measureText(text).width;
                        parts.push({ syl: s, text, width: w });
                        wordWidth += w;
                    }
                    const advance = wordWidth + spaceWidth;
                    if (row.length > 0 && rowWidth + advance > maxWidth) { rows.push(row); row = []; rowWidth = 0; }
                    row.push({ parts, advance });
                    rowWidth += advance;
                }
                if (row.length) rows.push(row);
            }

            bgWidth = 0;
            for (const row of rows) {
                const rw = row.reduce((s, w) => s + w.advance, 0) - spaceWidth;
                if (rw > bgWidth) bgWidth = rw;
            }
            bgWidth = Math.min(bgWidth + 30, W * 0.85);
            _lyrRowsCache = {
                lyricsRef: lyrics, idx: currentIdx,
                shown: linesToShow.length, fontSize, W,
                rows, spaceWidth, bgWidth,
            };
        }

        const rowHeight = fontSize + 6;
        const totalHeight = rows.length * rowHeight + 10;

        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        const bx = W / 2 - bgWidth / 2, by = lineY - 4, br = 8;
        ctx.moveTo(bx + br, by); ctx.lineTo(bx + bgWidth - br, by);
        ctx.quadraticCurveTo(bx + bgWidth, by, bx + bgWidth, by + br);
        ctx.lineTo(bx + bgWidth, by + totalHeight - br);
        ctx.quadraticCurveTo(bx + bgWidth, by + totalHeight, bx + bgWidth - br, by + totalHeight);
        ctx.lineTo(bx + br, by + totalHeight);
        ctx.quadraticCurveTo(bx, by + totalHeight, bx, by + totalHeight - br);
        ctx.lineTo(bx, by + br);
        ctx.quadraticCurveTo(bx, by, bx + br, by);
        ctx.closePath();
        ctx.fill();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const rowWidth = row.reduce((s, w) => s + w.advance, 0) - spaceWidth;
            let xPos = W / 2 - rowWidth / 2;
            const yPos = lineY + r * rowHeight + 2;
            for (const w of row) {
                for (const part of w.parts) {
                    const l = part.syl;
                    const isActive = currentTime >= l.t && currentTime < l.t + l.d;
                    const isPast = currentTime >= l.t + l.d;
                    ctx.fillStyle = isActive ? '#4ae0ff' : isPast ? '#8899aa' : '#556677';
                    ctx.font = `${isActive ? 'bold' : 'normal'} ${fontSize}px sans-serif`;
                    ctx.fillText(part.text, xPos, yPos);
                    xPos += part.width;
                }
                xPos += spaceWidth;
            }
        }
        // Return the actual bottom Y of the rendered background box so callers
        // (e.g. drawChordDiagram) can avoid overlapping it.
        return Math.round(by + totalHeight);
    }

    /* ── Scene initialisation ─────────────────────────────────────────── */
    function initScene() {
        if (!highwayCanvas || !highwayCanvas.parentNode) {
            console.error('[3D-Hwy] initScene: canvas has no parent; aborting');
            return false;
        }

        // Reset per-song lane state
        fretLastActiveTime.fill(0);

        wrap = document.createElement('div');
        wrap.id = 'h3d-wrap-' + _instanceId;
        wrap.className = 'h3d-wrap';
        wrap.dataset.h3dInstance = String(_instanceId);
        wrap.style.cssText = 'position:absolute;top:0;left:0;right:0;z-index:2;pointer-events:none;';
        // Mark this instance as the primary tour target so the tour engine
        // always spotlights a unique element (selector '.h3d-wrap[data-h3d-primary]')
        // rather than the first of potentially many splitscreen wraps.
        document.querySelectorAll('.h3d-wrap[data-h3d-primary]').forEach(
            el => el.removeAttribute('data-h3d-primary'));
        wrap.setAttribute('data-h3d-primary', '');
        highwayCanvas.parentNode.insertBefore(wrap, highwayCanvas.nextSibling);

        // Subscribe to highway:visibility (feedBack#246) so the
        // .h3d-wrap overlay hides in sync with the feedBack canvas.
        // The wrap is a sibling of #highway, so display:none on
        // #highway leaves us painting full-screen otherwise.
        // Guarded lazy bind: tolerate hosts that don't yet expose
        // feedBack.on/off (older feedBack versions, headless
        // tests).
        if (window.feedBack
            && typeof window.feedBack.on === 'function'
            && typeof window.feedBack.off === 'function') {
            _visibilityHandler = (e) => {
                if (!wrap) return;
                // Filter by canvas identity (splitscreen-safe).
                // Each createHighway() instance emits its own
                // visibility events on the shared feedBack bus —
                // without this gate, one hidden panel would also
                // hide every other panel's 3D overlay.
                if (!e || !e.detail || e.detail.canvas !== highwayCanvas) return;
                const v = e.detail.visible;
                wrap.style.display = v === false ? 'none' : '';
            };
            try {
                window.feedBack.on('highway:visibility', _visibilityHandler);
            } catch (e) {
                _visibilityHandler = null;
            }
            // Track canvas-replaced so the visibility handler's
            // identity gate continues to match after core swaps the
            // <canvas> element for a context-type change.
            _canvasReplacedHandler = (e) => {
                if (!e || !e.detail) return;
                // Only update if the swap involves OUR canvas — in
                // splitscreen each panel has its own canvas.
                if (e.detail.oldCanvas !== highwayCanvas) return;
                highwayCanvas = e.detail.newCanvas;
                // Re-sync wrap visibility from the new canvas in
                // case its initial displayed-state differs.
                if (wrap) {
                    const v = highwayCanvas && highwayCanvas.offsetParent !== null;
                    wrap.style.display = v ? '' : 'none';
                }
            };
            try {
                window.feedBack.on('highway:canvas-replaced', _canvasReplacedHandler);
            } catch (e) {
                _canvasReplacedHandler = null;
            }
            // Sync once at bind time: the event is transition-only,
            // so if the canvas was already hidden when we mounted
            // (e.g. plugin loaded while splitscreen was active),
            // we'd never receive an emit and would leave the wrap
            // visible. Compute from the local highwayCanvas (not
            // window.highway.isVisible) so splitscreen panels get
            // their own per-instance answer instead of inheriting
            // the main highway's state.
            if (_visibilityHandler) {
                try {
                    const initialVisible = highwayCanvas
                        && highwayCanvas.offsetParent !== null;
                    wrap.style.display = initialVisible ? '' : 'none';
                } catch (e) { /* ignore — initial sync is best-effort */ }
            }
        }

        // powerPreference hints the platform to use the discrete /
        // high-performance GPU and a higher power profile for this WebGL
        // context. On laptops / iGPU+dGPU machines (Windows, macOS) it
        // steers GPU selection to the dGPU; on single-dGPU desktops it
        // requests the high-performance power profile. (It does not by
        // itself force NVIDIA's utilisation-driven clock ramp on Linux.)
        ren = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true });
        _probe = new T.Vector3();
        ren.setClearColor(0x101820, 1);
        wrap.appendChild(ren.domElement);

        // WebGL context-loss recovery (see the _ctxLost declaration). Bound
        // on Three's own canvas — the context that actually resets on a GPU
        // reset / alt-tab. preventDefault() keeps the context restorable
        // instead of letting the loss escalate to a render-process crash;
        // _ctxLost then makes draw() bail so no GL work runs on the dead
        // context; on restore we reset the viewport and resume (Three
        // re-uploads geometry/materials/textures lazily on the next render).
        _onCtxLost = (e) => {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            _ctxLost = true;
            console.warn('[3D-Hwy] WebGL context lost — pausing render until it is restored.');
        };
        _onCtxRestored = () => {
            _ctxLost = false;
            console.warn('[3D-Hwy] WebGL context restored — resuming render.');
            try { const s = canvasSize(highwayCanvas); if (s.w > 0 && s.h > 0) applySize(s.w, s.h); } catch (err) {}
        };
        ren.domElement.addEventListener('webglcontextlost', _onCtxLost, false);
        ren.domElement.addEventListener('webglcontextrestored', _onCtxRestored, false);

        lyricsCanvas = document.createElement('canvas');
        lyricsCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:1;';
        lyricsCtx = lyricsCanvas.getContext('2d');
        wrap.appendChild(lyricsCanvas);

        scene = new T.Scene();
        scene.fog = new T.Fog(0x101820, FOG_START * 0.8, FOG_END * 1.2);

        cam = new T.PerspectiveCamera(BASE_VFOV, 1, 0.01, FOG_END * 3);

        ambLight = new T.AmbientLight(0xffffff, 0.85);
        scene.add(ambLight);
        dirLight = new T.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(40 * K, 120 * K, 80 * K);
        scene.add(dirLight);
        _applyCinematic();

        fretG = new T.Group(); scene.add(fretG);
        tuningLblG = new T.Group(); scene.add(tuningLblG);
        noteG = new T.Group(); scene.add(noteG);
        // Hit sparks (#3): a pooled additive Points cloud; a small burst fires at a
        // gem on a verified hit (spawned in the verdict block, advanced in the render loop).
        _sparkPos = new Float32Array(_SPARK_N * 3); _sparkCol = new Float32Array(_SPARK_N * 3);
        _sparkVel = new Float32Array(_SPARK_N * 3); _sparkLife = new Float32Array(_SPARK_N);
        {
            const sg = new T.BufferGeometry();
            sg.setAttribute('position', new T.BufferAttribute(_sparkPos, 3).setUsage(T.DynamicDrawUsage));
            sg.setAttribute('color', new T.BufferAttribute(_sparkCol, 3).setUsage(T.DynamicDrawUsage));
            const sm = new T.PointsMaterial({ size: 1.0 * K, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true });
            _sparkPts = new T.Points(sg, sm); _sparkPts.frustumCulled = false; _sparkPts.renderOrder = 8;
            scene.add(_sparkPts);
        }
        beatG = new T.Group(); scene.add(beatG);
        lblG = new T.Group(); scene.add(lblG);

        // Rectangular note geometry
        gNote = new T.BoxGeometry(NW, NH, ND);
        // Per-string vertical gradient gems — colours sampled from the
        // original colour PNGs (top highlight → deeper bottom). Each gradient
        // string gets its own BoxGeometry clone carrying a per-vertex colour
        // attribute; the gem core swaps to gNoteGrad[s] in drawNote while its
        // material (mStr[s]) is white + vertexColors:true so the gradient
        // shows pure. Strings 6/7 have no entry and fall back to flat gNote.
        gNoteGrad = DEFAULT_GEM_GRADIENTS.map(([topHex, botHex]) => {
            const g = new T.BoxGeometry(NW, NH, ND);
            const _pos = g.attributes.position;
            const _colors = new Float32Array(_pos.count * 3);
            const _topCol = new T.Color(topHex);
            const _botCol = new T.Color(botHex);
            const _tmpCol = new T.Color();
            const _halfH = NH / 2;
            for (let i = 0; i < _pos.count; i++) {
                const t = (_pos.getY(i) + _halfH) / (2 * _halfH); // 0 bottom..1 top
                _tmpCol.copy(_botCol).lerp(_topCol, t);
                _colors[i * 3] = _tmpCol.r;
                _colors[i * 3 + 1] = _tmpCol.g;
                _colors[i * 3 + 2] = _tmpCol.b;
            }
            g.setAttribute('color', new T.BufferAttribute(_colors, 3));
            _ownedSharedGeos.push(g);
            return g;
        });
        // Seed gem colors from whatever palette is active at mount (custom
        // colors recolor the gem bodies just like the strings/trails).
        _recolorGemGradients();

        /** Filled ring matching flying-note outline (1.1) minus core (1.0); hollow centre. */
        function mkGhostFrameGeometry() {
            const ow = NW * 1.1;
            const oh = NH * 1.1;
            const iw = NW;
            const ih = NH;
            const depth = ND * 2.8;
            const shape = new T.Shape();
            shape.moveTo(-ow / 2, -oh / 2);
            shape.lineTo(-ow / 2, oh / 2);
            shape.lineTo(ow / 2, oh / 2);
            shape.lineTo(ow / 2, -oh / 2);
            shape.lineTo(-ow / 2, -oh / 2);
            const hole = new T.Path();
            hole.moveTo(-iw / 2, -ih / 2);
            hole.lineTo(iw / 2, -ih / 2);
            hole.lineTo(iw / 2, ih / 2);
            hole.lineTo(-iw / 2, ih / 2);
            hole.lineTo(-iw / 2, -ih / 2);
            shape.holes.push(hole);
            const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
            g.translate(0, 0, -depth / 2);
            return g;
        }

        gSus = new T.BoxGeometry(1, 1, 1);
        gBeat = new T.BufferGeometry().setFromPoints(
            [new T.Vector3(0, 0, 0), new T.Vector3(1, 0, 0)],
        );
        // Tap chevron (open V pointing downward) — filled outline for extrusion into a solid mesh

        const chevronShape = new T.Shape();

        // Adjusting points for a "stubby" look
        // Width: increased to +/- 0.8 for a broader look
        // Height: capped at 0.2 to make it significantly shorter
        chevronShape.moveTo(-0.6, 0.3);   // Top left point (further out, lower down)
        chevronShape.lineTo(0, -0.1);     // Interior vertex (shallower V)
        chevronShape.lineTo(0.6, 0.3);    // Top right point (further out, lower down)

        chevronShape.lineTo(0.8, 0.0);    // Right outer thickness point
        chevronShape.lineTo(0, -0.3);     // Bottom vertex / Outer point (less deep)
        chevronShape.lineTo(-0.8, 0.0);   // Left outer thickness point

        chevronShape.closePath();

        // Create the 3D mesh geometry with a small depth
        gTapChevron = new T.ExtrudeGeometry(chevronShape, {
            depth: 0.04 * K,
            bevelEnabled: false,
        });

        // Optional: Center the geometry if the pivot point feels off
        gTapChevron.computeBoundingBox();
        const centerOffset = -0.5 * (gTapChevron.boundingBox.max.y + gTapChevron.boundingBox.min.y);
        gTapChevron.translate(0, centerOffset, 0);

        // String materials. Strings 0..5 use a per-vertex gradient (color is
        // white so the gradient baked into gNoteGrad[s] shows pure); strings
        // 6/7 keep a flat colour (vertexColors:false ignores the attribute).
        mStr = activePalette.map((c, i) => new T.MeshBasicMaterial({
            color: i < 6 ? 0xffffff : c,
            vertexColors: i < 6,
            transparent: true, opacity: 1.0,
        }));
        mGlow = activePalette.map(c => new T.MeshLambertMaterial({
            color: 0xffffff, emissive: c, emissiveIntensity: 1.5,
            transparent: true, opacity: 1.0, depthWrite: false,
        }));
        _laneTargetColor = new T.Color(0x4488ff);
        mSus = activePalette.map(c => new T.MeshLambertMaterial({
            color: c, transparent: true, opacity: 0.35,
        }));
        mWhiteOutline = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, transparent: true, opacity: 1.0, depthWrite: false });
        const _outlineColors = [0xFF5552, 0xFFF352, 0x31CAFF, 0xFFAE31, 0x84FF42, 0xE639FF];
        const _outlinePalette = activePalette.map((c, i) => _outlineColors[i] ?? c);
        mStrHitOutline = _outlinePalette.map(c => new T.MeshLambertMaterial({
            color: c, emissive: c, emissiveIntensity: 1.0,
            transparent: true, opacity: 1.0, depthWrite: false,
        }));
        // Stronger coloured rim + body for accented notes (.ac); drawNote swaps these in behind ND hit/miss.
        mAccentOutline = activePalette.map(c => new T.MeshLambertMaterial({
            color: c, emissive: c, emissiveIntensity: ACCENT_RIM_BASE_EMISSIVE,
            transparent: true, opacity: 1.0, depthWrite: false,
        }));
        // Same colour response as mGlow (vibrancy lerp) but separate emissive drive for extra accent punch.
        mAccentCore = activePalette.map(c => new T.MeshLambertMaterial({
            color: 0xffffff, emissive: c, emissiveIntensity: 1.5,
            transparent: true, opacity: 1.0, depthWrite: false,
        }));
        const mkAccentHaloMats = (baseOp) => activePalette.map(c => new T.MeshBasicMaterial({
            color: new T.Color(c),
            transparent: true,
            opacity: baseOp,
            depthWrite: false,
            depthTest: true,
            blending: T.AdditiveBlending,
            side: T.DoubleSide, forceSinglePass: true,
            fog: true,
        }));
        mAccentHaloNear = mkAccentHaloMats(ACCENT_HALO_OP_NEAR);
        mAccentHaloMid = mkAccentHaloMats(ACCENT_HALO_OP_MID);
        mAccentHaloFar = mkAccentHaloMats(ACCENT_HALO_OP_FAR);
        // Frozen per-string shell descriptors — see _accentShellsByString
        // declaration. Materials live for the renderer's lifetime, so
        // these refs stay valid until teardown() clears them.
        _accentShellsByString = mAccentHaloFar.map((_, s) => Object.freeze([
            Object.freeze({ mat: mAccentHaloFar[s],  ixy: ACCENT_HALO_XY_OUTER, iz: ACCENT_HALO_Z_OUTER, zK: 0.012 }),
            Object.freeze({ mat: mAccentHaloMid[s],  ixy: ACCENT_HALO_XY_MID,   iz: ACCENT_HALO_Z_MID,   zK: 0.008 }),
            Object.freeze({ mat: mAccentHaloNear[s], ixy: ACCENT_HALO_XY_INNER, iz: ACCENT_HALO_Z_INNER, zK: 0.005 }),
        ]));
        // Chord/arpeggio frame accent bloom — single gradient bar geometry.
        // The 4 bloom shells (expand=1.00/1.10/1.25/1.45, op=0.90/0.65/0.38/0.18)
        // are baked into vertex colours as their additive sum at each Y level,
        // so one mesh per bar replaces 4 per-shell meshes (16→4 draw calls/chord).
        // Normalised Y = ±(expand / EXPAND_MAX); EXPAND_MAX = 1.45.
        // Values > 1.0 in the Float32Array buffer are intentional: WebGL passes
        // them to the shader unchanged, and additive blending clips naturally.
        if (!gHaloBar) {
            // Y levels (normalised): ±(shell_expand / 1.45)
            //   ±0.690 = shell 1 edge  ±0.759 = shell 2  ±0.862 = shell 3  ±1.0 = shell 4
            // Brightness = additive sum of all shells covering that band:
            //   |y| < 0.690 → all 4: 0.90+0.65+0.38+0.18 = 2.11
            //   |y| < 0.759 → 3 shells: 0.65+0.38+0.18 = 1.21
            //   |y| < 0.862 → 2 shells: 0.38+0.18 = 0.56
            //   |y| ≤ 1.000 → shell 4 only: 0.18
            // prettier-ignore
            const YS = [-1.000, -0.862, -0.759, -0.690,  0.690, 0.759, 0.862, 1.000];
            // prettier-ignore
            const BS = [ 0.18,   0.56,   1.21,   2.11,   2.11,  1.21,  0.56,  0.18 ];
            const N = YS.length;
            const pos = new Float32Array(N * 2 * 3);
            const col = new Float32Array(N * 2 * 3);
            const idx = new Uint16Array((N - 1) * 6);
            for (let i = 0; i < N; i++) {
                const y = YS[i], b = BS[i];
                const li = (i * 2 + 0) * 3, ri = (i * 2 + 1) * 3;
                pos[li]=-1; pos[li+1]=y; pos[li+2]=0;
                col[li]=b;  col[li+1]=b; col[li+2]=b;
                pos[ri]=+1; pos[ri+1]=y; pos[ri+2]=0;
                col[ri]=b;  col[ri+1]=b; col[ri+2]=b;
            }
            for (let i = 0; i < N - 1; i++) {
                const ii = i * 6, v = i * 2;
                idx[ii+0]=v+0; idx[ii+1]=v+1; idx[ii+2]=v+3;
                idx[ii+3]=v+0; idx[ii+4]=v+3; idx[ii+5]=v+2;
            }
            gHaloBar = new T.BufferGeometry();
            gHaloBar.setAttribute('position', new T.BufferAttribute(pos, 3));
            gHaloBar.setAttribute('color',    new T.BufferAttribute(col, 3));
            gHaloBar.setIndex(new T.BufferAttribute(idx, 1));
        }
        pHaloBar = pool(noteG, () => new T.Mesh(
            gHaloBar,
            new T.MeshBasicMaterial({
                vertexColors: true,
                transparent: true, opacity: 1.0, depthWrite: false,
                blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true, fog: false,
            }),
        ));
        // Notedetect feedback outline (issue #9): hot magenta-red (0xff0066, hue
        // ~345°) — distinct from the string red 0xff2828 at hue ~0°. Note rendering
        // swaps its outline.material between mWhiteOutline / per-string
        // mHitBright[s] / mMissOutline based on recent notedetect events.
        mMissOutline = new T.MeshLambertMaterial({ color: 0xff0066, emissive: 0xff0066, emissiveIntensity: 1.2, transparent: true, opacity: 1.0, depthWrite: false });
        // Transparent placeholder for front (+Z, group 4) and back (-Z, group 5)
        // of the lateral face-fill material array. Also the default material for
        // the pNoteEdge pool: pool consumers reassign .material before render, so
        // the placeholder is never displayed — using an explicitly-invisible
        // material makes that intent obvious.
        // BoxGeometry group order: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z(front), 5=-Z(back)
        mEdgeTransparent = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
        // mMissEdgeArrays: use mMissOutline (same Lambert+emissive material as the gem
        // border) so the lateral face fill matches the outline colour exactly.
        mMissEdgeArrays = [mMissOutline, mMissOutline, mMissOutline, mMissOutline, mEdgeTransparent, mEdgeTransparent];

        // Hit: fixed neon spring-green on every string — 0x22ff88 is cyan-shifted
        // enough to be readable even on the green string (0x30d040). The outline
        // + lateral faces flash green regardless of which string was hit.
        mHitBright = activePalette.map(() => new T.MeshLambertMaterial({
            color: 0x22ff88, emissive: 0x22ff88, emissiveIntensity: 4.0 * glowMul,
            transparent: true, opacity: 1.0, depthWrite: false,
        }));
        mHitBrightArrays = mHitBright.map(m => [m, m, m, m, mEdgeTransparent, mEdgeTransparent]);
        // Readability (#2 / charrette): the note gems + their outlines punch THROUGH
        // the distance fog so upcoming notes stay legible as they render in at the
        // horizon. The board, lane, sustains and background scenery keep their
        // atmospheric fog — only the note-defining materials are exempted, so the
        // highway still reads as deep while the notes never dissolve into the haze.
        [mWhiteOutline, mMissOutline].forEach(m => { if (m) m.fog = false; });
        [mStr, mGlow, mStrHitOutline, mHitBright].forEach(arr => arr && arr.forEach(m => { if (m) m.fog = false; }));
        // Outline materials render at a lower renderOrder than the body.
        // The body is rendered on top with opacity:1 on hit/miss, which
        // fully covers the outline center — only the fringe that extends
        // past the body edges (0.2*K on each side) is visible.
        mSusOutline     = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3, transparent: true, opacity: 0.75, depthWrite: false });
        mHitSusOutline  = new T.MeshLambertMaterial({ color: 0x22ff88, emissive: 0x22ff88, emissiveIntensity: 0.8, transparent: true, opacity: 0.45, depthWrite: false });
        mBeatM = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
        mBeatQ = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });

        // ── Board ghost: filled rim (ExtrudeGeometry w/ hole) in string colour ──
        // Matches outline 1.1× vs core 1.0× like drawNote; centre stays empty.
        // 3 slots per string (up to 3 simultaneous ghost previews, chart-
        // format style): slot 0 is the "next on string" / chord / arp ghost
        // (unchanged selection logic), slots 1/2 are independent
        // "upcoming" lead-note previews. All slots share one geometry —
        // it's identical (NW/NH/ND-based) regardless of string or slot,
        // so one ExtrudeGeometry serves all nStr*3 meshes.
        const _ghostFrameGeo = mkGhostFrameGeometry();
        projMeshArr = activePalette.map((_, s) => [0, 1, 2].map(() => {
            const mat = new T.MeshStandardMaterial({
                color: activePalette[s],
                emissive: activePalette[s],
                emissiveIntensity: 0.002,
                transparent: true,
                opacity: 0.65,
                roughness: 1,
                depthWrite: false,
                depthTest: false,
            });
            const m = new T.Mesh(_ghostFrameGeo, mat);
            m.visible = false;
            // Board projection ghost frame. depthTest:false above, so
            // renderOrder alone decides stacking — keep it above the
            // sus trails (12/13) but below note gems (20/21) so it
            // stays visible on the fretboard without covering notes.
            m.renderOrder = 14;
            noteG.add(m);
            return m;
        }));

        // ── Pools ──────────────────────────────────────────────────────
        pNote = pool(noteG, () => new T.Mesh(gNote, mStr[0]));
        // Pool default is the always-invisible mEdgeTransparent — every
        // consumer reassigns .material before render (to a verdict edge
        // material array), so the placeholder is never displayed.
        pNoteEdge = pool(noteG, () => new T.Mesh(gNote, mEdgeTransparent));
        pAccentHalo = pool(noteG, () => new T.Mesh(gNote, mAccentHaloFar[0]));
        pSus = pool(noteG, () => new T.Mesh(gSus, mSus[0]));
        pSusOutline = pool(noteG, () => new T.Mesh(gSus, mSusOutline));
        const mkSlideRibbonGeo = () => {
            const nVert = 4 * (SLIDE_RIBBON_SAMPLES + 1);
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(nVert * 3), 3));
            // SLIDE_RIBBON_INDICES_ARR is the plain-Array form (see module-init
            // comment) shared across pool meshes; setIndex() rewraps it into a
            // fresh Uint16BufferAttribute per geometry, so the share is safe.
            g.setIndex(SLIDE_RIBBON_INDICES_ARR);
            // Static cross-section normals: each ring is an axis-aligned quad,
            // so vertex normals point radially in the XY plane regardless of
            // the slide's Z-direction curvature. Pre-fill once and skip the
            // per-frame computeVertexNormals() pass that previously ran on
            // every sustained-slide update (Copilot perf finding on PR #215).
            const SQRT_HALF = Math.SQRT1_2;
            const normals = new Float32Array(nVert * 3);
            for (let k = 0; k <= SLIDE_RIBBON_SAMPLES; k++) {
                const o = k * 12;
                // v0 (-X,-Y), v1 (+X,-Y), v2 (+X,+Y), v3 (-X,+Y)
                normals[o]     = -SQRT_HALF; normals[o + 1]  = -SQRT_HALF; normals[o + 2]  = 0;
                normals[o + 3] =  SQRT_HALF; normals[o + 4]  = -SQRT_HALF; normals[o + 5]  = 0;
                normals[o + 6] =  SQRT_HALF; normals[o + 7]  =  SQRT_HALF; normals[o + 8]  = 0;
                normals[o + 9] = -SQRT_HALF; normals[o + 10] =  SQRT_HALF; normals[o + 11] = 0;
            }
            g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
            return g;
        };
        // Ribbon meshes mutate vertex positions every frame in
        // slideRibbonUpdatePositions but the mesh itself stays at (0,0,0)
        // and the geometry's bounding sphere is never recomputed. With
        // frustum culling on, Three.js tests the (0,0,0)-centred bounds
        // and culls the ribbon as soon as the camera pans away from world
        // origin, so slides flicker in/out. Disable culling on these
        // meshes — the ribbon footprint is small and they're already
        // gated by t0/t1 reachability before render.
        pSusRibbon = pool(noteG, () => {
            const m = new T.Mesh(mkSlideRibbonGeo(), mSus[0]);
            m.frustumCulled = false;
            return m;
        });
        pSusRibbonOl = pool(noteG, () => {
            const m = new T.Mesh(mkSlideRibbonGeo(), mSusOutline);
            m.frustumCulled = false;
            m.renderOrder = -3;
            return m;
        });
        // One shared material per technique-mesh type. The pool factory
        // hands out fresh meshes that all reference the same material,
        // so a dense HO/PO passage doesn't churn N MeshLambertMaterial
        // allocations and N GPU material switches.
        // Transparent + no depth write/test so the tap chevron draws in
        // the transparent pass where drawNote assigns renderOrder 1000.
        mTapChevron = new T.MeshLambertMaterial({
            color: 0xd4d4d4,
            emissive: 0xd4d4d4,
            emissiveIntensity: 0.9,
            transparent: true,
            opacity: 0.85,
            side: T.DoubleSide, forceSinglePass: true,
            depthWrite: false,
            depthTest: false,
        });
        pTapChevron = pool(noteG, () => new T.Mesh(gTapChevron, mTapChevron));
        pLbl  = pool(lblG,  () => new T.Sprite(txtMat('0', '#fff', false, 'technique')));
        pBeat = pool(beatG, () => new T.Line(gBeat, mBeatQ));
        pSec  = pool(lblG,  () => new T.Sprite(txtMat('', '#0dd', true, 'section')));

        // Chord sustain length indicator — thin horizontal plane rails.
        // Unit plane (1×1 in XZ) laid flat; scaled to (railWidth, 1, railLen).
        // A horizontal plane seen from the camera looking down-forward is
        // face-on and has real apparent thickness — unlike T.Line (always 1px).
        // depthTest:false so they never occlude gems; renderOrder 11 places
        // them above lane dividers (2) and chord fill (10), at the same level
        // as chord frame edges (11), and BELOW sustain trails (12/13), note
        // gems (dynamic ≥50), and arp brackets (18). The bloom halo (10) sits
        // behind the core rail (11). Keeping susrail behind note sus trails
        // prevents the rail border from covering individual note tails
        // (sustain/vibrato/tremolo/bend). (Was 14/16 which rendered on top of
        // 12/13 sus trails, causing the outer border to overlap tails.)
        gSusRail = new T.PlaneGeometry(1, 1);
        gSusRail.rotateX(-Math.PI / 2); // lay flat in XZ plane
        mSusRailBase = new T.MeshBasicMaterial({
            color: CHORD_BOX_TEAL_HEX,
            transparent: true, opacity: 0.85,
            depthTest: false, depthWrite: false,
            fog: false, side: T.DoubleSide, forceSinglePass: true,
        });
        pSusRail = pool(noteG, () => {
            const m = new T.Mesh(gSusRail, mSusRailBase.clone());
            m.renderOrder = 5; // below strings (7) so strings render on top
            return m;
        });

        // Bloom glow for chord sustain rails — wider plane with a gaussian
        // falloff texture (bright centre → transparent edges in X direction)
        // and additive blending, so it brightens whatever is behind it.
        // renderOrder 4 places it behind the core rail (5).
        _bloomGaussTex = _makeGaussTex(T);
        gSusRailBloom = new T.PlaneGeometry(1, 1);
        gSusRailBloom.rotateX(-Math.PI / 2);
        mSusRailBloomBase = new T.MeshBasicMaterial({
            color: CHORD_BOX_TEAL_HEX,
            map: _bloomGaussTex,
            transparent: true, opacity: 0.55,
            blending: T.AdditiveBlending,
            depthTest: false, depthWrite: false,
            fog: false, side: T.DoubleSide, forceSinglePass: true,
        });
        pSusRailBloom = pool(noteG, () => {
            const m = new T.Mesh(gSusRailBloom, mSusRailBloomBase.clone());
            m.renderOrder = 4; // below strings (7) so strings render on top
            return m;
        });

        // Rotatable plane pool for technique markers (pm, mt, hm, hp, H/P, bend).
        // Unlike T.Sprite, a PlaneGeometry mesh accepts rotation.z = approachRot
        // so markers stay coplanar with the gem as it tilts from vertical to flat.
        gTechPlane = new T.PlaneGeometry(1, 1);
        pTechPlane = pool(noteG, () => {
            const m = new T.Mesh(gTechPlane, new T.MeshBasicMaterial({
                transparent: true, depthTest: false, depthWrite: false, side: T.DoubleSide, forceSinglePass: true,
            }));
            m.renderOrder = 1000;
            return m;
        });

        // ── InstancedMesh temporaries ──────────────────────────────────────
        _imM4    = new T.Matrix4();
        _imPos   = new T.Vector3();
        _imSca   = new T.Vector3();
        _imQ     = new T.Quaternion();
        _imAZ    = new T.Vector3(0, 0, 1);
        _imColor = new T.Color();

        // ── Shared ShaderMaterial templates ───────────────────────────────
        // Vertex shader used by PM-X and FH-X on individual note gems.
        // Three.js injects `USE_INSTANCING` + `instanceMatrix` attribute
        // into the prefix when an InstancedMesh uses a ShaderMaterial.
        const _imTechVert = [
            'attribute float instanceAlpha;',
            'varying float vAlpha;',
            'varying vec2 vUv;',
            'void main() {',
            '    vUv = uv;',
            '    vAlpha = instanceAlpha;',
            '    vec4 pos = vec4(position, 1.0);',
            '    #ifdef USE_INSTANCING',
            '    pos = instanceMatrix * pos;',
            '    #endif',
            '    gl_Position = projectionMatrix * modelViewMatrix * pos;',
            '}',
        ].join('\n');
        const _imTechFrag = [
            'uniform sampler2D map;',
            'varying float vAlpha;',
            'varying vec2 vUv;',
            'void main() {',
            '    vec4 t = texture2D(map, vUv);',
            '    if (t.a * vAlpha < 0.01) discard;',
            '    gl_FragColor = vec4(t.rgb, t.a * vAlpha);',
            '}',
        ].join('\n');

        // ── PM / FH tech marker InstancedMeshes ───────────────────────────
        // Each IM gets a geometry clone so instanceAlpha is a separate buffer.
        const _mkTechIM = (spriteMat, alphaArr) => {
            const geo = gTechPlane.clone();
            const alphaAttr = new T.InstancedBufferAttribute(alphaArr, 1);
            alphaAttr.setUsage(T.DynamicDrawUsage);
            geo.setAttribute('instanceAlpha', alphaAttr);
            const mat = new T.ShaderMaterial({
                uniforms: { map: { value: spriteMat.map } },
                vertexShader: _imTechVert,
                fragmentShader: _imTechFrag,
                transparent: true, depthTest: false, depthWrite: false, side: T.DoubleSide, forceSinglePass: true,
            });
            const im = new T.InstancedMesh(geo, mat, IM_TECH_CAP);
            im.instanceMatrix.setUsage(T.DynamicDrawUsage);
            im.frustumCulled = false;
            im.count = 0;
            noteG.add(im);
            return { im, geo, mat };
        };
        { const r = _mkTechIM(palmMuteXSpriteMat(),    _imPMTechAlphaArr);
          imPMTech = r.im; _imGPMTech = r.geo; _imPMTechMat = r.mat; imPMTech.renderOrder = 702; }
        { const r = _mkTechIM(fretHandMuteXSpriteMat(), _imFHTechAlphaArr);
          imFHTech = r.im; _imGFHTech = r.geo; _imFHTechMat = r.mat; imFHTech.renderOrder = 700; }

        // Dynamic fret number labels (heat-coloured, updated each frame)
        pFretLbl = pool(lblG, () => new T.Sprite(txtMat('0', '#888', false, 'fretRow')));

        // Highlight lane plane over active fret range. With the anchor-driven
        // segmented lanes we render up to fret-count × HWY_LANE_TIME_SLICES (96)
        // pLane meshes per frame, so:
        //   - geometry is a shared PlaneGeometry(1,1) (was per-mesh, never differed)
        //   - 2 shared MeshBasicMaterials (odd / even stripe colour) replace the
        //     per-mesh material clones; the per-frame opacity still travels via
        //     the materials but is set once outside the inner loop, not per-mesh.
        gLanePlane = new T.PlaneGeometry(1, 1);
        mLaneOdd = new T.MeshBasicMaterial({
            color: HWY_LANE_STRIPE_ODD_HEX, transparent: true, opacity: 0, depthWrite: false,
        });
        mLaneEven = new T.MeshBasicMaterial({
            color: HWY_LANE_STRIPE_EVEN_HEX, transparent: true, opacity: 0, depthWrite: false,
        });
        // Tracked for explicit disposal in teardown — these materials may
        // not be reachable via scene.traverse() if no lane was ever rendered.
        _ownedSharedMats.push(mLaneOdd, mLaneEven);
        _ownedSharedGeos.push(gLanePlane);
        pLane = pool(noteG, () => new T.Mesh(gLanePlane, mLaneOdd));

        gGhostFretPlane = new T.PlaneGeometry(1, 1);
        _ownedSharedGeos.push(gGhostFretPlane);
        const mGhostFretLblPh = new T.MeshBasicMaterial({
            color: 0xffffff, transparent: true, depthTest: false, depthWrite: false,
        });
        _ownedSharedMats.push(mGhostFretLblPh);
        pGhostFretLbl = pool(noteG, () => {
            const m = new T.Mesh(gGhostFretPlane, mGhostFretLblPh);
            // Must be above the proj frame (renderOrder=14) and opaque
            // geometry — same contract as technique labels (renderOrder=1000):
            // depthTest:false alone is insufficient, renderOrder=1000 needed.
            m.renderOrder = 1000;
            m.frustumCulled = false;
            return m;
        });

        // Vertical fret dividers within active lane
        const gLaneDivider = new T.BoxGeometry(0.15 * K, 0.15 * K, 1);
        mLaneDivider = new T.MeshBasicMaterial({
            color: 0x46DDE6, transparent: true, opacity: 1.00, fog: false, depthWrite: false,
        });
        mLaneDividerArp = new T.MeshBasicMaterial({
            color: ARPEGGIO_RIM_BLUE_HEX,
            transparent: true, opacity: 0.08, fog: false, depthWrite: false,
        });
        mLaneDividerExt = new T.MeshBasicMaterial({
            color: 0x364D5F, transparent: true, opacity: 0.4, fog: false, depthWrite: false,
        });
        _ownedSharedMats.push(mLaneDivider, mLaneDividerArp, mLaneDividerExt);
        pLaneDivider = pool(noteG, () => new T.Mesh(gLaneDivider, mLaneDivider));

        // Chord frame palette (frame alpha 128, fill gradient alpha 32; MeshBasic).
        const chR = CHORD_BOX_TEAL_HEX >> 16 & 255;
        const chG = CHORD_BOX_TEAL_HEX >> 8 & 255;
        const chB = CHORD_BOX_TEAL_HEX & 255;
        const dkR = CHORD_BOX_TEAL_DARK_HEX >> 16 & 255;
        const dkG = CHORD_BOX_TEAL_DARK_HEX >> 8 & 255;
        const dkB = CHORD_BOX_TEAL_DARK_HEX & 255;
        const aFill = Math.round(CHORD_BOX_FILL_GRAD_ALPHA * 255);
        chordFrameGradTex = new T.DataTexture(
            new Uint8Array([ chR, chG, chB, aFill, dkR, dkG, dkB, aFill, chR, chG, chB, aFill ]),
            3, 1, T.RGBAFormat);
        chordFrameGradTex.magFilter = T.LinearFilter;
        chordFrameGradTex.minFilter = T.LinearFilter;
        chordFrameGradTex.wrapS = T.ClampToEdgeWrapping;
        chordFrameGradTex.wrapT = T.ClampToEdgeWrapping;
        // DataTexture defaults to linear color space; flag this gradient
        // as sRGB so the chord-box hex values match other sRGB color textures.
        chordFrameGradTex.colorSpace = T.SRGBColorSpace;
        chordFrameGradTex.needsUpdate = true;

        const arR = ARPEGGIO_BOX_BLUE_HEX >> 16 & 255;
        const arG = ARPEGGIO_BOX_BLUE_HEX >> 8 & 255;
        const arB = ARPEGGIO_BOX_BLUE_HEX & 255;
        const arDR = ARPEGGIO_BOX_BLUE_DARK_HEX >> 16 & 255;
        const arDG = ARPEGGIO_BOX_BLUE_DARK_HEX >> 8 & 255;
        const arDB = ARPEGGIO_BOX_BLUE_DARK_HEX & 255;
        chordFrameGradTexArp = new T.DataTexture(
            new Uint8Array([ arR, arG, arB, aFill, arDR, arDG, arDB, aFill, arR, arG, arB, aFill ]),
            3, 1, T.RGBAFormat);
        chordFrameGradTexArp.magFilter = T.LinearFilter;
        chordFrameGradTexArp.minFilter = T.LinearFilter;
        chordFrameGradTexArp.wrapS = T.ClampToEdgeWrapping;
        chordFrameGradTexArp.wrapT = T.ClampToEdgeWrapping;
        chordFrameGradTexArp.colorSpace = T.SRGBColorSpace;
        chordFrameGradTexArp.needsUpdate = true;

        pChordFrameFill = pool(noteG, () => new T.Mesh(
            new T.PlaneGeometry(1, 1),
            new T.MeshBasicMaterial({
                map: chordFrameGradTex,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                depthTest: false,
                fog: false,
                side: T.DoubleSide, forceSinglePass: true,
            }),
        ));
        pChordBox = pool(noteG, () => new T.Mesh(
            new T.BoxGeometry(1, 1, 1),
            new T.MeshBasicMaterial({
                color: CHORD_BOX_TEAL_HEX,
                transparent: true,
                opacity: CHORD_BOX_EDGE_ALPHA,
                depthWrite: false,
                depthTest: false,
                fog: false,
                side: T.DoubleSide, forceSinglePass: true,
            }),
        ));

        // PM strum X fill — 4 corner regions + centre; the 4 arms (L,R,T,B) are left empty.
        // 16 vertices, 14 triangles.
        //  0=A(-1,1)  1=TLC(-0.48,1)  2=T(-0.012,0.257)  3=TRC(0.5,1)
        //  4=BR(1,1)  5=REB(1,0.5)   6=R(0.476,-0.011)  7=RET(1,-0.5)
        //  8=C(1,-1)  9=BRC(0.48,-1) 10=B(-0.003,-0.276) 11=BLC(-0.48,-1)
        // 12=D(-1,-1) 13=LET(-1,-0.5) 14=L(-0.494,-0.011) 15=LEB(-1,0.5)
        {
            // prettier-ignore
            const pos = new Float32Array([
                -1,      1,      0,  //  0  A
                -0.480,  1,      0,  //  1  TLC
                -0.012,  0.257,  0,  //  2  T
                 0.500,  1,      0,  //  3  TRC
                 1,      1,      0,  //  4  BR
                 1,      0.5,    0,  //  5  REB
                 0.476, -0.011,  0,  //  6  R
                 1,     -0.5,    0,  //  7  RET
                 1,     -1,      0,  //  8  C
                 0.480, -1,      0,  //  9  BRC
                -0.003, -0.276,  0,  // 10  B
                -0.480, -1,      0,  // 11  BLC
                -1,     -1,      0,  // 12  D
                -1,     -0.5,    0,  // 13  LET
                -0.494, -0.011,  0,  // 14  L
                -1,      0.5,    0,  // 15  LEB
            ]);
            // prettier-ignore
            const idx = new Uint16Array([
                // top-left corner: A,TLC,T,L,LEB
                 0,  1,  2,
                 0,  2, 14,
                 0, 14, 15,
                // top-right corner: TRC,BR,REB,R,T
                 3,  4,  5,
                 3,  5,  6,
                 3,  6,  2,
                // centre: T,R,B,L
                 2,  6, 10,
                 2, 10, 14,
                // bottom-right corner: RET,C,BRC,B,R
                 7,  8,  9,
                 7,  9, 10,
                 7, 10,  6,
                // bottom-left corner: LET,L,B,BLC,D
                13, 14, 10,
                13, 10, 11,
                13, 11, 12,
            ]);
            gPMXFill = new T.BufferGeometry();
            gPMXFill.setAttribute('position', new T.BufferAttribute(pos, 3));
            gPMXFill.setIndex(new T.BufferAttribute(idx, 1));
        }
        // PM fill — InstancedMesh (black, varying alpha per chord).
        {
            const _imFillVert = [
                'attribute float instanceAlpha;',
                'varying float vAlpha;',
                'void main() {',
                '    vAlpha = instanceAlpha;',
                '    vec4 pos = vec4(position, 1.0);',
                '    #ifdef USE_INSTANCING',
                '    pos = instanceMatrix * pos;',
                '    #endif',
                '    gl_Position = projectionMatrix * modelViewMatrix * pos;',
                '}',
            ].join('\n');
            const _imFillFrag = [
                'varying float vAlpha;',
                'void main() {',
                '    if (vAlpha <= 0.0) discard;',
                '    gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha);',
                '}',
            ].join('\n');
            const alphaAttr = new T.InstancedBufferAttribute(_imPMXFillAlphaArr, 1);
            alphaAttr.setUsage(T.DynamicDrawUsage);
            gPMXFill.setAttribute('instanceAlpha', alphaAttr);
            _imPMXFillMat = new T.ShaderMaterial({
                vertexShader: _imFillVert, fragmentShader: _imFillFrag,
                transparent: true, depthTest: false, depthWrite: false,
                fog: false, side: T.DoubleSide, forceSinglePass: true,
            });
            imPMXFill = new T.InstancedMesh(gPMXFill, _imPMXFillMat, IM_STRUM_CAP);
            imPMXFill.instanceMatrix.setUsage(T.DynamicDrawUsage);
            imPMXFill.frustumCulled = false;
            imPMXFill.renderOrder = 10.5;
            imPMXFill.count = 0;
            noteG.add(imPMXFill);
        }

        // FH (frethand mute) strum X fill — 5 regions: 4 corner quadrants + centre diamond.
        // 12 vertices, 10 triangles. L/R wings stop at fx=±0.50 (no solid lateral blocks).
        //  0=LET(-0.50,+1)  1=TLC(-0.15,+1)  2=T(0,+0.42)   3=TRC(+0.15,+1)
        //  4=RET(+0.50,+1)  5=REB(+0.50,-1)  6=R(+0.28,0)   7=B(0,-0.42)
        //  8=BRC(+0.15,-1)  9=BLC(-0.15,-1) 10=LEB(-0.50,-1) 11=L(-0.28,0)
        {
            // prettier-ignore
            const pos = new Float32Array([
                -0.50,  1,      0,  //  0  LET
                -0.15,  1,      0,  //  1  TLC
                 0,     0.42,   0,  //  2  T
                 0.15,  1,      0,  //  3  TRC
                 0.50,  1,      0,  //  4  RET
                 0.50, -1,      0,  //  5  REB
                 0.28,  0,      0,  //  6  R
                 0,    -0.42,   0,  //  7  B
                 0.15, -1,      0,  //  8  BRC
                -0.15, -1,      0,  //  9  BLC
                -0.50, -1,      0,  // 10  LEB
                -0.28,  0,      0,  // 11  L
            ]);
            // prettier-ignore
            const idx = new Uint16Array([
                // top-left corner: LET,TLC,T,L
                 0,  1,  2,
                 0,  2, 11,
                // top-right corner: TRC,RET,R,T
                 3,  4,  6,
                 3,  6,  2,
                // bottom-right corner: REB,R,B,BRC
                 5,  6,  7,
                 5,  7,  8,
                // bottom-left corner: LEB,L,B,BLC
                10, 11,  7,
                10,  7,  9,
                // centre diamond: L,T,R,B
                11,  2,  6,
                11,  6,  7,
            ]);
            gFHXFill = new T.BufferGeometry();
            gFHXFill.setAttribute('position', new T.BufferAttribute(pos, 3));
            gFHXFill.setIndex(new T.BufferAttribute(idx, 1));
        }
        // FH fill — InstancedMesh (black, varying alpha per chord).
        {
            const _imFillVert = [
                'attribute float instanceAlpha;',
                'varying float vAlpha;',
                'void main() {',
                '    vAlpha = instanceAlpha;',
                '    vec4 pos = vec4(position, 1.0);',
                '    #ifdef USE_INSTANCING',
                '    pos = instanceMatrix * pos;',
                '    #endif',
                '    gl_Position = projectionMatrix * modelViewMatrix * pos;',
                '}',
            ].join('\n');
            const _imFillFrag = [
                'varying float vAlpha;',
                'void main() {',
                '    if (vAlpha <= 0.0) discard;',
                '    gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha);',
                '}',
            ].join('\n');
            const alphaAttr = new T.InstancedBufferAttribute(_imFHXFillAlphaArr, 1);
            alphaAttr.setUsage(T.DynamicDrawUsage);
            gFHXFill.setAttribute('instanceAlpha', alphaAttr);
            _imFHXFillMat = new T.ShaderMaterial({
                vertexShader: _imFillVert, fragmentShader: _imFillFrag,
                transparent: true, depthTest: false, depthWrite: false,
                fog: false, side: T.DoubleSide, forceSinglePass: true,
            });
            imFHXFill = new T.InstancedMesh(gFHXFill, _imFHXFillMat, IM_STRUM_CAP);
            imFHXFill.instanceMatrix.setUsage(T.DynamicDrawUsage);
            imFHXFill.frustumCulled = false;
            imFHXFill.renderOrder = 10.5;
            imFHXFill.count = 0;
            noteG.add(imFHXFill);
        }

        // PM X lines — 8 segments baked as thin quads in ±1 normalised space.
        // Scale the pool mesh by (innerW*0.5, -innerH*0.5, ...) per chord;
        // the Y-negated scale matches the XLINES convention (fya>0 = below centre).
        if (!gPMXLines) {
            const HT = 0.016; // normalised half-thickness ≈ lw/hH for a typical chord
            // prettier-ignore
            const XLINES = [
                [-1.000, -0.500, -0.494, -0.011],
                [-1.000,  0.500, -0.494, -0.011],
                [ 1.000, -0.500,  0.476, -0.011],
                [ 1.000,  0.500,  0.476, -0.011],
                [-0.480,  1.000, -0.012,  0.257],
                [ 0.500,  1.000, -0.012,  0.257],
                [ 0.480, -1.000,  0.000, -0.276],
                [-0.480, -1.000, -0.006, -0.276],
            ];
            const pos = new Float32Array(XLINES.length * 4 * 3);
            const idx = new Uint16Array(XLINES.length * 6);
            for (let i = 0; i < XLINES.length; i++) {
                const [xa, ya, xb, yb] = XLINES[i];
                const dx = xb - xa, dy = yb - ya;
                const il = 1 / Math.sqrt(dx * dx + dy * dy);
                const nx = -dy * il, ny = dx * il;
                const vi = i * 12, ii = i * 6, vb = i * 4;
                pos[vi+0]=xa+nx*HT; pos[vi+1]=ya+ny*HT; pos[vi+2]=0;
                pos[vi+3]=xb+nx*HT; pos[vi+4]=yb+ny*HT; pos[vi+5]=0;
                pos[vi+6]=xb-nx*HT; pos[vi+7]=yb-ny*HT; pos[vi+8]=0;
                pos[vi+9]=xa-nx*HT; pos[vi+10]=ya-ny*HT; pos[vi+11]=0;
                idx[ii+0]=vb;   idx[ii+1]=vb+1; idx[ii+2]=vb+2;
                idx[ii+3]=vb;   idx[ii+4]=vb+2; idx[ii+5]=vb+3;
            }
            gPMXLines = new T.BufferGeometry();
            gPMXLines.setAttribute('position', new T.BufferAttribute(pos, 3));
            gPMXLines.setIndex(new T.BufferAttribute(idx, 1));
        }
        // PM lines — InstancedMesh (varying color + alpha per chord).
        // instanceColor (THREE built-in) carries baseRimHex per instance;
        // instanceAlpha carries the per-chord opacity.
        {
            const _imLinesVert = [
                'attribute float instanceAlpha;',
                'varying float vAlpha;',
                'varying vec3 vColor;',
                'void main() {',
                '    vAlpha = instanceAlpha;',
                '    #ifdef USE_INSTANCING_COLOR',
                '    vColor = instanceColor;',
                '    #else',
                '    vColor = vec3(1.0);',
                '    #endif',
                '    vec4 pos = vec4(position, 1.0);',
                '    #ifdef USE_INSTANCING',
                '    pos = instanceMatrix * pos;',
                '    #endif',
                '    gl_Position = projectionMatrix * modelViewMatrix * pos;',
                '}',
            ].join('\n');
            const _imLinesFrag = [
                'varying float vAlpha;',
                'varying vec3 vColor;',
                'void main() {',
                '    if (vAlpha <= 0.0) discard;',
                '    gl_FragColor = vec4(vColor, vAlpha);',
                '}',
            ].join('\n');
            const alphaAttr = new T.InstancedBufferAttribute(_imPMXLinesAlphaArr, 1);
            alphaAttr.setUsage(T.DynamicDrawUsage);
            gPMXLines.setAttribute('instanceAlpha', alphaAttr);
            _imPMXLinesMat = new T.ShaderMaterial({
                vertexShader: _imLinesVert, fragmentShader: _imLinesFrag,
                transparent: true, depthTest: false, depthWrite: false,
                fog: false, side: T.DoubleSide, forceSinglePass: true,
            });
            imPMXLines = new T.InstancedMesh(gPMXLines, _imPMXLinesMat, IM_STRUM_CAP);
            imPMXLines.instanceMatrix.setUsage(T.DynamicDrawUsage);
            imPMXLines.frustumCulled = false;
            imPMXLines.renderOrder = 11;
            // Eagerly initialise instanceColor so USE_INSTANCING_COLOR is
            // defined when the shader is compiled on the first draw.
            _imColor.set(1, 1, 1);
            imPMXLines.setColorAt(0, _imColor);
            imPMXLines.instanceColor.setUsage(T.DynamicDrawUsage);
            imPMXLines.count = 0;
            noteG.add(imPMXLines);
        }

        // FH X lines — same scheme, 8 segments from the FH_XLINES pattern
        if (!gFHXLines) {
            const HT = 0.022; // slightly wider — FH wings are shorter, need more visual weight
            // prettier-ignore
            const FH_XLINES = [
                [-0.50,  1.00, -0.28,  0.00],
                [-0.50, -1.00, -0.28,  0.00],
                [ 0.50,  1.00,  0.28,  0.00],
                [ 0.50, -1.00,  0.28,  0.00],
                [-0.15, -1.00,  0.00, -0.42],
                [ 0.15, -1.00,  0.00, -0.42],
                [ 0.15,  1.00,  0.00,  0.42],
                [-0.15,  1.00,  0.00,  0.42],
            ];
            const pos = new Float32Array(FH_XLINES.length * 4 * 3);
            const idx = new Uint16Array(FH_XLINES.length * 6);
            for (let i = 0; i < FH_XLINES.length; i++) {
                const [xa, ya, xb, yb] = FH_XLINES[i];
                const dx = xb - xa, dy = yb - ya;
                const il = 1 / Math.sqrt(dx * dx + dy * dy);
                const nx = -dy * il, ny = dx * il;
                const vi = i * 12, ii = i * 6, vb = i * 4;
                pos[vi+0]=xa+nx*HT; pos[vi+1]=ya+ny*HT; pos[vi+2]=0;
                pos[vi+3]=xb+nx*HT; pos[vi+4]=yb+ny*HT; pos[vi+5]=0;
                pos[vi+6]=xb-nx*HT; pos[vi+7]=yb-ny*HT; pos[vi+8]=0;
                pos[vi+9]=xa-nx*HT; pos[vi+10]=ya-ny*HT; pos[vi+11]=0;
                idx[ii+0]=vb;   idx[ii+1]=vb+1; idx[ii+2]=vb+2;
                idx[ii+3]=vb;   idx[ii+4]=vb+2; idx[ii+5]=vb+3;
            }
            gFHXLines = new T.BufferGeometry();
            gFHXLines.setAttribute('position', new T.BufferAttribute(pos, 3));
            gFHXLines.setIndex(new T.BufferAttribute(idx, 1));
        }
        // FH lines — InstancedMesh (varying color + alpha per chord).
        {
            const _imLinesVert = [
                'attribute float instanceAlpha;',
                'varying float vAlpha;',
                'varying vec3 vColor;',
                'void main() {',
                '    vAlpha = instanceAlpha;',
                '    #ifdef USE_INSTANCING_COLOR',
                '    vColor = instanceColor;',
                '    #else',
                '    vColor = vec3(1.0);',
                '    #endif',
                '    vec4 pos = vec4(position, 1.0);',
                '    #ifdef USE_INSTANCING',
                '    pos = instanceMatrix * pos;',
                '    #endif',
                '    gl_Position = projectionMatrix * modelViewMatrix * pos;',
                '}',
            ].join('\n');
            const _imLinesFrag = [
                'varying float vAlpha;',
                'varying vec3 vColor;',
                'void main() {',
                '    if (vAlpha <= 0.0) discard;',
                '    gl_FragColor = vec4(vColor, vAlpha);',
                '}',
            ].join('\n');
            const alphaAttr = new T.InstancedBufferAttribute(_imFHXLinesAlphaArr, 1);
            alphaAttr.setUsage(T.DynamicDrawUsage);
            gFHXLines.setAttribute('instanceAlpha', alphaAttr);
            _imFHXLinesMat = new T.ShaderMaterial({
                vertexShader: _imLinesVert, fragmentShader: _imLinesFrag,
                transparent: true, depthTest: false, depthWrite: false,
                fog: false, side: T.DoubleSide, forceSinglePass: true,
            });
            imFHXLines = new T.InstancedMesh(gFHXLines, _imFHXLinesMat, IM_STRUM_CAP);
            imFHXLines.instanceMatrix.setUsage(T.DynamicDrawUsage);
            imFHXLines.frustumCulled = false;
            imFHXLines.renderOrder = 11;
            _imColor.set(1, 1, 1);
            imFHXLines.setColorAt(0, _imColor);
            imFHXLines.instanceColor.setUsage(T.DynamicDrawUsage);
            imFHXLines.count = 0;
            noteG.add(imFHXLines);
        }

        // Pool-based strum-indicator replacements.  The IM approach above uses
        // a fixed renderOrder per mesh type, which lets far-chord X marks overdraw
        // gems/frames of nearer chords. Pools give per-chord Z-proportional renderOrder.
        // Geometries are shared with the (now empty) IMs — MeshBasicMaterial
        // ignores the instanceAlpha / instanceColor attributes on the geometry.
        pPMXFill = pool(noteG, () => new T.Mesh(
            gPMXFill,
            new T.MeshBasicMaterial({
                color: 0x000000, transparent: true, opacity: 1,
                depthWrite: false, depthTest: false, fog: false, side: T.DoubleSide, forceSinglePass: true,
            }),
        ));
        pFHXFill = pool(noteG, () => new T.Mesh(
            gFHXFill,
            new T.MeshBasicMaterial({
                color: 0x000000, transparent: true, opacity: 1,
                depthWrite: false, depthTest: false, fog: false, side: T.DoubleSide, forceSinglePass: true,
            }),
        ));
        pMuteXLines = pool(noteG, () => new T.Mesh(
            gPMXLines,
            new T.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 1,
                depthWrite: false, depthTest: false, fog: false, side: T.DoubleSide, forceSinglePass: true,
            }),
        ));
        pFHXLines = pool(noteG, () => new T.Mesh(
            gFHXLines,
            new T.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 1,
                depthWrite: false, depthTest: false, fog: false, side: T.DoubleSide, forceSinglePass: true,
            }),
        ));

        pChordLbl   = pool(lblG,  () => new T.Sprite(txtMat('', '#e8d080', true, 'chord').clone()));
        // Single shared barre material — all pool meshes reference it,
        // so _applyGlow() can mutate emissiveIntensity once and every
        // recycled / future-allocated barre mesh picks up the change.
        mBarre = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9 * glowMul, transparent: true, depthWrite: false });
        pBarreLine  = pool(noteG, () => new T.Mesh(new T.BoxGeometry(1, 1, 1), mBarre));
        // Shared 1×1×1 box geometry — brackets can require many pooled
        // meshes per frame, so per-mesh BoxGeometry allocation would
        // duplicate buffers and create unnecessary GPU disposal work.
        // Disposed once in teardown (alongside the other shared geos).
        if (!gArpBracket) gArpBracket = new T.BoxGeometry(1, 1, 1);
        pArpBracket = pool(noteG, () => new T.Mesh(
            gArpBracket,
            new T.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 1.0,
                depthWrite: false,
                depthTest: false,
                fog: false,
            }),
        ));

        // Per-note fret number below note with connector line
        pNoteFretLabel = pool(lblG, () => {
            const _nfl = new T.Sprite(txtMat('0', FRET_LABEL_GOLD_HEX, false, 'noteFret').clone());
            _nfl.material.fog = false;
            _nfl.material.depthTest = false;
            return _nfl;
        });
        // Teaching marks fg/sd labels (§6.2.2). One pool, two get()s per note
        // (finger + degree); the texture is swapped per draw via material.map.
        pTeachMarkLbl = pool(lblG, () => {
            const _tml = new T.Sprite(txtMat('0', '#7fd1ff', false, 'teachMark').clone());
            _tml.material.fog = false;
            _tml.material.depthTest = false;
            return _tml;
        });
        pConnectorLine = pool(noteG, () => new T.Line(
            new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0)]),
            new T.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.5, depthTest: false }),
        ));
        pDropLine = pool(noteG, () => new T.Line(
            new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0)]),
            new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
        ));

        // Fret-column reference markers (visual cue for X-position to fret-number).
        // Each sprite gets its own clone so the per-frame material.map swap
        // (dark vs light grey) doesn't poison neighbours sharing the same
        // cached texture map.
        // fog:false prevents the scene fog from gradually dimming the sprite
        // as it enters the far end of the highway — opacity is managed
        // manually with a short fade-in so the number appears at its
        // final size the moment it becomes visible rather than seeming to
        // emerge from a tiny dim spec at the horizon.
        pFretColMarker = pool(lblG, () => {
            const _sp = new T.Sprite(txtMat('0', '#666666', false, 'noteFret').clone());
            // fog=false: prevents scene fog from dimming the sprite as it enters the
            // far end of the highway.  Opacity is managed by the manual fade-in ramp
            // so the number appears smoothly instead of emerging as a dim spec.
            _sp.material.fog = false;
            return _sp;
        });

        // ── Pre-warm pools (feedBack#226) ─────────────────────────────
        // Dense 7/8-string charts can outrun the lazy-grow path in the
        // first 1-2s of playback, stalling those frames with `new T.Mesh`
        // allocations *and* growing noteG forever (the pool only hides on
        // reset). Pay the cost up front instead.
        //
        // Trade-off: pre-warming attaches the same meshes to noteG even
        // on 4/6-string charts that may never use them all. The cost is
        // paid at boardInit (during the load spinner — wall-clock time
        // users were already waiting on), so the steady-state win on
        // playback FPS is worth the init-time scene-graph footprint.
        // Caps sized for a typical visible-window worst case (NOT the
        // theoretical max across MAX_RENDER_STRINGS); lazy growth past
        // the warm cap still works for genuinely dense outliers.
        const _WARM_NOTE = 48;
        const _WARM_CHORD = 12;
        const _WARM_LANE = 32;
        const _WARM_BEAT = 24;
        pNote.warm(_WARM_NOTE);
        pNoteEdge.warm(_WARM_NOTE);
        pAccentHalo.warm(_WARM_NOTE);
        pSus.warm(_WARM_NOTE);
        pSusOutline.warm(_WARM_NOTE);
        pSusRibbon.warm(_WARM_NOTE / 2);
        pSusRibbonOl.warm(_WARM_NOTE / 2);
        pTapChevron.warm(_WARM_CHORD);
        pLbl.warm(_WARM_NOTE);
        pSusRail.warm(_WARM_CHORD);
        pSusRailBloom.warm(_WARM_CHORD);
        pTechPlane.warm(_WARM_CHORD);
        pNoteFretLabel.warm(_WARM_NOTE);
        pTeachMarkLbl.warm(_WARM_NOTE);
        pChordFrameFill.warm(_WARM_CHORD);
        pChordBox.warm(_WARM_CHORD);
        pChordLbl.warm(_WARM_CHORD);
        pBarreLine.warm(_WARM_CHORD);
        pArpBracket.warm(_WARM_CHORD);
        pHaloBar.warm(_WARM_CHORD);
        pFretLbl.warm(_WARM_LANE);
        pLane.warm(_WARM_LANE * 2);  // anchor-driven lanes × time slices
        pLaneDivider.warm(_WARM_LANE);
        pGhostFretLbl.warm(_WARM_LANE);
        pFretColMarker.warm(_WARM_LANE);
        pConnectorLine.warm(_WARM_NOTE / 2);
        pDropLine.warm(_WARM_NOTE / 2);
        pBeat.warm(_WARM_BEAT);
        pSec.warm(8);

        _bgLoadSettings();
        buildBoard();
        // Apply the scene color theme now that settings + board exist. Sets
        // the clear color + fog tint (board plane was themed in buildBoard).
        // For the default theme this is identical to the hardcoded values
        // initScene seeded above, so nothing changes for existing users.
        _applyBgTheme();

        // Background animations (#13). Read settings keyed by this
        // panel and mount the active style's meshes. Subscribe to
        // in-app settings changes (settings.html via window.h3dBgSet*)
        // so they propagate without a reload. Manual localStorage
        // edits don't fire the pub-sub and require a reload.
        // Push the freshly-loaded vibrancy/glow values into the
        // materials. _bgLoadSettings only triggers a palette re-apply
        // when the palette ID actually changed, so a fresh-init user
        // on the default palette would otherwise keep the hardcoded
        // construction-time material values until they touched a
        // slider.
        _applyVibrancy();
        _applyGlow();
        // inlayLabelsVisible was applied before buildBoard() via _bgLoadSettings.
        bgGroup = new T.Group();
        // Note: renderOrder on a Group is a no-op (Three.js Groups
        // are transforms, not rendered objects, so renderOrder only
        // affects the actual meshes inside). _bgMountStyle stamps
        // renderOrder = -1 on every child after build, which IS what
        // forces background to render before gameplay geometry.
        // Combined with the deeper-than-note-range placements below,
        // background never paints over notes.
        scene.add(bgGroup);
        _bgMountStyle();
        _bgListener = (changedKey) => {
            if (changedKey === 'fretSpacing') {
                // _h3dFretUniform + the fretX-derived scalars were already
                // updated globally in h3dSetFretSpacing. Rebuild this
                // panel's static board geometry (fret wires, lanes, inlays)
                // so it re-lays-out for the new spacing; per-frame note
                // geometry reads fretX live and needs no rebuild.
                if (fretG) buildBoard();
                return;
            }
            if (changedKey === 'inlayLabelsVisible') {
                _bgLoadSettings();
                // Flip visibility on the already-built sprites; no
                // need to rebuild the board (cheaper, preserves the
                // shared materials and avoids palette re-apply churn).
                for (const lbl of _inlayLabels) lbl.visible = inlayLabelsVisible;
                return;
            }
            if (changedKey === 'nutHeadstockVisible') {
                _bgLoadSettings();
                if (nutHeadstockGroup) nutHeadstockGroup.visible = nutHeadstockVisible;
                return;
            }
            if (changedKey === 'tuningLabelsVisible') {
                _bgLoadSettings();
                _lastOpenStringLblSig = '';
                if (_tuningLabelSprites.length) _disposeOpenStringPitchSprites();
                return;
            }
            if (changedKey === 'nutColor' || changedKey === 'headstockColor') {
                _bgLoadSettings();
                if (fretG) buildBoard();
                for (const lbl of _inlayLabels) lbl.visible = inlayLabelsVisible;
                return;
            }
            if (changedKey === 'reactive' || changedKey === 'showFretOnNote' ||
                changedKey === 'fretNumberGhostScope' ||
                changedKey === 'cameraSmoothing' || changedKey === 'zoomSmoothing' ||
                changedKey === 'tiltSmoothing' || changedKey === 'cameraLockLow' ||
                changedKey === 'cameraLockZoom' || changedKey === 'cameraMode' ||
                changedKey === 'textSize' ||
                changedKey === 'chordDiagramSize' || changedKey === 'chordDiagramPosition' ||
                changedKey === 'fretColumnMarkerCadence' ||
                changedKey === 'sectionLabelsOnHighway' ||
                changedKey === 'sectionHudVisible' ||
                changedKey === 'sectionHudPosition' ||
                changedKey === 'sectionHudSize' ||
                changedKey === 'toneHudVisible' ||
                changedKey === 'toneHudPosition' ||
                changedKey === 'toneHudSize' ||
                changedKey === 'projectionVisible' ||
                changedKey === 'slideArrowApproachVisible' ||
                changedKey === 'slideArrowNeckVisible' ||
                changedKey === 'slideArrowChainPreviewVisible') {
                // Flag flips don't need a mesh rebuild — just refresh
                // the per-instance state for the next frame to consult.
                // Same shape for showFretOnNote (#12), cameraSmoothing
                // (#34), the zoom/tilt smoothing follow-ups, and
                // cameraLockLow — all read per-frame in update() /
                // camUpdate().
                _bgLoadSettings();
                return;
            }
            if (changedKey === 'vibrancy') {
                _bgLoadSettings();
                _applyVibrancy();
                return;
            }
            if (changedKey === 'glow') {
                _bgLoadSettings();
                _applyGlow();
                return;
            }
            if (changedKey === 'palette') {
                // Palette change has three effects:
                //  1. _bgLoadSettings -> _applyPaletteToMaterials
                //     retints the per-instance shared materials
                //     (notes, glows, sustain trails, projection).
                //  2. buildBoard rebuilds the fretboard meshes
                //     (LineBasicMaterial lane lines + per-string
                //     BoxGeometry materials). These are created at
                //     build time with palette-baked colors and
                //     aren't reachable from _applyPaletteToMaterials.
                //  3. lights bg style bakes palette colors into
                //     sprite quads at build time, so it needs a
                //     full mesh rebuild — fire _bgRebuild when
                //     that style is active.
                _bgLoadSettings();
                if (fretG) buildBoard();
                if (bgStyleId === 'lights') _bgRebuild();
                return;
            }
            if (changedKey === 'bgTheme' || changedKey === 'hwTheme') {
                // A scene-color axis changed (background = bgTheme:
                // clear+fog; highway = hwTheme: board plane + lane). Recolor
                // in place — no mesh rebuild needed (the board plane material
                // is mutated via _boardPlaneMat, the lane via mLaneOdd/Even).
                // _applyBgTheme reapplies both axes from their own keys, so
                // changing one dropdown retints only its half.
                _bgLoadSettings();
                _applyBgTheme();
                return;
            }
            if (changedKey === 'customImageDataUrl') {
                // Asset bytes changed. Rebuild only when the image
                // style is active — otherwise the new bytes will
                // pick up next time the user picks `image`.
                _bgLoadSettings();
                if (bgStyleId === 'image') _bgRebuild();
                return;
            }
            if (changedKey === 'customImageName') {
                // Display-only metadata; no mesh rebuild.
                _bgLoadSettings();
                return;
            }
            if (changedKey === 'customVideoName') {
                // Filename change → new <video> source. Rebuild
                // only when the video style is currently active;
                // otherwise the new bytes pick up next time the
                // user picks `video`.
                _bgLoadSettings();
                if (bgStyleId === 'video') _bgRebuild();
                return;
            }
            if (changedKey === 'intensity') {
                _bgLoadSettings();
                // Image style reads s.intensity per frame inside
                // update() to scale the drift speed, so a live
                // mutation is enough — no need to tear down and
                // re-decode the texture for every slider change.
                // The procedural styles bake intensity into mesh
                // count, opacity, and size at build time, so they
                // still need a full rebuild.
                if (bgStyleId === 'image' && bgState) {
                    bgState.intensity = bgIntensity;
                    return;
                }
                _bgRebuild();
                return;
            }
            if (changedKey === 'venueScene') {
                _bgRebuild();
                return;
            }
            if (changedKey === 'venueInstrumentPov') {
                if (_bgEffectiveStyleId() === 'venue' && bgState) {
                    _venueSwapPlateIfNeeded(bgState);
                }
                return;
            }
            if (!changedKey || changedKey === 'style') {
                _bgRebuild();
            }
        };
        _bgSubscribe(_bgListener);

        // Notedetect feedback (#9). Listen for hit/miss events on
        // window. Notedetect dispatches both globally and on its
        // instanceRoot; the global fire is fine for our case since
        // each 3dhighway panel just stores any event into its own
        // queue and renders only the matching note. Listeners are
        // per-panel so destroy() can cleanly remove them; cost is
        // a per-event branch + push, negligible vs per-frame work.
        // Validate every payload field we'll later compare against
        // chart-data fields (s, f, t). drawNote compares with
        // Math.abs(m.noteTime - n.t) and trusts the values are
        // finite, so reject any payload missing one of those
        // fields here rather than letting bogus data into the
        // arrays. Prune expired marks on every push so the arrays
        // settle back to empty when notedetect stops emitting —
        // drawNote's fast-path short-circuit
        // (`if (_ndHitMarks.length || _ndMissMarks.length)`) only
        // works if expired entries don't linger.
        const _ndNormalizeMark = (d) => {
            if (!d) return null;
            const note = d.note || d.chartNote;
            if (!note) return null;
            if (!Number.isFinite(note.s) || !Number.isFinite(note.f) || !Number.isFinite(d.noteTime)) return null;
            const labels = [];
            if (d.timingState && d.timingState !== 'OK' && Number.isFinite(d.timingError)) {
                labels.push({
                    text: `${d.timingState === 'EARLY' ? '↑' : '↓'} ${d.timingError > 0 ? '+' : ''}${d.timingError}ms`,
                    color: '#ffb347',
                });
            }
            if (d.pitchState && d.pitchState !== 'OK' && Number.isFinite(d.pitchError)) {
                labels.push({
                    text: `${d.pitchState === 'SHARP' ? '♯' : '♭'} ${d.pitchError > 0 ? '+' : ''}${d.pitchError}¢`,
                    color: '#66c7ff',
                });
            }
            return { s: note.s, f: note.f, noteTime: d.noteTime, labels, timingState: d.timingState || null };
        };
        const _ndPushMark = (arr, d) => {
            const mark = _ndNormalizeMark(d);
            if (!mark) return arr;
            const now = performance.now();
            // Prune expired entries unconditionally. The dedupe path
            // below can extend expiresAt of any entry (including arr[0]),
            // so an arr[0] gate is not reliable — it would prevent
            // pruning entries that expired behind a refreshed front
            // entry, allowing the array to grow unbounded. These arrays
            // are tiny (a handful of marks at most), so an unconditional
            // filter() is negligible and always correct.
            if (arr.length !== 0) {
                const live = arr.filter(m => m.expiresAt > now);
                arr.length = 0;
                if (live.length) arr.push(...live);
            }
            const existing = arr.find(m =>
                m.s === mark.s && m.f === mark.f && Math.abs(m.noteTime - mark.noteTime) < _ND_TIME_EPS
            );
            if (existing) {
                existing.labels = mark.labels.length ? mark.labels : existing.labels;
                existing.expiresAt = Math.max(existing.expiresAt, now + _ND_TTL_MS);
                return arr;
            }
            arr.push({ ...mark, expiresAt: now + _ND_TTL_MS });
            return arr;
        };
        _ndOnHit = (e) => { _ndHitMarks = _ndPushMark(_ndHitMarks, e.detail); };
        _ndOnMiss = (e) => { _ndMissMarks = _ndPushMark(_ndMissMarks, e.detail); };
        window.addEventListener('notedetect:hit', _ndOnHit);
        window.addEventListener('notedetect:miss', _ndOnMiss);
        if (window.feedBack &&
                typeof window.feedBack.on  === 'function' &&
                typeof window.feedBack.off === 'function') {
            _ndOnBusHit  = (e) => { _ndHitMarks  = _ndPushMark(_ndHitMarks,  e.detail); };
            _ndOnBusMiss = (e) => { _ndMissMarks = _ndPushMark(_ndMissMarks, e.detail); };
            window.feedBack.on('note:hit', _ndOnBusHit);
            window.feedBack.on('note:miss', _ndOnBusMiss);
        }

        // Score FX (notedetect ≥1.13). notedetect dispatches each fx
        // detail object twice in the same task: first explicitly on
        // window (unscoped), then as a bubbling CustomEvent from its
        // per-panel instanceRoot (scoped). Element-targeted copies are
        // authoritative — accept only the ones whose root lives in this
        // panel's container. The window copy is DEFERRED a task: by the
        // time it runs, the element copy (same detail reference) has
        // either arrived — making the window copy a duplicate to drop —
        // or it never will (detector root not attached to the DOM), in
        // which case the window copy is the compat fallback. This keeps
        // splitscreen panels from rendering each other's FX even for
        // the first event of a session.
        _fxResolvePalette();
        _fxOnFx = (e) => {
            const d = e && e.detail;
            if (!d) return;
            const t = e.target;
            if (t && t.parentElement) {
                _fxElemSeen.add(d);
                if (!highwayCanvas || !t.parentElement.contains(highwayCanvas)) return;
                _fxHandle(d);
                return;
            }
            const gen = _fxGen;
            setTimeout(() => {
                if (gen !== _fxGen) return;   // torn down (or re-inited) meanwhile
                if (_fxElemSeen.has(d)) return;
                _fxHandle(d);
            }, 0);
        };
        window.addEventListener('notedetect:fx', _fxOnFx);
        if (window.feedBack && typeof window.feedBack.on === 'function'
                && typeof window.feedBack.off === 'function') {
            _fxOnSkin = () => _fxResolvePalette();
            window.feedBack.on('notedetect:skin', _fxOnSkin);
        }

        return true;
    }

    function _bgLoadSettings() {
        const panelKey = _bgPanelKey(highwayCanvas);
        bgStyleId = _bgReadSetting(panelKey, 'style');
        bgIntensity = _bgReadSetting(panelKey, 'intensity');
        bgReactive = _bgReadSetting(panelKey, 'reactive');
        // Per-render opt-out (captured from the mount bundle in init): force
        // the reactive background off for THIS instance, overriding the shared
        // setting without writing it back. Re-applied here so it sticks across
        // setting reloads.
        if (_bgReactiveOptOut) bgReactive = false;
        const newPaletteId = _bgReadSetting(panelKey, 'palette');
        let newPalette;
        if (newPaletteId === 'custom') {
            // Resolve user colors into the stable _customPalette array,
            // mutated in place so the reference identity is preserved.
            let stored = null;
            const raw = _bgReadSetting(panelKey, 'customColors');
            if (typeof raw === 'string') { try { stored = JSON.parse(raw); } catch (_) { /* corrupt */ } }
            for (let i = 0; i < _customPalette.length; i++) {
                const v = Array.isArray(stored) ? _h3dHexToInt(stored[i]) : null;
                _customPalette[i] = (v != null) ? v : PALETTES.default[i];
            }
            newPalette = _customPalette;
        } else {
            newPalette = PALETTES[newPaletteId] || PALETTES.default;
        }
        // Signature guards the in-place custom case: when the user edits a
        // color the reference stays === activePalette, so compare contents
        // too to force a retint. _bgPaletteSig caches the applied colors.
        const newSig = newPalette.join(',');
        if (newPalette !== activePalette || newSig !== _bgPaletteSig) {
            activePalette = newPalette;
            _bgPaletteSig = newSig;
            _applyPaletteToMaterials();
        }
        bgThemeId = _bgReadSetting(panelKey, 'bgTheme');
        // Highway axis. ONE-TIME BACKWARD-COMPAT BACKFILL: the first time we
        // load with no stored hwTheme (pre-split installs, or anyone who only
        // ever touched the old single "Scene colors" control), seed hwTheme
        // FROM the background pick AND PERSIST it, so an existing 'cathode'
        // selection looks byte-identical right after the upgrade. Persisting
        // immediately (rather than re-inheriting on every read) is what keeps
        // the two axes truly INDEPENDENT thereafter: once hwTheme is stored,
        // changing the Background dropdown no longer drags the Highway
        // surface along, and the settings UI's Highway value can never
        // disagree with what's rendered. Written without _bgEmitChange so the
        // backfill can't re-enter the change listener.
        if (_bgHasStored(panelKey, 'hwTheme')) {
            hwThemeId = _bgReadSetting(panelKey, 'hwTheme');
        } else {
            hwThemeId = bgThemeId;
            _bgMemFallback.hwTheme = String(bgThemeId);
            try { localStorage.setItem('h3d_bg_hwTheme', String(bgThemeId)); } catch (_) { /* storage blocked — mem fallback still seeds the read */ }
        }
        showFretOnNote = _bgReadSetting(panelKey, 'showFretOnNote');
        fretNumberGhostScope = _bgReadSetting(panelKey, 'fretNumberGhostScope');
        cameraSmoothing = _bgReadSetting(panelKey, 'cameraSmoothing');
        // Mirror-at-first-read: zoom + tilt sliders inherit cameraSmoothing
        // when the user has never explicitly written them. Once the user
        // moves either slider, the corresponding _bgHasStored() flips
        // true and the read becomes independent.
        zoomSmoothing = _bgHasStored(panelKey, 'zoomSmoothing')
            ? _bgReadSetting(panelKey, 'zoomSmoothing')
            : cameraSmoothing;
        tiltSmoothing = _bgHasStored(panelKey, 'tiltSmoothing')
            ? _bgReadSetting(panelKey, 'tiltSmoothing')
            : cameraSmoothing;
        cameraLockLow = _bgReadSetting(panelKey, 'cameraLockLow');
        cameraLockZoom = _bgReadSetting(panelKey, 'cameraLockZoom');
        cameraMode = _bgReadSetting(panelKey, 'cameraMode');
        textSize             = _bgReadSetting(panelKey, 'textSize');
        vibrancy             = _bgReadSetting(panelKey, 'vibrancy');
        glowMul              = _bgReadSetting(panelKey, 'glow');
        _hitFx               = _bgReadSetting(panelKey, 'hitFx');
        _sparks              = _bgReadSetting(panelKey, 'sparks');
        _cinematic           = _bgReadSetting(panelKey, 'cinematic');
        _verdictMarks        = _bgReadSetting(panelKey, 'verdictMarks');
        _timingFx            = _bgReadSetting(panelKey, 'timingFx');
        _streakFx            = _bgReadSetting(panelKey, 'streakFx');
        _bloom               = _bgReadSetting(panelKey, 'bloom');
        _applyCinematic();
        fpsVisible           = _bgReadSetting(panelKey, 'fpsVisible');
        fretDividersVisible  = _bgReadSetting(panelKey, 'fretDividersVisible');
        chordDiagramVisible  = _bgReadSetting(panelKey, 'chordDiagramVisible');
        chordDiagramSize     = _bgReadSetting(panelKey, 'chordDiagramSize');
        chordDiagramPosition = _bgReadSetting(panelKey, 'chordDiagramPosition');
        fretColumnMarkerCadence = _bgReadSetting(panelKey, 'fretColumnMarkerCadence');
        inlayLabelsVisible = _bgReadSetting(panelKey, 'inlayLabelsVisible');
        sectionLabelsOnHighway = _bgReadSetting(panelKey, 'sectionLabelsOnHighway');
        sectionHudVisible      = _bgReadSetting(panelKey, 'sectionHudVisible');
        sectionHudPosition     = _bgReadSetting(panelKey, 'sectionHudPosition');
        sectionHudSize         = _bgReadSetting(panelKey, 'sectionHudSize');
        toneHudVisible         = _bgReadSetting(panelKey, 'toneHudVisible');
        toneHudPosition        = _bgReadSetting(panelKey, 'toneHudPosition');
        toneHudSize            = _bgReadSetting(panelKey, 'toneHudSize');
        nutHeadstockVisible    = _bgReadSetting(panelKey, 'nutHeadstockVisible');
        tuningLabelsVisible    = _bgReadSetting(panelKey, 'tuningLabelsVisible');
        nutColor               = _bgReadSetting(panelKey, 'nutColor');
        headstockColor         = _bgReadSetting(panelKey, 'headstockColor');
        projectionVisible      = _bgReadSetting(panelKey, 'projectionVisible');
        slideArrowApproachVisible = _bgReadSetting(panelKey, 'slideArrowApproachVisible');
        slideArrowNeckVisible     = _bgReadSetting(panelKey, 'slideArrowNeckVisible');
        slideArrowChainPreviewVisible = _bgReadSetting(panelKey, 'slideArrowChainPreviewVisible');
        _vibrancyIdleOp = 0.4  + 0.6  * vibrancy;
        _vibrancyProjOp = 0.15 + 0.35 * vibrancy;
        // Custom image asset is a single GLOBAL slot — bytes are
        // shared across panels (per-panel choice is which style
        // each panel renders, not which asset). Reading via
        // _bgReadSetting would let a stray h3d_bg_panel<idx>_*
        // override silently re-introduce the per-panel asset
        // duplication this design deliberately avoids (and
        // h3dBgClearCustomImage wouldn't reach those overrides).
        // Read globals directly instead.
        //
        // Precedence: in-memory fallback BEFORE localStorage. The
        // setter always populates _bgMemFallback (even when the
        // localStorage write fails on quota), so the fallback
        // holds the most-recent staged value. Reading localStorage
        // first would mean a failed write leaves the renderer
        // pointed at the previous asset while settings.html shows
        // a "session-only" warning claiming the new bytes are in
        // effect — UI and renderer would silently disagree.
        const memDataUrl = _bgMemFallback.customImageDataUrl;
        const memName    = _bgMemFallback.customImageName;
        try {
            const gDataUrl = (memDataUrl !== undefined) ? memDataUrl : localStorage.getItem('h3d_bg_customImageDataUrl');
            const gName    = (memName    !== undefined) ? memName    : localStorage.getItem('h3d_bg_customImageName');
            bgCustomImageDataUrl = (gDataUrl != null) ? gDataUrl : BG_DEFAULTS.customImageDataUrl;
            bgCustomImageName    = (gName    != null) ? gName    : BG_DEFAULTS.customImageName;
        } catch (_) {
            bgCustomImageDataUrl = (memDataUrl !== undefined) ? memDataUrl : BG_DEFAULTS.customImageDataUrl;
            bgCustomImageName    = (memName    !== undefined) ? memName    : BG_DEFAULTS.customImageName;
        }
        // Custom video filename: also a single global slot, same
        // mem-first precedence as the image keys (a quota-failed
        // setItem leaves _bgMemFallback ahead of localStorage).
        const memVideoName = _bgMemFallback.customVideoName;
        try {
            const gVideoName = (memVideoName !== undefined) ? memVideoName : localStorage.getItem('h3d_bg_customVideoName');
            bgCustomVideoName = (gVideoName != null) ? gVideoName : BG_DEFAULTS.customVideoName;
        } catch (_) {
            bgCustomVideoName = (memVideoName !== undefined) ? memVideoName : BG_DEFAULTS.customVideoName;
        }
    }
    // Live-swap palette by mutating existing materials in place.
    // Three.js colors propagate to all sharing meshes on the next
    // render — no rebuild, no GC. The mGlow material was authored
    // with .color = white and the per-string color in .emissive
    // only; we preserve that here so the glow look stays consistent
    // before/after a palette swap rather than tinting the diffuse
    // white. Lane lines and drop lines that read
    // activePalette[s] per frame pick up automatically. Per-string
    // fretboard materials built inside buildBoard() are independent
    // and aren't reachable from here — buildBoard re-runs from the
    // palette listener to regenerate them with the new colors.
    //
    // projMeshArr holds filled rim meshes (ExtrudeGeometry frame); centre
    // is open. Palette + vibrancy mutate each mesh's material like mStr.
    function _applyPaletteToMaterials() {
        for (let s = 0; s < activePalette.length; s++) {
            const c = activePalette[s];
            if (mStr[s]) {
                // Gradient strings (0..5) keep a white base so the per-vertex
                // colours in gNoteGrad[s] show pure; only flat strings (6/7)
                // take the palette colour. mStr is MeshBasicMaterial (no
                // emissive) — guard the legacy emissive retint.
                if (s >= 6) mStr[s].color.setHex(c);
                if (mStr[s].emissive) mStr[s].emissive.setHex(c);
            }
            if (mGlow[s]) mGlow[s].emissive.setHex(c);
            if (mSus[s]) mSus[s].color.setHex(c);
            if (mStrHitOutline[s]) {
                mStrHitOutline[s].color.setHex(c);
                mStrHitOutline[s].emissive.setHex(c);
            }
            if (mAccentOutline[s]) {
                mAccentOutline[s].color.setHex(c);
                mAccentOutline[s].emissive.setHex(c);
            }
            if (mAccentCore[s]) mAccentCore[s].emissive.setHex(c);
            // Verdict materials use fixed colours (0x22ff88 hit, 0xff0066 miss)
            // that are independent of the string palette — no retint needed.
            for (const haloArr of [mAccentHaloNear, mAccentHaloMid, mAccentHaloFar]) {
                if (haloArr[s]) haloArr[s].color.setHex(c);
            }
            if (projMeshArr && projMeshArr[s]) {
                for (const pm of projMeshArr[s]) {
                    if (pm.material) {
                        pm.material.color.setHex(c);
                        pm.material.emissive.setHex(c);
                    }
                }
            }
        }
        // Per-string gem bodies (strings 0..5) are a baked per-vertex
        // gradient (gNoteGrad), not a flat material — recolor them too so a
        // custom palette reaches the note/sustain/vibrato gem bodies.
        _recolorGemGradients();
        // Re-apply vibrancy: mGlow's color is a lerp between white and
        // the palette colour, so a palette swap must rebuild that
        // lerp from the new endpoints. Skipped pre-init when mGlow
        // isn't allocated yet — _applyVibrancy() guards on that.
        _applyVibrancy();
    }

    // Recompute the per-vertex gem-gradient colors from the active palette.
    // Built-in palettes (and unchanged slots of a custom palette) keep the
    // hand-tuned DEFAULT_GEM_GRADIENTS stops so the stock look is preserved;
    // a custom slot derives a top-highlight / bottom-shade from its base
    // color. Mutates the existing 'color' attribute in place (no geometry
    // churn, pooled note meshes pick it up next frame).
    function _recolorGemGradients() {
        if (!T || !gNoteGrad || !gNoteGrad.length) return;
        const isCustom = (activePalette === _customPalette);
        const topCol = new T.Color(), botCol = new T.Color(), tmp = new T.Color();
        const halfH = NH / 2;
        for (let s = 0; s < gNoteGrad.length; s++) {
            const g = gNoteGrad[s];
            if (!g || !g.attributes || !g.attributes.color) continue;
            const base = activePalette[s];
            let topHex, botHex;
            if (isCustom && base !== PALETTES.default[s]) {
                // Match the SUBTLE stock gem shading (bottom ≈ 0.78 of a
                // near-base top), so a custom gem reads as a flat-ish gem
                // in the chosen color rather than a strong gradient.
                topHex = _lightenInt(base, 0.05);
                botHex = _darkenInt(base, 0.78);
            } else {
                const stops = DEFAULT_GEM_GRADIENTS[s];
                if (!stops) continue; // strings 6/7 have no gradient geometry
                topHex = stops[0];
                botHex = stops[1];
            }
            topCol.setHex(topHex);
            botCol.setHex(botHex);
            const pos = g.attributes.position;
            const colAttr = g.attributes.color;
            for (let i = 0; i < pos.count; i++) {
                const t = (pos.getY(i) + halfH) / (2 * halfH); // 0 bottom..1 top
                tmp.copy(botCol).lerp(topCol, t);
                colAttr.setXYZ(i, tmp.r, tmp.g, tmp.b);
            }
            colAttr.needsUpdate = true;
        }
    }

    // Vibrancy + glow live-update helpers. Both walk the same
    // material set _applyPaletteToMaterials walks (plus the static
    // outline / technique materials) and mutate uniform-backed
    // properties — colour, opacity, emissiveIntensity. No
    // material.needsUpdate flag is needed for these; Three.js
    // re-reads them on the next render call. mGlow.emissiveIntensity
    // and BASE_GLOW/MAX_GLOW/IDLE_OP are NOT written here — those
    // are stomped per-frame inside updateStringHighlights() and the
    // anticipation loop in update(), so they read glowMul /
    // _vibrancyIdleOp / vibrancy directly each frame instead.
    function _applyVibrancy() {
        const t = vibrancy;
        const idleOp     = 0.4  + 0.6  * t;  // mStr / IDLE_OP source
        // projIdleOp drives the projMeshArr ghost-frame opacity and is
        // read by drawNote() as `_vibrancyProjOp`, which layers a
        // per-frame factor on top.
        const projIdleOp = 0.15 + 0.35 * t;
        const susOp      = 0.35 + 0.45 * t;  // mSus
        const lineGlowOp = 0.15 + 0.35 * t;  // thin Line glow layer behind each string
        for (let s = 0; s < activePalette.length; s++) {
            if (mStr[s])  mStr[s].opacity  = idleOp;
            if (mSus[s])  mSus[s].opacity  = susOp;
            if (mGlow[s]) {
                // Hit-note body lerps from white (current pastel
                // look — colour comes through the emissive only)
                // toward the palette colour as vibrancy → 1, so at
                // vibrancy=1 the white-wash on hit notes goes away.
                if (!_paletteColorTmp && T) _paletteColorTmp = new T.Color();
                if (_paletteColorTmp) {
                    mGlow[s].color.setHex(0xffffff).lerp(_paletteColorTmp.setHex(activePalette[s]), t);
                }
            }
            if (mAccentCore[s]) {
                if (!_paletteColorTmp && T) _paletteColorTmp = new T.Color();
                if (_paletteColorTmp) {
                    mAccentCore[s].color.setHex(0xffffff).lerp(_paletteColorTmp.setHex(activePalette[s]), t);
                }
            }
            if (projMeshArr && projMeshArr[s]) {
                for (const pm of projMeshArr[s]) {
                    if (pm.material) pm.material.opacity = projIdleOp;
                }
            }
        }
        // stringLines[s].material.opacity is overwritten by
        // updateStringHighlights() every frame, so the closed-form
        // value would be stomped. updateStringHighlights() reads
        // _vibrancyIdleOp directly instead — keep that in sync.
        for (let s = 0; s < stringLineGlows.length; s++) {
            const line = stringLineGlows[s];
            if (line && line.material) line.material.opacity = lineGlowOp;
        }
        _vibrancyIdleOp = idleOp;
        _vibrancyProjOp = projIdleOp;
    }
    function _applyGlow() {
        const g = glowMul;
        for (let s = 0; s < activePalette.length; s++) {
            if (mStr[s])  mStr[s].emissiveIntensity  = 0.002 * g;
            // mGlow[s].emissiveIntensity is per-frame in update();
            // see Phase 4 comment block.
            if (projMeshArr && projMeshArr[s]) {
                for (const pm of projMeshArr[s]) {
                    if (pm.material) pm.material.emissiveIntensity = 0.002 * g;
                }
            }
            if (mStrHitOutline[s]) mStrHitOutline[s].emissiveIntensity = 1.0 * g;
            if (mAccentOutline[s]) mAccentOutline[s].emissiveIntensity = ACCENT_RIM_BASE_EMISSIVE * g;
            // mAccentCore[].emissiveIntensity is per-frame in update()
            // alongside mGlow (accent fill boost).
        }
        if (mWhiteOutline) mWhiteOutline.emissiveIntensity = 0.6 * g;
        if (mMissOutline)  mMissOutline.emissiveIntensity  = 1.2 * g;
        for (let s = 0; s < mHitBright.length; s++) {
            if (mHitBright[s]) mHitBright[s].emissiveIntensity = 4.0 * g;
        }
        if (mSusOutline)      mSusOutline.emissiveIntensity      = 0.3 * g;
        if (mHitSusOutline)   mHitSusOutline.emissiveIntensity   = 0.7 * g;
        if (mTapChevron)   mTapChevron.emissiveIntensity   = 0.9 * g;
        if (mBarre)        mBarre.emissiveIntensity        = 0.9 * g;
        for (let si = 0; si < activePalette.length; si++) {
            if (mAccentHaloNear[si]) mAccentHaloNear[si].opacity = ACCENT_HALO_OP_NEAR * g;
            if (mAccentHaloMid[si]) mAccentHaloMid[si].opacity = ACCENT_HALO_OP_MID * g;
            if (mAccentHaloFar[si]) mAccentHaloFar[si].opacity = ACCENT_HALO_OP_FAR * g;
        }
    }
    function _bgEffectiveStyleId() {
        return _venueSceneOverride ? 'venue' : bgStyleId;
    }
    function _bgMountStyle() {
        const effectiveId = _bgEffectiveStyleId();
        const style = BG_STYLES[effectiveId] || BG_STYLES.off;
        // Build into a fresh stage group so a partial throw can't
        // orphan meshes inside bgGroup. On success the stage joins
        // bgGroup atomically; on failure the stage and everything
        // in it are disposed and bgState stays null.
        const stage = new T.Group();
        let result = null;
        try {
            result = style.build(stage, {
                intensity: bgIntensity,
                palette: activePalette,
                customImageDataUrl: bgCustomImageDataUrl,
                customVideoName: bgCustomVideoName,
                cam: cam,
            }) || null;
        } catch (e) {
            console.error('[3D-Hwy] bg style build failed', effectiveId, e);
            _bgDisposeGroupTree(stage);
            bgState = null;
            bgStage = null;
            bgMountedStyleId = null;
            return;
        }
        // renderOrder on a Group doesn't propagate to its children
        // (Three.js sorts by per-object renderOrder, and a Group is a
        // transform, not a rendered object). Stamp every mesh in the
        // stage so transparent bg objects always sort behind notes
        // regardless of their z relative to gameplay geometry.
        stage.traverse((c) => { c.renderOrder = -1; });
        bgGroup.add(stage);
        bgStage = stage;
        bgState = result;
        bgMountedStyleId = effectiveId;
    }
    function _bgUnmountStyle() {
        const mountedId = bgMountedStyleId || _bgEffectiveStyleId();
        const style = BG_STYLES[mountedId] || BG_STYLES.off;
        try { style.teardown(bgState); } catch (e) { console.error('[3D-Hwy] bg teardown', e); }
        bgState = null;
        // Belt + suspenders: even if a style's teardown forgets to
        // dispose something, the stage tree dispose mops up.
        if (bgStage) {
            bgStage.parent?.remove(bgStage);
            _bgDisposeGroupTree(bgStage);
            bgStage = null;
        }
        bgMountedStyleId = null;
    }
    // Recursively dispose geometries / materials attached to an
    // Object3D tree, then detach. Used as a safety net during
    // _bgMountStyle failures and on _bgUnmountStyle.
    //
    // Deliberately does NOT dispose material.map textures — texture
    // lifetime belongs to whoever allocated the texture. The
    // silhouettes style allocates a per-layer CanvasTexture wrapping
    // the shared _silCanvas bitmap, and disposes those textures in
    // its own teardown. Disposing them here would double-dispose,
    // and any future plugin texture sharing across panels (e.g. an
    // upcoming custom-background feature) would break the same way.
    // Style teardown owns texture release.
    function _bgDisposeGroupTree(obj) {
        if (!obj) return;
        obj.traverse((child) => {
            child.geometry?.dispose?.();
            const mat = child.material;
            if (mat) {
                const mats = Array.isArray(mat) ? mat : [mat];
                for (const m of mats) m?.dispose?.();
            }
        });
        obj.parent?.remove(obj);
    }
    function _bgRebuild() {
        if (!bgGroup) return;
        // Order matters: teardown must run against the (style id,
        // state) pair that built the meshes, so unmount BEFORE
        // reloading settings. Reload, then mount with the new id.
        _bgUnmountStyle();
        _bgLoadSettings();
        _bgMountStyle();
        _bgApplyVenueSceneFog(_venueSceneOverride);
        // Reset dt accounting so the first frame after a switch
        // doesn't see a huge "since last update" window — that
        // would clamp to 0.1 and visibly snap motion / rotation.
        _bgLastT = 0;
    }
    // Venue-only fog/clear/ambient tuning — darker near field, less
    // washed-out gray haze over the playable highway. Restored when
    // venue deactivates.
    function _bgApplyVenueSceneFog(active) {
        if (!scene || !scene.fog) return;
        if (active) {
            scene.fog.color.setHex(0x080c12);
            scene.fog.near = FOG_START * 0.98;
            scene.fog.far = FOG_END * 0.98;
            if (ren) ren.setClearColor(0x080c12, 1);
            if (ambLight) ambLight.intensity = 0.68;
        } else {
            // Restore the user's scene-color theme (clear + fog) rather than
            // the old hardcoded gray, so deactivating venue doesn't wipe a
            // chosen background theme. _applyBgTheme reads the current theme.
            scene.fog.near = FOG_START * 0.8;
            scene.fog.far = FOG_END * 1.2;
            if (ambLight) ambLight.intensity = 0.85;
            _applyBgTheme();
        }
    }

    // Apply BOTH scene-color axes, each from its own setting key:
    //   • BACKGROUND (bgThemeId): the WebGL clear color + the distance-fog
    //     tint. Skipped while the venue scene is active (venue owns those —
    //     see _bgApplyVenueSceneFog).
    //   • HIGHWAY (hwThemeId): the fretboard/highway-surface plane + the lit
    //     highway lane strip (the bright quad under the gems) + its dimmer
    //     alternating row. Always themed; venue doesn't touch them.
    // The two axes are independent, so picking a different id in each mixes
    // freely. Safe to call any time; called from initScene, buildBoard, and
    // the scene-theme listener (so a live switch of EITHER dropdown retints
    // only its half immediately).
    //
    // The lane fields are OPTIONAL on a highway theme: one that omits `lane`
    // / `laneDim` falls back to the stock lit/dim lane hexes, so every
    // existing/neutral highway theme stays byte-identical (default blue lane
    // unchanged). Only colored highway themes opt into a coordinated lane.
    function _applyBgTheme() {
        // --- Background axis: clear + fog ---
        const bg = _bgBackgroundColors(bgThemeId);
        if (!_venueSceneOverride) {
            if (scene && scene.fog) scene.fog.color.setHex(bg.fog);
            if (ren) ren.setClearColor(bg.clear, 1);
        }
        // --- Highway axis: board plane + lane ---
        const hw = _bgHighwayColors(hwThemeId);
        if (_boardPlaneMat) _boardPlaneMat.color.setHex(hw.board);
        // Lit lane strip + its dimmer alternating row. Fall back to the
        // hardcoded stock lane colors when the highway theme omits them.
        const laneLit = (typeof hw.lane === 'number') ? hw.lane : HWY_LANE_STRIPE_ODD_HEX;
        const laneDim = (typeof hw.laneDim === 'number') ? hw.laneDim : HWY_LANE_STRIPE_EVEN_HEX;
        if (mLaneOdd) mLaneOdd.color.setHex(laneLit);
        if (mLaneEven) mLaneEven.color.setHex(laneDim);
        // Keep the (otherwise vestigial) lane target color in sync with the
        // lit lane so any future lane-blend consumer reads the themed value.
        if (_laneTargetColor) _laneTargetColor.setHex(laneLit);
        else _laneTargetColor = new T.Color(laneLit);
    }

    /* ── Fretboard (static geometry) ────────────────────────────────── */
    function _h3dHexOrDefault(hexStr, defHex) {
        const d = defHex || BG_DEFAULTS.nutColor;
        const s = (typeof hexStr === 'string' && /^#[0-9a-fA-F]{6}$/.test(hexStr.trim()))
            ? hexStr.trim().toLowerCase()
            : d;
        return parseInt(s.slice(1), 16);
    }
    // Cinematic lighting (#2): darken ambient so emissive gems have a dark
    // surround to pop against; strengthen the key light for modelling.
    // Toggle via the 'cinematic' setting so it's directly comparable.
    function _applyCinematic() {
        if (!ambLight || !dirLight) return;
        ambLight.intensity = _cinematic ? 0.45 : 0.85;
        dirLight.intensity = _cinematic ? 1.15 : 0.8;
    }
    // #5 early/late: tint the hit feedback by timing — on-time green, early cyan,
    // late amber. Falls back to green when timing is unknown (pure-provider path).
    function _timingHex(ts) {
        if (!_timingFx || !ts || ts === 'OK') return 0x22ff88;
        if (ts === 'EARLY') return 0x35d6ff;
        if (ts === 'LATE')  return 0xffb84d;
        return 0x22ff88;
    }
    function _sparkBurst(x, y, z, hex, count) {
        if (!_sparkPts || count <= 0) return;
        const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
        let made = 0;
        for (let i = 0; i < _SPARK_N && made < count; i++) {
            if (_sparkLife[i] > 0) continue;
            const j = i * 3, ang = Math.random() * Math.PI * 2, sp = (5 + Math.random() * 12) * K;
            _sparkPos[j] = x; _sparkPos[j + 1] = y; _sparkPos[j + 2] = z;
            _sparkVel[j] = Math.cos(ang) * sp; _sparkVel[j + 1] = (12 + Math.random() * 24) * K; _sparkVel[j + 2] = Math.sin(ang) * sp * 0.55;
            _sparkCol[j] = r; _sparkCol[j + 1] = g; _sparkCol[j + 2] = b;
            _sparkLife[i] = 0.30 + Math.random() * 0.16; made++;
        }
    }
    function _sparkUpdate(dt) {
        if (!_sparkPts) return;
        const grav = 55 * K; let any = false;
        for (let i = 0; i < _SPARK_N; i++) {
            if (_sparkLife[i] <= 0) continue;
            const j = i * 3;
            _sparkLife[i] -= dt;
            if (_sparkLife[i] <= 0) { _sparkCol[j] = _sparkCol[j + 1] = _sparkCol[j + 2] = 0; continue; }
            any = true;
            _sparkVel[j + 1] -= grav * dt;
            _sparkPos[j] += _sparkVel[j] * dt; _sparkPos[j + 1] += _sparkVel[j + 1] * dt; _sparkPos[j + 2] += _sparkVel[j + 2] * dt;
            const fade = 1 - Math.min(1, dt * 3.2);
            _sparkCol[j] *= fade; _sparkCol[j + 1] *= fade; _sparkCol[j + 2] *= fade;
        }
        _sparkPts.geometry.attributes.position.needsUpdate = true;
        _sparkPts.geometry.attributes.color.needsUpdate = true;
        _sparkPts.visible = any;
    }
    // #4 Bloom: lazy-load the vendored postprocessing addons and build an
    // EffectComposer (RenderPass -> UnrealBloomPass -> OutputPass/ACES). Returns
    // the composer once ready, or null (caller falls back to a direct render).
    function _bloomEnsure() {
        if (_composer) return _composer;
        if (_bloomLoad || !ren || !scene || !cam) return null;
        const A = '/static/vendor/three/addons/';
        _bloomLoad = Promise.all([
            import(A + 'postprocessing/EffectComposer.js'),
            import(A + 'postprocessing/RenderPass.js'),
            import(A + 'postprocessing/UnrealBloomPass.js'),
            import(A + 'postprocessing/OutputPass.js'),
        ]).then(([EC, RP, UB, OP]) => {
            try {
                const sz = canvasSize(highwayCanvas) || { w: 1280, h: 720 };
                const w = Math.max(2, sz.w | 0), h = Math.max(2, sz.h | 0);
                // Multisampled (WebGL2 MSAA) HalfFloat target so anti-aliasing
                // survives the bloom path — EffectComposer's default target has no
                // `samples`, which is why bloom-on looked jagged (worst on non-Retina
                // DPR1 displays that have no supersampling cushion).
                const _bloomRT = new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType, samples: 4 });
                const comp = new EC.EffectComposer(ren, _bloomRT);
                comp.addPass(new RP.RenderPass(scene, cam));
                _bloomPass = new UB.UnrealBloomPass(new T.Vector2(w, h), 0.65, 0.5, 0.82); // strength, radius, threshold (high → only emissive blooms)
                comp.addPass(_bloomPass);
                comp.addPass(new OP.OutputPass());
                comp.setSize(w, h);
                _bloomW = w; _bloomH = h; _composer = comp;
            } catch (e) { console.warn('[3D-Hwy] bloom init failed', e); _composer = null; }
        }).catch((e) => console.warn('[3D-Hwy] bloom modules failed', e));
        return null;
    }
    function buildBoard() {
        // Dispose before clearing (traverse: nut/headstock may live in a Group).
        while (fretG.children.length) {
            const child = fretG.children[0];
            child.traverse((o) => {
                if (o instanceof T.Sprite) return;
                // fretTubeGeo is shared across all fret meshes — disposing it
                // per-mesh here would fire one redundant dispose event per
                // fret. Skip it; it's disposed exactly once below.
                if (o.geometry !== fretTubeGeo) o.geometry?.dispose?.();
                const mat = o.material;
                if (mat) {
                    const mats = Array.isArray(mat) ? mat : [mat];
                    for (const m of mats) m?.dispose?.();
                }
            });
            fretG.remove(child);
        }
        stringLines = [];
        stringLineGlows = [];
        // Fret wire materials were already disposed by the child.traverse()
        // above (each is attached 1:1 to a fret mesh) — just clear the
        // tracking array. The shared fretTubeGeo was skipped by that
        // traverse, so dispose it exactly once here.
        fretWireMats = [];
        fretTubeGeo?.dispose?.();
        fretTubeGeo = null;

        const board = boardSpanX();
        const bw = board.width + 4 * K;

        // Fretboard plane — spans exactly from hit line (Z=0) to the note
        // spawn horizon (-AHEAD * TS), so the far edge aligns with AHEAD.
        const blAhead = TS * AHEAD;
        const pg = new T.PlaneGeometry(bw, blAhead);
        // Board (highway-surface) color comes from the active HIGHWAY scene
        // theme (default theme = the original 0x08080e). Kept on
        // _boardPlaneMat so _applyBgTheme can recolor it live without
        // rebuilding the board.
        const pm = new T.MeshLambertMaterial({ color: _bgHighwayColors(hwThemeId).board, transparent: true, opacity: 0.6 });
        _boardPlaneMat = pm;
        const p = new T.Mesh(pg, pm);
        p.rotation.x = -Math.PI / 2;
        p.position.set(board.center, S_BASE - NH / 2 - 2 * K, -blAhead / 2);
        fretG.add(p);

        // Thin Line strings (glow layer). Retained in stringLineGlows[]
        // so vibrancy slider changes can mutate opacity in place
        // without rebuilding the board geometry.
        // Nut lateral layout (matches headstock block below): playing strings start at the
        // fretboard-facing edge so they never project through nut/headstock.
        const mir = _leftyCached ? -1 : 1;
        const nutLenX = 1.55 * K;
        const nutXC = -0.78 * K * mir;
        const xHeadLeft = -6.85 * K * mir;
        const nutRearX = nutXC - nutLenX * 0.5;
        const nutFrontX = nutXC + nutLenX * 0.5;
        const nutJoinX = nutFrontX + 0.03 * K;
        const bridgeTipX = xFret(NFRETS) + 2 * K * mir;
        boardStringStartX = Math.min(nutJoinX, bridgeTipX);
        boardTuningLabelX = (nutRearX + xHeadLeft) * 0.5 - 0.15 * K * mir;
        const stringEndX = Math.max(nutJoinX, bridgeTipX);
        const strSpan = Math.max(stringEndX - boardStringStartX, 1.5 * K);

        const lineGlowOp = 0.15 + 0.35 * vibrancy;
        for (let s = 0; s < nStr; s++) {
            const pts = [new T.Vector3(boardStringStartX, sY(s), 0), new T.Vector3(stringEndX, sY(s), 0)];
            const g = new T.BufferGeometry().setFromPoints(pts);
            const line = new T.Line(g, new T.LineBasicMaterial({ color: activePalette[s], transparent: true, opacity: lineGlowOp }));
            line.renderOrder = 7; // above sus rails (4/5), below chord fill (10)
            fretG.add(line);
            stringLineGlows.push(line);
        }

        // BoxGeometry strings — emissive glow driven by updateStringHighlights()
        for (let s = 0; s < nStr; s++) {
            const g = new T.BoxGeometry(strSpan, STR_THICK, STR_THICK);
            // Each string gets its own material instance so emissiveIntensity is per-string
            // (and per-frame opacity is set by updateStringHighlights via _vibrancyIdleOp)
            const mat = new T.MeshStandardMaterial({
                color: activePalette[s], emissive: activePalette[s],
                emissiveIntensity: 0.002,
                transparent: true, opacity: _vibrancyIdleOp, roughness: 1,
            });
            const mesh = new T.Mesh(g, mat);
            mesh.renderOrder = renderOrderForLayerAtZ(0, 'BOARD_STRING');
            mesh.position.set(boardStringStartX + strSpan * 0.5, sY(s), 0);
            fretG.add(mesh);
            stringLines.push(mesh);
        }

        // Guitar nut + headstock — grouped so visibility + colors are user-tunable.
        {
            nutHeadstockGroup = new T.Group();
            const yTopN = Math.max(sY(0), sY(nStr - 1));
            const yBottomN = Math.min(sY(0), sY(nStr - 1));
            const yMidN = (yTopN + yBottomN) / 2;
            const spanY = Math.abs(yTopN - yBottomN) + S_GAP * 1.05;

            const nutD = 0.95 * K;
            const nutZc = -0.62 * K;
            const nutH = spanY * 1.06;
            const nutHalfH = nutH * 0.5;

            const zBack = -1.38 * K;
            const zJoint = -0.58 * K;

            const nutInt = _h3dHexOrDefault(nutColor, BG_DEFAULTS.nutColor);
            const hsInt = _h3dHexOrDefault(headstockColor, BG_DEFAULTS.headstockColor);
            const nutBase = new T.Color(nutInt);
            const nutHi = nutBase.clone().lerp(new T.Color(0xffffff), 0.14);
            const nutGro = nutBase.clone().multiplyScalar(0.72);
            const hsBase = new T.Color(hsInt);
            const hsDarkC = hsBase.clone().multiplyScalar(0.76);

            const mapleMat = new T.MeshStandardMaterial({
                color: hsBase, roughness: 0.55, metalness: 0.02,
            });
            const mapleDark = new T.MeshStandardMaterial({
                color: hsDarkC, roughness: 0.62, metalness: 0.02,
            });

            const coreLen = Math.max(Math.abs(nutRearX - xHeadLeft), 2 * K);
            const coreCX = (nutRearX + xHeadLeft) * 0.5;
            const headCoreD = 1.05 * K;
            const headCore = new T.Mesh(
                new T.BoxGeometry(coreLen, spanY * 1.12, headCoreD),
                mapleDark,
            );
            headCore.position.set(coreCX, yMidN, zBack - headCoreD * 0.35);
            nutHeadstockGroup.add(headCore);

            const xs = 14;
            const ys = 12;
            const yLo = yMidN - spanY * 0.58;
            const yHi = yMidN + spanY * 0.58;
            const posR = new Float32Array((xs + 1) * (ys + 1) * 3);
            const idxR = [];
            let ri = 0;
            for (let j = 0; j <= ys; j++) {
                const v = j / ys;
                const wy = yLo + v * (yHi - yLo);
                const yArc = 1 - Math.abs((wy - yMidN) / (spanY * 0.55 + 1e-6));
                const yArcCl = Math.max(0, Math.min(1, yArc));
                for (let i = 0; i <= xs; i++) {
                    const u = i / xs;
                    const wx = xHeadLeft + u * (nutRearX - xHeadLeft);
                    const smooth = Math.sin(u * Math.PI * 0.5);
                    let wz = zBack + (zJoint - zBack) * smooth;
                    wz += 0.14 * K * yArcCl * yArcCl;
                    posR[ri++] = wx;
                    posR[ri++] = wy;
                    posR[ri++] = wz;
                }
            }
            const row = xs + 1;
            for (let j = 0; j < ys; j++) {
                for (let i = 0; i < xs; i++) {
                    const a = j * row + i;
                    const b = a + row;
                    idxR.push(a, b, a + 1, b, b + 1, a + 1);
                }
            }
            const rampGeo = new T.BufferGeometry();
            rampGeo.setAttribute('position', new T.BufferAttribute(posR, 3));
            rampGeo.setIndex(idxR);
            rampGeo.computeVertexNormals();
            nutHeadstockGroup.add(new T.Mesh(rampGeo, mapleMat));

            const boneMat = new T.MeshStandardMaterial({
                color: nutBase, roughness: 0.38, metalness: 0.02,
            });
            const boneTop = new T.MeshStandardMaterial({
                color: nutHi, roughness: 0.32, metalness: 0.02,
            });
            const grooveMat = new T.MeshStandardMaterial({
                color: nutGro, roughness: 0.85, metalness: 0,
            });

            const nutBody = new T.Mesh(
                new T.BoxGeometry(nutLenX, nutH, nutD),
                boneMat,
            );
            nutBody.position.set(nutXC, yMidN, nutZc);
            nutHeadstockGroup.add(nutBody);

            const crownR = nutLenX * 0.52;
            const crownSeg = new T.CylinderGeometry(
                crownR, crownR, nutLenX * 0.92, 20, 1, true,
                Math.PI * 0.08, Math.PI * 0.42,
            );
            const crown = new T.Mesh(crownSeg, boneTop);
            crown.rotation.z = Math.PI * 0.5;
            crown.position.set(
                nutXC,
                yMidN + nutHalfH - 0.02 * K,
                nutZc + nutD * 0.22,
            );
            nutHeadstockGroup.add(crown);

            const slotDrop = 0.11 * K;
            const slotHalfW = STR_THICK * 1.15;
            const slotZ = nutZc + nutD * 0.12;
            for (let st = 0; st < nStr; st++) {
                const gr = new T.Mesh(
                    new T.BoxGeometry(slotHalfW * 2, slotDrop, nutD * 0.42),
                    grooveMat,
                );
                gr.position.set(nutXC, sY(st), slotZ);
                nutHeadstockGroup.add(gr);
            }
            nutHeadstockGroup.visible = nutHeadstockVisible;
            fretG.add(nutHeadstockGroup);
        }

        // Fret wires — bowed metal TubeGeometry (backported from
        // highway_babylon). Board-string and fret-wire layers live in
        // RENDER_ORDER_LAYER_STACK so the fretboard draws above note
        // symbols and below fret labels.
        // Tube (not T.Line): WebGL ignores linewidth > 1px on almost all
        // platforms, so Line objects always render as hairlines. The tube
        // bows in Z (middle strings pushed away from camera) so the row of
        // frets reads as wrapping a cylindrical neck — see FRET_BOW_DZ.
        // MeshStandardMaterial (vs the old flat MeshBasic): the scene's
        // ambient+directional light glints across the rounded surface for a
        // polished-steel look; the per-frame gold albedo (in-anchor) then
        // reads as brass. depthTest:false: string BoxGeometry (MeshStandard,
        // depthWrite:true) writes depth at Z=+STR_THICK/2; wires near Z=0
        // would fail the depth test at string pixels despite higher layer.
        // Colors are updated each frame by the fretWireMats loop in update():
        //   default  → gray  0x666688, opacity 0.4
        //   in-anchor→ gold  0xD8A636, opacity 0.8  (same as FRET_LABEL_GOLD_HEX)
        const yTop = Math.max(sY(0), sY(nStr - 1));
        const yBottom = Math.min(sY(0), sY(nStr - 1));
        const wireH = (yTop + S_GAP * 0.3) - (yBottom - S_GAP * 0.3);
        const wireMidY = (yTop + yBottom) / 2;
        // Single shared geometry centered at x=0, local Y -half..+half,
        // bowed in Z by FRET_BOW_DZ * [0,0.6,1,0.6,0]. Reused by every fret
        // (only mesh position differs). Symmetric in Y → invert/lefty-safe.
        const yHalf = wireH * 0.5;
        const zMults = [0, 0.6, 1, 0.6, 0];
        const tubePath = zMults.map((zm, i) => new T.Vector3(
            0,
            -yHalf + (wireH * i) / (zMults.length - 1),
            FRET_BOW_DZ * zm,
        ));
        const tubeCurve = new T.CatmullRomCurve3(tubePath);
        fretTubeGeo = new T.TubeGeometry(
            tubeCurve, FRET_TUBE_SEG, FRET_TUBE_RADIUS, FRET_TUBE_RADIAL, false,
        );
        for (let f = 0; f <= NFRETS; f++) {
            const x = xFret(f);
            const mat = new T.MeshStandardMaterial({
                color: 0x666688, metalness: FRET_METALNESS, roughness: FRET_ROUGHNESS,
                emissive: FRET_EMISSIVE,
                // depthWrite:false (matches other transparent overlays here):
                // a transparent fret must not write depth or it can occlude
                // later-drawn transparent elements despite depthTest:false.
                transparent: true, opacity: 0.4, depthTest: false, depthWrite: false,
            });
            const fw = new T.Mesh(fretTubeGeo, mat);
            fw.position.set(x, wireMidY, 0);
            fw.renderOrder = renderOrderForLayerAtZ(0, 'BOARD_FRET_WIRE');
            fretG.add(fw);
            fretWireMats[f] = mat;
        }

        // Fret dots — flat circles (CircleGeometry) lying in the XY plane and
        // facing +Z so they always appear as perfect circles from the camera.
        // depthWrite:false so they don't steal the depth buffer from the
        // transparent string meshes. Slight negative Z recessed under the
        // string plane. Radius 10% below the former 1.5*K dots.
        const dotRZ = (1.5 * K * 0.9);
        const dg = new T.CircleGeometry(dotRZ, 64);
        const dm = new T.MeshBasicMaterial({
            color: 0x556677,
            transparent: true,
            opacity: 1,
            depthWrite: false,
        });
        const dotZBack = -STR_THICK * 0.85;
        const my = (sY(0) + sY(nStr - 1)) / 2;
        const addDot = (x, y) => {
            const d = new T.Mesh(dg, dm);
            d.position.set(x, y, dotZBack);
            // Above the dynamic lane (1) and its dividers (2) so the
            // translucent blue lane no longer paints over and hides the
            // inlay; still well below strings / wires / notes,
            // so those keep drawing on top of the inlay.
            d.renderOrder = 3;
            fretG.add(d);
        };
        for (const f of DOTS) {
            const cx = xFretMid(f);
            if (DDOTS.has(f)) {
                addDot(cx, my - S_GAP * 0.7);
                addDot(cx, my + S_GAP * 0.7);
            } else {
                addDot(cx, my);
            }
        }

        // Fret inlay number labels — sprites sitting just behind the hit line
        // (Z = -K) so camera-distance sorting in the transparent pass puts
        // them before notes at Z = 0, letting notes paint on top.
        // Materials are cloned from the txtMat cache with depthWrite:false so
        // the sprites don't write stale depth values that would clip incoming
        // notes (which arrive from large negative Z). Clones are tracked in
        // _inlayMats for explicit disposal on rebuild and destroy().
        // Scale uses (0.5 + textSize) directly — _textSizeMul is stale here
        // (only refreshed at the top of update()); update() rescales live.
        for (const m of _inlayMats) m.dispose();
        _inlayMats = [];
        _inlayLabels = [];
        for (const f of INLAY_LABEL_FRETS) {
            const mat = txtMat(f, '#7abfcc', false, 'fretRow').clone();
            mat.depthWrite = false;
            mat.opacity = 0.55;
            const lbl = new T.Sprite(mat);
            const scale = 5.5 * (0.5 + textSize) * fretLabelScaleForFret(f);
            lbl.scale.set(scale * K, scale * K, 1);
            lbl.position.set(xFretMid(f), yTop - S_GAP * 0.4, -K);
            lbl.visible = inlayLabelsVisible;
            fretG.add(lbl);
            _inlayLabels.push(lbl);
            _inlayMats.push(mat);
        }
    }

    /* ── String glow (called each frame) ────────────────────────────── */
    function updateStringHighlights(noteState) {
        // Glow slider scales both the idle floor and anticipation peak,
        // so glowMul=0 fully silences the per-string emissive pulse.
        // Vibrancy controls the idle opacity floor — anticipation
        // still rides on top regardless of vibrancy so play-feedback
        // through the opacity channel survives even at glowMul=0.
        //
        // Folded with the post-noteState mGlow / mAccentCore writes
        // (was a separate `for (s = 0; s < nStr)` loop in update()),
        // so the per-string scratch arrays stay hot in L1 across all
        // material writes for a given string.
        const BASE_GLOW = 0.02 * glowMul;
        const MAX_GLOW  = 3.5  * glowMul;
        const IDLE_OP   = _vibrancyIdleOp;
        const g = glowMul;
        const venueGemMul = _venueSceneOverride ? VENUE_GEM_EMISSIVE_MUL : 1;

        for (let s = 0; s < nStr; s++) {
            const mesh = stringLines[s];
            if (mesh) {
                const intensity = Math.max(
                    noteState.stringSustain[s] ? 1 : 0,
                    noteState.stringAnticipation[s] || 0,
                );
                mesh.material.emissiveIntensity = BASE_GLOW + intensity * MAX_GLOW;
                mesh.material.opacity = IDLE_OP + intensity * (1 - IDLE_OP);
                mesh.scale.set(1, 1 + intensity * 0.3, 1 + intensity * 0.3);
            }
            // Hit-note emissive — same write pattern as the standalone
            // loop that previously lived at update()'s post-call site.
            // The glow slider scales it here since this assignment
            // stomps anything _applyGlow() set statically.
            const bg = noteState.strGlow[s] * g;
            if (mGlow[s]) mGlow[s].emissiveIntensity = bg * venueGemMul;
            if (mAccentCore[s]) {
                mAccentCore[s].emissiveIntensity =
                    (bg + noteState.accentFillBoost[s] * g) * venueGemMul;
            }
        }
    }

    /* ── Lookahead fret bounds + smooth camera ───────────────────────── */
    // End time of the lookahead window = start of the measure that is
    // CAM_LOOKAHEAD_MEASURES measures ahead of the current one. Uses the
    // _measureStarts cache (times of beats with measure !== -1). With no
    // beats it falls back to CAM_LOOKAHEAD_SEC seconds. Past the last known
    // measure it extrapolates using the average measure duration.
    function lookaheadEndTime(now) {
        const ms = _measureStarts;
        if (!ms || ms.length === 0) return now + CAM_LOOKAHEAD_SEC;
        // Binary search: lo = first index with ms[lo] > now.
        let lo = 0, hi = ms.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (ms[mid] <= now) lo = mid + 1; else hi = mid; }
        const curIdx = lo - 1;                       // current measure (-1 if before the first)
        const targetIdx = curIdx + CAM_LOOKAHEAD_MEASURES;
        if (targetIdx >= 0 && targetIdx < ms.length) return ms[targetIdx];
        // Past the last measure: extrapolate using the average measure duration.
        if (ms.length >= 2) {
            const avg = (ms[ms.length - 1] - ms[0]) / (ms.length - 1);
            if (avg > 0) return ms[ms.length - 1] + (targetIdx - (ms.length - 1)) * avg;
        }
        return now + CAM_LOOKAHEAD_SEC;
    }

    function lookaheadComputeFretBounds(now, anchors, notes, chords) {
        const tEnd = lookaheadEndTime(now);
        let minF = 99;
        let maxF = 0;
        let any = false;
        if (anchors && anchors.length) {
            for (let tt = now; tt <= tEnd + 1e-9; tt += 0.125) {
                const a = getChartAnchorAt(anchors, tt);
                if (!a) continue;
                let fStart = Math.round(Number(a.fret));
                if (!Number.isFinite(fStart) || fStart < 1) fStart = 1;
                let w = Number(a.width);
                if (!Number.isFinite(w)) w = 4;
                w = Math.max(1, Math.round(w));
                const fHi = Math.min(NFRETS, fStart + w - 1);
                minF = Math.min(minF, fStart);
                maxF = Math.max(maxF, fHi);
                any = true;
            }
        }
        const consider = f => {
            if (!(f > 0)) return;
            minF = Math.min(minF, f);
            maxF = Math.max(maxF, f);
            any = true;
        };
        if (notes) {
            let i = lowerBoundT(notes, now);
            for (; i < notes.length; i++) {
                const n = notes[i];
                if (n.t > tEnd) break;
                if (!validString(n.s)) continue;
                consider(n.f);
            }
        }
        if (chords) {
            let i = lowerBoundT(chords, now);
            for (; i < chords.length; i++) {
                const ch = chords[i];
                if (ch.t > tEnd) break;
                if (!ch.notes) continue;
                for (const cn of ch.notes) {
                    if (!validString(cn.s)) continue;
                    consider(cn.f);
                }
            }
        }
        if (!any || minF > maxF) return null;
        return { minF, maxF };
    }

    function lookaheadTargetWorldX(minF, maxF) {
        const wb = CAM_FRET_EDGE_BLEND;
        const middle = (xFretMid(minF) + xFretMid(maxF)) * 0.5;
        const weighted = 0.6 * xFret(0) + 0.4 * xFret(NFRETS);
        return middle * (1 - wb) + weighted * wb;
    }

    function lookaheadSmoothCamStep(dtSec, tgtXWorld, tgtSpanInt) {
        const d = Math.min(0.2, Math.max(1e-4, dtSec));
        const fs = 1 - Math.pow(1 - CAM_FOCUS_BLEND_RATE, d);
        _lookaheadCamX = tgtXWorld * fs + _lookaheadCamX * (1 - fs);
        _lookaheadFretSpan = tgtSpanInt * fs + _lookaheadFretSpan * (1 - fs);
    }

    /* ── Camera target helper ────────────────────────────────────────── */
    // Compute and apply tgtX + tgtDist from note-window-accumulated data.
    // Used by BOTH the snap pre-pass (before drawNote() calls, skipDistHyst=true)
    // and the main per-frame camera-target block (skipDistHyst=false) so the
    // two paths can never drift out of sync.
    //
    // wX/wSum        recency-weighted fret-position centroid accumulator
    // distMin/Max    min/max fret seen in the camera targeting window
    // distGot        true iff at least one fretted note was in the window
    // camHystF       X-axis hysteresis factor (from cameraSmoothing)
    // camDistHystF   dist hysteresis factor (from zoomSmoothing)
    // skipDistHyst   true on the snap/first-data frame — no previous tgtDist
    //                state exists, so bypass the dead-zone gate
    //
    // Side-effects: updates tgtX, tgtDist, prevLowFretBonus.
    // Returns: computed lockActive flag (caller is responsible for setting
    //          prevLockActive from the returned value).
    function _applyNoteCamTargets(wX, wSum, distMin, distMax, distGot,
                                  camHystF, camDistHystF, skipDistHyst) {
        const lockActive = cameraLockLow && (!distGot || distMax <= 12);
        if (lockActive) {
            // Locked view: frets 0-12 fit in frame, with the peak
            // low-fret bonus baked in so nut chords stay framed.
            // Both halves derive from the same helpers as the
            // dynamic branch so future tuning of the base zoom
            // curve or low-fret pullback can't desync them.
            const lockedBaseU  = camBaseDistU(12);
            const lockedBonusU = camLowFretPullbackU(1);
            // cameraLockZoom slider 0..1 blends between MIN (closest)
            // and MAX (furthest). Default 0.5 maps to ~1.0× so existing
            // users see the same locked view as before this slider.
            const lockZoomMul  = CAM_LOCK_ZOOM_MIN +
                (CAM_LOCK_ZOOM_MAX - CAM_LOCK_ZOOM_MIN) * cameraLockZoom;
            tgtX             = xFretMid(CAM_LOCK_CENTER_FRET);
            tgtDist          = (lockedBaseU + lockedBonusU) * K * lockZoomMul;
            prevLowFretBonus = lockedBonusU;
        } else if (distGot) {
            // Base zoom scales by fret count (distMax - distMin).
            const baseDistU     = camBaseDistU(distMax - distMin);
            // Low-fret pullback: world-X distance between frets is
            // logarithmic, so a 2-fret span at the nut takes much
            // more horizontal screen than the same span at fret 12.
            // The base term scales by *fret count*, not world-X
            // span, so low-fret clusters were under-allotted camera
            // distance and clipped at the left edge (e.g. F power
            // chord at fret 1 partially off-screen). Add a tapered
            // bonus that kicks in below fret 5 and peaks at fret 1
            // (≈16 extra fret-span units, i.e. 16*K world-units of
            // distance), without affecting mid/high neck framing.
            const lowFretBonusU = camLowFretPullbackU(distMin);
            if (skipDistHyst) {
                // First data frame — no previous tgtDist state; apply
                // directly without the hysteresis dead-zone check.
                tgtDist = (baseDistU + lowFretBonusU) * K;
            } else {
                // tgtDist scales at (3 * K) per fret-span unit, so the
                // hysteresis threshold (a fret-span dead zone) converts
                // to tgtDist-space by multiplying by 3 * K — NOT by
                // FRET_WIDTH_MID, which is X-axis world-units-per-fret
                // and a different unit (would over-tighten the gate by
                // ~4x at SCALE = 2.25).
                //
                // Hysteresis is applied to the BASE portion only. The
                // lowFretBonus changes by 4 fret-span units per integer
                // fret near the nut, which sits below the default-
                // cameraSmoothing (cs=0.5) dead zone of ~8.25 fret-span
                // units (= 2.75 * 3) and would otherwise be suppressed
                // for fret 2 → 1 / 3 → 1 transitions — exactly the
                // corrections this bonus exists to provide. So gate the
                // base, then always reflect bonus changes on top by
                // tracking the last-committed bonus contribution
                // (prevLowFretBonus) and adjusting tgtDist for its
                // delta whether or not the base hysteresis fires.
                //
                // First frame after a lock release bypasses the gate
                // entirely so a >12 fret note that disengaged the lock
                // is guaranteed to widen the view. Without this, a
                // small span jump (12→13 frets) at default settings
                // can sit inside the dead zone and the camera fails
                // to follow the high note that just opened the lock.
                const candidateBase = baseDistU * K;
                const baseTgt       = tgtDist - prevLowFretBonus * K;
                const justUnlocked  = prevLockActive;
                if (justUnlocked || Math.abs(candidateBase - baseTgt) > camDistHystF * 3 * K) {
                    tgtDist = (baseDistU + lowFretBonusU) * K;
                } else if (lowFretBonusU !== prevLowFretBonus) {
                    tgtDist = baseTgt + lowFretBonusU * K;
                }
            }
            prevLowFretBonus = lowFretBonusU;
        }
        // X-axis: recency-weighted centroid with a hysteresis dead zone
        // so small cluster shifts don't trigger visible pan motion.
        if (!lockActive && wSum > 0) {
            const candidateX = wX / wSum;
            if (Math.abs(candidateX - tgtX) > camHystF * FRET_WIDTH_MID) tgtX = candidateX;
        }
        return lockActive;
    }

    /** Tolerate RS/sloppak boolean-ish ``true`` / ``1`` forms. */

    /** World-scale XY for purple lane rails = arpeggio ``ftSide`` / ``gLaneDivider`` edge (0.15×K). */
    function arpeggioLaneDividerXYScaleMatchFrameRim(accentMul = 1) {
        const yA = sY(0), yB = sY(nStr - 1);
        const yMinF = Math.min(yA, yB) - S_GAP * 0.8;
        const yMaxF = Math.max(yA, yB) + S_GAP * 0.8;
        const fullChordBoxH = yMaxF - yMinF;
        let ft = Math.max(CHORD_FRAME_RIM_MIN * K, fullChordBoxH * CHORD_FRAME_RIM_FRAC_H);
        if (accentMul !== 1 && accentMul > 0) ft *= accentMul;
        const ftSide = ft * 1.55;
        return ftSide / (0.15 * K);
    }

    /* ── Fret-label measure-skip rule ───────────────────────────────── */
    // For each (note_time, fret) pair across standalone notes and chord
    // notes, determine which ones are allowed to display their fret
    // indicator number. Rule: per fret (regardless of string), show the
    // number only on the first note in a given measure; suppress it for
    // the immediately following measure; then allow it again (current
    // measure + 2).
    // Key scheme: Math.round(t * 25) * 100 + fret  (40 ms time buckets).
    // Using a coarse time-bucket (not exact time) ensures that a synthetic
    // chord template whose .t differs from the corresponding standalone
    // arpeggio note by a few ms still resolves to the same key.
    // Only standalone notes (notesArr) populate the set; regular chord notes
    // never show labels, and synthetic chord notes share frets/onsets with
    // their arpeggio counterparts, so the same keys are found at lookup time.
    // Returns a Set of numeric keys (Math.round(t*25)*100 + fret).
    function _buildFretLabelSet(notesArr, _chordsArr, beatsArr) {
        const events = [];
        if (notesArr) {
            for (let _i = 0; _i < notesArr.length; _i++) {
                const _n = notesArr[_i];
                if (_n.f > 0) events.push({ t: _n.t, f: _n.f });
            }
        }
        // Chord events intentionally excluded: regular chord notes don't show
        // fret labels; synthetic chord notes share frets with arpeggio note-stream
        // notes already captured above, so no separate chord processing needed.
        events.sort((a, b) => a.t - b.t);
        const beats = beatsArr || [];
        let beatIdx = 0;
        let currentMeasure = 0;
        const nextShowMeasure = new Map(); // fret → next measure where label is allowed
        const allowed = new Set();
        for (let _ei = 0; _ei < events.length; _ei++) {
            const { t, f } = events[_ei];
            // Advance beats pointer: find the current measure for time t.
            while (beatIdx < beats.length && beats[beatIdx].time <= t + 1e-4) {
                if (beats[beatIdx].measure >= 0) currentMeasure = beats[beatIdx].measure;
                beatIdx++;
            }
            const nextM = nextShowMeasure.get(f) ?? 0;
            if (currentMeasure >= nextM) {
                // Time-bucket key: 40 ms groups absorb timing jitter while
                // still distinguishing notes at different positions in the measure.
                allowed.add(Math.round(t * 25) * 100 + f);
                // Suppress this fret for the next measure; re-allow at +2.
                nextShowMeasure.set(f, currentMeasure + 2);
            }
        }
        return allowed;
    }

    // Smoothed playback clock for this frame. Called once per frame at the
    // top of update(); camUpdate() reads the stored _frameNow afterward so
    // notes and camera share one clock. See the _clk* state block above.
    function smoothNow(bundle) {
        const raw = bundle.currentTime;
        const p = performance.now();
        // Host pause signal (feedBack core's bundle.isPlaying): when the
        // chart clock isn't advancing (paused / stalled / mid-seek), don't
        // extrapolate forward against a frozen audio sample — that creeps
        // the highway ahead by up to the interp cap and then snaps back
        // when dt finally crosses 0.1. Re-anchor to raw so the next
        // playing frame resumes from a clean segment. `=== false` so
        // downlevel hosts (isPlaying undefined) fall through to the
        // staleness-based cap below, preserving prior behavior there.
        if (bundle.isPlaying === false) {
            _clkAudioT = raw;
            _clkPerf = p;
            _clkRate = 1;
            return (_frameNow = raw);
        }
        if (raw !== _clkAudioT) {
            // New audio sample — re-anchor and refine the rate estimate.
            if (!Number.isNaN(_clkPerf)) {
                const dP = (p - _clkPerf) / 1000;
                if (dP > 0.001 && dP < 0.5) {
                    const r = (raw - _clkAudioT) / dP;
                    _clkRate = (r > 0.05 && r < 5) ? r : 1; // seek/loop → reset
                } else if (dP >= 0.5) {
                    _clkRate = 1; // long gap (paused / tab inactive)
                }
            }
            _clkAudioT = raw;
            _clkPerf = p;
            return (_frameNow = raw);
        }
        // Same audio sample as last call — interpolate forward, capped so a
        // stalled main thread or paused audio can't run the clock away.
        const dt = (p - _clkPerf) / 1000;
        if (dt <= 0 || dt > 0.1) return (_frameNow = raw);
        return (_frameNow = _clkAudioT + _clkRate * dt);
    }

    /* ── Per-frame rendering ─────────────────────────────────────────── */
    // ── GPU pre-warm (perf: first-appearance hitches) ─────────────────
    // Three.js compiles a material's shader program and uploads a
    // texture the first frame the owning object renders — profiled as
    // mid-song frame spikes (getParameters / texSubImage2D). Pay those
    // costs during init (load spinner) instead:
    //   _prewarmStatic()      — ren.compile() over the fully-built scene
    //                           + deterministic label textures (fret
    //                           numbers in every per-frame style/colour
    //                           combo).
    //   _prewarmChart(bundle) — chart-dependent labels (chord template
    //                           names, section names); needs the ready
    //                           bundle, so it runs once from the first
    //                           draw() after each init.
    // txtMat() rasterises into the unbounded cache these draws hit
    // anyway; ren.initTexture() forces the GPU upload now.
    // Swap a pooled label sprite's cached texture WITHOUT recompiling.
    // Setting material.needsUpdate bumps material.version, which forces
    // Three.js through getParameters/getProgramCacheKey on the next
    // render. Swapping one non-null texture for another does NOT change
    // the compiled program (the USE_MAP define is unchanged); only a
    // null <-> non-null transition does, and pooled label sprites are
    // constructed with a non-null map, so in practice this never
    // recompiles. (Note: the DOMINANT getParameters churn turned out to
    // be Three's transparent-DoubleSide two-pass path — see the
    // forceSinglePass comment in _spriteMat2MeshMat — this helper
    // removes the label-swap contribution on top of that.)
    function _setLabelMap(sprite, srcMat) {
        const m = sprite.material;
        if (m.map === srcMat.map) return;
        const nullnessChanged = (m.map == null) !== (srcMat.map == null);
        m.map = srcMat.map;
        if (nullnessChanged) m.needsUpdate = true;
    }

    let _chartPrewarmed = false;
    function _prewarmTex(mat) {
        if (mat && mat.map && ren) ren.initTexture(mat.map);
    }
    function _prewarmStatic() {
        // MAINTENANCE NOTE: this list must cover every deterministic
        // (chart-independent) material/texture the per-frame paths can
        // request lazily. Adding a new label style or sprite factory to
        // drawNote()/update() without warming it here silently
        // reintroduces a first-appearance texSubImage2D/compile spike
        // mid-song. Chart-dependent labels (chord names, section names)
        // live in _prewarmChart.
        try {
            if (ren && scene && cam) ren.compile(scene, cam);
        } catch (e) { console.warn('[3D-Hwy] prewarm compile:', e); }
        try {
            // Fret-number labels in the per-frame style/colour combos.
            for (let f = 0; f <= NFRETS; f++) {
                _prewarmTex(txtMat(f, FRET_LABEL_GOLD_HEX, false, 'noteFret'));
                _prewarmTex(txtMat(f, FRET_LABEL_GOLD_HEX, false, 'fretRow'));
                _prewarmTex(txtMat(f, FRET_LABEL_IDLE_HEX, false, 'fretRow'));
                _prewarmTex(txtMat(f, '#ffffff', false, 'ghostFret'));
            }
            // Teaching marks (drawNote _drawTeachMark): finger hints
            // T/1-4 (teachFg) and scale degrees 0-11 (teachSd).
            _prewarmTex(txtMat('T', '#7fd1ff', false, 'teachFg'));
            for (let i = 1; i <= 4; i++) _prewarmTex(txtMat(String(i), '#7fd1ff', false, 'teachFg'));
            for (let i = 0; i <= 11; i++) _prewarmTex(txtMat(String(i), '#ffcc66', false, 'teachSd'));
            // Technique sprite factories (own caches, keyed by packed
            // number): PM/FH mute X, hammer/pull triangles, bend
            // chevron stacks, slide direction arrows — per string
            // colour of the active palette.
            _prewarmTex(palmMuteXSpriteMat());
            _prewarmTex(fretHandMuteXSpriteMat());
            const _nWarm = Math.min(
                Math.max(nStr, 6),
                (activePalette && activePalette.length) || 0);
            for (let s = 0; s < _nWarm; s++) {
                const hex = activePalette[s] || 0xffffff;
                _prewarmTex(triMat(true, hex));
                _prewarmTex(triMat(false, hex));
                for (let st = 1; st <= 4; st++) _prewarmTex(bendChevronMat(st, hex));
                const arrowHex = darkenHex(hex, 0.55);
                _prewarmTex(slideArrowMat(true, arrowHex));
                _prewarmTex(slideArrowMat(false, arrowHex));
            }
        } catch (e) { console.warn('[3D-Hwy] prewarm labels:', e); }
    }
    function _prewarmChart(bundle) {
        try {
            const tpls = bundle && bundle.chordTemplates;
            if (Array.isArray(tpls)) {
                for (const tpl of tpls) {
                    if (tpl && tpl.name) _prewarmTex(txtMat(tpl.name, '#e8d080', true, 'chord'));
                }
            }
            const secs = bundle && bundle.sections;
            if (Array.isArray(secs)) {
                for (const s of secs) {
                    if (s && s.name) _prewarmTex(txtMat(s.name, '#00cccc', true, 'section'));
                }
            }
        } catch (e) { console.warn('[3D-Hwy] prewarm chart labels:', e); }
    }

    function update(bundle) {
        pbBeg(0);
        // [verdict glow] Apply the level-driven verdict brightness captured
        // last frame (1-frame lag is imperceptible), then reset for this
        // frame's capture in the gem path below. vg = 1 when no provider
        // alpha was seen (legacy event path / note_detect off), leaving the
        // authored 4.0/0.7 × glowMul brightness from _applyGlow() untouched.
        // Only the verdict-only materials (mHitBright + its face-fill arrays,
        // and the hit sustain outline) are scaled — never mStrHitOutline,
        // which is the default rim for every fretted note.
        {
            const vg = _ndVerdictSawAlpha ? _ndVerdictMaxAlpha : 1;
            const venueGemMul = _venueSceneOverride ? VENUE_GEM_EMISSIVE_MUL : 1;
            for (let s = 0; s < mHitBright.length; s++) {
                if (mHitBright[s]) mHitBright[s].emissiveIntensity = 4.0 * glowMul * vg * venueGemMul;
            }
            if (mHitSusOutline) mHitSusOutline.emissiveIntensity = 0.7 * glowMul * vg * venueGemMul;
            _ndVerdictMaxAlpha = 0;
            _ndVerdictSawAlpha = false;
        }
        // Lean sustain rendering is the default (see declaration above):
        // the trail/ribbon outline always draws; only the additive rail
        // bloom halo is dropped. The full look (with bloom) is an opt-out.
        // localStorage.getItem is a synchronous storage read — polled at
        // ~1 Hz instead of every frame; the console flag still takes
        // effect live (within a second).
        if ((_leanSusPollCounter++ % 60) === 0) {
            try {
                _leanSus = localStorage.getItem('h3d_full_sus') !== '1';
            } catch (_) { _leanSus = true; }
        }
        // Materialize the text-size multiplier from the user's slider.
        // textSize ∈ [0,1]; _textSizeMul ∈ [0.5, 1.5] with 0.5 ↦ 1.0×
        // so default behaviour matches what the renderer did pre-slider.
        _textSizeMul = 0.5 + textSize;
        // Rescale inlay labels to track the live text-size slider.
        // buildBoard() sets an initial scale using (0.5 + textSize) but
        // _textSizeMul is only authoritative from here onward.
        // Guard: only update when the multiplier actually changed.
        if (_textSizeMul !== _textSizeMulApplied) {
            _textSizeMulApplied = _textSizeMul;
            for (let i = 0; i < _inlayLabels.length; i++) {
                const f = INLAY_LABEL_FRETS[i];
                const s = 5.5 * _textSizeMul * K * fretLabelScaleForFret(f);
                _inlayLabels[i].scale.set(s, s, 1);
            }
        }
        _syncOpenStringPitchLabels(bundle);

        pNote.reset(); pNoteEdge.reset(); pSus.reset(); pSusOutline.reset(); pSusRibbon.reset(); pSusRibbonOl.reset(); pTapChevron.reset(); pAccentHalo.reset(); pLbl.reset();
        pBeat.reset(); pSec.reset();
        if (projMeshArr) for (const arr of projMeshArr) for (const m of arr) m.visible = false;
        pFretLbl.reset(); pLane.reset(); pLaneDivider.reset();
        if (pGhostFretLbl) pGhostFretLbl.reset();
        _scrGhostUpcomingCount.fill(0, 0, nStr);
        pChordBox.reset(); pChordFrameFill.reset(); pChordLbl.reset(); pBarreLine.reset(); pArpBracket.reset(); pHaloBar.reset();
        _imPMTechCount = _imFHTechCount = 0;
        _imPMXFillCount = _imPMXLinesCount = _imFHXFillCount = _imFHXLinesCount = 0;
        if (pPMXFill) pPMXFill.reset();
        if (pFHXFill) pFHXFill.reset();
        if (pMuteXLines) pMuteXLines.reset();
        if (pFHXLines) pFHXLines.reset();
        pNoteFretLabel.reset(); pConnectorLine.reset(); pDropLine.reset();
        pTeachMarkLbl.reset();
        pFretColMarker.reset(); pSusRail.reset(); pSusRailBloom.reset(); pTechPlane.reset();
        // Clear per-frame queues in-place (avoid reallocating the array object).
        _ndLabels.length = 0;
        let hwyLaneArpOuterDividers = false;

        // Prune expired notedetect marks once per frame instead of
        // once per drawNote call (issue #9 perf nit). drawNote then
        // only does the bounded (s, f, t) match — no per-note
        // performance.now() / filter() needed. No arr[0] gate: the
        // dedupe path can refresh any entry's expiresAt, so gating on
        // arr[0] would silently skip expired entries behind it.
        _ndFrameNowMs = performance.now();
        // In-place prune — avoids allocating a new array every frame.
        // Marks are tiny (0–5 entries typically), so a backwards splice
        // loop is cheap and keeps the existing array object alive.
        if (_ndHitMarks.length) {
            for (let _pi = _ndHitMarks.length - 1; _pi >= 0; _pi--) {
                if (_ndHitMarks[_pi].expiresAt <= _ndFrameNowMs) _ndHitMarks.splice(_pi, 1);
            }
        }
        if (_ndMissMarks.length) {
            for (let _pi = _ndMissMarks.length - 1; _pi >= 0; _pi--) {
                if (_ndMissMarks[_pi].expiresAt <= _ndFrameNowMs) _ndMissMarks.splice(_pi, 1);
            }
        }
        // feedBack#254 — capture core's per-note judgment provider for
        // this frame's drawNote() calls (held-sustain glow + lit gems).
        // bundle.getNoteState is ALWAYS present (the core stub returns
        // null when no provider is registered), so its existence isn't
        // a "detect mode active" signal on its own.
        // bundle.getNoteStateProvider exposes the registered provider
        // (or null) directly — drive cull-window / chord-rim-floor
        // extensions off that so they don't activate in non-detect
        // mode. Downlevel hosts without getNoteStateProvider fall
        // back to the existence check, matching pre-PR behavior on
        // those builds.
        _ndGetNoteState = (bundle && typeof bundle.getNoteState === 'function') ? bundle.getNoteState : null;
        _ndHasProvider = (bundle && typeof bundle.getNoteStateProvider === 'function')
            ? bundle.getNoteStateProvider() != null
            : !!_ndGetNoteState;

        const now = smoothNow(bundle);
        const t0 = now - BEHIND;
        const t1 = now + AHEAD;
        // With a verdict provider attached, keep notes and chord frames
        // in the outer loop past BEHIND so async verdicts (~0.4 s late)
        // still land while drawable; per-note / per-frame culling is
        // tightened back below.
        const ndVerdictT0 = _ndHasProvider
            ? now - Math.max(BEHIND, NOTEDETECT_GEM_VERDICT_WINDOW)
            : t0;
        // Prune _chordVerdicts latches whose chord has fully scrolled
        // past the loop's verdict-window cull. Forward playback never
        // re-encounters a chord, so without this prune the map would
        // grow unbounded for the rest of the song (each chord onset
        // contributes one entry, ~hundreds for a typical song).
        // verdictKey is now an integer encoded by _encodeChordVerdictKey
        // — time component sits in the upper bits, so a direct
        // ``k < pruneBeforeKey`` test prunes correctly without
        // parseFloat / String.slice on every entry.
        //
        // Backward seek (now < lastNow): every latched entry's
        // chord time is now ahead of `now`, the forward-only check
        // below would skip them all and the map would grow on every
        // loop. Clear wholesale — the chord-loop's `chDt > 0` eviction
        // re-creates entries as chords re-enter the pre-hit window.
        //
        // Forward playback: iterate every entry. An earlier `break`
        // optimization assumed Map insertion order tracked chord
        // time, but entries are inserted when a verdict OBSERVATION
        // lands — so a later chord whose verdict arrived first could
        // sit before an earlier chord whose verdict was still
        // pending, and breaking on the first in-window entry would
        // leave the now-older later-inserted entries un-pruned. Full
        // scan is O(n) but n is bounded (chord count in the song,
        // ~hundreds) so the per-frame cost is microseconds.
        if (_ndHasProvider && _chordVerdictsLastNow !== null && now < _chordVerdictsLastNow - 0.25) {
            // Backward seek — wipe all verdict latches so notes re-judge
            // from scratch regardless of whether chords were present.
            _chordVerdicts.clear();
            _susVerdictLatch.clear();
            // Score-pop dedup too: a practice loop / rewind re-judges
            // the same popKeys, and the wall-time TTL alone would
            // suppress their fresh "+N" pops for up to 4 s.
            _fxSeen.clear();
        }
        if (_ndHasProvider && _chordVerdicts.size > 0) {
            if (_chordVerdictsLastNow !== null && now < _chordVerdictsLastNow - 0.25) {
                // already cleared above
            } else {
                const pruneBefore = ndVerdictT0 - 0.5; // safety margin
                const pruneBeforeKey = Math.round(pruneBefore * _CV_KEY_TIME_MUL) * _CV_KEY_TIME_SLOT;
                for (const k of _chordVerdicts.keys()) {
                    if (k < pruneBeforeKey) _chordVerdicts.delete(k);
                }
            }
        }
        _chordVerdictsLastNow = now;

        const notes = bundle.notes;
        const chords = mergeHandShapeSynthChordsCached(
            bundle.chords, bundle.handShapes, bundle.chordTemplates);

        let arpGhostHsInfer = null;
        const hsForArpGhost = bundle.handShapes;
        if (hsForArpGhost && hsForArpGhost.length && notes && notes.length) {
            const nHs = hsForArpGhost.length;
            while (_arpGhostHsInferScratch.length < nHs) _arpGhostHsInferScratch.push(false);
            // fillArpeggioGhostInferFlags is chart-static — skip if
            // the input refs match the previous frame's.
            if (_arpGhostInferRefHs !== hsForArpGhost
                || _arpGhostInferRefNotes !== notes
                || _arpGhostInferRefTpl !== bundle.chordTemplates) {
                _arpSynthOnsetHsSet.clear();
                fillArpeggioGhostInferFlags(hsForArpGhost, bundle.chordTemplates, notes, _arpGhostHsInferScratch, _arpSynthOnsetHsSet);
                _arpGhostInferRefHs = hsForArpGhost;
                _arpGhostInferRefNotes = notes;
                _arpGhostInferRefTpl = bundle.chordTemplates;
            }
            arpGhostHsInfer = _arpGhostHsInferScratch;
        }

        // ── Arpeggio-persist pre-pass ─────────────────────────────────
        // Notes in active arpeggio handshapes must keep rendering their
        // fretboard ghost + brackets until arpBounds.end, even after
        // their onset+sustain exits the normal back-window (t0 = now-0.5s).
        // Build a Set of "t_s" keys so the notes loop can skip the normal
        // window check for these notes.
        // Reuse hoisted Set — clear instead of reallocating every frame.
        _scrArpPersistKeys.clear();
        const _arpPersistKeys = _scrArpPersistKeys;
        if (arpGhostHsInfer && bundle.handShapes && notes) {
            for (let _hi = 0; _hi < bundle.handShapes.length; _hi++) {
                if (!arpGhostHsInfer[_hi]) continue;
                const _hs = bundle.handShapes[_hi];
                const _lo = hsStart(_hs), _hi2 = hsEnd(_hs);
                if (Number.isNaN(_lo) || Number.isNaN(_hi2)) continue;
                if (now > _hi2 + 0.05) continue; // arpeggio already ended
                // Only persist notes that have already exited the normal back-window
                // (onset+sustain < t0). Notes still in the window enter the loop via
                // the normal check; future notes are gated by the t1 check below.
                const _nLo = lowerBoundT(notes, _lo - 0.01);
                for (let _ni = _nLo; _ni < notes.length; _ni++) {
                    const _n = notes[_ni];
                    if (_n.t > _hi2 + 0.05) break;
                    if (_n.t + (_n.sus || 0) < t0) {
                        _arpPersistKeys.add(_noteKey(_n.t, _n.s));
                    }
                }
            }
        }

        // ── Slide-target gem-suppression pre-pass (chart-static) ──────
        // Detects notes in bundle.notes that are the slide/link destination
        // of a preceding note. The gem (outline+core) is suppressed via
        // skipBody=true, but the sustain/slide trail still renders because
        // the trail block is now outside the !skipBody gate in drawNote().
        //
        // NOTE: an authored `linkNext` flag is NOT present in bundle.notes —
        // note_to_wire() in lib/song.py emits only t, s, f, sus, sl, slu,
        // bn, ho, po, hm, hp, pm, mt, vb, tr, ac, tp. So this is an
        // intentional timing/fret heuristic, not a link-flag lookup.
        //
        // Two source patterns (source has sus > 0):
        //   Case 1 — source has sl/slu: destination.f === source's slide target
        //   Case 2 — same fret (hold), destination has sl/slu (hold→slide)
        //
        // Sources can be single notes OR chord notes (bundle.chords).
        if (notes !== _slideTargetNotesRef || bundle.chords !== _slideTargetChordsRef) {
            _slideTargetSet = null;
            if (notes && notes.length) {
                const stSet = new Set();
                const checkSrc = (srcT, srcS, srcF, srcSus, srcSl) => {
                    if (!(srcSus > 0)) return;
                    const endT = srcT + srcSus;
                    // Reuse the renderer's shared next-on-string tolerance
                    // rather than a separate hardcoded literal.
                    const EPS = NEXT_ON_STRING_T_EPS;
                    let lo = 0, hi = notes.length;
                    while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].t < endT - EPS) lo = m + 1; else hi = m; }
                    for (let j = lo; j < notes.length; j++) {
                        const q = notes[j];
                        if (q.t > endT + EPS) break;
                        if (q.s !== srcS || q.t <= srcT || Math.abs(q.t - endT) >= EPS) continue;
                        const qSl = (Number.isFinite(q.sl) && q.sl >= 0) ? q.sl
                                  : (Number.isFinite(q.slu) && q.slu >= 0) ? q.slu : -1;
                        if (srcSl >= 0 && q.f === srcSl) { stSet.add(_noteKey(q.t, q.s)); break; } // case 1
                        if (q.f === srcF && qSl >= 0)    { stSet.add(_noteKey(q.t, q.s)); break; } // case 2
                    }
                };
                for (let i = 0; i < notes.length; i++) {
                    const p = notes[i];
                    checkSrc(p.t, p.s, p.f, p.sus,
                        (Number.isFinite(p.sl) && p.sl >= 0) ? p.sl : (Number.isFinite(p.slu) && p.slu >= 0) ? p.slu : -1);
                }
                const rc = bundle.chords;
                if (rc && rc.length) {
                    for (let ci = 0; ci < rc.length; ci++) {
                        const ch = rc[ci]; if (!ch.notes) continue;
                        for (let ni = 0; ni < ch.notes.length; ni++) {
                            const cn = ch.notes[ni];
                            checkSrc(ch.t, cn.s, cn.f, cn.sus,
                                (Number.isFinite(cn.sl) && cn.sl >= 0) ? cn.sl : (Number.isFinite(cn.slu) && cn.slu >= 0) ? cn.slu : -1);
                        }
                    }
                }
                if (stSet.size > 0) _slideTargetSet = stSet;
            }
            _slideTargetNotesRef = notes;
            _slideTargetChordsRef = bundle.chords;
        }

        /** Arpeggio lane purple rails — authored-marker cache + bounds cache. */
        let laneRailArpHsFlags = null;
        let laneRailBoundLo = null;
        let laneRailBoundHi = null;
        const hsLaneRail = bundle.handShapes;
        const notesArrForRails = notes || [];
        if (hsLaneRail && hsLaneRail.length) {
            const nHsL = hsLaneRail.length;
            while (_arpLaneRailHsScratch.length < nHsL) _arpLaneRailHsScratch.push(false);
            while (_arpRailBoundLoScratch.length < nHsL) {
                _arpRailBoundLoScratch.push(0);
                _arpRailBoundHiScratch.push(0);
            }
            // Authored-marker flags depend only on (handShapes, templates).
            if (_laneRailFlagsRefHs !== hsLaneRail
                || _laneRailFlagsRefTpl !== bundle.chordTemplates) {
                fillLaneRailHandShapeFlags(hsLaneRail, bundle.chordTemplates, _arpLaneRailHsScratch);
                _laneRailFlagsRefHs = hsLaneRail;
                _laneRailFlagsRefTpl = bundle.chordTemplates;
            }
            // Bounds cache depends on (handShapes, chords, templates, notes).
            if (_laneRailBoundsRefHs !== hsLaneRail
                || _laneRailBoundsRefChords !== chords
                || _laneRailBoundsRefTpl !== bundle.chordTemplates
                || _laneRailBoundsRefNotes !== notesArrForRails) {
                fillArpeggioRailShapeBoundsCaches(
                    hsLaneRail,
                    chords ?? [],
                    bundle.chordTemplates,
                    notesArrForRails,
                    _arpLaneRailHsScratch,
                    _arpRailBoundLoScratch,
                    _arpRailBoundHiScratch,
                );
                _laneRailBoundsRefHs = hsLaneRail;
                _laneRailBoundsRefChords = chords;
                _laneRailBoundsRefTpl = bundle.chordTemplates;
                _laneRailBoundsRefNotes = notesArrForRails;
            }
            laneRailArpHsFlags = _arpLaneRailHsScratch;
            laneRailBoundLo = _arpRailBoundLoScratch;
            laneRailBoundHi = _arpRailBoundHiScratch;
        }
        const beats = bundle.beats;
        // Rebuild the fret-label visibility set whenever the chart changes.
        if (notes !== _fretLabelNotesRef) {
            _fretLabelAllowed = _buildFretLabelSet(notes, chords, beats);
            _fretLabelNotesRef = notes;
        }
        // Rebuild the measure-start time cache whenever beats change. Only
        // beats that begin a measure carry measure >= 0; intra-measure beats
        // (measure === -1) are skipped. Drives the lookahead window.
        if (beats !== _measureStartsRef) {
            _measureStartsRef = beats;
            const _ms = [];
            if (beats) {
                for (let _bi = 0; _bi < beats.length; _bi++) {
                    const _b = beats[_bi];
                    if (_b && Number.isFinite(_b.measure) && _b.measure >= 0) _ms.push(_b.time);
                }
            }
            _measureStarts = _ms;
        }
        const sections = bundle.sections;
        const anchors = bundle.anchors;

        // ── Fret wire anchor highlight ─────────────────────────────────
        // Default all wires to gray; wires inside the active anchor range
        // turn gold to match the dynamic highway lane boundary exactly.
        // Uses laneBoundsFromAnchor() — the same helper the lane uses —
        // so the gold fret wires on the board align with the lane edges:
        //   dMin = fret - 1,  dMax = fret + width - 1
        // e.g. { fret:3, width:4 } → dMin=2, dMax=6 → wires 2,3,4,5,6 gold.
        if (fretWireMats.length) {
            const _fwBounds = anchors && anchors.length
                ? anchorLaneBoundsAt(anchors, now) : null;
            const _fwMin = _fwBounds ? _fwBounds.dMin : -1;
            const _fwMax = _fwBounds ? _fwBounds.dMax : -1;
            for (let _f = 0; _f <= NFRETS; _f++) {
                const _m = fretWireMats[_f];
                if (!_m) continue;
                if (_fwMin >= 0 && _f >= _fwMin && _f <= _fwMax) {
                    _m.color.setHex(0xD8A636);
                    _m.opacity = 0.8;
                } else {
                    _m.color.setHex(0x666688);
                    _m.opacity = 0.4;
                }
            }
        }

        const lookaheadBoundsNow = (cameraMode === 'lookahead')
            ? lookaheadComputeFretBounds(now, anchors, notes, chords)
            : null;

        // Open-string note width: same outer span as chord frame (anchor + padX,
        // or default 4-fret window when chart has no anchor at t).
        const padChordOpenX = NW * 0.4;
        const openNoteLaneBoxW = chartTime => {
            const chAncB = anchorLaneBoundsAt(anchors, chartTime);
            if (chAncB) {
                const xl = fretX(chAncB.dMin);
                const xr = fretX(chAncB.dMax);
                if (xr > xl) return (xr - xl) + padChordOpenX * 2;
            }
            const spanF = 4;
            const fMinCh = 1;
            const fMaxCh = fMinCh + spanF - 1;
            const xl = fretX(fMinCh - 1);
            const xr = fretX(Math.max(fMaxCh, fMinCh + 2));
            if (xr > xl) return (xr - xl) + padChordOpenX * 2;
            return 40 * K;
        };

        // ── Frame state ───────────────────────────────────────────────
        // Reuse hoisted scratch arrays — reset only the live [0..nStr) /
        // [0..NFRETS] range instead of allocating new arrays every frame.
        _scrStringSustain.fill(false, 0, nStr);
        _scrStringAnticipation.fill(0, 0, nStr);
        _scrFretHeat.fill(0);           // always NFRETS+1, cheap flat fill
        _scrStrGlow.fill(0.5, 0, nStr);
        _scrAccentFillBoost.fill(0, 0, nStr);
        const noteState = {
            stringSustain:    _scrStringSustain,
            stringAnticipation: _scrStringAnticipation,
            fretHeat:         _scrFretHeat,
            strGlow:          _scrStrGlow,
            /** Per-string extra drive for `.ac` gem fill only (`mAccentCore`). */
            accentFillBoost:  _scrAccentFillBoost,
        };

        pbBeg(1);
        // Compute sustain / anticipation / fret heat / per-string glow.
        // Use lowerBoundT to skip notes far in the past (>30s sustain is
        // unrealistic); break once notes are >2s ahead (nothing beyond
        // contributes to fretHeat/anticipation/strGlow).
        if (notes) {
            const _fsLo = lowerBoundT(notes, now - 30);
            for (let _ni = _fsLo; _ni < notes.length; _ni++) {
                const n = notes[_ni];
                if (!validString(n.s)) continue;
                const dt = n.t - now;
                if (dt > 2.0) break;
                const susEnd = n.t + (n.sus || 0);
                if (dt > 0 && dt < 0.6)
                    noteState.stringAnticipation[n.s] = Math.max(noteState.stringAnticipation[n.s], 1 - dt / 0.6);
                if (n.f > 0) {
                    if (now >= n.t && now <= susEnd) noteState.fretHeat[n.f] = 1;
                    else if (n.t > now) noteState.fretHeat[n.f] = Math.max(noteState.fretHeat[n.f], Math.max(0, 1 - dt / 2));
                }
                if (now >= n.t && now <= susEnd) noteState.stringSustain[n.s] = true;
                const sustained = dt < 0 && (n.sus || 0) > 0 && now <= susEnd;
                const hitDist = Math.abs(dt);
                if (hitDist < 0.15 || sustained) {
                    const hitFade = sustained ? 0.7 : (1 - hitDist / 0.15);
                    noteState.strGlow[n.s] = Math.max(noteState.strGlow[n.s], 1.0 + hitFade * 1.5);
                }
            }
        }
        if (chords) {
            // Skip chords further than 30s in the past (covers any sustained chord).
            const _cfsLo = lowerBoundT(chords, now - 30);
            for (let _cni = _cfsLo; _cni < chords.length; _cni++) {
                const ch = chords[_cni];
                if (!ch.notes) continue;
                const dt = ch.t - now;
                if (dt > 2.0) break;
                const chordNotes = filterValidNotes(ch.notes);
                if (chordNotes.length === 0) continue;
                let maxSus = 0;
                for (const n of chordNotes) if ((n.sus || 0) > maxSus) maxSus = n.sus;
                const susEnd = ch.t + maxSus;
                for (const cn of chordNotes) {
                    if (dt > 0 && dt < 0.6)
                        noteState.stringAnticipation[cn.s] = Math.max(noteState.stringAnticipation[cn.s], 1 - dt / 0.6);
                    if (cn.f > 0) {
                        if (now >= ch.t && now <= susEnd) { noteState.fretHeat[cn.f] = 1; continue; }
                        if (ch.t > now) noteState.fretHeat[cn.f] = Math.max(noteState.fretHeat[cn.f], Math.max(0, 1 - dt / 2));
                    }
                }
                if (now >= ch.t && now <= susEnd)
                    for (const cn of chordNotes) noteState.stringSustain[cn.s] = true;
                const sustained = dt < 0 && maxSus > 0 && now <= susEnd;
                const hitDist = Math.abs(dt);
                if (hitDist < 0.15 || sustained) {
                    const hitFade = sustained ? 0.7 : (1 - hitDist / 0.15);
                    for (const cn of chordNotes) {
                        noteState.strGlow[cn.s] = Math.max(noteState.strGlow[cn.s], 1.0 + hitFade * 1.5);
                    }
                }
            }
        }

        pbEnd(1);
        pbBeg(2);
        // ── Next-note-by-string lookahead (for anticipation projection) ──
        // Ghost projection window is 0.6s; fretLastActiveTime needs +2s.
        // Use lowerBoundT to skip past notes and break at +2s.
        _scrNextNoteByString.fill(null, 0, nStr);
        const nextNoteByString = _scrNextNoteByString;
        if (notes) {
            const _nnLo = lowerBoundT(notes, now);
            for (let _ni = _nnLo; _ni < notes.length; _ni++) {
                const n = notes[_ni];
                if (n.t > now + 2) break;
                if (!validString(n.s)) continue;
                if (!nextNoteByString[n.s] || n.t < nextNoteByString[n.s].t) nextNoteByString[n.s] = n;
                if (n.f > 0) fretLastActiveTime[n.f] = now;
            }
        }
        if (chords) {
            // Time-sorted: lowerBoundT skips past historical chords in O(log N)
            // instead of walking the entire prefix every frame.
            const _ncLo = lowerBoundT(chords, now);
            for (let _ci = _ncLo; _ci < chords.length; _ci++) {
                const ch = chords[_ci];
                if (ch.t > now + 2) break;
                if (!ch.notes || ch.t <= now) continue;
                for (const cn of ch.notes) {
                    if (!validString(cn.s)) continue;
                    if (!nextNoteByString[cn.s] || ch.t < nextNoteByString[cn.s].t) {
                        // Reuse per-string scratch object — avoids `{ ...cn, t }` spread allocation.
                        const _sd = _scrNextNoteByStringData[cn.s];
                        Object.assign(_sd, cn);
                        _sd.t = ch.t;
                        nextNoteByString[cn.s] = _sd;
                    }
                    if (cn.f > 0) fretLastActiveTime[cn.f] = now;
                }
            }
        }

        _drawNextByString = nextNoteByString;
        _drawChordTemplates = bundle.chordTemplates ?? null;
        _drawTeachingMarks = !!bundle.teachingMarksVisible;
        // Default on: only an explicit false (older bundles omit the flag) hides fg.
        _showFingerHints = bundle.fingerHintsVisible !== false;

        // ── Recent-past event per string (for _nextAnyT deadline) ─────
        // Once a note/chord passes `now` it leaves _drawNextByString,
        // resetting _nextAnyT and letting old gems linger too long.
        // Scan back at least CHORD_HWY_LINGER_S so the deadline logic
        // can see every event that lands inside any active linger
        // window (chord frame linger and gem linger both cap at
        // CHORD_HWY_LINGER_S — a tighter scan would miss events in
        // (now - CHORD_HWY_LINGER_S, now - 0.6) and let the frame
        // linger past the next event).
        {
            // Hoisted scratch — avoids `new Array(nStr).fill(...)` every frame.
            const _recArr = _scrRecentByString;
            for (let i = 0; i < nStr; i++) _recArr[i] = -Infinity;
            if (notes) {
                let _ri = lowerBoundT(notes, now);
                for (let i = _ri - 1; i >= 0; i--) {
                    const n = notes[i];
                    if (n.t < now - CHORD_HWY_LINGER_S) break;
                    if (validString(n.s) && n.t > _recArr[n.s]) _recArr[n.s] = n.t;
                }
            }
            if (chords) {
                // Time-sorted: start at the last chord ≤ now instead of
                // chords.length-1 (which walks past every future chord
                // when `now` is early in the song).
                //
                // lowerBoundT returns the first index with t >= now. If
                // chords share the same timestamp, walk forward through
                // the t===now run to the LAST one (so all duplicates at
                // `now` are included — the original `if (ch.t > now)
                // continue` scan-from-end included them all). When no
                // chord is exactly at `now`, start one slot back.
                const _ncHi = lowerBoundT(chords, now);
                let _ci = _ncHi;
                if (_ci < chords.length && chords[_ci].t === now) {
                    while (_ci + 1 < chords.length && chords[_ci + 1].t === now) _ci++;
                } else {
                    _ci -= 1;
                }
                for (; _ci >= 0; _ci--) {
                    const ch = chords[_ci];
                    if (ch.t < now - CHORD_HWY_LINGER_S) break;
                    if (!ch.notes) continue;
                    for (const cn of ch.notes) {
                        if (validString(cn.s) && ch.t > _recArr[cn.s]) _recArr[cn.s] = ch.t;
                    }
                }
            }
            _drawRecentByString = _recArr;
        }

        // ── Sorted union of next/recent event times ──────────────────
        // Populate the scalar scratch used by _firstEventTimeGreaterThan
        // — at most 2 * nStr finite values, then sorted ascending.
        // Float64Array.subarray returns a view, so .sort() runs in place
        // over the live prefix without copying or allocating.
        // Pulls directly from _drawNextByString / _drawRecentByString
        // (closure-scoped, populated just above) so we're independent of
        // the recent-event prepass's inner-block ``_recArr`` alias.
        _scrEventTimesLen = 0;
        for (let s = 0; s < nStr; s++) {
            const nf = _drawNextByString[s];
            if (nf) {
                const tn = nf.t;
                if (Number.isFinite(tn)) _scrEventTimes[_scrEventTimesLen++] = tn;
            }
            const rt = _drawRecentByString[s];
            if (Number.isFinite(rt)) _scrEventTimes[_scrEventTimesLen++] = rt;
        }
        if (_scrEventTimesLen > 1) {
            _scrEventTimes.subarray(0, _scrEventTimesLen).sort();
        }

        // ── Ghost preview gap prepass ──────────────────────────────────
        // For each note/chord in the upcoming 0.65s window, record the
        // onset time of its immediate predecessor on the same string.
        // drawNote() uses this to shrink the ghost preview window from
        // the fixed 0.6s down to min(0.6, gap) so in dense passages the
        // fret label doesn't float 0.6s ahead with no gem in sight.
        //
        // Two-pointer merge over time-sorted notes + chords so the
        // predecessor is correct even when notes and chords interleave.
        // Map with numeric key avoids per-frame string allocation;
        // key = Math.round(t*1e4)*10 + s (unique for notes > 0.1 ms apart).
        // Buffer is hoisted (_scrGhostPrevBuf) and cleared at the top of
        // the prepass; per-string predecessor tracker likewise (_scrGhostLastT).
        _scrGhostPrevBuf.clear();
        const _ghostPrevBuf = _scrGhostPrevBuf;
        {
            for (let _i = 0; _i < nStr; _i++) _scrGhostLastT[_i] = -Infinity;
            const _gLastT = _scrGhostLastT;
            let _gni = notes ? lowerBoundT(notes, now - 1) : 0;
            let _gci = 0;
            if (chords) while (_gci < chords.length && chords[_gci].t < now - 1) _gci++;
            while (true) {
                const nt = (notes && _gni < notes.length) ? notes[_gni].t : Infinity;
                const ct = (chords && _gci < chords.length) ? chords[_gci].t : Infinity;
                const minT = nt <= ct ? nt : ct;
                if (minT > now + 0.65 || minT === Infinity) break;
                if (nt <= ct) {
                    const n = notes[_gni++];
                    if (validString(n.s)) {
                        _ghostPrevBuf.set(Math.round(n.t * 1e4) * 10 + n.s, _gLastT[n.s]);
                        _gLastT[n.s] = n.t;
                    }
                } else {
                    const ch = chords[_gci++];
                    if (ch.notes) for (const cn of ch.notes) {
                        if (validString(cn.s)) {
                            _ghostPrevBuf.set(Math.round(ch.t * 1e4) * 10 + cn.s, _gLastT[cn.s]);
                            _gLastT[cn.s] = ch.t;
                        }
                    }
                }
            }
        }

        // Ramp strGlow while the board ghost is visible so the flying note
        // core + rim read as one solid string-coloured shape with proj.
        // Window is (0, PROJ_WIN_MERGE=0.6s) — use lowerBoundT + break.
        const PROJ_WIN_MERGE = 0.6;
        if (notes) {
            const _sgLo = lowerBoundT(notes, now);
            for (let _ni = _sgLo; _ni < notes.length; _ni++) {
                const n = notes[_ni];
                if (!validString(n.s) || n.f <= 0) continue;
                const dt = n.t - now;
                if (dt >= PROJ_WIN_MERGE) break;
                const nn = nextNoteByString[n.s];
                if (!nn || Math.abs(nn.t - n.t) > NEXT_ON_STRING_T_EPS) continue;
                const blend = 1 - dt / PROJ_WIN_MERGE;
                noteState.strGlow[n.s] = Math.max(noteState.strGlow[n.s], 1.0 + blend * 1.2);
            }
        }
        if (chords) {
            const _projLo = lowerBoundT(chords, now);
            for (let _pci = _projLo; _pci < chords.length; _pci++) {
                const ch = chords[_pci];
                if (!ch.notes || ch.t <= now) continue;
                const dt = ch.t - now;
                if (dt >= PROJ_WIN_MERGE) break;
                const chordNotes = filterValidNotes(ch.notes);
                for (const cn of chordNotes) {
                    if (cn.f <= 0) continue;
                    const nn = nextNoteByString[cn.s];
                    if (!nn || Math.abs(nn.t - ch.t) > NEXT_ON_STRING_T_EPS) continue;
                    const blend = 1 - dt / PROJ_WIN_MERGE;
                    noteState.strGlow[cn.s] = Math.max(noteState.strGlow[cn.s], 1.0 + blend * 1.2);
                }
            }
        }

        // Accent: brighter note body (`mGlow` in drawNote) instead of the old '>' sprite.
        // Notes are sorted — break once past the AHEAD window.
        if (notes) {
            const _acLo = lowerBoundT(notes, now - AHEAD);
            for (let _ni = _acLo; _ni < notes.length; _ni++) {
                const n = notes[_ni];
                if (!validString(n.s) || !n.ac) continue;
                const dt = n.t - now;
                if (dt > AHEAD) break;
                const susEnd = n.t + (n.sus || 0);
                const hasSus = (n.sus || 0) > 0;
                if (dt < -ACCENT_NOTE_LINGER_EPS && (!hasSus || now > susEnd)) continue;
                noteState.strGlow[n.s] = Math.max(noteState.strGlow[n.s], ACCENT_NOTE_STR_GLOW);
                noteState.accentFillBoost[n.s] = Math.max(
                    noteState.accentFillBoost[n.s],
                    ACCENT_NOTE_FILL_BOOST,
                );
            }
        }
        if (chords) {
            const _acChordLo = lowerBoundT(chords, now - 30);
            for (let _aci = _acChordLo; _aci < chords.length; _aci++) {
                const ch = chords[_aci];
                if (!ch.notes) continue;
                const dt = ch.t - now;
                if (dt > AHEAD) break;
                const chordNotes = filterValidNotes(ch.notes);
                if (!chordNotes.length) continue;
                let maxSus = 0;
                for (const x of chordNotes) if ((x.sus || 0) > maxSus) maxSus = x.sus;
                const susEnd = ch.t + maxSus;
                const hasChordSus = maxSus > 0;
                if (dt < -ACCENT_NOTE_LINGER_EPS && (!hasChordSus || now > susEnd)) continue;
                for (const cn of chordNotes) {
                    if (!validString(cn.s) || !cn.ac) continue;
                    noteState.strGlow[cn.s] = Math.max(noteState.strGlow[cn.s], ACCENT_NOTE_STR_GLOW);
                    noteState.accentFillBoost[cn.s] = Math.max(
                        noteState.accentFillBoost[cn.s],
                        ACCENT_NOTE_FILL_BOOST,
                    );
                }
            }
        }

        pbEnd(2);
        pbBeg(3);
        // mGlow / mAccentCore emissive writes are folded into
        // updateStringHighlights() — same per-string scratch reads,
        // one pass.
        updateStringHighlights(noteState);
        pbEnd(3);

        // Active frets (notes in cooldown window) + highway intensity
        _scrActiveFrets.clear();
        const activeFrets = _scrActiveFrets;
        let highwayIntensity = 0;
        for (let f = 1; f <= NFRETS; f++) {
            if (now - fretLastActiveTime[f] < FRET_COOLDOWN) activeFrets.add(f);
        }

        // Camera targeting — steady mode (#34): recency-weighted centroid +
        // hysteresis over [camT0, camT1]. In lookahead mode, see
        // lookaheadBoundsNow + lookaheadSmoothCamStep().
        let cs = 0;
        let camAhead = CAM_TGT_AHEAD_C;
        let camTau = CAM_TGT_TAU_C;
        let camHystF = CAM_TGT_HYST_C;
        let camT0 = now - CAM_TGT_BEHIND;
        let camT1 = now + camAhead;
        let camWX = 0, camWSum = 0;
        let camDistMin = 99, camDistMax = 0, camDistGot = false;
        const camDistHystF = CAM_DIST_HYST_T + (CAM_DIST_HYST_C - CAM_DIST_HYST_T) * zoomSmoothing;
        if (!(cameraMode === 'lookahead')) {
            cs = cameraSmoothing;
            camAhead = CAM_TGT_AHEAD_T + (CAM_TGT_AHEAD_C - CAM_TGT_AHEAD_T) * cs;
            camTau = CAM_TGT_TAU_T + (CAM_TGT_TAU_C - CAM_TGT_TAU_T) * cs;
            camHystF = CAM_TGT_HYST_T + (CAM_TGT_HYST_C - CAM_TGT_HYST_T) * cs;
            camT0 = now - CAM_TGT_BEHIND;
            camT1 = now + camAhead;
        }

        // Classic path (#34): tgtDist hysteresis tracks fret span over the
        // narrowed [camT0, camT1]; lookahead mode uses lookaheadBoundsNow + span smoothing.
        //
        // Sustain extension: the outer loop keeps notes/chords
        // whose sustain still rings into the visible window —
        // n.t + (n.sus || 0) >= t0 for notes, ch.t + maxSus >= t0
        // for chords — via the continue-filters below at the top
        // of the single-note and chord branches. camT0 is narrower
        // than t0, so an onset can age past camT0 while still
        // being on screen and audible. Mirror that past-side
        // allowance here so a held low-fret chord keeps
        // contributing to both camDist (zoom) and camWX (X
        // target); otherwise the camera dollies/pans away
        // mid-sustain, re-clipping the very chord the low-fret
        // pullback was added to keep on screen. The future side
        // (camT1) is left alone so the #34 invariant (distant
        // high-fret onsets don't pre-pull the camera) still holds.

        // ── Song-change detection ─────────────────────────────────────────
        // reconnect() (used for arrangement switches and splitscreen song
        // changes) does not call renderer.destroy/init, so _camSnapped and
        // _camPreScanned would persist into the new song and the snap pre-pass
        // would never fire again.  Detect the change by comparing the current
        // song+arrangement identity against the last-seen key, and reset the
        // camera snap state (and the camera position itself) whenever it flips.
        {
            const si = bundle.songInfo;
            // bundle.songInfo has no filename field (the WS song_info message
            // never includes it).  Use window.feedBack.currentSong.filename
            // — set by highway.js from the WS URL — combined with the
            // arrangement index as a reliable per-song-arrangement key.
            const currentSong = window.feedBack && window.feedBack.currentSong;
            const key = currentSong ? currentSong.filename + '\0' + (si ? (si.arrangement_index ?? '') : '') : null;
            if (key !== null && key !== _songKey) {
                _songKey = key;
                _camSnapped = false;
                _camPreScanned = false;
                tgtX = curX = xFretMid(CAM_LOCK_CENTER_FRET);
                tgtDist = curDist = CAM_DIST_BASE;
                prevLowFretBonus = 0;
                prevLockActive = false;
                _lookaheadCamX = xFretMid(CAM_LOCK_CENTER_FRET);
                _lookaheadFretSpan = DEFAULT_LOOKAHEAD_FRET_SPAN;
                _lookaheadCamPrevNow = null;
                _lookaheadLowBonusU = 0;
                _lookaheadHiNeckLatch = false;
                // Drop the previous song's measure-start cache. Otherwise
                // lookaheadEndTime() would size the lookahead window off the
                // old measure grid (with the new song's now reset to ~0 this
                // yields a wrong/huge tEnd) until the new beats arrive and
                // rebuild it — the resulting huge fret span over-zooms the
                // first-data snap and stays latched. Clearing it falls back
                // to the seconds window for this frame; the rebuild repopulates
                // it next frame once bundle.beats is the new array.
                _measureStarts = []; _measureStartsRef = null;
                // Drop the clock anchor so the new song's currentTime
                // re-anchors cleanly instead of measuring a bogus rate
                // across the seek-to-0 discontinuity.
                _clkAudioT = NaN; _clkPerf = NaN; _clkRate = 1;
            }
        }

        // ── Camera pre-pass (first-data snap) ────────────────────────────
        // Before any drawNote() call, iterate notes/chords to accumulate
        // the camera targeting data for THIS frame.  If this is the first
        // frame where fretted notes appear in the targeting window, snap
        // curX/curDist directly to the computed targets so open-string note
        // placement (which reads curX) and the camera are consistent on the
        // snap frame.  After the snap _camSnapped is true and this block
        // becomes a permanent no-op.  Open-string notes (f === 0) do not
        // contribute to preWX/preWSum and therefore do not trigger the snap.
        if (!_camSnapped) {
            // One-time full-chart scan (runs exactly once when both bundle.notes
            // and bundle.chords are available).  If no fretted note exists
            // anywhere in either array the snap can never fire, so we disable
            // the per-frame pre-pass immediately to avoid permanent overhead.
            // Both arrays are checked because some arrangements have fretted
            // notes only inside chords (chord-only charts, keys arrangements).
            if (!_camPreScanned && notes && chords) {
                _camPreScanned = true;
                const hasFrettedNote  = notes.some(n => n.f > 0 && validString(n.s));
                const hasFrettedChord = chords.some(
                    ch => ch.notes && ch.notes.some(cn => cn.f > 0 && validString(cn.s)));
                if (!hasFrettedNote && !hasFrettedChord) _camSnapped = true;
            }
            if (!_camSnapped) {
                if (cameraMode === 'lookahead') {
                    const bd = lookaheadBoundsNow;
                    if (bd) {
                        _lookaheadCamX = lookaheadTargetWorldX(bd.minF, bd.maxF);
                        _lookaheadFretSpan = Math.max(1, bd.maxF - bd.minF + 1);
                        const lockSnapEl = cameraLockLow && bd.maxF <= 12;
                        if (lockSnapEl) {
                            const lockedBaseU = camBaseDistU(12);
                            const lockedBonusU = camLowFretPullbackU(1);
                            const lockZoomMul = CAM_LOCK_ZOOM_MIN +
                                (CAM_LOCK_ZOOM_MAX - CAM_LOCK_ZOOM_MIN) * cameraLockZoom;
                            tgtX = xFretMid(CAM_LOCK_CENTER_FRET);
                            tgtDist = (lockedBaseU + lockedBonusU) * K * lockZoomMul;
                            prevLowFretBonus = lockedBonusU;
                            _lookaheadLowBonusU = lockedBonusU;
                        } else {
                            const baseDU = camBaseDistU(_lookaheadFretSpan);
                            const lowBU = camLowFretPullbackU(bd.minF);
                            tgtDist = (baseDU + lowBU) * K;
                            prevLowFretBonus = lowBU;
                            _lookaheadLowBonusU = lowBU;
                            tgtX = _lookaheadCamX;
                        }
                        curX = tgtX;
                        curDist = tgtDist;
                        _camSnapped = true;
                        _lookaheadCamPrevNow = now;
                    }
                } else {
                let preWX = 0, preWSum = 0, preDistMin = 99, preDistMax = 0, preDistGot = false;
                if (notes) {
                    for (const n of notes) {
                        // bundle.notes is time-sorted: skip fully-expired sustains,
                        // break once the onset is beyond the camera window.
                        if (n.t + (n.sus || 0) < camT0) continue;
                        if (n.t > camT1) break;
                        if (!validString(n.s)) continue;
                        const nInWin  = n.f > 0 && n.t >= camT0;
                        const nSusNow = n.f > 0 && n.t < camT0 && n.t + (n.sus || 0) >= now;
                        if (nInWin || nSusNow) {
                            const w = Math.exp(-Math.abs(n.t - now) / camTau);
                            preWX += xFretMid(n.f) * w; preWSum += w;
                            if (n.f < preDistMin) preDistMin = n.f;
                            if (n.f > preDistMax) preDistMax = n.f;
                            preDistGot = true;
                        }
                    }
                }
                if (chords) {
                    for (const ch of chords) {
                        if (!ch.notes) continue;
                        // bundle.chords is time-sorted: break once onset is beyond window.
                        if (ch.t > camT1) break;
                        const chNotes = filterValidNotes(ch.notes);
                        if (!chNotes.length) continue;
                        let maxSus = 0;
                        for (const n of chNotes) if ((n.sus || 0) > maxSus) maxSus = n.sus;
                        if (ch.t + maxSus < camT0) continue; // fully expired
                        const chOnsetInWin = ch.t >= camT0;
                        const chSusNow     = ch.t < camT0 && ch.t + maxSus >= now;
                        if (!chOnsetInWin && !chSusNow) continue;
                        const chW = Math.exp(-Math.abs(ch.t - now) / camTau);
                        for (const cn of chNotes) {
                            const cnOk = chOnsetInWin || (chSusNow && ch.t + (cn.sus || 0) >= now);
                            if (cn.f > 0 && cnOk) {
                                preWX += xFretMid(cn.f) * chW; preWSum += chW;
                                if (cn.f < preDistMin) preDistMin = cn.f;
                                if (cn.f > preDistMax) preDistMax = cn.f;
                                preDistGot = true;
                            }
                        }
                    }
                }
                if (preWSum > 0) {
                    _applyNoteCamTargets(preWX, preWSum, preDistMin, preDistMax, preDistGot,
                                         camHystF, camDistHystF, /* skipDistHyst= */ true);
                    curX    = tgtX;
                    curDist = tgtDist;
                    _camSnapped = true;
                }
                } // end steady-mode pre-pass branch
            } // end !_camSnapped (post-prescan guard)
        }

        pbBeg(4);
        // ── Single notes ──────────────────────────────────────────────
        // Reset the per-frame fret-label dedup set so stacked labels from
        // multiple strings at the same onset/fret (arpeggio, synth chord) don't repeat.
        _frameLabeledKeys.clear();
        // Tracks which (chordId → Set<stringIndex>) pairs already had
        // brackets drawn by the note-stream loop, so the chord loop can
        // skip duplicate bracket draws for the same string.
        // Hoisted Map — clear (rather than reallocate) so the per-frame
        // chord-bracket dedupe doesn't churn GC in dense arpeggio passages.
        // (The inner Sets stored as values lose their Map reference on
        // .clear() and get GC'd along with the keys; only the outer Map
        // is reused.)
        _scrNoteStreamBracketStrings.clear();
        const _noteStreamBracketStrings = _scrNoteStreamBracketStrings;
        _scrLastFretForString.fill(undefined, 0, nStr);
        const lastFretForString = _scrLastFretForString;
        if (notes) {
            // Start 30s before now — conservative enough to include any arpeggio
            // persist window while skipping the bulk of old notes in long songs.
            // The arpPersistKeys check below guards the rare notes that are even
            // older and still visible (only possible for unrealistically long HS).
            const _noteRenderLo = lowerBoundT(notes, now - 30);
            for (let _ni = _noteRenderLo; _ni < notes.length; _ni++) {
                const n = notes[_ni];
                if (n.f > 0 && n.t > now && n.t < now + 2) activeFrets.add(n.f);
                if (n.t > now) {
                    const dt = n.t - now;
                    if (dt < AHEAD) highwayIntensity = Math.max(highwayIntensity, 1 - dt / AHEAD);
                }
                // Far-future notes are always skipped — arpGhostActive
                // timing handles when the ghost appears for upcoming arp notes.
                // Notes are time-sorted so everything beyond t1 can be skipped entirely.
                if (n.t > t1) break;
                // Past-window arp notes are exempted from the back-window skip
                // so their fretboard ghost + brackets persist until arpBounds.end.
                // ndVerdictT0 extends the window when a note-detect provider is
                // attached so async verdicts still land while drawable.
                const _inArpPersist = _arpPersistKeys.has(_noteKey(n.t, n.s));
                if (!_inArpPersist && n.t + (n.sus || 0) < ndVerdictT0) continue;
                if (!validString(n.s)) continue;
                // Suppress the gem for linkNext slide-target notes (skipBody=true).
                // The sustain/slide trail still renders because it now lives outside
                // the !skipBody gate in drawNote().
                const _isSlideTgt = !!(_slideTargetSet && _slideTargetSet.has(_noteKey(n.t, n.s)));
                // Always show the fret label — suppressing it for repeated frets on the same
                // string caused the label to be invisible throughout the note's flight and
                // only appear moments before being played (when the previous note's linger
                // window expired).  Each note now owns its label for its full flight.
                const skipLabel = false;
                let singleOpenX;
                if (n.f === 0) {
                    const ab = anchorLaneBoundsAt(anchors, n.t);
                    if (ab) singleOpenX = (xFret(ab.dMin) + xFret(ab.dMax)) / 2;
                }
                const singleOpenLaneW = n.f === 0 ? openNoteLaneBoxW(n.t) : undefined;
                const arGhostCid = arpeggioChordIdForNoteWithInferCache(
                    n,
                    bundle.handShapes,
                    bundle.chordTemplates,
                    notes,
                    arpGhostHsInfer,
                );
                const _arpBoundsForNote = arGhostCid != null
                    ? arpHsBoundsForNote(n, bundle.handShapes, arpGhostHsInfer)
                    : null;
                drawNote(
                    n,
                    now,
                    singleOpenX,
                    skipLabel,
                    _isSlideTgt,
                    GHOST_HOLD_AFTER_ONSET,
                    singleOpenLaneW,
                    arGhostCid != null,
                    arGhostCid,
                    arGhostCid != null,
                    _arpBoundsForNote,
                    _ghostPrevBuf.get(Math.round(n.t * 1e4) * 10 + n.s) ?? -Infinity,
                    _arpBoundsForNote !== null, // showDropLine: white line for arp note-stream notes
                );
                if (arGhostCid != null) {
                    const _arpBounds = _arpBoundsForNote;
                    if (_arpBounds) {
                        // Synth-onset-match handshapes show ghost fret numbers but not [ ] brackets.
                        if (!_arpSynthOnsetHsSet.has(_arpBounds.start)) {
                            // Open-string bracket X: always use the anchor at the
                            // handshape START time (not n.t, not now) so the bracket
                            // position stays fixed throughout the arpeggio even when
                            // the chart anchor changes mid-pattern.
                            const _arpBrktAncB = n.f === 0
                                ? anchorLaneBoundsAt(anchors, _arpBounds.start)
                                : null;
                            const _bx = n.f === 0
                                ? (_arpBrktAncB
                                    ? (xFret(_arpBrktAncB.dMin) + xFret(_arpBrktAncB.dMax)) / 2
                                    : (singleOpenX !== undefined ? singleOpenX : curX))
                                : xFretMid(n.f);
                            const _openHalfW = (() => {
                                if (n.f !== 0) return null;
                                if (_arpBrktAncB) {
                                    const _xl = xFret(_arpBrktAncB.dMin), _xr = xFret(_arpBrktAncB.dMax);
                                    if (_xr > _xl) return Math.max(0.22, (_xr - _xl + NW * 0.4 * 2) * 0.96 / (40 * K)) * 20 * K;
                                }
                                return singleOpenLaneW != null ? Math.max(0.22, singleOpenLaneW * 0.96 / (40 * K)) * 20 * K : null;
                            })();
                            drawArpBrackets(_bx, sY(n.s), _arpBounds.start - now, _arpBounds.end, now, n.s, n.f === 0, _openHalfW);
                            // Record that this (chordId:occurrenceStart, string) pair has brackets
                            // so the chord loop doesn't draw a second set on the same string.
                            // Key includes the arp occurrence start time so two separate arp
                            // sequences sharing the same chord template ID don't suppress each other.
                            const _nsbKey = arGhostCid + ':' + _arpBoundsForNote.start;
                            let _nsbSet = _noteStreamBracketStrings.get(_nsbKey);
                            if (!_nsbSet) { _nsbSet = new Set(); _noteStreamBracketStrings.set(_nsbKey, _nsbSet); }
                            _nsbSet.add(n.s);
                        }
                    }
                }
                lastFretForString[n.s] = n.f;
                // Onset in window OR started before the window but
                // still sustaining right now. Gate sustain carry-over
                // against the current frame time so camera framing
                // releases as soon as the sustain is no longer
                // rendered on screen.
                if (!(cameraMode === 'lookahead')) {
                const nInWin = n.t >= camT0 && n.t <= camT1;
                const nSusActive = n.t < camT0 && n.t + (n.sus || 0) >= now;
                if (n.f > 0 && (nInWin || nSusActive)) {
                    // Symmetric decay around now: previously this
                    // clamped n.t - now at 0, giving every past-
                    // onset note weight 1. That was a tolerable
                    // approximation when the past window was 0.2 s
                    // (camT0), but the sustain extension widens
                    // the past side to seconds for held notes — a
                    // 2-second-old ringing sustain would otherwise
                    // pin camWX as strongly as a fresh note and
                    // stale-out the framing for the current
                    // phrase. Math.abs lets old sustains decay on
                    // the same time-constant as future notes,
                    // matching each mode's intent: twitchy
                    // (camTau=0.35 s) drops a 0.2 s-old note's
                    // weight to ~0.56 (consistent with "react to
                    // recent only"), calm (camTau=0.9 s) to ~0.80
                    // (consistent with "average a wider window").
                    // Weight is still 1 at onset.
                    const w = Math.exp(-Math.abs(n.t - now) / camTau);
                    camWX   += xFretMid(n.f) * w;
                    camWSum += w;
                    if (n.f < camDistMin) camDistMin = n.f;
                    if (n.f > camDistMax) camDistMax = n.f;
                    camDistGot = true;
                }
                }
            }
        }

        pbEnd(4);
        pbBeg(5);
        // ── Chords ────────────────────────────────────────────────────
        if (chords) {
            // Single-pass shape-run tracking: the previous pre-loop scanned
            // every chord (and re-allocated chordShapeSignature() per chord)
            // each frame, even though the render loop already iterates the
            // full array. We compute runSig inline once per chord and reuse
            // it for both first-in-run detection and isRepeat below.
            // SHAPE_RUN_GAP_S also resets the run when the time gap from
            // the previous chord exceeds the same 0.5 s window used for
            // isRepeat — a chord shape that re-appears after a real
            // musical gap should re-show its label, not be treated as a
            // continuing run from many bars ago.
            const SHAPE_RUN_GAP_S = 0.5;
            let runSigPrev = null;
            let prevAnyChordTime = -Infinity;
            let prevChordSig = null;
            let prevChordTime = -1;

            // Skip past chords that are too old to render. The per-chord filter
            // (ch.t + _chFilterSus >= ndVerdictT0) passes the earliest chord when
            // ch.t >= ndVerdictT0 - AHEAD (worst case: _chFilterSus = AHEAD for a
            // chord with no explicit sustain). Binary search avoids iterating
            // hundreds of past chords every frame in dense PM/FH sections.
            const _chordsLoIdx = lowerBoundT(chords, ndVerdictT0 - AHEAD);
            // Prime shape-run tracking from the chord immediately before the window
            // so isRepeat and firstInShapeRun are correct on the first visible chord.
            if (_chordsLoIdx > 0) {
                const _pc = chords[_chordsLoIdx - 1];
                if (_pc && _pc.notes) {
                    const _ps = chordShapeSignature(_pc);
                    if (_ps !== null) {
                        runSigPrev = _ps;
                        prevAnyChordTime = _pc.t;
                        prevChordSig = _ps;
                        prevChordTime = _pc.t;
                    }
                }
            }

            for (let ci = _chordsLoIdx; ci < chords.length; ci++) {
                const ch = chords[ci];
                // Chords are time-sorted — everything beyond t1 is outside the
                // visible window and contributes nothing (activeFrets needs t<now+2,
                // highwayIntensity needs dt<AHEAD, both < t1).
                if (ch.t > t1) break;
                const runSig = chordShapeSignature(ch);
                let firstInShapeRun;
                if (runSig === null) {
                    firstInShapeRun = true;
                } else {
                    const gap = ch.t - prevAnyChordTime;
                    firstInShapeRun = (runSig !== runSigPrev) || gap > SHAPE_RUN_GAP_S;
                    runSigPrev = runSig;
                    // Only valid chords update the run-gap clock — an entry
                    // whose runSig is null (no notes / unusable chordId)
                    // shouldn't make the next real chord look like a tiny
                    // gap and silently fall into a "still in the run" state.
                    prevAnyChordTime = ch.t;
                }
                if (!ch.notes) continue;
                // Filter chord notes to in-range strings once. All
                // chord-level aggregations (maxSus, repeat-chord
                // signature, open-string centroid, frame-box bounds,
                // active-fret highlights, camera-window dist) read
                // from chordNotes so a clamped 9th-string note can't,
                // for instance, extend the chord's linger beyond its
                // visible sustain.
                const chordNotes = filterValidNotes(ch.notes);
                if (chordNotes.length === 0) continue;
                const chShape = mergeChordShape(ch, chordNotes, bundle.chordTemplates);

                if (ch.t > now) {
                    const dt = ch.t - now;
                    if (dt < AHEAD) highwayIntensity = Math.max(highwayIntensity, 1 - dt / AHEAD);
                }
                if (ch.t > now && ch.t < now + 2)
                    for (const cn of chordNotes) { if (cn.f > 0) activeFrets.add(cn.f); }

                let maxSus = 0;
                for (const n of chordNotes) if ((n.sus || 0) > maxSus) maxSus = n.sus;
                // When maxSus=0 (no explicit sustain on chord notes, including
                // all h3dSynth chords) use AHEAD as the filter window so the
                // chord stays in the loop long enough for a handshape-derived
                // sustain rail to finish drawing. The rail itself gates on
                // _dtSusEnd>0, so chords with no actual sustain produce no
                // visual artifact despite staying in the loop longer.
                // ndVerdictT0 extends the window when a note-detect provider is
                // attached so async verdicts still land while drawable.
                const _chFilterSus = maxSus > 0 ? maxSus : AHEAD;
                if (ch.t + _chFilterSus < ndVerdictT0) continue;
                if (ch.t > t1) break;

                // Repeat-chord detection (consecutive same shape, short gap).
                // Reuses runSig computed at loop entry — same signature as the
                // dedicated chordShapeSignature() call we used to make twice.
                // Synthetic chords (h3dSynth — injected at handshape onsets by
                // mergeHandShapeSynthChords) are never real strums, so they must
                // not update prevChordSig/prevChordTime. Without this guard a
                // real chord whose handshape generates a synth onset at the
                // handshape start_time (e.g. a slide-in where the real strum
                // falls mid-handshape, > 28 ms after the onset) would see the
                // synth as its "previous chord" and be falsely flagged isRepeat.
                const isRepeat = runSig !== null && prevChordSig === runSig && Math.abs(ch.t - prevChordTime) < 0.5;
                if (!ch.h3dSynth) {
                    prevChordSig = runSig;
                    prevChordTime = ch.t;
                }

                // Anchor selection for chord frame + open-string X + sustain rails:
                // • Upcoming (chDtEarly > 0): onset time — frame previews the correct
                //   neck region before the chord hits the line.
                // • Past, actively sustaining (now < ch.t + maxSus): onset time — frame
                //   stays at the frets where the chord was struck. Using `now` here
                //   causes the frame to jump to whichever anchor is active at `now`,
                //   which may be a different/wider region and makes the sustain box
                //   appear in the wrong fret zone ("invading" adjacent anchors).
                // • Past, linger-only (sustain expired or chord had no sustain): `now`
                //   — brief fade-out frame tracks the current lane position so it
                //   doesn't visibly drift while the lane has already transitioned.
                const chDtEarly = ch.t - now;
                const _chAnchorT = chDtEarly > 0 ? ch.t
                    : (maxSus > 0 && now < ch.t + maxSus) ? ch.t
                    : now;
                const chAncB = anchorLaneBoundsAt(anchors, _chAnchorT);
                // Open-string X: chart <anchor> lane centre when present (not curX /
                // fretted centroid), matching highway span.
                let chordCX = curX;
                if (chAncB) chordCX = (xFret(chAncB.dMin) + xFret(chAncB.dMax)) / 2;
                else {
                    let cxL = Infinity, cxR = -Infinity, fretted = 0;
                    for (const cn of chordNotes) {
                        if (cn.f > 0) {
                            const fx = xFretMid(cn.f);
                            if (fx < cxL) cxL = fx;
                            if (fx > cxR) cxR = fx;
                            fretted++;
                        }
                    }
                    if (fretted > 0) chordCX = (cxL + cxR) / 2;
                }

                // Horizontals for chord frame + open-string mesh width. With anchors,
                // span matches HWY lane columns (wire dMin..dMax); no extra pad.
                let chordFrameXL = null, chordFrameXR = null, chordOpenBoxW = null;
                let chordFrameAnchorMatched = false;
                if (chShape.size > 1) {
                    let fMinCh = 99, fMaxCh = 0, anyFretted = false;
                    for (const [, f] of chShape) {
                        if (f > 0) {
                            anyFretted = true;
                            fMinCh = Math.min(fMinCh, f);
                            fMaxCh = Math.max(fMaxCh, f);
                        }
                    }
                    // Prefer the anchor span so chord frames and arpeggio
                    // frames align with the highway lane window — BUT only
                    // when the chord's fretted notes actually fall within
                    // the anchor range. If the anchor at this chord's time
                    // doesn't cover the chord's frets (e.g. a chord at frets
                    // 2–4 with an anchor locked to frets 5–8), the framebox
                    // would clip the very gems it's supposed to contain, so
                    // fall back to chord-fret-based bounds instead.
                    const anchorCoversChordFrets = chAncB && anyFretted
                        ? (fMinCh >= chAncB.dMin && fMaxCh <= chAncB.dMax)
                        : true; // all-open chord: anchor centre is fine
                    if (chAncB && anchorCoversChordFrets) {
                        chordFrameXL = xFret(chAncB.dMin);
                        chordFrameXR = xFret(chAncB.dMax);
                        chordFrameAnchorMatched = true;
                    } else if (anyFretted) {
                        chordFrameXL = xFret(fMinCh - 1);
                        chordFrameXR = xFret(Math.max(fMaxCh, fMinCh + 2));
                    } else {
                        const wNut = openNoteLaneBoxW(ch.t);
                        chordFrameXL = chordCX - wNut * 0.5;
                        chordFrameXR = chordCX + wNut * 0.5;
                    }
                    if (chordFrameXL != null && chordFrameXR != null) {
                        const span = Math.abs(chordFrameXR - chordFrameXL);
                        if (span > 1e-8) {
                            // Anchor-driven lane stripes span [dMin..dMax] wire-to-wire with
                            // no horizontal pad — match that ONLY when the frame is actually
                            // following the anchor (all-open chord, fallback path). The
                            // fretted-span path always pads so the frame breathes around
                            // the outermost fretted notes; without the pad it sat exactly
                            // on the fret lines and looked clipped.
                            if (chordFrameAnchorMatched) chordOpenBoxW = span;
                            else {
                                const padX = NW * 0.4;
                                chordOpenBoxW = span + padX * 2;
                            }
                        }
                    }
                }

                const laneWForOpenStrings = (chordOpenBoxW != null && chordOpenBoxW > 1e-8)
                    ? chordOpenBoxW
                    : openNoteLaneBoxW(ch.t);

                const hsHintFrame = chordHandShapeArpeggioHint(ch, bundle.handShapes, bundle.chordTemplates);
                const hsTimeWinFrame = hsHintFrame.hs
                    ? { tLo: hsStart(hsHintFrame.hs) - 0.06, tHi: hsEnd(hsHintFrame.hs) + 0.06 }
                    : null;
                // chordShapeCoveredByStandaloneNotes is now cached per
                // chord (see _arpCoverCache), so a direct call from the
                // deferChordGems short-circuit chain is both lazy
                // (skipped for branches that don't need it) AND O(1)
                // when re-hit later in the same frame. The previous
                // per-chord IIFE memo is therefore redundant — drop it
                // to avoid the per-chord closure allocation in dense
                // PM/FH passages.
                const inferredArpPattern = (!hsHintFrame.hs
                    || handShapeChartSpanSec(hsHintFrame.hs) >= ARP_INFER_MIN_HAND_SHAPE_SPAN_S)
                    && inferArpeggioFromNotePattern(
                        ch, chShape, notes, hsTimeWinFrame, bundle.handShapes);
                // Only suppress the chord gems when standalone notes really
                // cover the arpeggio shape; otherwise explicit/synth hand
                // shapes can produce an empty lavender frame with no notes
                // inside (e.g. template-marked `-arp` chord rows).
                // Lazy wrapper so the note-stream scan is skipped when
                // neither branch needs it (short-circuit evaluation).
                const noteStreamCoversArpShape = () => chordShapeCoveredByStandaloneNotes(ch, chShape, notes);
                const deferChordGems = (ch.h3dSynth && noteStreamCoversArpShape())
                    || inferredArpPattern
                    || (hsHintFrame.explicit && hsHintFrame.covered && noteStreamCoversArpShape());
                /**
                 * Lavender chord frame + purple highway rails: authored
                 * arpeggio metadata only. RS ``highDensity`` marks gallops /
                 * repeated strums on the same voicing (e.g. Frantic ~2:46) —
                 * not arpeggio; keep ``hd`` for sustain-ribbon width via
                 * ``chordSusTrailMatchArpFrame``.
                 *
                 * Only the chord that INITIATES the handshape span gets
                 * the lavender treatment — subsequent strums of the same
                 * voicing within the same handshape window are repeats and
                 * render as ordinary chord frames. Proximity to
                 * hsStart() (≤ 100 ms) identifies the initiating chord
                 * regardless of how wide the span is.
                 */
                const _hsStartT = hsHintFrame.hs ? hsStart(hsHintFrame.hs) : NaN;
                const chordHighwayLavenderArpVisual = hsHintFrame.explicit
                    && !isNaN(_hsStartT) && Math.abs(ch.t - _hsStartT) <= 0.1;
                const chordSusTrailMatchArpFrame = chordWireHighDensity(ch)
                    || chordHighwayLavenderArpVisual;

                // Onset in window OR chord started before the window
                // but is still sustaining right now. Gate sustain
                // carry-over against the current frame time so camera
                // framing releases as soon as the chord is no longer
                // rendered on screen.
                const chOnsetInWin = ch.t >= camT0 && ch.t <= camT1;
                const chSusActive  = ch.t < camT0 && ch.t + maxSus >= now;
                const chWindowed   = chOnsetInWin || chSusActive;
                // Symmetric decay — see matching comment in the
                // single-note branch. The chord-wide chW uses
                // ch.t (not per-note onset) since chord notes
                // share a strum time.
                const chW          = chWindowed ? Math.exp(-Math.abs(ch.t - now) / camTau) : 0;
                // Next-chord tail: same voicing (``highDensity`` gallop) keeps full linger + optional
                // fade suppression inside [hold−fade, hold]; a voicing change clips the tail to the
                // chart gap so D5→D#5 (~185 ms) does not stack two cyan frames (Frantic ~2:47).
                let cjNext = null;
                for (let j = ci + 1; j < chords.length; j++) {
                    const cj = chords[j];
                    if (!cj?.notes) continue;
                    if (filterValidNotes(cj.notes).length === 0) continue;
                    cjNext = cj;
                    break;
                }
                // Nearest following event (chord OR single note) — used by
                // chordTailMul so the framebox vanishes the moment any next
                // event is played, not just when the next chord arrives.
                // Pull from the same sorted scalar scratch used by drawNote
                // — the per-string Math.min walk became O(log N) over the
                // shared 2*nStr buffer.
                const _chFirstEventAfter = _firstEventTimeGreaterThan(ch.t + 1e-6);
                const _chNextEventT = cjNext != null
                    ? Math.min(cjNext.t, _chFirstEventAfter)
                    : _chFirstEventAfter;
                let chordTailHoldS = CHORD_HWY_LINGER_S;
                let chordNextSoon = false;
                if (cjNext && cjNext.t > ch.t + 1e-6) {
                    // Clip the hold tail to the gap for both same-voicing (repeat)
                    // and different-voicing chords. The chordTailMul instant-cut
                    // check handles the precise zero at onset; the clipped holdS
                    // prevents the outer gate and hwyPostHitTailFadeMul from
                    // lingering past that point.
                    chordTailHoldS = Math.min(CHORD_HWY_LINGER_S, Math.max(cjNext.t - ch.t, 1e-3));
                }
                // feedBack#254 — engine verdicts land ~0.4 s after the
                // chord crosses; on a fast different-voicing sequence
                // the clip above can shrink the rim's draw life below
                // that, so the green/red latch is set but the rim isn't
                // drawn anymore. When a verdict provider is attached,
                // floor the hold at NOTEDETECT_GEM_VERDICT_WINDOW so
                // the tinted rim is actually visible.
                //
                // This deliberately overrides the "voicing-change clip
                // prevents two stacked cyan frames" behavior documented
                // above (the D5→D#5 / Frantic ~2:47 case): the post-hit
                // z clamp (Math.min(0, dZ(chDt)) below) pins extended
                // frames at z=0, so the two frames do overlap in plane
                // — they're distinguished by their now-tinted rim
                // colors (green/red verdict vs teal default) rather
                // than perspective depth. In detect mode that's the
                // right trade: verdict visibility beats the cleaner
                // approach silhouette. Without detect mode the
                // original clip still applies.
                if (_ndHasProvider && chordTailHoldS < NOTEDETECT_GEM_VERDICT_WINDOW) {
                    chordTailHoldS = NOTEDETECT_GEM_VERDICT_WINDOW;
                }
                const chordTailFadeS = Math.min(CHORD_HWY_FADE_S, chordTailHoldS);

                // ── Approaching-arpeggio first-note identification ──────────────────
                // When an authored arpeggio chord frame is still approaching (not yet
                // at the hit line), only the first note to be played is shown as a gem.
                // All others are suppressed until chDtEarly <= 0 so the frame doesn't
                // flood the player's view with simultaneous gems before they arrive.
                // The first note is the earliest match in the note stream within the
                // handshape window. If no note-stream note matches the chord shape
                // within the handshape (i.e. there is no sequential arpeggio pattern),
                // _arpApproachFirstNote stays null and ALL chord gems are shown — this
                // handles chords that are played simultaneously even when tagged as arp.
                let _arpApproachFirstNote = null;
                if (chordHighwayLavenderArpVisual && !deferChordGems
                    && chDtEarly > 0 && hsHintFrame.hs) {
                    const _aHsLo = hsStart(hsHintFrame.hs);
                    const _aHsHi = hsEnd(hsHintFrame.hs);
                    let _aFirstT = Infinity;
                    const _aNLo = lowerBoundT(notes, _aHsLo - 0.08);
                    for (let _ani = _aNLo; _ani < notes.length; _ani++) {
                        const _an = notes[_ani];
                        if (_an.t > _aHsHi + 0.08) break;
                        if (!validString(_an.s)) continue;
                        for (const _acn of chordNotes) {
                            if (_acn.s === _an.s && _acn.f === _an.f && _an.t < _aFirstT) {
                                _aFirstT = _an.t;
                                _arpApproachFirstNote = _acn;
                                break;
                            }
                        }
                    }
                    // No fallback to chordNotes[0]: if the note stream has no sequential
                    // notes matching this shape, the chord is played simultaneously and
                    // all gems must be shown.
                }

                // ── Deferred-arpeggio gem fallback ─────────────────────────────────
                // When gems are deferred to the note stream (deferChordGems=true) but
                // no individual note matching the chord shape falls within the chord's
                // onset cluster window, the frame box has no gems at its Z position.
                // Show all chord gems as a preview so the frame box isn't empty.
                // Uses the same onset window as chordShapeCoveredByStandaloneNotes so
                // the fallback deactivates precisely when the stream truly covers the
                // onset. Inlined (not an IIFE) to skip the per-chord closure allocation.
                let _deferFallback = false;
                if (deferChordGems && chDtEarly > 0) {
                    _deferFallback = true;
                    const _fLo = ch.t - ARP_FRAME_ONSET_PAD_S;
                    const _fHi = ch.t + ARP_FRAME_ONSET_CLUSTER_S;
                    let _fi = lowerBoundT(notes, _fLo - 0.02);
                    for (; _fi < notes.length; _fi++) {
                        const _fn = notes[_fi];
                        if (_fn.t > _fHi) break;
                        if (_fn.t < _fLo) continue;
                        const _fef = chShape.get(_fn.s);
                        if (_fef !== undefined && _fef === _fn.f) { _deferFallback = false; break; }
                    }
                }

                // Suppress gems AND frame for hand-shape-synthesized chords whose
                // notes are already rendered individually via the note stream. Showing
                // chord gems or a framebox for a synth chord that duplicates the note
                // stream looks like phantom notes/chords. Check: any standalone note
                // matching any shape string in the onset window → player is already
                // guided by the note stream. Weaker than chordShapeCoveredByStandaloneNotes
                // (all strings covered) to handle patterns where one shape string only
                // appears well after the onset cluster (e.g. Walk intro, string 5 at
                // +0.7 s outside the 0.26 s window). Inlined for the same reason as
                // _deferFallback above.
                let suppressSynthChord = false;
                if (ch.h3dSynth && notes && chShape.size > 0) {
                    const _sLo = ch.t - ARP_FRAME_ONSET_PAD_S;
                    const _sHi = ch.t + ARP_FRAME_ONSET_CLUSTER_S;
                    let _si = lowerBoundT(notes, _sLo - 0.02);
                    for (; _si < notes.length; _si++) {
                        const _sn = notes[_si];
                        if (_sn.t > _sHi) break;
                        if (_sn.t < _sLo) continue;
                        if (chShape.get(_sn.s) === _sn.f) { suppressSynthChord = true; break; }
                    }
                }

                // suppressSynthChord: skip gems + frame but still call drawNote with
                // skipBody=true so the board projection (fret ghost on fretboard) renders
                // for all shape strings — shows the hand position like a chord would.
                // chordLinksSlide: true when any chord note has a direct sl/slu marker,
                // OR when the chord's sustain connects (via case-2 linkNext) to a note
                // in bundle.notes that has a slide.  Repeated chords matching either
                // condition are treated as normal chords so the player sees the gem.
                let chordLinksSlide = chordNotes.some(cn =>
                    (Number.isFinite(cn.sl) && cn.sl >= 0) ||
                    (Number.isFinite(cn.slu) && cn.slu >= 0));
                if (!chordLinksSlide && isRepeat && maxSus > 0 && notes) {
                    const _EPS = NEXT_ON_STRING_T_EPS;
                    outer: for (const cn of chordNotes) {
                        if (!(cn.sus > 0)) continue;
                        const _endT = ch.t + cn.sus;
                        let _ji = lowerBoundT(notes, _endT - _EPS);
                        for (; _ji < notes.length; _ji++) {
                            const _q = notes[_ji];
                            if (_q.t > _endT + _EPS) break;
                            if (_q.s !== cn.s || Math.abs(_q.t - _endT) >= _EPS) continue;
                            if ((Number.isFinite(_q.sl) && _q.sl >= 0) ||
                                (Number.isFinite(_q.slu) && _q.slu >= 0)) {
                                chordLinksSlide = true; break outer;
                            }
                        }
                    }
                }
                if (!deferChordGems || _deferFallback || suppressSynthChord) {
                    for (const cn of chordNotes) {
                        // Suppress non-first gems while an authored arpeggio frame
                        // approaches — but not for the deferred fallback path, where
                        // all chord gems serve as the only visual preview.
                        // _arpApproachFirstNote is null when no sequential note-stream
                        // pattern was found, so simultaneous chords are unaffected.
                        // suppressSynthChord: show all shape strings for the projection.
                        if (!_deferFallback && !suppressSynthChord && _arpApproachFirstNote !== null && cn !== _arpApproachFirstNote) continue;
                        // Only suppress labels on repeated chord shapes (not on first-in-run);
                        // removed the lastFretForString check — same fix as single notes above.
                        const skipLabel = !firstInShapeRun;
                        // Reuse _scrChordNote scratch instead of `{ ...cn }` spread
                        // (avoids per-chord-note object allocation every frame).
                        Object.assign(_scrChordNote, cn);
                        _scrChordNote.t   = ch.t;
                        _scrChordNote.sus = cn.sus || 0;
                        // `fhm` is omit-when-false in the wire format (unlike `mt`/`pm`
                        // which are always emitted). Before 5913129, chord-level
                        // fretHandMute was folded into `mt` (always-emitted), so
                        // Object.assign would overwrite any stale value. After that
                        // commit fhm is its own field — absent on non-muted notes —
                        // so Object.assign leaves a stale `true` from a previous
                        // muted chord note untouched. Reset it explicitly here.
                        _scrChordNote.fhm = cn.fhm || false;
                        // Same stale-scratch hazard for the bend shape:
                        // `bnv`/`bt` are omit-when-default on the wire, so a
                        // chord note without them would otherwise inherit the
                        // previous note's curve (and bendSemisAtTime would
                        // apply the wrong contour). Reset explicitly.
                        _scrChordNote.bnv = Array.isArray(cn.bnv) ? cn.bnv : undefined;
                        _scrChordNote.bt  = cn.bt || 0;
                        // Same stale-scratch hazard for the teaching marks
                        // (§6.2.2): fg/sd are omit-when-default on the wire,
                        // so a chord note without them must reset to -1 or it
                        // inherits the previous note's finger/degree label.
                        _scrChordNote.fg  = Number.isInteger(cn.fg) ? cn.fg : -1;
                        _scrChordNote.sd  = Number.isInteger(cn.sd) ? cn.sd : -1;
                        drawNote(
                            _scrChordNote,
                            now,
                            cn.f === 0 ? chordCX : undefined,
                            skipLabel,
                            (isRepeat && !chordLinksSlide) || suppressSynthChord,
                            chordTailHoldS,
                            cn.f === 0 ? laneWForOpenStrings : undefined,
                            true,
                            ch.id,
                            chordSusTrailMatchArpFrame,
                            null,
                            _ghostPrevBuf.get(Math.round(ch.t * 1e4) * 10 + cn.s) ?? -Infinity,
                            chordHighwayLavenderArpVisual || suppressSynthChord || chordWireHighDensity(ch),
                        );
                        lastFretForString[cn.s] = cn.f;
                        // gate by THIS note's own sustain against the
                        // current render time — drawNote has already
                        // dropped short-sustain notes whose ringing has
                        // ended, so they should not keep pulling the
                        // camera frame wider than the notes actually
                        // still on screen (chord-wide maxSus would
                        // over-pullback for mixed-sustain chords).
                        if (!(cameraMode === 'lookahead')) {
                        const cnSustainOk = chOnsetInWin || (chSusActive && ch.t + (cn.sus || 0) >= now);
                        if (cn.f > 0 && cnSustainOk) {
                            camWX += xFretMid(cn.f) * chW;
                            camWSum += chW;
                            if (cn.f < camDistMin) camDistMin = cn.f;
                            if (cn.f > camDistMax) camDistMax = cn.f;
                            camDistGot = true;
                        }
                        }
                    }
                }

                // ── Arpeggio note brackets [ ] ────────────────────────
                // Drawn only for explicitly authored arpeggio frames
                // (chordHighwayLavenderArpVisual = explicit handshape arp mark).
                // Covers both paths: gems shown directly from the chord
                // (!deferChordGems) and the deferred-fallback preview path
                // (_deferFallback). The inferred-arpeggio path (inferredArpPattern
                // only, no explicit mark) intentionally does NOT draw brackets —
                // the inference heuristic can false-positive on fast strummed
                // chords, and brackets on non-arp chords confuse players.
                // Note-stream arpeggios draw their own brackets in the notes[]
                // loop above (for notes already in AHEAD). The chord loop covers
                // any strings whose notes haven't entered AHEAD yet — _nsBrackets
                // prevents duplicates for strings already handled by notes[].
                if (chordHighwayLavenderArpVisual) {
                    const _arpBracketDt = ch.t - now;
                    if (_arpBracketDt < AHEAD) {
                        const _arpEnd = (hsHintFrame.hs && !isNaN(hsEnd(hsHintFrame.hs)))
                            ? hsEnd(hsHintFrame.hs)
                            : ch.t + maxSus + CHORD_HWY_LINGER_S;
                        // The notes[] loop already drew brackets for any note-stream
                        // note that entered AHEAD, recording (chordId:occurrenceStart → strings)
                        // in _noteStreamBracketStrings. Use the same composite key (template id +
                        // handshape start time) so two arp occurrences sharing a chord template
                        // ID are treated as distinct occurrences — not one suppressing the other.
                        const _nsBracketsKey = ch.id + ':' + _hsStartT;
                        const _nsBrackets = _noteStreamBracketStrings.get(_nsBracketsKey);
                        // Open-string bracket X: anchor at handshape start so
                        // position stays fixed even when chordCX drifts with now.
                        const _arpChBrktAncB = !isNaN(_hsStartT)
                            ? anchorLaneBoundsAt(anchors, _hsStartT)
                            : null;
                        const _arpChBrktOpenX = _arpChBrktAncB
                            ? (xFret(_arpChBrktAncB.dMin) + xFret(_arpChBrktAncB.dMax)) / 2
                            : (chordCX ?? curX);
                        const _arpChBrktOpenW = (() => {
                            if (_arpChBrktAncB) {
                                const _xl = xFret(_arpChBrktAncB.dMin), _xr = xFret(_arpChBrktAncB.dMax);
                                if (_xr > _xl) return _xr - _xl + NW * 0.4 * 2;
                            }
                            return laneWForOpenStrings;
                        })();
                        for (const cn of chordNotes) {
                            if (!validString(cn.s)) continue;
                            if (_nsBrackets && _nsBrackets.has(cn.s)) continue;
                            const _bx = cn.f === 0
                                ? _arpChBrktOpenX
                                : xFretMid(cn.f);
                            const _openHalfW = (cn.f === 0 && _arpChBrktOpenW != null)
                                ? Math.max(0.22, _arpChBrktOpenW * 0.96 / (40 * K)) * 20 * K
                                : null;
                            drawArpBrackets(_bx, sY(cn.s), _arpBracketDt, _arpEnd, now, cn.s, cn.f === 0, _openHalfW);
                        }
                    }
                }

                // Chord frame-box: rim bars + interior fill gradient.
                const chDt = chDtEarly; // already computed above for anchor selection
                const chordTailMul = (() => {
                    // When a next event (chord OR single note) has already crossed
                    // the hit line, hide this frame immediately — no fadeout overlap
                    // when another event is already playing.
                    if (chDt < 0 && _chNextEventT < Infinity && now >= _chNextEventT) {
                        return 0;
                    }
                    return hwyPostHitTailFadeMul(chDt, chordTailHoldS, chordNextSoon, chordTailFadeS);
                })();
                if (chShape.size > 1 && chDt > -chordTailHoldS && chDt < AHEAD && chordOpenBoxW != null
                    && (!suppressSynthChord || chordTemplateMarkedArpeggio(ch.id, bundle.chordTemplates))
                ) {
                    const z = Math.min(0, dZ(chDt));
                    const width = chordOpenBoxW;
                    const xLeft = chordFrameXL;
                    const xRight = chordFrameXR;
                    const cx = (xLeft + xRight) * 0.5;
                    const yA = sY(0), yB = sY(nStr - 1);
                    const yMinF = Math.min(yA, yB) - S_GAP * 0.8;
                    const yMaxF = Math.max(yA, yB) + S_GAP * 0.8;
                    const fullChordBoxH = yMaxF - yMinF;
                    let height = fullChordBoxH;
                    if (isRepeat) height *= 0.5;
                    // Repeat frames use half height but anchor at yMinF (board
                    // level) rather than centering in the string range. With the
                    // camera tilted downward, a centered half-height frame puts
                    // its bottom bar mid-strings — far above the board — causing
                    // perspective-induced apparent X-misalignment with the lane
                    // tiles (which sit at board level). Anchoring at yMinF keeps
                    // the bottom bar near the board so both frame and lane tile
                    // edges share the same projected screen X.
                    const yBot = yMinF;
                    const yTop = yMinF + height;
                    const cY = (yBot + yTop) * 0.5;
                    const fade = Math.max(0, 1 - chDt / AHEAD);
                    const chordAccent = chordNotes.some(cn => cn.ac);

                    // Rim thickness from full vertical span — repeat halves inner height only,
                    // not bar thickness vs first chord — see CHORD_FRAME_RIM_* tuning.
                    let ft = Math.max(CHORD_FRAME_RIM_MIN * K, fullChordBoxH * CHORD_FRAME_RIM_FRAC_H);
                    if (chordAccent) ft *= 1.22;
                    // Lavender frame: authored arpeggio marker only.
                    // RS ``highDensity`` is kept out — it tags gallops & repeated
                    // strums (Frantic ~2:46), not arpeggio.
                    const isArpeggioFrame = chordHighwayLavenderArpVisual;
                    const ftSide = isArpeggioFrame ? ft * 1.55 : ft;
                    let rimHex = isArpeggioFrame ? ARPEGGIO_RIM_BLUE_HEX : CHORD_BOX_TEAL_HEX;
                    // Capture the neutral frame color before any verdict overwrite.
                    // Used for the mute X lines so hit/miss feedback only shows on
                    // the outer borders of the framebox, not inside the X pattern.
                    const baseRimHex = rimHex;
                    // feedBack#254 — once the chord crosses the hit
                    // line, tint the teal frame by the note-state
                    // provider verdict: green on a clean grab, red on a
                    // miss. The verdict is async (the engine verifier
                    // reports ~0.4 s after the line), so the frame stays
                    // teal while the verdict is still pending — it must
                    // not flash red before the verdict lands. The green/
                    // red verdict is latched in _chordVerdicts so it
                    // can't flicker as constituent glows decay.
                    // Only engages when a scorer is attached. Arpeggio
                    // frames keep their blue identity.
                    // Per-occurrence key — ch.id is the template id
                    // (reused across same-shape chord occurrences) so
                    // composing it with ch.t gives one entry per
                    // physical onset in the chart.
                    const verdictKey = _encodeChordVerdictKey(ch);
                    // Evict any stale latch the next time the chord
                    // re-enters the pre-hit window (rewinds, section
                    // loops, full restarts). Bounds Map growth too.
                    if (chDt > 0 && _chordVerdicts.has(verdictKey)) {
                        _chordVerdicts.delete(verdictKey);
                    }
                    // The verdict scan no longer skips authored-handshape
                    // frames — power chords sometimes carry an explicit
                    // handshape (RS authoring quirk), which previously
                    // dropped them into the `isArpeggioFrame` path and
                    // left them lavender-blue regardless of hit/miss.
                    // A true arpeggio (handshape over a real sweeping
                    // note run) is unaffected: its constituents are
                    // standalone notes judged at their own times, so the
                    // scan's query at `ch.t` finds nothing for them and
                    // the frame keeps its lavender default.
                    if (chDt <= 0 && _ndHasProvider && !isArpeggioFrame) {
                        const latched = _chordVerdicts.get(verdictKey);
                        if (latched === 'green') {
                            rimHex = CHORD_BOX_HIT_BRIGHT_HEX;
                        } else if (latched === 'red') {
                            rimHex = CHORD_BOX_MISS_DARK_HEX;
                        } else if (latched === 'unmatched') {
                            // The first scan past the verdict window
                            // came up empty (no constituent ever had a
                            // state — most often a true arpeggio frame
                            // whose actual notes are judged at their
                            // own times, not at ch.t). Skip the
                            // per-frame provider scan and keep the
                            // frame's default identity (lavender for
                            // arpeggios, teal for chords). See the
                            // unmatched-latch below.
                        } else {
                            // Latch both green AND red:
                            //   - any constituent 'miss' → red latched.
                            //     One decisive miss verdict means the
                            //     chord can't be all-hit; without
                            //     latching, the rim would fall back to
                            //     teal once noteStateFor's miss-wash
                            //     window (~0.6 s TTL) expires and the
                            //     state returns null again.
                            //   - all hit/active → green latched.
                            //   - else (no miss yet, some constituents
                            //     still null) → keep teal default. A
                            //     partial state must not flash red on
                            //     a chord whose verdicts arrive
                            //     incrementally.
                            let allHit = chordNotes.length > 0;
                            let anyMiss = false;
                            let anyState = false;  // true if any constituent had a non-null state this scan
                            for (const cn of chordNotes) {
                                let cs = null;
                                try { cs = _ndGetNoteState(cn, ch.t); } catch (e) { cs = null; }
                                const st = (cs && typeof cs === 'object') ? cs.state : cs;
                                if (st === 'hit' || st === 'active') {
                                    anyState = true;
                                } else if (st === 'miss') {
                                    // First miss decides the chord — no
                                    // point querying the rest of the
                                    // constituents this frame; the rim
                                    // is about to be red-latched below.
                                    // Short-circuits provider calls in
                                    // chord-dense passages.
                                    allHit = false;
                                    anyMiss = true;
                                    anyState = true;
                                    break;
                                } else {
                                    // null — undecided yet
                                    allHit = false;
                                }
                            }
                            if (anyMiss) {
                                _chordVerdicts.set(verdictKey, 'red');
                                rimHex = CHORD_BOX_MISS_DARK_HEX;
                            } else if (allHit) {
                                _chordVerdicts.set(verdictKey, 'green');
                                rimHex = CHORD_BOX_HIT_BRIGHT_HEX;
                            } else if (chDt < -_ND_UNMATCHED_LATCH_AFTER && !anyState) {
                                // The engine verdict typically lands
                                // ~0.4 s after the chord crosses the
                                // line, so after the
                                // _ND_UNMATCHED_LATCH_AFTER threshold
                                // we've already waited well past the
                                // verdict-arrival window. If no
                                // constituent ever returned a non-
                                // null state by then, there's no
                                // verdict coming for this chord
                                // (true arpeggio frames: their actual
                                // notes are judged at their own
                                // times, never at ch.t — the scan
                                // at ch.t finds nothing forever).
                                //
                                // Latch 'unmatched' so subsequent
                                // frames skip the provider scan
                                // entirely. The threshold must be
                                // INSIDE the chord frame's visible
                                // draw window — `chordTailHoldS` is
                                // floored to NOTEDETECT_GEM_VERDICT_
                                // WINDOW (0.75 s) in detect mode, so
                                // chord frames stop drawing at
                                // `chDt < -0.75`; a latch threshold
                                // at `-NOTEDETECT_GEM_VERDICT_WINDOW`
                                // (i.e. exactly -0.75) is unreachable
                                // because the draw gate kicks the
                                // frame out of the loop first. Place
                                // the threshold ~0.55 s past line so
                                // it fires for ~0.2 s of the remaining
                                // visible window — enough frames to
                                // catch and skip future re-scans.
                                //
                                // The !anyState guard keeps the
                                // partial-resolve case (one cn 'hit',
                                // another still null) scanning until
                                // anyMiss / allHit commits it.
                                _chordVerdicts.set(verdictKey, 'unmatched');
                            }
                            // else: no verdict yet → leave teal default
                        }
                    }

                    if (chDt > 0) { // framebox only on highway, not on the fretboard
                    const repDim = isRepeat ? 0.78 : 1;
                    const edgeOp = fade * chordTailMul;
                    const thickZ = Math.max(CHORD_FRAME_RIM_Z_MIN * K, ft * CHORD_FRAME_RIM_Z_SCAL);
                    // Per-depth layer stack: chord frames, gems, technique markers,
                    // and fret labels all derive from RENDER_ORDER_LAYER_STACK so new layers
                    // have one vocabulary instead of ad hoc arithmetic at call sites.
                    // Sub-increments of 0.0001 for intra-chord ordering; safe for any
                    // chord gap >= 0.001 s.
                    const chordFrameRenderOrder = renderOrderForLayerAtZ(z, 'CHORD_FRAME');
                    const drawFrameBox = (px, py, sx, sy, ord, hex = rimHex, op = edgeOp) => {
                        const b = pChordBox.get();
                        b.renderOrder = ord;
                        b.material.color.setHex(hex);
                        b.position.set(px, py, z);
                        b.scale.set(sx, sy, thickZ);
                        b.rotation.set(0, 0, 0);
                        b.material.opacity = op;
                    };
                    const sideHex = isArpeggioFrame ? rimHex : 0x163137;

                    const innerW = Math.max(width - 2 * ftSide, width * 0.45);
                    const innerH = Math.max(height - 2 * ft, height * 0.3);
                    const fill = pChordFrameFill.get();
                    fill.renderOrder = renderOrderForLayerAtZ(z, 'CHORD_FILL');
                    fill.rotation.set(0, 0, 0);
                    fill.position.set(cx, cY, z - 0.004 * K);
                    fill.scale.set(innerW, innerH, 1);
                    fill.material.opacity = fade * repDim * chordTailMul;
                    // Swapping `map` between two non-null gradient textures
                    // doesn't change shader-defining state, so no needsUpdate
                    // — that flag would otherwise force a recompile per frame.
                    fill.material.map = isArpeggioFrame ? chordFrameGradTexArp : chordFrameGradTex;
                    fill.material.color.setRGB(1, 1, 1);

                    const withTopFrame = !isRepeat;
                    // Non-repeat tapers the upper side bars + draws a thin top bar;
                    // hoisted out so ySideHi can match the actual top-bar thickness
                    // (using ft would leave a visible gap between the thin top bar
                    // and the side bars meeting it).
                    const ftThin = ftSide * 0.22;

                    const ySideLo = yBot + ft;
                    const ySideHi = withTopFrame ? yTop - ftThin : yTop - ft * 0.15;
                    const sideH = Math.max(ySideHi - ySideLo, ft * 1.25);
                    const sideCy = ySideLo + sideH * 0.5;

                    // Bottom bar: thin teal (like top bar) + dark corners on top.
                    {
                        const botCW = Math.min(sideH * (isRepeat ? 0.5 : 0.25), width * 0.4);
                        drawFrameBox(cx, yBot + ftThin * 0.5, width, ftThin, chordFrameRenderOrder);
                        drawFrameBox(cx + width * 0.5 - botCW * 0.5, yBot + ft * 0.5, botCW, ft, chordFrameRenderOrder + 0.0001, sideHex);
                        drawFrameBox(cx - width * 0.5 + botCW * 0.5, yBot + ft * 0.5, botCW, ft, chordFrameRenderOrder + 0.0002, sideHex);
                    }

                    if (isRepeat) {
                        // Lower 30%: thick dark segment
                        const repLoH = sideH * 0.3;
                        const repLoCy = ySideLo + repLoH * 0.5;
                        drawFrameBox(cx - width * 0.5 + ftSide * 0.5, repLoCy, ftSide, repLoH, chordFrameRenderOrder + 0.0001, sideHex);
                        drawFrameBox(cx + width * 0.5 - ftSide * 0.5, repLoCy, ftSide, repLoH, chordFrameRenderOrder + 0.0001, sideHex);
                        // Upper 70%: thin teal segment (same style as non-repeat upper)
                        const repHiH = sideH - repLoH;
                        const repHiCy = ySideLo + repLoH + repHiH * 0.5;
                        drawFrameBox(cx - width * 0.5 + ftThin * 0.5, repHiCy, ftThin, repHiH, chordFrameRenderOrder + 0.0001);
                        drawFrameBox(cx + width * 0.5 - ftThin * 0.5, repHiCy, ftThin, repHiH, chordFrameRenderOrder + 0.0001);
                    } else {
                        // Non-repeat: thick sides up to repeat-frame height, then taper to thin above.
                        const threshY = yBot + fullChordBoxH * 0.5; // top of what a repeat frame would be

                        // Lower thick segment (ySideLo → threshY)
                        const loSideH = Math.max(Math.min(threshY, ySideHi) - ySideLo, 0);
                        if (loSideH > 0) {
                            const loCy = ySideLo + loSideH * 0.5;
                            drawFrameBox(cx - width * 0.5 + ftSide * 0.5, loCy, ftSide, loSideH, chordFrameRenderOrder + 0.0001, sideHex);
                            drawFrameBox(cx + width * 0.5 - ftSide * 0.5, loCy, ftSide, loSideH, chordFrameRenderOrder + 0.0001, sideHex);
                        }

                        // Upper thin segment (threshY → ySideHi)
                        const hiSideH = Math.max(ySideHi - threshY, 0);
                        if (hiSideH > 0) {
                            const hiCy = threshY + hiSideH * 0.5;
                            drawFrameBox(cx - width * 0.5 + ftThin * 0.5, hiCy, ftThin, hiSideH, chordFrameRenderOrder + 0.0001);
                            drawFrameBox(cx + width * 0.5 - ftThin * 0.5, hiCy, ftThin, hiSideH, chordFrameRenderOrder + 0.0001);
                        }

                        // Top bar: thin
                        drawFrameBox(cx, yTop - ftThin * 0.5, width, ftThin, chordFrameRenderOrder);
                    }

                    // Accent bloom on frame edges: 4 additive shells with
                    // Gaussian-style falloff. Each border expands only in its
                    // perpendicular axis so bloom never leaves the frame boundary:
                    //   horizontal bars (top/bottom) → expand Y only
                    //   vertical bars (left/right)   → expand X only
                    if (chordAccent && pHaloBar) {
                        // Bloom only on the teal (thin) parts of the frame — the dark
                        // "#163137" L-corners are deliberately left without bloom so they
                        // remain visibly dark (same appearance as non-accent chords).
                        const haloHex = isArpeggioFrame ? ARPEGGIO_RIM_BLUE_HEX : CHORD_BOX_TEAL_HEX;
                        const EXPAND_MAX = 1.45;
                        const dynamicOp = fade * chordTailMul;
                        const drawHaloBar = (px, py, scaleX, scaleY, rotZ) => {
                            const b = pHaloBar.get();
                            b.material.color.setHex(haloHex);
                            b.material.opacity = dynamicOp;
                            b.renderOrder = renderOrderForLayerAtZ(z, 'CHORD_EDGE_GLOW');
                            b.position.set(px, py, z - 0.001 * K);
                            b.scale.set(scaleX, scaleY * EXPAND_MAX * 0.5, thickZ * 2.0);
                            b.rotation.set(0, 0, rotZ);
                        };
                        // Bottom: center-only bloom (skip dark corner areas)
                        const _bCW = Math.min(sideH * (isRepeat ? 0.5 : 0.25), width * 0.4);
                        const centerBotW = width - 2 * _bCW;
                        if (centerBotW > 0)
                            drawHaloBar(cx, yBot + ft * 0.5, centerBotW * 0.5, ft, 0);
                        // Top bar
                        if (withTopFrame)
                            drawHaloBar(cx, yTop - ftThin * 0.5, width * 0.5, ftThin, 0);
                        // Lateral: bloom only on the upper thin-teal segment (skip dark lower segment)
                        if (isRepeat) {
                            const repLoH = sideH * 0.3;
                            const repHiH = sideH - repLoH;
                            if (repHiH > 0) {
                                const repHiCy = ySideLo + repLoH + repHiH * 0.5;
                                drawHaloBar(cx - width * 0.5 + ftSide * 0.5, repHiCy, repHiH * 0.5, ftSide, Math.PI * 0.5);
                                drawHaloBar(cx + width * 0.5 - ftSide * 0.5, repHiCy, repHiH * 0.5, ftSide, Math.PI * 0.5);
                            }
                        } else {
                            const threshY = yBot + fullChordBoxH * 0.5;
                            const hiSideH = Math.max(ySideHi - threshY, 0);
                            if (hiSideH > 0) {
                                const hiCy = threshY + hiSideH * 0.5;
                                drawHaloBar(cx - width * 0.5 + ftSide * 0.5, hiCy, hiSideH * 0.5, ftSide, Math.PI * 0.5);
                                drawHaloBar(cx + width * 0.5 - ftSide * 0.5, hiCy, hiSideH * 0.5, ftSide, Math.PI * 0.5);
                            }
                        }
                    }
                    const chordName = chordTemplateLabel(bundle.chordTemplates?.[ch.id]);
                    if (chordName && firstInShapeRun && !chordWireHighDensity(ch)) {
                        const lblW = 28 * K, lblH = 9 * K;
                        const lbl = pChordLbl.get();
                        const mat = txtMat(chordName, '#e8d080', true, 'chord');
                        _setLabelMap(lbl, mat);
                        lbl.material.opacity = Math.min(1, 0.3 + fade * 0.7) * chordTailMul;
                        // Gold chord name: slight +X shift from flush-left so it sits farther right.
                        const lblWS = lblW * _textSizeMul;
                        const lblHS = lblH * _textSizeMul;
                        const frameLeft = cx - width / 2;
                        const nameShiftX = NW * 0.94;
                        const nameVertTuck = NH * 0.02;
                        lbl.position.set(
                            frameLeft - lblWS / 2 + nameShiftX,
                            yMaxF + lblHS / 2 - nameVertTuck,
                            z);
                        lbl.scale.set(lblWS, lblHS, 1);
                    }

                    // Harmony annotations (§6.3.1 / §6.6) — the chord's
                    // function (fn.rn Roman numeral) and template voicing,
                    // stacked above the chord name. Gated by the
                    // teaching-marks opt-in (mirrors the 2D overlay). Display
                    // only — never grading.
                    if (_drawTeachingMarks && firstInShapeRun && !chordWireHighDensity(ch)) {
                        const _tmpl = bundle.chordTemplates?.[ch.id];
                        const _h = chordHarmonyLabels(ch.fn, _tmpl?.voicing, _tmpl?.caged, _tmpl?.guideTones);
                        if (_h.rn || _h.voicing || _h.caged || _h.guideTones) {
                            const hlW = 24 * K * _textSizeMul;
                            const hlH = 9 * K * _textSizeMul;
                            const frameLeft = cx - width / 2;
                            const baseX = frameLeft - hlW / 2 + NW * 0.94;
                            const opacity = Math.min(1, 0.3 + fade * 0.7) * chordTailMul;
                            // Start one chord-name-height above the name and
                            // stack upward so labels never overlap the gems.
                            let hy = yMaxF + hlH * 1.6;
                            const _drawHarmony = (text, colorHex) => {
                                if (!text) return;
                                const s = pChordLbl.get();
                                const m = txtMat(text, colorHex, true, 'chord');
                                _setLabelMap(s, m);
                                s.material.opacity = opacity;
                                s.position.set(baseX, hy, z);
                                s.scale.set(hlW, hlH, 1);
                                hy += hlH;
                            };
                            _drawHarmony(_h.rn, '#ffcc66');         // sd teaching color
                            _drawHarmony(_h.voicing, '#7fd1ff');    // fg teaching color
                            _drawHarmony(_h.caged, '#a0ffa0');      // CAGED shape teaching color
                            _drawHarmony(_h.guideTones, '#d0a0ff'); // guide-tone teaching color
                        }
                    }

                    // Shape-based barre detection for the 3D indicator.
                    // Drives off chord notes alone — independent of label
                    // availability, so charts whose chordTemplates lack a
                    // .name still show the barre line.
                    // Matches drawChordDiagram PATH A + PATH B so the highway
                    // line and overlay bracket always agree on the same shapes:
                    //   PATH A: 2+ adjacent strings at the minimum fret.
                    //   PATH B: outer-edge full-span barre (e.g. B major x24442)
                    //           where the two outer strings are at the minimum fret,
                    //           every intermediate string is fretted (f>0), and no
                    //           intermediate string also sits at the minimum fret.
                    // Scattered voicings like "1 3 1 3 1 0" (strings 0,2,4 at
                    // fret 1 but no two adjacent, and string 2 sits at min fret)
                    // correctly produce no indicator.
                    {
                        let bFret = Infinity;
                        for (const [, f] of chShape) {
                            if (f > 0) bFret = Math.min(bFret, f);
                        }
                        // Collect strings at minimum fret into scratch array (no allocation)
                        _scrAtMinFretLen = 0;
                        if (bFret < Infinity) {
                            for (const [s, f] of chShape) {
                                if (f === bFret) _scrAtMinFretArr[_scrAtMinFretLen++] = s;
                            }
                            // insertion sort — array is ≤8 elements
                            for (let _ii = 1; _ii < _scrAtMinFretLen; _ii++) {
                                const _v = _scrAtMinFretArr[_ii];
                                let _jj = _ii - 1;
                                while (_jj >= 0 && _scrAtMinFretArr[_jj] > _v) {
                                    _scrAtMinFretArr[_jj + 1] = _scrAtMinFretArr[_jj]; _jj--;
                                }
                                _scrAtMinFretArr[_jj + 1] = _v;
                            }
                        }
                        // Inline longestConsecutiveRun (no array allocation)
                        let _barreRunStart = -1, _barreRunLen = 0;
                        {
                            let _curStart = -1, _curLen = 0;
                            for (let _ri = 0; _ri < _scrAtMinFretLen; _ri++) {
                                const _rv = _scrAtMinFretArr[_ri];
                                if (_curLen === 0 || _rv === _scrAtMinFretArr[_ri - 1] + 1) {
                                    if (_curLen === 0) _curStart = _rv;
                                    _curLen++;
                                } else {
                                    if (_curLen > _barreRunLen) { _barreRunLen = _curLen; _barreRunStart = _curStart; }
                                    _curStart = _rv; _curLen = 1;
                                }
                            }
                            if (_curLen > _barreRunLen) { _barreRunLen = _curLen; _barreRunStart = _curStart; }
                        }
                        let is3dBarre    = _barreRunLen >= 2;   // PATH A
                        let barreMinStr3d = is3dBarre ? _barreRunStart : -1;
                        let barreMaxStr3d = is3dBarre ? _barreRunStart + _barreRunLen - 1 : -1;

                        // PATH B: outer-edge full-span barre
                        const MIN_BARRE_SPAN_3D = Math.min(nStr - 1, 4);
                        if (_scrAtMinFretLen >= 2) {
                            const minS = _scrAtMinFretArr[0];
                            const maxS = _scrAtMinFretArr[_scrAtMinFretLen - 1];
                            if (maxS - minS >= MIN_BARRE_SPAN_3D) {
                                // chShape is already a Map<s, f> — query it directly
                                // instead of building a transient Set<s> every frame.
                                let allFretted = true;
                                for (let si = minS; si <= maxS; si++) {
                                    if (!chShape.has(si) || chShape.get(si) <= 0) { allFretted = false; break; }
                                }
                                if (allFretted) {
                                    if (is3dBarre) {
                                        // PATH A fired: extend to full outer span.
                                        barreMinStr3d = minS; barreMaxStr3d = maxS;
                                    } else {
                                        // PATH A did not fire: only draw if no inner
                                        // string also sits at the minimum fret.
                                        let innerAtMinFret = false;
                                        for (let _ai = 1; _ai < _scrAtMinFretLen - 1; _ai++) {
                                            const _as = _scrAtMinFretArr[_ai];
                                            if (_as > minS && _as < maxS) { innerAtMinFret = true; break; }
                                        }
                                        if (!innerAtMinFret) {
                                            is3dBarre = true;
                                            barreMinStr3d = minS; barreMaxStr3d = maxS;
                                        }
                                    }
                                }
                            }
                        }

                        if (is3dBarre && chDt <= 0) {
                            const bx = xFretMid(bFret);
                            const yTop = Math.max(sY(barreMinStr3d), sY(barreMaxStr3d));
                            const yBot = Math.min(sY(barreMinStr3d), sY(barreMaxStr3d));
                            const lineH = yTop - yBot;
                            const bl = pBarreLine.get();
                            bl.position.set(bx, (yTop + yBot) / 2, 0.05 * K);
                            bl.scale.set(0.5 * K, lineH, 0.5 * K);
                            bl.material.opacity = 0.8 * chordTailMul;
                        }
                    }

                    // ── Chord fret numbers at the base of the highway ───────────────
                    // Show fret number per unique fretted position for non-repeated
                    // chords so the player can read the shape at a glance.
                    if (!isRepeat) {
                        const _chFretLblAlpha = Math.min(1.0, (AHEAD - chDt) / 0.35) * chordTailMul;
                        const _seenChordFrets = new Set();
                        for (const [, f] of chShape) {
                            if (f <= 0 || _seenChordFrets.has(f)) continue;
                            _seenChordFrets.add(f);
                            const lbl = pNoteFretLabel.get();
                            const mat = txtMat(f, FRET_LABEL_GOLD_HEX, false, 'noteFret');
                            _setLabelMap(lbl, mat);
                            lbl.position.set(xFretMid(f), yMinF, z);
                            lbl.renderOrder = renderOrderForLayerAtZ(z, 'CHORD_FRET_LABEL');
                            const _flS = 7.0 * K * (1 + 0.4 * chDt / AHEAD) * _textSizeMul * fretLabelScaleForFret(f);
                            lbl.scale.set(_flS, _flS, 1);
                            lbl.material.opacity = _chFretLblAlpha;
                        }
                    }

                    // ── Palm-mute strum indicator — pool (fill + lines) ──────────────
                    // Per-chord Z-proportional renderOrder: muted fill/lines and
                    // frame edges all use the named layer offsets above.
                    if (isRepeat && chordNotes.some(cn => cn.pm)) {
                        if (pPMXFill) {
                            const xf = pPMXFill.get();
                            xf.renderOrder = renderOrderForLayerAtZ(z, 'CHORD_STRUM_FILL');
                            xf.material.opacity = edgeOp * CHORD_BOX_EDGE_ALPHA;
                            xf.position.set(cx, cY, z - 0.0045 * K);
                            xf.scale.set(innerW * 0.5, -innerH * 0.5, 1);
                            xf.rotation.set(0, 0, 0);
                        }
                        if (pMuteXLines) {
                            const xl = pMuteXLines.get();
                            xl.renderOrder = renderOrderForLayerAtZ(z, 'CHORD_STRUM_LINE');
                            xl.material.opacity = edgeOp * 0.85;
                            xl.material.color.setHex(baseRimHex);
                            xl.position.set(cx, cY, z - 0.005 * K);
                            xl.scale.set(innerW * 0.5, -innerH * 0.5, thickZ * 0.5);
                            xl.rotation.set(0, 0, 0);
                        }
                    }

                    // ── Frethand-mute strum indicator — pool (fill + lines) ───────────
                    if (isRepeat && chordNotes.some(cn => cn.mt || cn.fhm)) {
                        if (pFHXFill) {
                            const xf = pFHXFill.get();
                            xf.renderOrder = renderOrderForLayerAtZ(z, 'CHORD_STRUM_FILL');
                            xf.material.opacity = edgeOp * CHORD_BOX_EDGE_ALPHA;
                            xf.position.set(cx, cY, z - 0.0045 * K);
                            xf.scale.set(innerW * 0.5, -innerH * 0.5, 1);
                            xf.rotation.set(0, 0, 0);
                        }
                        if (pFHXLines) {
                            const xl = pFHXLines.get();
                            xl.renderOrder = renderOrderForLayerAtZ(z, 'CHORD_STRUM_LINE');
                            xl.material.opacity = edgeOp * 0.85;
                            xl.material.color.setHex(baseRimHex);
                            xl.position.set(cx, cY, z - 0.005 * K);
                            xl.scale.set(innerW * 0.5, -innerH * 0.5, thickZ * 0.5);
                            xl.rotation.set(0, 0, 0);
                        }
                    }

                    } // end if (chDt > 0) — framebox + PM/FH mute only on highway

                }

                // ── Chord sustain length indicator — 3D plane rails ─────────────
                // Left + right rail as plane meshes (PlaneGeometry +
                // MeshBasicMaterial) in the WebGL scene so they respect
                // renderOrder (16) and never occlude note gems (20/21).
                // isRepeat chords also draw their rail: each repeat shows a
                // segment from its own onset to the next chord's onset (or the
                // handshape end, whichever is shorter), chaining together to
                // cover the full handshape duration visually.
                if (chShape.size > 1 && chordOpenBoxW != null && chDt < AHEAD) {
                    // Cap handshape-derived sustain at the gap to the next chord.
                    // Each chord (including repeats) only extends to the next
                    // chord's onset, so the rail never lingers past the anchor
                    // region of the current chord.
                    const _nextChordGap = (ci + 1 < chords.length)
                        ? chords[ci + 1].t - ch.t
                        : Infinity;
                    // Use the time remaining in the handshape from this chord's
                    // onset (hsEnd - ch.t), NOT the full handshape span. When
                    // multiple chords share the same handshape window (e.g. A5
                    // at 63.527 and again at 64.137 both fall inside the same
                    // handshape start=63.527 end=64.239), each chord after the
                    // first starts mid-handshape. Using the full span (0.712s)
                    // for the mid-handshape chord gives a rail that extends
                    // 0.611s — far past the handshape end — causing the
                    // "elongated border" that visually swallows subsequent
                    // single notes. Clamping to (hsEnd - ch.t) gives 0.102s,
                    // which correctly terminates at the handshape boundary.
                    const _hsSus = (maxSus === 0 && !deferChordGems && hsHintFrame && hsHintFrame.hs)
                        ? Math.min(Math.max(0, hsEnd(hsHintFrame.hs) - ch.t), _nextChordGap)
                        : 0;
                    // "Chord hold": suppressed non-arp synth chord where deferChordGems
                    // zeroed _hsSus. Use h3dSynthEnd (= handshape end_time) instead.
                    const _synthSus = (suppressSynthChord && ch.h3dSynth
                        && !chordTemplateMarkedArpeggio(ch.id, bundle.chordTemplates)
                        && ch.h3dSynthEnd != null)
                        ? Math.max(0, ch.h3dSynthEnd - ch.t)
                        : 0;
                    const _rawSus = maxSus > 0 ? maxSus : Math.max(_hsSus, _synthSus);
                    // Apply the 0.4 s visual-minimum only to chords with an
                    // explicit note sustain (maxSus > 0). Handshape-derived
                    // sustain (_hsSus, already capped at _nextChordGap) must
                    // not be inflated — that would undo the gallop cap and
                    // cause the rail to reappear at the old anchor position.
                    const _effSus = maxSus > 0
                        ? Math.max(_rawSus, 0.4)
                        : _rawSus;
                    const _dtSusEnd  = chDt + _effSus;
                    if (_dtSusEnd > 0) {
                        // Clip the rail at the next anchor boundary so it doesn't
                        // extend into a different fret zone. The lane (pLane) slices
                        // correctly per-anchor; a single-segment rail at fixed X would
                        // visually "invade" the neighbouring region when anchors change
                        // within the sustain window.
                        let _dtSusEndRail = _dtSusEnd;
                        if (anchors && anchors.length) {
                            const _susAbsT = chDt > 0 ? ch.t : now;
                            if (getChartAnchorAt(anchors, _susAbsT) !==
                                getChartAnchorAt(anchors, now + _dtSusEnd)) {
                                // Binary search: first anchor starting strictly after _susAbsT.
                                let _lo = 0, _hi = anchors.length;
                                while (_lo < _hi) {
                                    const _mid = (_lo + _hi) >>> 1;
                                    if (anchors[_mid].time <= _susAbsT) _lo = _mid + 1;
                                    else _hi = _mid;
                                }
                                if (_lo < anchors.length)
                                    _dtSusEndRail = anchors[_lo].time - now;
                            }
                        }
                        const _zNear = chDt > 0 ? dZ(chDt) : 0;
                        const _zFar  = dZ(Math.min(_dtSusEndRail, AHEAD));
                        const _railLen = _zNear - _zFar;
                        if (_railLen > 0.001) {
                            const _yA   = sY(0), _yB = sY(nStr - 1);
                            const _yBot = Math.min(_yA, _yB) - S_GAP * 0.8;
                            const _fadeAhead = chDt > 0 ? Math.max(0, 1 - chDt / AHEAD) : 1;
                            const _fadeSus   = Math.min(1, _dtSusEnd / 0.25);
                            const _op  = _fadeAhead * _fadeSus * 0.9;
                            const _hex = chordHighwayLavenderArpVisual ? ARPEGGIO_RIM_BLUE_HEX : CHORD_BOX_TEAL_HEX;
                            const _railW = 1.875 * K; // visual width of each rail strip
                            const _zMid  = _zNear - _railLen * 0.5; // centre in Z
                            for (const [_rx, _inDir] of [[chordFrameXL, -1], [chordFrameXR, 1]]) {
                                const _rxIn = _rx + _inDir * _railW * 0.5;
                                // Core rail
                                const rl = pSusRail.get();
                                rl.material.color.setHex(_hex);
                                rl.material.opacity = _op;
                                rl.position.set(_rxIn, _yBot, _zMid);
                                rl.scale.set(_railW, 1, _railLen);
                                // Bloom glow — wider gaussian plane, additive blending
                                if (!_leanSus) {
                                    const bl = pSusRailBloom.get();
                                    bl.material.color.setHex(_hex);
                                    bl.material.opacity = _op * 0.8;
                                    bl.position.set(_rxIn, _yBot + 0.001, _zMid);
                                    bl.scale.set(3 * K, 1, _railLen);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Fret span of the dynamic highway lane (wire dMin .. dMax). Reused
        // so fret-column measure markers stay inside the same horizontal
        // band as the blue track — previously markers used every inlay
        // fret and stuck out past the lane whenever the camera narrowed.
        let hwyLaneFretClipMin = null, hwyLaneFretClipMax = null;

        const handShapesRails = bundle.handShapes;
        hwyLaneArpOuterDividers = !!(handShapesRails && handShapesRails.length && laneRailArpHsFlags
            && arpeggioLaneOuterRailAtChartTime(
                now, handShapesRails, laneRailBoundLo, laneRailBoundHi, laneRailArpHsFlags,
            ));
        const arpLaneRimAccentMul = hwyLaneArpOuterDividers && laneRailArpHsFlags && handShapesRails
            ? arpeggioLaneDividerFrameAccentMul(
                now, handShapesRails, chords, laneRailBoundLo, laneRailBoundHi, laneRailArpHsFlags,
            )
            : 1;
        const arpLaneS = hwyLaneArpOuterDividers
            ? arpeggioLaneDividerXYScaleMatchFrameRim(arpLaneRimAccentMul)
            : 1;

        // ── Dynamic highway lane ──────────────────────────────────────
        // Chart <anchor> tags drive the lane whenever they exist — do not
        // require nearby notes (activeFrets) or camera-driven activity.
        const hasChartAnchors = anchors && anchors.length;
        if (hasChartAnchors || activeFrets.size > 0) {
            // Lane tint: one translucent quad per playable fret column, exact
            // wire→wire span (no horizontal pad) — see HWY_LANE_STRIPE_*.
            const boardY = S_BASE - NH / 2 - 2 * K;

            if (hasChartAnchors) {
                const nearB = laneBoundsFromAnchor(getChartAnchorAt(anchors, now));
                if (nearB) {
                    hwyLaneFretClipMin = nearB.dMin;
                    hwyLaneFretClipMax = nearB.dMax;
                }

                // Span the full (AHEAD + BEHIND) window so the lane's far edge
                // lands at dZ(AHEAD) = -AHEAD*TS, aligned with the note horizon.
                // Using just AHEAD here made the far edge stop at -TS*(AHEAD-BEHIND),
                // leaving the last BEHIND seconds of notes without a lane underneath.
                const sliceDt = (AHEAD + BEHIND) / HWY_LANE_TIME_SLICES;
                // Single-pass build-and-merge into the parallel-array
                // scratch buffers. Consecutive slices that resolve to the
                // same anchor bounds collapse into one segment by extending
                // its z1; otherwise a new entry appends. No per-frame array
                // or {b,z0,z1} object allocations.
                _laneSegLen = 0;
                for (let k = 0; k < HWY_LANE_TIME_SLICES; k++) {
                    const dt0 = k * sliceDt;
                    const dt1 = (k + 1) * sliceDt;
                    const tC = now + (dt0 + dt1) * 0.5 - BEHIND;
                    const b = laneBoundsFromAnchor(getChartAnchorAt(anchors, tC));
                    if (!b) continue;
                    const z0 = dZ(dt0) + TS * BEHIND;
                    const z1 = dZ(dt1) + TS * BEHIND;
                    const arpSlice = (laneRailArpHsFlags && handShapesRails && handShapesRails.length)
                        ? arpeggioLaneOuterRailLaneSlice(
                            dt0, dt1, now,
                            handShapesRails, laneRailBoundLo, laneRailBoundHi, laneRailArpHsFlags,
                        )
                        : false;
                    if (_laneSegLen > 0
                        && _laneSegDMin[_laneSegLen - 1] === b.dMin
                        && _laneSegDMax[_laneSegLen - 1] === b.dMax
                        && arpSlice === _laneSegArp[_laneSegLen - 1]) {
                        _laneSegZ1[_laneSegLen - 1] = z1;
                        _laneSegTHi[_laneSegLen - 1] = tC;
                    } else if (_laneSegLen > 0
                        && _laneSegDMin[_laneSegLen - 1] === b.dMin
                        && _laneSegDMax[_laneSegLen - 1] === b.dMax
                        && arpSlice !== _laneSegArp[_laneSegLen - 1]) {
                        _laneSegDMin[_laneSegLen] = b.dMin;
                        _laneSegDMax[_laneSegLen] = b.dMax;
                        _laneSegZ0[_laneSegLen] = z0;
                        _laneSegZ1[_laneSegLen] = z1;
                        _laneSegTLo[_laneSegLen] = tC;
                        _laneSegTHi[_laneSegLen] = tC;
                        _laneSegArp[_laneSegLen] = arpSlice;
                        _laneSegLen++;
                    } else {
                        _laneSegDMin[_laneSegLen] = b.dMin;
                        _laneSegDMax[_laneSegLen] = b.dMax;
                        _laneSegZ0[_laneSegLen] = z0;
                        _laneSegZ1[_laneSegLen] = z1;
                        _laneSegTLo[_laneSegLen] = tC;
                        _laneSegTHi[_laneSegLen] = tC;
                        _laneSegArp[_laneSegLen] = arpSlice;
                        _laneSegLen++;
                    }
                }
                {
                    const laneOp = (HWY_LANE_STRIPE_OP_BASE + highwayIntensity * HWY_LANE_STRIPE_OP_INT)
                        * (_venueSceneOverride ? VENUE_LANE_OP_BOOST : 1);
                    // 2 shared materials (odd/even); opacity travels via the
                    // material so set it once per frame, not per mesh.
                    mLaneOdd.opacity = laneOp;
                    mLaneEven.opacity = laneOp;
                    for (let s = 0; s < _laneSegLen; s++) {
                        const segZ0 = _laneSegZ0[s];
                        const segZ1 = _laneSegZ1[s];
                        const stripLen = Math.max(Math.abs(segZ1 - segZ0), 1e-6);
                        const zc = (segZ0 + segZ1) * 0.5;
                        const fLow = _laneSegDMin[s] + 1;
                        const fHi = _laneSegDMax[s];
                        for (let f = fLow; f <= fHi; f++) {
                            const xl = xFret(f - 1), xr = xFret(f);
                            const laneW = Math.abs(xr - xl);
                            const lane = pLane.get();
                            lane.position.set((xl + xr) * 0.5, boardY + 0.02 * K, zc);
                            lane.rotation.x = -Math.PI / 2;
                            lane.scale.set(laneW, stripLen, 1);
                            const odd = ((f - fLow) & 1) === 0;
                            lane.material = odd ? mLaneOdd : mLaneEven;
                            lane.renderOrder = 1;
                        }
                    }
                }

                {
                    const yPos = boardY + 0.03 * K;
                    const divOpArp = Math.min(0.92, 0.16 + highwayIntensity * 0.42);
                    if (mLaneDividerArp) {
                        mLaneDividerArp.opacity = divOpArp;
                    }

                    for (let s = 0; s < _laneSegLen; s++) {
                        const segZ0 = _laneSegZ0[s];
                        const segZ1 = _laneSegZ1[s];
                        const dz = Math.max(Math.abs(segZ1 - segZ0), 1e-6);
                        const zMid = (segZ0 + segZ1) * 0.5;
                        const dMinSeg = _laneSegDMin[s];
                        const dMaxSeg = _laneSegDMax[s];
                        const fDiv0 = Math.floor(dMinSeg);
                        const fDiv1 = Math.ceil(dMaxSeg);
                        for (let f = fDiv0; f <= fDiv1; f++) {
                            if (_laneSegArp[s] && (f === fDiv0 || f === fDiv1)) continue;
                            const div = pLaneDivider.get();
                            div.position.set(xFret(f), yPos, zMid);
                            div.material = mLaneDivider;
                            div.scale.set(1, 1, dz);
                            div.renderOrder = 2;
                        }
                    }
                    for (let s = 0; s < _laneSegLen; s++) {
                        if (!_laneSegArp[s]) continue;
                        const dMinSeg = _laneSegDMin[s];
                        const dMaxSeg = _laneSegDMax[s];
                        const fL = Math.floor(dMinSeg);
                        const fR = Math.ceil(dMaxSeg);
                        const segZ0 = _laneSegZ0[s];
                        const segZ1 = _laneSegZ1[s];
                        const arpRailLen = Math.max(Math.abs(segZ1 - segZ0), 1e-6);
                        const zArpMid = (segZ0 + segZ1) * 0.5;
                        const tMidSeg = (_laneSegTLo[s] + _laneSegTHi[s]) * 0.5;
                        const arpMulSeg = (laneRailArpHsFlags && handShapesRails && handShapesRails.length)
                            ? arpeggioLaneDividerFrameAccentMul(
                                tMidSeg, handShapesRails, chords,
                                laneRailBoundLo, laneRailBoundHi, laneRailArpHsFlags,
                            )
                            : 1;
                        const arpSSeg = arpeggioLaneDividerXYScaleMatchFrameRim(arpMulSeg);
                        for (const xf of [fL, fR]) {
                            const div = pLaneDivider.get();
                            div.position.set(xFret(xf), yPos, zArpMid);
                            div.material = mLaneDividerArp;
                            div.scale.set(arpSSeg, arpSSeg, arpRailLen);
                            div.renderOrder = 2;
                        }
                    }
                }
            } else {
                let dMin, dMax;
                let divMin, divMax;
                let minF = 99, maxF = 0;
                activeFrets.forEach(f => { if (f > 0) { minF = Math.min(minF, f); maxF = Math.max(maxF, f); } });
                dMin = minF - 1;
                dMax = maxF;
                const HWY_LANE_SPAN = 4;
                let span = dMax - dMin;
                if (span > HWY_LANE_SPAN) {
                    dMin = Math.round((dMin + dMax - HWY_LANE_SPAN) / 2);
                    dMax = dMin + HWY_LANE_SPAN;
                    if (dMax > NFRETS) {
                        dMax = NFRETS;
                        dMin = dMax - HWY_LANE_SPAN;
                    }
                    if (dMin < 0) {
                        dMin = 0;
                        dMax = HWY_LANE_SPAN;
                    }
                } else if (span < HWY_LANE_SPAN) {
                    const need = HWY_LANE_SPAN - span;
                    dMax = Math.min(NFRETS, dMax + need);
                    if (dMax - dMin < HWY_LANE_SPAN) {
                        dMin = Math.max(0, dMin - (HWY_LANE_SPAN - (dMax - dMin)));
                    }
                }
                if (dMax < dMin) dMax = dMin;
                hwyLaneFretClipMin = dMin;
                hwyLaneFretClipMax = dMax;
                divMin = dMin;
                divMax = dMax;

                // Same fix: extend to AHEAD+BEHIND so far edge = -AHEAD*TS.
                const laneLen = TS * (AHEAD + BEHIND);
                const zLane = -laneLen / 2 + TS * BEHIND;
                const laneOp = (HWY_LANE_STRIPE_OP_BASE + highwayIntensity * HWY_LANE_STRIPE_OP_INT)
                    * (_venueSceneOverride ? VENUE_LANE_OP_BOOST : 1);
                mLaneOdd.opacity = laneOp;
                mLaneEven.opacity = laneOp;
                const fLow = dMin + 1;
                const fHi = dMax;
                for (let f = fLow; f <= fHi; f++) {
                    const xl = xFret(f - 1), xr = xFret(f);
                    const laneWStrip = Math.abs(xr - xl);
                    const lane = pLane.get();
                    lane.position.set((xl + xr) / 2, boardY + 0.02 * K, zLane);
                    lane.rotation.x = -Math.PI / 2;
                    lane.scale.set(laneWStrip, laneLen, 1);
                    const odd = ((f - fLow) & 1) === 0;
                    lane.material = odd ? mLaneOdd : mLaneEven;
                    lane.renderOrder = 1;
                }

                if (highwayIntensity > 0.05) {
                    const divLen = TS * (AHEAD + BEHIND);
                    const yPos = boardY + 0.03 * K;
                    const divOp2 = 0.02 + highwayIntensity * 0.1;
                    const divOpArp2 = Math.min(0.92, 0.16 + highwayIntensity * 0.42);
                    if (mLaneDivider && mLaneDividerArp) {
                        mLaneDivider.opacity = divOp2;
                        mLaneDividerArp.opacity = divOpArp2;
                    }
                    const fDivA = Math.floor(divMin);
                    const fDivB = Math.ceil(divMax);
                    for (let f = fDivA; f <= fDivB; f++) {
                        if (hwyLaneArpOuterDividers && (f === fDivA || f === fDivB)) continue;
                        const div = pLaneDivider.get();
                        div.position.set(xFret(f), yPos, dZ(0) - divLen * 0.5 + TS * BEHIND);
                        div.material = mLaneDivider;
                        div.scale.set(1, 1, divLen);
                        div.renderOrder = 2;
                    }
                    if (hwyLaneArpOuterDividers) {
                        for (const xf of [fDivA, fDivB]) {
                            const div = pLaneDivider.get();
                            div.position.set(xFret(xf), yPos, zLane);
                            div.material = mLaneDividerArp;
                            div.scale.set(arpLaneS, arpLaneS, laneLen);
                            div.renderOrder = 2;
                        }
                    }
                }
            }

            // ── Fret boundary extension lines ─────────────────────────
            if (mLaneDividerExt && fretDividersVisible) {
                const extLaneLen = TS * (AHEAD + BEHIND);
                const extZMid = -extLaneLen / 2 + TS * BEHIND;
                const extYPos = boardY + 0.03 * K;
                mLaneDividerExt.opacity = Math.max(0.3, 0.3 + highwayIntensity * 0.15);
                for (let f = 0; f <= NFRETS; f++) {
                    const div = pLaneDivider.get();
                    div.position.set(xFret(f), extYPos, extZMid);
                    div.material = mLaneDividerExt;
                    div.scale.set(1, 1, extLaneLen);
                    div.renderOrder = 2;
                }
            }
        }

        // ── Dynamic fret number row (heat-coloured) ───────────────────
        // Two-part fix for issue #35:
        //  1. renderOrder = 1000 forces these sprites to the end of
        //     the transparent queue so they always paint on top of
        //     notes, sustain trails, lane plane, etc. depthTest is
        //     already disabled by txtMat(), but `depthTest: false`
        //     only exempts the sprite from depth comparison — it
        //     doesn't pin draw order. Without an explicit
        //     renderOrder, a note rendered after the label in the
        //     transparent pass would still overdraw it. Match the
        //     pattern already used for lane and dividers.
        //  2. Y-offset bumped from S_GAP * 0.6 to S_GAP * 1.4 so the
        //     label band sits clearly below the lowest string in
        //     screen space, even at the largest active scale
        //     (intensity-driven, up to ~5.7 * K vertical extent).
        //     This buys a real visual gap between notes-on-the-
        //     lowest-string and the row, on top of the renderOrder
        //     guarantee — labels never share screen with what's
        //     happening on the playing strings just above them.
        {
            const yBottom = Math.min(sY(0), sY(nStr - 1));
            // anchorSpan: [f0, f1] = [anchor.fret, anchor.fret + width - 1]
            // e.g. { fret:3, width:4 } → f0=3, f1=6 → frets 3,4,5,6 gold.
            const anchorSpan = anchorPlayedFretSpanAt(anchors, now);
            for (let f = 1; f <= NFRETS; f++) {
                const isInAnchor = anchorSpan
                    && f >= anchorSpan.f0 && f <= anchorSpan.f1;
                const isMainFret = DOTS.includes(f);
                // Rule 1: show gray label only on main frets (dot positions).
                // Rule 2: show gold label on any fret inside the anchor range.
                // Non-main frets outside the anchor range are hidden entirely.
                if (!isInAnchor && !isMainFret) continue;
                const lb = pFretLbl.get();
                lb.material = txtMat(f,
                    isInAnchor ? FRET_LABEL_GOLD_HEX : FRET_LABEL_IDLE_HEX,
                    false, 'fretRow');
                lb.position.set(xFretMid(f), yBottom - S_GAP * 1.4, 0.5 * K);
                lb.material.opacity = isInAnchor ? 1.0 : 0.55;
                const scale = 5.95 * _textSizeMul * fretLabelScaleForFret(f);
                lb.scale.set(scale * K, scale * K, 1);
                lb.renderOrder = 1000;
            }
        }

        // ── Beat lines ────────────────────────────────────────────────
        if (beats) {
            const board = boardSpanX();
            const bw2 = board.width + 4 * K;
            let lastM = -1;
            for (const b of beats) {
                const meas = b.measure !== lastM; lastM = b.measure;
                if (b.time < t0 || b.time > t1) continue;
                const bl2 = pBeat.get();
                bl2.material = meas ? mBeatM : mBeatQ;
                bl2.scale.set(bw2, 1, 1);
                bl2.position.set(board.min - 2 * K, S_BASE - NH / 2 - 1.5 * K, dZ(b.time - now));
            }
        }

        // ── Section labels ────────────────────────────────────────────
        // Gated on sectionLabelsOnHighway (advanced setting, default off).
        // The HUD card (drawSectionHud, called from the lyricsCtx block in
        // draw()) is the primary surface for section info; the on-highway
        // sprites are kept as an opt-in for users who want the in-scene cue.
        if (sections && sectionLabelsOnHighway) {
            const labelY = Math.max(sY(0), sY(nStr - 1)) + 8 * K;
            for (const s of sections) {
                if (s.time < t0 || s.time > t1) continue;
                const sp = pSec.get();
                sp.material = txtMat(s.name, '#00cccc', true, 'section');
                sp.scale.set(20 * K * _textSizeMul, 5 * K * _textSizeMul, 1);
                sp.position.set(xFret(12), labelY, dZ(s.time - now));
            }
        }

        // ── Fret-column reference markers ─────────────────────────────
        // Every Nth measure, spawn a row of fret-number sprites on the
        // board floor that scroll toward the hit line and vanish at Z=0.
        // With a chart <anchor>, which frets appear follows the inlay
        // cadence (DOTS) centred on the snapped anchor fret (~2 positions
        // back and ~3 forward in that list, e.g. anchor 7 → 3,5,7,9,12,15).
        // Without anchors, all DOTS positions are candidates; octave + lane
        // clipping apply. With <anchor>, the cadence row ignores both so
        // frets before/after the lane still show as reference. Light grey
        // when that fret is in the active set, dark grey otherwise.
        //
        // Per-wave gate cache: hasLow/hasHigh/fretList snapshotted at first
        // sight of a wave so the render decision stays stable through
        // the wave's full flight. Without this, activeFrets shifting
        // mid-song would drop markers mid-flight (user-reported bug:
        // "numbers disappear before they get all the way towards me").
        if (beats && fretColumnMarkerCadence > 0) {
            // Prune stale wave cache entries (wave already past now).
            if (_fretMarkerWaveCache.size > 0) {
                for (const k of _fretMarkerWaveCache.keys()) {
                    if (k < now) _fretMarkerWaveCache.delete(k);
                }
            }
            const minStringY = Math.min(sY(0), sY(nStr - 1));
            const labelY = minStringY - S_GAP * 0.8;
            for (const b of beats) {
                // Non-downbeats are encoded as measure=-1; only actual
                // measure starts (measure >= 0) can spawn marker waves.
                if (b.measure < 0) continue;
                if (b.time < 0 || b.time > t1) continue;
                if (b.time <= now) continue;
                if ((b.measure | 0) % fretColumnMarkerCadence !== 0) continue;

                // Snapshot the active-range gate at first sight of this
                // wave. We scan notes/chords in a 2s window starting at
                // b.time rather than activeFrets, because activeFrets only
                // covers now+2s and waves first become visible up to
                // AHEAD (3s) ahead — using activeFrets would cache
                // {hasLow:false, hasHigh:false} for far waves and suppress
                // the entire row for its full flight.
                let cached = _fretMarkerWaveCache.get(b.time);
                if (!cached) {
                    let hasLow = false, hasHigh = false;
                    const wT0 = b.time, wT1 = b.time + 2;
                    // notes and chords are time-sorted; binary-search to the
                    // first entry >= wT0, then break once past wT1 to avoid
                    // O(song_length) work per newly-seen wave.
                    if (notes) {
                        const startI = lowerBoundT(notes, wT0);
                        for (let i = startI; i < notes.length; i++) {
                            const n = notes[i];
                            if (n.t > wT1) break;
                            if (!validString(n.s) || n.f <= 0) continue;
                            if (n.f <= 12) hasLow = true; else hasHigh = true;
                            if (hasLow && hasHigh) break;
                        }
                    }
                    if ((!hasLow || !hasHigh) && chords) {
                        const startI = lowerBoundT(chords, wT0);
                        outer: for (let i = startI; i < chords.length; i++) {
                            const ch = chords[i];
                            if (ch.t > wT1) break outer;
                            if (!ch.notes) continue;
                            for (const cn of ch.notes) {
                                if (!validString(cn.s) || cn.f <= 0) continue;
                                if (cn.f <= 12) hasLow = true; else hasHigh = true;
                                if (hasLow && hasHigh) break outer;
                            }
                        }
                    }
                    const anc = anchors && anchors.length ? getChartAnchorAt(anchors, b.time) : null;
                    const anchorFret = anc != null ? Number(anc.fret) : NaN;
                    const anchorKeyed = Number.isFinite(anchorFret) && anchorFret >= 0;
                    const fretList = anchorKeyed
                        ? fretColumnMarkersForAnchor(anchorFret, DOTS)
                        : DOTS.slice();
                    cached = { hasLow, hasHigh, fretList, anchorKeyed };
                    _fretMarkerWaveCache.set(b.time, cached);
                }
                if (!cached.hasLow && !cached.hasHigh && !cached.anchorKeyed) continue;

                const dt = b.time - now;
                // Fade in over 0.35 s from the maximum lookahead distance so
                // the label appears at its correct final size the moment it
                // becomes visible, rather than gradually emerging as a tiny
                // dim spec through scene fog (fog is disabled on the sprite
                // material; this manual ramp replaces it).
                const _colFadeIn = Math.min(1.0, (AHEAD - dt) / 0.35);
                if (_colFadeIn <= 0) continue;

                const z = dZ(dt);
                // Sprite scale matches the per-note connector fret label
                // (drawNote → pNoteFretLabel) so cadence markers read the
                // same size at a given Z — no extra world-scale boost.
                const clipMin = hwyLaneFretClipMin;
                const clipMax = hwyLaneFretClipMax;
                const fretList = cached.fretList || DOTS;
                const anchorKeyedRow = !!cached.anchorKeyed;
                for (const f of fretList) {
                    let show;
                    if (anchorKeyedRow) {
                        show = true;
                    } else {
                        if (f === 12) show = cached.hasLow || cached.hasHigh;
                        else if (f < 12) show = cached.hasLow;
                        else show = cached.hasHigh;
                    }
                    if (!show) continue;
                    if (!anchorKeyedRow && clipMin != null && (f <= clipMin || f > clipMax)) continue;
                    // Fixed colour — avoids mid-flight colour flips caused by
                    // activeFrets only covering now+2s while waves appear at
                    // AHEAD (3s), which made each marker start dark then
                    // suddenly jump to light when its note entered the 2s window.
                    const color = '#888888';
                    const sp = pFretColMarker.get();
                    const m = txtMat(f, color, false, 'noteFret');
                    _setLabelMap(sp, m);
                    sp.material.opacity = 0.85 * _colFadeIn;
                    sp.position.set(xFretMid(f), labelY, z);
                    // Z-proportional: sits between chord frame and note gem
                    // at the same depth, so chord frames never overdraw the
                    // marker and the marker never overdraws gems.
                    sp.renderOrder = renderOrderForLayerAtZ(z, 'FRET_COLUMN');
                    // Scale grows linearly from 2× at max lookahead to 1× at hit line,
                    // combined with natural perspective attenuation the label starts
                    // visibly larger and converges to the row-label size at z=0.
                    const sz = 7.0 * K * (1 + 0.4 * dt / AHEAD) * _textSizeMul * fretLabelScaleForFret(f);
                    sp.scale.set(sz, sz, 1);
                }

            }
        }

        // ── Camera target ─────────────────────────────────────────────
        let lockActive;
        if (!(cameraMode === 'lookahead')) {
            lockActive = _applyNoteCamTargets(
                camWX, camWSum, camDistMin, camDistMax, camDistGot,
                camHystF, camDistHystF, /* skipDistHyst= */ false);
            prevLockActive = lockActive;
        } else {
            const lookaheadMaxF = lookaheadBoundsNow ? lookaheadBoundsNow.maxF : 0;
            const lookaheadHasBounds = lookaheadBoundsNow != null;

            let dtSec = 1 / 120;
            if (_lookaheadCamPrevNow !== null) {
                const rawDt = _frameNow - _lookaheadCamPrevNow;
                if (rawDt > -1 && rawDt < 2) dtSec = Math.min(0.2, Math.max(1 / 960, rawDt));
            }
            _lookaheadCamPrevNow = _frameNow;
            const dBlend = Math.min(0.2, Math.max(1e-4, dtSec));
            const lowBlendFs = 1 - Math.pow(1 - CAM_FOCUS_BLEND_RATE, dBlend);

            if (!lookaheadHasBounds || lookaheadMaxF <= LOOKAHEAD_LOCK_ENGAGE_MAXF)
                _lookaheadHiNeckLatch = false;
            else if (lookaheadMaxF >= LOOKAHEAD_LOCK_RELEASE_MAXF)
                _lookaheadHiNeckLatch = true;

            const lookaheadLockLowEligible = cameraLockLow
                && (!lookaheadHasBounds
                    || (!_lookaheadHiNeckLatch && lookaheadMaxF <= 12));

            let rawLowBU;
            if (lookaheadLockLowEligible) {
                rawLowBU = camLowFretPullbackU(1);
            } else if (lookaheadBoundsNow) {
                rawLowBU = camLowFretPullbackU(lookaheadBoundsNow.minF);
            } else {
                rawLowBU = camLowFretPullbackU(CAM_LOCK_CENTER_FRET);
            }
            _lookaheadLowBonusU = rawLowBU * lowBlendFs + _lookaheadLowBonusU * (1 - lowBlendFs);

            if (lookaheadLockLowEligible) {
                const lockedBaseU = camBaseDistU(12);
                const lockZoomMul = CAM_LOCK_ZOOM_MIN +
                    (CAM_LOCK_ZOOM_MAX - CAM_LOCK_ZOOM_MIN) * cameraLockZoom;
                lookaheadSmoothCamStep(dtSec, xFretMid(CAM_LOCK_CENTER_FRET), 12);
                tgtX = _lookaheadCamX;
                tgtDist = (lockedBaseU + _lookaheadLowBonusU) * K * lockZoomMul;
                prevLowFretBonus = _lookaheadLowBonusU;
                lockActive = true;
            } else {
                if (lookaheadBoundsNow) {
                    const tgtWX = lookaheadTargetWorldX(
                        lookaheadBoundsNow.minF, lookaheadBoundsNow.maxF);
                    const tgtSpanInt = Math.max(
                        1, lookaheadBoundsNow.maxF - lookaheadBoundsNow.minF + 1);
                    lookaheadSmoothCamStep(dtSec, tgtWX, tgtSpanInt);
                    tgtDist = (camBaseDistU(_lookaheadFretSpan) + _lookaheadLowBonusU) * K;
                    prevLowFretBonus = _lookaheadLowBonusU;
                } else {
                    lookaheadSmoothCamStep(dtSec, _lookaheadCamX, _lookaheadFretSpan);
                    tgtDist = (camBaseDistU(_lookaheadFretSpan) + _lookaheadLowBonusU) * K;
                    prevLowFretBonus = _lookaheadLowBonusU;
                }
                tgtX = _lookaheadCamX;
                lockActive = false;
            }
            prevLockActive = lockActive;
        }

        // ── Chord diagram: track chord, drive entrance + crossfade animations ─
        {
            let newChord = null;
            if (chords) {
                // Only chords in (now - DIAG_LINGER_S, now] — use binary search
                // to skip past old chords, break once we pass `now`.
                const _dlo = lowerBoundT(chords, now - DIAG_LINGER_S);
                for (let _di = _dlo; _di < chords.length; _di++) {
                    const ch = chords[_di];
                    const chDt = ch.t - now;
                    if (chDt > 0) break;
                    if (!ch.notes) continue;
                    const tmpl = bundle.chordTemplates?.[ch.id];
                    const lbl = chordTemplateLabel(tmpl);
                    // Last valid chord (highest t ≤ now) naturally wins since array is sorted.
                    if (lbl && tmpl?.frets) {
                        newChord = { name: lbl, frets: tmpl.frets, t: ch.t, t0: ch.t, chDt, nStr };
                    }
                }
            }

            // Include frets in the key so two templates sharing a display name but
            // differing in fingering each trigger a fresh crossfade/entrance.
            const newKey = newChord ? newChord.name + '|' + newChord.frets.join(',') : null;
            if (newKey !== _diagLastKey) {
                if (_diagChord && newKey !== null) {
                    // Recompute outgoing alpha from stored event time rather than the
                    // stale per-frame chDt; after dropped frames or seeks this prevents
                    // the overlay jumping to a stale brightness before the crossfade.
                    const freshChDt = _diagChord.t !== undefined ? _diagChord.t - now : _diagChord.chDt;
                    const prevOpacity = Math.max(0, Math.min(1, 1 + freshChDt / DIAG_LINGER_S));
                    // Only crossfade when the outgoing chord is actually visible at now.
                    // freshChDt > 0 means the old chord is in the future (backward seek
                    // crossed the chord boundary).  In that case _diagChord is stale, so
                    // recompute the outgoing diagram from the chart — find the most recent
                    // named chord that ends just before newChord.t and use it as _diagPrev
                    // so that seeking into a historical chord transition fades correctly
                    // rather than snapping straight to the new chord.
                    if (freshChDt <= 0 && prevOpacity > 0) {
                        // Use the string count the outgoing chord was captured with, not the
                        // current nStr — an arrangement switch during a 150 ms crossfade
                        // must not remap the outgoing diagram onto the new layout.
                        _diagPrev = { name: _diagChord.name, frets: _diagChord.frets, nStr: _diagChord.nStr ?? nStr, t: _diagChord.t0 ?? _diagChord.t ?? now };
                        _diagPrevStartOpacity = prevOpacity;
                        _diagPrevOpacity = prevOpacity;
                        _diagPrevStartT = now;
                        // entranceT for the outgoing diagram is computed live from _diagPrev.t
                        // each frame (see draw path), so it rewinds correctly on backward seeks
                        // within the crossfade window — no separate snapped state needed here.
                    } else if (freshChDt > 0) {
                        // Backward seek: _diagChord is now in the future.
                        // Look up the chart chord immediately before newChord.t to provide
                        // the correct historical outgoing diagram for the crossfade.
                        let histPrev = null;
                        if (chords && newChord) {
                            // Find the most recent named chord before newChord.t.
                            // Chords are sorted ascending, so all matches are before
                            // lowerBoundT(chords, newChord.t); iterate in order and
                            // take the last valid one.
                            const _hpHi = lowerBoundT(chords, newChord.t);
                            for (let _hpi = 0; _hpi < _hpHi; _hpi++) {
                                const ch = chords[_hpi];
                                if (!ch.notes) continue;
                                const tmpl = bundle.chordTemplates?.[ch.id];
                                const lbl = chordTemplateLabel(tmpl);
                                if (lbl && tmpl?.frets) {
                                    histPrev = { name: lbl, frets: tmpl.frets, t: ch.t, t0: ch.t, nStr };
                                }
                            }
                        }
                        // Only start a crossfade if we are still within DIAG_CROSSFADE_S of
                        // newChord.t; seeking further into the chord skips the crossfade.
                        // Also skip if histPrev was no longer visible when newChord started
                        // (gap longer than DIAG_LINGER_S), so only genuinely adjacent chord
                        // transitions produce a crossfade — not seeks to just after any new
                        // chord that happens to have an older chord somewhere earlier in the song.
                        const elapsed = newChord ? now - newChord.t : Infinity;
                        const histPrevVisible = histPrev && (newChord.t - histPrev.t) < DIAG_LINGER_S;
                        if (histPrevVisible && elapsed >= 0 && elapsed < DIAG_CROSSFADE_S) {
                            // Start at the linger opacity the outgoing chord would have had at
                            // newChord.t during forward playback, not always 1.  This prevents
                            // a chord that was mostly faded from appearing brighter on a seek.
                            const histStartOpacity = Math.max(0, Math.min(1,
                                1 - (newChord.t - histPrev.t) / DIAG_LINGER_S));
                            _diagPrev = histPrev;
                            _diagPrevStartOpacity = histStartOpacity;
                            _diagPrevOpacity = Math.max(0, histStartOpacity * (1 - elapsed / DIAG_CROSSFADE_S));
                            _diagPrevStartT = newChord.t;
                        } else {
                            _diagPrev = null; _diagPrevOpacity = 0; _diagPrevStartOpacity = 0;
                            _diagPrevStartT = null;
                        }
                    } else {
                        // prevOpacity <= 0: old chord already fully faded, no crossfade needed.
                        _diagPrev = null; _diagPrevOpacity = 0; _diagPrevStartOpacity = 0;
                        _diagPrevStartT = null;
                    }
                } else {
                    _diagPrev = null; _diagPrevOpacity = 0; _diagPrevStartOpacity = 0;
                    _diagPrevStartT = null;
                }
                _diagLastKey = newKey;
                // Only update _diagChord when the chord key actually changes so that a
                // lingering chord's original nStr is preserved on subsequent frames.
                // (newChord is rebuilt every frame with the live nStr; unconditionally
                // assigning here would stomp the captured nStr if the arrangement switches
                // while the same chord is still in its linger window.)
                _diagChord = newChord;
            } else if (newKey !== null && newChord && _diagChord) {
                // Same chord re-seen. Update linger expiry (t) when the event time changes.
                // Forward restrum (newChord.t > _diagChord.t): extend the linger window
                // but preserve t0 so the entrance animation is NOT replayed — avoids the
                // overlay jumping back to its 0.85× scale on every strum of the same chord.
                // Backward seek to earlier occurrence (newChord.t < _diagChord.t): update
                // both t and t0 to restart the entrance animation from the earlier position.
                if (newChord.t !== _diagChord.t) {
                    _diagChord = newChord.t < _diagChord.t
                        ? { ..._diagChord, t: newChord.t, t0: newChord.t }  // backward seek
                        : { ..._diagChord, t: newChord.t };                 // forward restrum
                }
            }

            // Guard for backward seeks within the same chord (same key, no branch above).
            // If _diagPrevStartT is in the future relative to now, the crossfade was set up
            // during a later playback position that has since been seeked past. Clear it so
            // the stale outgoing diagram does not stay fully visible at the seek target.
            if (_diagPrev && _diagPrevStartT !== null && _diagPrevStartT > now) {
                _diagPrev = null; _diagPrevOpacity = 0; _diagPrevStartOpacity = 0;
                _diagPrevStartT = null;
            }

            // Entrance: derived from t0 (the original appearance time, not updated on
            // forward restrums) so repeated hits of the same chord do not replay the
            // 0.85→1.0 scale animation. On backward seeks t0 is updated alongside t,
            // so the animation still rewinds correctly to the earlier position.
            const _entranceAnchor = _diagChord && (_diagChord.t0 ?? _diagChord.t);
            _diagEntranceT = (_diagChord && _entranceAnchor !== undefined)
                ? Math.min(1.0, Math.max(0, (now - _entranceAnchor) / DIAG_ENTRANCE_S))
                : 1.0;

            // Crossfade: derived from absolute start time so backward seeks within the
            // crossfade window correctly rewind the fade. _diagPrev is kept alive (at
            // opacity 0) until the next key change rather than destroyed here, so that a
            // backward seek that re-enters the crossfade window can recompute a positive
            // opacity. Seeks before _diagPrevStartT are handled by the guard above.
            if (_diagPrev && _diagPrevStartT !== null) {
                const fadedT = Math.max(0, now - _diagPrevStartT);
                _diagPrevOpacity = Math.max(0, _diagPrevStartOpacity * (1 - fadedT / DIAG_CROSSFADE_S));
            }
        }
        // ── Finalise InstancedMesh batches ────────────────────────────────
        // Flush all 6 IMs: set visible instance count and mark buffers dirty.
        // Must run after all drawNote() / chord-loop writes are done.
        if (imPMTech) {
            imPMTech.count = _imPMTechCount;
            if (_imPMTechCount > 0) {
                imPMTech.instanceMatrix.needsUpdate = true;
                imPMTech.geometry.getAttribute('instanceAlpha').needsUpdate = true;
            }
        }
        if (imFHTech) {
            imFHTech.count = _imFHTechCount;
            if (_imFHTechCount > 0) {
                imFHTech.instanceMatrix.needsUpdate = true;
                imFHTech.geometry.getAttribute('instanceAlpha').needsUpdate = true;
            }
        }
        // These IMs are kept alive but always empty (count=0) — rendering
        // is now handled by the pPMXFill / pMuteXLines / pFHXFill / pFHXLines
        // pools which support per-chord Z-proportional renderOrder.
        if (imPMXFill)  imPMXFill.count  = 0;
        if (imPMXLines) imPMXLines.count = 0;
        if (imFHXFill)  imFHXFill.count  = 0;
        if (imFHXLines) imFHXLines.count = 0;

        pbEnd(5);
        pbEnd(0);
        pbReportTick();
    }

    /**
     * Indexed sustain ribbon (~SLIDE_RIBBON_SAMPLES longitudinal slices)
     * for slides, bends, vibrato and tremolo — smooth contour vs stacked
     * BoxGeometry segments.
     */
    function slideRibbonUpdatePositions(geom, strandBaseX, tw, th, y, sliceDur, susStart, now, n, slideSt) {
        const pa = geom.attributes.position.array;
        const S = SLIDE_RIBBON_SAMPLES;
        // slideOffsetWorldX is defined at module scope so it returns a
        // right-handed delta (built from non-lefty fretMid). strandBaseX is
        // already lefty-mirrored via xFretMid at the call site, so the
        // delta needs the same sign flip to keep the slide tracking the
        // mirrored fretboard direction.
        const dirMul = _leftyCached ? -1 : 1;
        let v = 0;
        for (let k = 0; k <= S; k++) {
            const Tk = susStart + (k / S) * sliceDur;
            const zk = dZ(Tk - now);
            const xc = strandBaseX
                + dirMul * slideOffsetWorldX(n, Tk, slideSt)
                + tremoloOffsetWorldX(n, Tk, tw);
            const yc = y + techniqueYOffsetWorld(n, Tk);
            pa[v++] = xc - tw * 0.5; pa[v++] = yc - th * 0.5; pa[v++] = zk;
            pa[v++] = xc + tw * 0.5; pa[v++] = yc - th * 0.5; pa[v++] = zk;
            pa[v++] = xc + tw * 0.5; pa[v++] = yc + th * 0.5; pa[v++] = zk;
            pa[v++] = xc - tw * 0.5; pa[v++] = yc + th * 0.5; pa[v++] = zk;
        }
        geom.attributes.position.needsUpdate = true;
        // Normals are pre-baked at geometry creation (see mkSlideRibbonGeo);
        // axis-aligned cross-section means they don't need per-frame recompute.
    }

    function noteHasVibrato(n) {
        return !!(n && (n.vb || n.vibrato));
    }

    function bendVisualDirY(stringIdx) {
        if (!Number.isFinite(stringIdx) || nStr <= 1) return 1;
        const visualIdx = _invertedCached ? stringIdx : (nStr - 1 - stringIdx);
        return visualIdx >= (nStr - 1) * 0.5 ? -1 : 1;
    }

    // Teaching marks (§6.2.2) — display only, never grading. Pure label
    // helpers, mirroring static/highway.js so the two highways agree;
    // node-tested via tests/js/highway_teaching_marks.test.js.
    function teachingFingerLabel(fg) {
        // fret-hand finger: '' when unset/out of range; 0 -> 'T' (thumb),
        // 1..4 -> '1'..'4'.
        if (!Number.isInteger(fg) || fg < 0 || fg > 4) return '';
        return fg === 0 ? 'T' : String(fg);
    }
    function teachingDegreeLabel(sd) {
        // scale degree: chromatic 0..11 above the active key tonic; '' when
        // unset/out of range.
        if (!Number.isInteger(sd) || sd < 0 || sd > 11) return '';
        return String(sd);
    }
    /** Harmony annotations (§6.3.1 / §6.6): display labels for a chord's
     * function (instance `fn.rn` Roman numeral) and template `voicing`,
     * `caged` shape, and `guideTones`. '' for each when absent/malformed;
     * `caged`/`guideTones` come back pre-formatted ("CAGED: E" / "gt 4,10").
     * Pure; shared with the 2D highway and node-tested. Display only — never
     * grading. */
    function chordHarmonyLabels(fn, voicing, caged, guideTones) {
        const rn = (fn && typeof fn.rn === 'string') ? fn.rn.trim() : '';
        const vc = (typeof voicing === 'string') ? voicing.trim() : '';
        const cg = (typeof caged === 'string' && /^[CAGED]$/.test(caged.trim()))
            ? 'CAGED: ' + caged.trim() : '';
        const gt = Array.isArray(guideTones)
            ? guideTones.filter(n => Number.isInteger(n) && n >= 0 && n <= 11) : [];
        return { rn, voicing: vc, caged: cg, guideTones: gt.length ? 'gt ' + gt.join(',') : '' };
    }

    function bnvSampleAt(bnv, t) {
        // Linear interpolation of a bend curve [{t, v}] (§6.2.1; t is
        // seconds from the note onset) at elapsed time t. Clamps to the
        // endpoints; returns 0 for an empty/invalid curve.
        if (!Array.isArray(bnv) || bnv.length === 0) return 0;
        if (t <= bnv[0].t) return bnv[0].v;
        const last = bnv[bnv.length - 1];
        if (t >= last.t) return last.v;
        for (let i = 1; i < bnv.length; i++) {
            const a = bnv[i - 1], b = bnv[i];
            if (t <= b.t) {
                const span = b.t - a.t;
                return span > 0 ? a.v + (b.v - a.v) * ((t - a.t) / span) : b.v;
            }
        }
        return last.v;
    }

    function bendSemisAtTime(n, chartTime) {
        if (!(n?.sus > 0)) return 0;
        // When the note carries an authoritative bend curve (§6.2.1),
        // sample its real shape at the elapsed time so the gem's Y gesture
        // and sustain ribbon follow the actual bend (pre-bend, round-trip,
        // release, …). Negative samples clamp to 0 (upward-only Y offset).
        if (Array.isArray(n.bnv) && n.bnv.length) {
            return Math.max(0, bnvSampleAt(n.bnv, chartTime - n.t));
        }
        const bn = Number(n?.bn) || 0;
        if (!(bn > 0)) return 0;
        const p = Math.max(0, Math.min(1, (chartTime - n.t) / Math.max(n.sus, 1e-6)));
        // Fallback: synthesize rise → hold → release from the scalar peak.
        // Ramp up over the first ~35 %, hold, then release over the last
        // ~30 % — the bend gesture rather than a monotone climb. Drives both
        // the sustain ribbon's Y contour and the gem's techniqueYNow offset.
        const RISE = BEND_ENV_RISE_FRAC, REL = BEND_ENV_RELEASE_FRAC;
        let env;
        if (p < RISE) env = p / RISE;
        else if (p < 1 - REL) env = 1;
        else env = (1 - p) / REL;
        return bn * Math.max(0, Math.min(1, env));
    }

    function vibratoSemisAtTime(n, chartTime) {
        if (!noteHasVibrato(n) || !(n?.sus > 0)) return 0;
        const elapsed = Math.max(0, chartTime - n.t);
        return Math.sin(elapsed * Math.PI / VIBRATO_HALF_WAVE_S);
    }

    function techniqueYOffsetWorld(n, chartTime) {
        if (!(n?.sus > 0)) return 0;
        const bendSemi = bendSemisAtTime(n, chartTime);
        const vibratoSemi = vibratoSemisAtTime(n, chartTime);
        if (bendSemi === 0 && vibratoSemi === 0) return 0;
        return bendVisualDirY(n.s) * BEND_HALFSTEP_WORLD_Y * (bendSemi + vibratoSemi);
    }

    function tremoloOffsetWorldX(n, chartTime, trailW) {
        if (!(n?.tr) || !(n?.sus > 0)) return 0;
        const elapsed = Math.max(0, chartTime - n.t);
        const phase = (elapsed % TREMOLO_BUMP_S) / TREMOLO_BUMP_S;
        const tri = (Math.abs(phase - 0.5) - 0.25) * 3;
        return trailW * 0.5 * tri;
    }

    /* ── Note renderer ───────────────────────────────────────────────── */
    // Chart-format <chordTemplates> frets: -1 = unused, 0 = open, n>0 = fret.
    // Ghost digit for chord notes uses the template row when present so it
    // matches the XML diagram, not a divergent chordNote.f if any.
    function _templateFretForChordGhost(chordId, stringIdx, noteFret) {
        if (chordId == null) return noteFret;
        // Coerce: some upstream paths (e.g. hs.chord_id from sloppaks)
        // hand us string ids like "12". Cf. `templates[cid] ?? templates[Number(cid)]`
        // earlier in this file.
        const cid = typeof chordId === 'number' ? chordId : Number(chordId);
        if (!Number.isFinite(cid)) return noteFret;
        const fr = _drawChordTemplates?.[cid]?.frets;
        if (!Array.isArray(fr) || stringIdx < 0 || stringIdx >= fr.length) return noteFret;
        const tf = fr[stringIdx];
        if (typeof tf !== 'number' || tf < 0) return noteFret;
        return tf;
    }
    // Chart-format-style ghost digit: finger position (1=index … 4=pinky) from
    // the chord template.  Returns null when no finger data is available
    // (GP imports emit all -1; open strings have finger 0 which we skip too
    // since "0" is already shown via the open-string note path).
    function _templateFingerForChordGhost(chordId, stringIdx) {
        if (chordId == null) return null;
        const cid = typeof chordId === 'number' ? chordId : Number(chordId);
        if (!Number.isFinite(cid)) return null;
        const fi = _drawChordTemplates?.[cid]?.fingers;
        if (!Array.isArray(fi) || stringIdx < 0 || stringIdx >= fi.length) return null;
        const tf = fi[stringIdx];
        // -1 = unused / no data (GP imports); 0 = open string (skip — gem path handles it)
        if (typeof tf !== 'number' || tf <= 0) return null;
        return tf; // 1–4
    }
    /**
     * Renders one board-ghost fret digit onto a pooled label mesh, flat
     * in the board XY plane at (x, y, 0) — a Mesh (not a Sprite
     * billboard) so perspective + projRim match the 3D ghost frame.
     * Shared by drawNote()'s Primary ghost slot (chord/arp-aware caller
     * resolves fretDisplay/alpha/fretForScale itself) and its Upcoming
     * slots (always plain lead notes, where those collapse to
     * n.f/projFactor/n.f).
     */
    function drawGhostFretLabel(x, y, projRim, fretDisplay, alpha, growScale, fretForScale) {
        const lb = pGhostFretLbl.get();
        const sprMat = txtMat(fretDisplay, '#ffffff', false, 'ghostFret');
        const baseGhostMat = _meshMatForGhostFretDigit(sprMat);
        let instMat = lb.userData.h3dGhostFretLblInstMat;
        if (!instMat || instMat.map !== baseGhostMat.map) {
            if (instMat) {
                try { instMat.dispose(); } catch (_) { /* idempotent */ }
            }
            instMat = baseGhostMat.clone();
            instMat.transparent = true;
            instMat.needsUpdate = true;
            lb.userData.h3dGhostFretLblInstMat = instMat;
        }
        instMat.opacity = alpha;
        instMat.depthTest = false;
        lb.material = instMat;
        lb.renderOrder = 1000;
        const ghostOuterL = Math.max(NW * 1.1, NH * 1.1);
        const ghostLblS = 0.7 * ghostOuterL * _textSizeMul * fretLabelScaleForFret(fretForScale);
        const ghostLblScaled = ghostLblS * growScale;
        lb.scale.set(ghostLblScaled, ghostLblScaled, 1);
        // Z=0 matches the projection frame plane exactly — avoids parallax
        // horizontal drift that appears when the camera is offset from the
        // fret centre (camera sits at curX+20*K and looks toward curX, so
        // any positive-Z offset on this label projects leftward vs the frame).
        lb.position.set(x, y, 0);
        lb.rotation.set(0, 0, projRim);
    }

    // skipLabel: don't draw per-note connector label (repeated fret)
    // skipBody:  don't draw the 3D note mesh (repeat chord — still shows projection)
    // showDropLine: draw a white vertical drop line from note to below board (arpeggio / synth chord notes)
    function drawNote(n, now, openX, skipLabel, skipBody, linger = 0.10, openChordBoxWidth, fromChord = false, chordId, susTrailMatchArpFrame = false, arpBounds = null, prevOnsetT = -Infinity, showDropLine = false) {
        const s = n.s;
        // Belt + suspenders: callers already gate via validString(),
        // but drawNote is also entered through { ...cn } chord-note
        // spreads, so re-check here before indexing material arrays.
        if (!validString(s)) return;
        const nxFrame = _drawNextByString && _drawNextByString[s];
        const dt = n.t - now;
        const ghostHold = fromChord ? linger : GHOST_HOLD_AFTER_ONSET;
        const nextTAligned = nxFrame != null && Math.abs(nxFrame.t - n.t) < NEXT_ON_STRING_T_EPS;
        const ghostPastHold = dt <= 0 && dt > -ghostHold
            && (nxFrame == null || nxFrame.t > n.t - 1e-6);
        const isNextOnString = nextTAligned || ghostPastHold;
        const y = sY(s);
        const susEnd = n.t + (n.sus || 0);
        const hasSus = n.sus > 0;
        // Nearest event time across ALL strings strictly after this note —
        // sourced from the sorted union of next/recent event times built
        // once per frame in update() (see _scrEventTimes). _drawRecentByString
        // is folded in so that once an event passes `now` (and leaves
        // _drawNextByString) the deadline still holds: without this the
        // next future event would reset _nextAnyT and old gems would
        // linger after the new chord/note is already playing.
        const _nextAnyT = _firstEventTimeGreaterThan(n.t + 1e-6);
        // Deadline: absolute time after which the gem is culled.
        //   Sustain long (sus >= linger): die immediately at susEnd — no tail.
        //   Sustain short (sus < linger):  tail = linger - sus after susEnd,
        //     capped by gap to next note (any string) so the gem disappears
        //     when the next note arrives if it comes before the tail runs out.
        //   No sustain: linger from onset, same gap-cap rule.
        let _lingerDeadline;
        if (hasSus) {
            const extraLinger = Math.max(0, linger - (n.sus || 0));
            // _nextAnyT cap only applies to the post-sustain linger tail.
            // For long sustains (extraLinger = 0) the deadline is exactly
            // susEnd — notes on other strings must not cut the held sustain
            // short, which would hide the gem and trail mid-play.
            _lingerDeadline = extraLinger > 0
                ? Math.min(susEnd + extraLinger, _nextAnyT)
                : susEnd;
        } else {
            const _gap = _nextAnyT - n.t;
            _lingerDeadline = n.t + (_gap < linger ? _gap : linger);
        }
        const _overLinger = now > _lingerDeadline;
        // For arp-persisted notes past their time: bypass the early exit so
        // the board projection (fretboard ghost + fret labels) keeps rendering
        // until arpBounds.end. The gem/sustain blocks are gated by arpGhostOnlyMode.
        const arpGhostShouldRun = arpBounds != null
            && (arpBounds.start - now) < 0.6   // same as PROJ_WIN
            && now <= arpBounds.end + 0.05;
        const arpGhostOnlyMode = arpGhostShouldRun
            && _overLinger && (!hasSus || now > susEnd);
        // Smart cull: keep the gem alive only if a note-state verdict is
        // available to display. Probe result cached in _ndProbed/_ndProbedState
        // so the later getNoteState query reuses it (avoids two provider calls).
        // arpGhostShouldRun takes precedence — arp ghosts stay alive
        // regardless of verdict state so their board projections persist.
        let _ndProbed = false;
        let _ndProbedState = null;
        if (_overLinger && (!hasSus || now > susEnd) && !arpGhostShouldRun) {
            // Prune the sustain-verdict latch before any cull-path return.
            // The matching delete inside the sustain-render block (line ~9262)
            // only runs when the note isn't culled — without this prune, a
            // sustained note that crosses susEnd on the same frame as
            // _overLinger goes true would leak its latch entry until a
            // teardown/seek clears the Map. !hasSus notes never wrote to
            // the latch, so Map.delete is a harmless no-op there.
            if (hasSus) _susVerdictLatch.delete(Math.round(n.t * 1e4) * 10 + n.s);
            if (!_ndHasProvider || dt < -NOTEDETECT_GEM_VERDICT_WINDOW) return;
            let _ndProbe = null;
            try { _ndProbe = _ndGetNoteState(n, n.t); } catch (e) { _ndProbe = null; }
            _ndProbed = true;
            _ndProbedState = _ndProbe;
            const _probeSt = (_ndProbe && typeof _ndProbe === 'object') ? _ndProbe.state : _ndProbe;
            if (_probeSt !== 'hit' && _probeSt !== 'active' && _probeSt !== 'miss') return;
        }

        const sustained = dt < 0 && hasSus && now <= susEnd;
        const hitDist = Math.abs(dt);
        const hit = hitDist < 0.15 || sustained || (_ndHasProvider && dt < 0);
        const hitFade = sustained ? 0.7 : (hitDist < 0.15 ? 1 - hitDist / 0.15 : 0);
        // skipBody (slide-target gem suppression) only applies to this
        // note's own pre-hit approach — it exists so the destination's
        // approaching gem doesn't duplicate the source note's gem, which
        // is already sliding toward this fret. Once this note is hit,
        // its gem must render normally so a chained slide (this note
        // sliding on to a further fret) keeps following.
        const effSkipBody = skipBody && dt > 0;
        const hasTechniqueVibrato = noteHasVibrato(n);
        const techniqueYNow = sustained ? techniqueYOffsetWorld(n, now) : 0;
        const noteZ = sustained ? 0 : Math.min(0, dZ(dt));
        // Per-note Z-based renderOrder: far notes get a low value (render
        // first, get overdrawn by close geometry), close notes get a high
        // value (render last, appear on top). RENDER_ORDER_LAYER_STACK decides
        // the local stack for outline, core, technique symbols, and fret labels.
        const xBase = n.f === 0 ? (openX !== undefined ? openX : curX) : xFretMid(n.f);
        // Slide-in-progress: glide the gem (and everything anchored to it —
        // outline, core, halo, technique markers) from its starting fret
        // toward the slide's end fret over the sustain, the same way
        // techniqueYOffsetWorld already offsets the gem in Y for bends.
        const slideSt = slideTrailEnd(n);
        // Once hit, keep gliding (and then holding at the end fret) for
        // as long as the gem stays on screen — not just while `sustained`
        // (now <= susEnd). Otherwise, during the brief extra moment a
        // short note lingers after its sustain ends (see _lingerDeadline/
        // extraLinger above), `sustained` flips false and the gem would
        // snap back to its starting fret. slideOffsetWorldX's `p` clamps
        // to 1 once now > susEnd, so this naturally holds at the slide's
        // end position during that tail.
        const slideXNow = (dt < 0 && hasSus && slideSt)
            ? (_leftyCached ? -1 : 1) * slideOffsetWorldX(n, now, slideSt)
            : 0;
        const x = xBase + slideXNow;
        const isHarm = n.hm || n.hp;

        // Open chord notes: wide default mesh is capped to chord frame width.
        const OPEN_NOTE_WORLD_W = 40 * K;
        let openWScale = 1;
        if (n.f === 0 && openChordBoxWidth != null && openChordBoxWidth > 1e-8) {
            openWScale = Math.max(0.22, (openChordBoxWidth * 0.96) / OPEN_NOTE_WORLD_W);
        }

        // Hoisted so both !skipBody blocks (gem and technique labels) and
        // the unconditional sustain trail all share one declaration.
        // For skipBody=true (slide targets), defaults are safe no-ops.
        const openSlabThickMul = n.f === 0 ? 1.5 : 1;
        const approachRot = n.f > 0 ? Math.max(0, Math.min(1, dt / AHEAD)) * Math.PI / 2 : 0;
        // Ghost preview window: capped to the gap from the previous note
        // on this string so dense passages don't show the preview 0.6 s
        // ahead with no visible gem. Minimum 0.05 s so the ghost isn't
        // completely suppressed even in very tight passages.
        const _rawGap = n.t - prevOnsetT;
        const effectiveProjWin = _rawGap > 0 ? Math.min(0.6, Math.max(0.05, _rawGap)) : 0.6;
        const projFactorG = Math.max(0, Math.min(1, 1 - Math.max(dt, 0) / effectiveProjWin));
        const inGhostWin = n.f > 0 && isNextOnString && dt > -ghostHold && dt < effectiveProjWin && projFactorG > 0.001;
        // feedBack#254 — query the provider once per note, before both !skipBody
        // blocks, so _showHit can be a const and _ndGood is available for the
        // sustain trail (which renders even when skipBody=true for slide targets).
        let _ndGood = false;    // true when provider confirms hit/active
        let _hitPunch = 1;      // #3 per-gem scale-punch on a fresh hit
        let _ndState = null;    // 'hit'|'active'|'miss'|null; null → fall back to proximity heuristic
        let _ndCs = null;       // raw provider response — truthy when provider returned a verdict
        let _ndCsIsObj = false; // typeof _ndCs === 'object'
        let _ndFaceMat = null;  // [mat×4, transparent×2] array for lateral face fill, or null
        if (_ndGetNoteState) {
            // Reuse the smart-cull probe result if we already called
            // _ndGetNoteState for this gem above; otherwise probe now.
            let _raw = null;
            if (_ndProbed) {
                _raw = _ndProbedState;
            } else {
                try { _raw = _ndGetNoteState(n, n.t); } catch (e) { _raw = null; }
            }
            if (_raw) {
                _ndCsIsObj = typeof _raw === 'object';
                const _st = _ndCsIsObj ? _raw.state : _raw;
                if (_st === 'miss') {
                    _ndState = 'miss';
                    _ndCs = _raw;
                } else if (_st === 'hit' || _st === 'active') {
                    _ndState = _st;
                    _ndGood = true;
                    _ndCs = _raw;
                }
            }
        }

        // [verdict glow] feed the provider alpha into the per-frame max so
        // update()'s top scales the verdict-glow brightness by live level
        // (note_detect returns alpha = live input level for held sustains,
        // and a time-fade for fresh strikes). Only object responses carry an
        // alpha; the latch/legacy string responses leave brightness at full.
        if (_ndGood && _ndCsIsObj && _ndCs && typeof _ndCs.alpha === 'number') {
            _ndVerdictSawAlpha = true;
            if (_ndCs.alpha > _ndVerdictMaxAlpha) _ndVerdictMaxAlpha = _ndCs.alpha;
        }

        // ── Sustain verdict latch ────────────────────────────────────
        // note_detect's hitGlowDuration (~0.5 s) and the legacy mark
        // TTL (500 ms) both expire before a long chart sustain ends.
        // For any sustained note, latch the verdict from EITHER source
        // (provider _ndState OR legacy _ndHitMarks / _ndMissMarks) and
        // re-inject it so hit/miss color persists for the full hold.
        // Works with both the modern provider path and the legacy event
        // path — vibrato and other long-sustain notes benefit equally.
        if (hasSus) {
            const _sk = Math.round(n.t * 1e4) * 10 + n.s;
            // Resolve current verdict: provider takes priority, then
            // fall back to scanning the legacy mark arrays so a hit or
            // miss event that arrived this frame can seed the latch.
            let _lv_cur = _ndState;
            let _lv_good = _ndGood;
            if (!_lv_cur) {
                for (let _mi = 0; _mi < _ndHitMarks.length; _mi++) {
                    const _mm = _ndHitMarks[_mi];
                    if (_mm.s === n.s && _mm.f === n.f && Math.abs(_mm.noteTime - n.t) < _ND_TIME_EPS) {
                        _lv_cur = 'hit'; _lv_good = true; break;
                    }
                }
                if (!_lv_cur) {
                    for (let _mi = 0; _mi < _ndMissMarks.length; _mi++) {
                        const _mm = _ndMissMarks[_mi];
                        if (_mm.s === n.s && _mm.f === n.f && Math.abs(_mm.noteTime - n.t) < _ND_TIME_EPS) {
                            _lv_cur = 'miss'; _lv_good = false; break;
                        }
                    }
                }
            }
            if (_lv_cur) {
                // Fresh verdict (provider or legacy mark) — save to latch.
                // Distinguish a *live* provider hit (note_detect tags its
                // ring-tracking 'active' responses with live:true) from a
                // legacy/brief one: a live hit must NOT be re-injected once
                // the provider goes silent (that kept muted sustains lit),
                // whereas the legacy event path still needs the latch to
                // bridge its ~0.5 s mark TTL across a long hold.
                const _live = _ndCsIsObj && _ndCs && _ndCs.live === true;
                _susVerdictLatch.set(_sk, _lv_good ? (_live ? 'hit-live' : 'hit') : 'miss');
                // If the verdict came from a legacy mark (provider was
                // silent — _ndState was null before the scan), propagate
                // it to _ndState/_ndGood/_ndCs now so the sustain trail
                // picks up the same colour this frame instead of waiting
                // until the mark expires and the latch re-injects it.
                if (!_ndState) {
                    if (_lv_good) {
                        _ndState = 'active'; _ndGood = true;
                        _ndCs = 'active'; _ndCsIsObj = false;
                    } else {
                        _ndState = 'miss';
                        _ndCs = 'miss'; _ndCsIsObj = false;
                    }
                }
            } else if (dt < 0 && now < susEnd) {
                // No current verdict — reuse latch if available.
                // dt < 0 guards against coloring notes that haven't
                // crossed the hit line yet (approaching notes must never
                // inherit a latch from a previous play-through).
                const _lv = _susVerdictLatch.get(_sk);
                if (_lv === 'hit') {
                    // Legacy/brief provider or event-path hit: bridge the
                    // gap across the hold (the mark/glow TTL expires before a
                    // long chart sustain ends).
                    _ndState = 'active'; _ndGood = true;
                    _ndCs = 'active'; _ndCsIsObj = false;
                } else if (_lv === 'hit-live') {
                    // Live provider is authoritative for the active glow: it
                    // returns 'active' only while the string is actually
                    // ringing, and null once muted / decayed. Don't re-inject
                    // a stale 'active' (that kept a muted sustain lit) — leave
                    // the gem un-lit when the provider is silent; a re-strike
                    // relights it via the provider on the next frame.
                } else if (_lv === 'miss') {
                    _ndState = 'miss';
                    _ndCs = 'miss'; _ndCsIsObj = false;
                }
            }
            if (now >= susEnd) _susVerdictLatch.delete(_sk);
        }

        const _showHit = (_ndState === 'miss') ? false
            : (_ndState ? _ndGood
            : (hit || (n.f > 0 && inGhostWin)));

        if (!effSkipBody && !arpGhostOnlyMode && !_overLinger) {

            // ── Outline (slightly larger, bright emissive) ────────────
            // Notedetect feedback (#9): if a recent hit/miss event
            // matches this note's (s, f, t), swap the outline tint.
            // Linear scan over a small bounded array — typical
            // queues are 0-5 entries, expired marks pruned by the
            // listener. Hit takes precedence over miss so the user
            // sees the more positive feedback if both happen
            // (shouldn't, but cheap guard).
            let _ndOutline = (n.f > 0 && mStrHitOutline[s]) ? mStrHitOutline[s] : mWhiteOutline;
            // update() prunes expired marks once per frame and
            // caches performance.now() in _ndFrameNowMs so the hot
            // path here just does the bounded match — no extra
            // now() / filter() per note. After update()'s prune,
            // every entry in the arrays has expiresAt > _ndFrameNowMs,
            // so we don't re-validate inside the loop.
            let _ndMatchedMark = null;
            let _ndHadHitMark = false;
            if (_ndHitMarks.length) {
                for (let i = 0; i < _ndHitMarks.length; i++) {
                    const m = _ndHitMarks[i];
                    if (m.s === n.s && m.f === n.f && Math.abs(m.noteTime - n.t) < _ND_TIME_EPS) {
                        _ndOutline = mHitBright[s] ?? mGlow[s]; _ndFaceMat = mHitBrightArrays[s] ?? null; _ndMatchedMark = m; _ndHadHitMark = true; break;
                    }
                }
            }
            if (!_ndHadHitMark && _ndMissMarks.length) {
                for (let i = 0; i < _ndMissMarks.length; i++) {
                    const m = _ndMissMarks[i];
                    if (m.s === n.s && m.f === n.f && Math.abs(m.noteTime - n.t) < _ND_TIME_EPS) {
                        _ndOutline = mMissOutline; _ndFaceMat = mMissEdgeArrays; _ndMatchedMark = m; break;
                    }
                }
            }
            if (_ndMatchedMark && _ndMatchedMark.labels && _ndMatchedMark.labels.length) {
                _ndLabels.push({
                    x,
                    y: y + NH * 1.7,
                    z: noteZ + 0.02,
                    labels: _ndMatchedMark.labels,
                });
            }
            // (approachRot / PROJ_WIN_G / projFactorG / inGhostWin hoisted above)

            const rimXY = n.ac ? ACCENT_RIM_XY_SCALE_MUL : 1;
            const rimZ = n.ac ? ACCENT_RIM_Z_SCALE_MUL : 1;

            // feedBack#254 — apply outline + lateral face-fill overrides from provider verdict.
            // hit/active → green outline (mHitBright[s]) + green lateral faces;
            // miss → magenta-red outline (mMissOutline) + dark lateral faces; front/back stay transparent.
            if (_ndCs) {
                const _vAlpha = (_ndCsIsObj && typeof _ndCs.alpha === 'number') ? _ndCs.alpha : 1;
                if (_ndState === 'miss') {
                    _ndOutline = mMissOutline;
                    _ndFaceMat = mMissEdgeArrays;
                    _streakHits = 0;            // #7 break the streak (heat eases down)
                    if (_verdictMarks) _ndLabels.push({ x, y: y + NH * 1.7, z: noteZ + 0.02, labels: [{ text: '✗', color: '#ff5a7a' }] });  // #6
                } else if (_ndGood) {
                    _ndOutline = mHitBright[s] ?? mGlow[s];
                    _ndFaceMat = mHitBrightArrays[s] ?? null;
                    _hitPunch = 1 + 0.22 * _hitFx * _vAlpha;   // #3 scale-punch (biggest at strike, eases)
                    if (_verdictMarks) { const _tc = _timingHex(_ndMatchedMark && _ndMatchedMark.timingState); _ndLabels.push({ x, y: y + NH * 1.7, z: noteZ + 0.02, labels: [{ text: '✓', color: '#' + _tc.toString(16).padStart(6, '0') }] }); }  // #6 + #5
                    if (_sparks && _hitFx > 0 && _vAlpha > 0.5) {
                        const _spk = s + '|' + n.f + '|' + n.t.toFixed(2);
                        if (!(_sparkSeen.get(_spk) > now)) {
                            _sparkSeen.set(_spk, now + 1.0);
                            if (_sparkSeen.size > 600) _sparkSeen.clear();
                            _streakHits++;
                            const _heatMul = _streakFx ? (1 + 0.85 * _streakHeat) : 1;   // #7 escalate
                            _sparkBurst(x, y, noteZ, _timingHex(_ndMatchedMark && _ndMatchedMark.timingState), Math.round((4 + 7 * _hitFx) * _heatMul));
                        }
                    }
                }
            }

            // Score pop: the first frame a gem's verdict carries points
            // (notedetect ≥1.13 object verdicts), float a "+N" above it.
            // popKey dedupes — chord members all hand back the chord-
            // level key, so a chord pops once, not once per gem; the
            // _fxSeen TTL also stops a sustain's long-lived verdict from
            // re-popping every frame.
            if (_ndGood && _ndCsIsObj
                    && _ndCs.points !== undefined && _ndCs.popKey != null) {
                _fxSpawnPop(_ndCs.popKey, _ndCs.points, _ndCs.mult,
                    x, y + NH * 2.2, noteZ + 0.02);
            }

            // Accent: soft neon outer glow (reference: diffused halo fading out).
            // Three additive shells drawn behind outline/core; colour = string hue.
            // Suppressed on a provider miss verdict — a bright accent halo
            // around a missed gem muddies the dark-core-plus-red-rim fail
            // signal, matching the same miss-over-accent priority the
            // gem core material applies below.
            if (n.ac && _ndState !== 'miss' && mAccentHaloNear[s]) {
                const rZ = approachRot;
                const accentShells = _accentShellsByString[s];
                for (let hi = 0; hi < accentShells.length; hi++) {
                    const sh = accentShells[hi];
                    const glow = pAccentHalo.get();
                    glow.material = sh.mat;
                    glow.rotation.z = rZ;
                    glow.position.set(x, y + techniqueYNow, noteZ - sh.zK * K);
                    if (n.f === 0) {
                        // Inside a chord/arpeggio frame: bloom only vertically so the
                        // halo doesn't burst past the chord box edges horizontally.
                        // Outside a frame: modest horizontal cap (1.4×) so it doesn't
                        // overflow into adjacent lane visuals.
                        const openIxy = fromChord ? 1.0 : Math.min(sh.ixy, 1.4);
                        const slabPuff = Math.max(1.4, sh.ixy);
                        glow.scale.set(
                            (40 * K / NW) * rimXY * openIxy * openWScale,
                            0.1 * openSlabThickMul * slabPuff,
                            0.6 * rimZ * sh.iz,
                        );
                    } else {
                        glow.scale.set(rimXY * sh.ixy, rimXY * sh.ixy, 2.5 * rimZ * sh.iz);
                    }
                }
            }
            const outline = pNote.get();
            // Verdict beats accent on the outline so hit/miss feedback isn't
            // hidden by mAccentOutline. Mirrors the same miss-over-accent
            // priority the accent halo guard above already applies.
            const _ndVerdict = (_ndCs && (_ndState === 'miss' || _ndGood))
                || !!_ndMatchedMark;
            outline.material = (n.ac && !_ndVerdict) ? mAccentOutline[s] : _ndOutline;
            // outline + core share the pNote pool, so set geometry explicitly
            // each frame (a recycled mesh may carry a gradient geometry from a
            // prior core use). Outline always uses the plain box.
            outline.geometry = gNote;
            outline.renderOrder = renderOrderForLayerAtZ(noteZ, 'NOTE_OUTLINE');
            outline.position.set(x, y + techniqueYNow, noteZ);
            outline.rotation.z = approachRot;
            const ndRim = 1.1;
            if (n.f === 0) {
                outline.scale.set(
                    (35 * K / NW) * ndRim * rimXY * openWScale,
                    0.1 * ndRim * openSlabThickMul,
                    0.6 * ndRim * rimZ,
                );
            } else {
                outline.scale.set(ndRim * rimXY, ndRim * rimXY, 2.8 * rimZ);
            }

            // ── Lateral face fill (top / bottom / left / right only) ─────
            // Material array: groups 0-3 (±X ±Y) get the verdict colour;
            // groups 4-5 (+Z front / -Z back) are transparent so the large
            // front face shows only the core body's string colour beneath.
            if (_ndFaceMat) {
                const edges = pNoteEdge.get();
                edges.material = _ndFaceMat;
                edges.renderOrder = renderOrderForLayerAtZ(noteZ, 'TECHNIQUE_MARKER');
                edges.position.set(x, y + techniqueYNow, noteZ + 0.001);
                edges.rotation.z = approachRot;
                if (n.f === 0) {
                    edges.scale.set(
                        (40 * K / NW) * rimXY * openWScale * 1.02,
                        0.1 * openSlabThickMul * 1.02,
                        0.6 * rimZ * 1.02,
                    );
                } else {
                    edges.scale.set(rimXY * 1.02, rimXY * 1.02, 2.5 * rimZ * 1.02);
                }
            }

            // ── Core (filled note body) ───────────────────────────────
            const core = pNote.get();
            // Body always keeps the string colour. Verdict feedback is
            // carried by the outline shell and lateral face fill.
            core.material = n.ac ? mAccentCore[s] : mStr[s];
            // Gradient gem body for strings 0..5; flat box otherwise.
            core.geometry = (!n.ac && gNoteGrad[s]) ? gNoteGrad[s] : gNote;
            core.renderOrder = renderOrderForLayerAtZ(noteZ, 'NOTE_CORE');
            core.position.set(x, y + techniqueYNow, noteZ + 0.001);
            core.rotation.z = approachRot;
            if (n.f === 0) {
                core.scale.set(
                    (40 * K / NW) * rimXY * openWScale,
                    0.1 * openSlabThickMul,
                    0.6 * rimZ,
                );
            } else {
                core.scale.set(rimXY, rimXY, 2.5 * rimZ);
            }
            if (_hitPunch !== 1) core.scale.multiplyScalar(_hitPunch);   // #3 hit scale-punch
            // Fret digits on fretted (n.f > 0) flying notes deliberately
            // omitted: the showFretOnNote setting and its UI helper text
            // promise digits on the fretboard ghost only, never on the
            // gems coming down the highway. The ghost path is at
            // pGhostFretLbl below.
        } // end gem block — technique labels reopen !skipBody below

        // ── Sustain trail ─────────────────────────────────────────────
        // Rendered for ALL notes with sustain, including skipBody=true
        // slide-target notes (e.g. linkNext hold→slide: gem suppressed,
        // slide trail stays visible as the continuation of the sustain).
        // _ndGetNoteState is queried for every note (skipBody slide
        // targets included), so the trail picks bright mGlow[s] when the
        // provider confirms hit/active and dim mSus[s] otherwise — a
        // slide-target trail is not forced dim.
        // Chord-member open strings (fromChord && f === 0) skip the
        // sustain trail entirely — fretted constituents already carry
        // the chord's sustains; an extra ribbon under the wide open
        // body looked like clutter. The note BODY still draws above.
        if (hasSus && !_overLinger && !(fromChord && n.f === 0)) {
                const susStart = Math.max(n.t, now);
                const remSus = susEnd - susStart;
                if (remSus > 0.01) {
                    const sliceDur = Math.min(remSus, AHEAD);
                    let tw = NW * 0.85 * (n.f === 0 ? openWScale : 1);
                    let th = NH * 0.12 * (n.f === 0 ? openWScale : 1) * openSlabThickMul;
                    if (susTrailMatchArpFrame) {
                        const yA = sY(0), yB = sY(nStr - 1);
                        const yMinF = Math.min(yA, yB) - S_GAP * 0.8;
                        const yMaxF = Math.max(yA, yB) + S_GAP * 0.8;
                        const fullChordBoxH = yMaxF - yMinF;
                        const ft = Math.max(CHORD_FRAME_RIM_MIN * K, fullChordBoxH * CHORD_FRAME_RIM_FRAC_H);
                        const ftSide = ft * 1.55;
                        if (n.f > 0) {
                            th = ftSide;
                        } else {
                            th = Math.max(th, ftSide * openSlabThickMul);
                        }
                        tw = Math.max(tw, ftSide * 1.05);
                    }
                    // Standalone open strings get two parallel trails
                    // offset along X — visually echoes the wide flat
                    // open-note body. Fretted notes keep the
                    // single-trail path. Offsets are scaled by
                    // `openWScale` (the same body-width scale
                    // computed at line 7367) so the trails stay
                    // underneath the body's edges no matter how wide
                    // the anchor lane is. Chord-member open strings
                    // can't reach here (guarded at the `hasSus`
                    // check above).
                    //
                    // openTrailOff is always > 0 because openWScale
                    // is clamped >= 0.22 at line 7368 (or defaults
                    // to 1 when there's no openChordBoxWidth), so
                    // openTrailOff >= NW * 3 * 0.22 = 3.3 * K.
                    // No degenerate-small-offset fallback needed.
                    const offsets = (n.f === 0)
                        ? [-(NW * 3 * openWScale), NW * 3 * openWScale]
                        : SINGLE_SUS_OFFSETS;
                    const ribbonSusTrail = !!(
                        (slideSt && n.f > 0 && (n.sus || 0) > 1e-4)
                        || (Number(n.bn) > 0)
                        || (Array.isArray(n.bnv) && n.bnv.length > 0)
                        || n.tr
                        || hasTechniqueVibrato
                    );
                    // Outline material for the sustain trail border — uses the
                    // same materials as the gem border so hit/miss colours are
                    // perceptually identical across gem outline, lateral faces,
                    // and sustain trail rim.
                    const _susOlMat = _ndState === 'miss' ? mMissOutline
                        : _ndGood ? (mHitBright[s] ?? mHitSusOutline)
                        : mSusOutline;
                    const emitSusStrip = (xCenter, segLen, zCenter) => {
                        // Same depth-bucket scheme as chord frames, using the
                        // ordered sustain-trail layer so same-depth frames win
                        // while closer trail segments still beat farther frames.
                        const trailRenderOrder = renderOrderForLayerAtZ(Math.min(0, zCenter), 'SUSTAIN_TRAIL');
                        for (let i = 0; i < offsets.length; i++) {
                            const xOff = xCenter + offsets[i];
                            const trOut = pSusOutline.get();
                            trOut.material = _susOlMat;
                            trOut.renderOrder = trailRenderOrder;
                            trOut.position.set(xOff, y, zCenter);
                            trOut.scale.set(tw + 0.4 * K, th + 0.4 * K, segLen);
                            const tr = pSus.get();
                            tr.material = _ndState ? mGlow[s] : mSus[s];
                            tr.renderOrder = trailRenderOrder + 0.0005;
                            tr.position.set(xOff, y, zCenter);
                            tr.scale.set(tw, th, segLen);
                        }
                    };
                    if (!ribbonSusTrail) {
                        const len = sliceDur * TS;
                        const zPos = dZ(susStart - now) - len / 2;
                        emitSusStrip(x, len, zPos);
                    } else {
                        // Same depth-based renderOrder as box trail — ribbon center
                        // at susStart + sliceDur/2, using TS so it matches dZ().
                        const _ribDt = Math.max(0, susStart + sliceDur / 2 - now);
                        const ribbonRenderOrder = renderOrderForLayerAtZ(-_ribDt * TS, 'SUSTAIN_TRAIL');
                        for (let si = 0; si < offsets.length; si++) {
                            const strandX = xBase + offsets[si];
                            const olMesh = pSusRibbonOl.get();
                            olMesh.renderOrder = ribbonRenderOrder;
                            olMesh.scale.set(1, 1, 1);
                            olMesh.rotation.set(0, 0, 0);
                            olMesh.position.set(0, 0, 0);
                            olMesh.material = _susOlMat;
                            slideRibbonUpdatePositions(
                                olMesh.geometry, strandX,
                                tw + 0.4 * K, th + 0.4 * K,
                                y, sliceDur, susStart, now, n, slideSt,
                            );
                            const body = pSusRibbon.get();
                            body.renderOrder = ribbonRenderOrder + 0.0005;
                            body.scale.set(1, 1, 1);
                            body.rotation.set(0, 0, 0);
                            body.position.set(0, 0, 0);
                            body.material = _ndState ? mGlow[s] : mSus[s];
                            slideRibbonUpdatePositions(
                                body.geometry, strandX, tw, th, y,
                                sliceDur, susStart, now, n, slideSt,
                            );
                        }
                    }
                }
        }

        // Shared by both slide-arrow blocks so the neck-preview arrow
        // below can match the on-note arrow's size once the note
        // arrives (the technique-labels block further down also reads
        // this for its own label scaling).
        const LBL_MULT = 1.6;
        // Fade-in window for the neck-preview slide arrow below.
        const GHOST_UPCOMING_WIN = 0.6;

        // ── Slide direction arrow (neck preview) ─────────────────────
        // A standalone preview of the same arrow, sitting flat on
        // the neck (Z=0) at the note's resting fret. Full size from
        // the moment it appears (matches the on-note arrow's size at
        // dt=0) — just a linear fade-in over the same GHOST_UPCOMING_WIN
        // window the board-projection ghost note uses, so the two
        // previews feel like part of the same effect. No grow effect:
        // tried and found too hard to see. Stops at dt <= 0, handing
        // off to the on-note arrow.
        //
        // Placed outside the !effSkipBody block (unlike the on-note
        // arrow above) so a note whose own gem is suppressed because
        // it's the destination of a previous slide (skipBody) can
        // still preview ITS OWN outgoing slide ahead of time — i.e.
        // multi-leg/chained slides — when slideArrowChainPreviewVisible
        // is on. For a normal note (skipBody === false) this behaves
        // exactly as before.
        if (slideArrowNeckVisible && dt > 0 && slideSt && validString(s) && !arpGhostOnlyMode && !_overLinger
            && (!skipBody || slideArrowChainPreviewVisible)) {
            const slideDirN = Math.sign(fretMid(slideSt.endFret) - fretMid(n.f)) * (_leftyCached ? -1 : 1);
            if (slideDirN !== 0) {
                const neckAlpha = Math.max(0, Math.min(1, 1 - dt / GHOST_UPCOMING_WIN));
                if (neckAlpha > 0.001) {
                    const arrowHexN = darkenHex(activePalette[s], 0.55);
                    const arrowSmN = slideArrowMat(slideDirN > 0, arrowHexN);
                    const arrowN = pTechPlane.get();
                    arrowN.material = _spriteMat2MeshMat(arrowN, arrowSmN);
                    const arrowScaleN = NH * 1.1 * LBL_MULT * _textSizeMul;
                    arrowN.scale.set(arrowScaleN, arrowScaleN, 1);
                    arrowN.position.set(x + slideDirN * NW * 1.15, y, 0);
                    arrowN.rotation.z = 0;
                    arrowN.renderOrder = renderOrderForLayerAtZ(0, 'TECHNIQUE_MARKER');
                    arrowN.material.opacity = neckAlpha;
                }
            }
        }

        if (!effSkipBody && !arpGhostOnlyMode && !_overLinger) {
            // ── Technique labels ──────────────────────────────────────
            // Label scale = base × LBL_MULT × distFactor (LBL_MULT
            // declared above, shared with the neck-preview slide arrow).
            // distFactor compensates for perspective shrink so a
            // label far from the camera (note approaching at dt≈AHEAD)
            // doesn't collapse to a single dim pixel. LBL_MULT bumps
            // every base scale uniformly. Issues #21-25 track proper
            // visual upgrades (3D arrows, ribbons, glows); this is
            // the cheap legibility win in the meantime.
            //
            // Offsets scale with sLbl too. The labels grow in world
            // units to compensate for perspective; if the offsets
            // didn't grow, stacked labels would overlap each other
            // and the first label would overlap the note at the
            // AHEAD edge. In screen space the offset stays roughly
            // constant — labels appear anchored to the note even
            // though the world-space distance grows.
            const distFactor = 1 + Math.max(0, Math.min(1, dt / AHEAD)) * 1.5;
            // Fold the user's text-size multiplier into sLbl so technique
            // labels (bend, H/P/T arrows, tremolo) plus on-body markers
            // such as palm mute and the pinch-harmonic icon.
            // all scale alongside the rest (`ac` accent → brighter body via mGlow).
            const sLbl = LBL_MULT * distFactor * _textSizeMul;
            // txtMat(..., 'technique') disables depthTest; without a high
            // renderOrder the transparent note core (mStr) can still paint
            // afterward and hide H/P/T, PM X, bends, etc. Same contract as
            // fret-row labels (issue #35, CLAUDE pitfall #7 corollary).
            const techniqueMarkerRenderOrder = renderOrderForLayerAtZ(noteZ, 'TECHNIQUE_MARKER');
            let yo = y + techniqueYNow + NH * 0.8 * sLbl;
            const specialMarkerScale = n.f === 0
                ? NH * 1.5 * sLbl * openWScale
                : NH * 1.5 * sLbl;
            // ── Slide direction arrow (on the note/gem) ─────────────────
            // A small ›/‹ chevron beside the note pointing toward the
            // slide's destination fret. Visible for the note's whole
            // time on screen — approaching (rides the incoming note at
            // noteZ+K) and sustained (rides the gem as it glides via
            // slideXNow, Edit A) — at a constant full opacity, no
            // fade or grow.
            if (slideArrowApproachVisible && slideSt && validString(s)) {
                const slideDir = Math.sign(fretMid(slideSt.endFret) - fretMid(n.f)) * (_leftyCached ? -1 : 1);
                if (slideDir !== 0) {
                    const arrowHex = darkenHex(activePalette[s], 0.55);
                    const arrowSm = slideArrowMat(slideDir > 0, arrowHex);
                    const arrow = pTechPlane.get();
                    arrow.material = _spriteMat2MeshMat(arrow, arrowSm);
                    const arrowScale = NH * 1.1 * sLbl;
                    arrow.scale.set(arrowScale, arrowScale, 1);
                    arrow.position.set(x + slideDir * NW * 1.15, y + techniqueYNow, noteZ + K);
                    // No rotation, ever — notes themselves rotate in
                    // (approachRot) as they approach, but that would
                    // tilt the ›/‹ chevron and make its left/right
                    // direction ambiguous. Always flat.
                    arrow.rotation.z = 0;
                    arrow.renderOrder = techniqueMarkerRenderOrder;
                    arrow.material.opacity = 1;
                }
            }
            // Derive the peak from bn OR the bnv curve: a note may carry an
            // authoritative curve with bn left at 0 (bn SHOULD be the peak
            // whenever bnv exists — this is the robustness fallback).
            const _bnvPeak = (Array.isArray(n.bnv) && n.bnv.length)
                ? n.bnv.reduce((m, p) => Math.max(m, Number(p.v) || 0), 0) : 0;
            const _bendPeak = Math.max(Number(n.bn) || 0, _bnvPeak);
            if (_bendPeak > 0) {
                // Bend chevron stack — PlaneGeometry mesh so it tilts with
                // the gem (approachRot). Fixed world size so it perspective-
                // shrinks naturally without distFactor compensation.
                const steps = Math.max(1, Math.min(4, Math.round(_bendPeak)));
                const bendSm = bendChevronMat(steps, activePalette[s] || 0xffffff);
                const l = pTechPlane.get();
                l.material = _spriteMat2MeshMat(l, bendSm);
                const cs = NH * 2.4;
                l.scale.set(cs, cs, 1);
                l.position.set(x, y + techniqueYNow + NH * 1.1, noteZ + K);
                l.rotation.z = approachRot;
                l.renderOrder = techniqueMarkerRenderOrder;
                // Reserve stack space above the chevron.
                yo = Math.max(yo, y + techniqueYNow + NH * 2.5);
            }
            if (n.ho || n.po || n.tp) {
                if (n.ho || n.po) {
                    // Hammer-on / pull-off: ▲/▼ triangle — PlaneGeometry mesh
                    // so it tilts with the gem instead of billboarding.
                    const triSm = triMat(!!n.po, activePalette[s] || 0xffffff);
                    const tri = pTechPlane.get();
                    tri.material = _spriteMat2MeshMat(tri, triSm);
                    tri.scale.set(NH * 1.8, NH * 1.60, 1);
                    tri.position.set(x, y + techniqueYNow, noteZ + K);
                    tri.rotation.z = approachRot;
                    tri.renderOrder = techniqueMarkerRenderOrder;
                    // Reserve stack space above the triangle for stacked labels.
                    yo = Math.max(yo, y + techniqueYNow + NH * 1.0);
                } else {
                    const chevron = pTapChevron.get();
                    const chevronScale = NH * 0.8 * sLbl;
                    chevron.position.set(x, y + techniqueYNow, noteZ + 1.1 * K);
                    chevron.rotation.z = approachRot;
                    chevron.scale.set(chevronScale, chevronScale, 1);
                    chevron.renderOrder = techniqueMarkerRenderOrder;
                }
            }
            // Tremolo label ('~~~') removed — trail shape already conveys it visually.
            if (n.pm || n.mt || n.fhm) {
                // Muted notes: pool-based plane with per-note Z-proportional
                // renderOrder (techniqueMarkerRenderOrder). The previous InstancedMesh
                // approach used a fixed renderOrder (702/700), which made PM/FH markers from
                // far notes overdraw chord frames and gems of nearer chords.
                // PM = black X / white border; FH/MT = inverse.
                const _fhm = !!(n.mt || n.fhm);
                const _pmSprite = _fhm ? fretHandMuteXSpriteMat() : palmMuteXSpriteMat();
                const _pmMark = pTechPlane.get();
                _pmMark.material = _spriteMat2MeshMat(_pmMark, _pmSprite);
                _pmMark.material.opacity = _showHit ? 1.0 : 0.8;
                // Arms cover 62.5% of canvas → scale 1/0.625 = 1.60.
                const _sx = n.f === 0 ? NW * 1.60 * openWScale : NW * 1.60;
                _pmMark.scale.set(_sx, NH * 1.60, 1);
                _pmMark.position.set(x, y + techniqueYNow, noteZ + K);
                _pmMark.rotation.z = approachRot;
                _pmMark.renderOrder = techniqueMarkerRenderOrder;
            }
            // hm / hp — PlaneGeometry overlay sized like the palm-mute X,
            // so the symbol only appears on the front face and matches
            // the palm-mute marker proportions.
            if (n.hm || n.hp) {
                const harmSprite = n.hm ? naturalHarmonicMat() : pinchHarmonicMat(activePalette[s]);
                const harmMark = pTechPlane.get();
                harmMark.material = _spriteMat2MeshMat(harmMark, harmSprite);
                harmMark.material.opacity = _showHit ? 1.0 : 0.85;
                const harmScaleX = n.f === 0 ? NW * 1.90 * openWScale : NW * 1.90;
                harmMark.scale.set(harmScaleX, NH * 2.0, 1);
                harmMark.position.set(x, y + techniqueYNow, noteZ + K);
                harmMark.rotation.z = approachRot;
                harmMark.renderOrder = techniqueMarkerRenderOrder;
            }

            // ── Per-note fret connector label ─────────────────────────
            if (n.f > 0 && !skipLabel) {
                const minStringY = Math.min(sY(0), sY(nStr - 1));
                const labelY = minStringY - S_GAP * 0.8;
                // Fade in over 0.35s at the far end; stay at full opacity until
                // the note hits (dt = 0).  No pre-hit fade-out — removing it
                // eliminates the "label disappears before the note arrives" artifact.
                const alpha = dt >= 0 ? Math.min(1.0, (AHEAD - dt) / 0.35) : 0;
                // Arpeggio notes use the arpeggio fret-label layer at the same
                // depth so they stay above non-arp connector lines of the same chord.
                const _isArpNote = arpBounds !== null;

                // String-coloured connector line — standalone notes only.
                // Arpeggio and chord notes already have a drop line to the board.
                if (!fromChord) {
                    const line = pConnectorLine.get();
                    line.position.set(x, labelY, noteZ);
                    // Half-length (50% shorter), anchored at the fret-label end.
                    line.scale.set(1, (y - labelY) * 0.5, 1);
                    // Tint the line with the incoming note's string colour.
                    // mStr is white for gradient strings, so use the canonical
                    // flat palette colour instead of the material's .color.
                    if (activePalette[s] != null) line.material.color.setHex(activePalette[s]);
                    line.renderOrder = renderOrderForLayerAtZ(noteZ,
                        _isArpNote
                            ? 'ARP_CONNECTOR_LINE'
                            : 'CONNECTOR_LINE'
                    );
                    line.material.opacity = alpha * 0.8;
                }

                // Regular chord notes (fromChord=true, arpBounds=null) never show
                // fret labels — only standalone notes and arpeggio note-stream notes
                // (fromChord=true with arpBounds!=null) show labels.
                // Key uses 40 ms buckets (same formula as _buildFretLabelSet) so
                // the lookup matches exactly, even if the note's time drifts ±20 ms.
                // Frame-dedup prevents multiple strings at the same onset/fret from
                // stacking duplicate labels.
                const _flFrameKey = Math.round(n.t * 25) * 100 + n.f;
                const _showNum = (!fromChord || arpBounds !== null)
                    && _fretLabelAllowed.has(_flFrameKey)
                    && !_frameLabeledKeys.has(_flFrameKey);
                if (_showNum) {
                    _frameLabeledKeys.add(_flFrameKey);
                    const fretLabel  = pNoteFretLabel.get();
                    const cachedMat  = txtMat(n.f, FRET_LABEL_GOLD_HEX, false, 'noteFret');
                    _setLabelMap(fretLabel, cachedMat);
                    fretLabel.position.set(x, labelY, noteZ);
                    fretLabel.renderOrder = renderOrderForLayerAtZ(noteZ,
                        _isArpNote
                            ? 'ARP_NOTE_FRET_LABEL'
                            : 'NOTE_FRET_LABEL'
                    );
                    // Same scale ramp as fret column markers: 2× base at max lookahead,
                    // converging to 1× at hit line.  Final size matches row labels.
                    const flS = 7.0 * K * (1 + 0.4 * Math.max(0, dt) / AHEAD) * _textSizeMul * fretLabelScaleForFret(n.f);
                    fretLabel.scale.set(flS, flS, 1);
                    fretLabel.material.opacity = alpha;
                }

                // Teaching marks (§6.2.2) — display only, never grading. The
                // fret-hand finger (fg) renders by default to the right of the
                // fret label (hideable via the finger-hints toggle); the scale
                // degree (sd) is opt-in (mirrors the 2D `teachingMarksVisible`
                // toggle) and renders to the left.
                if (alpha > 0 && n.f > 0) {
                    const _tmS = 5.0 * K * _textSizeMul * fretLabelScaleForFret(n.f);
                    const _drawTeachMark = (text, colorHex, dx, cacheKey) => {
                        if (!text) return;
                        const spr = pTeachMarkLbl.get();
                        const m = txtMat(text, colorHex, false, cacheKey);
                        _setLabelMap(spr, m);
                        spr.position.set(x + dx, labelY, noteZ);
                        spr.renderOrder = renderOrderForLayerAtZ(noteZ,
                            _isArpNote ? 'ARP_NOTE_FRET_LABEL' : 'NOTE_FRET_LABEL');
                        spr.scale.set(_tmS, _tmS, 1);
                        spr.material.opacity = alpha;
                    };
                    if (_showFingerHints) {
                        _drawTeachMark(teachingFingerLabel(n.fg), '#7fd1ff', NW * 0.95, 'teachFg');
                    }
                    if (_drawTeachingMarks) {
                        _drawTeachMark(teachingDegreeLabel(n.sd), '#ffcc66', -NW * 0.95, 'teachSd');
                    }
                }
            }
        }

        // ── Fret number for synthetic chord notes rendered with skipBody=true ──
        // suppressSynthChord paths skip the !skipBody block entirely, so their
        // fret label never fires from inside it. Handle them here, outside the
        // gate. Applies the same measure-based + frame-dedup rules so that if
        // the corresponding standalone arpeggio note already showed a label this
        // frame, we don't duplicate it.
        if (skipBody && fromChord && !skipLabel && n.f > 0 && dt >= 0) {
            const _fl2FrameKey = Math.round(n.t * 25) * 100 + n.f;
            if (_fretLabelAllowed.has(_fl2FrameKey)
                && !_frameLabeledKeys.has(_fl2FrameKey)) {
                _frameLabeledKeys.add(_fl2FrameKey);
                const _minStrY2 = Math.min(sY(0), sY(nStr - 1));
                const _labelY2  = _minStrY2 - S_GAP * 0.8;
                const _alpha2   = Math.min(1.0, (AHEAD - dt) / 0.35);
                const _isArp2   = arpBounds !== null;
                const fl2 = pNoteFretLabel.get();
                const cm2 = txtMat(n.f, FRET_LABEL_GOLD_HEX, false, 'noteFret');
                _setLabelMap(fl2, cm2);
                fl2.position.set(x, _labelY2, noteZ);
                fl2.renderOrder = renderOrderForLayerAtZ(noteZ,
                    _isArp2
                        ? 'ARP_NOTE_FRET_LABEL'
                        : 'NOTE_FRET_LABEL'
                );
                const _flS2 = 7.0 * K * (1 + 0.4 * dt / AHEAD) * _textSizeMul * fretLabelScaleForFret(n.f);
                fl2.scale.set(_flS2, _flS2, 1);
                fl2.material.opacity = _alpha2;
            }
        }

        // ── Drop line for chord / arpeggio notes ──────────────────────────
        // Styled to match the standalone single-note connector: tinted with
        // the incoming note's string colour and 50% length (anchored at the
        // fret-label end), instead of a full-height white line to the board.
        const _wantDropLine = pDropLine && n.f > 0 && dt >= 0 && fromChord && showDropLine && !skipBody;
        if (_wantDropLine) {
            const _minStrY = Math.min(sY(0), sY(nStr - 1));
            const _dropY = _minStrY - S_GAP * 0.8;
            const _alpha = Math.min(1.0, (AHEAD - dt) / 0.35);
            const dl = pDropLine.get();
            dl.position.set(x, _dropY, noteZ);
            // Half-length, anchored at the label end (matches single notes).
            dl.scale.set(1, (y - _dropY) * 0.5, 1);
            // String-colour tint (palette is canonical; mStr is white for
            // gradient strings).
            if (activePalette[s] != null) dl.material.color.setHex(activePalette[s]);
            dl.renderOrder = renderOrderForLayerAtZ(noteZ, 'CONNECTOR_LINE');
            dl.material.depthTest = false;
            dl.material.opacity = _alpha * 0.8;
        }

        // ── Board ghost: filled rim at Z=0 (up to 3 slots/string) ────
        // Lead notes (!fromChord, so !arpGhostActive too — see arpBounds
        // below) use a fixed GHOST_UPCOMING_WIN pre-impact ramp instead
        // of the gap-capped effectiveProjWin, so fast same-string runs
        // don't pop in at full size right before impact. Chords/arps
        // keep effectiveProjWin exactly as before — effectiveProjWin /
        // projFactorG / inGhostWin (computed above, for the separate gem
        // pre-glow) are untouched. Arp ghosts always use the full 0.6 s
        // window — their timing is authored, not gap-driven.
        const _PROJ_WIN_ARP = 0.6;
        const ghostWin = fromChord ? effectiveProjWin : GHOST_UPCOMING_WIN;
        const projFactor = Math.max(0, Math.min(1, 1 - Math.max(dt, 0) / ghostWin));
        // isBlocked suppresses the pre-impact ghost in a note's last 150ms
        // so it doesn't peek out from under the incoming note body. Scoped
        // to chord notes only (#843): for plain lead notes this previously
        // suppressed the board-ghost frame for every sustained note's last
        // 150ms, making it vanish right before impact and reappear during
        // the post-hit linger ("ghosts disappearing" in dense runs). Also
        // excludes slide notes (`!slideSt`, #862/#257): a sliding gem
        // glides off the start fret via slideXNow, so the body no longer
        // covers the ghost and the slide's own ghost preview should show.
        // Gate on dt > 0 so the post-hit linger (dt ≤ 0) keeps the ghost.
        const isBlocked = fromChord && dt > 0 && dt < 0.15 && n.sus > 0 && !slideSt;

        // For arpeggio notes: ALL notes show their ghost simultaneously
        // the moment the FIRST note enters _PROJ_WIN_ARP — exactly when
        // isNextOnString would reveal the first note's ghost on its own.
        // Using arpBounds.start as the shared reference makes every note
        // in the arpeggio fade in together, keyed off that single anchor.
        const arpDtToStart = arpBounds != null ? arpBounds.start - now : Infinity;
        const arpProjFactor = Math.max(0, Math.min(1, 1 - Math.max(arpDtToStart, 0) / _PROJ_WIN_ARP));
        const arpGhostActive = arpBounds != null
            && arpDtToStart < _PROJ_WIN_ARP
            && now <= arpBounds.end + 0.05;
        // Ghost stays at final "on the board" orientation — not the
        // incoming approachRot sweep — so it nests with the note at
        // impact. projRim/projScale/bodyDim are pure functions of
        // effSkipBody/_vibrancyProjOp; hoisted here so both the Primary
        // ghost (below) and the Upcoming-slot ghosts (sibling block
        // further down) can use them.
        const projRim = 0; // harmonic gems now land horizontal (no diamond offset)
        // _vibrancyProjOp (0.15..0.5) is the vibrancy-scaled idle floor;
        // scale the whole opacity by (_vibrancyProjOp / 0.15) so the slider
        // affects the projection the same way it affects note bodies.
        const projScale = _vibrancyProjOp / 0.15;
        // effSkipBody (= skipBody && dt > 0, #862): a slide-destination note
        // whose own gem is suppressed pre-hit isn't dimmed once it's hit.
        const bodyDim = effSkipBody ? 0.38 : 1;
        if (n.f > 0 && projectionVisible && (
            (!_overLinger && isNextOnString && dt > -ghostHold && dt < ghostWin && projFactor > 0.001 && !isBlocked)
            || arpGhostActive
        )) {
            const proj = projMeshArr[s][0];
            // Arp ghost: uniform opacity keyed off arpBounds.start so all
            // notes fade in/out together regardless of individual dt values.
            let arpGhostAlpha = 1;
            if (arpGhostActive) {
                const remainingP = arpBounds.end - now;
                const fadeOutP = remainingP < 0.25 ? Math.max(0, remainingP / 0.25) : 1;
                arpGhostAlpha = Math.min(arpProjFactor, fadeOutP);
            }
            // Chart-format-style ghost: a single 0→1 progress value drives both the
            // fade-in (opacity/emissive, below) and the grow-from-small scale
            // on the frame mesh and fret-digit label. Reuses the existing
            // per-path progress signals — arp ghosts use arpGhostAlpha
            // (already 0→1, incl. fade-out tail), non-arp ghosts use
            // projFactor (0→1 across ghostWin).
            const ghostProgress = arpGhostActive ? arpGhostAlpha : projFactor;
            const projGrowScale = PROJ_GROW_MIN + (1 - PROJ_GROW_MIN) * ghostProgress;
            const rimSolid = arpGhostActive
                ? 0.75 * arpGhostAlpha
                : projFactor * 0.94;
            proj.material.opacity = Math.min(0.96,
                projScale * rimSolid * (0.5 + 0.5 * glowMul) * bodyDim);
            proj.material.emissiveIntensity = arpGhostActive
                ? 0.35 * arpGhostAlpha * glowMul * bodyDim
                : projFactor * 0.55 * glowMul * bodyDim;
            proj.position.set(x, y, 0);
            proj.scale.set(projGrowScale, projGrowScale, projGrowScale);
            proj.rotation.z = projRim;
            proj.visible = true;

            const ghostFretOk = showFretOnNote && (
                arpGhostActive ||
                fretNumberGhostScope === 'all' ||
                (fretNumberGhostScope === 'chords' && fromChord)
            );
            if (ghostFretOk && pGhostFretLbl) {
                // chord-hand style → show finger number (1–4) from the chord
                // template; fall back to fret number when no finger data exists
                // (GP imports, open strings, non-chord notes).
                const ghostFretDisplay = fromChord && fretNumberGhostScope === 'chords'
                    ? (_templateFingerForChordGhost(chordId, n.s) ?? _templateFretForChordGhost(chordId, n.s, n.f))
                    : fromChord
                        ? _templateFretForChordGhost(chordId, n.s, n.f)
                        : n.f;
                let ghostFretLblAlpha = 1;
                if (arpGhostActive) {
                    // Reuse arpGhostAlpha — already encodes fade-in (keyed
                    // off arpBounds.start via arpProjFactor) + fade-out.
                    ghostFretLblAlpha = arpGhostAlpha;
                } else if (ghostPastHold) {
                    const nextSoon = nxFrame != null && nxFrame.t > n.t + 1e-6
                        && (nxFrame.t - now) <= GHOST_FRET_LBL_FADE_S;
                    const ghostFadeS = Math.min(GHOST_FRET_LBL_FADE_S, ghostHold);
                    ghostFretLblAlpha = hwyPostHitTailFadeMul(dt, ghostHold, nextSoon, ghostFadeS);
                } else {
                    // Pre-impact approach: fade the digit in alongside the
                    // frame (projFactor), instead of popping in at full alpha.
                    ghostFretLblAlpha = projFactor;
                }
                const _ghostFretForScale = fromChord && fretNumberGhostScope === 'chords'
                    ? n.f
                    : ghostFretDisplay;
                drawGhostFretLabel(x, y, projRim, ghostFretDisplay, ghostFretLblAlpha, projGrowScale, _ghostFretForScale);
            }
        }

        // ── Upcoming board ghosts (slots 1/2): up to 2 additional,
        // independent pre-impact previews per string for plain lead
        // notes, chart-format-style. Primary (slot 0, above) already shows the
        // very next note on this string; this sibling block shows the
        // 1-2 notes after that, each on its own mesh with its own
        // fixed-GHOST_UPCOMING_WIN ramp — fixes fast same-string runs
        // where every note after the first had almost no ramp time
        // (capped at the gap to the *previous* note on that string).
        // !nextTAligned excludes exactly the note Primary is already
        // showing, so a note is never drawn in two slots at once.
        if (n.f > 0 && projectionVisible && !fromChord && !nextTAligned
            && dt > 0 && dt < GHOST_UPCOMING_WIN) {
            const slotIdx = 1 + _scrGhostUpcomingCount[s];
            if (slotIdx <= 2) {
                _scrGhostUpcomingCount[s]++;
                // Same formula as Primary's projFactor for !fromChord
                // notes (ghostWin === GHOST_UPCOMING_WIN there too) —
                // keeps the size/brightness curve continuous as a note's
                // rank improves frame-to-frame (slot 2 → 1 → 0).
                const upcomingProgress = projFactor;
                const proj = projMeshArr[s][slotIdx];
                const rimSolid = upcomingProgress * 0.94;
                proj.material.opacity = Math.min(0.96,
                    projScale * rimSolid * (0.5 + 0.5 * glowMul) * bodyDim);
                proj.material.emissiveIntensity = upcomingProgress * 0.55 * glowMul * bodyDim;
                const growScale = PROJ_GROW_MIN + (1 - PROJ_GROW_MIN) * upcomingProgress;
                proj.position.set(x, y, 0);
                proj.scale.set(growScale, growScale, growScale);
                proj.rotation.z = projRim;
                proj.visible = true;

                if (showFretOnNote && fretNumberGhostScope === 'all' && pGhostFretLbl) {
                    drawGhostFretLabel(x, y, projRim, n.f, upcomingProgress, growScale, n.f);
                }
            }
        }
    }

    /**
     * Draw  [ GEM ]  bracket pair for an arpeggio note.
     *
     * While the note is approaching (bracketDt > 0) the brackets travel at the
     * same Z as the gem.  Once the note hits the line (bracketDt <= 0) the
     * brackets sit at Z = 0 (the fretboard plane) and persist until arpEnd.
     * They fade in with approach and fade out in the last 0.25 s of the arpeggio.
     *
     * Fretted notes: `[ ]` — 3 BoxGeometry bars per side (vertical + 2 caps).
     * Open strings:  `< >` — 2 diagonal arms per side, tips at note edges.
     *
     * openHalfW (optional) — half-width of the open note body; when supplied,
     * the < > tips are placed at the actual edges of the note rather than a
     * fixed offset.
     */
    function drawArpBrackets(x, y, bracketDt, arpEnd, now, s, isOpen = false, openHalfW = null) {
        if (bracketDt >= AHEAD) return;
        if (bracketDt < 0 && now > arpEnd + 0.05) return;
        if (!pArpBracket) return;

        let alpha;
        if (bracketDt > 0) {
            // Match the chord frame box visibility: full opacity throughout the
            // entire AHEAD window so brackets appear the moment the frame enters
            // view, not after a slow linear fade from alpha≈0 at 3 s out.
            alpha = 1;
        } else {
            const remaining = arpEnd - now;
            alpha = remaining > 0.25 ? 1 : Math.max(0, remaining / 0.25);
        }
        if (alpha < 0.01) return;

        const bracketZ = bracketDt > 0 ? Math.min(0, dZ(bracketDt)) : 0;
        const col = activePalette[s % activePalette.length];
        const barThick = NW * 0.09;
        const bracketH = NH * 1.05;
        const capLen   = NW * 0.42;
        const xOff     = (isOpen && openHalfW != null) ? openHalfW : NW * 0.95;
        const zOff     = 0.006 * K;
        const ord      = 18;

        if (isOpen) {
            // < > chevron — 2 diagonal arms per side.
            // Arm goes from tip outward; angle from positive-X axis via atan2.
            const armLen = Math.sqrt(capLen * capLen + (bracketH * 0.5) * (bracketH * 0.5));
            const ang    = Math.atan2(bracketH * 0.5, capLen); // upper-right arm angle

            const diagBar = (px, py, rz) => {
                const b = pArpBracket.get();
                b.material.color.setHex(col);
                b.material.opacity = alpha;
                b.renderOrder = ord;
                b.position.set(px, py, bracketZ + zOff);
                b.rotation.set(0, 0, rz);
                b.scale.set(armLen, barThick, barThick);
            };

            // < tip at (x - xOff), arms open to the right
            diagBar(x - xOff + capLen * 0.5, y + bracketH * 0.25,  ang);
            diagBar(x - xOff + capLen * 0.5, y - bracketH * 0.25, -ang);

            // > tip at (x + xOff), arms open to the left
            diagBar(x + xOff - capLen * 0.5, y + bracketH * 0.25,  Math.PI - ang);
            diagBar(x + xOff - capLen * 0.5, y - bracketH * 0.25, -Math.PI + ang);
        } else {
            const bar = (px, py, sw, sh) => {
                const b = pArpBracket.get();
                b.material.color.setHex(col);
                b.material.opacity = alpha;
                b.renderOrder = ord;
                b.position.set(px, py, bracketZ + zOff);
                b.rotation.set(0, 0, 0);
                b.scale.set(sw, sh, barThick);
            };

            // Left bracket  [  – vertical bar then caps opening to the right
            bar(x - xOff,                     y,                  barThick, bracketH);
            bar(x - xOff + capLen * 0.5, y + bracketH * 0.5, capLen,   barThick);
            bar(x - xOff + capLen * 0.5, y - bracketH * 0.5, capLen,   barThick);

            // Right bracket  ]  – vertical bar then caps opening to the left
            bar(x + xOff,                     y,                  barThick, bracketH);
            bar(x + xOff - capLen * 0.5, y + bracketH * 0.5, capLen,   barThick);
            bar(x + xOff - capLen * 0.5, y - bracketH * 0.5, capLen,   barThick);
        }
    }

    function drawNotedetectLabels(ctx, W, H) {
        if (!_ndLabels.length || !cam || !_probe) return;
        ctx.save();
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const item of _ndLabels) {
            _probe.set(item.x, item.y, item.z);
            _probe.project(cam);
            if (_probe.z < -1 || _probe.z > 1) continue;
            const sx = (_probe.x * 0.5 + 0.5) * W;
            const sy = (-_probe.y * 0.5 + 0.5) * H;
            for (let i = 0; i < item.labels.length; i++) {
                const label = item.labels[i];
                const y = sy + (i - (item.labels.length - 1) / 2) * 15;
                ctx.lineWidth = 4;
                ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                ctx.strokeText(label.text, sx, y);
                ctx.fillStyle = label.color;
                ctx.fillText(label.text, sx, y);
            }
        }
        ctx.restore();
    }

    // Score FX overlay pass — "+N" pops rising off their gems, milestone
    // particle bursts / multiplier ring-pulses / streak-break flickers
    // anchored on the strike line. Same overlay layer + projection
    // pattern as drawNotedetectLabels; costs one early-out when nothing
    // is active.
    function drawScoreFx(ctx, W, H) {
        if (!cam || !_probe) return;
        const nowMs = _ndFrameNowMs || performance.now();
        // TTL-prune the pop dedup keys (bounded: only notes hit in the
        // last few seconds).
        if (_fxSeen.size) {
            for (const [k, exp] of _fxSeen) {
                if (exp <= nowMs) _fxSeen.delete(k);
            }
        }
        let anyPop = false;
        for (let i = 0; i < _fxPops.length; i++) {
            if (_fxPops[i].active) { anyPop = true; break; }
        }
        let anyBurst = false;
        for (let i = 0; i < _fxBursts.length; i++) {
            if (_fxBursts[i].active) { anyBurst = true; break; }
        }
        const ringAge = nowMs - _fxRingMs;
        const breakAge = nowMs - _fxBreakMs;
        if (!anyPop && !anyBurst && ringAge >= 600 && breakAge >= 350) return;

        const pal = _fxPalette;
        ctx.save();

        // Streak-break flicker: brief red wash over the whole panel.
        if (breakAge < 350) {
            const a = 0.10 * (1 - breakAge / 350);
            ctx.fillStyle = pal.miss;
            ctx.globalAlpha = a;
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = 1;
        }

        // Strike-line center in screen px — anchor for bursts + pulses.
        let cx = W / 2, cy = H * 0.72, centerOk = false;
        {
            const fretMidY = (sY(0) + sY(nStr - 1)) / 2;
            _probe.set(curX, fretMidY, 0);
            _probe.project(cam);
            if (_probe.z >= -1 && _probe.z <= 1) {
                cx = (_probe.x * 0.5 + 0.5) * W;
                cy = (-_probe.y * 0.5 + 0.5) * H;
                centerOk = true;
            }
        }

        // Multiplier ring-pulse: one expanding ring on tier-up; the ×4
        // tier pulses in the secondary accent like the HUD badge.
        if (centerOk && ringAge < 600) {
            const t = ringAge / 600;
            const ease = 1 - Math.pow(1 - t, 2);
            ctx.beginPath();
            ctx.arc(cx, cy, 20 + ease * Math.min(W, H) * 0.28, 0, Math.PI * 2);
            ctx.strokeStyle = _fxRingMult >= 4 ? pal.accent2 : pal.accent;
            ctx.globalAlpha = 0.6 * (1 - t);
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Milestone bursts.
        if (anyBurst && centerOk) {
            for (let i = 0; i < _fxBursts.length; i++) {
                const b = _fxBursts[i];
                if (!b.active) continue;
                const age = nowMs - b.bornMs;
                if (age >= _FX_BURST_LIFE_MS) { b.active = false; continue; }
                const t = age / _FX_BURST_LIFE_MS;
                ctx.globalAlpha = 1 - t;
                for (let j = 0; j < _FX_BURST_N; j++) {
                    b.px[j] += b.vx[j];
                    b.py[j] += b.vy[j];
                    b.vy[j] += 0.08;
                    ctx.fillStyle = (j & 1) ? pal.accent : pal.accent2;
                    ctx.fillRect(cx + b.px[j] - 2, cy + b.py[j] - 2, 4, 4);
                }
                ctx.globalAlpha = 1;
            }
        }

        // "+N" pops: rise off the gem and fade over the back half.
        if (anyPop) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < _fxPops.length; i++) {
                const p = _fxPops[i];
                if (!p.active) continue;
                const age = nowMs - p.bornMs;
                if (age >= _FX_POP_LIFE_MS) { p.active = false; continue; }
                _probe.set(p.x, p.y, p.z);
                _probe.project(cam);
                if (_probe.z < -1 || _probe.z > 1) continue;
                const t = age / _FX_POP_LIFE_MS;
                const sx = (_probe.x * 0.5 + 0.5) * W;
                const sy2 = (-_probe.y * 0.5 + 0.5) * H - t * 30;
                ctx.globalAlpha = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
                ctx.font = `bold ${13 + (p.mult - 1) * 2}px '${pal.font}', sans-serif`;
                ctx.lineWidth = 4;
                ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                ctx.strokeText(p.text, sx, sy2);
                ctx.fillStyle = pal.accent;
                ctx.fillText(p.text, sx, sy2);
            }
            ctx.globalAlpha = 1;
        }

        ctx.restore();
    }

    // Horizontal-FOV-hold ("Hor+"). Returns the vertical fov (deg) the
    // camera should use for the given pane aspect. With the bridge off (or
    // absent), or at/under the start aspect, it returns the base vertical
    // fov unchanged — an exact no-op, so normal panes render identically to
    // before. Past the start aspect it lowers the vertical fov to keep the
    // horizontal cone ~constant, so the neck fills an ultra-wide pane
    // instead of collapsing into a central sliver. Pure + finite-guarded.
    function effectiveVfov(aspect, tune) {
        const base = (tune && Number.isFinite(tune.baseVfov)) ? tune.baseVfov : BASE_VFOV;
        if (!tune || !tune.enabled || !Number.isFinite(aspect) || aspect <= 0) return base;
        const start = (Number.isFinite(tune.startAspect) && tune.startAspect > 0)
            ? tune.startAspect : HORPLUS_START_ASPECT;
        if (aspect <= start) return base;
        const floor = Number.isFinite(tune.minVfovDeg) ? tune.minVfovDeg : HORPLUS_MIN_VFOV;
        const DEG = Math.PI / 180;
        // Held horizontal fov: explicit hfovDeg if given, else the horizontal
        // cone the base vertical fov produces at the start aspect.
        const hfov = (Number.isFinite(tune.hfovDeg) && tune.hfovDeg > 0)
            ? tune.hfovDeg * DEG
            : 2 * Math.atan(Math.tan(base * DEG / 2) * start);
        // Vertical fov that reproduces that horizontal cone at this aspect.
        let vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect) / DEG;
        const blend = Number.isFinite(tune.blend) ? Math.max(0, Math.min(1, tune.blend)) : 1;
        vfov = base + (vfov - base) * blend;            // 0 = base, 1 = full Hor+
        if (!Number.isFinite(vfov)) return base;
        return Math.max(floor, Math.min(base, vfov));
    }

    /* ── Camera smooth lerp ──────────────────────────────────────────── */
    function camUpdate(bundle) {
        const bpm = computeBPM(bundle.beats, bundle.currentTime);
        const lerp = CAM_LERP_BASE * Math.max(bpm, 60) / 120;

        // ── Horizontal-FOV-hold + optional wide-pane pose nudges ──
        // Driven by window.__h3dAspectTune (default off → exact no-op).
        // _resolveTuneFor(paneKey) returns the shared base with THIS pane's
        // overrides (if any) laid on top, so a single split pane can be framed
        // independently. The base is seeded from defaults + localStorage on
        // first read, so a persisted tuning session applies on load without
        // opening the panel. Every field is finite-coerced. When disabled (or
        // splitOnly and not in a split) the tune is treated as null, so
        // effectiveVfov returns the base vertical fov and cam.fov is restored
        // to it. The fov write is guarded on an actual change so a steady pane
        // costs nothing.
        const _paneKey = _aspectPaneKey(
            bundle && bundle.songInfo && bundle.songInfo.arrangement, _paneUid);
        // Only feed the Target-picker registry while the tuner is open (same
        // gate as the readout). Closed → nothing is registered, so the registry
        // can't grow for users who never open the panel; the key is still
        // resolved below so any saved overrides keep applying.
        if (window.__h3dAspectPanelOpen) _aspectRegisterPane(_paneKey);
        const _aspTune = _resolveTuneFor(_paneKey);
        const _aspActive = !!(_aspTune && _aspTune.enabled
            && !(_aspTune.splitOnly && !_ssActive()));
        const _tune = _aspActive ? _aspTune : null;
        const _vfov = effectiveVfov(_paneAspect, _tune);
        if (Number.isFinite(_vfov) && Math.abs(_vfov - cam.fov) > 1e-4) {
            cam.fov = _vfov;
            cam.updateProjectionMatrix();
        }
        // Publish a per-pane live readout for the tuner panel (only while it's
        // open, so the steady path stays allocation-free). Keyed by pane so
        // the panel can show the reading for whichever target is selected.
        if (window.__h3dAspectPanelOpen) {
            const _ro = window.__h3dAspectReadout || (window.__h3dAspectReadout = {});
            const _slot = _ro[_paneKey] || (_ro[_paneKey] = {});
            _slot.aspect = _paneAspect; _slot.vfov = _vfov;
            _ro.__last = _paneKey;
        }
        // Optional pose nudges (height / dolly / pitch) to chase a low-flat
        // wide-pane look if fov alone isn't enough. Gated to wide panes and
        // suppressed while the Camera Director owns the view (it wins).
        const _startAspect = (_tune && Number.isFinite(_tune.startAspect) && _tune.startAspect > 0)
            ? _tune.startAspect : HORPLUS_START_ASPECT;
        // Resolve the Camera Director bridge once (per-panel under splitscreen,
        // else global). Used both for the wide-pane gate and the transforms below.
        const _freeCam = _freeCamFor(highwayCanvas);
        const _dirActive = !!(_freeCam && _freeCam.enabled);
        const _wide = !!(_tune && _paneAspect > _startAspect) && !_dirActive;
        const _poseHMul = (_wide && Number.isFinite(_tune.heightMul)) ? _tune.heightMul : 1;
        const _poseDMul = (_wide && Number.isFinite(_tune.distMul)) ? _tune.distMul : 1;
        const _poseLookYAdd = (_wide && Number.isFinite(_tune.pitchAdd)) ? _tune.pitchAdd * K : 0;
        const _poseLookZMul = (_wide && Number.isFinite(_tune.lookDepthMul) && _tune.lookDepthMul > 0)
            ? _tune.lookDepthMul : 1;

        curX += (tgtX - curX) * lerp;
        // The fret-row fit guard (end of camUpdate) may dolly the camera back
        // via _fretRowFitBoost; the span-driven tgtDist still owns zooming IN.
        curDist += (tgtDist * _fretRowFitBoost - curDist) * lerp;
        const dist = curDist * aspectScale;
        const h = CAM_H_BASE * (dist / CAM_DIST_BASE);

        // Zoom-interpolated framing multipliers: tight (NEAR) -> lower/closer;
        // wide (FAR, fret 1<->20) -> higher/pulled back.
        const _zt = Math.max(0, Math.min(1,
            (dist - CAM_FRAME_DIST_NEAR) / (CAM_FRAME_DIST_FAR - CAM_FRAME_DIST_NEAR)));
        const _hMul = CAM_FRAME_H_NEAR + (CAM_FRAME_H_FAR - CAM_FRAME_H_NEAR) * _zt;
        const _dMul = CAM_FRAME_D_NEAR + (CAM_FRAME_D_FAR - CAM_FRAME_D_NEAR) * _zt;
        const shoulderOffset = (_leftyCached ? -1 : 1) * 10 * K;
        let _camX = curX + shoulderOffset, _camY = h * _hMul, _camZ = dist * _dMul;
        // Optional wide-pane pose nudges (default identity → no-op).
        if (_poseHMul !== 1) _camY *= _poseHMul;
        if (_poseDMul !== 1) _camZ *= _poseDMul;
        // ── Free-camera user tweaks (orbit / height / zoom / pan) ──
        // Driven by the Camera Director plugin via the camera bridge:
        // window.__h3dCamCtlPanels[panelIndexFor(canvas)] when split (this
        // panel's own camera), falling back to the global window.__h3dCamCtl.
        // Layered ON TOP of the auto-framing so note tracking still works.
        // The bridge is read once into _freeCam and reused for both the
        // position and the look-at transforms; every field is coerced to a
        // finite number before use so a malformed object can never feed NaN
        // into cam.position / cam.lookAt.
        // _freeCam resolved above via _freeCamFor(highwayCanvas): the
        // per-panel __h3dCamCtlPanels entry, else global __h3dCamCtl, else null.
        const _lookAtZ = -FOCUS_D * 0.35 * _poseLookZMul;
        if (_freeCam && _freeCam.enabled) {
            const _distMul = Number.isFinite(_freeCam.distMul) ? _freeCam.distMul : 1;
            const _heightMul = Number.isFinite(_freeCam.heightMul) ? _freeCam.heightMul : 1;
            const _yaw = Number.isFinite(_freeCam.yaw) ? _freeCam.yaw : 0;
            const _tx = curX, _ty = curLookY, _tz = _lookAtZ; // look target
            let _vx = _camX - _tx, _vy = _camY - _ty, _vz = _camZ - _tz;
            _vx *= _distMul; _vy *= _distMul; _vz *= _distMul; // zoom (dolly)
            _vy *= _heightMul;                                 // height
            const _cy = Math.cos(_yaw), _sy = Math.sin(_yaw);  // orbit around Y
            const _rx = _vx * _cy - _vz * _sy, _rz = _vx * _sy + _vz * _cy;
            _camX = _tx + _rx; _camY = _ty + _vy; _camZ = _tz + _rz;
        }
        cam.position.set(_camX, _camY, _camZ);

        // Self-correcting look-at Y: project the fretboard's near-edge centre
        // to NDC space. If it drifts toward the frame edge, nudge tgtLookY
        // toward the fretboard centre so the camera tilts to re-frame it.
        // This lets the camera adapt to any panel aspect ratio automatically.
        const fretMidY = (sY(0) + sY(nStr - 1)) / 2;
        _probe.set(curX, fretMidY, 0);                  // play-line fretboard centre
        cam.lookAt(curX, curLookY + _poseLookYAdd, _lookAtZ);    // tentative look — needed for project()
        cam.updateMatrixWorld();
        _probe.project(cam);                             // _probe.y → NDC in [-1, 1]

        // Keep fretboard centre in the lower third of the screen (NDC ≈ -0.35).
        // The deadband width and correction strength are both blended
        // between Twitchy and Calm bounds by the user's tiltSmoothing
        // setting — twitchy = re-frame aggressively (narrow band, strong
        // nudge); calm = let small drift ride (wide band, weak nudge).
        const DESIRED_NDC_Y = -0.35;
        const tiltBand   = CAM_TILT_BAND_T + (CAM_TILT_BAND_C - CAM_TILT_BAND_T) * tiltSmoothing;
        const tiltStr    = CAM_TILT_STR_T  + (CAM_TILT_STR_C  - CAM_TILT_STR_T)  * tiltSmoothing;
        if (_probe.y < DESIRED_NDC_Y - tiltBand || _probe.y > DESIRED_NDC_Y + tiltBand) {
            // _probe.y too low → fretboard near bottom → tgtLookY decreases → camera tilts down → fretboard rises
            // _probe.y too high → fretboard near top  → tgtLookY increases → camera tilts up   → fretboard drops
            const correction = (DESIRED_NDC_Y - _probe.y) * fretMidY * tiltStr;
            tgtLookY = Math.max(-fretMidY, Math.min(fretMidY, tgtLookY - correction));
        }
        curLookY += (tgtLookY - curLookY) * lerp;

        // Final look-at with the corrected Y (overrides the tentative one above).
        // User tilt (pitch) + pan offsets layer on top when the free-cam is
        // enabled; each is coerced to a finite number to avoid a NaN look-at.
        if (_freeCam && _freeCam.enabled) {
            const _panX = Number.isFinite(_freeCam.panX) ? _freeCam.panX : 0;
            const _panY = Number.isFinite(_freeCam.panY) ? _freeCam.panY : 0;
            const _pitch = Number.isFinite(_freeCam.pitch) ? _freeCam.pitch : 0;
            cam.lookAt(curX + _panX * K, curLookY + (_pitch + _panY) * K, _lookAtZ);
        } else {
            cam.lookAt(curX, curLookY + _poseLookYAdd, _lookAtZ);
        }

        // ── Fret-row fit guard ────────────────────────────────────────────
        // Project the fret-number-row band (just below the lowest string, at
        // the play line) with the final camera. If it sits below the safe
        // bottom line, dolly back (raise _fretRowFitBoost → applied to the
        // curDist lerp target next frame) until it clears; relax lazily once
        // there's comfortable headroom. Asymmetric + deadbanded so it
        // converges without hunting, and capped so the zoom can't pop. It
        // cooperates with the tilt loop above rather than fighting it: pulling
        // back shrinks the scene, the tilt loop keeps the board centre anchored
        // at DESIRED_NDC_Y, so only the row's bottom headroom changes. Skipped
        // while the free-cam (Camera Director) owns the view.
        if (_freeCam && _freeCam.enabled) {
            if (_fretRowFitBoost !== 1) _fretRowFitBoost = 1;
        } else {
            cam.updateMatrixWorld();
            const _rowY = Math.min(sY(0), sY(nStr - 1)) - S_GAP * 1.4;
            _probe.set(curX, _rowY, 0.5 * K);
            _probe.project(cam);                              // _probe.y → NDC; < -1 = off the bottom
            const _rowNdcY = _probe.y;
            if (_rowNdcY < FRET_ROW_FIT_NDC_MIN) {
                // Row below the safe line → pull back promptly, proportional to
                // the deficit so it converges in a few frames without overshoot.
                const _need = FRET_ROW_FIT_NDC_MIN - _rowNdcY;
                _fretRowFitBoost = Math.min(FRET_ROW_FIT_BOOST_MAX,
                    _fretRowFitBoost + Math.min(0.05, _need * 0.4));
            } else if (_rowNdcY > FRET_ROW_FIT_NDC_MIN + FRET_ROW_FIT_DEADBAND
                       && _fretRowFitBoost > 1) {
                // Comfortable headroom → relax the dolly back toward normal, lazily.
                _fretRowFitBoost = Math.max(1, _fretRowFitBoost - 0.01);
            }
        }
    }

    /* ── Resize helper ───────────────────────────────────────────────── */
    function applySize(w, h) {
        if (!ren || !cam || !wrap) return;
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
        const baseDPR = _ssActive() ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 2);
        ren.setPixelRatio(_renderScale * baseDPR);
        ren.setSize(w, h);
        // Pin the overlay to #highway's exact box so it fully covers the
        // canvas. The wrap is anchored to top:0/left:0/right:0 of its
        // offset parent, which only lines up with #highway when the
        // canvas sits at the parent's origin. The v3 player can place
        // chrome above the canvas, shifting the wrap up so its lower edge
        // falls short of #highway — leaving a strip of the canvas exposed
        // (the reported gap, where the previous renderer's frame showed
        // through). The wrap is a sibling of highwayCanvas, so they share
        // an offset parent; tracking the canvas's box keeps the overlay
        // flush in single-player and splitscreen alike.
        //
        // Derive the box from the SAME getBoundingClientRect measurements
        // that drive ren.setSize(w, h) — NOT integer offsetTop/Width — so
        // the overlay matches the renderer exactly. Under browser zoom or
        // fractional flex layouts the canvas lands on sub-pixel bounds;
        // offsetWidth/Top round to whole pixels and would leave the wrap up
        // to 1px short of (or shifted from) the canvas, reopening the
        // exposed edge strip. Position is taken relative to the containing
        // block's padding edge (clientTop/Left strip the parent's border),
        // which is what `top`/`left` resolve against for the absolutely
        // positioned wrap. Guarded on a laid-out canvas (offsetWidth/Height
        // > 0); otherwise fall back to the static top:0/left:0/right:0.
        if (highwayCanvas && highwayCanvas.offsetWidth > 0 && highwayCanvas.offsetHeight > 0) {
            const _pinParent = wrap.offsetParent || highwayCanvas.parentNode;
            const _cr = highwayCanvas.getBoundingClientRect();
            const _pr = _pinParent ? _pinParent.getBoundingClientRect() : { top: 0, left: 0 };
            const _pbTop = _pinParent ? _pinParent.clientTop : 0;
            const _pbLeft = _pinParent ? _pinParent.clientLeft : 0;
            wrap.style.top = (_cr.top - _pr.top - _pbTop) + 'px';
            wrap.style.left = (_cr.left - _pr.left - _pbLeft) + 'px';
            wrap.style.right = 'auto';
            wrap.style.width = _cr.width + 'px';
            wrap.style.height = _cr.height + 'px';
            _wrapPinned = true;
        } else {
            // Canvas not laid out (e.g. init ran before #highway had a real
            // box, or a panel hide/show where canvasSize() falls back to the
            // parent panel). Reset to the static anchor — if we had pinned
            // before, the old top/left/right:auto/width would otherwise stay
            // and the wrap would reappear at a stale horizontal position on
            // the next show. Leave _wrapPinned false so the rAF loop re-pins
            // once the canvas materializes again.
            wrap.style.top = '0';
            wrap.style.left = '0';
            wrap.style.right = '0';
            wrap.style.width = 'auto';
            wrap.style.height = h + 'px';
            _wrapPinned = false;
        }
        if (lyricsCanvas) { lyricsCanvas.width = w; lyricsCanvas.height = h; }
        _diagRenderCache.clear();
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
        aspectScale = Math.max(1, REF_ASPECT / Math.max(cam.aspect, 0.5));
        // Cache the pane aspect for the horizontal-FOV-hold in camUpdate.
        // cam.fov itself is owned by camUpdate (not set here) so live
        // __h3dAspectTune edits apply every frame without a resize.
        _paneAspect = cam.aspect;
        _appliedW = w; _appliedH = h;
    }

    /* ── Teardown ────────────────────────────────────────────────────── */
    function teardown() {
        // Background animations (#13). Drop the listener first so any
        // mid-teardown settings change doesn't try to rebuild a torn-
        // down scene; then dispose the active style's resources.
        if (_bgListener) { _bgUnsubscribe(_bgListener); _bgListener = null; }
        // WebGL context-loss listeners (bound in initScene on ren.domElement).
        // Remove before ren is disposed below so a torn-down instance can't
        // keep firing them; reset the flag so a reused instance starts clean.
        if (ren && ren.domElement) {
            if (_onCtxLost) { try { ren.domElement.removeEventListener('webglcontextlost', _onCtxLost, false); } catch (e) {} }
            if (_onCtxRestored) { try { ren.domElement.removeEventListener('webglcontextrestored', _onCtxRestored, false); } catch (e) {} }
        }
        _onCtxLost = _onCtxRestored = null;
        _ctxLost = false;
        // Notedetect listeners (issue #9). Remove on destroy so a
        // panel that stops doesn't keep accumulating marks. Marks
        // arrays are cleared too — they hold stale chart positions
        // that next init() may reuse (drawNote keys on (s, f, t)).
        if (_ndOnHit) { window.removeEventListener('notedetect:hit', _ndOnHit); _ndOnHit = null; }
        if (_ndOnMiss) { window.removeEventListener('notedetect:miss', _ndOnMiss); _ndOnMiss = null; }
        if (_fxOnFx) { window.removeEventListener('notedetect:fx', _fxOnFx); _fxOnFx = null; }
        if (window.feedBack && typeof window.feedBack.off === 'function') {
            if (_fxOnSkin) { try { window.feedBack.off('notedetect:skin', _fxOnSkin); } catch (e) {} _fxOnSkin = null; }
            if (_ndOnBusHit)  window.feedBack.off('note:hit', _ndOnBusHit);
            if (_ndOnBusMiss) window.feedBack.off('note:miss', _ndOnBusMiss);
            if (_visibilityHandler) {
                try { window.feedBack.off('highway:visibility', _visibilityHandler); } catch (e) {}
            }
            if (_canvasReplacedHandler) {
                try { window.feedBack.off('highway:canvas-replaced', _canvasReplacedHandler); } catch (e) {}
            }
        }
        _ndOnBusHit = _ndOnBusMiss = null;
        _visibilityHandler = null;
        _canvasReplacedHandler = null;
        _ndHitMarks = [];
        _ndMissMarks = [];
        _ndLabels = [];
        for (const p of _fxPops) p.active = false;
        for (const b of _fxBursts) b.active = false;
        _fxSeen.clear();
        _fxGen++;   // invalidate any pending deferred window-copy fallbacks
        _fxLastFxDetail = null;
        _fxElemSeen = new WeakSet();
        _fxRingMs = _fxBreakMs = -1e9;
        _chordVerdicts = new Map();
        _bgUnmountStyle();
        bgGroup = null; _bgLastT = 0;
        _diagChord = null; _diagPrev = null; _diagPrevOpacity = 0; _diagPrevStartOpacity = 0; _diagPrevStartT = null;
        _diagEntranceT = 1.0; _diagLastKey = null; _diagRenderCache.clear();

        if (wrap) { wrap.remove(); wrap = null; }
        _disposeOpenStringPitchSprites();
        if (scene) {
            // Don't dispose material.map textures here. Texture
            // lifetime belongs to whoever allocated it; the bg
            // styles' per-layer CanvasTextures (e.g. silhouettes'
            // wrappers around the shared _silCanvas) are released
            // in their own teardowns. txtCache textures are
            // explicitly disposed below; mStr/mGlow/etc. don't have
            // a .map. Disposing here would either double-free or
            // yank a still-in-use texture out from under another
            // mount.
            scene.traverse((obj) => {
                // fretTubeGeo is shared across all fret meshes — dispose it
                // exactly once below, not once per mesh here.
                if (obj.geometry !== fretTubeGeo) obj.geometry?.dispose?.();
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    for (const m of mats) m?.dispose?.();
                }
            });
            // Shared chord-frame fill gradient — not owned by txtCache;
            // MeshBasicMaterial.dispose() does not release maps.
            chordFrameGradTex?.dispose?.();
            chordFrameGradTexArp?.dispose?.();
        }
        gNote?.dispose?.(); gSus?.dispose?.(); gBeat?.dispose?.(); gSusRail?.dispose?.(); gTapChevron?.dispose?.();
        mSusRailBase?.dispose?.(); mSusRailBase = null; gSusRail = null; pSusRail = null;
        gSusRailBloom?.dispose?.(); mSusRailBloomBase?.dispose?.(); _bloomGaussTex?.dispose?.();
        gSusRailBloom = null; mSusRailBloomBase = null; _bloomGaussTex = null; pSusRailBloom = null;
        gTechPlane?.dispose?.(); gTechPlane = null; pTechPlane = null;
        // InstancedMesh disposal — .dispose() releases instanceMatrix / instanceColor
        // GPU buffers. Geometry and material are disposed separately below.
        imPMTech?.dispose?.(); imPMTech = null;
        imFHTech?.dispose?.(); imFHTech = null;
        imPMXFill?.dispose?.(); imPMXFill = null;
        imPMXLines?.dispose?.(); imPMXLines = null;
        imFHXFill?.dispose?.(); imFHXFill = null;
        imFHXLines?.dispose?.(); imFHXLines = null;
        // Geometry clones for PM/FH tech IMs (own instanceAlpha attribute).
        _imGPMTech?.dispose?.(); _imGPMTech = null;
        _imGFHTech?.dispose?.(); _imGFHTech = null;
        // ShaderMaterials for all 6 IMs.
        _imPMTechMat?.dispose?.();  _imPMTechMat = null;
        _imFHTechMat?.dispose?.();  _imFHTechMat = null;
        _imPMXFillMat?.dispose?.(); _imPMXFillMat = null;
        _imPMXLinesMat?.dispose?.(); _imPMXLinesMat = null;
        _imFHXFillMat?.dispose?.(); _imFHXFillMat = null;
        _imFHXLinesMat?.dispose?.(); _imFHXLinesMat = null;
        _imM4 = _imPos = _imSca = _imQ = _imAZ = _imColor = null;
        gHaloBar?.dispose?.(); gHaloBar = null;
        gArpBracket?.dispose?.(); gArpBracket = null;
        for (const m of mStr) m?.dispose?.();
        for (const m of mGlow) m?.dispose?.();
        for (const m of mSus) m?.dispose?.();
        for (const m of mStrHitOutline) m?.dispose?.();
        for (const m of mAccentOutline) m?.dispose?.();
        for (const m of mAccentCore) m?.dispose?.();
        for (const m of mAccentHaloNear) m?.dispose?.();
        for (const m of mAccentHaloMid) m?.dispose?.();
        for (const m of mAccentHaloFar) m?.dispose?.();
        mBeatM?.dispose?.(); mBeatQ?.dispose?.();
        // Notedetect outline materials (#9). May not be reachable
        // via scene.traverse if no event ever fired (never attached
        // to a mesh), so dispose explicitly.
        mMissOutline?.dispose?.();
        mHitSusOutline?.dispose?.();
        mEdgeTransparent?.dispose?.(); mEdgeTransparent = null;
        for (const m of mHitBright) m?.dispose?.(); mHitBright = []; mHitBrightArrays = [];
        _textSprites.dispose();
        // Shared pool-factory materials/geometries (mLaneOdd/Even, etc.) —
        // see _ownedSharedMats comment near the declaration. Dispose is
        // idempotent so the scene.traverse() pass above won't double-free.
        for (const m of _ownedSharedMats) m?.dispose?.();
        _ownedSharedMats.length = 0;
        for (const g of _ownedSharedGeos) g?.dispose?.();
        _ownedSharedGeos.length = 0;
        if (_sparkPts) { try { _sparkPts.geometry.dispose(); _sparkPts.material.dispose(); } catch (e) {} _sparkPts = null; }
        if (_composer) { try { _composer.dispose(); if (_bloomPass && _bloomPass.dispose) _bloomPass.dispose(); } catch (e) {} _composer = null; _bloomPass = null; }
        if (ren) { ren.dispose(); ren = null; }
        scene = cam = noteG = beatG = lblG = fretG = tuningLblG = null;
        ambLight = dirLight = null;
        mStr = []; mGlow = []; mSus = []; mStrHitOutline = []; mAccentOutline = []; mAccentCore = []; mAccentHaloNear = []; mAccentHaloMid = []; mAccentHaloFar = []; _accentShellsByString = []; mWhiteOutline = mSusOutline = null; mMissOutline = null; mHitSusOutline = null; stringLines = []; stringLineGlows = []; _boardPlaneMat = null; fretWireMats = []; fretTubeGeo?.dispose?.(); fretTubeGeo = null;
        for (const m of _inlayMats) m?.dispose?.(); _inlayMats = []; _inlayLabels = [];
        // mTapChevron: dispose explicitly — if no tap marker ever
        // spawned a pooled mesh, the scene.traverse() pass above never
        // reaches this material.
        mTapChevron?.dispose?.();
        mTapChevron = null;
        // mBarre is a shared material that all pBarreLine pool meshes
        // reference. If no barre chord ever appears, the pool factory
        // is never called, so no mesh carries mBarre into the scene
        // and scene.traverse() will miss it. Dispose explicitly here
        // to avoid leaking the GPU resource across panel lifecycles.
        // Three.js dispose() is idempotent, so calling it before or
        // after scene.traverse() is safe in both the instantiated and
        // uninstantiated cases.
        mBarre?.dispose?.(); mBarre = null;
        _paletteColorTmp = null;
        lyricsCanvas = lyricsCtx = null;
        projMeshArr = null;
        _probe = null;
        _drawNextByString = null; _drawRecentByString = null;
        _susVerdictLatch.clear();
        _drawChordTemplates = null;
        _laneTargetColor = null;
        _renderScale = 1;
        mBeatM = mBeatQ = null;
        pNote = pNoteEdge = pSus = pSusOutline = pSusRibbon = pSusRibbonOl = pLbl = pBeat = pSec = null;
        pFretLbl = pLane = pLaneDivider = pGhostFretLbl = pChordBox = pChordFrameFill = pChordLbl = pBarreLine = pArpBracket = pNoteFretLabel = pConnectorLine = pDropLine = pTapChevron = pAccentHalo = pHaloBar = pPMXFill = pFHXFill = pMuteXLines = pFHXLines = pTeachMarkLbl = null;
        if (gPMXFill) { gPMXFill.dispose(); gPMXFill = null; }
        if (gFHXFill) { gFHXFill.dispose(); gFHXFill = null; }
        if (gPMXLines) { gPMXLines.dispose(); gPMXLines = null; }
        if (gFHXLines) { gFHXLines.dispose(); gFHXLines = null; }
        mLaneOdd = mLaneEven = mLaneDivider = mLaneDividerArp = gLanePlane = gGhostFretPlane = null;
        chordFrameGradTex = chordFrameGradTexArp = null;
        pFretColMarker = null;
        _fretMarkerWaveCache.clear();
        gNote = gSus = gBeat = gTapChevron = null;
        tgtX = curX = xFretMid(CAM_LOCK_CENTER_FRET); tgtDist = curDist = CAM_DIST_BASE; tgtLookY = curLookY = 0; _fretRowFitBoost = 1; nStr = NSTR; _chartAnalysis.setStringCount(nStr); _chartAnalysis.rearmOobWarning();
        _lookaheadCamX = xFretMid(CAM_LOCK_CENTER_FRET);
        _lookaheadFretSpan = DEFAULT_LOOKAHEAD_FRET_SPAN;
        _lookaheadCamPrevNow = null;
        _lookaheadLowBonusU = 0;
        _lookaheadHiNeckLatch = false;
        _measureStarts = []; _measureStartsRef = null;
        _clkAudioT = NaN; _clkPerf = NaN; _clkRate = 1; _frameNow = 0;
        prevLowFretBonus = 0;
        prevLockActive = false;
        _camSnapped = false;
        _camPreScanned = false;
        _songKey = null;
        _slideTargetSet = null;
        _slideTargetNotesRef = null;
        _slideTargetChordsRef = null;
    }

    function canvasSize(canvas) {
        if (canvas) {
            // If the canvas has zero bounds (hidden via any mechanism — inline style,
            // CSS class, or hidden ancestor) fall back to the parent container
            // (the splitscreen panelDiv) which is always visible and correctly sized.
            const rect = canvas.getBoundingClientRect();
            const target = (rect.width === 0 || rect.height === 0) && canvas.parentNode ? canvas.parentNode : canvas;
            const sz = target === canvas ? rect : target.getBoundingClientRect();
            if (sz.width > 0 && sz.height > 0) return { w: sz.width, h: sz.height };
        }
        // Reserve the full bottom area: #player-footer wraps the Section
        // Practice bar + #player-controls. Fall back to #player-controls.
        const ch = (document.getElementById('player-footer')
            || document.getElementById('player-controls'))?.offsetHeight || 50;
        return { w: innerWidth, h: innerHeight - ch };
    }

    /* ── setRenderer contract ────────────────────────────────────────── */
    return {
        // Tells highway.js this renderer needs a webgl2-capable canvas.
        // Browsers lock a <canvas> to the first context type acquired,
        // so when this renderer is installed mid-session highway.js
        // replaces the underlying <canvas> element so getContext('webgl2')
        // can succeed (see static/highway.js _replaceCanvas).
        contextType: 'webgl2',
        init(canvas, bundle) {
            _unsubscribeFocus();
            if (wrap || ren) {
                teardown();
            }
            _destroyed = _isReady = false;
            _isFocused = true;
            if (!_paneUid) _paneUid = _nextAspectPaneUid();   // fallback pane id (no-arrangement panes)
            _registerTunerShortcut();   // session-global tuner shortcut (self-guarded)
            const myToken = ++_initToken;
            highwayCanvas = canvas;
            _invertedCached = !!(bundle && bundle.inverted);
            _leftyCached = !!(bundle && bundle.lefty);
            _renderScale = (bundle && bundle.renderScale) || 1;
            // Per-render background opt-out. A plugin borrowing the highway as
            // a visualization can set bundle.bgReactive === false to suppress
            // the audio-reactive background for THIS instance only — without
            // writing the shared h3d_bg_* settings (which would also change the
            // host's own highway). Motivation: the reactive bg taps the core
            // <audio> element, and when another consumer already holds it the
            // setup throws + the cleanup AudioContext.close() is an audible
            // click — which a borrower that never taps <audio> (e.g. a
            // contained-playback practice plugin) inherits for no benefit.
            // Default behavior is unchanged when the field is absent.
            _bgReactiveOptOut = !!(bundle && bundle.bgReactive === false);

            if (_ssActive()) {
                window.feedBackSplitscreen.onFocusChange(_onFocusChange);
                _focusSubscribed = true;
            }

            // Async-ready contract (feedBack#36 readyPromise). Resolves
            // when Three.js loaded + scene initialised (_isReady = true).
            // Rejects on any async failure so highway.js can revert.
            let _resolveReady, _rejectReady;
            this.readyPromise = new Promise((res, rej) => {
                _resolveReady = res;
                _rejectReady = rej;
            });
            // Shared rejection for superseded init cycles (destroy() or a
            // newer init() started before this one completed). highway.js
            // ignores the rejection when the renderer is no longer active.
            const _rejectSuperseded = () => _rejectReady(new Error('superseded'));

            loadThree().then(() => {
                if (_destroyed || _initToken !== myToken) {
                    _rejectSuperseded();
                    return;
                }
                try {
                    nStr = resolveStringCount(bundle); _chartAnalysis.setStringCount(nStr);
                    _invertedForBoard = _invertedCached;
                    _leftyForBoard = _leftyCached;
                    if (!initScene()) { _unsubscribeFocus(); _rejectReady(new Error('initScene failed')); return; }
                    // Pre-compile shaders + upload deterministic label
                    // textures while the load spinner is still up; the
                    // chart-dependent half runs on first draw() (bundle
                    // arrays are only guaranteed populated post-ready).
                    _prewarmStatic();
                    _chartPrewarmed = false;
                    const sz = canvasSize(highwayCanvas);
                    // Mark ready before RAF so any resize(w,h) calls that arrive
                    // in the meantime (e.g. from sizeCanvases()) are applied directly.
                    _isReady = true;
                    _resolveReady();
                    _updateFocusState();
                    if (sz.w > 0 && sz.h > 0) {
                        applySize(sz.w, sz.h);
                    } else {
                        // Panel container not yet laid out (sizeCanvases() runs after
                        // initPanel() in the setup sequence). Retry each frame until
                        // the panelDiv has real dimensions.
                        (function retrySize() {
                            if (_destroyed || !_isReady) return;
                            const s = canvasSize(highwayCanvas);
                            if (s.w > 0 && s.h > 0) applySize(s.w, s.h);
                            else requestAnimationFrame(retrySize);
                        })();
                    }
                } catch (e) {
                    console.error('[3D-Hwy] init .then() threw:', e);
                    _isReady = false;
                    _unsubscribeFocus(); teardown();
                    _rejectReady(e);
                }
            }).catch(e => {
                if (_initToken !== myToken || _destroyed) {
                    _rejectSuperseded();
                    return;
                }
                console.error('[3D-Hwy] Three.js unavailable:', e);
                _unsubscribeFocus();
                _rejectReady(e);
            });
        },

        draw(bundle) {
            if (!_isReady) return;
            if (_ctxLost) return;   // GPU context lost (alt-tab / reset) — skip until restored
            if (!_chartPrewarmed) {
                _chartPrewarmed = true;
                _prewarmChart(bundle);
            }
            _invertedCached = !!bundle.inverted;
            _leftyCached = !!bundle.lefty;
            const newNStr = resolveStringCount(bundle);
            const newScale = bundle.renderScale || 1;
            const leftyChanged = _leftyCached !== _leftyForBoard;
            if (_invertedCached !== _invertedForBoard || leftyChanged || newNStr !== nStr) {
                if (newNStr !== nStr) {
                    _chartAnalysis.rearmOobWarning();
                    // Drop chord caches computed under the old string count
                    // so extended-range notes (string 6+) aren't left
                    // filtered out of cached shapes.
                    _resetStringDependentCaches();
                }
                if (leftyChanged) {
                    curX = -curX;
                    tgtX = -tgtX;
                    _lookaheadCamX = -_lookaheadCamX;
                }
                nStr = newNStr; _chartAnalysis.setStringCount(nStr);
                buildBoard();
                _invertedForBoard = _invertedCached;
                _leftyForBoard = _leftyCached;
            }
            if (newScale !== _renderScale) {
                _renderScale = newScale;
                const s = canvasSize(highwayCanvas);
                if (s.w > 0 && s.h > 0) applySize(s.w, s.h);
            }
            // Keep the render matched to the highway canvas's real box.
            // Two independent drifts to catch each frame:
            //  1. Backing store (canvas.width/height) changed out from under
            //     us — e.g. the splitscreen hw.resize override resizes the
            //     element but never calls renderer.resize(). Also re-sizes
            //     the lyrics overlay canvas via applySize().
            //  2. The CSS box (canvasSize()) drifted while the backing store
            //     held. #highway is flex:1, so its rendered height changes as
            //     the player layout settles right after a song opens — with
            //     no backing-store change and no window 'resize' event, so the
            //     check above never fires. Without this the camera stays framed
            //     for the pre-settle (too-tall) size and crops the near strings
            //     / fret numbers until the user un/re-maximizes the window.
            if (highwayCanvas) {
                // Backing-store drift (branch 1) is detected with cheap
                // property reads every frame. The CSS-box checks (branches
                // 2/3) need canvasSize() → getBoundingClientRect(), a
                // forced layout read — profiled at ~1.2% of throttled
                // main-thread time when run per frame. Throttle the box
                // read to every 10th frame (plus whenever the backing
                // store changed or the wrap isn't pinned yet): the layout
                // settle it exists to catch plays out over hundreds of ms
                // right after a song opens, so a ~166 ms detection cadence
                // loses nothing visible.
                const _bsChanged = highwayCanvas.width !== _lastHwW
                    || highwayCanvas.height !== _lastHwH;
                _boxCheckCountdown = (_boxCheckCountdown + 1) % 10;
                if (_bsChanged || !_wrapPinned || _boxCheckCountdown === 0) {
                    const box = canvasSize(highwayCanvas);
                    if (_bsChanged) {
                        _lastHwW = highwayCanvas.width;
                        _lastHwH = highwayCanvas.height;
                        if (box.w > 0 && box.h > 0) applySize(box.w, box.h);
                    } else if (box.w > 0 && box.h > 0 &&
                            (Math.abs(box.w - _appliedW) > 1 || Math.abs(box.h - _appliedH) > 1)) {
                        applySize(box.w, box.h);
                    } else if (!_wrapPinned && box.w > 0 && box.h > 0 &&
                            highwayCanvas.offsetWidth > 0 && highwayCanvas.offsetHeight > 0) {
                        //  3. The overlay pin couldn't be applied at init because
                        //     #highway had no layout yet (offsetWidth/Height === 0),
                        //     so applySize() only set the wrap height. The canvas has
                        //     now laid out but to the same logical size, so neither
                        //     drift branch above fires — re-run applySize to pin the
                        //     wrap to the canvas box now that its offsets are real.
                        //     Otherwise the overlay stays at top:0;left:0;right:0 and
                        //     a strip of #highway is exposed on first load / split.
                        applySize(box.w, box.h);
                    }
                }
            }
            update(bundle);
            camUpdate(bundle);

            // Background animations (#13). Compute frame dt once,
            // read audio bands when reactivity is on, delegate to
            // the active style's update().
            if (bgGroup && _bgEffectiveStyleId() !== 'off') {
                const nowMs = performance.now();
                const dt = _bgLastT === 0 ? 1 / 60 : Math.min(0.1, (nowMs - _bgLastT) / 1000);
                _bgLastT = nowMs;
                const bands = bgReactive ? _bgReadBands() : BG_ZERO_BANDS;
                const style = BG_STYLES[_bgEffectiveStyleId()];
                if (style && bgState) {
                    try { style.update(bgState, bands, dt, nowMs / 1000); }
                    catch (e) { console.error('[3D-Hwy] bg update threw', _bgEffectiveStyleId(), e); }
                }
            }

            {
                const _jNow = performance.now();
                const _jdt = _juiceLastT === 0 ? 1 / 60 : Math.min(0.05, (_jNow - _juiceLastT) / 1000);
                _juiceLastT = _jNow;
                _sparkUpdate(_jdt);
                _streakHeat += (Math.min(1, _streakHits / 16) - _streakHeat) * 0.08;   // #7 ease heat
            }
            {
                const comp = (_bloom && !_ssActive()) ? _bloomEnsure() : null;
                if (comp) {
                    const bsz = canvasSize(highwayCanvas);
                    if (bsz && bsz.w > 0 && bsz.h > 0 && (bsz.w !== _bloomW || bsz.h !== _bloomH)) {
                        comp.setSize(bsz.w | 0, bsz.h | 0); _bloomW = bsz.w | 0; _bloomH = bsz.h | 0;
                    }
                    if (ren.toneMapping !== T.ACESFilmicToneMapping) ren.toneMapping = T.ACESFilmicToneMapping;
                    pbBeg(6); comp.render(); pbEnd(6);
                } else {
                    if (ren.toneMapping !== T.NoToneMapping) ren.toneMapping = T.NoToneMapping;
                    pbBeg(6); ren.render(scene, cam); pbEnd(6);
                }
            }
            if (lyricsCtx && lyricsCanvas) {
                lyricsCtx.clearRect(0, 0, lyricsCanvas.width, lyricsCanvas.height);
                // Capture the actual lyrics-banner bottom so overlay cards
                // step down past every wrapped row, not just a 2-row estimate.
                let lyricsBottom = 0;
                if (bundle.lyricsVisible && bundle.lyrics?.length) {
                    lyricsBottom = drawLyrics(bundle.lyrics, bundle.currentTime, lyricsCtx, lyricsCanvas.width, lyricsCanvas.height) || 0;
                }
                drawNotedetectLabels(lyricsCtx, lyricsCanvas.width, lyricsCanvas.height);
                drawScoreFx(lyricsCtx, lyricsCanvas.width, lyricsCanvas.height);

                // Corner-stacking: overlays drawn first claim the topmost slot;
                // later overlays are pushed down by the accumulated height + gap.
                // Draw order (top → bottom per corner):
                //   1. FPS counter  — always first
                //   2. Section HUD
                //   3. Tone HUD
                //   4. Chord diagram — always last
                const STACK_GAP = 8;
                const cornerStack = { tl: 0, tr: 0, bl: 0, br: 0 };
                const stackPush = (pos, h) => {
                    if (pos in cornerStack && h > 0) cornerStack[pos] += h + STACK_GAP;
                };

                // 1. FPS counter (always top-right, always topmost).
                // EMA update runs unconditionally so the smoothed value is accurate
                // even when fpsVisible is off.
                const _fpsNowMs = performance.now();
                if (_fpsLastT > 0) {
                    const dt = _fpsNowMs - _fpsLastT;
                    if (dt > 0) {
                        const inst = 1000 / dt;
                        _fpsEma = _fpsEma === 0 ? inst : _fpsEma + (inst - _fpsEma) * (1 / 30);
                    }
                }
                _fpsLastT = _fpsNowMs;
                if (fpsVisible) {
                    if (_fpsNowMs - _fpsLastSampleT > 250) {
                        _fpsDisplay = _fpsEma;
                        _fpsLastSampleT = _fpsNowMs;
                    }
                    const W = lyricsCanvas.width;
                    const H = lyricsCanvas.height;
                    const txt = _fpsDisplay.toFixed(1) + ' fps';
                    lyricsCtx.save();
                    lyricsCtx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
                    lyricsCtx.textAlign = 'right';
                    lyricsCtx.textBaseline = 'top';
                    const _fpsPadX = 8, _fpsPadY = 4;
                    const _fpsMetrics = lyricsCtx.measureText(txt);
                    const _fpsBoxW = Math.ceil(_fpsMetrics.width) + _fpsPadX * 2;
                    const _fpsBoxH = 14 + _fpsPadY * 2;
                    const _fpsE = 8;
                    // Keep it top-right but below the v3 Up Next pill / live HUD
                    // (whichever is showing) so the readout is never occluded.
                    const _fpsBaseY = Math.round(Math.max(
                        _fpsE + H * 0.06,
                        lyricsBottom + _fpsE,
                        _v3TopRightChromeBottom() + _fpsE,
                    ));
                    const _fpsX = W - 8 - _fpsBoxW;
                    const _fpsY = _fpsBaseY + cornerStack['tr'];
                    lyricsCtx.fillStyle = 'rgba(0,0,0,0.55)';
                    lyricsCtx.fillRect(_fpsX, _fpsY, _fpsBoxW, _fpsBoxH);
                    lyricsCtx.fillStyle = _fpsDisplay >= 55 ? '#7fff9a'
                        : _fpsDisplay >= 30 ? '#ffe84d' : '#ff6b6b';
                    lyricsCtx.fillText(txt, _fpsX + _fpsBoxW - _fpsPadX, _fpsY + _fpsPadY);
                    lyricsCtx.restore();
                    stackPush('tr', _fpsBoxH);
                }

                // 2. Section HUD.
                if (sectionHudVisible && bundle.sections && bundle.sections.length) {
                    const secH = drawSectionHud(lyricsCtx, {
                        sections: bundle.sections,
                        currentTime: bundle.currentTime,
                        canvasW: lyricsCanvas.width, canvasH: lyricsCanvas.height,
                        position: sectionHudPosition,
                        sizeSlider: sectionHudSize,
                        lyricsBottom,
                        stackOffset: cornerStack[sectionHudPosition] || 0,
                    });
                    stackPush(sectionHudPosition, secH);
                }

                // 3. Tone HUD.
                if (toneHudVisible && (bundle.toneChanges?.length || bundle.toneBase)) {
                    const toneH = drawToneHud(lyricsCtx, {
                        toneChanges: bundle.toneChanges,
                        toneBase: bundle.toneBase,
                        currentTime: bundle.currentTime,
                        canvasW: lyricsCanvas.width, canvasH: lyricsCanvas.height,
                        position: toneHudPosition,
                        sizeSlider: toneHudSize,
                        lyricsBottom,
                        stackOffset: cornerStack[toneHudPosition] || 0,
                    });
                    stackPush(toneHudPosition, toneH);
                }

                // 4. Chord diagram — always last (bottommost in the stack).
                // Draw outgoing first so the incoming diagram renders on top,
                // making the entrance scale-in animation visible during crossfades.
                // The outgoing (prev) diagram uses the same corner slot — it is
                // fading out while the incoming one fades in, so they share the
                // same stack position and don't double-count the height.
                if (chordDiagramVisible && _diagPrev && _diagPrevOpacity > 0) {
                    _drawDiagramCached(lyricsCtx, {
                        name: _diagPrev.name, frets: _diagPrev.frets,
                        opacity: _diagPrevOpacity,
                        entranceT: (_diagPrev.t !== undefined)
                            ? Math.min(1.0, Math.max(0, (bundle.currentTime - _diagPrev.t) / DIAG_ENTRANCE_S))
                            : 1.0,
                        canvasW: lyricsCanvas.width, canvasH: lyricsCanvas.height,
                        inverted: _invertedCached,
                        sizeSlider: chordDiagramSize, position: chordDiagramPosition,
                        nStr: _diagPrev.nStr ?? nStr,
                        lyricsBottom,
                        stackOffset: cornerStack[chordDiagramPosition] || 0,
                    });
                    // Don't push here — outgoing and incoming share the same slot.
                }
                if (chordDiagramVisible && _diagChord) {
                    const diagH = _drawDiagramCached(lyricsCtx, {
                        name: _diagChord.name, frets: _diagChord.frets,
                        opacity: Math.max(0, 1 + (_diagChord.t - bundle.currentTime) / DIAG_LINGER_S),
                        entranceT: _diagEntranceT,
                        canvasW: lyricsCanvas.width, canvasH: lyricsCanvas.height,
                        inverted: _invertedCached,
                        sizeSlider: chordDiagramSize, position: chordDiagramPosition,
                        nStr: _diagChord.nStr ?? nStr,
                        lyricsBottom,
                        stackOffset: cornerStack[chordDiagramPosition] || 0,
                    });
                    stackPush(chordDiagramPosition, diagH);
                }
            }
            // Draw-hook compatibility: fire hooks registered via
            // window.highway.addDrawHook() on our 2D overlay canvas
            // so overlay plugins (fretboard, chord-label HUDs, etc.)
            // continue to render when the 3D renderer is active.
            // The hooks expect a 2D context — lyricsCtx is exactly
            // that, positioned above the WebGL surface.
            if (lyricsCtx && lyricsCanvas &&
                    window.highway &&
                    typeof window.highway.fireDrawHooks === 'function') {
                window.highway.fireDrawHooks(
                    lyricsCtx, lyricsCanvas.width, lyricsCanvas.height
                );
            }
        },

        resize(w, h) {
            if (!_isReady) return;
            const s = canvasSize(highwayCanvas);
            applySize(s.w > 0 ? s.w : w, s.h > 0 ? s.h : h);
        },

        destroy() {
            _destroyed = true; _isReady = false; _diagChord = null; _diagPrev = null; _diagLastKey = null; _diagRenderCache.clear();
            _lastHwW = 0; _lastHwH = 0;
            _appliedW = 0; _appliedH = 0;
            _paneAspect = 0;
            if (cam && cam.fov !== BASE_VFOV) { cam.fov = BASE_VFOV; cam.updateProjectionMatrix(); }
            _wrapPinned = false;
            _unsubscribeFocus(); teardown();
            highwayCanvas = null;
        },
    };
}

window.feedBackViz_highway_3d = createFactory;
// Per-panel control descriptors (splitscreen). The palette selector was
// removed — per-string colors are set via the core "Highway String Colors"
// UI, which drives both highways by named string.
window.feedBackViz_highway_3d.panelControls = [
    {
        key: 'cameraSmoothing',
        label: 'Camera smoothing (X-pan)',
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        default: BG_DEFAULTS.cameraSmoothing,
    },
    {
        key: 'cameraLockLow',
        label: 'Lock camera at frets 1-12',
        type: 'toggle',
        default: BG_DEFAULTS.cameraLockLow,
    },
    {
        key: 'cameraLockZoom',
        label: 'Locked zoom (In ↔ Out)',
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        default: BG_DEFAULTS.cameraLockZoom,
    },
];
// Static metadata exposed on the factory:
//   panelControls      - optional, host-readable descriptors for a
//                        curated per-panel control surface. Renderer
//                        values still flow through _bgLoadSettings().
//   contextType        - required canvas context type. highway.js
//                        replaces the <canvas> element when the
//                        requested type differs from the current one,
//                        so this renderer can be installed mid-session
//                        even if the canvas was previously bound to 2D.
//   matchesArrangement - Auto-mode predicate. When the picker is on
//                        "Auto", core installs the first registered
//                        viz whose predicate returns truthy on the
//                        current song_info. Lead/Rhythm/Bass/Guitar
//                        arrangements route here; Keys arrangements
//                        are matched by the piano plugin instead.
//                        _canRun3D() in app.js still gates Auto from
//                        picking us on machines without WebGL2.
window.feedBackViz_highway_3d.contextType = 'webgl2';
window.feedBackViz_highway_3d.__test = {
    getAnalyserForBridgeTest: _bgGetAnalyser,
    readBandsForBridgeTest: _bgReadBands,
    resetAnalyserBridgeForTest() { _bgResetAnalyserBridgeForTest(); },
};
// Canonical guitar arrangement names (server.py: _ALLOWED_ARRANGEMENT_NAMES)
// are Lead / Rhythm / Bass / Combo. `guitar` is included as a safety
// net for sources that use a generic name (older imports, third-party
// sloppaks). Word boundaries (\b) keep us from accidentally matching
// arrangements that merely contain these as substrings (e.g. a
// "BasslineKeys" arrangement would otherwise match `bass`).
window.feedBackViz_highway_3d.matchesArrangement = function (songInfo) {
    const arr = (songInfo && songInfo.arrangement) || '';
    return /\b(?:lead|rhythm|bass|combo|guitar)\b/i.test(arr);
};

// No imperative register() call needed: feedBack#272 introduced the
// consolidated tour menu, which discovers this plugin's tour automatically
// via /api/plugins (has_tour:true from plugin.json's tour field) and
// gates relevance on whether highway_3d is the active viz. A register()
// call with only injectTriggerInto was a no-op anyway since the new menu
// owns trigger placement; for buildSteps / onStart / onComplete / a
// custom screens override, register() is still the right hook.
