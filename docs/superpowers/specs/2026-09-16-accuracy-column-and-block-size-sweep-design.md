# Accuracy Column and Block-Size Sweep

- **Status:** Proposed
- **Roadmap item:** 4 of 5
- **Depends on:** item 1

Two small, independent extensions to the runner and record schema. They're bundled because both add a column to `BenchmarkRecord` and change sweep bookkeeping, so shipping them together means one schema change instead of two.

## Part A: Accuracy Against f64

### Problem

For single-threaded ikj, f16 is 2× faster than f32 and 4× faster than f64 (50 / 25 / 12 GFLOPS). The data only shows the speed side of that trade. Item 1's check measures agreement *within* one precision (kernel against ikj at the same precision), not how far each precision is from the true product. The measured MPS f16 error of 7.3% at n=4096 hints the precision cost is large, but that number mixes two effects: the GPU adding terms in a different order, and f16's coarse rounding.

### Design

- In `run_precision`, compute a **ground-truth f64 reference** once per n: build the inputs with `benchmark_inputs::<f64>(n)` and run `IkjGemm`, untimed.
  - For `T = f64`, reuse the item-1 reference instead of computing it twice.
  - **Known ceiling:** with several precisions, the f64 reference is recomputed per precision (~12 s at n=4096 each). Hoist it into `run()` only if that becomes noticeable next to the naive kernel's minutes.
- New record column `max_rel_error_f64`: the largest element-wise `|out.to_f64() − ref| / |ref|` over the kernel's output. It reuses item 1's `max_relative_error` logic, generalized to compare a `Matrix<T>` against a `Matrix<f64>`.
  - One generic helper covers both uses; item 1's same-type comparison becomes the special case.
- Inputs in f16/f32 are generated with `T::from_f64` from the same f64 values, so input rounding counts as part of the precision cost. That's intended: it's what a real f16 workload pays.
- Informational only: never aborts. Item 1's check stays the gate.
- Terminal table: show it as `err_f64` in `{:.1e}` format.

### Testing

- Unit test: a `Matrix<f32>` with one perturbed element against a `Matrix<f64>` reference gives the expected ratio. An f64 matrix against itself gives 0.
- Real run: `--kernel ikj,mps --precision f16,f32,f64 --sizes 256,1024`. Expect f64 ≈ 0, f32 around 1e-7, f16 around 1e-3–1e-2, and MPS f16 ≥ ikj f16.

## Part B: Block-Size Sweep

### Problem

`tiled` is slower than `ikj` at every size and precision (f32 n=2048: 14.9 vs 24.3 GFLOPS), and only `--block-size 64` has ever been measured. Whether a different block size helps, or whether tiling without packing can't win on this machine, is an open question. A sweep answers it cheaply.

### Design

- CLI: `--block-size` becomes a comma-delimited list (`Vec<usize>`, default `[64]`). Validation rejects 0 in any entry, as today.
- `KernelChoice::uses_blocks()` returns `true` for `Tiled`, `RayonTiled`, `StaticTiled`.
- `BenchmarkPlan.block_sizes: Vec<usize>` replaces `block_size`.
- Sweep loop: for block-using kernels, iterate `block_sizes × threads` (threads only if `uses_workers`). Other kernels are unchanged.
- `total_configurations`: a kernel's multiplier becomes `(threads.len() if uses_workers else 1) × (block_sizes.len() if uses_blocks else 1)`.
- Record column `block_size: Option<usize>`. It serializes as empty in CSV and `null` in JSON for kernels that don't use blocks.
- Progress message and terminal table include `b=<size>` / a `block` column.

### Testing

- CLI tests:
  - `--block-size 32,64,128` parses.
  - `0` in the list is rejected.
  - `total_configurations` is correct for a mixed kernel list (e.g. `ikj,tiled,rayon-tiled` with 2 threads × 3 blocks = 1 + 3 + 6).
- Report test: the CSV has an empty `block_size` field for `ikj` and a number for `tiled`.
- Real run: `--kernel ikj,tiled --sizes 1024,2048 --block-size 32,64,128,256,512`. The result answers whether any block size beats ikj.

## Schema After This Item

`kernel, n, threads, block_size, precision, median_ms, min_ms, stddev_ms, gflops, max_rel_error_f64`

Update the README methodology section and the column list.

## Out of Scope

- Automatic block-size selection or reading cache sizes from `sysctl`.
- Per-level block sizes (L1/L2/L3). The packed kernel (item 5) owns that.
