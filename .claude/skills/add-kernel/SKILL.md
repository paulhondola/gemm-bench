---
name: add-kernel
description: Add a new CPU GEMM kernel to benchmark/ and wire it into the CLI, the benchmark harness, the tests, and the README. Use when the user wants a new matrix-multiply variant (e.g. "add a packed-tiled kernel").
---

A kernel is not done until every place below knows about it. Do them in order, then verify.

## 1. Implement

Put the kernel in the family module that matches its strategy: `benchmark/src/kernels/{serial,rayon,static_threads}/<name>.rs`. Implement `GemmKernel<T: Element>` (`name()` + `compute()`), following the closest existing sibling. Rules from `kernels/mod.rs`:

- Validate dimensions at the entry point with `assert_gemm_dimensions`, and overwrite (not accumulate into) `output`.
- Use row slices in the inner loops so LLVM can autovectorize; reuse `ikj_rows` where the strategy is ikj-based.
- Kernels needing a thread count or block size take them in `new(...)` like `StaticTiledGemm::new(threads, block_size)`.

Re-export from the family `mod.rs`, then from `kernels/mod.rs` (`pub use ...`).

## 2. Wire the CLI (`benchmark/src/cli.rs`)

Add a `KernelChoice` variant, then update **every** match: `label()` (the CSV/dashboard name, kebab-case), `backend()` (`"cpu"`), `device()`, and `uses_workers()` if it takes `--threads`. `supports()` only needs a change for precision restrictions. Update `validate_static_threads` if it has a rows-per-thread constraint.

## 3. Wire the harness (`benchmark/src/benchmark.rs`)

Add the import and a `measure` arm. Copy the sibling's pattern exactly: one untimed `compute` first (after any pool is built), then `time_kernel` per repetition. Rayon-style kernels run inside `pool.install`.

## 4. Test

Add it to the kernel list in `every_kernel_matches_naive` (`kernels/mod.rs` tests). That test runs all five precisions on a non-tile-aligned n=7, so it catches remainder-handling bugs. If it takes a thread count, loop `1..=n` as the static kernels do. The harness separately enforces the `4√N·ε` bound against `ikj` at run time.

## 5. Docs

Add a row to the CPU kernel table and the `--kernel` list in `README.md`.

## 6. Verify

```sh
just check-bench && just test
just bench --sizes 64,256 --kernel <label>,ikj --precision f16,f32,f64,i32,i64 --output /tmp/add-kernel.csv
```

Confirm the smoke run completes without an accuracy abort. When done, suggest running the `hpc-specialist` agent on the new kernel.
