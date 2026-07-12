# FeedBack — Developer Guide

FeedBack is a self-hosted web app for browsing, playing, and practicing interactive
music notation (a guitar-hero-style note highway for real instruments), built around
the open `.sloppak`/`.feedpak` chart format. Charts come from importing Guitar Pro
(GP3–GP8) or MusicXML, or from authoring in the built-in editor. FastAPI backend,
vanilla-JS frontend (no frameworks, no bundler), plugin system for everything beyond
browse + play.

## Architecture

```
main.py                 Entry point: logging setup + uvicorn
server.py               FastAPI app: startup, scan, plugin loading, SPA shell
lib/                    All backend modules (flat imports: `from song import Song`)
  song.py               Data models (Note, Chord, Arrangement, Song) + wire format
  sloppak.py            .sloppak/.feedpak format (zip or directory)
  loosefolder.py        Loose-folder XML chart support
  metadata_db.py        SQLite persistence (library cache, stats, progression, shop)
  gp2rs.py, gp2rs_gpx.py  Guitar Pro -> arrangement XML (GP3-5 / GP6-8)
  routers/              FastAPI routers (library, song, ws_highway, settings, ...)
  appstate.py           Dependency seam: server.py publishes, routers read
static/
  v3/index.html         The single HTML page (v3 UI is the only UI)
  app.js                Frontend module root; imports static/js/*
  highway.js            Canvas-2D note highway (createHighway factory, renderer registry)
  capabilities.js       Capability registry + window.feedBack event bus
  capabilities/         Capability domain hosts (audio-session, playback, midi, ...)
  v3/                   v3 shell + feature pages (songs, profile, shop, ...)
plugins/                One dir per plugin; plugin.json manifest; see docs below
data/progression/       Gamification config (quests, shop, XP paths)
tests/                  pytest (backend), node --test (tests/js), Playwright (tests/browser)
```

Routers never import `server`; they read shared singletons (`meta_db`,
`library_providers`, ...) through the `appstate` module, which `server.py`
configures at startup.

## Running

```bash
docker compose up -d          # supported path; http://localhost:8000
python main.py                # dev only; needs pip install -r requirements.txt,
                              # PYTHONPATH=.:lib, and ffmpeg on PATH for audio
```

`DLC_DIR` (song library) and `CONFIG_DIR` (persistent state) are the only required
configuration.

## Testing

```bash
pytest                        # backend suite (pythonpath set in pyproject.toml)
npm run test:js               # JS unit tests (node --test)
npm test                      # Playwright e2e (boots app via docker compose)
npm run lint                  # ESLint: size ratchet + module hygiene
bash scripts/build-tailwind.sh  # regenerate static/tailwind.min.css (CI diffs it)
```

CI (`.github/workflows/ci.yml`) runs pytest, the JS tests, ESLint, a plugin-manifest
validator, a Tailwind freshness check, and a grep that bans `print()` in
`server.py`/`lib/`/plugin routes — use the logger from `lib/logging_setup.py`.

## Song formats

- **Sloppak / feedpak** — open song package (zip or directory): `manifest.yaml`,
  `arrangements/*.json`, `stems/*.ogg`, optional `cover.jpg` and `lyrics.json`.
  Spec: [got-feedback/feedpak-spec](https://github.com/got-feedback/feedpak-spec);
  local pointer [docs/sloppak-spec.md](docs/sloppak-spec.md), hand-editing guide
  [docs/sloppak-hand-editing.md](docs/sloppak-hand-editing.md).
- **Loose folder** — directory with arrangement XML + audio file (+ optional
  `manifest.json`, art). See `lib/loosefolder.py`.

## Plugins

Each plugin is a directory under `plugins/<id>/` with a `plugin.json` manifest
(schema: [docs/plugin-manifest.schema.json](docs/plugin-manifest.schema.json)).
Only `id` and `name` are required. A plugin can ship any combination of:

- `screen`/`script` — frontend page injected by `static/js/plugin-loader.js`.
  Set `scriptType: "module"` for a native ES-module graph
  ([docs/plugin-modules.md](docs/plugin-modules.md)).
- `routes` — `routes.py` exporting `setup(app, context)`. The `context` dict carries
  `config_dir`, `meta_db`, `library_providers`, `register_library_provider`,
  `load_sibling` (namespaced sibling imports — never bare-import a sibling module),
  and `log` (use it; `print()` fails CI).
- `styles` — self-hosted compiled CSS under `assets/`
  ([docs/plugin-styles.md](docs/plugin-styles.md)). Never the Tailwind Play CDN.
- `settings.server_files` / `diagnostics` — opt-ins for settings export and the
  diagnostics bundle ([docs/diagnostics-bundle-spec.md](docs/diagnostics-bundle-spec.md)).
- `type: "visualization"` — the plugin provides a highway renderer.

**Visualization contract**: export a factory on `window.feedBackViz_<id>` returning
`{ contextType, init(canvas, bundle), draw(bundle), resize(w, h), destroy() }`.
The bundle object is reused across frames — never cache it. Use
`bundle.lowerBoundT`/`lowerBoundTime` to cull to the visible window instead of
scanning full chart arrays per frame. Overlays (layers on top of the active
renderer) manage their own canvas + rAF and read state via the `highway.get*()`
getters. Player-chrome injection points and v3 UI details:
[docs/plugin-v3-ui.md](docs/plugin-v3-ui.md).

**Performance rule**: never run `querySelector`/`querySelectorAll` in `draw()`, a
rAF loop, a short interval, or a broad `MutationObserver` — resolve elements once
at mount and cache them. Plugins share the main thread with the 60 fps highway.

## WebSocket highway protocol

`/ws/highway/{filename}?arrangement={index}` streams JSON frames in order:
`loading*` -> `song_info` -> `beats` -> `sections` -> `anchors` ->
`chord_templates` -> `lyrics?` -> `tone_changes?` -> `notes` -> `chords` ->
`phrases*?` -> `ready`. Do not finalize rendering until `ready`. Note fields are
compact: `t` (time), `s` (string), `f` (fret), `sus`, `ho`, `po`, `sl`, `bn`.
Multiple simultaneous connections to the same song are by design (splitscreen,
lyrics panes) — don't multiplex.

## Conventions

- **Frontend**: vanilla JS + fetch + DOM. Globals: `highway`, `playSong()`,
  `showScreen()`, `createHighway()`, `window.feedBack` (event bus). `localStorage`
  for preferences (plugin keys prefixed with plugin id). Tailwind is a prebuilt
  committed stylesheet — rebuild with `scripts/build-tailwind.sh` when you add
  classes. Keyboard shortcuts via `window.registerShortcut({key, description,
  scope, handler})`.
- **Backend**: FastAPI + uvicorn. SQLite via `MetadataDB` (thread-safe via lock).
  Graceful fallbacks over crashes on the media path. Type hints used sparingly.
- **Naming**: camelCase JS, kebab-case CSS, snake_case plugin ids.
- **File size**: no source file over 1,500 lines (ESLint-enforced); exemptions are
  signed in [docs/size-exemptions.md](docs/size-exemptions.md).
- **Git**: feature branches + PRs against upstream; short imperative commit
  subjects with a body explaining why. Plugins are often their own repos cloned
  into `plugins/` — careful with `git clean`.

## Pitfalls

1. **playSong wrapper chain** — plugins wrap `window.playSong`; they load
   alphabetically and the last-loaded wrapper runs first. `await` inside a wrapper
   yields — WebSocket messages can arrive before outer wrappers finish setup.
2. **Highway flex layout** — `#highway` has `flex:1` inside fixed `#player`;
   hiding it collapses the layout (use `margin-top:auto` on the controls).
3. **v3 player chrome** — the transport auto-hides. Mount player controls into
   `window.feedBack.ui.playerControlSlot()`, not `#player-controls`
   (details in [docs/plugin-v3-ui.md](docs/plugin-v3-ui.md)).
4. **Canvas context swapping** — `highway.setRenderer()` replaces the `<canvas>`
   element when the new renderer's `contextType` differs; listen for
   `highway:canvas-replaced` on `window.feedBack` if you hold canvas refs.
