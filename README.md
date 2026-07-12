# fee[dB]ack

A self-hosted web app for practicing real instruments guitar-hero style: point it
at a folder of songs, pick one, and play along on a scrolling note highway with
your actual guitar, bass, keys, or drums.

![The 3D note highway](docs/player-3d.jpg)

## Features

- **Note highway player**: Canvas-2D by default, optional 3D (WebGL) highway,
  with stem mixing, looping, section practice, and adjustable playback speed.
- **Open song format**: songs are `.feedpak`/`.sloppak` packages
  ([spec](https://github.com/got-feedback/feedpak-spec)): plain zip files with
  YAML manifest, JSON note data, and OGG stems. Hand-editable, no lock-in.
- **Chart import**: converts Guitar Pro (GP3–GP8) and MusicXML files, or author
  charts in the built-in editor.
- **Plugins**: tuner, 3D highways, minigames, achievements, practice tools, and
  more; anything beyond browse + play is a plugin.
- **Progression**: XP paths per instrument, quests, stats, and a shop, if you
  like that sort of thing.
- **Single user, no cloud**: one Docker container, your files, no accounts.

## Quick start

```bash
git clone https://github.com/got-feedback/feedBack.git
cd feedBack
LIBRARY_PATH=/path/to/your/songs docker compose up -d
```

Open <http://localhost:8000>. Three starter songs are seeded on first run.

For development without Docker:

```bash
pip install -r requirements.txt
python main.py        # needs ffmpeg on PATH for full audio support
```

## Documentation

- [CLAUDE.md](CLAUDE.md): architecture and developer guide
- [docs/](docs/): plugin authoring, song format, diagnostics
- [CONTRIBUTING.md](CONTRIBUTING.md): contribution and plugin licensing policy

## License

[AGPL-3.0-only](LICENSE)
