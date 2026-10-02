---
name: add-kernel
description: Add a new CPU GEMM kernel to benchmark/ and wire it into the CLI, the benchmark harness, the tests, and the README. Use when the user wants a new matrix-multiply variant (e.g. "add a packed-tiled kernel").
---

A kernel is not done until every place below knows about it. Do them in order, then verify.

## 1. Implement

Put the kernel in the family module that matches its strategy: `benchmark/src/kernels/{serial,rayon,static_threads}/<name>.rs`. Implement `GemmKernel<T: Element>` (`compute()`), following the closest existing sibling. Rules from `kernels/mod.rs`:

- Validate dimensions at the entry point with `assert_gemm_dimensions`, and overwrite (not accumulate into) `output`.
- Use row slices in the inner loops so LLVM can autovectorize; reuse `ikj_rows` where the strategy is ikj-based.
- Kernels needing a thread count or a knob value (tile size, depth block) take them in `new(...)`, like `StaticTiledGemm::new` (threads, then the tile size).
- Report what the kernel ran with from `GemmKernel::params(&self, n) -> Vec<Param>` (`kernels/param.rs`): `Param::swept` for its knob, `Param::derived` for values worked out at run time, `Param::fixed` for compile-time constants. The default is empty, right for a kernel with no knobs.

Re-export from the family `mod.rs`, then from `kernels/mod.rs` (`pub use ...`).

## 2. Describe it (`benchmark/src/kernel.rs`)

Add a `KernelChoice` variant and its row in `KernelChoice::info()`: the `label` (the `measurements.kernel` value and dashboard name, kebab-case), plus only the fields that differ from `KernelInfo::serial`: `workers` if it takes `--threads`, `knob` if it sweeps one (`Knob::TileSize` for `--tile-size`, `Knob::DepthBlock` for `--depth-block`), `derived` and `fixed` (the names of its other params, as `params` reports them), `row_per_worker` if every worker needs at least one row, `precisions` if it can't run all five. The CLI, the sweep, the skip notices and `gemm-bench validate` all read that row: `validate` rejects a database whose measurements don't record exactly the declared params.

A committed host DB freezes its kernels' rows (label, backend, precisions, workers, declared params and sources): change an existing kernel's row only together with a schema migration. A new strategy, such as BLIS MC/NC blocking for `packed`, ships under a new kernel label.

## 3. Wire the harness (`benchmark/src/benchmark.rs`)

Add the import and a one-line `measure` arm: `sample(&MyGemm::new(..)?, setup_start, io)`. `sample` runs the untimed warm-up and the timed repetitions; build any pool or setup in the arm, before it, so it is timed as `setup_ms`. Rayon-style kernels go through `InPool::new(threads, kernel)?`, which keeps `pool.install` inside each timed run.

## 4. Test

Add it to the kernel list in `every_kernel_matches_naive` (`kernels/mod.rs` tests). That test runs all five precisions on a non-tile-aligned n=7, so it catches remainder-handling bugs. If it takes a thread count, loop `1..=n` as the static kernels do. `every_kernel_records_exactly_the_params_it_declares` (`benchmark.rs`) then checks its `params` against its `KernelInfo` row at every precision it supports, once step 3's `measure` arm exists. The harness separately enforces the `4√N·ε` bound against `ikj` at run time.

## 5. Docs

Add a row to the CPU kernel table and the `--kernel` list in `README.md`, and a "## `<label>`" section to its family's file in `web/src/docs/kernels/`, which the dashboard's About tab renders. Follow the other sections: what it does, a short pseudo-code sketch, and **Runs via**, **Tunes**, **Precisions**, **Watch for** (if it applies) and **Source**. `web/src/lib/docs.test.ts` fails until it's there.

## 6. Verify

```sh
just check-bench && just test
just bench --sizes 64,256 --kernel <label>,ikj --precision f16,f32,f64,i32,i64 --output /tmp/add-kernel.sqlite
```

Confirm the smoke run completes without an accuracy abort. When done, suggest running the `hpc-specialist` agent on the new kernel.
