# simdgroup_matrix GEMM Shader (`metal-simdgroup`)

- **Status:** Approved design

## Problem

The hand-written Metal shaders sit far below Apple's own library on the same GPU. Peak is 5,308 GFLOPS for both f32 and f16 (16 cores × 128 ALUs × 2 × 1.296 GHz, `data/peaks.csv`). Best results from run `e3f106d` in `data/db/paulhondola/m1pro.sqlite`, by GPU-only time (`gpu_ms`):

| kernel | f32 n=1024 | f32 n=4096 | f16 n=4096 | % of peak at 4096 (f32 / f16) |
|---|---|---|---|---|
| `metal-naive` | 342 | 267 | 323 | 5.0% / 6.1% |
| `metal-tiled` | 542 | 578 | 1,006 | 10.9% / 19.0% |
| `mps` | 1,867 | 4,018 | 3,897 | 75.7% / 73.4% |

End-to-end (`gops`) is lower for every GPU kernel by the same ~4.6 ms copy of 3 × 64 MB at n=4096, so `mps` is 3,538 GOPS (67%) there.

`metal-tiled` computes one output per thread. Every FMA needs two threadgroup-memory loads (`a_tile[ly][k]`, `b_tile[k][lx]`), and each 16-deep step pays two barriers. f16 runs 1.74× faster than f32 at an equal ALU rate, so the kernel is bound by bytes moved through threadgroup memory, not by the ALUs.

The fix is to reuse each loaded operand many times from registers. Loads per FMA, per lane:

| shape | loads / FMA | f32 accumulator registers per lane |
|---|---|---|
| 1×1 per thread (`metal-tiled`) | 2.0 | 1 |
| 4×4 per thread | 0.5 | 16 |
| 8×8 per thread | 0.25 | 64 |
| 32×32 per simdgroup, 4×4 grid of 8×8 `simdgroup_matrix` | 1/16 | 32 |

A simdgroup fragment is spread across 32 lanes, and the operand copies each lane needs move between lanes inside the multiply-accumulate (SIMD shuffles) instead of costing separate loads. M1 has no matrix hardware in the GPU: `simdgroup_multiply_accumulate` runs on the same ALUs, and the gain comes from feeding them. MPS is closed source. MLX's open-source GEMM is built on `simdgroup_matrix`, which makes it the likely route to MPS-class numbers.

## Goals

- Add a GPU kernel `metal-simdgroup` built on `simdgroup_matrix`, at f16 and f32.
- Reach **≥ 50% of peak (≥ 2,654 GFLOPS by `gpu_ms`) at n=4096 for both f16 and f32**. Stretch: within 10% of `mps`.
- Stay correct at any n, including sizes that are not a multiple of the block.

## Non-Goals

- **Changing `metal-tiled`.** A committed host DB freezes each kernel's `KernelInfo`, and its committed rows must keep describing the kernel that produced them. A new strategy ships under a new label.
- **Integer precisions.** MSL's `simdgroup_matrix` has `half` and `float` only (bfloat on newer GPU families).
- **A swept knob.** The block shape is tuned during development and frozen as `fixed` params, the way `metal-tiled` records its 16×16.
- **`simdgroup_async_copy` and threadgroup padding.** `simdgroup_async_copy` is undocumented and not public API, so it is out of scope entirely. (Double buffering, vectorized device loads and a direct store were non-goals until the first tuning round missed the bar, and padding until the performance review; see Second Round.)
- **Mixed-precision accumulation.** f16 sums in half, like every other kernel.
- **Changing what `gpu_ms` measures.** It stays the CPU-clocked `commit` → `waitUntilCompleted` window.

## Design

### Shader (`benchmark/src/kernels/metal/gemm.metal`)

A new template `gemm_simdgroup<T>`, instantiated only as `gemm_simdgroup_half` and `gemm_simdgroup_float`. It includes `<metal_simdgroup_matrix>`. Buffers and `n` use the existing slots 0–3.

Starting geometry, all compile-time constants:

| constant | start | meaning |
|---|---|---|
| `BM` × `BN` | 64 × 64 | block of C per threadgroup |
| `BK` | 32 | depth of each staged k-step |
| `SG` | 4 | simdgroups per threadgroup, arranged 2×2, 128 threads |
| per simdgroup | 32 × 32 | a 4×4 grid of `simdgroup_matrix<T, 8, 8>` accumulators |

One `threadgroup T stage[max(BM*BK + BK*BN, BM*BN)]`, holding A as `[BM][BK]` then B as `[BK][BN]` during the k-loop, and C as `[BM][BN]` for the store. At the start values both uses are 4,096 elements, 16 KB in f32, half the 32 KB limit.

Per k-step `t`:

1. All 128 threads copy A's `BM`×`BK` strip and B's `BK`×`BN` strip into `stage` (16 elements of each per thread at the start values), consecutive threads on consecutive columns. Out-of-range elements are written as zero, the same edge rule as `metal-tiled`, so the inner loop never bounds-checks.
2. `threadgroup_barrier(mem_threadgroup)`.
3. For each 8-deep slice `kk` of the step: `simdgroup_load` the simdgroup's 4 A fragments and 4 B fragments from `stage`, then run 16 `simdgroup_multiply_accumulate`s.
4. `threadgroup_barrier(mem_threadgroup)`.

Store, one path for every block:

1. Each simdgroup `simdgroup_store`s its 16 fragments into `stage` at its offset in `[BM][BN]`.
2. `threadgroup_barrier(mem_threadgroup)`.
3. Each thread copies its share of the block to C (32 elements at the start values), skipping those past n.

Mark the store with a `ponytail:` comment. It costs one threadgroup round trip per output, negligible against a k-loop of length n. The upgrade path is a direct `simdgroup_store` to device memory for blocks wholly inside n×n.

The constants appear in both `gemm.metal` and `shader.rs`, each with a "must equal" comment, as `TS` and `TILE` do today.

### Tuning (development only)

Four candidates, measured at f16 and f32, n ∈ {1024, 2048, 4096}, every run written to `/tmp/*.sqlite`, never to the host DB:

| block per threadgroup | per simdgroup | `BK` |
|---|---|---|
| 64 × 64 | 32 × 32 | 16 |
| 64 × 64 | 32 × 32 | 32 |
| 32 × 32 | 16 × 16 | 16 |
| 32 × 32 | 16 × 16 | 32 |

Freeze the candidate with the best `gpu_ms` at n=4096. The 32×32 blocks are there for small n: at n=1024, 64×64 blocks give 256 threadgroups (16 per core), and 32×32 gives four times as many, at a worse load ratio (1/8 instead of 1/16).

### Second Round (added after the first tuning round missed the bar)

The first round froze 32-k16 at n=4096: f16 1,614 and f32 1,531 GFLOPS (30.4% / 28.8%), against the 2,654 bar. The 64-wide blocks reached ~2,130 at f16 but only ~1,100 at f32. f16 running ~2× f32 at an equal ALU rate points at bytes again, as it did for `metal-tiled`. Two suspects:

- **Threadgroup memory per block.** The single store path sizes the stage for all of C (`BM*BN`), 16 KB at f32 for a 64×64 block even when `BK`=16 needs only 8 KB for the strips, so fewer threadgroups fit per core.
- **Nothing hides device latency.** Each step is copy → barrier → multiply → barrier, with four guarded scalar loads per group.

The user approved three levers, tried one at a time in this order:

0. **Refactor (no intended speed change):** move the strip copy into `load_strips` (device → registers, zero past the edge) and `store_strips` (registers → stage), each thread handling groups of 4 consecutive elements. Every lever below then edits one place.
1. **Direct store:** a fragment wholly inside n×n goes from registers to C with `simdgroup_store`. A fragment that crosses the edge goes through its simdgroup's own 8×8 slice of the stage, written by lanes with bounds checks. The stage shrinks to the strips (`BM*BK + BK*BN`).
2. **Vector loads:** when both strips are wholly inside n×n and `n % 4 == 0` (every row 16-byte aligned), `load_strips` reads each group with one `vec<T, 4>` load instead of four guarded scalar loads.
3. **Double buffering:** two stages take turns. The next step's strips are read into registers before the current step's multiplies and stored into the other stage after them, leaving one barrier per step instead of two.

Rule: score S = the higher, over the 64-k16 and 32-k16 shapes, of min(f16, f32) GFLOPS by `gpu_ms` at n=4096. The refactor's measurement sets the baseline. A lever is kept only if S improves by more than 3% (the noise level) over the best S so far; otherwise it is reverted. If no lever is kept and the refactor itself cost more than 3% against the first round's S (1,531), the refactor is reverted too. After the levers, all four shapes are re-measured and the winner re-picked by the first round's rule. A shape whose pipeline cannot be built (64-k32 with double buffering at f32 needs exactly 32 KB) is dropped. The 50% bar is unchanged.

After the re-tune, a performance review padded every staged row by 16 bytes, as MLX's steel GEMM does (A's row stride `BK + 16/sizeof(T)`, B's `BN + 16/sizeof(T)`, each group one vector store), kept at +3.0% on the median of min(f16, f32) at n=4096 over three interleaved baseline/variant runs each.

### Rust (`benchmark/src/kernels/metal/shader.rs`)

- A new variant `Shader::Simdgroup`, named `"simdgroup"`.
- `ShaderGemm::new` returns `Ok(None)` for `Simdgroup` at `int` or `long`, as it already does for `f64`.
- `ShaderGemm::new` returns `Err` if the pipeline's `maxTotalThreadsPerThreadgroup` is below the 128 threads it dispatches. Register-heavy pipelines can be capped below 1024.
- `encode` dispatches `ceil(n/BN)` × `ceil(n/BM)` threadgroups of 128 threads each. Edge threads load zeros rather than returning, so every thread reaches every barrier.
- `params`:
  - `fixed`: `block_rows`, `block_cols`, `depth_step`, `simdgroups`. `depth_step` means the same as it does for `metal-tiled`.
  - `derived`: `threadgroups` = `ceil(n/BM) * ceil(n/BN)`.
  - The 8×8 fragment size is not recorded: MSL only offers 8×8.

### Harness (`benchmark/src/kernel.rs`, `benchmark/src/benchmark.rs`)

- `KernelChoice::MetalSimdgroup`, `#[cfg_attr(not(target_os = "macos"), value(skip))]`, appended to `ALL`, which grows to 15.
- `KernelInfo { backend: "metal", precisions: &[F16, F32], derived: &["threadgroups"], fixed: &["block_cols", "block_rows", "depth_step", "simdgroups"], ..serial("metal-simdgroup") }`
- `benchmark.rs`: a `MetalSimdgroup` arm copied from `MetalTiled`, and the kernel added to the off-macOS `unreachable!` arm.

### Numerics

- f16 accumulates in half, as `gemm.metal`'s header states for every shader.
- The 8×8 multiply-accumulates may add terms in a different order from the reference. Both checks apply unchanged: 8ε relative in unit tests, and the harness's 4√N·ε against `ikj` on every benchmark run, which fails the run when exceeded.

## Integration

- **`web/src/docs/kernels/gpu.md`:** a `## \`metal-simdgroup\`` section after `metal-tiled`, with the existing fields: what it does, a sketch, **Runs via**, **Tunes** (nothing, the block shape is fixed), **Precisions** (`f16`, `f32`; `simdgroup_matrix` has no integer types), **Watch for** (M1 runs the 8×8 fragment operations on the ordinary ALUs, there is no matrix hardware; it sums in the element type; small n is limited by launch cost), **Source**. `bun test` fails without the section.
- **`web/src/docs/charts/gpu-vs-cpu-at-equal-effort.md`:** add `metal-simdgroup` to the hand-written shaders.
- **`README.md`:** add `metal-simdgroup` to the macOS-only kernel list (line 29), the example command (156), the `--kernel` list and its skip notes (176), the `--precision` notes (177, f16/f32 only), the up-front validation text (192) and the CI note (255). Add a kernel table row after `metal-tiled` (88).
- **Dashboard colour (`web/src/lib/palette.ts`):**
  - The GPU legend sorts kernels by name, so the new kernel lands between `metal-naive` (orange, slot 1) and `metal-tiled` (violet, slot 6), followed by `mps` and the Matrix and parallel-CPU reference inks.
  - Validate the four free GPU slots (2 aqua, 3 yellow, 4 magenta, 9 indigo) with the dataviz validator, dark surface `#15181b`, against those neighbours and the reference inks. Floors: CVD ΔE ≥ 8, normal-vision ΔE ≥ 15, contrast ≥ 3:1.
  - Pin the winner in `SLOT_OF.gpu`, and record its margins in the comment the way slots 9 and 10 do.
  - `palette.test.ts`'s "unknown GPU kernel" test uses `metal-simdgroup` as its example; switch it to a name that is still unknown. Update the sort-order comment at `web/src/lib/charts/gpu.ts:101`.
- **No change:** `familyOf` (backend `metal` → gpu), `COUNTERPART` (a hand-written shader defaults to parallel), `data/peaks.csv`, `data/schema.sql`.

## Testing

Write the tests first, and see them fail.

1. **`shader_matches_naive` helper (`benchmark/src/kernels/mod.rs`):** sizes `[7, 37]` → `[7, 37, 100]`. n=100 spans two blocks per side with a ragged second block for either candidate block size, and ends the k-loop on a partial step for either `BK`. The helper also covers `metal-naive` and `metal-tiled`.
2. **`metal_simdgroup_matches_naive_at_f16_and_f32`:** runs the helper at both precisions.
3. **`metal_simdgroup_has_no_kernel_for_integers`:** asserts `ShaderGemm::new(Shader::Simdgroup)` is `Ok(None)` at `i32` and `i64`.
4. **`metal_shaders_record_their_threadgroups`:** adds the simdgroup kernel's params at n=100, with the frozen constants.
5. **`a_named_kernel_at_a_precision_it_lacks_is_rejected_before_running` (`cli.rs`):** adds `("metal-simdgroup", "i32")`.
6. **`kernel.rs` tests:** the count (14 → 15) and the backend test's metal arm.
7. **Unchanged, already covering the new kernel:** the params-agree-with-`KernelInfo` test (`benchmark.rs`, which loops over every kernel), `labels_round_trip`, and `a_kernels_knob_is_its_only_swept_param`.

If f16 at n=100 exceeds 8ε, measure the drift and report it before touching the tolerance.

## Measurement and Commits

1. Work on `feat/metal-simdgroup`. The spec is committed first, then the implementation.
2. The hpc-specialist agent reviews the shader and its dispatch before the measurement run.
3. Once the kernel is committed, so the run records a clean `commit_id`, run one benchmark into the host DB:
   `just bench --kernel metal-tiled,metal-simdgroup,mps --precision f16,f32` at the default sizes. Re-measuring `metal-tiled` and `mps` puts all three under the same conditions; the latest run of a cell wins in the dashboard views, so their cells refresh too.
4. Check the success bar. **If it fails, do not commit the DB.** Report the numbers and decide on double buffering.
5. `just validate`, then commit the DB on its own.
6. `just check && just test`, then open a PR.

## Acceptance

| Check | Pass |
|---|---|
| `cargo test` on macOS | all pass, including n ∈ {7, 37, 100} at f16 and f32 |
| Tuning, 4 candidates, `/tmp` only | winner by `gpu_ms` at n=4096 frozen as `fixed` params |
| `metal-simdgroup` n=4096, 2n³ / `gpu_ms` | ≥ 2,654 GFLOPS at both f16 and f32. Stretch: ≥ 0.9 × `mps` in the same run |
| Harness accuracy check (4√N·ε against `ikj`) | passes at every size of the host-DB run |
| `just check && just test` | clean |
| `cargo clippy --target aarch64-unknown-linux-gnu --all-targets -- -D warnings` | clean (the non-macOS shape) |
| `just validate` | clean |
| Palette validator | the pinned slot clears the floors against its legend neighbours and the reference inks |

## Risks

- **Runtime compile.** `shader.rs` compiles with default options, which select the latest MSL version the OS supports. An offline probe with `xcrun metal` compiled `simdgroup_load`, `simdgroup_multiply_accumulate`, `simdgroup_store` and `make_filled_simdgroup_matrix` for `half` and `float`. If the runtime compiler rejects them, pass `MTLCompileOptions` with language version ≥ 2.3.
- **One library for all shaders.** `gemm.metal` compiles as one unit, so a GPU without `simdgroup_matrix` (before Apple7) would fail to compile the naive and tiled shaders too. The Metal kernels are Apple Silicon only, and M1 is Apple7, so this is accepted.
- **Register pressure.** 16 accumulator fragments plus 8 operand fragments per lane may cap threads per threadgroup or occupancy. The `maxTotalThreadsPerThreadgroup` check catches the cap. A drop in occupancy shows up in tuning, where the 16×16-per-simdgroup candidates hold a quarter of the accumulators.
- **Below 50% after tuning.** The first round was; the second round (above) followed. If the second round is also below, stop before committing measurements and bring the numbers back.
- **Threadgroup memory limit.** Double buffering at 64-k32 needs `2 × (64·32 + 32·64)` f32 = 32 KB, exactly the M1 limit. If its pipeline fails to build, that shape is dropped from the re-tune.

## Follow-ups

- **Any second-round lever that was not kept**, if a GPU profile later points at it.
- **Threadgroup swizzle** into bands of 8 block-rows, so B's strips stay in the system-level cache at n=4096: rejected. It dropped f32's thread cap from 768 to 704 and measured −1.5% (median min(f16, f32) 2,975 vs 3,020 GFLOPS at n=4096).
- **Per-precision depth step:** `BK`=32 at f16, which keeps the 1,024-thread cap.
- **8-element staging groups** instead of 4.
- **GPU counter capture** to confirm f32's occupancy.
- **Smaller blocks for n ≤ 512**, where 64×64 blocks leave too few threadgroups to fill the GPU.

f32 is register-limited to 768 threads per threadgroup (6 resident threadgroups per core), so any lever that keeps more values live across the MMAs must be checked with a thread-cap probe first.
- **GPU timestamps** (`GPUStartTime` / `GPUEndTime`) for `gpu_ms`, which would remove submission latency at small n. This changes what a stored column means, so it is a schema-level decision.
