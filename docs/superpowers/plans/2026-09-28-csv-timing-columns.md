# CSV Timing Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write one CSV record per measurement, with the GPU-only window as a `gpu_ms` column and each kernel's one-time build cost as `setup_ms`, instead of a second `<kernel>-e2e` record.

**Architecture:** The Rust harness times kernel construction in `measure` and folds a Metal kernel's two timing windows into one `BenchmarkRecord`. `data/build.sql` rejects rows of the old shape. The dashboard stops folding `-e2e` pairs because the CSV already has the folded shape. The data is regenerated in one overnight run.

**Tech Stack:** Rust nightly (`benchmark/`, serde + csv), DuckDB CLI (`data/build.sql`), Bun + Svelte 5 + TypeScript (`web/`), `just`.

**Spec:** `docs/superpowers/specs/2026-09-28-csv-timing-columns-design.md`

## Global Constraints

- Column order: `…, median_ms, min_ms, stddev_ms, gpu_ms, setup_ms, block_size, …`.
- `gpu_ms` is set on exactly the `backend = 'metal'` rows and empty elsewhere; `setup_ms` is set on every row.
- `median_ms`, `min_ms`, `stddev_ms` and `gops` are the caller-visible time on every row (the round trip on Metal).
- Rust is nightly, pinned by `rust-toolchain.toml`. Gate macOS-only code with `#[cfg(target_os = "macos")]`; `cargo clippy --all-targets -- -D warnings` must pass for the non-macOS shape too (CI is Linux).
- Throwaway benchmark runs pass `--output /tmp/<name>.csv`. Never hand-edit a file under `data/runs/`.
- Lefthook runs fmt/clippy/test/Biome/typecheck/data-build on commit; don't bypass it.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Until Task 6 regenerates the data, `just data` (and so `just dev`) fails on the old run files after Task 3. That is expected.

## File Map

| File | Change |
| :--- | :--- |
| `benchmark/src/kernels/metal/mod.rs` | `GpuSamples` gains `setup` (buffer allocation time) |
| `benchmark/src/kernels/mod.rs` | MPS timing test also checks `setup` |
| `benchmark/src/benchmark.rs` | `Samples { timed, gpu, setup }`, `measure` times construction, one record per measurement, `BenchmarkRecord` gains `gpu_ms`, `setup_ms` |
| `benchmark/src/report.rs` | Terminal table gains `gpu_ms`, `setup_ms`; CSV test covers the new columns |
| `data/build.sql` | Types, `setup_ms` required, `gpu_ms` shape check, JSON non-finite guards |
| `web/src/lib/derive.ts`, `derive.test.ts` | Delete `withEndToEnd` and its tests |
| `web/src/lib/state.svelte.ts` | Boot without `withEndToEnd` |
| `web/src/lib/charts/gpu.ts`, `overview.ts`, `gpu.test.ts` | Comments stop citing `withEndToEnd` |
| `README.md`, `.claude/agents/dashboard-designer.md` | Schema and methodology |
| `data/runs/Pauls-MacBook-Pro/*.csv` | Replaced by one regenerated run |

---

### Task 1: Time Metal buffer allocation

**Files:**
- Modify: `benchmark/src/kernels/metal/mod.rs` (the `GpuSamples` struct and the start of `time_dispatch`)
- Test: `benchmark/src/kernels/mod.rs` (`mps_benchmark_times_every_repetition_both_ways`)

**Interfaces:**
- Produces: `pub struct GpuSamples { pub gpu: Vec<Duration>, pub e2e: Vec<Duration>, pub setup: Duration }`. `setup` is the time `time_dispatch` spent allocating the three `n`×`n` operand buffers, once, before its warm-up iteration.

- [ ] **Step 1: Write the failing test**

In `benchmark/src/kernels/mod.rs`, at the end of `mps_benchmark_times_every_repetition_both_ways`, after the `gpu <= e2e` assertion, add:

```rust
        // Allocating the three shared buffers is timed once, as setup.
        assert!(samples.setup > std::time::Duration::ZERO);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path benchmark/Cargo.toml mps_benchmark_times_every_repetition_both_ways`
Expected: compile error `no field `setup` on type `GpuSamples``.

- [ ] **Step 3: Implement**

In `benchmark/src/kernels/metal/mod.rs`, replace the `GpuSamples` struct:

```rust
/// Per-repetition timings of a Metal kernel.
pub struct GpuSamples {
    /// `commit` → `waitUntilCompleted`: GPU execution only.
    pub gpu: Vec<Duration>,
    /// Upload, encode, commit, wait and download: what a caller pays.
    pub e2e: Vec<Duration>,
    /// Allocating the `n`×`n` operand buffers, once, before the warm-up.
    pub setup: Duration,
}
```

In `time_dispatch`, replace:

```rust
        let context = kernel.context();
        let operands = GpuOperands::<T>::new(&context.device, lhs.rows())?;
        let mut samples = GpuSamples {
            gpu: Vec::with_capacity(repetitions),
            e2e: Vec::with_capacity(repetitions),
        };
```

with:

```rust
        let context = kernel.context();
        let allocation = Instant::now();
        let operands = GpuOperands::<T>::new(&context.device, lhs.rows())?;
        let mut samples = GpuSamples {
            gpu: Vec::with_capacity(repetitions),
            e2e: Vec::with_capacity(repetitions),
            setup: allocation.elapsed(),
        };
```

(`Instant` is already imported at the top of the file.)

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path benchmark/Cargo.toml mps_benchmark_times_every_repetition_both_ways && cargo clippy --manifest-path benchmark/Cargo.toml --all-targets -- -D warnings`
Expected: the test passes; clippy clean.

- [ ] **Step 5: Commit**

```bash
git add benchmark/src/kernels/metal/mod.rs benchmark/src/kernels/mod.rs
git commit -m "Time Metal buffer allocation as part of a GPU kernel's setup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One record per measurement with `gpu_ms` and `setup_ms`

**Files:**
- Modify: `benchmark/src/benchmark.rs` (`BenchmarkRecord`, `run_precision`'s record loop, `Samples`, the `From<GpuSamples>` impl, `measure`, `sample`, tests)
- Modify: `benchmark/src/report.rs` (`TerminalBenchmarkRecord`, `render_results_table`, tests)

**Interfaces:**
- Consumes: `GpuSamples { gpu, e2e, setup }` from Task 1.
- Produces: `BenchmarkRecord` fields `gpu_ms: Option<f64>` and `setup_ms: f64`, serialized between `stddev_ms` and `block_size`. `Samples { timed: Vec<Duration>, gpu: Option<Vec<Duration>>, setup: Duration }` (private to `benchmark.rs`).

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/benchmark.rs`'s `tests` module, replace the imports with:

```rust
    use std::time::Duration;

    use clap::Parser;
    use gemm_bench::Matrix;

    use gemm_bench::{GemmKernel, kernels::IkjGemm};

    use super::{
        BenchmarkRecord, benchmark_inputs, f64_reference, max_relative_error,
        mean_relative_error, measure, run, summarize, tolerance,
    };
    use crate::{cli::Cli, kernel::KernelChoice};
```

Replace the tests `cpu_kernels_have_no_end_to_end_samples` and `metal_kernels_time_the_gpu_and_the_round_trip` with:

```rust
    #[test]
    fn cpu_kernels_have_a_setup_time_and_no_gpu_window() {
        let (lhs, rhs) = benchmark_inputs::<f32>(8);
        let mut output = Matrix::zeros(8, 8);
        let samples = measure(KernelChoice::RayonIkj, 2, None, 2, &lhs, &rhs, &mut output)
            .expect("rayon-ikj should run");
        assert_eq!(samples.timed.len(), 2);
        assert!(samples.gpu.is_none());
        // Building a two-worker pool spawns threads, which takes measurable time.
        assert!(samples.setup > Duration::ZERO);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_kernels_time_the_round_trip_the_gpu_window_and_setup() {
        let (lhs, rhs) = benchmark_inputs::<f32>(8);
        let mut output = Matrix::zeros(8, 8);
        let samples = measure(KernelChoice::Mps, 1, None, 2, &lhs, &rhs, &mut output)
            .expect("mps should run");
        let gpu = samples.gpu.expect("a Metal kernel records its GPU window");
        assert_eq!((samples.timed.len(), gpu.len()), (2, 2));
        // `timed` is the round trip, and the GPU window sits inside it.
        assert!(gpu.iter().zip(&samples.timed).all(|(gpu, e2e)| gpu <= e2e));
        assert!(samples.setup > Duration::ZERO);
    }

    /// One real run of `kernel` at n = 8, planned through the CLI as `main` does.
    fn run_one(kernel: &str) -> Vec<BenchmarkRecord> {
        let output = std::env::temp_dir().join(format!(
            "gemm-bench-run-test-{}-{kernel}.csv",
            std::process::id()
        ));
        let plan = Cli::try_parse_from([
            "gemm-bench",
            "--output",
            output.to_str().expect("temp paths are UTF-8"),
            "--sizes",
            "8",
            "--kernel",
            kernel,
            "--threads",
            "1",
            "--precision",
            "f32",
            "--repetitions",
            "2",
            "--no-progress",
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("the plan should be valid");
        let records = run(&plan).expect("the run should succeed");
        let _ = std::fs::remove_file(output);
        records
    }

    #[test]
    fn a_cpu_measurement_writes_one_record_without_gpu_ms() {
        let records = run_one("ikj");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].kernel, "ikj");
        assert_eq!(records[0].gpu_ms, None);
        assert!(records[0].setup_ms >= 0.0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_metal_measurement_writes_one_end_to_end_record_with_gpu_ms() {
        let records = run_one("mps");
        assert_eq!(records.len(), 1, "no separate -e2e record");
        let record = &records[0];
        assert_eq!(record.kernel, "mps");
        let gpu_ms = record.gpu_ms.expect("Metal records carry gpu_ms");
        // Each GPU window sits inside its round trip, so the medians keep that order.
        assert!(gpu_ms <= record.median_ms);
        // gops comes from the round trip, like every CPU row.
        let expected = 2.0 * 8f64.powi(3) / (record.median_ms / 1_000.0) / 1e9;
        assert!((record.gops - expected).abs() <= 1e-9 * expected);
        assert!(record.setup_ms > 0.0);
    }
```

In `benchmark/src/report.rs`'s `tests` module, add the new fields to the `record()` fixture, after `stddev_ms: 0.25,`:

```rust
            gpu_ms: None,
            setup_ms: 0.05,
```

Replace the start of `terminal_table_uses_schema_headers_and_compact_float_precision` up to its first assertion:

```rust
    #[test]
    fn terminal_table_uses_schema_headers_and_compact_float_precision() {
        let mps = BenchmarkRecord {
            kernel: "mps".to_owned(),
            backend: "metal",
            gpu_ms: Some(10.5),
            ..record()
        };
        let table = render_results_table(&[record(), mps]);

        assert!(table.contains("gpu_ms"));
        assert!(table.contains("10.500"));
        assert!(table.contains("setup_ms"));
        assert!(table.contains("0.050"));
        assert!(table.contains("kernel"));
```

(the remaining assertions stay as they are). Replace the body of `write_records_outputs_csv_in_schema_order` from `let tiled = …` to the `assert_eq!` inclusive:

```rust
        let tiled = BenchmarkRecord {
            kernel: "tiled".to_owned(),
            block_size: Some(64),
            ..record()
        };
        let mps = BenchmarkRecord {
            kernel: "mps".to_owned(),
            backend: "metal",
            device: "Test GPU".to_owned(),
            threads: 1,
            gpu_ms: Some(10.5),
            ..record()
        };

        super::write_records(csv_file, &[record(), tiled, mps]).expect("write records");

        let csv_content = std::fs::read_to_string(&csv_path).expect("read csv");
        // Kernels that don't tile leave block_size empty, and kernels off Metal
        // leave gpu_ms empty; the others record them.
        assert_eq!(
            csv_content,
            "kernel,backend,device,precision,n,threads,gops,mean_rel_error_f64,median_ms,min_ms,stddev_ms,gpu_ms,setup_ms,block_size,repetitions,host,commit,timestamp\n\
             rayon-ikj,cpu,Test CPU,f32,256,4,2.5,0.001234,12.34567,12.0,0.25,,0.05,,5,test-host,abc1234,2026-09-17T12:15:00Z\n\
             tiled,cpu,Test CPU,f32,256,4,2.5,0.001234,12.34567,12.0,0.25,,0.05,64,5,test-host,abc1234,2026-09-17T12:15:00Z\n\
             mps,metal,Test GPU,f32,256,1,2.5,0.001234,12.34567,12.0,0.25,10.5,0.05,,5,test-host,abc1234,2026-09-17T12:15:00Z\n"
        );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: compile errors: `no field `gpu` on type `Samples``, `struct `BenchmarkRecord` has no field named `gpu_ms``, and the same for `setup`/`setup_ms`.

- [ ] **Step 3: Add the record fields**

In `benchmark/src/benchmark.rs`, in `BenchmarkRecord`, after `pub(crate) stddev_ms: f64,` add:

```rust
    /// Median GPU execution (`commit` → `waitUntilCompleted`) inside the
    /// round trip that `median_ms` times. Empty in the CSV off Metal.
    pub(crate) gpu_ms: Option<f64>,
    /// One-time cost of building the kernel for this configuration, one sample.
    pub(crate) setup_ms: f64,
```

- [ ] **Step 4: Replace `Samples` and its `From<GpuSamples>` impl**

Replace the `Samples` struct, its doc comment, and the whole `#[cfg(target_os = "macos")] impl From<GpuSamples> for Samples { … }` block with:

```rust
/// One configuration's measurements. `timed` is what a caller waits for per
/// run: one `compute` call, or a Metal kernel's whole round trip (upload,
/// encode, dispatch, download), with its GPU execution alone in `gpu`.
/// `setup` is the one-time cost of building the kernel, taken once.
struct Samples {
    timed: Vec<Duration>,
    gpu: Option<Vec<Duration>>,
    setup: Duration,
}

/// A Metal kernel's round trip and GPU window, with its buffer allocation
/// added to the time it took to build the kernel.
#[cfg(target_os = "macos")]
fn on_gpu(built: Duration, samples: GpuSamples) -> Samples {
    Samples {
        timed: samples.e2e,
        gpu: Some(samples.gpu),
        setup: built + samples.setup,
    }
}
```

- [ ] **Step 5: Time construction in `measure` and `sample`**

Replace the whole `measure` function, with its doc comment, by:

```rust
/// Returns the timed runs and the kernel's one-time setup time.
///
/// Kernel setup (a pool, a compiled graph, a Metal device and buffers) happens
/// here, before `sample`'s untimed warm-up run, so one-time costs stay out of
/// the timed samples; they are recorded once, as `setup`.
fn measure<T: Element>(
    choice: KernelChoice,
    threads: usize,
    block_size: Option<usize>,
    repetitions: usize,
    lhs: &Matrix<T>,
    rhs: &Matrix<T>,
    output: &mut Matrix<T>,
) -> Result<Samples, Box<dyn std::error::Error>> {
    // `BenchmarkPlan::cells` gives every tiled kernel a block size.
    let block = || block_size.expect("tiled kernels always get a block size");
    let io = (lhs, rhs, output, repetitions);
    // Each arm builds its kernel before `sample` starts, so the time from here
    // to `sample`'s first line is that kernel's setup.
    let setup_start = Instant::now();
    Ok(match choice {
        KernelChoice::Naive => sample(&NaiveGemm, setup_start, io),
        KernelChoice::Ikj => sample(&IkjGemm, setup_start, io),
        KernelChoice::Tiled => sample(&TiledGemm::new(block()), setup_start, io),
        KernelChoice::RayonIkj => {
            sample(&InPool::new(threads, RayonIkjGemm)?, setup_start, io)
        }
        KernelChoice::RayonTiled => sample(
            &InPool::new(threads, RayonTiledGemm::new(block()))?,
            setup_start,
            io,
        ),
        KernelChoice::StaticIkj => sample(&StaticIkjGemm::new(threads)?, setup_start, io),
        KernelChoice::StaticTiled => {
            sample(&StaticTiledGemm::new(threads, block())?, setup_start, io)
        }
        #[cfg(target_os = "macos")]
        KernelChoice::AccelerateBlas => sample(&AccelerateBlasGemm, setup_start, io),
        #[cfg(target_os = "macos")]
        KernelChoice::AccelerateBnns => sample(
            &AccelerateBnnsGemm::<T>::new(lhs.rows())
                .expect("accelerate-bnns needs macOS 26 (the BNNSGraph builder)"),
            setup_start,
            io,
        ),
        // Metal kernels time the GPU window and the round trip in their own loop.
        #[cfg(target_os = "macos")]
        KernelChoice::Mps => {
            let kernel = MpsGemm::<T>::new().expect("MPS needs a Metal device and f16 or f32");
            let built = setup_start.elapsed();
            on_gpu(built, kernel.benchmark(lhs, rhs, io.2, repetitions)?)
        }
        #[cfg(target_os = "macos")]
        KernelChoice::MetalNaive => {
            let kernel = ShaderGemm::<T>::new(Shader::Naive)?
                .expect("metal-naive needs a Metal device and f16, f32, i32 or i64");
            let built = setup_start.elapsed();
            on_gpu(built, kernel.benchmark(lhs, rhs, io.2, repetitions)?)
        }
        #[cfg(target_os = "macos")]
        KernelChoice::MetalTiled => {
            let kernel = ShaderGemm::<T>::new(Shader::Tiled)?
                .expect("metal-tiled needs a Metal device and f16, f32, i32 or i64");
            let built = setup_start.elapsed();
            on_gpu(built, kernel.benchmark(lhs, rhs, io.2, repetitions)?)
        }
    })
}
```

Replace the whole `sample` function, with its doc comment, by:

```rust
/// One untimed warm-up run, then `repetitions` timed ones. `setup_start` is
/// when building `kernel` began, so the time until this call is its setup.
fn sample<T: Element>(
    kernel: &impl GemmKernel<T>,
    setup_start: Instant,
    (lhs, rhs, output, repetitions): (&Matrix<T>, &Matrix<T>, &mut Matrix<T>, usize),
) -> Samples {
    let setup = setup_start.elapsed();
    kernel.compute(lhs, rhs, output);
    Samples {
        timed: (0..repetitions)
            .map(|_| time_kernel(kernel, lhs, rhs, output))
            .collect(),
        gpu: None,
        setup,
    }
}
```

- [ ] **Step 6: Push one record per measurement**

In `run_precision`, replace everything from `// Both records come from the same runs, so they share one accuracy.` to the closing `}` of the `for (label, timed) in runs { … }` loop with:

```rust
                let stats = summarize(&samples.timed);
                records.push(BenchmarkRecord {
                    kernel: kernel.label().to_owned(),
                    backend: kernel.backend(),
                    device: plan.devices.of(kernel).to_owned(),
                    precision: precision.label(),
                    n,
                    threads: thread_count,
                    gops: 2.0 * (n as f64).powi(3) / (stats.median_ms / 1_000.0) / 1e9,
                    mean_rel_error_f64: mean_relative_error(&output, &truth),
                    median_ms: stats.median_ms,
                    min_ms: stats.min_ms,
                    stddev_ms: stats.stddev_ms,
                    gpu_ms: samples.gpu.as_deref().map(|gpu| summarize(gpu).median_ms),
                    setup_ms: samples.setup.as_secs_f64() * 1_000.0,
                    block_size,
                    repetitions: plan.repetitions,
                    host: plan.context.host.clone(),
                    commit: plan.context.commit.clone(),
                    timestamp: plan.context.timestamp.clone(),
                });
```

- [ ] **Step 7: Show both columns in the terminal table**

In `benchmark/src/report.rs`, in `TerminalBenchmarkRecord`, after `stddev_ms: String,` add:

```rust
    gpu_ms: String,
    setup_ms: String,
```

In `render_results_table`, after the `stddev_ms: format!("{:.3}", record.stddev_ms),` line add:

```rust
        gpu_ms: record
            .gpu_ms
            .map_or_else(|| "-".to_owned(), |ms| format!("{ms:.3}")),
        setup_ms: format!("{:.3}", record.setup_ms),
```

- [ ] **Step 8: Run the tests and checks**

Run: `just test-bench && just check-bench`
Expected: all tests pass, including the four new ones; clippy clean.

- [ ] **Step 9: Smoke-test a real run**

Run: `just bench --sizes 64 --kernel ikj,rayon-ikj,mps --threads 2 --precision f32 --repetitions 3 --no-progress --output /tmp/gemm-bench-smoke.csv && cat /tmp/gemm-bench-smoke.csv`
Expected: three data rows (no `mps-e2e`); the header has `gpu_ms,setup_ms` after `stddev_ms`; `mps` has a `gpu_ms` value not above its `median_ms`, the CPU rows leave it empty; every row has a `setup_ms`, with `mps` in the milliseconds and `ikj` near 0.

- [ ] **Step 10: Commit**

```bash
git add benchmark/src/benchmark.rs benchmark/src/report.rs
git commit -m "Write one record per measurement with gpu_ms and setup_ms

Metal kernels wrote a GPU-only record and a -e2e twin from the same
repetitions. The record now carries the round trip, the same scope as a
CPU call, with the GPU window as gpu_ms. setup_ms times building each
kernel: a thread pool, a BNNS graph, a Metal device, shader and buffers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Validate the new shape in `build.sql`

**Files:**
- Modify: `data/build.sql`

**Interfaces:**
- Consumes: the CSV columns from Task 2.
- Produces: `results.json` rows carrying `gpu_ms` (null off Metal) and `setup_ms`. `just data` fails, naming the file, on a row missing `setup_ms` or with `gpu_ms` on the wrong backend.

- [ ] **Step 1: Set up the scratch checks**

Run from the repo root (these checks run `build.sql` in a scratch directory, so the repo's data is untouched):

```bash
REPO=$(pwd)
T=$(mktemp -d) && mkdir -p "$T/data/runs/h" "$T/web/public"
just bench --sizes 64 --kernel ikj,mps --precision f32 --repetitions 2 --no-progress --output "$T/good.csv"
awk -F, -v OFS=, 'NR > 1 && $2 == "cpu" { $12 = "1.0" } 1' "$T/good.csv" > "$T/cpu-with-gpu.csv"
awk -F, -v OFS=, 'NR > 1 && $2 == "metal" { $12 = "" } 1' "$T/good.csv" > "$T/metal-without-gpu.csv"
build() { rm -f "$T"/data/runs/h/*; cp "$@" "$T/data/runs/h/"; if (cd "$T" && duckdb -bail < "$REPO/data/build.sql") >/dev/null 2>"$T/err"; then echo PASS; else echo "FAIL: $(cat "$T/err")"; fi; }
```

(Column 12 is `gpu_ms` in the Task 2 header.)

- [ ] **Step 2: Run the checks to see the gaps**

```bash
build "$T/good.csv"                                             # want PASS
build "$T/good.csv" data/runs/Pauls-MacBook-Pro/mps.csv         # want FAIL naming mps.csv
build "$T/cpu-with-gpu.csv"                                     # want FAIL
build "$T/metal-without-gpu.csv"                                # want FAIL
```

Expected before the change: all four print `PASS`. The last three are the bugs.

- [ ] **Step 3: Implement**

In `data/build.sql`, in the `types = {…}` map, replace:

```sql
             'median_ms': 'DOUBLE', 'min_ms': 'DOUBLE', 'stddev_ms': 'DOUBLE',
```

with:

```sql
             'median_ms': 'DOUBLE', 'min_ms': 'DOUBLE', 'stddev_ms': 'DOUBLE',
             'gpu_ms': 'DOUBLE', 'setup_ms': 'DOUBLE',
```

Replace the comment and `WHERE` clause of the required-values check:

```sql
-- union_by_name fills a column missing from one file with NULL instead of
-- failing, so required values are checked explicitly. block_size is exempt:
-- roadmap item 4 leaves it empty for kernels that don't use blocks.
CREATE TEMP TABLE _validation_failed AS
SELECT error('run files missing required values: ' || string_agg(DISTINCT filename, ', '))
FROM runs
WHERE kernel IS NULL OR backend IS NULL OR device IS NULL OR precision IS NULL
   OR n IS NULL OR threads IS NULL OR gops IS NULL OR mean_rel_error_f64 IS NULL
   OR median_ms IS NULL OR min_ms IS NULL OR stddev_ms IS NULL OR repetitions IS NULL
   OR host IS NULL OR commit IS NULL OR "timestamp" IS NULL
HAVING count(*) > 0;
```

with:

```sql
-- union_by_name fills a column missing from one file with NULL instead of
-- failing, so required values are checked explicitly; a run file from before
-- setup_ms existed fails here. block_size is exempt: roadmap item 4 leaves it
-- empty for kernels that don't use blocks. gpu_ms is checked below.
CREATE TEMP TABLE _validation_failed AS
SELECT error('run files missing required values: ' || string_agg(DISTINCT filename, ', '))
FROM runs
WHERE kernel IS NULL OR backend IS NULL OR device IS NULL OR precision IS NULL
   OR n IS NULL OR threads IS NULL OR gops IS NULL OR mean_rel_error_f64 IS NULL
   OR median_ms IS NULL OR min_ms IS NULL OR stddev_ms IS NULL OR setup_ms IS NULL
   OR repetitions IS NULL OR host IS NULL OR commit IS NULL OR "timestamp" IS NULL
HAVING count(*) > 0;

-- gpu_ms is the GPU window inside a Metal round trip, so it is set on exactly
-- the Metal rows: without it the row's timings can't be told apart from a
-- GPU-only measurement, and a CPU row has no GPU window to report.
CREATE TEMP TABLE _gpu_ms_misplaced AS
SELECT error('gpu_ms must be set on exactly the metal rows: ' || string_agg(DISTINCT filename, ', '))
FROM runs
WHERE (backend = 'metal') <> (gpu_ms IS NOT NULL)
HAVING count(*) > 0;
```

In the `COPY`'s `REPLACE (…)` list, replace:

```sql
      CASE WHEN isfinite(stddev_ms) THEN stddev_ms END AS stddev_ms)
```

with:

```sql
      CASE WHEN isfinite(stddev_ms) THEN stddev_ms END AS stddev_ms,
      CASE WHEN isfinite(gpu_ms) THEN gpu_ms END AS gpu_ms,
      CASE WHEN isfinite(setup_ms) THEN setup_ms END AS setup_ms)
```

- [ ] **Step 4: Run the checks again**

```bash
build "$T/good.csv"
build "$T/good.csv" data/runs/Pauls-MacBook-Pro/mps.csv
build "$T/cpu-with-gpu.csv"
build "$T/metal-without-gpu.csv"
build "$T/good.csv" && grep -o '"kernel":"[a-z-]*"\|"gpu_ms":[^,]*\|"setup_ms":[^,]*' "$T/web/public/results.json"
```

Expected, in order:
- `PASS`
- `FAIL: … run files missing required values: data/runs/h/mps.csv`
- `FAIL: … gpu_ms must be set on exactly the metal rows: data/runs/h/cpu-with-gpu.csv`
- `FAIL: … gpu_ms must be set on exactly the metal rows: data/runs/h/metal-without-gpu.csv`
- `PASS`, then `ikj` with `"gpu_ms":null` and a numeric `setup_ms`, and `mps` with numbers for both.

- [ ] **Step 5: Clean up and commit**

```bash
rm -rf "$T" /tmp/gemm-bench-smoke.csv
git add data/build.sql
git commit -m "Require setup_ms, and gpu_ms on exactly the Metal rows

A run file written before the timing columns has no setup_ms and fails
with its filename, so an old GPU-only record can't pass as end-to-end.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stop folding `-e2e` pairs in the dashboard

**Files:**
- Modify: `web/src/lib/derive.ts` (delete `E2E_SUFFIX`, `measurementKey`, `withEndToEnd` at the end of the file)
- Modify: `web/src/lib/derive.test.ts` (import, and the `gpuRun` block of five tests)
- Modify: `web/src/lib/state.svelte.ts`
- Modify: `web/src/lib/charts/gpu.ts`, `web/src/lib/charts/overview.ts`, `web/src/lib/charts/gpu.test.ts` (comments and one test name)

**Interfaces:**
- Consumes: `results.json` rows as Task 3 writes them: Metal rows under their plain kernel name, end-to-end timings, `gpu_ms` set; every other row `gpu_ms: null`.
- Produces: `boot()` stores `partitionPlottable`'s rows unchanged. `withEndToEnd` no longer exists.

- [ ] **Step 1: Delete the fold and its tests**

In `web/src/lib/derive.ts`, delete everything from `const E2E_SUFFIX = "-e2e";` to the end of the file (`measurementKey` and `withEndToEnd`, with their doc comments).

In `web/src/lib/derive.test.ts`, remove `withEndToEnd,` from the import list, and delete everything from `// Both rows of one Metal measurement share host and timestamp.` through the end of the test `CPU rows pass through with gpu_ms null` (the `gpuRun` constant and five tests), stopping before `test("bestPerFamily keeps each family's winning row per precision and size"`.

- [ ] **Step 2: Boot without the fold**

In `web/src/lib/state.svelte.ts`, remove `withEndToEnd,` from the `./derive` import, and replace:

```ts
		const { rows: usable, dropped } = partitionPlottable(await loadRows());
		// One row per measurement from here on: Metal rows carry end-to-end
		// timings under their plain name (see withEndToEnd).
		const rows = withEndToEnd(usable);
```

with:

```ts
		// One row per measurement: Metal rows carry end-to-end timings, with
		// the GPU-only median as gpu_ms.
		const { rows, dropped } = partitionPlottable(await loadRows());
```

- [ ] **Step 3: Update the comments that cite the fold**

`web/src/lib/charts/gpu.ts`, replace:

```ts
/** Each GPU kernel's best row at each size; rows are end-to-end (withEndToEnd). */
```

with:

```ts
/** Each GPU kernel's best row at each size; Metal rows are end-to-end. */
```

and replace:

```ts
	// The same best-per-(kernel, n) rows the kernel chart plots. A row with no
	// GPU-only twin (gpu_ms null) has nothing to subtract, so it is skipped.
```

with:

```ts
	// The same best-per-(kernel, n) rows the kernel chart plots. Only Metal
	// rows carry gpu_ms; a row without it has nothing to subtract, so it is
	// skipped.
```

`web/src/lib/charts/overview.ts`, replace:

```ts
 * at every size. Metal rows are end-to-end here (see withEndToEnd), the same
 * host-to-host scope as the CPU rows they are drawn against, so every line is
 * solid.
```

with:

```ts
 * at every size. Metal rows are timed end-to-end, the same host-to-host scope
 * as the CPU rows they are drawn against, so every line is solid.
```

`web/src/lib/charts/gpu.test.ts`, replace:

```ts
// GPU rows as withEndToEnd emits them: the plain kernel name, end-to-end
// timings, and the GPU-only median as gpu_ms.
```

with:

```ts
// GPU rows as the CSV records them: end-to-end timings, and the GPU-only
// median as gpu_ms.
```

and rename the test `"a GPU row without a GPU-only twin is left out of the overhead chart"` to `"a GPU row without gpu_ms is left out of the overhead chart"`.

- [ ] **Step 4: Run the web checks**

Run: `cd web && bun test && bun run typecheck && bunx @biomejs/biome check src && cd ..`
Expected: all tests pass (five fewer than before), no type errors, Biome clean. `grep -rn withEndToEnd web/src` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "Read Metal rows as the CSV writes them instead of folding -e2e pairs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Document the columns

**Files:**
- Modify: `README.md` (kernel tables, Methodology steps 1, 2 and 5, dashboard paragraph)
- Modify: `.claude/agents/dashboard-designer.md` (the column list)

- [ ] **Step 1: Kernel tables**

In the `accelerate-blas` row, replace:

```
Runs recorded before the BNNS kernel existed are labelled `accelerate` in their CSVs; `data/build.sql` publishes them as `accelerate-blas`. The CLI name changed too: `--kernel accelerate`
```

with:

```
The CLI name changed when the BNNS kernel arrived: `--kernel accelerate`
```

In the `mps` row, replace:

```
The timed region is GPU execution only (`commit` → `waitUntilCompleted`); an `mps-e2e` record from the same runs adds the buffer copies and command encoding (see Methodology).
```

with:

```
Its timings are the round trip a caller waits for (copying the inputs into the buffers, encoding, GPU execution, copying the result back), and `gpu_ms` records the GPU execution alone (see Methodology).
```

In the `metal-naive` row, replace:

```
Timed like `mps`, with a `metal-naive-e2e` record.
```

with:

```
Timed like `mps`.
```

In the `metal-tiled` row, replace:

```
Same precisions, accumulation and timing as `metal-naive`, with a `metal-tiled-e2e` record.
```

with:

```
Same precisions, accumulation and timing as `metal-naive`.
```

- [ ] **Step 2: Methodology**

Step 1, replace:

```
isolating thread pool initialization, cold caches, and dynamic loader overhead from the recorded metrics.
```

with:

```
isolating cold caches, first thread wake-ups, and dynamic loader overhead from the timed repetitions. Building the kernel before it (a thread pool, a BNNS graph, a compiled Metal shader) is timed once, as `setup_ms`.
```

Step 2, replace:

```
Metal kernels produce two records per configuration from the same repetitions: the plain label times GPU execution only (`commit` → `waitUntilCompleted`), and `<label>-e2e` also includes copying the inputs into the shared buffers, encoding the command buffer, and copying the result back. Both carry the same accuracy.
```

with:

```
Every configuration writes one record, timed as a caller sees it: one `compute` call on the CPU and AMX, and on Metal the whole round trip of copying the inputs into the shared buffers, encoding the command buffer, GPU execution, and copying the result back. Metal records also carry `gpu_ms`, the median GPU execution alone (`commit` → `waitUntilCompleted`) over the same repetitions.
```

Step 5, replace the `Columns:` bullet:

```
   - Columns: `kernel, backend, device, precision, n, threads, gops, mean_rel_error_f64, median_ms, min_ms, stddev_ms, block_size, repetitions, host, commit, timestamp`. `block_size` is empty for kernels that don't tile.
```

with:

```
   - Columns: `kernel, backend, device, precision, n, threads, gops, mean_rel_error_f64, median_ms, min_ms, stddev_ms, gpu_ms, setup_ms, block_size, repetitions, host, commit, timestamp`. `block_size` is empty for kernels that don't tile, and `gpu_ms` for kernels that don't run on Metal.
   - `setup_ms` is the one-time cost of building the kernel for that configuration, before the warmup run: spawning a thread pool, compiling a BNNS graph, or creating a Metal device, compiling the shader and allocating the buffers (≈ 0 for kernels with nothing to build). It is a single sample and depends on order (the first Metal device in a process pays driver initialization, and Metal caches compiled shaders), so read it as an order of magnitude.
```

In the `mean_rel_error_f64` bullet, delete this sentence (and the space before it):

```
Runs recorded before 2026-09-24 wrote a `0.0` placeholder, which `just data` publishes as `NULL`.
```

- [ ] **Step 3: Dashboard paragraph**

Replace:

```
GPU kernels are charted with their end-to-end (`-e2e`) timings, the same host-to-host scope as the CPU kernels; the GPU tab plots the GPU-only share as copy overhead.
```

with:

```
GPU kernels are charted with their end-to-end timings, the same host-to-host scope as the CPU kernels; the GPU tab plots the time outside `gpu_ms` as copy overhead.
```

- [ ] **Step 4: Agent column list**

In `.claude/agents/dashboard-designer.md`, in the **Data source** bullet, replace `median_ms, min_ms, stddev_ms, block_size` with `median_ms, min_ms, stddev_ms, gpu_ms, setup_ms, block_size`.

- [ ] **Step 5: Check and commit**

Run: `git grep -n -- "-e2e\|withEndToEnd" -- README.md CLAUDE.md .claude web/src benchmark/src`
Expected: no output.

```bash
git add README.md .claude/agents/dashboard-designer.md
git commit -m "Document gpu_ms and setup_ms, and drop notes on legacy run files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Regenerate the data and verify end to end

**Files:**
- Delete: `data/runs/Pauls-MacBook-Pro/*.csv` (13 files)
- Create: `data/runs/Pauls-MacBook-Pro/<timestamp>.csv` (written by the run)

This task's run takes hours and needs a quiet machine, so **the user runs Step 1**; an agent executing this plan stops here and hands over, then resumes at Step 2.

- [ ] **Step 1: Run the sweep (user, overnight)**

Close other apps, keep the machine on power, then:

```bash
caffeinate -i just bench --block-size 16,32,64,128,256,512,1024,2048
```

Every other dimension sweeps (all kernels and precisions, sizes 64–4096, threads 1, 2, 4, 8, 10), so this one run replaces both the old full sweep and `extended-block-size.csv`. Background load swings 8+ thread medians by about ±15% in the daytime and 2–5% at night. The run prints the file it wrote.

- [ ] **Step 2: Replace the old files**

```bash
git rm -q data/runs/Pauls-MacBook-Pro/{accelerate-blas,accelerate-bnns,extended-block-size,ikj,metal-naive,metal-tiled,mps,naive-ijk,rayon-ikj,rayon-tiled,static-ikj,static-tiled,tiled}.csv
just data
```

Expected: `just data` succeeds.

- [ ] **Step 3: Spot-check the merged data**

```bash
duckdb -c "SELECT backend, count(*) AS rows, count(gpu_ms) AS with_gpu_ms, count(*) FILTER (kernel LIKE '%-e2e') AS e2e_rows, round(median(setup_ms), 3) AS median_setup_ms, round(max(setup_ms), 1) AS max_setup_ms FROM read_json('web/public/results.json') GROUP BY backend ORDER BY backend"
```

Expected: `with_gpu_ms` equals `rows` for `metal` and is 0 for `amx` and `cpu`; `e2e_rows` is 0 everywhere; Metal's `max_setup_ms` is in the milliseconds (shader compiles), the CPU median is small.

- [ ] **Step 4: Check the dashboard**

Start the dev server (`just dev`, or the preview tool). On the GPU tab, the copy-overhead panel draws a line per GPU kernel, falling as N grows. Open "Data view" on any tab: it lists `gpu_ms` and `setup_ms` columns. The browser console shows no errors.

- [ ] **Step 5: Full checks and commit**

Run: `just check && just test`
Expected: all pass.

```bash
git add data/runs
git commit -m "Regenerate the run data with gpu_ms and setup_ms

One sweep over every kernel, precision, size and thread count, at block
sizes 16 to 2048, replacing the per-kernel files and the extended
block-size run.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
