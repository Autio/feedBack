# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- The classic v2 UI shell is gone — v3 is the only UI (R3a).

### Fixed
- The packaged desktop app could not start (`ModuleNotFoundError` for root-level modules the bundler did not copy); guarded by `tests/test_packaging.py`.

### Added
- Perf harness now measures 2D-highway frame time (R3c gate).
- `routers/` — extracting `server.py`'s route layer, cheapest-first (R3).
- `routers/` — the first extracted route module (R3).
- `lib/enrichment.py` — the metadata-enrichment subsystem leaves `server.py` (R3, move-only).
- `appstate.py` — the router seam (R3).

### Changed
- **`AudioEffectsMappingDB` moved out of `server.py` into `lib/audio_effects_db.py`
- `MetadataDB` moved out of `server.py` into `lib/metadata_db.py` (R3, move-only).

### Added
- Plugins can ship an ES-module `src/` tree (module-migration rails, R0).
- Module-migration governance & rails (R0).
- Perf-baseline harness (R0).
- Sort and filter the library by your personal difficulty rating — now visible at a glance, not just in the edit drawer.
- **`lib/midi_import.py`: `convert_midi_tempo_map` — MIDI imports can finally carry

### Fixed
- Tuner: opening the player screen no longer throws `NotFoundError` and aborts the player render (feedBack#800).
- Auto-sync: DTW step constraint — riff-based songs no longer produce garbage sync points.

### Added
- 3D Keys Highway: key layout modes, lane-color opacity & octave lines.
- Unmapped-percussion capture now records velocities alongside times.
- Handedness (left-handed) is now a first-class choice in the instrument selector — and surfaced during onboarding.
- "Colorblind (deuteranope)" highway string-color preset.
- `lib/gp_autosync.py`: piecewise time-warp helpers + a working `refine_sync()`.
- Playlist shuffle.

### Changed
- Player frame-time hotspots removed (trace-backed) + weak-hardware hardening.

### Fixed
- `playback.loop-api` bridge no longer fires dozens of times per second.
- 3D Highway: recover from a WebGL context loss instead of crashing on alt-tab.
- Guitar Pro 6 (`.gpx`) import no longer fails on every real file.
- v3 Songs grid: fixed the scroll stutter that "skips every so many scrolls," up or down.
- Starter content seeds again (and now ships The Adicts' "Ode to Joy").
- Edit Metadata now writes into `.feedpak` files, not just legacy `.sloppak` ones.
- 3D Drum & Keys highways now re-frame on fullscreen/layout drift under splitscreen.
- Tuner: finished the "remove unused settings" cleanup and fixed the sidebar panel position.

### Added
- Host theme read surface — `window.feedBack.theme` + always-present `--fbv-*` tokens — so a plugin feature can render correctly under any theme instead of binding to whichever one the developer happened to see.
- 3D Keys Highway: audio-reactive background ambience + score effects (parity slice 4 — completes the keys side of the visual-parity epic).
- 3D Keys Highway: the anti-plastic pass — lacquered note gems, glossy piano-black keys, a studio environment, scene themes and a gradient sky (parity slice 3).
- 3D Drum Highway: audio-reactive background ambience + score effects (parity slice 4 — completes the drum side of the visual-parity epic).
- 3D Drum Highway: real materials + scene themes (parity slice 3).
- 3D Drum Highway: hit FX — sparks, timing-colored lane flashes, kick camera pulse, approach glow, and open hi-hat notation (parity slice 2).
- 3D Keys Highway: hit FX — vibrant note gems, timing-colored sparks, and a hit-line that reacts to your playing (parity slice 2).
- 3D Drum Highway: bloom glow + adaptive-resolution support — the first slice of visual parity with the guitar highway.
- 3D Keys Highway: sharp HiDPI rendering, bloom glow, a live combo HUD, and a graphics settings panel — the first slice of visual parity with the guitar highway.
- The 3D Drum Highway and 3D Keys Highway are now bundled core plugins.
- The tuner now tracks what tuning your instrument is *actually* in, so it prompts you to retune in BOTH directions — down to a song's tuning, and back up when the next song needs it.
- `.jsonc` support for feedpak data files.
- The highway now loads the part that matches your selected instrument — a bass player gets the Bass arrangement, not the default Lead/guitar chart.
- Host "working tuning" — a live, app-wide record of what tuning your instrument is *actually* in right now (foundation; no behavior change yet).
- The v3 Songs grid is now DOM-virtualized — card-node count stays bounded no matter how big the library is or how far you scroll.
- Keyset (cursor) pagination for the library grid — the data layer for an upcoming virtualized grid, and a latent paging bug fixed along the way.
- Smart collections — save a set of library filters as a live, auto-updating source.
- The settings backup now includes your library database + custom art — your scores, favorites, playlists, and play history are no longer the one thing a backup can't save.
- A persisted wishlist — keep a list of songs you want but don't own yet.
- Practice-aware library home — a "Repertoire" meter + a "Keep practicing" shelf on the v3 Songs page.
- A–Z fast-scroll rail on the v3 Songs grid.
- Playlists get content-dependent covers + custom art.
- v3 Songs: "Add to playlist" is now on each song's ⋮ "More" menu.
- Resume where you left off — leaving a song now snapshots your place so an exit is recoverable, not a restart-from-zero.
- Optional "Ask before leaving a song" confirm (Gameplay tab, default OFF).
- Folder Library — a bundled core plugin (`plugins/folder_library/`) that browses the DLC library by its on-disk folder tree.
- Full-screen (immersive) plugin screens — opt-in via `"fullscreen": true` in `plugin.json`.
- Achievements wall sync — background drain worker (epic PR3, client side).
- Achievements wall — opt-in, privacy controls & data-minimization gate (epic PR2).
- Achievements & Feats of Power — local engine + tabbed Profile (epic PR1).
- v3 settings page redesigned as a tabbed, card-row layout.
- Full-mix audio exposed alongside stems for the stem mixer's auto-switch.
- Autoplay & auto-exit — a global "click it, it plays; finish, you're back at the menu" option (default ON).
- "Song Editor" promoted to a first-class v3 sidebar item.
- Guitar Pro → notation importer (`lib/gp2notation.py`).
- Legacy keys → notation lifter (`scripts/lift_keys_notation.py`).
- Notation schema v1 freeze — completeness batch.
- Notation format — standard musical notation as a first-class sloppak type.
- `song_timeline.json` — beats and sections as a top-level file.
- `note-detection` capability domain promoted — control plane (spec 009).
- `visualization` capability domain promoted (cap:6).
- Viz picker routes notation arrangements.
- Keys instrument path in progression.
- v3 library: exact artist/album filters + scroll/page-depth restore.

### Fixed
- GP8 multi-staff (piano/keys) tracks now import both hands — the bass stave was being silently dropped, and hand-splits landed on the wrong hand.
- Tuner auto-open is now opt-in and persists instead of flashing open-then-shut.
- Tuner auto-open is now tuning-coverage-aware — extended-range players aren't nagged for songs their instrument already covers.
- The tuner badge now passively flags when a song needs a different tuning — and names the retune.
- Tuner auto-open can now gate playback until you've tuned — the "tune before you play" model — via a new core `holdAutoplay()` hook.
- v3 Songs List View: favoriting a song now turns the heart red immediately (no re-search needed).
- v3 Songs A–Z rail: taps now land reliably, a drag releases exactly on the let-go letter, and the rail is large enough to hit on hi-res displays.
- v3 player: opening another rail popover now closes the Section Practice popover (no more two stacked popovers).
- v3 UI no longer lets you accidentally text-select the chrome.
- Input-setup wizard no longer collapses an audio device's driver-type variants into one entry.
- 3D Highway FPS counter no longer hides behind the v3 "Up Next" pill.
- 3D Highway fret-number row no longer clips off the bottom edge when the camera zooms in on a centred span.
- v3 Songs grid now refreshes after a Settings rescan / DLC-folder change — no app restart needed.
- Edit Metadata modal: the Year is now editable.
- Edit Metadata modal no longer closes when a click-drag is released on the backdrop.
- Built-in diagnostic sloppak rebranded "Slopsmith" → "FeedBack" in the song name.
- v3 song/lesson accuracy badges now refresh on the first return from a song — no restart needed.
- Escape now exits a song (and leaves Settings) even when a transport/rail control button holds keyboard focus.
- The v3 "Up Next" pill can now be turned off — new "Show 'Up Next'" gameplay toggle (default ON).
- v3 list/tree view brought to parity with the grid: select mode, parts chips, and song actions — plus a stale-CSS Docker fix.
- Space bar now plays/pauses on the player screen even when a sidebar nav link or rail button has focus.
- A song's accuracy badge now updates on its library card right after you play it — no restart needed.
- Changing Settings → 3D Highway → Fret spacing no longer ejects you to the home screen.
- v3 library scroll-restore no longer breaks the classic v2 UI or drops off-screen searches.
- An active custom highway renderer is no longer starved of `draw()` when it hides the canvas.
- Screensaver no longer kicks in during windowed-mode playback.

### Changed
- Practice plugin first-class sidebar slot now points at Virtuoso.
- 3D highway: realistic curved metal frets.
- 3D highway: section + tone HUD cards now default OFF.
- Perf.
- Perf.
- Perf.

### Removed
- `c` library hotkey ("Convert to .sloppak") removed from core.

### Added
- Player progression: Mastery Rank, instrument-path challenges, daily/weekly quests, Decibels currency, cosmetics shop (spec 010).
- 3D highway score FX (notedetect game-scoring layer).
- 3D highway: slide direction arrows + gem-follow animation.
- 3D highway: up to 3 upcoming-note ghost previews per string, with fade-in/grow.
- Enable/disable plugins from the v3 Pedalboard (footswitch backend).
- fee[dB]ack v0.3.0 rebrand + UI redesign (opt-in, isolated).
- fee[dB]ack v0.3.0 app shell (sidebar + topbar + routing).
- fee[dB]ack v0.3.0 player profile + first-run onboarding + unified XP + streak.
- fee[dB]ack v0.3.0 song-stats store (best score + accuracy, plays, resume position).
- fee[dB]ack v0.3.0 playlists, Saved for Later, and Continue-Playing.
- fee[dB]ack v0.3.0 Dashboard / Home.
- fee[dB]ack v0.3.0 tuner + instrument topbar badges.
- fee[dB]ack v0.3.0 audio-routing widget (dashboard).
- fee[dB]ack v0.3.0 Plugins page.
- fee[dB]ack v0.3.0 Songs / Library screen (`#v3-songs`).
- `ui.library-card-injection` capability + native song-card actions (fee[dB]ack v0.3.0).
- `centOffset` exposed via `getSongInfo()`.
- `highway.getPhrases()` and `highway.getMastery()` public plugin API.
- Tailwind freshness guard + wider plugin scan.
- Plugin capability pipelines.
- Audio graph/session capability slice.
- Audio-mix control plane.
- Audio-input control plane.
- Audio-monitoring control plane.
- Playback control plane.
- 3D highway — Tone HUD, fret dividers, chord-diagram toggle, FPS counter.
- Sloppak assembly preserves a short preview clip.
- Generic plugin asset route.
- Minigames framework — bundled as a core plugin (`plugins/minigames/`).
- Alpha-build heads-up banner.
- Drum vocabulary expanded to 18 pieces.
- GP / MIDI drum import surfaces unmapped notes.

- Drum support from scratch.
- Loose folder support.
- Highway note-state hook (#254).
- Diagnostic bundle export (#166).
- Structured logging bootstrap (phase 1 of #155).
- Structured logging migration completed (phase 2 of #155, #159, #242).
- Lyrics Karaoke plugin.
- Settings export/import (#113).
- Library filtering by parts present or missing (#129, #69).
- Sort library by year (#128).
- `highway.getLyrics()` accessor.

### Changed
- Perf (3D highway, feedBack#226).
- License.
- Tuning sort is now ordered by musical distance from E Standard (#22) instead of alphabetical: E Standard first, then Drop D / F Standard at distance 2, then Eb Standard / F# Standard at distance 6, etc.
- Settings page restructured into separate "FeedBack" (core) and "Plugins" sections, with each plugin's settings rendered as a collapsible panel (collapsed by default).
- Lyrics Sync.

### Security
- Path traversal in archive extractors and library path resolution.

### Fixed
- E Standard retune now stays metadata-consistent across a chart's arrangement files (feedBack-plugin-notedetect#50).
- Keyboard shortcut help now opens from the Player/3D Highway context when Linux/Electron reports Shift+Slash as `key="/"`, including while player controls such as the visualization picker are focused (#598).
- 3D Highway left-handed mode now has regression coverage for fret-axis mirroring, board rebuilds on runtime lefty changes, and mirrored camera state including the lookahead target and shoulder offset; the maintainer guide no longer claims the renderer ignores `bundle.lefty` (#321).
- Chord-level `fretHandMute` is now parsed into each note's `fret_hand_mute` (wire `fhm`) instead of being folded into `mute` (`mt`), matching `_parse_note` and preserving wire-format fidelity for both the template-expanded (synthetic-note) and explicit-`chordNote` paths.
- `gp2rs` now respects the time-signature denominator when emitting ebeat subdivisions, fixing misaligned beat grids in 6/8 and other non-quarter-note meters.
- Settings dropdowns (Default Arrangement, Platform Filter) now persist immediately when changed.
- Demucs stem split failing on Windows desktop with `OSError: Could not load this library: libtorchcodec_core4.dll` or `ImportError: TorchCodec is required for save_with_torchcodec`.
- Splitscreen pop-out windows briefly flashed the library/song grid before showing the popped panel.
- Sloppak assembly dropped all tone data — affected sloppaks showed no signal chain in the Tones plugin and no tone-change markers on the highway.
- Tab View (feedBack-plugin-tabview ≥ 3.0.1): the bottom row of tablature was permanently hidden behind the player controls bar (#336).
- Tab View (feedBack-plugin-tabview ≥ 3.0.1): the cursor highlight led playback by roughly one beat (#336).

### Migration notes
- Constitution amended to 1.1.0 (Principle II — Vanilla Frontend).
- The library filters depend on three new columns (`stem_ids`, `tuning_name`, `tuning_sort_key`) that are populated as songs are scanned.

## [0.2.4] - 2026-04-22

### Added
- Version badge in navbar (`/api/version` endpoint + `VERSION` file)
- `CHANGELOG.md` and semantic versioning
- Step Mode plugin
- `gp2midi` improvements and expanded test coverage
- Note Detection plugin factory-pattern refactor with multi-instance/splitscreen support
- Per-panel note detection in Split Screen plugin with M/L/R channel routing for multi-input interfaces

### Fixed
- `SLOPPAK_CACHE_DIR` moved to `CONFIG_DIR` for AppImage compatibility
- Improved error message when plugin requirements fail to install
