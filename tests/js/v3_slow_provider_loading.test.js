// Pins the slow-library-provider loading states in the classic and v3 library
// surfaces. Providers can declare `slow: true`; the UI should show explicit
// wait copy plus a status region instead of silently blanking while fetches run.

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const SONGS = fs.readFileSync(path.join(root, 'static', 'v3', 'songs.js'), 'utf8');
const APP = fs.readFileSync(path.join(root, 'static', 'app.js'), 'utf8');

test('v3 Songs slow providers get explicit loading copy', () => {
    assert.match(SONGS, /function providerLoadingText\(\)[\s\S]*?provider\.slow\s*===\s*true[\s\S]*?this source may take a while\./,
        'v3 providerLoadingText must branch on provider.slow and explain the longer wait');
    assert.match(SONGS, /function loadingPanelHtml\(\)[\s\S]*?providerLoadingText\(\)/,
        'v3 grid loading panel must render the provider-aware loading message');
});

test('v3 loading indicators are announced as polite status regions', () => {
    assert.match(SONGS, /function loadingPanelHtml\(\)[\s\S]*?role="status"\s+aria-live="polite"/,
        'v3 grid loading panel must be a polite status region');
    assert.match(SONGS, /loadAlbums[\s\S]*role="status"\s+aria-live="polite"[\s\S]*providerLoadingText\(\)/,
        'v3 albums loading state must be a polite status region');
    assert.match(SONGS, /loadTree[\s\S]*role="status"\s+aria-live="polite"[\s\S]*providerLoadingText\(\)/,
        'v3 list loading state must be a polite status region');
});

test('classic library loading indicator is announced and uses slow provider copy', () => {
    assert.match(APP, /function _setLibraryLoadingMessage[\s\S]*?role="status"\s+aria-live="polite"/,
        'classic library loading card must be a polite status region');
    assert.match(APP, /function _libraryLoadingText\(\)[\s\S]*?provider\.slow\s*===\s*true[\s\S]*?this source may take a while\./,
        'classic library loading text must branch on provider.slow');
});