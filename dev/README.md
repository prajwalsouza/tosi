# Developing Tosi

## Run it

```
npm run build:rust     # once, and after Rust changes
npm run info           # ask every engine for its info, in the terminal
npm run dev            # http://127.0.0.1:5170
```

Drop an ITU IFIC zip anywhere on the page, or pick a sample on Home. The Flow shows the file, its tables, and the tables the rules read. Settings → Engines shows each engine's status and which one is in use.

## Toolchains

- **Node 23.6 or later.** TypeScript runs directly on Node, with no build step.
- **Rust**, through rustup. If rustup lives somewhere other than your home folder, set `RUSTUP_HOME`, `CARGO_HOME` and `PATH` before building.
- **Python 3.9 or later.** The engine runs from its own virtual environment: `cd engines/python && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.
- **TypeScript dependencies:** `cd engines/ts && npm install`.

## Local settings

`dev/local.json` is for this machine only and is never committed. It lists real files to offer as samples, and where runs are written:

```json
{ "samples": ["/path/to/ific3074.zip", "/path/to/brific3076.zip"], "runs": "runs" }
```

Samples are loaded automatically the first time the interface opens with nothing loaded.

## Layout rules

See [docs/modules.md](docs/modules.md) for how engines, the server and other parts are shaped, and [docs/decisions.md](docs/decisions.md) for why.
