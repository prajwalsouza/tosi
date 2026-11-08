# Engines

Three implementations of every stage, against the same spec:

- [`ts/`](ts/): TypeScript
- [`rust/`](rust/): Rust
- [`python/`](python/): Python

Every engine has the same command-line shape, for example `tosi run --stage reach --in run/ --out run/`, and writes the same outputs. A stage is done only when all three pass its conformance cases and agree within the stated tolerance.
