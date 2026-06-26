import { test, expect } from '@playwright/test';

// The Audio Engine plugin (`audio_engine`) is bundled only in the desktop
// build, so stub /api/plugins to make it present here. Asserts it renders as a
// promoted sidebar entry in the v3 "HOME" group, immediately AFTER the Settings
// entry, and routes to its plugin screen.
const STUB_PLUGINS = [
  { id: 'audio_engine', name: 'Audio Engine', nav: { label: 'Audio', screen: 'audio-engine', icon: '🎸' }, status: 'ready', has_screen: false, has_settings: false },
];

test('audio_engine is promoted into the HOME nav group after Settings', async ({ page }) => {
  await page.route('**/api/plugins', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STUB_PLUGINS) }));

  await page.goto('/');
  await page.waitForSelector('#v3-nav a[data-v3-nav]', { timeout: 15000 });

  // The promoted slot is filled with the Audio Engine link.
  const aeLink = page.locator('#v3-nav-audio-engine a[data-v3-nav="audio_engine"]');
  await expect(aeLink).toHaveCount(1, { timeout: 10000 });
  await expect(aeLink).toContainText('Audio');

  // It sits inside the HOME group, immediately after the Settings entry.
  const order = await page.evaluate(() => {
    const nav = document.getElementById('v3-nav');
    const links = Array.from(nav.querySelectorAll('a[data-v3-nav]'));
    const keys = links.map(a => a.getAttribute('data-v3-nav'));
    const settingsIdx = keys.indexOf('settings');
    const aeIdx = keys.indexOf('audio_engine');
    // renderSidebar emits one wrapper <div> per group as a direct child of
    // #v3-nav: [ heading <div>GROUP</div>, items <div>…links…</div> ]. Walk up
    // from the link to that group wrapper and read its heading (first child) —
    // structural, so it doesn't depend on the heading's CSS classes.
    function groupOf(el) {
      let node = el;
      while (node && node.parentElement && node.parentElement !== nav) node = node.parentElement;
      const heading = node && node.firstElementChild;
      return heading ? heading.textContent.trim() : null;
    }
    return { settingsIdx, aeIdx, group: aeIdx >= 0 ? groupOf(links[aeIdx]) : null };
  });
  expect(order.settingsIdx).toBeGreaterThanOrEqual(0);
  expect(order.aeIdx).toBe(order.settingsIdx + 1);
  expect(order.group).toBe('HOME');

  // It targets the plugin's own screen.
  await expect(aeLink).toHaveAttribute('href', '#/audio_engine');
});
