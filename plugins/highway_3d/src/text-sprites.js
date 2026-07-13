// Text-sprite materials: the txtMat cache (style presets, rasterised label
// sprites) and the technique-marker material builders (triangles, bend
// chevrons, slide arrows, mute X marks, harmonic diamonds), plus the
// sprite-to-mesh material clone tracking. One instance per renderer; all
// GPU resources release through dispose().
import { T } from './three-loader.js';

export function createTextSprites() {
    let txtCache = {};
    // Per-mesh technique-marker clones — keyed by mesh, disposed when
    // the source sprite's map changes or on teardown. Replaces the old
    // unbounded push-per-frame approach in _spriteMat2MeshMat.
    const _techMeshMatClones = new Set();
    // ── Text-sprite cache ──────────────────────────────────────────────
    // ── Text-sprite style presets ─────────────────────────────────────
    // Each preset describes how a class of label is rasterised.
    // Tweak per-class look here (font, outline color/width, source
    // canvas size). `wide` toggles a long aspect ratio for multi-char
    // labels (chord/section names, "↑1/2", "~~~").
    //
    // Knobs:
    //   font        — full CSS font shorthand (weight + size + family)
    //   wideFont    — same, used when caller passes wide=true
    //   srcH        — source-canvas height in px (square; wide=4×).
    //                 Keep power-of-two so WebGL1 / Three.js retain
    //                 mipmaps + linear-mip-linear filtering — NPOT
    //                 textures silently fall back to no-mipmap and
    //                 shimmer at distance.
    //   stroke      — outline color (null = no outline)
    //   strokeW     — outline line-width in source-canvas px
    //   shadow      — { color, blur, dx, dy } or null
    const TXT_STYLES = {
        // The two fret-number sets the user wants to pop hardest.
        fretRow: {
            font:     '900 160px "Arial Black", "Helvetica Neue", Arial, sans-serif',
            wideFont: '900 128px "Arial Black", "Helvetica Neue", Arial, sans-serif',
            srcH: 256, stroke: '#0a1018', strokeW: 18,
            shadow: { color: 'rgba(0,0,0,0.7)', blur: 14, dx: 0, dy: 0 },
        },
        noteFret: {
            font:     '900 160px "Arial Black", "Helvetica Neue", Arial, sans-serif',
            wideFont: '900 128px "Arial Black", "Helvetica Neue", Arial, sans-serif',
            srcH: 256, stroke: '#0a1018', strokeW: 18,
            shadow: { color: 'rgba(0,0,0,0.7)', blur: 14, dx: 0, dy: 0 },
        },
        // Ghost-fret labels on the board projection: same weight/size/outline
        // as noteFret, but uses textAlign='center'; textBaseline='middle'
        // (the standard branch in txtMat) so the glyph is truly centred on
        // the PlaneGeometry UV. inkCenterFret's actualBoundingBox path is
        // intentionally NOT activated for this style — that path was designed
        // for Sprites and shifts the canvas origin, which causes visible
        // lower-left drift on Mesh + MeshBasicMaterial (UV-direct mapping).
        ghostFret: {
            font:     '900 160px "Arial Black", "Helvetica Neue", Arial, sans-serif',
            wideFont: '900 128px "Arial Black", "Helvetica Neue", Arial, sans-serif',
            srcH: 256, stroke: '#0a1018', strokeW: 18,
            shadow: { color: 'rgba(0,0,0,0.7)', blur: 14, dx: 0, dy: 0 },
        },
        // Chord names — gold script-style label, lighter outline keeps
        // the colour readable.
        chord: {
            font:     'bold 80px sans-serif',
            wideFont: 'bold 64px sans-serif',
            srcH: 128, stroke: '#0a1018', strokeW: 6, shadow: null,
        },
        // Section banners ("Verse", "Chorus") — same as chord weight.
        section: {
            font:     'bold 80px sans-serif',
            wideFont: 'bold 64px sans-serif',
            srcH: 128, stroke: '#0a1018', strokeW: 6, shadow: null,
        },
        // Technique markers (pinch-harmonic icon, PM, AC, H/P/T, etc.).
        technique: {
            font:     'bold 80px sans-serif',
            wideFont: 'bold 64px sans-serif',
            srcH: 128, stroke: '#0a1018', strokeW: 6, shadow: null,
        },
        // Open-string "0" label on the note body itself.
        open: {
            font:     'bold 80px sans-serif',
            wideFont: 'bold 64px sans-serif',
            srcH: 128, stroke: '#0a1018', strokeW: 6, shadow: null,
        },
    };

    function txtMat(text, col, wide, style) {
        const sName = style || 'technique';
        const k = sName + '|' + (wide ? 'W' : '') + text + '|' + col;
        if (txtCache[k]) return txtCache[k];
        const sp = TXT_STYLES[sName] || TXT_STYLES.technique;
        const h  = sp.srcH;
        const str = String(text);
        const font = wide ? sp.wideFont : sp.font;

        let w = wide ? h * 4 : h;

        if (!wide && sName === 'noteFret') {
            // Wide labels (D#2, Bb3) need a canvas wider than srcH; cap so
            // glyphs stay centred at (w/2, h/2) without edge clipping.
            const probe = document.createElement('canvas').getContext('2d');
            probe.font = font;
            const tw = probe.measureText(str).width;
            let pad = 0;
            if (sp.stroke && sp.strokeW > 0) pad += sp.strokeW * 2;
            if (sp.shadow) {
                pad += Math.abs(sp.shadow.dx) + sp.shadow.blur * 2;
            }
            w = Math.min(12 * h, Math.max(h, Math.ceil(tw + pad)));
        }

        const c  = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d');
        x.font = font;
        // Fret / open-string digits: anchor from actualBoundingBox so the
        // glyph sits at the true optical centre of the canvas (fixes
        // sprites looking off-centre inside the board ghost and elsewhere).
        const inkCenterFret = !wide && (sName === 'noteFret' || sName === 'open');
        // Ghost fret labels live on a PlaneGeometry Mesh (UV-direct), not a Sprite
        // billboard.  Sprites tolerate slight canvas off-centering because Three.js
        // centres them at their world position; a Mesh does not — the digit lands
        // wherever it sits in UV space.  Use the advance-width centre as the initial
        // pen position and then correct for any ink asymmetry via actualBoundingBox.
        const inkCenterGhost = !wide && sName === 'ghostFret';
        let drawX = w / 2;
        let drawY = h / 2;
        if (inkCenterFret) {
            x.textAlign = 'left';
            x.textBaseline = 'alphabetic';
            const m = x.measureText(str);
            const L = m.actualBoundingBoxLeft;
            const R = m.actualBoundingBoxRight;
            const A = m.actualBoundingBoxAscent;
            const D = m.actualBoundingBoxDescent;
            if (
                L != null && R != null && A != null && D != null &&
                Number.isFinite(L) && Number.isFinite(R) &&
                Number.isFinite(A) && Number.isFinite(D)
            ) {
                const inkW = R - L;
                drawX = (w - inkW) / 2 - L;
                drawY = (h + A - D) / 2;
                // Tab digits sit visually a hair low vs bbox (stroke/shadow);
                // small canvas nudge keeps sprites centred on the board ghost.
                if (sName === 'noteFret') drawY -= h * 0.028;
            } else {
                x.textAlign = 'center';
                x.textBaseline = 'middle';
                drawX = w / 2;
                drawY = h / 2;
            }
        } else if (inkCenterGhost) {
            // Alpha-weighted centroid approach on FILL-ONLY ink (no shadow, no
            // stroke) to find the true ink centre of mass without contamination
            // from the isotropic shadow blur.  For Arial Black "1" the shadow from
            // the thin upper-left flag bleeds leftward and cancels part of the
            // rightward correction when we include it in the scan.  Measuring fill
            // alone isolates the actual glyph shape.
            // 1. Draw fill-only (no shadow, no stroke) at (w/2, h/2) on temp canvas.
            // 2. Compute Σ(px·alpha) / Σ(alpha) → ink centroid.
            // 3. Shift drawX/drawY so centroid lands exactly at (w/2, h/2).
            // Max 4 unique digits (1–4) → cache-miss runs at most 4 times ever.
            x.textAlign = 'center';
            x.textBaseline = 'middle';
            try {
                const tmpC = document.createElement('canvas');
                tmpC.width = w; tmpC.height = h;
                const tc = tmpC.getContext('2d');
                tc.font = font;
                tc.textAlign = 'center';
                tc.textBaseline = 'middle';
                // Deliberately NO shadow and NO stroke — shadow spreads isotropically
                // and muddles the centroid; fill alone gives the cleanest reading.
                tc.fillStyle = '#ffffff';
                tc.fillText(str, w / 2, h / 2);
                const id = tc.getImageData(0, 0, w, h).data;
                // Alpha-weighted centroid — heavier ink pixels (thick vertical stem
                // of "1") outweigh thin/sparse pixels (diagonal flag), producing the
                // correct perceptual centre rather than the geometric bbox midpoint.
                let sumX = 0, sumY = 0, sumA = 0;
                for (let py = 0; py < h; py++) {
                    for (let px = 0; px < w; px++) {
                        const a = id[(py * w + px) * 4 + 3];
                        if (a > 4) { sumX += px * a; sumY += py * a; sumA += a; }
                    }
                }
                if (sumA > 0) {
                    // shift pen so centroid → canvas centre, then add a small
                    // extra rightward nudge (8 %) so the vertical stroke of
                    // narrow digits like "1" sits visually at gem centre rather
                    // than the advance-width centre (which may be slightly left
                    // of the dominant ink mass for Arial Black numerals).
                    drawX = w / 2 + (w / 2 - sumX / sumA) + w * 0.08;
                    drawY = h / 2 + (h / 2 - sumY / sumA);
                }
            } catch (_) { /* fallback: draw at (w/2, h/2) */ }
            // x (real canvas) still has textAlign='center'; textBaseline='middle'
        } else {
            x.textAlign = 'center';
            x.textBaseline = 'middle';
        }
        if (sp.shadow) {
            x.shadowColor   = sp.shadow.color;
            x.shadowBlur    = sp.shadow.blur;
            x.shadowOffsetX = sp.shadow.dx;
            x.shadowOffsetY = sp.shadow.dy;
        }
        if (sp.stroke && sp.strokeW > 0) {
            x.lineJoin    = 'round';
            x.miterLimit  = 2;
            x.strokeStyle = sp.stroke;
            x.lineWidth   = sp.strokeW;
            x.strokeText(str, drawX, drawY);
        }
        x.fillStyle = col;
        x.fillText(str, drawX, drawY);
        const mat = new T.SpriteMaterial({
            map: new T.CanvasTexture(c),
            transparent: true,
            // depthTest:false means later geometry never *fails* depth
            // against these sprites, but without depthWrite:false the
            // sprites still write to the depth buffer (Three.js default
            // is depthWrite:true even for SpriteMaterial). That can
            // make subsequent sprites/labels vanish — match the
            // pattern used by the other sprite materials in this file.
            depthTest: false,
            depthWrite: false,
        });
        txtCache[k] = mat;
        return mat;
    }

    function pinchHarmonicMat(col) {
        const baseCol = new T.Color(col != null ? col : '#ffd84d');
        // v5 — compact concentric ellipses:
        //   1. black outer border  rx=0.430h ry=0.255h
        //   2. string-color body   rx=0.418h ry=0.232h
        //   3. black inner ring    rx=0.407h ry=0.218h
        //   4. string-color inner  rx=0.264h ry=0.218h
        //   5. black center dot    rx=0.134h ry=0.120h
        const k = 'technique|pinchHarmonicIcon|rs2014-v5b|' + baseCol.getHexString();
        if (txtCache[k]) return txtCache[k];

        const h = 512;
        const c = document.createElement('canvas');
        c.width = h; c.height = h;
        const x = c.getContext('2d');
        const TAU = Math.PI * 2;
        const colStr = `rgb(${Math.round(baseCol.r * 255)},${Math.round(baseCol.g * 255)},${Math.round(baseCol.b * 255)})`;

        x.clearRect(0, 0, h, h);
        x.save();
        x.translate(h / 2, h / 2);

        // Form 1 — black outer border
        x.fillStyle = '#000000';
        x.beginPath(); x.ellipse(0, 0, h * 0.430, h * 0.255, 0, 0, TAU); x.fill();

        // Form 2 — string-color main body
        x.fillStyle = colStr;
        x.beginPath(); x.ellipse(0, 0, h * 0.418, h * 0.232, 0, 0, TAU); x.fill();

        // Form 3 — black inner ring
        x.fillStyle = '#000000';
        x.beginPath(); x.ellipse(0, 0, h * 0.407, h * 0.218, 0, 0, TAU); x.fill();

        // Form 4 — string-color inner spot (narrower)
        x.fillStyle = colStr;
        x.beginPath(); x.ellipse(0, 0, h * 0.2637, h * 0.218, 0, 0, TAU); x.fill();

        // Form 5 — black center dot
        x.fillStyle = '#000000';
        x.beginPath(); x.ellipse(0, 0, h * 0.134, h * 0.120, 0, 0, TAU); x.fill();

        x.restore();

        const mat = new T.SpriteMaterial({
            map: new T.CanvasTexture(c),
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });
        txtCache[k] = mat;
        return mat;
    }

    function naturalHarmonicMat() {
        const k = 'technique|naturalHarmonicIcon|pink-ring-v3';
        if (txtCache[k]) return txtCache[k];

        const h = 256;
        const c = document.createElement('canvas');
        c.width = h; c.height = h;
        const x = c.getContext('2d');
        const cx = h / 2;
        const cy = h / 2;
        const TAU = Math.PI * 2;

        x.clearRect(0, 0, h, h);

        const glow = x.createRadialGradient(cx, cy, h * 0.03, cx, cy, h * 0.47);
        glow.addColorStop(0, 'rgba(255,170,255,0.14)');
        glow.addColorStop(0.55, 'rgba(0,0,0,0.22)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = glow;
        x.beginPath();
        x.arc(cx, cy, h * 0.44, 0, TAU);
        x.fill();

        x.shadowColor = 'rgba(0,0,0,0.85)';
        x.shadowBlur = 14;
        x.fillStyle = 'rgba(255, 255, 255, 0.96)';
        x.beginPath();
        x.arc(cx, cy, h * 0.31, 0, TAU);
        x.fill();

        // Punch out the inner gap so the icon reads as a bright ring.
        x.shadowBlur = 0;
        x.globalCompositeOperation = 'destination-out';
        x.beginPath();
        x.arc(cx, cy, h * 0.20, 0, TAU);
        x.fill();
        x.globalCompositeOperation = 'source-over';

        x.shadowColor = 'rgba(0, 0, 0, 0.7)';
        x.shadowBlur = 10;
        x.strokeStyle = 'rgba(255, 255, 255, 0.98)';
        x.lineWidth = 8;
        x.beginPath();
        x.arc(cx, cy, h * 0.255, 0, TAU);
        x.stroke();

        x.shadowColor = 'rgba(0,0,0,0)';
        x.fillStyle = 'rgba(255, 255, 255, 0.98)';
        x.beginPath();
        x.arc(cx, cy, h * 0.12, 0, TAU);
        x.fill();

        const mat = new T.SpriteMaterial({
            map: new T.CanvasTexture(c),
            transparent: true,
            depthTest: false,
            depthWrite: false,
            opacity: 0.96,
        });
        txtCache[k] = mat;
        return mat;
    }

    // Only two PM/FH variants exist (palm-mute = black-on-white,
    // fret-hand mute = white-on-black). drawNote() hits muteXMat per
    // muted chord-note per frame, so dense PM/FH passages were paying
    // for a string concat + Map lookup on every call. Hoist both
    // SpriteMaterial refs and short-circuit before touching the cache.
    // They're populated lazily on first use; teardown still reaches
    // them via the shared ``txtCache`` because muteXMat writes there.
    let _pmXSpriteMat = null;
    let _fhXSpriteMat = null;
    function palmMuteXSpriteMat() {
        return _pmXSpriteMat ?? (_pmXSpriteMat = muteXMat('#000000', '#ffffff'));
    }
    function fretHandMuteXSpriteMat() {
        return _fhXSpriteMat ?? (_fhXSpriteMat = muteXMat('#ffffff', '#000000'));
    }

    function muteXMat(fillCol, strokeCol) {
        const k = 'technique|muteX|v2|' + String(fillCol) + '|' + String(strokeCol);
        if (txtCache[k]) return txtCache[k];

        // lineCap:'square' gives flat tips. For a 45° diagonal the square-cap
        // corners sit at ±outerW/2 rotated 45° from the endpoint — they land
        // outside the canvas unless pad ≥ outerW/√2 (the common mistake is
        // using outerW/2, which is too small). With the correct pad the white
        // cap is fully inside the canvas and the border is visible at every tip.
        const h = 512;
        const outerW = 132, innerW = 114;
        // pad must satisfy: pad ≥ outerW / Math.SQRT2  (≈ outerW × 0.707)
        const pad = Math.ceil(outerW / Math.SQRT2) + 2; // 96
        const c = document.createElement('canvas');
        c.width = h; c.height = h;
        const x = c.getContext('2d');

        x.clearRect(0, 0, h, h);
        x.lineCap = 'square';

        // Draw each diagonal in its own stroke() call — caps of the two
        // diagonals don't interact, and the white outer is drawn before the
        // black inner so the border is clean at every edge and tip.
        x.strokeStyle = strokeCol;
        x.lineWidth = outerW;
        x.beginPath(); x.moveTo(pad, pad); x.lineTo(h - pad, h - pad); x.stroke();
        x.beginPath(); x.moveTo(h - pad, pad); x.lineTo(pad, h - pad); x.stroke();

        x.strokeStyle = fillCol;
        x.lineWidth = innerW;
        x.beginPath(); x.moveTo(pad, pad); x.lineTo(h - pad, h - pad); x.stroke();
        x.beginPath(); x.moveTo(h - pad, pad); x.lineTo(pad, h - pad); x.stroke();

        const mat = new T.SpriteMaterial({
            map: new T.CanvasTexture(c),
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });
        txtCache[k] = mat;
        return mat;
    }

    // Technique-marker sprite materials (triangle / chevron). Keyed by a
    // packed NUMBER, not a string — triMat/bendChevronMat are called from
    // the drawNote hot path, so a string cache key would allocate per
    // note per frame. Disposed in teardown. `hex` is a 0xRRGGBB number;
    // the low nibble of the key tags the variant (0 ▲, 1 ▼, 3-6 chevron
    // step-count) so triangle and chevron entries can't collide.
    const _techMatCache = new Map();

    // Hammer-on / pull-off triangle marker: a white ▲ (up) / ▼ (down)
    // with a thick border in the gem's string colour.
    function triMat(up, hex) {
        const h = (hex >>> 0) & 0xffffff;
        const key = h * 16 + (up ? 0 : 1);
        const cached = _techMatCache.get(key);
        if (cached) return cached;
        const S = 256, m = S * 0.15;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        g.beginPath();
        if (up) { g.moveTo(S / 2, m); g.lineTo(S - m, S - m); g.lineTo(m, S - m); }
        else    { g.moveTo(S / 2, S - m); g.lineTo(S - m, m); g.lineTo(m, m); }
        g.closePath();
        g.lineJoin = 'round';
        g.fillStyle = '#ffffff';
        g.fill();
        g.lineWidth = S * 0.122;
        g.strokeStyle = '#' + (hex >>> 0).toString(16).padStart(6, '0');
        g.stroke();
        const mat = new T.SpriteMaterial({
            map: new T.CanvasTexture(c), transparent: true,
            depthTest: false, depthWrite: false,
        });
        _techMatCache.set(key, mat);
        return mat;
    }

    // Strength-of-bend chevron stack: `steps` (1-4) chevrons in the gem's
    // string colour (chart-format bend notation — 1 per half-step).
    function bendChevronMat(steps, hex) {
        const h = (hex >>> 0) & 0xffffff;
        const key = h * 16 + 2 + steps;   // steps 1-4 → low nibble 3-6
        const cached = _techMatCache.get(key);
        if (cached) return cached;
        const S = 256;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        g.strokeStyle = '#' + (hex >>> 0).toString(16).padStart(6, '0');
        g.lineWidth = S * 0.10;
        g.lineJoin = g.lineCap = 'round';
        const padX = S * 0.18;
        const rowH = S / steps;
        const amp = Math.min(rowH * 0.55, S * 0.24);
        for (let i = 0; i < steps; i++) {
            const cy = (i + 0.5) * rowH;
            g.beginPath();
            g.moveTo(padX, cy + amp * 0.5);
            g.lineTo(S / 2, cy - amp * 0.5);
            g.lineTo(S - padX, cy + amp * 0.5);
            g.stroke();
        }
        const mat = new T.SpriteMaterial({
            map: new T.CanvasTexture(c), transparent: true,
            depthTest: false, depthWrite: false,
        });
        _techMatCache.set(key, mat);
        return mat;
    }

    // Darken a 0xRRGGBB colour by `factor` (0..1) for the slide-arrow
    // marker — full string colour is too bright next to the gem.
    function darkenHex(hex, factor) {
        const h = (hex >>> 0) & 0xffffff;
        const r = Math.round(((h >> 16) & 0xff) * factor);
        const g = Math.round(((h >> 8) & 0xff) * factor);
        const b = Math.round((h & 0xff) * factor);
        return (r << 16) | (g << 8) | b;
    }

    // Slide-direction arrow (›/‹): a filled triangle pointing toward the
    // slide's destination fret, in the gem's (darkened) string colour.
    // `hex` here is already the darkened colour — keep its own cache-key
    // nibble range (8/9) so it can't collide with triMat (0/1) or
    // bendChevronMat (3-6).
    function slideArrowMat(pointRight, hex) {
        const h = (hex >>> 0) & 0xffffff;
        const key = h * 16 + 8 + (pointRight ? 0 : 1);
        const cached = _techMatCache.get(key);
        if (cached) return cached;
        const S = 256, m = S * 0.18;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        g.beginPath();
        if (pointRight) { g.moveTo(S - m, S / 2); g.lineTo(m, m); g.lineTo(m, S - m); }
        else            { g.moveTo(m, S / 2); g.lineTo(S - m, m); g.lineTo(S - m, S - m); }
        g.closePath();
        g.fillStyle = '#' + h.toString(16).padStart(6, '0');
        g.fill();
        const mat = new T.SpriteMaterial({
            map: new T.CanvasTexture(c), transparent: true,
            depthTest: false, depthWrite: false,
        });
        _techMatCache.set(key, mat);
        return mat;
    }

    function _meshMatForGhostFretDigit(spriteMat) {
        let mb = spriteMat.userData.h3dGhostFretMeshMat;
        if (!mb) {
            mb = new T.MeshBasicMaterial({
                map: spriteMat.map,
                transparent: true,
                depthTest: false,
                depthWrite: false,
            });
            spriteMat.userData.h3dGhostFretMeshMat = mb;
        }
        return mb;
    }

    /**
     * Convert any SpriteMaterial to a MeshBasicMaterial that shares its canvas
     * texture, so technique markers can be applied to a rotatable PlaneGeometry
     * mesh instead of a billboard Sprite. Cached on userData to avoid allocations.
     *
     * The cache is multi-entry: each pTechPlane mesh holds a Map<sm.map,
     * clone> so a recycled mesh that's used for several techniques
     * (hammer-on, palm-mute, harmonic, bend...) across frames keeps a
     * clone for each one rather than disposing-and-recloning on every
     * switch. With nStr-wide chords containing mixed PM/FH/HO/HP
     * markers this collapses the per-frame allocation entirely while
     * still being bounded — the per-mesh Map has at most one entry per
     * distinct technique × colour the mesh has ever been used for.
     */
    function _spriteMat2MeshMat(mesh, sm) {
        let perMesh = mesh.userData.h3dTechMeshMatCloneByMap;
        if (perMesh) {
            const hit = perMesh.get(sm.map);
            if (hit) return hit;
        }

        let base = sm.userData.h3dTechMeshMat;
        if (!base) {
            base = new T.MeshBasicMaterial({
                map: sm.map,
                transparent: true,
                // depthTest: false — cross-note Z ordering is handled by
                // per-note renderOrderForLayerAtZ(...) calls rather than the
                // depth buffer. This is necessary because close notes often use
                // mGlow (depthWrite:false), so the depth buffer can't reliably
                // occlude far markers near the hit line. With per-note renderOrder,
                // far labels render first and close note geometry renders last,
                // appearing on top without depthTest.
                depthTest: false,
                depthWrite: false,
                // forceSinglePass accompanies EVERY transparent DoubleSide
                // material in this file: without it, Three r158+ renders
                // each such object in TWO passes (back side then front),
                // setting material.needsUpdate on both — which forces a
                // full getParameters/program-cache lookup per object per
                // frame (profiled at ~4% of throttled main-thread time)
                // and doubles the draw calls. The two-pass path exists to
                // fix self-occlusion sorting on closed transparent meshes;
                // all our DoubleSide materials are flat unlit quads
                // (labels, rails, frames, lanes) where it buys nothing.
                side: T.DoubleSide, forceSinglePass: true,
            });
            sm.userData.h3dTechMeshMat = base;
        }
        // First conversion for this mesh: the pTechPlane pool factory gave
        // it a placeholder MeshBasicMaterial that the caller is about to
        // overwrite with the clone below. Dispose it now — once
        // mesh.material is reassigned the placeholder is orphaned and
        // teardown's scene.traverse() pass can no longer reach it, so it
        // would leak one GPU material per pooled mesh for the renderer's
        // lifetime.
        if (!perMesh && mesh.material && mesh.material !== base) {
            mesh.material.dispose?.();
        }
        if (!perMesh) {
            perMesh = new Map();
            mesh.userData.h3dTechMeshMatCloneByMap = perMesh;
        }
        const clone = base.clone();
        perMesh.set(sm.map, clone);
        _techMeshMatClones.add(clone);
        return clone;
    }

    function dispose() {
        for (const k in txtCache) {
            const tm2 = txtCache[k];
            tm2.userData.h3dGhostFretMeshMat?.dispose?.();
            tm2.userData.h3dGhostFretMeshMat = null;
            tm2.userData.h3dTechMeshMat?.dispose?.();
            tm2.userData.h3dTechMeshMat = null;
            tm2.map?.dispose();
            tm2.dispose();
        }
        txtCache = {};
        for (const tm2 of _techMatCache.values()) {
            tm2.map?.dispose();
            tm2.dispose();
        }
        _techMatCache.clear();
        for (const m of _techMeshMatClones) m?.dispose?.();
        _techMeshMatClones.clear();
    }

    return {
        dispose,
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
    };
}
