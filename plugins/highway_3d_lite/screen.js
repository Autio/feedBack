// 3D Highway Lite: a minimal Three.js note highway.
//
// Draws what you need to play and nothing else: fretboard, strings, fret
// wires and numbers, notes and chords approaching in time, sustain tails,
// open-string bars, beat lines, section names, chord names, lyrics, and
// note-detection hit/miss lighting. No effects, no themes, no settings.
//
// Layout: constants, then pure layout math, then the renderer factory
// (scene setup, per-frame draw, 2D text overlay, lifecycle). One instance
// per panel; every instance owns its own scene and materials.
(function () {
    'use strict';

    const THREE_URL = '/static/vendor/three/three.module.min.js';
    let T = null;
    let _threeLoading = null;
    function loadThree() {
        if (T) return Promise.resolve(T);
        if (!_threeLoading) _threeLoading = import(THREE_URL).then((m) => { T = m; return T; });
        return _threeLoading;
    }

    // ── Layout constants ──────────────────────────────────────────────
    // World units are arbitrary; only the ratios matter.
    const NFRETS = 24;
    const FRET_W = 1.0;            // world width of one fret column
    const BOARD_W = NFRETS * FRET_W;
    const STR_GAP = 0.32;          // vertical gap between strings
    const AHEAD = 3.0;             // seconds of chart visible ahead of the line
    const BEHIND = 0.4;            // seconds a passed note lingers at the line
    const SPEED = 18;              // world units per second of chart time
    const NOTE_W = 0.44, NOTE_H = 0.24, NOTE_D = 0.1;
    const CAM_HEIGHT = 11, CAM_DIST = 13, CAM_FOCUS_Z = -12;
    const CAM_LERP = 3.0;          // per-second camera x catch-up rate
    const POOL_NOTES = 96, POOL_SUS = 48, POOL_BEATS = 48, POOL_OPEN = 12, POOL_DROPS = 96;

    // Same per-string palette as the full highway (index 0 = high E).
    const S_COL = [0xff3355, 0xffcc33, 0x3388ff, 0xff8833, 0x33cc66, 0xcc44ff, 0x22cccc, 0xdddddd];
    const HIT_COL = 0xffffff, MISS_COL = 0x661122;

    function lowerBound(arr, time, key) {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if ((arr[mid][key] || 0) < time) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    window.feedBackViz_highway_3d_lite = function () {
        // ── Per-instance state ────────────────────────────────────────
        let scene = null, cam = null, ren = null, canvas = null;
        let overlay = null, octx = null;      // 2D text layer above the WebGL canvas
        let ready = false;
        let nStr = 6, lefty = false, inverted = false;
        let camX = BOARD_W * 0.15;

        // Geometry and materials, built once in init.
        let gNote = null, gUnit = null;
        let mStr = [], mSus = [], mHit = null, mMiss = null, mBeat = null, mBeatBar = null, mOpen = [], mDrop = null;
        // Mesh pools: get() returns the next mesh, reset() hides the rest.
        let pools = null;

        // Lyrics line cache, keyed by the lyrics array reference.
        let lyricsRef = null, lyricLines = [];

        // ── Layout math ───────────────────────────────────────────────
        // Fret f occupies [x(f-1), x(f)]; a note on fret f sits mid-column.
        // Lefty mirrors the whole x axis so low frets sit on the right.
        const wireX = (f) => lefty ? BOARD_W - f * FRET_W : f * FRET_W;
        const noteX = (f) => lefty ? BOARD_W - (f - 0.5) * FRET_W : (f - 0.5) * FRET_W;
        // String s: low string at the bottom unless inverted.
        const strY = (s) => (inverted ? s : (nStr - 1 - s)) * STR_GAP;
        const zAt = (dt) => Math.min(0, -dt * SPEED);

        function makePool(count, geo, mat) {
            const meshes = [];
            for (let i = 0; i < count; i++) {
                const m = new T.Mesh(geo, mat);
                m.visible = false;
                scene.add(m);
                meshes.push(m);
            }
            let used = 0;
            return {
                get() { return used < meshes.length ? meshes[used++] : null; },
                reset() { for (let i = 0; i < used; i++) meshes[i].visible = false; used = 0; },
                dispose() { for (const m of meshes) scene.remove(m); },
            };
        }

        // ── Scene setup ───────────────────────────────────────────────
        function buildScene() {
            scene = new T.Scene();
            cam = new T.PerspectiveCamera(55, 16 / 9, 0.1, 200);

            // Board plane, stretching from the hit line into the distance.
            const boardLen = (AHEAD + BEHIND) * SPEED;
            const board = new T.Mesh(
                new T.PlaneGeometry(BOARD_W + FRET_W, boardLen),
                new T.MeshBasicMaterial({ color: 0x101522 }),
            );
            board.rotation.x = -Math.PI / 2;
            board.position.set(BOARD_W / 2, -0.05, -boardLen / 2 + BEHIND * SPEED);
            scene.add(board);

            // Fret wires: verticals on the board running away from the line.
            const wireGeo = new T.PlaneGeometry(0.03, boardLen);
            const wireMat = new T.MeshBasicMaterial({ color: 0x39405c });
            for (let f = 0; f <= NFRETS; f++) {
                const w = new T.Mesh(wireGeo, wireMat);
                w.rotation.x = -Math.PI / 2;
                w.position.set(wireX(f), -0.04, -boardLen / 2 + BEHIND * SPEED);
                scene.add(w);
            }

            // Strings: horizontal lines at the hit line, one per string.
            for (let s = 0; s < nStr; s++) {
                const line = new T.Mesh(
                    new T.PlaneGeometry(BOARD_W + FRET_W, 0.045),
                    new T.MeshBasicMaterial({ color: S_COL[s] || 0x888888 }),
                );
                line.position.set(BOARD_W / 2, strY(s), 0);
                scene.add(line);
            }

            // Shared geometries and materials for the pooled meshes.
            gNote = new T.BoxGeometry(NOTE_W, NOTE_H, NOTE_D);
            gUnit = new T.BoxGeometry(1, 1, 1);
            mStr = []; mSus = []; mOpen = [];
            for (let s = 0; s < S_COL.length; s++) {
                mStr.push(new T.MeshBasicMaterial({ color: S_COL[s] }));
                const sus = new T.MeshBasicMaterial({ color: S_COL[s], transparent: true, opacity: 0.45 });
                mSus.push(sus);
                const open = new T.MeshBasicMaterial({ color: S_COL[s], transparent: true, opacity: 0.85 });
                mOpen.push(open);
            }
            mHit = new T.MeshBasicMaterial({ color: HIT_COL });
            mMiss = new T.MeshBasicMaterial({ color: MISS_COL });
            mBeat = new T.MeshBasicMaterial({ color: 0x2a3350, transparent: true, opacity: 0.8 });
            mDrop = new T.MeshBasicMaterial({ color: 0x556077, transparent: true, opacity: 0.5 });
            mBeatBar = new T.MeshBasicMaterial({ color: 0x4a5680 });

            pools = {
                notes: makePool(POOL_NOTES, gNote, mStr[0]),
                sus: makePool(POOL_SUS, gUnit, mSus[0]),
                beats: makePool(POOL_BEATS, gUnit, mBeat),
                open: makePool(POOL_OPEN, gUnit, mOpen[0]),
                drops: makePool(POOL_DROPS, gUnit, mDrop),
            };
        }

        function disposeScene() {
            if (!scene) return;
            scene.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material && !Array.isArray(o.material)) o.material.dispose();
            });
            [...mStr, ...mSus, ...mOpen, mHit, mMiss, mBeat, mBeatBar, mDrop].forEach((m) => m && m.dispose());
            gNote && gNote.dispose();
            gUnit && gUnit.dispose();
            scene = null; cam = null; pools = null;
            mStr = []; mSus = []; mOpen = [];
        }

        // ── Per-frame drawing ─────────────────────────────────────────
        function noteMaterial(s, state) {
            if (state === 'hit' || state === 'active') return mHit;
            if (state === 'miss') return mMiss;
            return mStr[s] || mStr[0];
        }

        function noteState(bundle, n, tKey) {
            if (typeof bundle.getNoteState !== 'function') return null;
            const st = bundle.getNoteState(n, tKey);
            return st ? (typeof st === 'string' ? st : st.state) : null;
        }

        // Draws one note gem plus its sustain tail. Returns the gem's world
        // position so the overlay can label it, or null when nothing drew.
        function drawNote(bundle, n, now, tKey, labels) {
            const dt = tKey - now;
            const sus = Number(n.sus) || 0;
            if (dt > AHEAD) return;
            if (dt + sus < -BEHIND) return;
            const s = n.s | 0;
            if (s < 0 || s >= nStr) return;
            const y = strY(s);
            const state = noteState(bundle, n, tKey);

            if (n.f === 0) {
                // Open string: a flat bar across the whole board.
                if (dt >= -BEHIND) {
                    const bar = pools.open.get();
                    if (bar) {
                        bar.visible = true;
                        bar.material = state ? noteMaterial(s, state) : (mOpen[s] || mOpen[0]);
                        bar.scale.set(BOARD_W + FRET_W, NOTE_H * 0.6, NOTE_D);
                        bar.position.set(BOARD_W / 2, y, zAt(dt));
                    }
                }
            } else if (dt >= -BEHIND) {
                const gem = pools.notes.get();
                if (gem) {
                    gem.visible = true;
                    gem.material = noteMaterial(s, state);
                    gem.position.set(noteX(n.f), y, zAt(dt));
                    if (dt <= AHEAD * 0.5 && labels) labels.push({ x: noteX(n.f), y, z: zAt(dt), text: String(n.f) });
                    // Drop line: anchors the floating gem to its fret lane.
                    if (dt > 0.05) {
                        const drop = pools.drops.get();
                        if (drop) {
                            drop.visible = true;
                            drop.scale.set(0.03, y, 0.03);
                            drop.position.set(noteX(n.f), y / 2, zAt(dt));
                        }
                    }
                }
            }

            if (sus > 0 && now < tKey + sus) {
                // Tail from the gem (or the line, once passed) back to t+sus.
                const zHead = zAt(dt);
                const zTail = -(dt + sus) * SPEED;
                const len = zHead - zTail;
                if (len > 0.01) {
                    const tail = pools.sus.get();
                    if (tail) {
                        tail.visible = true;
                        tail.material = (state === 'hit' || state === 'active') ? mHit : (mSus[s] || mSus[0]);
                        tail.scale.set(NOTE_W * 0.4, NOTE_H * 0.35, len);
                        tail.position.set(n.f === 0 ? BOARD_W / 2 : noteX(n.f), y, zHead - len / 2);
                    }
                }
            }
        }

        function drawBeats(bundle, now) {
            const beats = bundle.beats || [];
            for (let i = lowerBound(beats, now - 0.1, 'time'); i < beats.length; i++) {
                const b = beats[i];
                const dt = b.time - now;
                if (dt > AHEAD) break;
                const line = pools.beats.get();
                if (!line) break;
                const strong = b.measure !== undefined && b.measure !== -1;
                line.visible = true;
                line.material = strong ? mBeatBar : mBeat;
                line.scale.set(BOARD_W + FRET_W, 0.02, strong ? 0.06 : 0.03);
                line.position.set(BOARD_W / 2, -0.03, zAt(dt));
            }
        }

        // Camera: follow the chart's anchor window when the song has one,
        // otherwise the midpoint of the notes coming in the next two seconds.
        let _lastFrameMs = 0;
        function updateCamera(bundle, now) {
            let target = null;
            const anchors = bundle.anchors || [];
            if (anchors.length) {
                let i = lowerBound(anchors, now, 'time') - 1;
                if (i < 0) i = 0;
                const a = anchors[i];
                if (a) target = noteX((a.fret || 1) + (a.width || 4) / 2);
            }
            if (target == null) {
                const notes = bundle.notes || [];
                let sum = 0, count = 0;
                for (let i = lowerBound(notes, now, 't'); i < notes.length && count < 8; i++) {
                    if (notes[i].t - now > 2) break;
                    if (notes[i].f > 0) { sum += noteX(notes[i].f); count++; }
                }
                if (count) target = sum / count;
            }
            if (target == null) target = camX;

            const ms = performance.now();
            const dts = _lastFrameMs ? Math.min(0.05, (ms - _lastFrameMs) / 1000) : 1 / 60;
            _lastFrameMs = ms;
            camX += (target - camX) * Math.min(1, CAM_LERP * dts);
            cam.position.set(camX, CAM_HEIGHT, CAM_DIST);
            cam.lookAt(camX, 0, CAM_FOCUS_Z);
        }

        // ── 2D text overlay ───────────────────────────────────────────
        function project(x, y, z) {
            const v = new T.Vector3(x, y, z).project(cam);
            if (v.z > 1) return null;
            return { x: (v.x + 1) / 2 * overlay.width, y: (1 - v.y) / 2 * overlay.height };
        }

        function buildLyricLines(lyrics) {
            const lines = [];
            let line = [];
            for (const syl of lyrics) {
                if (syl.w === '+') { if (line.length) lines.push(line); line = []; continue; }
                line.push(syl);
                if (String(syl.w).endsWith('+')) { lines.push(line); line = []; }
            }
            if (line.length) lines.push(line);
            return lines;
        }

        function lyricText(syl) {
            let w = String(syl.w);
            if (w.endsWith('+')) w = w.slice(0, -1);
            return w.endsWith('-') ? w.slice(0, -1) : w + ' ';
        }

        function drawOverlay(bundle, now, labels) {
            const W = overlay.width, H = overlay.height;
            octx.clearRect(0, 0, W, H);
            const px = Math.max(11, Math.round(H * 0.024));

            // Fret numbers along the hit line, on the dot frets.
            octx.textAlign = 'center';
            octx.textBaseline = 'top';
            octx.font = `bold ${px}px sans-serif`;
            octx.fillStyle = '#8a9bb8';
            for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]) {
                if (f > NFRETS) break;
                const p = project(noteX(f), -0.15, 0.4);
                if (p) octx.fillText(String(f), p.x, p.y);
            }

            // Fret digit on each nearby gem.
            octx.font = `bold ${px}px sans-serif`;
            octx.textBaseline = 'middle';
            for (const l of labels) {
                const p = project(l.x, l.y, l.z + NOTE_D);
                if (!p) continue;
                octx.fillStyle = '#000';
                octx.fillText(l.text, p.x + 1, p.y + 1);
                octx.fillStyle = '#fff';
                octx.fillText(l.text, p.x, p.y);
            }

            // Chord names above upcoming chords.
            const chords = bundle.chords || [];
            const templates = bundle.chordTemplates || [];
            octx.fillStyle = '#e8d080';
            for (let i = lowerBound(chords, now - 0.2, 't'); i < chords.length; i++) {
                const ch = chords[i];
                const dt = ch.t - now;
                if (dt > AHEAD) break;
                const name = templates[ch.id] && templates[ch.id].name;
                if (!name || !ch.notes || !ch.notes.length) continue;
                let topY = 0, sumX = 0, fretted = 0;
                for (const cn of ch.notes) {
                    topY = Math.max(topY, strY(cn.s | 0));
                    if (cn.f > 0) { sumX += noteX(cn.f); fretted++; }
                }
                const cx = fretted ? sumX / fretted : BOARD_W / 2;
                const p = project(cx, topY + STR_GAP, zAt(dt));
                if (p) octx.fillText(name, p.x, p.y);
            }

            // Current section, top left.
            const sections = bundle.sections || [];
            let si = lowerBound(sections, now, 'time') - 1;
            if (si >= 0 && sections[si] && sections[si].name) {
                octx.textAlign = 'left';
                octx.textBaseline = 'top';
                octx.fillStyle = '#7fd4d4';
                octx.fillText(String(sections[si].name), Math.round(W * 0.02), Math.round(H * 0.03));
            }

            // Lyrics: current line, sung portion highlighted.
            if (bundle.lyricsVisible !== false && Array.isArray(bundle.lyrics) && bundle.lyrics.length) {
                if (bundle.lyrics !== lyricsRef) {
                    lyricsRef = bundle.lyrics;
                    lyricLines = buildLyricLines(bundle.lyrics);
                }
                let cur = null;
                for (const line of lyricLines) {
                    const start = line[0].t, last = line[line.length - 1];
                    if (start <= now + 1 && now <= last.t + (last.d || 0) + 0.8) { cur = line; break; }
                }
                if (cur) {
                    octx.textBaseline = 'top';
                    octx.font = `${px + 2}px sans-serif`;
                    const parts = cur.map(lyricText);
                    const widths = parts.map((t2) => octx.measureText(t2).width);
                    const total = widths.reduce((a, b) => a + b, 0);
                    let x = (W - total) / 2;
                    const y = Math.round(H * 0.03);
                    octx.textAlign = 'left';
                    for (let i = 0; i < cur.length; i++) {
                        octx.fillStyle = cur[i].t <= now ? '#ffffff' : '#8a93a8';
                        octx.fillText(parts[i], x, y);
                        x += widths[i];
                    }
                }
            }
        }

        // ── Sizing ────────────────────────────────────────────────────
        function applySize(bundle) {
            if (!canvas || !ren) return;
            const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
            if (!w || !h) return;
            const scale = (bundle && bundle.renderScale) || 1;
            const dpr = Math.min(2, (window.devicePixelRatio || 1)) * scale;
            ren.setPixelRatio(dpr);
            ren.setSize(w, h, false);
            cam.aspect = w / h;
            cam.updateProjectionMatrix();
            if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
                overlay.width = canvas.width;
                overlay.height = canvas.height;
            }
        }

        // ── setRenderer contract ──────────────────────────────────────
        return {
            contextType: 'webgl2',

            init(cnv, bundle) {
                this.destroy();
                canvas = cnv;
                loadThree().then(() => {
                    if (!canvas) return;   // destroyed while loading
                    nStr = Math.max(3, Math.min(S_COL.length, bundle && bundle.stringCount || 6));
                    lefty = !!(bundle && bundle.lefty);
                    inverted = !!(bundle && bundle.inverted);
                    buildScene();
                    ren = new T.WebGLRenderer({ canvas, antialias: true });
                    ren.setClearColor(0x0a0e18, 1);
                    overlay = document.createElement('canvas');
                    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
                    (canvas.parentElement || document.body).appendChild(overlay);
                    octx = overlay.getContext('2d');
                    applySize(bundle);
                    ready = true;
                });
            },

            draw(bundle) {
                if (!ready || !ren) return;
                const now = bundle.currentTime || 0;

                // Rebuild when the arrangement changes shape under us.
                const wantStr = Math.max(3, Math.min(S_COL.length, bundle.stringCount || 6));
                if (wantStr !== nStr || !!bundle.lefty !== lefty || !!bundle.inverted !== inverted) {
                    nStr = wantStr; lefty = !!bundle.lefty; inverted = !!bundle.inverted;
                    disposeScene();
                    buildScene();
                }
                if (canvas.width !== ren.domElement.width || canvas.height !== ren.domElement.height) applySize(bundle);

                pools.notes.reset(); pools.sus.reset(); pools.beats.reset(); pools.open.reset(); pools.drops.reset();
                drawBeats(bundle, now);

                const labels = [];
                const notes = bundle.notes || [];
                for (let i = lowerBound(notes, now - BEHIND - 8, 't'); i < notes.length; i++) {
                    if (notes[i].t - now > AHEAD) break;
                    drawNote(bundle, notes[i], now, notes[i].t, labels);
                }
                const chords = bundle.chords || [];
                for (let i = lowerBound(chords, now - BEHIND - 8, 't'); i < chords.length; i++) {
                    const ch = chords[i];
                    if (ch.t - now > AHEAD) break;
                    for (const cn of ch.notes || []) drawNote(bundle, cn, now, ch.t, labels);
                }

                updateCamera(bundle, now);
                ren.render(scene, cam);
                drawOverlay(bundle, now, labels);

                // Let overlay plugins (fretboard, chord HUDs) keep working.
                if (window.highway && typeof window.highway.fireDrawHooks === 'function') {
                    try { window.highway.fireDrawHooks(octx, overlay.width, overlay.height); } catch (e) { /* theirs, not ours */ }
                }
            },

            resize() {
                if (ready) applySize(null);
            },

            destroy() {
                ready = false;
                disposeScene();
                if (ren) { ren.dispose(); ren = null; }
                if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
                overlay = null; octx = null; canvas = null;
                lyricsRef = null; lyricLines = [];
                _lastFrameMs = 0;
            },
        };
    };
})();
