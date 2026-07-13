// 2D canvas HUD overlays drawn on the lyrics layer above the WebGL scene:
// the chord diagram (with its OffscreenCanvas render cache), the section
// and tone HUDs, and the syllable-highlighting lyrics banner. Everything
// is stateless per call except the diagram cache, cleared via
// clearDiagramCache on resize and teardown.
import { DIAG_CELL_MAX, DIAG_SIZE_MAX, DIAG_SIZE_MIN } from './geometry.js';

export function createHudOverlays() {
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

    return {
        clearDiagramCache() { _diagRenderCache.clear(); },
        _drawDiagramCached,
        drawLyrics,
        drawSectionHud,
        drawToneHud,
    };
}
