# gemm-bench

Rust GEMM benchmarks (`benchmark/`) plus a Svelte dashboard (`web/`) that reads one SQLite database per host (`data/db/<github-login>/<machine>.sqlite`, schema in `data/schema.sql`) directly in the browser with sql.js. README.md has the full CLI, methodology, and schema.

## Commands

Everything goes through `just` (run from the repo root):

- `just test` / `just check` / `just lint`: tests, clippy (`-D warnings`) + svelte-check, auto-fix fmt + Biome. Run `just check && just test` before pushing.
- `just bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32`: forwards args to the CLI. Every omitted dimension sweeps all of its values, so pin `--precision` (and `--tile-size` / `--depth-block` for the tiled / packed kernels) too. With nothing pinned it prints the help; `--sweep` runs everything (hours). Presets: `just bench --config configs/quick.toml` (see `configs/`).
- `just init <github-login>/<machine>`: once per machine; writes the git-ignored `.host` that names your database.
- `just validate`: `gemm-bench validate` over every `data/db/*/*.sqlite`, as CI runs it.

## Gotchas

- Rust is **nightly** (`#![feature(f16)]`), pinned by `rust-toolchain.toml`.
- Metal kernels (`mps`, `metal-naive`, `metal-tiled`, all under `kernels/metal/`) are macOS/Apple Silicon only and compiled only locally (CI runs Linux and Windows). `mps` runs `f16`/`f32`; the shaders also run `i32`/`i64`. `gemm.metal` is compiled from source at runtime, so shader errors show up in `cargo test`, not `cargo build`. Gate new macOS code with `#[cfg(target_os = "macos")]` and check `cargo clippy` still passes for the non-macOS shape.
- `data/db/<login>/<machine>.sqlite` files are committed data, written only by the tool: `just bench` adds a run to yours by default, so pass `--output /tmp/x.sqlite` for throwaway runs. Never hand-edit one. A PR may only touch its author's folder (CI checks), and `gemm-bench validate` gates every file.
- `data/schema.sql` is version 1 and the only version: there is no migration path yet (see the spec's Follow-ups), so a schema change is a design decision, not an edit. It may only use SQLite features sql.js (3.49.1) has.
- The dashboard's SQL views live in `web/src/lib/data/views.sql` as `TEMP` views, never in the databases. The latest run of each cell wins.
- Kernel knobs are rows in `params` (`swept`, `derived` or `fixed`). A kernel declares them in `KernelInfo` (`benchmark/src/kernel.rs`) and reports them from `GemmKernel::params`; a test checks the two agree, and `validate` holds stored rows to the declaration.
- A committed host DB freezes its kernels' `KernelInfo` rows (label, backend, precisions, workers, declared params and sources), since `validate` checks every stored measurement against the current ones. Change one only together with a schema migration. A new strategy, such as BLIS MC/NC blocking for `packed`, ships under a new kernel label.
- `data/peaks.csv` is hand-curated hardware peaks, one row per ceiling (device, backend, precision, cores), and every row cites its source. A bad value fails `bun test` (`web/src/lib/peaks/parse.test.ts`). GPU ceilings also match on the run's `gpu_cores`.
- `serial::IkjGemm` is the correctness reference for every kernel. Treat changes to it as changes to all of them.
- `web/` has `bun test` suites (`web/src/**/*.test.ts`); `just test` runs them via `test-web`.
- `accelerate-bnns` calls BNNSGraph through a Swift package (`benchmark/swift/BnnsGraph`) that `build.rs` builds with swift-rs, macOS only. Keep the shim's C interface to integers and raw pointers, and keep `Package.swift`'s macOS version equal to `SwiftLinker::new` in `build.rs` (the macOS 26 builder is checked at runtime). Editing the Swift package triggers a SwiftPM rebuild on the next cargo build.
- Dashboard docs are first-party Markdown in `web/src/docs/`, imported with `?raw` and inserted unsanitized by `renderMarkdown` (`web/src/lib/format/markdown.ts`), so contributed strings (kernel, device, CPU, GPU and OS names from host databases) must never go through it. A new kernel needs a "## `<label>`" section in `web/src/docs/kernels/<family>.md`, and a new chart panel a `web/src/docs/charts/*.md` file, or `bun test` fails.
- Lefthook runs fmt/clippy/test/Biome/typecheck/validate on commit; don't bypass it.
