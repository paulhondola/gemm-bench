# gemm-bench

Rust GEMM benchmarks (`benchmark/`) plus a Svelte dashboard (`web/`) that queries `data/runs/**/*.csv` (merged by `data/build.sql` into `web/public/results.parquet`) with DuckDB-WASM. README.md has the full CLI, methodology, and CSV schema.

## Commands

Everything goes through `just` (run from the repo root):

- `just test` / `just check` / `just lint`: tests, clippy (`-D warnings`) + tsc, auto-fix fmt + Biome. Run `just check && just test` before pushing.
- `just bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32`: forwards args to the CLI. Every omitted dimension sweeps all of its values, so pin `--precision` (and `--block-size` for tiled kernels) too. With nothing pinned it prints the help; `--sweep` runs everything (hours). Presets: `just bench --config configs/quick.toml` (see `configs/`).
- `just data`: validates and merges run CSVs. Requires the DuckDB CLI.

## Gotchas

- Rust is **nightly** (`#![feature(f16)]`), pinned by `rust-toolchain.toml`.
- `mps` is macOS/Apple Silicon only, `f16`/`f32` only, and is compiled only locally (CI is Linux). Gate new macOS code with `#[cfg(target_os = "macos")]` and check `cargo clippy` still passes for the non-macOS shape.
- `data/runs/<host>/<timestamp>.csv` files are committed data. `just bench` writes there by default, so pass `--output /tmp/x.csv` for throwaway runs. Never hand-edit a run file.
- `serial::IkjGemm` is the correctness reference for every kernel. Treat changes to it as changes to all of them.
- `web/` has `bun test` suites (`web/src/**/*.test.ts`); `just test` runs them via `test-web`.
- `accelerate-bnns` calls BNNSGraph through a Swift package (`benchmark/swift/BnnsGraph`) that `build.rs` builds with swift-rs, macOS only. Keep the shim's C interface to integers and raw pointers, and keep `Package.swift`'s macOS version equal to `SwiftLinker::new` in `build.rs` (the macOS 26 builder is checked at runtime). Editing the Swift package triggers a SwiftPM rebuild on the next cargo build.
- Lefthook runs fmt/clippy/test/Biome/typecheck/data-build on commit; don't bypass it.
