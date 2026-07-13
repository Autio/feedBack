// Lazy, memoized loader for the vendored Three.js build.
// `T` is the live module binding every other file reads after loadThree().

/* ======================================================================
 *  Constants
 * ====================================================================== */

// Three.js is vendored under static/vendor/three/ in core (pinned r170 —
// see static/vendor/three/VERSION). The bundled plugin loads from the
// same origin to avoid the first-launch CDN round-trip and to pin the
// version against breakages from upstream Three.js drift.
const THREE_URL = '/static/vendor/three/three.module.min.js';
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

/* ======================================================================
 *  Three.js module — lazily loaded, memoized
 * ====================================================================== */

export let T = null;
let threeLoadPromise = null;
export function loadThree() {
    if (!threeLoadPromise) {
        threeLoadPromise = import(THREE_URL)
            .then(mod => { T = mod; return mod; })
            .catch(() => import(THREE_CDN)
                .then(mod => { T = mod; return mod; })
                .catch(e => {
                    console.error('[3D-Hwy] Three.js load failed:', e);
                    threeLoadPromise = null;
                    throw e;
                }));
    }
    return threeLoadPromise;
}

/* ======================================================================
 *  Splitscreen helpers
 * ====================================================================== */
