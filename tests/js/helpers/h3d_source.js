'use strict';
// The highway_3d plugin was split from one 15.7k-line screen.js IIFE into an
// ES-module tree under plugins/highway_3d/src/. Tests that used to regex-scan
// or vm-execute screen.js consume this helper instead: it concatenates the
// module tree with import/export syntax stripped, reproducing the old
// single-scope script text.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const PLUGIN_DIR = path.join(ROOT, 'plugins', 'highway_3d');
const SRC_DIR = path.join(PLUGIN_DIR, 'src');

function srcFiles() {
    const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
    // main.js stitches the tree together; it goes last so its top-level code
    // sees every other module's declarations when the concatenation is eval'd.
    const rest = files.filter((f) => f !== 'main.js');
    return [...rest, 'main.js'].map((f) => path.join(SRC_DIR, f));
}

function stripModuleSyntax(src) {
    return src
        .replace(/^import[^;]*;[ \t]*$/gm, '')
        .replace(/^export\s*\{[^}]*\}\s*;[ \t]*$/gm, '')
        .replace(/^export\s+(?=const|let|var|function|class|async)/gm, '');
}

let _cache = null;
function h3dSource() {
    if (_cache === null) {
        _cache = srcFiles().map((p) => stripModuleSyntax(fs.readFileSync(p, 'utf8'))).join('\n');
    }
    return _cache;
}

function h3dFile(rel) {
    return fs.readFileSync(path.join(PLUGIN_DIR, rel), 'utf8');
}

module.exports = { h3dSource, h3dFile, srcFiles };
