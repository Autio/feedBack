// Wide-pane framing: per-pane camera tuning overrides (localStorage-backed)
// and the floating tuning panel that edits them live.
import { BASE_VFOV, HORPLUS_MIN_VFOV, wide } from './geometry.js';

// ── Wide-pane framing: live tuner bridge + panel ──────────────────────────
// window.__h3dAspectTune is the single source of truth the renderer reads
// each frame (see effectiveVfov + camUpdate). The defaults reproduce the
// current framing exactly (enabled:false). Values persist to localStorage so
// a tuning session survives reloads; the floating panel (Shift+A) writes the
// same object live. All of this is a debug aid — none of it runs unless the
// user opts in.
// Versioned key: the first iteration shipped a broken default (enabled:true,
// baseVfov:30) and may have persisted it. Bumping the key ignores that stale
// state so the corrected default-off config actually takes effect.
const _ASPECT_LS = 'h3d_aspect_tune2';
// Working defaults. Default OFF, so out of the box this is an exact no-op —
// every pane renders byte-for-byte as before (effectiveVfov returns
// BASE_VFOV and the pose nudges gate off). The config is also coherent when
// a tester turns it ON via Shift+A: baseVfov == BASE_VFOV so normal ~16:9
// panes (single-player, most 2x2) stay at 70° even enabled, and only panes
// wider than startAspect (2.25) engage the Hor+ hold; blend:1 makes that
// hold actually take effect; minVfovDeg (28) sits below baseVfov so the floor
// is a real floor. The pose nudges are the in-progress wide-pane look a
// tester sees once enabled. localStorage overrides all of this per machine.
const _ASPECT_DEFAULTS = {
    enabled: false, baseVfov: BASE_VFOV, startAspect: 2.25, hfovDeg: null,
    blend: 1, minVfovDeg: HORPLUS_MIN_VFOV, splitOnly: false,
    heightMul: 0.30, distMul: 0.95, pitchAdd: -1.5, lookDepthMul: 1,
};
// Slider specs (numeric fields). Checkboxes (enabled/splitOnly) + the hfov
// override are handled separately in the panel builder. Ranges are wide on
// purpose — this is a tuning aid, the no-op default sits mid-range.
const _ASPECT_FIELDS = [
    { k: 'baseVfov',     label: 'Base vFOV°',   min: 18,  max: 90,  step: 1 },
    { k: 'startAspect',  label: 'Start aspect', min: 1.0, max: 4.0, step: 0.05 },
    { k: 'blend',        label: 'Blend',        min: 0,   max: 1,   step: 0.05 },
    { k: 'minVfovDeg',   label: 'Min vFOV°',    min: 10,  max: 60,  step: 1 },
    { k: 'heightMul',    label: 'Height ×',     min: 0.1, max: 2.5, step: 0.05 },
    { k: 'distMul',      label: 'Dolly ×',      min: 0.2, max: 3.0, step: 0.05 },
    { k: 'pitchAdd',     label: 'Pitch +',      min: -40, max: 40,  step: 0.5 },
    // Aims the camera further down the neck (>1) or pulls the aim back (<1).
    // This is the lever that flattens the mid-distance "hump" toward a
    // straight gradual recede.
    { k: 'lookDepthMul', label: 'Look depth',   min: 0.2, max: 3.0, step: 0.05 },
];
let _aspectPanelEl = null;        // the floating panel root (built once)
let _aspectPanelRO = null;        // readout <div>
let _aspectPanelRAF = 0;          // readout poll handle
let _aspectTargetSel = null;      // the "Target" <select>
let _aspectTgtRow = null;         // the Target row (hidden when only one pane)
let _aspectHfovCb = null;         // hfov-override checkbox (synced explicitly)
let _aspectHfovSl = null;         // hfov-override slider
// Which pane the panel edits. '' = all panes (writes the shared base object);
// a pane key ('arr:<name>' or the fallback 'pane:<uid>') writes that pane's
// sparse override, so one split pane can be framed independently.
let _aspectEditTarget = '';
// Bumped when the SET of live panes changes (add/prune) so the panel rebuilds
// the Target dropdown — never on a per-frame label re-report, which would
// flicker the <select>.
let _aspectPanesDirty = true;
// Monotonic counter for the per-instance fallback key (when a pane has no
// arrangement name to key by).
export let _aspectPaneCounter = 0;
function _aspectNowMs() {
    try { if (performance && performance.now) return performance.now(); } catch (e) {}
    try { return Date.now(); } catch (e) { return 0; }   // keep pruning functional
}
// Pane key: prefer the arrangement name ('arr:Bass') so a pane's framing is
// stable across songs AND distinct between split panes, with no dependency on
// the external splitscreen panel index (which isn't always available). Fall
// back to a per-instance id ('pane:3') when there's no arrangement.
export function _aspectPaneKey(arrangement, uid) {
    const a = (typeof arrangement === 'string') ? arrangement.trim() : '';
    return a ? ('arr:' + a) : ('pane:' + uid);
}
// Human label derived from the key.
function _aspectPaneLabel(paneKey) {
    if (paneKey.slice(0, 4) === 'arr:') return paneKey.slice(4);
    if (paneKey.slice(0, 5) === 'pane:') return 'Pane ' + paneKey.slice(5);
    return paneKey;
}

// Get-or-create the shared bridge object, seeded from defaults + localStorage.
// May carry a sparse `__panels` map of per-pane overrides.
function _aspectTune() {
    let t = window.__h3dAspectTune;
    if (!t || typeof t !== 'object') {
        t = Object.assign({}, _ASPECT_DEFAULTS);
        try {
            const raw = localStorage.getItem(_ASPECT_LS);
            if (raw) Object.assign(t, JSON.parse(raw));
        } catch (e) {}
        window.__h3dAspectTune = t;
    }
    return t;
}
// Bumped on every tune mutation (all writes funnel through _aspectPersist) so
// the per-pane resolve cache below can invalidate cheaply.
let _aspectRev = 0;
function _aspectPersist() {
    _aspectRev++;
    try {
        const t = _aspectTune(), out = {};
        Object.keys(_ASPECT_DEFAULTS).forEach((k) => { out[k] = t[k]; });
        // Persist per-pane overrides keyed by arrangement ('arr:*') only, so a
        // pane's framing carries across songs. Instance-id fallback keys
        // ('pane:*') are session-only — persisting them would leak a new key
        // every reload.
        if (t.__panels) {
            const p = {}; let any = false;
            Object.keys(t.__panels).forEach((k) => {
                if (k.slice(0, 4) === 'arr:') { p[k] = t.__panels[k]; any = true; }
            });
            if (any) out.__panels = p;
        }
        localStorage.setItem(_ASPECT_LS, JSON.stringify(out));
    } catch (e) {}
}

// Resolve the effective tune for a pane: the shared base, with that pane's
// override keys (if any) laid on top. Called every frame per renderer, so the
// merged object is memoized per pane and only rebuilt when the tune mutates
// (_aspectRev changes). Panes with no override return the base directly (no
// allocation).
const _aspectResolveCache = new Map();   // paneKey -> { rev, obj }
export function _resolveTuneFor(paneKey) {
    const base = _aspectTune();
    const ov = base.__panels && base.__panels[paneKey];
    if (!ov) return base;
    const c = _aspectResolveCache.get(paneKey);
    if (c && c.rev === _aspectRev) return c.obj;
    const out = {};
    Object.keys(_ASPECT_DEFAULTS).forEach((k) => { out[k] = (k in ov) ? ov[k] : base[k]; });
    _aspectResolveCache.set(paneKey, { rev: _aspectRev, obj: out });
    return out;
}
// Record a live pane so the Target dropdown can list it. Called every frame
// by each renderer with its pane key. `seen` is refreshed each call for
// pruning; the dropdown is only marked dirty when a pane is newly added — not
// on every re-report, which would flicker the <select>.
export function _aspectRegisterPane(paneKey) {
    const reg = window.__h3dAspectPanes || (window.__h3dAspectPanes = {});
    const label = _aspectPaneLabel(paneKey);
    let e = reg[paneKey];
    if (!e) { e = reg[paneKey] = { label, seen: 0 }; _aspectPanesDirty = true; }
    else if (e.label !== label) { e.label = label; _aspectPanesDirty = true; }
    e.seen = _aspectNowMs();
}
// Drop panes not reported recently (song change, split teardown, pane close).
function _aspectPrunePanes() {
    const reg = window.__h3dAspectPanes;
    if (!reg) return;
    const now = _aspectNowMs();
    const ro = window.__h3dAspectReadout;
    Object.keys(reg).forEach((k) => {
        if (now - (reg[k].seen || 0) > 1500) {
            delete reg[k];
            // Prune the matching readout slot so it can't grow unbounded as
            // songs/arrangements churn, and drop a dangling __last pointer.
            if (ro) { delete ro[k]; if (ro.__last === k) delete ro.__last; }
            _aspectPanesDirty = true;
        }
    });
}

// True while _syncAspectPanel is programmatically refreshing controls, so the
// synthetic 'input' events it dispatches to update labels don't write back
// into the tune (which would populate a full override for every field and
// spam localStorage). Real user input runs with this false.
let _aspectSyncing = false;
// Read/write against the current edit target ('' → base, else pane override).
function _aspectReadVal(k) {
    const base = _aspectTune();
    if (!_aspectEditTarget) return base[k];
    const ov = base.__panels && base.__panels[_aspectEditTarget];
    return (ov && (k in ov)) ? ov[k] : base[k];
}
function _aspectWriteVal(k, v) {
    const base = _aspectTune();
    if (!_aspectEditTarget) { base[k] = v; }
    else {
        const m = base.__panels || (base.__panels = {});
        (m[_aspectEditTarget] || (m[_aspectEditTarget] = {}))[k] = v;
    }
    _aspectPersist();
}
// Clear a field: for the base target set the explicit auto value (null); for a
// pane target delete the override key so the pane re-inherits the base value
// (and drop the pane's override object once it's empty).
function _aspectClearVal(k) {
    const base = _aspectTune();
    if (!_aspectEditTarget) { base[k] = null; }
    else {
        const m = base.__panels, ov = m && m[_aspectEditTarget];
        if (ov) { delete ov[k]; if (!Object.keys(ov).length) delete m[_aspectEditTarget]; }
    }
    _aspectPersist();
}

// (Re)build the Target dropdown from the live pane registry, preserving the
// current selection when it's still valid.
function _aspectBuildTargets() {
    if (!_aspectTargetSel) return;
    // Don't yank a dropdown the user is actively interacting with — leave it
    // dirty and rebuild on a later tick once it's no longer focused.
    if (document.activeElement === _aspectTargetSel) return;
    const reg = window.__h3dAspectPanes || {};
    const keys = Object.keys(reg).sort();
    _aspectTargetSel.innerHTML = '';
    const all = document.createElement('option');
    all.value = ''; all.textContent = keys.length > 1 ? 'All panes' : 'All';
    _aspectTargetSel.appendChild(all);
    keys.forEach((pk) => {
        const o = document.createElement('option');
        o.value = pk; o.textContent = reg[pk].label;
        _aspectTargetSel.appendChild(o);
    });
    // Force the edit target back to "All" when the Target row is hidden
    // (single pane) or the selected pane is gone — otherwise a stale pane
    // target would silently route edits into a hidden (and persistent
    // arr:*) override in single-player.
    if (keys.length <= 1 || (_aspectEditTarget && !reg[_aspectEditTarget])) {
        _aspectEditTarget = '';
    }
    _aspectTargetSel.value = _aspectEditTarget;
    // The Target row only matters with more than one pane (a split). With a
    // single pane there's nothing to disambiguate, so hide it.
    if (_aspectTgtRow) _aspectTgtRow.style.display = keys.length > 1 ? '' : 'none';
    _aspectPanesDirty = false;
}

function _ensureAspectPanel() {
    if (_aspectPanelEl || typeof document === 'undefined') return;
    const wrap = document.createElement('div');
    wrap.id = 'h3d-aspect-tuner';
    wrap.style.cssText = [
        'position:fixed', 'top:64px', 'right:12px', 'z-index:99999',
        'width:236px', 'padding:10px 12px', 'border-radius:8px',
        'background:rgba(12,18,28,0.92)', 'border:1px solid rgba(120,150,200,0.35)',
        'box-shadow:0 6px 24px rgba(0,0,0,0.5)', 'color:#cfe0f5',
        'font:11px/1.35 system-ui,sans-serif', 'user-select:none',
        'pointer-events:auto',
    ].join(';');

    // Header: title + close (×). Close hides the panel; the feature keeps
    // whatever enabled state it had — this is a dismiss, not an A/B toggle.
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
    const title = document.createElement('div');
    title.textContent = 'Wide-pane framing';
    title.style.cssText = 'font-weight:700;color:#e8c040;';
    const close = document.createElement('button');
    close.type = 'button';                 // never submit if nested in a <form>
    close.textContent = '×';
    close.title = 'Close (Shift+A)';
    close.setAttribute('aria-label', 'Close');
    close.style.cssText = 'border:none;background:transparent;color:#cfe0f5;font-size:17px;line-height:1;cursor:pointer;padding:0 2px;';
    close.addEventListener('click', () => _setAspectPanelVisible(false));
    hdr.appendChild(title); hdr.appendChild(close); wrap.appendChild(hdr);

    // Target selector — which pane the controls below edit.
    const tgtRow = document.createElement('div'); tgtRow.style.cssText = 'margin:2px 0 7px;';
    _aspectTgtRow = tgtRow;
    const tgtLab = document.createElement('div');
    tgtLab.textContent = 'Target'; tgtLab.style.cssText = 'color:#9fb0c8;margin-bottom:2px;';
    _aspectTargetSel = document.createElement('select');
    _aspectTargetSel.setAttribute('aria-label', 'Target pane');
    _aspectTargetSel.style.cssText = 'width:100%;background:rgba(30,44,66,0.9);color:#cfe0f5;border:1px solid rgba(120,150,200,0.4);border-radius:4px;padding:3px;';
    _aspectTargetSel.addEventListener('change', () => {
        _aspectEditTarget = _aspectTargetSel.value; _syncAspectPanel();
    });
    tgtRow.appendChild(tgtLab); tgtRow.appendChild(_aspectTargetSel); wrap.appendChild(tgtRow);
    _aspectBuildTargets();

    // enabled + splitOnly checkboxes (per-target)
    [['enabled', 'Enabled'], ['splitOnly', 'Split panes only']].forEach(([k, lbl]) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!_aspectReadVal(k); cb.dataset.k = k;
        cb.addEventListener('change', () => { _aspectWriteVal(k, cb.checked); });
        const span = document.createElement('span'); span.textContent = lbl;
        row.appendChild(cb); row.appendChild(span); wrap.appendChild(row);
    });

    // numeric sliders (per-target)
    _ASPECT_FIELDS.forEach((f) => {
        const row = document.createElement('div');
        row.style.cssText = 'margin:5px 0;';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;';
        const lab = document.createElement('span'); lab.textContent = f.label;
        const val = document.createElement('span');
        val.style.cssText = 'color:#8fb6ff;font-variant-numeric:tabular-nums;';
        head.appendChild(lab); head.appendChild(val); row.appendChild(head);
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = f.min; sl.max = f.max; sl.step = f.step;
        const rv = _aspectReadVal(f.k);
        sl.value = Number.isFinite(rv) ? rv : _ASPECT_DEFAULTS[f.k];
        sl.dataset.k = f.k;
        sl.style.cssText = 'width:100%;';
        const show = () => { val.textContent = (+sl.value).toFixed(f.step < 1 ? 2 : 0); };
        show();
        sl.addEventListener('input', () => {
            show();                                   // label always refreshes
            if (!_aspectSyncing) _aspectWriteVal(f.k, parseFloat(sl.value));
        });
        row.appendChild(sl); wrap.appendChild(row);
    });

    // hfov override (checkbox enables a slider; off → hfovDeg=null = auto)
    {
        const row = document.createElement('div'); row.style.cssText = 'margin:5px 0;';
        const head = document.createElement('label');
        head.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = Number.isFinite(_aspectReadVal('hfovDeg'));
        const lbl = document.createElement('span'); lbl.textContent = 'Override held hFOV°';
        head.appendChild(cb); head.appendChild(lbl); row.appendChild(head);
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = 40; sl.max = 160; sl.step = 1;
        const hv = _aspectReadVal('hfovDeg');
        sl.value = Number.isFinite(hv) ? hv : 102;
        sl.disabled = !cb.checked;
        sl.style.cssText = 'width:100%;';
        cb.addEventListener('change', () => {
            if (_aspectSyncing) return;
            sl.disabled = !cb.checked;
            if (cb.checked) _aspectWriteVal('hfovDeg', parseFloat(sl.value));
            else _aspectClearVal('hfovDeg');   // base → auto (null); pane → re-inherit base
        });
        sl.addEventListener('input', () => {
            if (!_aspectSyncing && cb.checked) _aspectWriteVal('hfovDeg', parseFloat(sl.value));
        });
        row.appendChild(sl); wrap.appendChild(row);
        _aspectHfovCb = cb; _aspectHfovSl = sl;
    }

    // live readout
    _aspectPanelRO = document.createElement('div');
    _aspectPanelRO.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid rgba(120,150,200,0.25);color:#9fb;font-variant-numeric:tabular-nums;';
    _aspectPanelRO.textContent = 'aspect — · vFOV —';
    wrap.appendChild(_aspectPanelRO);

    // buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
    const mkBtn = (txt, fn) => {
        const b = document.createElement('button');
        b.type = 'button';                 // never submit if nested in a <form>
        b.textContent = txt;
        b.style.cssText = 'flex:1;padding:4px 0;border-radius:5px;border:1px solid rgba(120,150,200,0.4);background:rgba(40,60,90,0.6);color:#cfe0f5;cursor:pointer;font:11px system-ui;';
        b.addEventListener('click', fn);
        return b;
    };
    // Reset: for "All" restores the shared defaults exactly; for a pane
    // clears that pane's override so it inherits the shared base again. Panel
    // visibility is independent (Shift+A / ×), so Reset doesn't force it open.
    btnRow.appendChild(mkBtn('Reset', () => {
        const base = _aspectTune();
        if (!_aspectEditTarget) {
            Object.keys(_ASPECT_DEFAULTS).forEach((k) => { base[k] = _ASPECT_DEFAULTS[k]; });
        } else if (base.__panels) {
            delete base.__panels[_aspectEditTarget];
        }
        _aspectPersist(); _syncAspectPanel();
    }));
    // Copy: the resolved values for the current target, as JSON.
    btnRow.appendChild(mkBtn('Copy', () => {
        const r = _aspectEditTarget ? _resolveTuneFor(_aspectEditTarget) : _aspectTune();
        const out = {};
        Object.keys(_ASPECT_DEFAULTS).forEach((k) => { out[k] = r[k]; });
        const json = JSON.stringify(out, null, 2);
        try { console.log('[h3d] wide-pane framing values (' + (_aspectEditTarget || 'all') + '):\n' + json); } catch (e) {}
        try { if (navigator.clipboard) navigator.clipboard.writeText(json); } catch (e) {}
    }));
    wrap.appendChild(btnRow);

    document.body.appendChild(wrap);
    _aspectPanelEl = wrap;
    _aspectPanelEl.style.display = 'none';
}

// Push the current target's values back into the panel controls (after Reset,
// a target switch, or an external edit). Cheap; only runs on demand.
function _syncAspectPanel() {
    if (!_aspectPanelEl) return;
    _aspectBuildTargets();
    // Guard so the synthetic 'input' events below only refresh labels and
    // don't write the read-back values into the target (which would turn a
    // sparse pane override into a full one and spam localStorage).
    _aspectSyncing = true;
    try {
        _aspectPanelEl.querySelectorAll('input[type=checkbox][data-k]').forEach((cb) => {
            cb.checked = !!_aspectReadVal(cb.dataset.k);
        });
        _aspectPanelEl.querySelectorAll('input[type=range][data-k]').forEach((sl) => {
            const v = _aspectReadVal(sl.dataset.k);
            if (Number.isFinite(v)) sl.value = v;
            sl.dispatchEvent(new Event('input'));   // refresh the value label only
        });
        if (_aspectHfovCb) {
            const hv = _aspectReadVal('hfovDeg');
            _aspectHfovCb.checked = Number.isFinite(hv);
            _aspectHfovSl.disabled = !_aspectHfovCb.checked;
            if (Number.isFinite(hv)) _aspectHfovSl.value = hv;
        }
    } finally {
        _aspectSyncing = false;
    }
}

function _setAspectPanelVisible(on) {
    _ensureAspectPanel();
    if (!_aspectPanelEl) return;
    _aspectPanelEl.style.display = on ? 'block' : 'none';
    window.__h3dAspectPanelOpen = !!on;        // gates the per-frame readout publish
    // Prune before the first build so panes from a prior song/split don't
    // flash in the dropdown until the first RAF tick.
    if (on) { _aspectPrunePanes(); _aspectBuildTargets(); }
    if (on && !_aspectPanelRAF) {
        const tick = () => {
            if (!window.__h3dAspectPanelOpen) { _aspectPanelRAF = 0; return; }
            _aspectPrunePanes();
            if (_aspectPanesDirty) _aspectBuildTargets();
            const ro = window.__h3dAspectReadout;
            if (_aspectPanelRO && ro) {
                const key = _aspectEditTarget || ro.__last;
                const e = key && ro[key];
                if (e && Number.isFinite(e.aspect)) {
                    _aspectPanelRO.textContent =
                        'aspect ' + e.aspect.toFixed(2) + ' · vFOV ' + e.vfov.toFixed(1) + '°';
                }
            }
            _aspectPanelRAF = requestAnimationFrame(tick);
        };
        _aspectPanelRAF = requestAnimationFrame(tick);
    }
}
// Toggle the panel open/closed (the Shift+A dismiss/reveal).
export function _toggleAspectPanel() {
    _ensureAspectPanel();
    const open = !(_aspectPanelEl && _aspectPanelEl.style.display !== 'none');
    _setAspectPanelVisible(open);
    if (open) _syncAspectPanel();
}
