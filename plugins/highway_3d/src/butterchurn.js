// Butterchurn (MilkDrop) audio-reactive background: library loading, the
// desktop guitar-PCM feed, settings, the preset panel, and the per-panel
// controller. Self-contained; talks to the rest of the plugin via
// window.h3dBcApplySettings and the exported controller registry.

/* ── Butterchurn audio-reactive background ──────────────────────────
 * Mounts a Butterchurn (WebGL MilkDrop) canvas BEHIND the transparent
 * 3D highway. On desktop it's driven by the guitar/mic input (the song
 * audio lives in JUCE, not the webview <audio>); in a browser it taps
 * the song <audio> directly.
 * ──────────────────────────────────────────────────────────────────── */
const BC_VENDOR = '/api/plugins/highway_3d/assets/vendor/';
const BC_FRAME = 1024;
const BC_WORKLET = '/api/plugins/highway_3d/assets/viz-worklet.js';
const _bcMeters = { gtr: 0, song: 0 }; // live levels shown in the panel readout
const BC_BTN = 'background:rgba(255,255,255,.09);color:#cfe3ff;border:1px solid rgba(255,255,255,.16);border-radius:5px;padding:3px 8px;cursor:pointer;font:12px system-ui';
let _bcLoading = null;
function _bcLoadLib() {
    if (_bcLoading) return _bcLoading;
    _bcLoading = new Promise((resolve, reject) => {
        const add = (url, next) => {
            const s = document.createElement('script');
            s.src = url; s.async = true;
            s.onload = next; s.onerror = () => reject(new Error('load ' + url));
            document.head.appendChild(s);
        };
        add(BC_VENDOR + 'butterchurn.min.js', () =>
            add(BC_VENDOR + 'butterchurnPresets.min.js', resolve));
    });
    // Don't cache a rejected promise: a transient load failure (network
    // hiccup, blocked request) must not permanently disable the feature for
    // the session. Clearing _bcLoading lets the next mount retry the load.
    _bcLoading.catch(() => { _bcLoading = null; });
    return _bcLoading;
}
function _bcResolve() { let b = window.butterchurn; if (b && b.default) b = b.default; return b; }
function _bcPresets() { let p = window.butterchurnPresets; if (p && p.default) p = p.default; return p; }
export function _bcIsDesktop() {
    const d = window.feedBackDesktop || window.slopsmithDesktop;
    return !!(d && d.isDesktop && d.audio && typeof d.audio.getRawAudioFrame === 'function');
}
// Fast-forward an index to the first entry after time `ct` (used on seek/loop).
// Position at the first entry whose time is >= ct (strict <), so an event
// landing exactly on the seek/loop target time is still fired by the update
// walkers (which consume `<= ct`) instead of being skipped past here.
export function _bcFfIdx(arr, ct, key) { if (!arr) return 0; let i = 0; while (i < arr.length && (arr[i][key] || 0) < ct) i++; return i; }
// Force-free a canvas's WebGL context so the GPU resources are released
// immediately instead of lingering until GC — repeated Butterchurn
// mount/unmount cycles otherwise pile up live contexts toward the browser cap.
function _bcReleaseCanvasGL(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    let gl = null;
    try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); } catch (e) { gl = null; }
    if (!gl || typeof gl.getExtension !== 'function') return;
    try { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (e) {}
}

// Desktop: bridge GUITAR input PCM + SONG output level into a Web Audio node
// Butterchurn can tap. Guitar gives spectral texture from your playing; the
// song's output meter (getLevels) injects an energy pulse so the visuals also
// react to the backing track (JUCE plays it — there's no song PCM to FFT).
function _bcGuitarFeed(actx, onReady) {
    const latest = new Float32Array(BC_FRAME);
    let polling = true, songLevel = 0, chartLevel = 0;
    let node = null, sp = null, silent = null;
    const api = (window.feedBackDesktop || window.slopsmithDesktop).audio;
    const gainNow = () => (_bcLoadSettings().guitarGain) || 6;

    // Keep the source node processing (silently — JUCE already monitors the
    // guitar), and hand it to Butterchurn via the onReady callback.
    function attach(srcNode) {
        silent = actx.createGain(); silent.gain.value = 0;
        srcNode.connect(silent); silent.connect(actx.destination);
        try { if (onReady) onReady(srcNode); } catch (e) {}
    }
    // Fallback for contexts without AudioWorklet support.
    function useScriptProcessor() {
        let phase = 0, phase2 = 0;
        const TWO_PI = Math.PI * 2;
        const oscStep = TWO_PI * (90 / actx.sampleRate);
        const oscStep2 = TWO_PI * (520 / actx.sampleRate);
        sp = actx.createScriptProcessor(BC_FRAME, 1, 1);
        sp.onaudioprocess = (e) => {
            const out = e.outputBuffer.getChannelData(0);
            const n = Math.min(out.length, latest.length);
            const lvl = songLevel, clvl = chartLevel, gg = gainNow();
            for (let i = 0; i < out.length; i++) {
                const g = (i < n ? latest[i] : 0) * gg;
                const song = lvl * (0.7 * Math.sin(phase) + 0.3 * (Math.random() * 2 - 1)) * 1.4;
                const chart = clvl * (0.5 * Math.sin(phase2) + 0.5 * (Math.random() * 2 - 1)) * 1.5;
                phase += oscStep; if (phase > TWO_PI) phase -= TWO_PI;
                phase2 += oscStep2; if (phase2 > TWO_PI) phase2 -= TWO_PI;
                const v = g + song + chart;
                out[i] = v > 1 ? 1 : (v < -1 ? -1 : v);
            }
        };
        attach(sp);
        console.log('[viz3d] audio feed: ScriptProcessor (fallback)');
    }

    // Preferred path: AudioWorklet (runs off the main thread).
    if (actx.audioWorklet && typeof actx.audioWorklet.addModule === 'function' && typeof AudioWorkletNode === 'function') {
        actx.audioWorklet.addModule(BC_WORKLET).then(() => {
            if (!polling || sp) return;
            node = new AudioWorkletNode(actx, 'viz-feed', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
            attach(node);
            console.log('[viz3d] audio feed: AudioWorklet');
        }).catch((e) => {
            console.warn('[viz3d] AudioWorklet unavailable, using ScriptProcessor:', e && e.message);
            if (polling && !sp && !node) useScriptProcessor();
        });
    } else {
        useScriptProcessor();
    }

    // Guitar PCM poll → waveform + level meter (+ pushed to the worklet).
    (function pcmLoop() {
        if (!polling) return;
        Promise.resolve(api.getRawAudioFrame(BC_FRAME)).then((f) => {
            if (f && f.length) {
                if (f.length >= BC_FRAME) latest.set(f.subarray(0, BC_FRAME));
                else { latest.fill(0); latest.set(f); }
                let s = 0; for (let i = 0; i < BC_FRAME; i++) s += latest[i] * latest[i];
                _bcMeters.gtr = Math.sqrt(s / BC_FRAME) * gainNow();
                if (node) node.port.postMessage({ frame: latest.slice(0), song: songLevel, chart: chartLevel, gain: gainNow() });
            }
        }).catch(() => {}).then(() => { if (polling) setTimeout(pcmLoop, 16); });
    })();
    // Song output meter poll → music energy pulse.
    (function levelLoop() {
        if (!polling) return;
        Promise.resolve(api.getLevels && api.getLevels()).then((L) => {
            if (L && typeof L.outputLevel === 'number') {
                songLevel = Math.min(1, L.outputLevel * ((_bcLoadSettings().songGain) || 1.8));
                _bcMeters.song = songLevel;
                if (node) node.port.postMessage({ song: songLevel, chart: chartLevel, gain: gainNow() });
            }
        }).catch(() => {}).then(() => { if (polling) setTimeout(levelLoop, 40); });
    })();

    return {
        setChart(v) { chartLevel = v; },
        stop() {
            polling = false;
            try { if (sp) { sp.disconnect(); sp.onaudioprocess = null; } } catch (e) {}
            try { if (node) node.disconnect(); } catch (e) {}
            try { if (silent) silent.disconnect(); } catch (e) {}
        }
    };
}
// Browser audio is sourced by REUSING the highway's own shared analyser
// (the same #audio / stems side-chain tap the fog scenery uses), passed in
// as `audioProvider` to _bcCreateController. We deliberately do NOT open a
// second createMediaElementSource on #audio here: it can only be called
// once per element (a second tap throws InvalidStateError and permanently
// disables the other consumer), it would route the song through a fresh,
// possibly-suspended context and mute playback, and it would miss the stems
// side-chain that sloppaks expose at window.feedBack.stems.getAnalyser().
/* ── Controls + readability (localStorage-backed, global config) ───── */
const BC_LS = 'viz3d_settings';
const BC_DEFAULTS = { enabled: true, opacity: 1.0, laneDim: true, laneDimStrength: 0.45, chartAccents: true, colorTint: true, chartStrength: 1.0, tintStrength: 0.65, guitarGain: 6, songGain: 1.8, cyclePool: 'all', hold: false };
let _bcSettings = null;
export function _bcLoadSettings() {
    if (_bcSettings) return _bcSettings;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(BC_LS) || '{}'); } catch (e) {}
    _bcSettings = Object.assign({}, BC_DEFAULTS, saved);
    return _bcSettings;
}
function _bcSaveSettings() { try { localStorage.setItem(BC_LS, JSON.stringify(_bcSettings)); } catch (e) {} }
const _bcControllers = new Set();
function _bcApplyAll() { _bcControllers.forEach((c) => { try { c.applySettings(); } catch (e) {} }); }
// Live-apply hook for the plugin's settings.html. The visualizer's on/off +
// slider controls now live in the standard settings panel (settings.html),
// which persists them into the BC_LS blob and then calls this so a mounted
// highway re-reads and applies them immediately. Defined on window at module
// scope so it's available regardless of whether a highway is mounted yet;
// settings.html guards the call with `?.` for the not-yet-loaded case.
window.h3dBcApplySettings = function () {
    _bcSettings = null;        // drop the cache so the next read reloads from localStorage
    _bcLoadSettings();
    _bcApplyAll();
    try { _bcUpdatePanelPreset(); } catch (e) {}
};

// Preset curation: favorites / bans (persisted globally) + the "primary"
// controller the panel's preset buttons drive.
// Seeded once on first run (reputation-based starter set; user can edit freely).
const BC_DEFAULT_FAVORITES = [
    'Flexi, martin + geiss - dedicated to the sherwin maxawow',
    'Geiss - Reaction Diffusion 2',
    'Geiss - Spiral Artifact',
    'Flexi + Martin - cascading decay swing',
    'Flexi - mindblob [shiny mix]',
    'Geiss - Cauldron - painterly 2 (saturation remix)',
    'Zylot - Paint Spill (Music Reactive Paint Mix)',
    'Flexi - predator-prey-spirals',
    'Rovastar + Loadus + Geiss - FractalDrop (Triple Mix)',
    'Flexi, fishbrain, Geiss + Martin - tokamak witchery',
];
const BC_DEFAULT_BANS = [
    'martin - mucus cervix',
    'Goody - The Wild Vort',
    'martin - extreme heat',
    'Unchained - Rewop',
    'high-altitude basket unraveling - singh grooves nitrogen argon nz+',
    '$$$ Royal - Mashup (197)',
    '$$$ Royal - Mashup (431)',
    'suksma - uninitialized variabowl (hydroponic chronic)',
    'shifter - dark tides bdrv mix 2',
    '_Mig_049',
];
const _bcFavorites = new Set();
const _bcBanned = new Set();
let _bcListsLoaded = false;
function _bcLoadLists() {
    if (_bcListsLoaded) return; _bcListsLoaded = true;
    try { (JSON.parse(localStorage.getItem('viz3d_favorites') || '[]') || []).forEach((n) => _bcFavorites.add(n)); } catch (e) {}
    try { (JSON.parse(localStorage.getItem('viz3d_banned') || '[]') || []).forEach((n) => _bcBanned.add(n)); } catch (e) {}
    let seeded = false;
    try { seeded = !!localStorage.getItem('viz3d_seeded'); } catch (e) {}
    if (!seeded) {
        BC_DEFAULT_FAVORITES.forEach((n) => _bcFavorites.add(n));
        BC_DEFAULT_BANS.forEach((n) => _bcBanned.add(n));
        try { localStorage.setItem('viz3d_seeded', '1'); } catch (e) {}
        _bcSaveLists();
    }
}
function _bcSaveLists() {
    try { localStorage.setItem('viz3d_favorites', JSON.stringify([..._bcFavorites])); } catch (e) {}
    try { localStorage.setItem('viz3d_banned', JSON.stringify([..._bcBanned])); } catch (e) {}
}
// Re-add the bundled defaults anytime (merges; a default-fav un-bans, a default-ban un-favs).
function _bcRestoreDefaults() {
    BC_DEFAULT_FAVORITES.forEach((n) => { _bcBanned.delete(n); _bcFavorites.add(n); });
    BC_DEFAULT_BANS.forEach((n) => { _bcFavorites.delete(n); _bcBanned.add(n); });
    try { localStorage.setItem('viz3d_seeded', '1'); } catch (e) {}
    _bcSaveLists(); _bcUpdatePanelPreset(); _bcRenderList();
}
let _bcPrimary = null;
let _bcPane = null, _bcListEl = null, _bcFilterEl = null, _bcPaneOpen = false, _bcCollapsed = false;

function _bcStatusMark(name) {
    return _bcFavorites.has(name) ? '★ ' : (_bcBanned.has(name) ? '🚫 ' : '');
}
function _bcSetHold(v) {
    const s = _bcLoadSettings();
    s.hold = !!v; _bcSaveSettings();
    const b = _bcPanel && _bcPanel.querySelector('#vz-hold');
    if (b) b.textContent = s.hold ? '▶ Resume' : '⏸ Hold';
}
// Drives both panels off the right edge. Order when both open (L→R):
//   visualizer panel → preset pane → window edge. Pane lives off-screen by
//   default; opening it shoves the panel LEFT to make room.
function _bcLayout() {
    if (_bcPanel) {
        let tx = 0;
        if (_bcCollapsed) tx = 210;        // tuck the whole panel off the right edge
        else if (_bcPaneOpen) tx = -248;   // slide panel LEFT to make room for the pane
        _bcPanel.style.transform = 'translateX(' + tx + 'px) translateY(-50%)';
    }
    if (_bcPane) {
        _bcPane.style.transform = (_bcPaneOpen && !_bcCollapsed) ? 'translateX(0) translateY(-50%)' : 'translateX(calc(100% + 16px)) translateY(-50%)';
    }
}
function _bcSetPane(open) {
    _bcPaneOpen = !!open && !_bcCollapsed;
    const b = _bcPanel && _bcPanel.querySelector('#vz-listbtn');
    if (b) b.textContent = _bcPaneOpen ? '>>' : '<<';
    if (_bcPaneOpen) _bcRenderList();
    _bcLayout();
}
function _bcRenderList() {
    if (!_bcListEl) return;
    const ctrl = _bcPrimary;
    const keys = (ctrl && ctrl.keys) ? ctrl.keys : [];
    const filt = ((_bcFilterEl && _bcFilterEl.value) || '').toLowerCase();
    const cur = ctrl && ctrl.curName;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < keys.length; i++) {
        const name = keys[i];
        if (filt && name.toLowerCase().indexOf(filt) === -1) continue;
        const row = document.createElement('div');
        row.textContent = _bcStatusMark(name) + name;
        row.title = name;
        row.style.cssText = 'padding:3px 7px;border-radius:4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;' +
            (name === cur ? 'background:rgba(110,160,255,.28);' : '') + (_bcBanned.has(name) ? 'opacity:.55;' : '');
        row.addEventListener('click', () => {
            if (!_bcPrimary) return;
            _bcPrimary.loadByName(name, 1.0);
            _bcSetHold(true); // picked from the list → sit on it
        });
        frag.appendChild(row);
    }
    _bcListEl.innerHTML = '';
    _bcListEl.appendChild(frag);
}
function _bcUpdatePanelPreset() {
    if (!_bcPanel) return;
    const name = _bcPrimary ? (_bcPrimary.curName || null) : null;
    const nameEl = _bcPanel.querySelector('#vz-pname');
    const favBtn = _bcPanel.querySelector('#vz-fav');
    const banBtn = _bcPanel.querySelector('#vz-ban');
    const cntEl = _bcPanel.querySelector('#vz-pcount');
    if (nameEl) { nameEl.textContent = (name ? _bcStatusMark(name) : '') + (name || '—'); nameEl.title = name ? (name + ' — click for full list') : ''; }
    if (favBtn) favBtn.textContent = (name && _bcFavorites.has(name)) ? '★ Favorited' : '☆ Favorite';
    if (banBtn) banBtn.textContent = (name && _bcBanned.has(name)) ? '🚫 Banned' : '🚫 Ban';
    if (cntEl) cntEl.textContent = '★ ' + _bcFavorites.size + '   🚫 ' + _bcBanned.size;
    if (_bcPaneOpen) _bcRenderList();
}

let _bcPanel = null, _bcPanelKeyBound = false;
function _bcEnsurePanel(host) {
    if (_bcPanel && _bcPanel.isConnected) {
        // Singleton panel: follow the active highway. If it's still parented
        // to a different wrap (e.g. another mounted highway instance such as
        // Virtuoso's embedded one), move it — and the pane — to this wrap so
        // it appears on whichever highway is currently on-screen.
        if (host && _bcPanel.parentNode !== host) {
            host.appendChild(_bcPanel);
            if (_bcPane) host.appendChild(_bcPane);
        }
        return _bcPanel;
    }
    const s = _bcLoadSettings();
    const p = document.createElement('div');
    p.id = 'viz3d-panel';
    p.style.cssText = 'position:absolute;top:50%;right:10px;z-index:100000;pointer-events:auto;font:12px/1.45 system-ui,sans-serif;' +
        'color:#cfe3ff;background:rgba(8,10,20,0.82);padding:9px 11px;border-radius:8px;width:186px;' +
        'box-shadow:0 2px 12px rgba(0,0,0,0.5);user-select:none;transition:transform 0.28s ease;';
    p.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px"><span style="font-weight:600">🌀 Visualizer</span><button id="vz-listbtn" title="Show / hide full preset list" style="' + BC_BTN + ';padding:1px 7px">&lt;&lt;</button></div>' +
        // On/off + opacity/dim/chart/tint/gain controls now live in the
        // plugin's Settings panel (settings.html). This in-canvas panel is
        // only the LIVE preset browser (pick / favorite / ban / cycle).
        '<div style="opacity:.55;font-size:11px;margin:2px 0 6px">Background &amp; reactivity options are in Settings ▸ 3D Highway.</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin:4px 0">' +
          '<button id="vz-prev" style="' + BC_BTN + '">◀</button>' +
          '<div id="vz-pname" style="flex:1;text-align:center;font-size:11px;opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" title="">—</div>' +
          '<button id="vz-next" style="' + BC_BTN + '">▶</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;margin:4px 0">' +
          '<button id="vz-fav" style="' + BC_BTN + ';flex:1">♡ Favorite</button>' +
          '<button id="vz-ban" style="' + BC_BTN + ';flex:1">🚫 Ban</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:flex-end;margin:6px 0">' +
          '<label style="flex:1">Cycle <select id="vz-cyc" style="width:100%;background:#11141f;color:#cfe3ff;border:1px solid rgba(255,255,255,.15);border-radius:5px;padding:3px"><option value="all">All</option><option value="favorites">Favorites</option><option value="bans">Bans</option></select></label>' +
          '<button id="vz-hold" style="' + BC_BTN + '">⏸ Hold</button>' +
        '</div>' +
        '<div style="margin:5px 0 4px;font-size:11px;opacity:.75"><span id="vz-pcount">★ 0   🚫 0</span></div>' +
        '<div id="vz-meter" style="opacity:.65;margin-top:6px;font:11px/1.3 monospace">gtr —  ·  song —</div>' +
        '<div style="opacity:.45;margin-top:4px;font-size:11px">` or ‹‹ to hide</div>';
    (host || document.body).appendChild(p);

    // Slide handle (<< / >>) so the panel can tuck off the right edge and stop
    // covering the Now / Up-Next labels.
    const tab = document.createElement('button');
    tab.textContent = '>>';
    tab.title = 'Hide / show controls';
    tab.style.cssText = 'position:absolute;top:6px;left:-23px;width:23px;height:28px;border:none;cursor:pointer;' +
        'background:rgba(8,10,20,0.82);color:#cfe3ff;border-radius:7px 0 0 7px;font:12px/1 monospace;padding:0;';
    p.appendChild(tab);
    tab.addEventListener('click', () => {
        _bcCollapsed = !_bcCollapsed;
        if (_bcCollapsed) _bcPaneOpen = false; // collapsing the panel hides the pane too
        tab.textContent = _bcCollapsed ? '<<' : '>>';
        const lb = p.querySelector('#vz-listbtn'); if (lb) lb.textContent = _bcPaneOpen ? '>>' : '<<';
        _bcLayout();
    });

    // Sliding preset-list pane (sits to the LEFT of the control panel)
    const pane = document.createElement('div');
    pane.id = 'viz3d-listpane';
    pane.style.cssText = 'position:absolute;top:50%;right:10px;z-index:99999;pointer-events:auto;width:236px;max-height:74vh;display:flex;flex-direction:column;' +
        'background:rgba(8,10,20,0.93);border-radius:8px;box-shadow:0 2px 14px rgba(0,0,0,0.55);color:#cfe3ff;' +
        'font:12px system-ui,sans-serif;overflow:hidden;transform:translateX(calc(100% + 16px)) translateY(-50%);transition:transform 0.28s ease;';
    pane.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 9px 7px 10px;font-weight:600;border-bottom:1px solid rgba(255,255,255,.1)"><span>Presets</span><button id="vz-defaults" title="Restore the bundled default favorites + bans" style="' + BC_BTN + ';font-weight:400">↺ defaults</button></div>' +
        '<input id="vz-filter" placeholder="filter…" spellcheck="false" style="margin:8px 9px 6px;padding:4px 7px;background:#11141f;color:#cfe3ff;border:1px solid rgba(255,255,255,.15);border-radius:5px;outline:none">' +
        '<div id="vz-list" style="overflow-y:auto;padding:0 4px 8px"></div>';
    (host || document.body).appendChild(pane);
    _bcPane = pane;
    _bcListEl = pane.querySelector('#vz-list');
    _bcFilterEl = pane.querySelector('#vz-filter');
    _bcFilterEl.addEventListener('input', _bcRenderList);
    pane.querySelector('#vz-defaults').addEventListener('click', _bcRestoreDefaults);

    const q = (id) => p.querySelector(id);
    _bcPanel = p;

    // Preset curation wiring (favorites / bans / cycle / reset)
    _bcLoadLists();
    const cyc = q('#vz-cyc');
    cyc.value = s.cyclePool || 'all';
    // Read fresh: settings.html writes can replace _bcSettings, so the `s`
    // captured at panel creation may be stale by the time this fires.
    cyc.addEventListener('change', () => { _bcLoadSettings().cyclePool = cyc.value; _bcSaveSettings(); });
    _bcSetHold(!!s.hold); // sync the Hold button label to the saved state
    q('#vz-hold').addEventListener('click', () => _bcSetHold(!_bcLoadSettings().hold));
    q('#vz-listbtn').addEventListener('click', () => _bcSetPane(!_bcPaneOpen));
    q('#vz-pname').addEventListener('click', () => _bcSetPane(!_bcPaneOpen));
    q('#vz-prev').addEventListener('click', () => { if (_bcPrimary) _bcPrimary.step(-1); });
    q('#vz-next').addEventListener('click', () => { if (_bcPrimary) _bcPrimary.step(1); });
    q('#vz-fav').addEventListener('click', () => { if (_bcPrimary) _bcPrimary.toggleFav(); });
    q('#vz-ban').addEventListener('click', () => { if (_bcPrimary) _bcPrimary.banCur(); });
    _bcSetPane(false); // start collapsed; sets the list-button label
    _bcUpdatePanelPreset();

    // Live level readout — proves the song (not just guitar) is driving things.
    // Self-stops when the panel is removed (_bcPanel !== p).
    (function meterLoop() {
        if (_bcPanel !== p) return;
        const m = p.querySelector('#vz-meter');
        if (m) m.textContent = 'gtr ' + _bcMeters.gtr.toFixed(2) + '  ·  song ' + _bcMeters.song.toFixed(2);
        setTimeout(meterLoop, 150);
    })();

    if (!_bcPanelKeyBound) {
        _bcPanelKeyBound = true;
        window.addEventListener('keydown', (e) => {
            if (e.key !== '`' || e.metaKey || e.ctrlKey || !_bcPanel) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            const reveal = _bcPanel.style.display === 'none';
            _bcPanel.style.display = reveal ? '' : 'none';
            if (_bcPane) _bcPane.style.display = reveal ? '' : 'none';
        });
    }
    return _bcPanel;
}

// Create a Butterchurn background controller bound to a wrap element.
export function _bcCreateController(wrap, sizeProvider, audioProvider) {
    const ctrl = { viz: null, actx: null, guitar: null, map: null, keys: [], cycle: 0, dead: false, lastW: -1, lastH: -1, canvas: null, backdrop: null, scrim: null, tint: null, wrap: wrap };
    // Layered DOM in the wrap, all BEHIND the transparent 3D highway:
    //   backdrop(z-4 dark) → bc canvas(z-3) → tint(z-2 instrument color) → scrim(z-1 lane dim)
    const mkLayer = (cls, css) => { const d = document.createElement('div'); d.className = cls; d.style.cssText = css; wrap.appendChild(d); return d; };
    const backdrop = mkLayer('viz3d-backdrop', 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:-4;background:#070710;pointer-events:none;');
    const canvas = document.createElement('canvas');
    canvas.className = 'viz3d-bc';
    canvas.style.cssText = 'position:absolute;top:0;left:0;z-index:-3;pointer-events:none;';
    wrap.appendChild(canvas);
    const tint = mkLayer('viz3d-tint', 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:-2;pointer-events:none;mix-blend-mode:overlay;background:transparent;');
    const scrim = mkLayer('viz3d-scrim', 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:-1;pointer-events:none;');
    ctrl.canvas = canvas; ctrl.backdrop = backdrop; ctrl.scrim = scrim; ctrl.tint = tint;

    ctrl.applySettings = function () {
        const s = _bcLoadSettings();
        canvas.style.display = s.enabled ? '' : 'none';
        canvas.style.opacity = String(s.enabled ? s.opacity : 0);
        if (s.laneDim) {
            const a = Math.max(0, Math.min(1, s.laneDimStrength)).toFixed(3);
            scrim.style.display = '';
            scrim.style.background = 'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,' + a +
                ') 30%, rgba(0,0,0,' + a + ') 70%, rgba(0,0,0,0) 100%)';
        } else {
            scrim.style.display = 'none';
        }
    };

    // ── Preset curation (favorites / bans / cycle mode) ──
    ctrl.curName = null; ctrl.lastManual = 0;
    ctrl.allList = () => (ctrl.keys || []).filter((k) => !_bcBanned.has(k));
    ctrl.pool = () => {
        const mode = _bcLoadSettings().cyclePool || 'all';
        if (mode === 'bans') return (ctrl.keys || []).filter((k) => _bcBanned.has(k));
        if (mode === 'favorites') {
            const f = (ctrl.keys || []).filter((k) => _bcFavorites.has(k) && !_bcBanned.has(k));
            if (f.length) return f;
        }
        return ctrl.allList();
    };
    ctrl.browseArr = () => ctrl.keys || []; // ◀▶ and the list pane walk the full preset list
    ctrl.loadByName = (name, blend) => {
        if (!ctrl.viz || !name || !ctrl.map || !ctrl.map[name]) return;
        try { ctrl.viz.loadPreset(ctrl.map[name], blend || 0); ctrl.curName = name; } catch (e) {}
        _bcUpdatePanelPreset();
    };
    ctrl.autoTick = () => {
        if (ctrl.dead || _bcLoadSettings().hold) return;
        if (performance.now() - ctrl.lastManual < 8000) return;
        const pool = ctrl.pool();
        if (!pool.length) return;
        let name = pool[(Math.random() * pool.length) | 0];
        if (pool.length > 1 && name === ctrl.curName) name = pool[(pool.indexOf(name) + 1) % pool.length];
        ctrl.loadByName(name, 2.7);
    };
    ctrl.step = (dir) => {
        const list = ctrl.browseArr();
        if (!list.length) return;
        let i = list.indexOf(ctrl.curName); if (i < 0) i = (dir > 0 ? -1 : 0);
        i = (i + dir + list.length) % list.length;
        ctrl.lastManual = performance.now();
        ctrl.loadByName(list[i], 1.5);
    };
    ctrl.toggleFav = () => {
        if (!ctrl.curName) return;
        if (_bcFavorites.has(ctrl.curName)) _bcFavorites.delete(ctrl.curName);
        else { _bcFavorites.add(ctrl.curName); _bcBanned.delete(ctrl.curName); }
        _bcSaveLists(); _bcUpdatePanelPreset();
    };
    ctrl.banCur = () => {
        if (!ctrl.curName) return;
        if (_bcBanned.has(ctrl.curName)) {           // un-ban (two-way) — stay on it
            _bcBanned.delete(ctrl.curName);
            _bcSaveLists(); _bcUpdatePanelPreset();
        } else {                                     // ban + advance off it
            _bcBanned.add(ctrl.curName); _bcFavorites.delete(ctrl.curName);
            _bcSaveLists(); ctrl.step(1);
        }
    };
    _bcPrimary = ctrl;

    _bcControllers.add(ctrl);
    _bcEnsurePanel(wrap);
    ctrl.applySettings();

    _bcLoadLib().then(() => {
        if (ctrl.dead) return;
        const bc = _bcResolve();
        if (!bc || typeof bc.createVisualizer !== 'function') { console.warn('[viz3d] Butterchurn global missing'); return; }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const sz = (sizeProvider && sizeProvider()) || { w: 1280, h: 720 };
        // Browser (Docker/web app): REUSE the highway's existing shared
        // analyser (the fog scenery's #audio / stems tap) via audioProvider,
        // and build Butterchurn on that SAME AudioContext so connectAudio()
        // doesn't fail cross-context. Desktop uses its own context fed by the
        // guitar/mic input. `ownsActx` tracks whether WE created the context
        // (so destroy() closes only contexts we own, never the shared one).
        const fogAudio = _bcIsDesktop() ? null : (audioProvider ? audioProvider() : null);
        ctrl.ownsActx = !(fogAudio && fogAudio.ctx);
        ctrl.actx = (fogAudio && fogAudio.ctx) || new Ctx();
        if (ctrl.actx.state === 'suspended' && ctrl.actx.resume) ctrl.actx.resume().catch(() => {});
        // Seed the DRAWING BUFFER (canvas.width/height) to the device-pixel
        // render size and report that SAME size to Butterchurn. Its on-screen
        // pass viewports to the reported size but never sizes the output canvas
        // itself — leaving the buffer at the 300x150 default blits the whole
        // visualizer into a corner that CSS then stretches across the highway.
        // pixelRatio:1 because DPR is now folded into the reported size, so
        // buffer == viewport == internal texsize (no double-counting).
        const _bcRatio0 = Math.min(window.devicePixelRatio || 1, 1.5);
        const _bcW0 = Math.max(1, Math.round((sz.w || 1280) * _bcRatio0));
        const _bcH0 = Math.max(1, Math.round((sz.h || 720) * _bcRatio0));
        canvas.width = _bcW0; canvas.height = _bcH0;
        ctrl.viz = bc.createVisualizer(ctrl.actx, canvas, {
            width: _bcW0, height: _bcH0,
            pixelRatio: 1, textureRatio: 1,
        });
        if (_bcIsDesktop()) {
            try {
                ctrl.guitar = _bcGuitarFeed(ctrl.actx, (srcNode) => { try { if (ctrl.viz) ctrl.viz.connectAudio(srcNode); } catch (e) {} });
                console.log('[viz3d] bg: feeding GUITAR input into Butterchurn');
            } catch (e) { console.warn('[viz3d] guitar feed failed', e); }
        } else if (fogAudio && fogAudio.analyser) {
            // The shared AnalyserNode is a passthrough — connecting it onward
            // to Butterchurn's internal analyser doesn't disturb the fog's reads.
            try { ctrl.viz.connectAudio(fogAudio.analyser); console.log('[viz3d] browser: Butterchurn tapping shared analyser (' + (fogAudio.source || 'core') + ')'); }
            catch (e) { console.warn('[viz3d] shared-analyser connect failed', e); }
        }
        _bcLoadLists();
        const presets = _bcPresets();
        if (presets && typeof presets.getPresets === 'function') { ctrl.map = presets.getPresets(); ctrl.keys = Object.keys(ctrl.map); }
        const pool0 = ctrl.pool();
        ctrl.loadByName(pool0.length ? pool0[(Math.random() * pool0.length) | 0] : (ctrl.keys[0] || null), 0.0);
        ctrl.cycle = setInterval(() => ctrl.autoTick(), 30000);
        ctrl.connectedAnalyser = (fogAudio && fogAudio.analyser) || null;
        console.log('[viz3d] Butterchurn ready, presets:', ctrl.keys.length);
    }).catch((e) => {
        // Async init failed (lib load, WebGL/context creation, etc.). Clean up
        // the half-mounted controller so we don't leak an owned AudioContext /
        // DOM layers, and mark it dead so _bcSyncMode can retry on a later
        // mount instead of seeing a live-looking but non-functional bcCtrl.
        console.error('[viz3d] Butterchurn load/init failed', e);
        try { _bcReleaseCanvasGL(ctrl.canvas); } catch (_) {}
        try { if (ctrl.guitar) { ctrl.guitar.stop(); ctrl.guitar = null; } } catch (_) {}
        try { [ctrl.canvas, ctrl.backdrop, ctrl.scrim, ctrl.tint].forEach((el) => { if (el && el.parentNode) el.parentNode.removeChild(el); }); } catch (_) {}
        if (ctrl.ownsActx && ctrl.actx && typeof ctrl.actx.close === 'function') { try { ctrl.actx.close(); } catch (_) {} }
        ctrl.actx = null; ctrl.viz = null; ctrl.dead = true;
        _bcControllers.delete(ctrl);
    });
    // Size the Butterchurn output: set the canvas DRAWING BUFFER to the
    // device-pixel render size AND report that same size, so buffer ==
    // on-screen viewport == full fill. Butterchurn never sizes the output
    // canvas itself; the previous code set only CSS size, leaving the buffer
    // at the 300x150 default -> the viz showed a stretched lower-left corner
    // (worse the larger the panel). Ratio reuses the highway's DPR budget.
    function _bcApplySize(cssW, cssH) {
        if (!(cssW > 0 && cssH > 0)) return;
        ctrl.lastW = cssW; ctrl.lastH = cssH;
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
        const bw = Math.max(1, Math.round(cssW * ratio)), bh = Math.max(1, Math.round(cssH * ratio));
        if (canvas.width !== bw) canvas.width = bw;
        if (canvas.height !== bh) canvas.height = bh;
        const wpx = cssW + 'px', hpx = cssH + 'px';
        // Confine ALL layers to exactly the highway-canvas rect so the opaque
        // backdrop can't bleed over the transport bar above the highway.
        [ctrl.canvas, ctrl.backdrop, ctrl.scrim, ctrl.tint].forEach((el) => {
            if (el) { el.style.width = wpx; el.style.height = hpx; el.style.right = 'auto'; el.style.bottom = 'auto'; }
        });
        if (ctrl.viz && ctrl.viz.setRendererSize) { try { ctrl.viz.setRendererSize(bw, bh); } catch (e) {} }
    }
    return {
        applySettings() { ctrl.applySettings(); },
        dead() { return ctrl.dead; },
        ready() { return !!ctrl.viz; },
        boundAnalyser() { return ctrl.connectedAnalyser || null; },
        audioCtx() { return ctrl.actx; },
        // Re-bind audio when the shared analyser changes (e.g. a stems song
        // swap replaces the analyser). Same context → cheap reconnect; the
        // caller handles a context change with a full rebuild (cross-context
        // connectAudio is impossible — the visualizer is bound to one ctx).
        reconnectAudio(a) {
            if (!a || !a.analyser || !ctrl.viz) return false;
            if (a.analyser === ctrl.connectedAnalyser) return true;
            if (a.ctx && a.ctx !== ctrl.actx) return false; // needs rebuild
            try { ctrl.viz.connectAudio(a.analyser); ctrl.connectedAnalyser = a.analyser; return true; } catch (e) { return false; }
        },
        chart(v) { if (ctrl.guitar && ctrl.guitar.setChart) ctrl.guitar.setChart(v); },
        tint(hex, alpha) {
            if (!ctrl.tint) return;
            if (hex == null) { ctrl.tint.style.background = 'transparent'; return; }
            const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
            ctrl.tint.style.background = 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha || 0).toFixed(3) + ')';
        },
        render() {
            const s = _bcLoadSettings();
            if (!ctrl.viz || !s.enabled) return; // skip GPU work when the bg is off
            const sz = sizeProvider && sizeProvider();
            if (sz && sz.w > 0 && sz.h > 0 && (sz.w !== ctrl.lastW || sz.h !== ctrl.lastH)) {
                _bcApplySize(sz.w, sz.h);
            }
            try { ctrl.viz.render(); } catch (e) {}
        },
        resize(w, h) { _bcApplySize(w, h); },
        destroy() {
            ctrl.dead = true;
            _bcControllers.delete(ctrl);
            if (_bcPrimary === ctrl) { _bcPrimary = _bcControllers.values().next().value || null; _bcUpdatePanelPreset(); }
            if (ctrl.cycle) { clearInterval(ctrl.cycle); ctrl.cycle = 0; }
            if (ctrl.guitar) { ctrl.guitar.stop(); ctrl.guitar = null; }
            // Release the Butterchurn WebGL context deterministically (don't
            // wait for GC) so repeated mounts/toggles can't exhaust the
            // browser's WebGL context cap (~16). Do it before removing the
            // canvas from the DOM.
            _bcReleaseCanvasGL(ctrl.canvas);
            [ctrl.canvas, ctrl.backdrop, ctrl.scrim, ctrl.tint].forEach((el) => { if (el && el.parentNode) el.parentNode.removeChild(el); });
            ctrl.viz = null; ctrl.connectedAnalyser = null;
            // Close the AudioContext only if we own it (desktop, or the
            // browser fallback). The browser path normally reuses the
            // highway's shared context, which the fog system owns — never
            // close that. Without this, desktop leaks a new AudioContext per
            // mount and hits the browser's ~6-context cap after a few toggles.
            if (ctrl.ownsActx && ctrl.actx && typeof ctrl.actx.close === 'function') {
                try { ctrl.actx.close(); } catch (e) {}
            }
            ctrl.actx = null;
            if (_bcControllers.size === 0) {
                if (_bcPanel && _bcPanel.parentNode) _bcPanel.parentNode.removeChild(_bcPanel);
                if (_bcPane && _bcPane.parentNode) _bcPane.parentNode.removeChild(_bcPane);
                _bcPanel = null; _bcPane = null; _bcListEl = null; _bcFilterEl = null; _bcPaneOpen = false;
            } else if (_bcPrimary && _bcPrimary.wrap) {
                // Splitscreen: a controller other than this one is still
                // alive. The singleton panel was parented to THIS (now
                // destroyed) wrap, so re-home it onto the surviving primary's
                // wrap — otherwise the panel is orphaned on the dead wrap and
                // the surviving highway is left with no visualizer controls
                // (_bcEnsurePanel only runs at controller creation). It moves
                // the existing panel+pane when connected, or rebuilds them on
                // the survivor if this wrap was already detached.
                try { _bcEnsurePanel(_bcPrimary.wrap); _bcUpdatePanelPreset(); } catch (e) {}
            }
        },
    };
}

// Selectable per-string color palettes (issue #10). Each palette has
// 8 entries to match MAX_RENDER_STRINGS so 6/7/8-string arrangements
// all index safely. Default is the canonical chart-format classic
// mapping (low E=red, A=yellow, D=blue, G=orange, B=green,
// high E=purple); Neon pushes saturation harder; Pastel desaturates
// for long-session comfort; Colorblind (high contrast) is derived from
// the chart format's built-in colorblind-mode palette, but this preset
// intentionally keeps some entries tuned for feedBack rather than
// reproducing every original hex value verbatim. The chart-format base
// values came from community reverse-engineering of the original chart
// files; do not treat the tuned values below as the exact original
// palette.
// In feedBack's index convention s=0 is the low E (thickest) and
// s=5 is the high E (thinnest), matching the chart format's native string
// indexing. Per-index ordering is preserved across all palettes so
// switching between them never reassigns a string to a different
// colour family. Indices 6/7 are supplementary slots used for
// 7/8-string arrangements.
// NOTE: settings.html mirrors these arrays in its hydration script
// for the palette-preview swatches — keep them in sync.
