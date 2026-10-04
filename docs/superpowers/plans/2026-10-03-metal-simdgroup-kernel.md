# `metal-simdgroup` Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `simdgroup_matrix` GEMM shader, `metal-simdgroup`, that takes hand-written Metal GEMM on the M1 Pro from 10.9% of peak (`metal-tiled` f32) to at least 50%.

**Architecture:** A new template in `gemm.metal`, dispatched through the existing `ShaderGemm` as `Shader::Simdgroup`. Each 128-thread threadgroup stages strips of A and B in threadgroup memory (zero past the edge) and computes a 64×64 block of C. Each of its 4 simdgroups holds 32×32 of the block as a 4×4 grid of 8×8 `simdgroup_matrix` accumulators. The block shape is tuned once, then frozen as `fixed` params.

**Tech Stack:** Rust nightly, `objc2-metal`, Metal Shading Language (compiled from source at run time), SQLite host DBs, Svelte/Bun dashboard.

**Spec:** `docs/superpowers/specs/2026-10-03-metal-simdgroup-kernel-design.md`

## Global Constraints

- Branch `feat/metal-simdgroup` (already created; the spec is committed there as `c19f3ab`).
- Kernel label `metal-simdgroup`; precisions `f16` and `f32` only; backend `metal`.
- Params: `fixed` = `block_rows`, `block_cols`, `depth_step`, `simdgroups`; `derived` = `threadgroups`.
- f16 accumulates in half (`simdgroup_matrix<T, 8, 8>` with `T` = the element type).
- Do not change `gemm_naive`, `gemm_tiled`, `Shader::Naive` or `Shader::Tiled`.
- New macOS-only code sits behind `#[cfg(target_os = "macos")]`, and `cargo clippy` must still pass for the non-macOS shape.
- Throwaway benchmark runs go to `--output /tmp/<name>.sqlite`. Only Task 5 writes `data/db/paulhondola/m1pro.sqlite`, and no task ever edits a DB by hand.
- Lefthook runs fmt, clippy and `cargo test` on commit. Never bypass it.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Success bar: n=4096, 2n³ / `gpu_ms` ≥ **2,654 GFLOPS** (50% of 5,308.416) at both f16 and f32. Stretch: ≥ 0.9 × `mps` in the same run.
- Second-round rule (Task 2b): a lever is kept only if score S (the higher, over 64-k16 and 32-k16, of min(f16, f32) `gflops_gpu` at n=4096) improves by more than 3% over the best S so far.

## File Map

| File | Change |
|---|---|
| `benchmark/src/kernels/metal/gemm.metal` | new `gemm_simdgroup<T>` and its constants, `half` and `float` instantiations |
| `benchmark/src/kernels/metal/shader.rs` | `Shader::Simdgroup`, constants, precision gate, thread-cap check, dispatch, params |
| `benchmark/src/kernel.rs` | `KernelChoice::MetalSimdgroup` and its `KernelInfo`; test updates |
| `benchmark/src/benchmark.rs` | dispatch arm, off-macOS `unreachable!` arm |
| `benchmark/src/kernels/mod.rs` | shader tests |
| `benchmark/src/cli.rs` | test updates |
| `web/src/docs/kernels/gpu.md` | `## \`metal-simdgroup\`` section (`bun test` requires it once `kernel.rs` names the kernel) |
| `web/src/docs/charts/gpu-vs-cpu-at-equal-effort.md` | list the kernel among the hand-written shaders |
| `web/src/lib/palette.ts`, `palette.test.ts` | pin the kernel to slot 10 (indigo, `#4f44ff`) |
| `web/src/lib/charts/gpu.ts` | two comments that count or list the GPU kernels |
| `README.md` | kernel lists and a table row |
| `data/db/paulhondola/m1pro.sqlite` | one benchmark run (Task 5, written only by the tool) |

---

### Task 1: The shader, its wiring, its tests and its doc section

**Files:**
- Modify: `benchmark/src/kernels/metal/gemm.metal` (header comment; append the new kernel)
- Modify: `benchmark/src/kernels/metal/shader.rs`
- Modify: `benchmark/src/kernel.rs` (enum, `ALL`, `info`, tests)
- Modify: `benchmark/src/benchmark.rs:258-278`
- Modify: `benchmark/src/kernels/mod.rs` (tests module)
- Modify: `benchmark/src/cli.rs` (tests module)
- Modify: `web/src/docs/kernels/gpu.md`

**Interfaces:**
- Consumes: `ShaderGemm<T>`, `GpuDispatch`, `time_dispatch`, `Param::{fixed, derived}`, `KernelInfo`, `serial(..)`. All of these exist today.
- Produces:
  - `Shader::Simdgroup`.
  - Private constants in `shader.rs`: `BLOCK_ROWS = 64`, `BLOCK_COLS = 64`, `DEPTH_STEP = 32`, `SIMDGROUPS = 4`, `SIMDGROUP_THREADS = 128`.
  - MSL constants in `gemm.metal`: `BM`, `BN`, `BK`, `SG`.
  - `KernelChoice::MetalSimdgroup`, labelled `"metal-simdgroup"`.
  - Task 2 edits the four tuned constants in both files.

- [ ] **Step 1: Add n=100 to the shared shader test, and confirm the existing shaders pass it**

In `benchmark/src/kernels/mod.rs`, change `shader_matches_naive`:

```rust
    #[cfg(target_os = "macos")]
    fn shader_matches_naive<T: Element>(shader: super::Shader) {
        // 100 spans two blocks per side for metal-simdgroup, the second ragged,
        // and ends its k-loop on a partial step.
        for n in [7, 37, 100] {
```

(Keep the attribute that is already above the function, and leave the body unchanged.)

Run: `cargo test --manifest-path benchmark/Cargo.toml metal_ -- --nocapture`
Expected: PASS for `metal_naive_matches_naive_at_every_gpu_precision` and `metal_tiled_matches_naive_at_every_gpu_precision`. The n=100 case is valid for the existing shaders.

- [ ] **Step 2: Write the failing tests**

In `benchmark/src/kernels/mod.rs`, add these after `metal_tiled_matches_naive_at_every_gpu_precision`:

```rust
    #[cfg(target_os = "macos")]
    #[test]
    fn metal_simdgroup_matches_naive_at_f16_and_f32() {
        use super::Shader::Simdgroup;
        shader_matches_naive::<f16>(Simdgroup);
        shader_matches_naive::<f32>(Simdgroup);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_simdgroup_has_no_kernel_for_integers() {
        use super::{Shader::Simdgroup, ShaderGemm};
        let int = ShaderGemm::<i32>::new(Simdgroup)
            .expect("an unsupported precision is not a compile error");
        let long = ShaderGemm::<i64>::new(Simdgroup)
            .expect("an unsupported precision is not a compile error");
        assert!(int.is_none() && long.is_none());
    }
```

In the same file, inside `metal_shaders_record_their_threadgroups`, add this right after the `assert_eq!` on `tiled`'s params:

```rust
        let simdgroup = ShaderGemm::<f32>::new(Shader::Simdgroup)
            .expect("gemm.metal compiles")
            .expect("a Metal device");
        assert_eq!(
            GemmKernel::<f32>::params(&simdgroup, 100),
            [
                Param::fixed("block_rows", 64),
                Param::fixed("block_cols", 64),
                Param::fixed("depth_step", 32),
                Param::fixed("simdgroups", 4),
                Param::derived("threadgroups", 4),
            ]
        );
```

In `benchmark/src/kernel.rs` tests, make two edits:
- In `every_kernel_names_its_backend`, replace the metal arm with:

```rust
                KernelChoice::Mps
                | KernelChoice::MetalNaive
                | KernelChoice::MetalTiled
                | KernelChoice::MetalSimdgroup => "metal",
```

- In `all_kernels_are_known_everywhere_but_offered_only_where_they_run`, change `assert_eq!(KernelChoice::ALL.len(), 14);` to `15`.

In `benchmark/src/cli.rs` tests, make two edits:
- In `default_kernels_skip_mps_at_precisions_it_lacks`, the `skipped` list gains a last entry:

```rust
                "skipping metal-tiled at f64 (unsupported precision)",
                "skipping metal-simdgroup at f64 (unsupported precision)"
```

- In `a_named_kernel_at_a_precision_it_lacks_is_rejected_before_running`, add a row after `("metal-tiled", "f64"),`:

```rust
            ("metal-simdgroup", "i32"),
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: compile errors `no variant ... named Simdgroup` and `no variant ... named MetalSimdgroup`.

- [ ] **Step 4: Write the shader**

In `benchmark/src/kernels/metal/gemm.metal`:
- Change the first header line to `// GEMM compute shaders for the \`metal-naive\`, \`metal-tiled\` and \`metal-simdgroup\` kernels.`
- Add `#include <metal_simdgroup_matrix>` on the line after `#include <metal_stdlib>`.
- Append at the end of the file:

```metal

// Must equal BLOCK_ROWS, BLOCK_COLS, DEPTH_STEP and SIMDGROUPS in shader.rs.
constant constexpr uint BM = 64;  // rows of C per threadgroup
constant constexpr uint BN = 64;  // columns of C per threadgroup
constant constexpr uint BK = 32;  // depth of each staged step
constant constexpr uint SG = 4;   // simdgroups per threadgroup, arranged 2×2
constant constexpr uint THREADS = SG * 32;
constant constexpr uint SM = BM / 2;  // rows of C per simdgroup
constant constexpr uint SN = BN / 2;  // columns of C per simdgroup
constant constexpr uint FM = SM / 8;  // 8×8 fragments per simdgroup, down
constant constexpr uint FN = SN / 8;  // and across
// One buffer, reused: A then B while multiplying, C while storing.
constant constexpr uint STAGE = BM * BK + BK * BN > BM * BN ? BM * BK + BK * BN : BM * BN;

// Each threadgroup of SG simdgroups computes one BM×BN block of C, and each
// simdgroup holds an SM×SN quarter of it as FM×FN 8×8 simdgroup_matrix
// accumulators. Per step the threadgroup stages A's BM×BK strip and B's BK×BN
// strip in threadgroup memory, zero past the edge as in gemm_tiled, then each
// simdgroup multiplies 8×8 fragments out of them.
template <typename T>
kernel void gemm_simdgroup(device const T* a [[buffer(0)]],
                           device const T* b [[buffer(1)]],
                           device T* c [[buffer(2)]],
                           constant uint& n [[buffer(3)]],
                           uint2 group [[threadgroup_position_in_grid]],
                           ushort tid [[thread_index_in_threadgroup]],
                           ushort sg [[simdgroup_index_in_threadgroup]]) {
    threadgroup T stage[STAGE];
    threadgroup T* a_stage = stage;            // [BM][BK]
    threadgroup T* b_stage = stage + BM * BK;  // [BK][BN]
    const uint row0 = group.y * BM;
    const uint col0 = group.x * BN;
    const uint sg_row = (sg / 2) * SM;
    const uint sg_col = (sg % 2) * SN;

    simdgroup_matrix<T, 8, 8> acc[FM][FN];
    #pragma clang loop unroll(full)
    for (uint i = 0; i < FM; ++i) {
        #pragma clang loop unroll(full)
        for (uint j = 0; j < FN; ++j) {
            acc[i][j] = make_filled_simdgroup_matrix<T, 8, 8>(T(0));
        }
    }

    // No early return for blocks past the edge: every thread must reach every
    // barrier, so out-of-range elements load as zeros instead.
    for (uint t = 0; t < n; t += BK) {
        for (uint e = tid; e < BM * BK; e += THREADS) {
            uint row = row0 + e / BK, col = t + e % BK;
            a_stage[e] = (row < n && col < n) ? a[row * n + col] : T(0);
        }
        for (uint e = tid; e < BK * BN; e += THREADS) {
            uint row = t + e / BN, col = col0 + e % BN;
            b_stage[e] = (row < n && col < n) ? b[row * n + col] : T(0);
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        #pragma clang loop unroll(full)
        for (uint kk = 0; kk < BK; kk += 8) {
            simdgroup_matrix<T, 8, 8> a_frag[FM];
            simdgroup_matrix<T, 8, 8> b_frag[FN];
            #pragma clang loop unroll(full)
            for (uint i = 0; i < FM; ++i) {
                simdgroup_load(a_frag[i], a_stage + (sg_row + i * 8) * BK + kk, BK);
            }
            #pragma clang loop unroll(full)
            for (uint j = 0; j < FN; ++j) {
                simdgroup_load(b_frag[j], b_stage + kk * BN + sg_col + j * 8, BN);
            }
            #pragma clang loop unroll(full)
            for (uint i = 0; i < FM; ++i) {
                #pragma clang loop unroll(full)
                for (uint j = 0; j < FN; ++j) {
                    simdgroup_multiply_accumulate(acc[i][j], a_frag[i], b_frag[j], acc[i][j]);
                }
            }
        }
        // Nobody overwrites the stage until every simdgroup has finished reading it.
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }

    // ponytail: every block stores through threadgroup memory, so edge blocks
    // need no second path; simdgroup_store straight to c for blocks wholly
    // inside n×n if the store ever shows up in a profile.
    #pragma clang loop unroll(full)
    for (uint i = 0; i < FM; ++i) {
        #pragma clang loop unroll(full)
        for (uint j = 0; j < FN; ++j) {
            simdgroup_store(acc[i][j], stage + (sg_row + i * 8) * BN + sg_col + j * 8, BN);
        }
    }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint e = tid; e < BM * BN; e += THREADS) {
        uint row = row0 + e / BN, col = col0 + e % BN;
        if (row < n && col < n) {
            c[row * n + col] = stage[e];
        }
    }
}

template [[host_name("gemm_simdgroup_half")]] kernel void gemm_simdgroup<half>(
    device const half*, device const half*, device half*, constant uint&, uint2, ushort, ushort);
template [[host_name("gemm_simdgroup_float")]] kernel void gemm_simdgroup<float>(
    device const float*, device const float*, device float*, constant uint&, uint2, ushort, ushort);
```

Why it is shaped this way:
- `#pragma clang loop unroll(full)` on every fragment loop keeps `acc[i][j]` in registers. A loop left rolled would index the array dynamically and spill it to memory.
- The k-loop's second barrier also frees `stage` for the store, so the store needs only the one barrier before its copy-out.

(This exact code compiled cleanly with `xcrun -sdk macosx metal -Wall` during planning.)

- [ ] **Step 5: Wire it into `shader.rs`**

In `benchmark/src/kernels/metal/shader.rs`:

Module doc, first two lines:

```rust
//! Hand-written GEMM compute shaders (`gemm.metal`), compiled from source at
//! runtime: the GPU counterparts of the CPU naive and tiled kernels, and a
//! `simdgroup_matrix` kernel that multiplies 8×8 fragments.
```

After the `TILE` constant:

```rust
// `gemm_simdgroup`'s block of C per threadgroup, the depth of each staged
// step, and its simdgroups (2×2); must equal `BM`, `BN`, `BK` and `SG` in
// `gemm.metal`.
const BLOCK_ROWS: usize = 64;
const BLOCK_COLS: usize = 64;
const DEPTH_STEP: usize = 32;
const SIMDGROUPS: usize = 4;
/// `gemm_simdgroup`'s threads per threadgroup: every Apple GPU's simdgroup is
/// 32 threads wide.
const SIMDGROUP_THREADS: usize = SIMDGROUPS * 32;
```

`Shader` gains a variant, and `name` gains an arm:

```rust
    /// 8×8 `simdgroup_matrix` fragments multiplied out of a threadgroup-staged
    /// block, `f16` and `f32` only.
    Simdgroup,
```

```rust
            Self::Simdgroup => "simdgroup",
```

In `ShaderGemm::new`, the doc comment becomes:

```rust
    /// Compiles `gemm.metal` and builds the pipeline for `shader` at `T`.
    /// `Ok(None)` without a Metal device or for a precision the shader can't
    /// express (`f64`, and integers for `Simdgroup`); `Err` with the
    /// compiler's message if compilation fails, or if the pipeline can't run
    /// `Simdgroup`'s threadgroup.
```

Then make two code changes:
- Right after the `let Some(msl_type) = ... else { return Ok(None); };` statement, add:

```rust
        // simdgroup_matrix has half and float only.
        if shader == Shader::Simdgroup && !matches!(msl_type, "half" | "float") {
            return Ok(None);
        }
```

- Right after the `let pipeline = ...?;` statement, add:

```rust
        let max_threads = pipeline.maxTotalThreadsPerThreadgroup();
        if shader == Shader::Simdgroup && max_threads < SIMDGROUP_THREADS {
            return Err(format!(
                "{name} allows {max_threads} threads per threadgroup but needs {SIMDGROUP_THREADS}"
            ));
        }
```

In `encode`, add an arm after `Shader::Tiled`:

```rust
            // Whole threadgroups for the same reason; x walks columns, y rows.
            Shader::Simdgroup => encoder.dispatchThreadgroups_threadsPerThreadgroup(
                MTLSize {
                    width: operands.n.div_ceil(BLOCK_COLS),
                    height: operands.n.div_ceil(BLOCK_ROWS),
                    depth: 1,
                },
                MTLSize {
                    width: SIMDGROUP_THREADS,
                    height: 1,
                    depth: 1,
                },
            ),
```

In `params`, add an arm after `Shader::Tiled`:

```rust
            Shader::Simdgroup => vec![
                Param::fixed("block_rows", BLOCK_ROWS),
                Param::fixed("block_cols", BLOCK_COLS),
                Param::fixed("depth_step", DEPTH_STEP),
                Param::fixed("simdgroups", SIMDGROUPS),
                Param::derived(
                    "threadgroups",
                    n.div_ceil(BLOCK_ROWS) * n.div_ceil(BLOCK_COLS),
                ),
            ],
```

- [ ] **Step 6: Wire it into the harness**

In `benchmark/src/kernel.rs`:
- Add the enum variant right after `MetalTiled,`:

```rust
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    MetalSimdgroup,
```

- `ALL` becomes `pub(crate) const ALL: [Self; 15]`, with `Self::MetalSimdgroup,` appended after `Self::MetalTiled,`.
- In `info`, add after the `MetalTiled` arm:

```rust
            // simdgroup_matrix has half and float only.
            Self::MetalSimdgroup => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32],
                derived: &["threadgroups"],
                fixed: &["block_cols", "block_rows", "depth_step", "simdgroups"],
                ..serial("metal-simdgroup")
            },
```

In `benchmark/src/benchmark.rs`:
- Add after the `KernelChoice::MetalTiled => { ... }` arm:

```rust
        #[cfg(target_os = "macos")]
        KernelChoice::MetalSimdgroup => {
            let kernel = ShaderGemm::<T>::new(Shader::Simdgroup)?
                .expect("metal-simdgroup needs a Metal device and f16 or f32");
            let built = setup_start.elapsed();
            let params = GemmKernel::<T>::params(&kernel, lhs.rows());
            on_gpu(
                built,
                kernel.benchmark(lhs, rhs, io.2, repetitions)?,
                params,
            )
        }
```

- Extend the off-macOS arm to:

```rust
        #[cfg(not(target_os = "macos"))]
        KernelChoice::AccelerateBlas
        | KernelChoice::AccelerateBnns
        | KernelChoice::Mps
        | KernelChoice::MetalNaive
        | KernelChoice::MetalTiled
        | KernelChoice::MetalSimdgroup => unreachable!("{} runs only on macOS", choice.label()),
```

- [ ] **Step 7: Run the Rust tests to verify they pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: all pass, including `metal_simdgroup_matches_naive_at_f16_and_f32`, `metal_simdgroup_has_no_kernel_for_integers`, `metal_shaders_record_their_threadgroups`, and the params-agree-with-`KernelInfo` test in `benchmark.rs`, which now also runs `metal-simdgroup` at n=8 and 33.

If `metal_simdgroup_matches_naive_at_f16_and_f32` fails on f16 at n=100 by a small margin, do not loosen `assert_close`. Instead:
1. Print the worst element's relative error in units of `f16::EPSILON`.
2. Re-run with `metal-tiled` at n=100 for comparison.
3. Stop and report both numbers.

A large error (or zeros) at n=100 but not at n=7 or n=37 means an indexing bug in the second, ragged block. Check `row0`/`col0` and the copy-out bounds.

If `ShaderGemm::new` returns `Err("gemm.metal failed to compile: ...")` naming a `simdgroup_*` symbol, the runtime compiler picked an MSL version below 2.3. Pass `MTLCompileOptions` with `setLanguageVersion(MTLLanguageVersion::Version2_3)` (or later) to `newLibraryWithSource_options_error` instead of `None`, and note it in the commit message. The default is the newest version the OS supports, so this is not expected.

- [ ] **Step 8: Write the doc section**

In `web/src/docs/kernels/gpu.md`, append after the `metal-tiled` section (the file ends with its **Source** line):

````markdown

## `metal-simdgroup`

The same shader file, rebuilt around Metal's `simdgroup_matrix`: an 8 × 8 matrix spread across the 32 threads of a SIMD group (a simdgroup), multiplied by all 32 together in one call. Each group of 128 GPU threads (4 simdgroups) owns a 64 × 64 block of C. Every step it loads a strip of A and one of B into threadgroup memory, and each simdgroup multiplies 8 × 8 pieces of them into the 32 × 32 part of the block it keeps in registers. Each value loaded now feeds many multiply-adds instead of one.

```text
# 128 GPU threads per 64 × 64 block of C; each simdgroup holds 32 × 32 of it as 4 × 4 pieces
acc[4][4] = 0
for t in 0..N step 32:
  stageA = A[block rows][t .. t+32];  stageB = B[t .. t+32][block cols]   # zeros past the edge
  barrier                             # the group's loads are done
  for kk in 0..32 step 8:
    a[i] = 8 × 8 piece of stageA, i in 0..4
    b[j] = 8 × 8 piece of stageB, j in 0..4
    acc[i][j] += a[i] × b[j]          # simdgroup_multiply_accumulate
  barrier                             # the group's reads are done
C[block] = acc                        # through threadgroup memory, skipping past the edge
```

- **Runs via:** The same as `metal-naive`.
- **Tunes:** Nothing: the block shape is fixed, so no knob applies.
- **Precisions:** `f16`, `f32`. `simdgroup_matrix` has no integer types.
- **Watch for:** The M1's GPU has no matrix hardware: the 8 × 8 multiplies run on the same ALUs as every other shader, and the gain comes from feeding them from registers. It adds up in the element type, like the other shaders. At small N there are too few blocks to fill the GPU, and launching the work costs more than the work itself.
- **Source:** [`benchmark/src/kernels/metal/gemm.metal`](https://github.com/paulhondola/gemm-bench/blob/main/benchmark/src/kernels/metal/gemm.metal)
````

- [ ] **Step 9: Run the web tests and both clippy shapes**

Run: `just test-web`
Expected: PASS, including `the catalogue documents exactly the kernels in kernel.rs`.

Run: `just check-bench`
Expected: no warnings.

Run: `cargo clippy --manifest-path benchmark/Cargo.toml --target aarch64-unknown-linux-gnu --all-targets -- -D warnings`
Expected: no warnings (the non-macOS shape; `MetalSimdgroup` is `value(skip)` there and reaches only the `unreachable!` arm). If the target is missing, run `rustup target add aarch64-unknown-linux-gnu` first.

- [ ] **Step 10: Commit**

```bash
git add benchmark/src/kernels/metal/gemm.metal benchmark/src/kernels/metal/shader.rs benchmark/src/kernel.rs benchmark/src/benchmark.rs benchmark/src/kernels/mod.rs benchmark/src/cli.rs web/src/docs/kernels/gpu.md
git commit -m "Add metal-simdgroup, a simdgroup_matrix GEMM shader for f16 and f32

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tune the block shape and freeze it

**Files:**
- Modify: `benchmark/src/kernels/metal/gemm.metal` (`BM`, `BN`, `BK`)
- Modify: `benchmark/src/kernels/metal/shader.rs` (`BLOCK_ROWS`, `BLOCK_COLS`, `DEPTH_STEP`)
- Modify: `benchmark/src/kernels/mod.rs` (`metal_shaders_record_their_threadgroups` expected values)
- Modify: `web/src/docs/kernels/gpu.md` (block and step numbers, only if the winner differs)

**Interfaces:**
- Consumes: Task 1's constants.
- Produces: the frozen constants, which Task 2b starts from. `SG`/`SIMDGROUPS` stays 4 in every candidate.

The four candidates (per-simdgroup size is always half of each block side):

| name | `BM`/`BLOCK_ROWS` | `BN`/`BLOCK_COLS` | `BK`/`DEPTH_STEP` |
|---|---|---|---|
| `64-k16` | 64 | 64 | 16 |
| `64-k32` | 64 | 64 | 32 |
| `32-k16` | 32 | 32 | 16 |
| `32-k32` | 32 | 32 | 32 |

- [ ] **Step 1: Measure each candidate into its own throwaway DB**

For each candidate in the table, starting with `64-k32` (Task 1's values):
1. Set the three constants in **both** `gemm.metal` and `shader.rs` to the candidate's values.
2. Check correctness: `cargo test --manifest-path benchmark/Cargo.toml metal_simdgroup_matches` → PASS. (The params test expects Task 1's values, so it fails for the other three candidates. That is expected during tuning.)
3. Measure:

```bash
just bench --kernel metal-simdgroup --precision f16,f32 --sizes 1024,2048,4096 --output /tmp/simdgroup-<name>.sqlite
```

4. Read the result:

```bash
sqlite3 -header -column /tmp/simdgroup-<name>.sqlite \
  "SELECT precision, n, round(2.0*n*n*n/(gpu_ms*1e6), 1) AS gflops_gpu,
          round(100*2.0*n*n*n/(gpu_ms*1e6)/5308.416, 1) AS pct_peak
   FROM measurements ORDER BY precision, n"
```

Keep the machine otherwise idle while the runs are going.

- [ ] **Step 2: Pick the winner**

The winner is the candidate with the highest **min(f16 `pct_peak`, f32 `pct_peak`) at n=4096**. Break ties (within 2 points) on the same minimum at n=1024. Write the four-candidate table (gflops_gpu at each n and precision) into the commit message in Step 5.

If the winner is below 2,654 GFLOPS at either precision, **stop after Step 5 and report the table to the user**: the spec's success bar is unmet, and Task 5 must not commit measurements. Tasks 3 and 4 may still proceed if the user says so.

- [ ] **Step 3: Freeze the winner**

Set both files' constants to the winner. If it is not `64-k32`, replace the expected params in `metal_shaders_record_their_threadgroups` with the winner's row:

| winner | `block_rows` | `block_cols` | `depth_step` | `simdgroups` | `threadgroups` at n=100 |
|---|---|---|---|---|---|
| `64-k16` | 64 | 64 | 16 | 4 | 4 |
| `64-k32` | 64 | 64 | 32 | 4 | 4 |
| `32-k16` | 32 | 32 | 16 | 4 | 16 |
| `32-k32` | 32 | 32 | 32 | 4 | 16 |

For example, `32-k16` makes the assertion:

```rust
            [
                Param::fixed("block_rows", 32),
                Param::fixed("block_cols", 32),
                Param::fixed("depth_step", 16),
                Param::fixed("simdgroups", 4),
                Param::derived("threadgroups", 16),
            ]
```

If the block is 32×32, update `gpu.md`'s `metal-simdgroup` section: "64 × 64 block" → "32 × 32 block", "the 32 × 32 part of the block" → "the 16 × 16 part of the block", and in the sketch "128 GPU threads per 32 × 32 block of C; each simdgroup holds 16 × 16 of it as 2 × 2 pieces", `acc[2][2]`, `i in 0..2`, `j in 0..2`. If `BK` is 16, replace `step 32` with `step 16`, `t .. t+32` with `t .. t+16` (both places), and `0..32 step 8` with `0..16 step 8`.

- [ ] **Step 4: Run all tests**

Run: `just test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add benchmark/src/kernels/metal/gemm.metal benchmark/src/kernels/metal/shader.rs benchmark/src/kernels/mod.rs web/src/docs/kernels/gpu.md
git commit -m "Freeze metal-simdgroup's block shape at <winner>

<the four-candidate table from Step 2: gflops_gpu by candidate, precision and n>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The angle-bracket parts are filled from Step 2's measurements; nothing else in the message is left open.)

---

### Task 2b: Second round of levers, then re-tune

Added after Task 2 froze 32-k16 at f16 1,614 / f32 1,531 GFLOPS (n=4096), below the 2,654 bar. Spec section: "Second Round".

**Files:**
- Modify: `benchmark/src/kernels/metal/gemm.metal` (the `gemm_simdgroup` section only)
- Modify: `benchmark/src/kernels/metal/shader.rs` (`BLOCK_ROWS` / `BLOCK_COLS` / `DEPTH_STEP` during measurement and the final freeze only)
- Modify: `benchmark/src/kernels/mod.rs` (`metal_shaders_record_their_threadgroups` expected values, final freeze only)
- Modify: `web/src/docs/kernels/gpu.md` (the `metal-simdgroup` section)

**Interfaces:**
- Consumes: Task 2's kernel at `5d21977` (32-k16 frozen; `SG` = 4 always).
- Produces: the final kernel and frozen shape. Param names and `KernelInfo` are unchanged.

**Score S (all of this task's decisions use it):** the higher, over the 64-k16 and 32-k16 shapes, of min(f16 `gflops_gpu`, f32 `gflops_gpu`) at n=4096. A lever is kept only if its S is more than 3% above the best S so far (`S_new > 1.03 × S_best`).

**Measure a variant (procedure M):** for each shape in {64-k16, 32-k16}:
1. Set `BM`/`BN` in `gemm.metal` and `BLOCK_ROWS`/`BLOCK_COLS` in `shader.rs` to 64 or 32 (`BK`/`DEPTH_STEP` stays 16).
2. Run `cargo test --manifest-path benchmark/Cargo.toml metal_simdgroup_matches` → PASS. A failure is a bug in the lever; fix it before measuring, never measure a failing variant.
3. Run `just bench --kernel metal-simdgroup --precision f16,f32 --sizes 2048,4096 --output /tmp/simdgroup-2b-<step>-<shape>.sqlite` (delete that /tmp file first if it exists; one run at a time).
4. Read it with Task 2's query:

```bash
sqlite3 -header -column /tmp/simdgroup-2b-<step>-<shape>.sqlite \
  "SELECT precision, n, round(2.0*n*n*n/(gpu_ms*1e6), 1) AS gflops_gpu,
          round(100*2.0*n*n*n/(gpu_ms*1e6)/5308.416, 1) AS pct_peak
   FROM measurements ORDER BY precision, n"
```

Put the constants back to 32-k16 (32/32/16) before any commit, so the params test passes under lefthook.

- [ ] **Step 1: Refactor the strip copy into helpers (no intended speed change)**

In `gemm.metal`, replace these two lines:

```metal
// One buffer, reused: A then B while multiplying, C while storing.
constant constexpr uint STAGE = BM * BK + BK * BN > BM * BN ? BM * BK + BK * BN : BM * BN;
```

with:

```metal
// A's strip then B's, per staged step.
constant constexpr uint STRIPS = BM * BK + BK * BN;
// One buffer, reused: the strips while multiplying, C while storing.
constant constexpr uint STAGE = STRIPS > BM * BN ? STRIPS : BM * BN;
// 4-element groups of A's and B's strips each thread stages per step.
constant constexpr uint A_GROUPS = BM * BK / (THREADS * 4);
constant constexpr uint B_GROUPS = BK * BN / (THREADS * 4);

// This thread's share of one step's strips, held in registers.
template <typename T>
struct Strips {
    vec<T, 4> a[A_GROUPS];
    vec<T, 4> b[B_GROUPS];
};

// Reads this thread's share of the strips at depth t, zero past the edge.
// Groups never straddle a row, since BK and BN are multiples of 4.
template <typename T>
inline Strips<T> load_strips(device const T* a, device const T* b, uint n,
                             uint row0, uint col0, uint t, ushort tid) {
    Strips<T> s;
    #pragma clang loop unroll(full)
    for (uint q = 0; q < A_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        const uint row = row0 + e / BK, col = t + e % BK;
        for (uint r = 0; r < 4; ++r) {
            s.a[q][r] = (row < n && col + r < n) ? a[row * n + col + r] : T(0);
        }
    }
    #pragma clang loop unroll(full)
    for (uint q = 0; q < B_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        const uint row = t + e / BN, col = col0 + e % BN;
        for (uint r = 0; r < 4; ++r) {
            s.b[q][r] = (row < n && col + r < n) ? b[row * n + col + r] : T(0);
        }
    }
    return s;
}

// Writes this thread's share of the strips into a stage: A as [BM][BK], then B as [BK][BN].
template <typename T>
inline void store_strips(thread const Strips<T>& s, threadgroup T* stage, ushort tid) {
    #pragma clang loop unroll(full)
    for (uint q = 0; q < A_GROUPS; ++q) {
        const uint e = (tid + q * THREADS) * 4;
        for (uint r = 0; r < 4; ++r) {
            stage[e + r] = s.a[q][r];
        }
    }
    #pragma clang loop unroll(full)
    for (uint q = 0; q < B_GROUPS; ++q) {
        const uint e = BM * BK + (tid + q * THREADS) * 4;
        for (uint r = 0; r < 4; ++r) {
            stage[e + r] = s.b[q][r];
        }
    }
}
```

In the kernel's k-loop, replace the two staging `for (uint e = tid; ...)` loops (A's and B's) with the single line:

```metal
        store_strips(load_strips(a, b, n, row0, col0, t, tid), stage, tid);
```

Run `cargo test --manifest-path benchmark/Cargo.toml` → PASS. Run procedure M with `<step>` = `s0` and record S0. S_best = S0. If S0 < 1,485 (more than 3% below the first round's 1,531), record that; Step 5 handles it. Commit:

```bash
git add benchmark/src/kernels/metal/gemm.metal
git commit -m "Stage metal-simdgroup's strips through registers

Groundwork for the second-round levers; no intended speed change.
S0 = <S0> GFLOPS (64-k16 f16/f32 <..>/<..>, 32-k16 f16/f32 <..>/<..> at n=4096).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Lever 1, direct store**

In `gemm.metal`:
- Delete the `STAGE` constant and its comment line. The declaration `threadgroup T stage[STAGE];` becomes `threadgroup T stage[STRIPS];`.
- Add a kernel parameter after `sg`: `ushort lane [[thread_index_in_simdgroup]]`. The `sg` line ends with `,` and the new line ends with `) {`.
- Both template instantiations gain a fourth `ushort` at the end of their parameter lists: `constant uint&, uint2, ushort, ushort, ushort);`.
- Replace everything from the `// ponytail: every block stores through threadgroup memory` comment to the kernel's closing `}` with:

```metal
    // Interior fragments go straight from registers to C. A fragment that
    // crosses the edge goes through this simdgroup's own 8×8 slice of the
    // stage, free since the k-loop's last barrier, and only its in-range
    // elements are written.
    threadgroup T* edge = stage + sg * 64;
    #pragma clang loop unroll(full)
    for (uint i = 0; i < FM; ++i) {
        #pragma clang loop unroll(full)
        for (uint j = 0; j < FN; ++j) {
            const uint frag_row = row0 + sg_row + i * 8;
            const uint frag_col = col0 + sg_col + j * 8;
            if (frag_row + 8 <= n && frag_col + 8 <= n) {
                simdgroup_store(acc[i][j], c + frag_row * n + frag_col, n);
            } else {
                simdgroup_store(acc[i][j], edge, 8);
                simdgroup_barrier(mem_flags::mem_threadgroup);
                for (uint e = lane; e < 64; e += 32) {
                    uint row = frag_row + e / 8, col = frag_col + e % 8;
                    if (row < n && col < n) {
                        c[row * n + col] = edge[e];
                    }
                }
                // The next edge fragment reuses the slice.
                simdgroup_barrier(mem_flags::mem_threadgroup);
            }
        }
    }
}
```

The branch is uniform across a simdgroup (it depends only on the group, the simdgroup, i, j and n), so the `simdgroup_barrier`s are reached by all 32 lanes. n ∈ {7, 37, 100} covers both branches.

Run `cargo test --manifest-path benchmark/Cargo.toml metal_simdgroup` → PASS, then procedure M with `<step>` = `l1`, giving S1.
- If S1 > 1.03 × S_best: set S_best = S1 and commit (`git add benchmark/src/kernels/metal/gemm.metal`) with the message `Store metal-simdgroup's interior fragments straight to C`, a body giving S1 and its four numbers, and the Co-Authored-By line.
- Otherwise: `git checkout -- benchmark/src/kernels/metal/gemm.metal benchmark/src/kernels/metal/shader.rs` and record S1 in the report as rejected.

- [ ] **Step 3: Lever 2, vector loads**

In `load_strips`, insert as its first statement (before `Strips<T> s;`):

```metal
    // Both strips wholly inside n×n, and every row 16-byte aligned: one
    // vector load per group instead of four guarded scalar loads.
    const bool inside = n % 4 == 0 && row0 + BM <= n && col0 + BN <= n && t + BK <= n;
```

Replace A's inner `for (uint r ...)` loop with:

```metal
        if (inside) {
            s.a[q] = *reinterpret_cast<device const vec<T, 4>*>(a + row * n + col);
        } else {
            for (uint r = 0; r < 4; ++r) {
                s.a[q][r] = (row < n && col + r < n) ? a[row * n + col + r] : T(0);
            }
        }
```

Replace B's inner `for (uint r ...)` loop with:

```metal
        if (inside) {
            s.b[q] = *reinterpret_cast<device const vec<T, 4>*>(b + row * n + col);
        } else {
            for (uint r = 0; r < 4; ++r) {
                s.b[q][r] = (row < n && col + r < n) ? b[row * n + col + r] : T(0);
            }
        }
```

Alignment holds because `col` is a multiple of 4 (`t`, `col0`, `e % BK` and `e % BN` all are), and so is `n`. n=100 takes the vector path for its interior steps; n=7 and n=37 take only the scalar path.

Run `cargo test --manifest-path benchmark/Cargo.toml metal_simdgroup` → PASS, then procedure M with `<step>` = `l2`, giving S2. Keep (commit `Read metal-simdgroup's interior strips with vector loads`, body with S2) or revert, by the same rule as Step 2.

- [ ] **Step 4: Lever 3, double buffering**

In the kernel:
- The stage declaration becomes `threadgroup T stage[2 * STRIPS];` under the comment `// Two stages that take turns: one is multiplied while the other fills.`
- Delete the two lines that set `a_stage` and `b_stage` at the top of the kernel.
- If Lever 1 was rejected (the `STAGE` constant still exists), delete the `STAGE` constant and its comment. The kept store-through-stage path indexes `stage[0 .. BM*BN)`, and `2 * STRIPS` covers that for every candidate shape.
- Replace the whole k-loop, from the `// No early return for blocks past the edge` comment through the loop's closing `}`, with:

```metal
    // No early return for blocks past the edge: every thread must reach every
    // barrier, so out-of-range elements load as zeros instead.
    store_strips(load_strips(a, b, n, row0, col0, 0, tid), stage, tid);
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint t = 0, buf = 0; t < n; t += BK, buf ^= 1) {
        threadgroup T* a_stage = stage + buf * STRIPS;  // [BM][BK]
        threadgroup T* b_stage = a_stage + BM * BK;     // [BK][BN]
        const bool more = t + BK < n;
        // Issued before the multiplies, so the device reads are in flight
        // while they run; stored to the other stage after them.
        Strips<T> next;
        if (more) {
            next = load_strips(a, b, n, row0, col0, t + BK, tid);
        }
        #pragma clang loop unroll(full)
        for (uint kk = 0; kk < BK; kk += 8) {
            simdgroup_matrix<T, 8, 8> a_frag[FM];
            simdgroup_matrix<T, 8, 8> b_frag[FN];
            #pragma clang loop unroll(full)
            for (uint i = 0; i < FM; ++i) {
                simdgroup_load(a_frag[i], a_stage + (sg_row + i * 8) * BK + kk, BK);
            }
            #pragma clang loop unroll(full)
            for (uint j = 0; j < FN; ++j) {
                simdgroup_load(b_frag[j], b_stage + kk * BN + sg_col + j * 8, BN);
            }
            #pragma clang loop unroll(full)
            for (uint i = 0; i < FM; ++i) {
                #pragma clang loop unroll(full)
                for (uint j = 0; j < FN; ++j) {
                    simdgroup_multiply_accumulate(acc[i][j], a_frag[i], b_frag[j], acc[i][j]);
                }
            }
        }
        if (more) {
            store_strips(next, stage + (buf ^ 1) * STRIPS, tid);
        }
        // One barrier per step: the other stage is complete, and nobody reads
        // this one again until it has been refilled.
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
```

Why one barrier suffices: step t writes the other stage, which was last read during step t−1's multiplies, and those finished at step t−1's barrier. `more` is the same for every thread, so the barrier stays uniform.

Run `cargo test --manifest-path benchmark/Cargo.toml metal_simdgroup` → PASS, then procedure M with `<step>` = `l3`, giving S3. Keep (commit `Double-buffer metal-simdgroup's staged strips`, body with S3) or revert, by the same rule as Step 2.

(Every on/off combination of Levers 1–3 on top of Step 1 was compiled with `xcrun -sdk macosx metal -Wall` at all four candidate shapes during planning: clean.)

- [ ] **Step 5: If nothing was kept and the refactor cost speed, undo it**

If Steps 2–4 all reverted and S0 < 1,485, run `git revert --no-edit <Step 1's SHA>` (the kernel returns to Task 2's). Otherwise skip this step.

- [ ] **Step 6: Re-tune all four shapes**

Run Task 2 Step 1's procedure (`--sizes 1024,2048,4096`, output `/tmp/simdgroup-2b-final-<name>.sqlite`) on the final kernel for 64-k16, 64-k32, 32-k16 and 32-k32. If a shape fails to build its pipeline (for example, 64-k32 with double buffering at f32 needs exactly 32 KB of threadgroup memory), drop it and record the error. Pick the winner by Task 2 Step 2's rule (highest min(f16, f32) `pct_peak` at n=4096; ties within 2 points broken at n=1024).

- [ ] **Step 7: Freeze, update the params test and the doc**

Set both files' constants to the winner. Update `metal_shaders_record_their_threadgroups` from Task 2 Step 3's table.

Then update the `metal-simdgroup` section of `web/src/docs/kernels/gpu.md`. The text below is written for a 32 × 32 block and 16-deep steps. For a 64-wide block, apply Task 2 Step 3's substitutions: 64 × 64, 32 × 32 of it as 4 × 4 pieces, `acc[4][4]`, `i in 0..4`, `j in 0..4`. For `BK` = 32, every depth of 16 becomes 32: `0 .. 16` → `0 .. 32`, `t+16 .. t+32` → `t+32 .. t+64`, `step 16` → `step 32`, and `0..16 step 8` → `0..32 step 8`.

- In the first paragraph, "Each value loaded now feeds many multiply-adds instead of one." becomes "Each value read from threadgroup memory now feeds many multiply-adds instead of one." Do this in every case.
- If Lever 3 was kept: in the first paragraph, "Every step it loads a strip of A and one of B into threadgroup memory," becomes "Every step it reads the next strip of A and of B into one of two threadgroup buffers while multiplying out of the other," and the sketch becomes:

```text
# 128 GPU threads per 32 × 32 block of C; each simdgroup holds 16 × 16 of it as 2 × 2 pieces
acc[2][2] = 0
stage[0] = A[block rows][0 .. 16], B[0 .. 16][block cols]   # zeros past the edge
barrier
for t in 0..N step 16, cur = 0, 1, 0, 1, …:
  next = A[block rows][t+16 .. t+32], B[t+16 .. t+32][block cols]   # in flight during the multiplies
  for kk in 0..16 step 8:
    a[i] = 8 × 8 piece of stage[cur]'s A, i in 0..2
    b[j] = 8 × 8 piece of stage[cur]'s B, j in 0..2
    acc[i][j] += a[i] × b[j]          # simdgroup_multiply_accumulate
  stage[1 - cur] = next
  barrier                             # one per step: the two stages take turns
C[block] = acc                        # through threadgroup memory, skipping past the edge
```

- If Lever 1 was kept: the sketch's last line (in either version) becomes `C[block] = acc                        # straight from registers; pieces that cross the edge go through threadgroup memory`.

- [ ] **Step 8: Test and commit**

Run: `just test` → PASS. Then:

```bash
git add benchmark/src/kernels/metal/gemm.metal benchmark/src/kernels/metal/shader.rs benchmark/src/kernels/mod.rs web/src/docs/kernels/gpu.md
git commit -m "Re-tune metal-simdgroup after the second round: <winner>

Levers kept: <list>. <the four-shape table: gflops_gpu by shape, precision and n>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The angle-bracket parts are filled from Steps 1–6's measurements.)

- [ ] **Step 9: Check the bar**

Pass: the winner's n=4096 `gflops_gpu` is ≥ 2,654 at both f16 and f32. If it misses, report DONE_WITH_CONCERNS with every S and the final table. The controller stops and brings the numbers to the user, and Task 5 does not commit measurements.

---

### Task 3: README, chart doc and dashboard colour

**Files:**
- Modify: `README.md` (lines 29, 88, 156, 176, 177, 192, 255)
- Modify: `web/src/docs/charts/gpu-vs-cpu-at-equal-effort.md:1`
- Modify: `web/src/lib/palette.ts` (the `SLOT_OF` doc comment and the `gpu` map)
- Modify: `web/src/lib/palette.test.ts`
- Modify: `web/src/lib/charts/gpu.ts:26`, `web/src/lib/charts/gpu.ts:101`

**Interfaces:**
- Consumes: the label `metal-simdgroup` (Task 1) and the frozen shape (Task 2).
- Produces: `SLOT_OF.gpu.get("metal-simdgroup") === 9`, i.e. `#4f44ff`.

The validation behind the slot was done during planning with the dataviz skill's `scripts/validate_palette.js --mode dark --surface "#15181b"`:

| check | result |
|---|---|
| legend order naive (`#d95926`), simdgroup, tiled (`#9085e9`), mps (`#e66767`), Matrix (`#3987e5`), parallel (`#008300`), adjacent pairs | aqua `#199e70`: pass. yellow `#c98500`: FAIL vs orange (CVD 4.8, normal 10.6). magenta `#d55181`: FAIL vs orange (normal 11.6). indigo `#4f44ff`: pass, worst adjacent CVD 13.1 / normal 18.5 (vs tiled) |
| aqua against every ink | FAIL vs parallel green (normal 11.9); CVD WARN vs mps red (6.5) |
| indigo against every ink | pass; worst CVD 10.2 and normal 15.3, both vs the Matrix reference blue; all ≥ 3:1 |

- [ ] **Step 1: Write the failing palette tests**

In `web/src/lib/palette.test.ts`:

```ts
const gpuKernels = ["metal-naive", "metal-simdgroup", "metal-tiled", "mps"];
```

In `known kernels take their documented slot`, add after the `metal-tiled` line:

```ts
	expect(p.get("metal-simdgroup")).toBe("#4f44ff");
```

In `GPU kernels reuse host slots but never collide within their group`:

```ts
	expect(new Set(gpuKernels.map((k) => p.get(k))).size).toBe(4);
```

Replace the test `an unknown GPU kernel skips the other families' ink` with:

```ts
test("an unknown GPU kernel skips the other families' ink", () => {
	const p = paletteFor(
		[...gpuKernels, "metal-future"],
		new Map<string, Family>([["metal-future", "gpu"]]),
	);
	// Slots 0 (AMX blue), 5 (parallel green) and 8 (serial purple) are the
	// reference inks drawn beside GPU kernels; slot 1 is metal-naive's. The
	// first free GPU slot is 2.
	expect(p.get("metal-future")).toBe("#199e70");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test src/lib/palette.test.ts`
Expected: FAIL. `metal-simdgroup` has no family in the test's `none` map, so it falls into the host group, where every slot is taken. It gets no colour (`undefined`), not `#4f44ff`.

- [ ] **Step 3: Pin the slot**

In `web/src/lib/palette.ts`, the `gpu` map becomes:

```ts
	gpu: new Map([
		["metal-naive", 1],
		["metal-simdgroup", 9],
		["metal-tiled", 6],
		["mps", 7],
	]),
```

In the doc comment above `SLOT_OF`, replace the text from `slot. GPU: validated in legend order` through `for the three kernels alone; all ≥ 3:1.` with:

```ts
 * slot. GPU: validated in legend order metal-naive, metal-simdgroup,
 * metal-tiled, mps, then the AMX and parallel references (dark, #15181b):
 * worst adjacent CVD ΔE 13.1, normal-vision 18.5 (metal-simdgroup ↔
 * metal-tiled), all ≥ 3:1. metal-simdgroup has slot 10 (indigo), the only
 * free slot that clears the floors against every ink in the GPU chart, not
 * just its legend neighbours: CVD ΔE ≥ 10.2, normal-vision ΔE ≥ 15.3 (both
 * nearest: the AMX reference blue). Aqua, the slot it would get unpinned,
 * fails normal vision against the parallel reference's green (11.9).
```

Keep the comment's last sentence (`Maps, not object literals: ...`) as it is.

- [ ] **Step 4: Update the two `gpu.ts` comments and the chart doc**

`web/src/lib/charts/gpu.ts:25-26`: `CPU kernels). Nothing in the data marks mps as a vendor library, since all` / `three GPU kernels are backend "metal", so like BASELINE_KERNEL this is keyed` becomes `CPU kernels). Nothing in the data marks mps as a vendor library, since every` / `GPU kernel is backend "metal", so like BASELINE_KERNEL this is keyed`.

`web/src/lib/charts/gpu.ts:101-102`: `// The validated legend order: GPU kernels (metal-naive, metal-tiled, mps` / `// sort that way), then the references.` becomes `// The validated legend order: GPU kernels (metal-naive, metal-simdgroup,` / `// metal-tiled, mps sort that way), then the references.`

`web/src/docs/charts/gpu-vs-cpu-at-equal-effort.md:1`: `The hand-written shaders (\`metal-naive\`, \`metal-tiled\`)` becomes `The hand-written shaders (\`metal-naive\`, \`metal-tiled\`, \`metal-simdgroup\`)`.

- [ ] **Step 5: Update the README**

| line | old | new |
|---|---|---|
| 29 | `` The `mps`, `metal-naive` and `metal-tiled` GPU kernels `` | `` The `mps`, `metal-naive`, `metal-tiled` and `metal-simdgroup` GPU kernels `` |
| 156 | `  --kernel mps,metal-naive,metal-tiled \` | `  --kernel mps,metal-naive,metal-tiled,metal-simdgroup \` |
| 176 | `` `metal-naive`, `metal-tiled`) `` in the kernel list | `` `metal-naive`, `metal-tiled`, `metal-simdgroup`) `` |
| 176 | `` `accelerate-bnns` and `mps` outside `f16`/`f32` `` | `` `accelerate-bnns`, `mps` and `metal-simdgroup` outside `f16`/`f32` `` |
| 177 | `` `accelerate-bnns` and `mps` only `f16` and `f32` `` | `` `accelerate-bnns`, `mps` and `metal-simdgroup` only `f16` and `f32` `` |
| 192 | `` `accelerate-bnns` or `mps` outside `f16`/`f32` `` | `` `accelerate-bnns`, `mps` or `metal-simdgroup` outside `f16`/`f32` `` |
| 255 | `` (`mps`, `metal-naive`, `metal-tiled`) `` | `` (`mps`, `metal-naive`, `metal-tiled`, `metal-simdgroup`) `` |

Insert a table row after the `metal-tiled` row (line 88). Use Task 2b's frozen numbers and kept levers; the text below is for `64-k32` with no levers. For a 32-wide block, write 32×32 and 16×16; for `BK` 16, write 16-deep. If Task 2b kept double buffering, replace "it stages a strip of A and one of B in threadgroup memory (zeros past the edge)" with "it stages a strip of A and one of B in one of two threadgroup buffers (zeros past the edge), reading the next step's strips while multiplying the current ones". If it kept the direct store, add "Interior results go straight from registers to C." after "instead of one."

```markdown
| `metal-simdgroup` | Same shader source | Each threadgroup of 4 simdgroups (128 threads) computes a 64×64 block of C. Per 32-deep step it stages a strip of A and one of B in threadgroup memory (zeros past the edge), and each simdgroup multiplies 8×8 `simdgroup_matrix` fragments out of them into the 32×32 part of the block it holds in registers, so each loaded value feeds many multiply-adds instead of one. Supports `f16` and `f32` only (`simdgroup_matrix` has no integer types). The block shape is fixed, so no knob applies. Accumulates in the element type; timed like `mps`. On M1 the fragment multiplies run on the ordinary GPU ALUs: there is no matrix hardware. |
```

- [ ] **Step 6: Run the web checks**

Run: `just test-web && just check-web && just lint-web`
Expected: PASS, no type errors, Biome clean (`lint-web` auto-fixes formatting; re-stage anything it changed).

- [ ] **Step 7: Commit**

```bash
git add README.md web/src/docs/charts/gpu-vs-cpu-at-equal-effort.md web/src/lib/palette.ts web/src/lib/palette.test.ts web/src/lib/charts/gpu.ts
git commit -m "Document metal-simdgroup and pin it to the validated indigo slot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Performance review

**Files:**
- Possibly modify: `benchmark/src/kernels/metal/gemm.metal`, `benchmark/src/kernels/metal/shader.rs`

**Interfaces:**
- Consumes: the committed kernel (Tasks 1–2).
- Produces: either no change, or fixes, each confirmed by tests and (for any performance change) a `/tmp` re-measurement.

- [ ] **Step 1: Dispatch the hpc-specialist agent**

Prompt it with: "Review `git diff main...HEAD -- benchmark/src/kernels/metal/` on branch `feat/metal-simdgroup`: the new `gemm_simdgroup` Metal kernel and its dispatch in `shader.rs`, per spec `docs/superpowers/specs/2026-10-03-metal-simdgroup-kernel-design.md`. Check performance correctness on Apple M1-family GPUs: coalescing of the staging copies, threadgroup-memory bank conflicts in `simdgroup_load`, whether every fragment loop unrolls (no dynamic indexing of `acc`), register pressure and occupancy, barrier placement, edge handling for ragged n, and the dispatch geometry. Report findings with file:line and the evidence for each; do not edit files."

- [ ] **Step 2: Act on the findings**

- **Correctness findings** (wrong results or out-of-bounds access): fix them, add a failing test first if the existing n ∈ {7, 37, 100} tests did not catch it, and run `cargo test --manifest-path benchmark/Cargo.toml`.
- **Performance suggestions:** adopt one only if a `/tmp` re-run (same command and query as Task 2 Step 1) beats the frozen numbers at n=4096 by more than 3% (noise). Otherwise, list it under the spec's Follow-ups instead.
- No findings: skip to Task 5.

- [ ] **Step 3: Commit (only if anything changed)**

```bash
git add benchmark/src/kernels/metal/gemm.metal benchmark/src/kernels/metal/shader.rs benchmark/src/kernels/mod.rs docs/superpowers/specs/2026-10-03-metal-simdgroup-kernel-design.md
git commit -m "Apply the performance review of metal-simdgroup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Measure into the host DB

**Files:**
- Modify (by the tool only): `data/db/paulhondola/m1pro.sqlite`

**Interfaces:**
- Consumes: the committed, tuned kernel. `.host` (contents `paulhondola/m1pro`) names the DB `just bench` writes by default.
- Produces: one new run in `m1pro.sqlite` with `metal-tiled`, `metal-simdgroup` and `mps` at f16 and f32, n = 64 … 4096.

- [ ] **Step 1: Confirm a clean tree**

Run: `git status --porcelain`
Expected: no output, so the run records a clean `commit_id` rather than a dirty one.

- [ ] **Step 2: Run the benchmark**

With the machine otherwise idle:

```bash
just bench --kernel metal-tiled,metal-simdgroup,mps --precision f16,f32
```

Expected: 42 configurations (3 kernels × 2 precisions × 7 sizes), no accuracy failures. The harness aborts a run whose output exceeds 4√N·ε against `ikj`. If that happens, stop and report the message.

- [ ] **Step 3: Check the success bar**

```bash
sqlite3 -header -column data/db/paulhondola/m1pro.sqlite \
  "SELECT kernel, precision, n, round(2.0*n*n*n/(gpu_ms*1e6), 1) AS gflops_gpu,
          round(100*2.0*n*n*n/(gpu_ms*1e6)/5308.416, 1) AS pct_peak, round(gops, 1) AS gops_e2e
   FROM measurements WHERE run_id = (SELECT max(run_id) FROM runs) AND n >= 1024
   ORDER BY n, precision, kernel"
```

Pass: `metal-simdgroup` at n=4096 ≥ 2,654 `gflops_gpu` at both f16 and f32. Record whether the stretch goal (≥ 0.9 × `mps`'s `gflops_gpu` in this run) holds.

If it fails: **do not commit the DB.** Leave the modified file uncommitted (do not discard it), report the table to the user, and stop.

- [ ] **Step 4: Validate and commit the DB on its own**

Run: `just validate`
Expected: every DB passes.

```bash
git add data/db/paulhondola/m1pro.sqlite
git commit -m "Measure metal-simdgroup against metal-tiled and mps on the M1 Pro

<n=4096 gflops_gpu and pct_peak for the three kernels at f16 and f32, from Step 3>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Lefthook's `host-db-validate` runs `gemm-bench validate` on the staged DB.

---

### Task 6: Final checks and PR

**Files:** none (verification and PR only).

- [ ] **Step 1: Full checks**

Run: `just check && just test`
Expected: clippy clean, svelte-check clean, all Rust and Bun tests pass.

- [ ] **Step 2: Look at the dashboard**

Start the dev server with the `dashboard` entry in `.claude/launch.json` (`bun --cwd web dev`, port 5173), open the GPU tab, and confirm three things: `metal-simdgroup` appears between `metal-naive` and `metal-tiled` in the legend, it is drawn in indigo, and its line sits between `metal-tiled` and `mps`. Take a screenshot for the PR.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/metal-simdgroup
gh pr create --title "Add metal-simdgroup, a simdgroup_matrix GEMM shader" --body "<summary: the problem (metal-tiled at 10.9% of peak), the kernel's shape, the Task 2 tuning table, the Task 5 n=4096 results against metal-tiled and mps, and the dashboard screenshot>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Then bind the PR in the app (`ccd_pr` `get_status`, and `bind_pr` if it isn't reported).
