# Sweep CLI, Block-Size Vector, and Config Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every sweep dimension (including block size) a vector where an omitted value means "all values", stop a bare `gemm-bench` from starting an hours-long run, and add TOML presets (`--config`) for repeatable mini-sweeps.

**Architecture:** `Cli::into_plan` resolves each dimension as *CLI flag → config key → full vector*. `BenchmarkPlan::cells(kernel, precision, n)` becomes the single source of which (threads, block size) cells run, shared by the sweep loop and the configuration count; unsupported cells are skipped with a stderr notice instead of rejecting the plan. `main` prints the help when nothing is pinned. Presets are plain TOML files in `configs/` whose keys are the flag names.

**Tech Stack:** Rust nightly (`clap` 4 derive, `serde`, new `toml = "1"`), Svelte/TypeScript dashboard tested with `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-16-accuracy-column-and-block-size-sweep-design.md`, **Part B only** (Part A is out of scope). Deviation: Part B's `--block-size` default is `[64]`; here an omitted `--block-size` means the full list below. Everything else comes from the decisions in Global Constraints.

## Global Constraints

- Rust is nightly, pinned by `rust-toolchain.toml`; the crate uses `#![feature(f16)]`. `cargo clippy --all-targets -- -D warnings` must pass.
- `mps` exists only on macOS: gate anything that names `KernelChoice::Mps` with `#[cfg(target_os = "macos")]`. CI is Linux.
- `serial::IkjGemm` is the correctness reference: do not touch it.
- Never hand-edit `data/runs/`. Throwaway runs pass `--output /tmp/<name>.csv`.
- Lefthook runs fmt/clippy/test/Biome/typecheck on commit: never pass `--no-verify`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Full vectors (used when a dimension is omitted):** sizes `64,128,256,512,1024,2048,4096`; threads powers of two up to `available_parallelism()` plus that maximum; kernels every `KernelChoice` variant; precisions `f16,f32,f64,i32,i64`; block sizes `16,32,64,128,256`. Repetitions default to `5`.
- **Precedence:** a CLI flag replaces the matching config key, which replaces the full vector. Replacement is per whole dimension, never merged element-wise.
- **Config keys are the flag names:** `sizes`, `threads`, `kernel`, `precision`, `block-size`, `repetitions`. No aliases. Unknown keys are rejected (`deny_unknown_fields`). No `output`/`no-progress` keys.
- **Bare invocation** (no dimension flag, no `--config`, no `--sweep`) prints the help and exits 0 without creating any file. `just bench` does not inject a config.
- **Unsupported combinations** (`mps` outside `f16`/`f32`; static kernels with more threads than rows) are skipped, with one stderr line per skipped group. A kernel named explicitly (flag or config key) that ends up with nothing to run is an error.
- **`block_size` column:** empty in CSV for kernels that don't tile (`naive`, `ikj`, `rayon-ikj`, `static-ikj`, `mps`).
- Dropped from the original proposal: `--example-config` (`configs/default.toml` is the example), config aliases, `just sweep` / `just bench-config` recipes (`just bench --sweep` / `just bench --config FILE` already work).

## File Structure

| File | Responsibility |
| :--- | :--- |
| `benchmark/src/cli.rs` (modify) | Flags, per-dimension resolution, validation, `KernelChoice::{uses_blocks, fits}`, `BenchmarkPlan::cells`, skip notices, CLI tests |
| `benchmark/src/config.rs` (create) | `ConfigFile`: load a TOML preset, parse kernel/precision names through clap's `ValueEnum`; preset-parsing test |
| `benchmark/src/main.rs` (modify) | Help guard, skip notices, `mod config` |
| `benchmark/src/benchmark.rs` (modify) | Sweep loop over `cells`, `Option<usize>` block size in records and `measure` |
| `benchmark/src/report.rs` (modify) | Block size in the progress message and terminal table |
| `benchmark/Cargo.toml` (modify) | `toml = "1"` |
| `configs/{default,quick,precisions,block-sizes}.toml` (create) | Presets |
| `web/src/lib/derive.ts`, `web/src/lib/charts/index.ts`, `web/src/lib/charts/blocksize.ts` (modify) | Treat a null `block_size` as "not applicable" |
| `README.md`, `CLAUDE.md` (modify) | Docs, folded into the task that changes the behavior |

---

### Task 1: Block size becomes a sweep dimension

**Files:**
- Modify: `benchmark/src/cli.rs` (Cli `block_size` field ~L37-39, `BenchmarkPlan` ~L53-84, `KernelChoice` ~L226-243, `validate_cli` ~L267-281, `into_plan` ~L151-163, test `empty_sweeps_expand_to_defaults` ~L433-461)
- Modify: `benchmark/src/benchmark.rs` (`BenchmarkRecord` L35, loop L77-129, `measure` L151-226)
- Modify: `benchmark/src/report.rs` (`set_target` L39-42, table L98-123, tests L125-198)
- Modify: `README.md` (CLI options row for `--block-size`, schema line ~L164)

**Interfaces:**
- Produces: `KernelChoice::uses_blocks(self) -> bool`; `BenchmarkPlan.block_sizes: Vec<usize>` (replaces `block_size`); `BenchmarkPlan::cells(&self, kernel: KernelChoice) -> Vec<(usize, Option<usize>)>` (threads, block size), extended in Task 3; `BenchmarkRecord.block_size: Option<usize>`; `BenchmarkProgress::set_target(&self, kernel: &str, n: usize, precision: &str, threads: usize, block_size: Option<usize>)`.

- [ ] **Step 1: Write the failing CLI tests** (append inside `mod tests` in `benchmark/src/cli.rs`)

```rust
    #[test]
    fn block_size_flag_accepts_a_comma_delimited_sweep() {
        let output = temp_output("block-sizes");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--block-size"),
            OsStr::new("32,64,128"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("block-size list should parse")
        .into_plan()
        .expect("plan should be valid");

        assert_eq!(plan.block_sizes, [32, 64, 128]);
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn zero_in_the_block_size_list_is_rejected() {
        let output = temp_output("zero-block");
        let error = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--block-size"),
            OsStr::new("32,0"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect_err("a zero block size must be rejected");

        assert!(error.contains("--block-size"), "{error}");
        assert!(
            !output.exists(),
            "a rejected plan must not create the output file"
        );
    }

    #[test]
    fn block_sizes_multiply_only_the_tiled_kernels() {
        let output = temp_output("block-count");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--sizes"),
            OsStr::new("64"),
            OsStr::new("--precision"),
            OsStr::new("f32"),
            OsStr::new("--kernel"),
            OsStr::new("ikj,tiled,rayon-tiled"),
            OsStr::new("--threads"),
            OsStr::new("1,2"),
            OsStr::new("--block-size"),
            OsStr::new("32,64,128"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("plan should be valid");

        // ikj 1 + tiled 3 blocks + rayon-tiled 2 threads x 3 blocks = 10
        assert_eq!(plan.total_configurations(), 10);
        assert_eq!(plan.cells(KernelChoice::Ikj), [(1, None)]);
        assert_eq!(
            plan.cells(KernelChoice::Tiled),
            [(1, Some(32)), (1, Some(64)), (1, Some(128))]
        );
        let _ = fs::remove_file(&output);
    }
```

- [ ] **Step 2: Update the report tests** (`benchmark/src/report.rs`, `mod tests`)

In `record()`, change `block_size: 64,` to `block_size: None,` (rayon-ikj doesn't tile). In `progress_bar_lifecycle_disabled`, change the call to `progress.set_target("naive", 64, "f32", 1, None);` and add `progress.set_target("tiled", 64, "f32", 1, Some(64));`. In `terminal_table_uses_schema_headers_and_compact_float_precision`, add `assert!(table.contains("block"));`. Replace `write_records_outputs_csv_in_schema_order` with:

```rust
    #[test]
    fn write_records_outputs_csv_in_schema_order() {
        let csv_path =
            std::env::temp_dir().join(format!("gemm-bench-report-test-{}.csv", std::process::id()));
        let csv_file = std::fs::File::create(&csv_path).expect("create csv file");
        let tiled = BenchmarkRecord {
            kernel: "tiled".to_owned(),
            block_size: Some(64),
            ..record()
        };

        super::write_records(csv_file, &[record(), tiled]).expect("write records");

        let csv_content = std::fs::read_to_string(&csv_path).expect("read csv");
        // Kernels that don't tile leave block_size empty; tiled ones record it.
        assert_eq!(
            csv_content,
            "kernel,backend,device,precision,n,threads,gops,mean_rel_error_f64,median_ms,min_ms,stddev_ms,block_size,repetitions,host,commit,timestamp\n\
             rayon-ikj,cpu,Test CPU,f32,256,4,2.5,0.0,12.34567,12.0,0.25,,5,test-host,abc1234,2026-09-17T12:15:00Z\n\
             tiled,cpu,Test CPU,f32,256,4,2.5,0.0,12.34567,12.0,0.25,64,5,test-host,abc1234,2026-09-17T12:15:00Z\n"
        );
        let _ = std::fs::remove_file(csv_path);
    }
```

- [ ] **Step 3: Run the tests and confirm they fail to compile**

Run: `just test-bench`
Expected: compile errors: no field `block_sizes` on `BenchmarkPlan`, no method `cells`, mismatched `block_size` type, wrong argument count for `set_target`.

- [ ] **Step 4: Implement in `benchmark/src/cli.rs`**

Replace the `block_size` flag:

```rust
    /// Tile edge length(s) for the tiled kernels, as a comma-delimited list.
    #[arg(long, value_delimiter = ',', default_values_t = [64])]
    block_size: Vec<usize>,
```

In `BenchmarkPlan`, replace `pub(crate) block_size: usize,` with `pub(crate) block_sizes: Vec<usize>,`. Replace `impl BenchmarkPlan` with:

```rust
impl BenchmarkPlan {
    /// The (threads, block size) cells measured for one kernel. The single
    /// source for the sweep loop and the configuration count.
    pub(crate) fn cells(&self, kernel: KernelChoice) -> Vec<(usize, Option<usize>)> {
        let threads: &[usize] = if kernel.uses_workers() {
            &self.threads
        } else {
            &[1]
        };
        let blocks: Vec<Option<usize>> = if kernel.uses_blocks() {
            self.block_sizes.iter().copied().map(Some).collect()
        } else {
            vec![None]
        };
        threads
            .iter()
            .flat_map(|&t| blocks.iter().map(move |&b| (t, b)))
            .collect()
    }

    /// Returns the exact number of configurations that will be measured.
    pub(crate) fn total_configurations(&self) -> usize {
        let per_matrix: usize = self.kernels.iter().map(|&k| self.cells(k).len()).sum();
        self.precisions.len() * self.sizes.len() * per_matrix
    }
}
```

Add to `impl KernelChoice`, after `uses_workers`:

```rust
    /// Whether the kernel tiles by `--block-size`; the others run once and
    /// record an empty block size.
    pub(crate) fn uses_blocks(self) -> bool {
        matches!(self, Self::Tiled | Self::RayonTiled | Self::StaticTiled)
    }
```

In `validate_cli`, replace the `cli.block_size == 0` check with:

```rust
    if cli.block_size.contains(&0) {
        return Err("all --block-size values must be greater than zero".into());
    }
```

In `into_plan`'s `Ok(BenchmarkPlan { .. })`, replace `block_size: self.block_size,` with `block_sizes: self.block_size,`. In the test `empty_sweeps_expand_to_defaults`, change the literal's `block_size: 64,` to `block_size: vec![64],`.

- [ ] **Step 5: Implement in `benchmark/src/benchmark.rs`**

In `BenchmarkRecord`, replace `pub(crate) block_size: usize,` with:

```rust
    /// Empty in the CSV for kernels that don't tile.
    pub(crate) block_size: Option<usize>,
```

Replace the kernel loop body in `run_precision` (from `for kernel in plan.kernels.iter().copied() {` through its closing brace) with:

```rust
        for kernel in plan.kernels.iter().copied() {
            for (thread_count, block_size) in plan.cells(kernel) {
                progress.set_target(
                    kernel.label(),
                    n,
                    precision.label(),
                    thread_count,
                    block_size,
                );
                let samples = measure(
                    kernel,
                    thread_count,
                    block_size,
                    plan.repetitions,
                    &lhs,
                    &rhs,
                    &mut output,
                )?;
                progress.step();

                // Checked after timing, against the last timed run's output.
                let error = max_relative_error(&output, &reference);
                if error > tolerance {
                    let block =
                        block_size.map_or_else(String::new, |b| format!(", block size {b}"));
                    return Err(format!(
                        "{} produced wrong output at n={n}, precision {}, threads {thread_count}{block}: \
                         max relative error {error:e} exceeds tolerance {tolerance:e}",
                        kernel.label(),
                        precision.label(),
                    )
                    .into());
                }

                let stats = summarize(&samples);
                let gops = 2.0 * (n as f64).powi(3) / (stats.median_ms / 1_000.0) / 1e9;
                records.push(BenchmarkRecord {
                    kernel: kernel.label().to_owned(),
                    backend: kernel.backend(),
                    device: kernel.device(&plan.devices).to_owned(),
                    precision: precision.label(),
                    n,
                    threads: thread_count,
                    gops,
                    // ponytail: placeholder until roadmap item 4 measures error against an f64 reference.
                    mean_rel_error_f64: 0.0,
                    median_ms: stats.median_ms,
                    min_ms: stats.min_ms,
                    stddev_ms: stats.stddev_ms,
                    block_size,
                    repetitions: plan.repetitions,
                    host: plan.context.host.clone(),
                    commit: plan.context.commit.clone(),
                    timestamp: plan.context.timestamp.clone(),
                });
            }
        }
```

In `measure`, change the parameter `block_size: usize,` to `block_size: Option<usize>,`, add as the first line of the body (before `let mut samples`):

```rust
    // `BenchmarkPlan::cells` gives every tiled kernel a block size.
    let block = || block_size.expect("tiled kernels always get a block size");
```

and replace `TiledGemm::new(block_size)`, `RayonTiledGemm::new(block_size)`, `StaticTiledGemm::new(threads, block_size)?` with `TiledGemm::new(block())`, `RayonTiledGemm::new(block())`, `StaticTiledGemm::new(threads, block())?`.

- [ ] **Step 6: Implement in `benchmark/src/report.rs`**

```rust
    pub(crate) fn set_target(
        &self,
        kernel: &str,
        n: usize,
        precision: &str,
        threads: usize,
        block_size: Option<usize>,
    ) {
        let block = block_size.map_or_else(String::new, |b| format!(" b={b}"));
        self.bar.set_message(format!(
            "{kernel:<11} n={n:<4} {precision:<3} t={threads}{block}"
        ));
    }
```

In `TerminalBenchmarkRecord`, add `block: String,` after `threads: usize,`, and in `render_results_table` add after `threads: record.threads,`:

```rust
        block: record
            .block_size
            .map_or_else(|| "-".to_owned(), |b| b.to_string()),
```

- [ ] **Step 7: Run the tests and clippy**

Run: `just lint-bench && just check-bench && just test-bench`
Expected: clippy clean; all tests pass, including the three new CLI tests and the updated CSV test.

- [ ] **Step 8: Real run**

Run: `just bench --sizes 256 --kernel ikj,tiled --precision f32 --block-size 32,64 --output /tmp/gemm-t1.csv --no-progress && cut -d, -f1,12 /tmp/gemm-t1.csv`
Expected: 3 records; `ikj,` (empty block size), `tiled,32`, `tiled,64`. The terminal table shows a `block` column with `-` for ikj.

- [ ] **Step 9: Update `README.md`**

Replace the `--block-size` row of the CLI Options table with:

```markdown
| `--block-size <B,...>` | Tile edge length(s) for the tiled kernels (`tiled`, `rayon-tiled`, `static-tiled`), comma-delimited. Other kernels run once and record an empty `block_size` | `64` |
```

Append to the schema bullet that lists the columns (`- Columns: ...`): `` `block_size` is empty for kernels that don't tile.``

- [ ] **Step 10: Commit**

```bash
git add benchmark/src/cli.rs benchmark/src/benchmark.rs benchmark/src/report.rs README.md
git commit -m "$(cat <<'EOF'
Sweep block size as a list for the tiled kernels

--block-size takes a comma-delimited list; only tiled, rayon-tiled and
static-tiled iterate it, and other kernels record an empty block_size.
BenchmarkPlan::cells is the single source for the loop and the count.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Dashboard treats a missing block size as "not applicable"

After Task 1, rows from non-tiled kernels carry `block_size = null`. `Number(null)` is `0`, so without this task the block-size picker offers a "0" option, and on mixed old/new data a tab pinned to a block size hides the new null rows.

**Files:**
- Modify: `web/src/lib/derive.ts` (`blockSizes` L80-83, `blockSizesFor` L85-98)
- Modify: `web/src/lib/charts/index.ts` (`rowsForTab` L120-144)
- Modify: `web/src/lib/charts/blocksize.ts` (`atSize` filter L19-24)
- Test: `web/src/lib/derive.test.ts`, `web/src/lib/charts/index.test.ts`, `web/src/lib/charts/blocksize.test.ts`

**Interfaces:**
- Consumes: the CSV/Parquet `block_size` column, now nullable (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/derive.test.ts`:

```ts
test("rows without a block size are not a block size", () => {
	const withUntiled: Row[] = [
		...blockRows,
		{
			kernel: "rayon-ikj",
			precision: "f32",
			n: 64,
			threads: 4,
			gops: 40,
			backend: "cpu",
			block_size: null,
		},
	];
	expect(blockSizes(withUntiled)).toEqual([32, 64]);
	expect(blockSizesFor(withUntiled, "f32", 64)).toEqual([32, 64]);
	expect(defaultBlockSize(withUntiled)).toBe(32);
});
```

Append to `web/src/lib/charts/index.test.ts`:

```ts
test("a row without a block size survives any block-size selection", () => {
	// Old runs recorded block_size=64 for every kernel; new ones leave it empty
	// for kernels that don't tile. Mixed, ikj has two distinct values, so only
	// the null check keeps its new row on a tab pinned to block_size=32.
	const mixed: Row[] = [
		{
			kernel: "ikj",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 10,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 64,
		},
		{
			kernel: "ikj",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 11,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: null,
		},
		{
			kernel: "tiled",
			precision: "f32",
			n: 256,
			threads: 1,
			gops: 12,
			backend: "cpu",
			median_ms: 1,
			stddev_ms: 0,
			block_size: 32,
		},
	];
	const overview = TABS.find((t) => t.id === "overview");
	expect(overview).toBeDefined();
	if (!overview) return;
	const scoped = rowsForTab(overview, mixed, "f32", 32, makeCtx(mixed));
	expect(scoped.map((r) => r.gops)).toEqual([11, 12]);
});
```

Append to `web/src/lib/charts/blocksize.test.ts`:

```ts
test("a row without a block size is never plotted", () => {
	// Mixed old/new data: ikj has 32/64 from old runs plus a new row with no
	// block size. Number(null) is 0, which a log-scale x-axis cannot place.
	const withNull: Row[] = [
		...rows,
		{
			kernel: "ikj",
			precision: "f32",
			n: 512,
			threads: 1,
			gops: 25,
			backend: "cpu",
			block_size: null,
		},
	];
	const spec = blockSizeSweep(withNull, f, makeCtx(withNull));
	expect(spec).not.toBeNull();
	if (!spec) return;
	const dot = spec.marks[1] as { data: { block_size: number }[] };
	expect(dot.data.every((d) => d.block_size > 0)).toBe(true);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd web && bun test src/lib/derive.test.ts src/lib/charts/index.test.ts src/lib/charts/blocksize.test.ts`
Expected: 3 failures: `blockSizes` returns `[0, 32, 64]`; `scoped` gops are `[12]`; a dot has `block_size` 0.

- [ ] **Step 3: Implement**

In `web/src/lib/derive.ts`, replace `blockSizes` and the filter in `blockSizesFor`:

```ts
/** Rows from kernels that don't tile carry no block size (null). */
const hasBlockSize = (r: Row) => r.block_size != null;

/** Every distinct block size present, sorted. */
export function blockSizes(rows: Row[]): number[] {
	return [
		...new Set(rows.filter(hasBlockSize).map((r) => Number(r.block_size))),
	].sort(ascending);
}
```

```ts
				.filter(
					(r) =>
						hasBlockSize(r) && r.precision === precision && Number(r.n) === n,
				)
```

In `web/src/lib/charts/index.ts`, change the block-size clause of `rowsForTab` to:

```ts
				(tab.inertBlockSize ||
					r.block_size == null ||
					ctx.singleBlockSize.has(String(r.kernel)) ||
					Number(r.block_size) === blockSize),
```

and add to its doc comment, after the sentence about `mps`: `A row with no block size (a kernel that doesn't tile) is never filtered by a block-size selection either.`

In `web/src/lib/charts/blocksize.ts`, add `r.block_size != null &&` as the first condition of the `atSize` filter.

- [ ] **Step 4: Run the tests, typecheck, and lint**

Run: `cd web && bun test && bun run typecheck && bun run lint:fix`
Expected: all tests pass; no type or Biome errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/derive.ts web/src/lib/charts/index.ts web/src/lib/charts/blocksize.ts web/src/lib/derive.test.ts web/src/lib/charts/index.test.ts web/src/lib/charts/blocksize.test.ts
git commit -m "$(cat <<'EOF'
Treat a null block_size as not applicable in the dashboard

Kernels that don't tile now record an empty block_size. Keep null out of
the block-size picker and the block-size chart, and never filter a null
row by the block-size selection.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Skip unsupported combinations instead of rejecting the sweep

**Files:**
- Modify: `benchmark/src/cli.rs` (`BenchmarkPlan`, `impl BenchmarkPlan`, `into_plan`, `KernelChoice::supports` doc, delete `validate_static_threads` and `validate_precisions`, tests)
- Modify: `benchmark/src/benchmark.rs` (loop header)
- Modify: `benchmark/src/main.rs` (print notices)
- Modify: `README.md` (`--kernel` row)

**Interfaces:**
- Consumes: `BenchmarkPlan::cells` (Task 1).
- Produces: `KernelChoice::fits(self, threads: usize, n: usize) -> bool`; **changes** `BenchmarkPlan::cells` to `cells(&self, kernel: KernelChoice, precision: Precision, n: usize) -> Vec<(usize, Option<usize>)>` (empty when the kernel can't run there); `BenchmarkPlan.skipped: Vec<String>`.

- [ ] **Step 1: Write the failing tests** (`benchmark/src/cli.rs`, `mod tests`)

Replace `static_threads_above_the_matrix_dimension_are_rejected_before_running` with these two tests:

```rust
    #[test]
    fn static_thread_counts_above_a_size_are_skipped_for_that_size() {
        let output = temp_output("static-skip");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--sizes"),
            OsStr::new("8,64"),
            OsStr::new("--threads"),
            OsStr::new("4,16"),
            OsStr::new("--kernel"),
            OsStr::new("static-ikj"),
            OsStr::new("--precision"),
            OsStr::new("f32"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("a partly runnable static sweep should be valid");

        assert_eq!(
            plan.cells(KernelChoice::StaticIkj, Precision::F32, 8),
            [(4, None)]
        );
        assert_eq!(
            plan.cells(KernelChoice::StaticIkj, Precision::F32, 64),
            [(4, None), (16, None)]
        );
        assert_eq!(plan.total_configurations(), 3);
        assert_eq!(
            plan.skipped,
            ["skipping static-ikj with 16 threads at n=8 (needs a row per thread)"]
        );
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn a_static_kernel_with_no_runnable_thread_count_is_rejected_before_running() {
        let output = temp_output("static-idle");
        let error = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--sizes"),
            OsStr::new("8"),
            OsStr::new("--threads"),
            OsStr::new("16"),
            OsStr::new("--kernel"),
            OsStr::new("static-ikj"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect_err("a named kernel with nothing to run must be rejected");

        assert!(
            error.contains("static-ikj needs at least one row per thread"),
            "{error}"
        );
        assert!(
            !output.exists(),
            "a rejected plan must not create the output file"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn default_kernels_skip_mps_at_precisions_it_lacks() {
        let output = temp_output("mps-skip");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--sizes"),
            OsStr::new("64"),
            OsStr::new("--precision"),
            OsStr::new("f32,f64"),
            OsStr::new("--threads"),
            OsStr::new("1"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("unsupported cells of a default kernel are skipped, not rejected");

        assert!(plan.kernels.contains(&KernelChoice::Mps));
        assert_eq!(plan.cells(KernelChoice::Mps, Precision::F32, 64), [(1, None)]);
        assert!(plan.cells(KernelChoice::Mps, Precision::F64, 64).is_empty());
        assert_eq!(plan.skipped, ["skipping mps at f64 (unsupported precision)"]);
        let _ = fs::remove_file(&output);
    }
```

In `precision_flag_accepts_integer_precisions`, replace the last assertion and its comment with:

```rust
        // Defaults keep every kernel; mps (no integer support) just has no cells.
        assert_eq!(plan.kernels, KernelChoice::value_variants());
        #[cfg(target_os = "macos")]
        assert!(plan.cells(KernelChoice::Mps, Precision::I32, 64).is_empty());
```

In `block_sizes_multiply_only_the_tiled_kernels` (Task 1), change the two `cells` calls to `plan.cells(KernelChoice::Ikj, Precision::F32, 64)` and `plan.cells(KernelChoice::Tiled, Precision::F32, 64)`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `just test-bench`
Expected: compile errors (`cells` takes 1 argument; no field `skipped`).

- [ ] **Step 3: Implement in `benchmark/src/cli.rs`**

Add to `BenchmarkPlan` (after `no_progress`):

```rust
    /// One line per group of skipped cells, printed before the run.
    pub(crate) skipped: Vec<String>,
```

Replace `cells` and `total_configurations` with:

```rust
    /// The (threads, block size) cells measured for one kernel at one
    /// precision and size; empty when the kernel can't run there. The single
    /// source for the sweep loop and the configuration count.
    pub(crate) fn cells(
        &self,
        kernel: KernelChoice,
        precision: Precision,
        n: usize,
    ) -> Vec<(usize, Option<usize>)> {
        if !kernel.supports(precision) {
            return Vec::new();
        }
        let threads: Vec<usize> = if kernel.uses_workers() {
            self.threads
                .iter()
                .copied()
                .filter(|&t| kernel.fits(t, n))
                .collect()
        } else {
            vec![1]
        };
        let blocks: Vec<Option<usize>> = if kernel.uses_blocks() {
            self.block_sizes.iter().copied().map(Some).collect()
        } else {
            vec![None]
        };
        threads
            .iter()
            .flat_map(|&t| blocks.iter().map(move |&b| (t, b)))
            .collect()
    }

    /// Returns the exact number of configurations that will be measured.
    pub(crate) fn total_configurations(&self) -> usize {
        let mut total = 0;
        for &precision in &self.precisions {
            for &n in &self.sizes {
                for &kernel in &self.kernels {
                    total += self.cells(kernel, precision, n).len();
                }
            }
        }
        total
    }
```

Add to `impl KernelChoice`, after `uses_blocks`:

```rust
    /// Whether the kernel can run `threads` workers on `n` rows: the static
    /// kernels give every worker at least one row.
    pub(crate) fn fits(self, threads: usize, n: usize) -> bool {
        !matches!(self, Self::StaticIkj | Self::StaticTiled) || threads <= n
    }
```

Change the doc comment of `supports` to: `/// Whether this kernel can run at `precision`. With `fits`, the single source for skipping cells and rejecting a named kernel with nothing to run.`

In `into_plan`, replace the `let kernels = ...;` block and the two `validate_static_threads` / `validate_precisions` calls with:

```rust
        let explicit_kernels = !self.kernel.is_empty();
        let kernels = if self.kernel.is_empty() {
            // Every kernel; `cells` skips the combinations one can't run.
            KernelChoice::value_variants().to_vec()
        } else {
            self.kernel
        };

        // Validate the resolved sweep before touching the filesystem, so a
        // rejected plan never creates directories or an output file.
        if explicit_kernels {
            reject_idle_kernels(&kernels, &precisions, &threads, &sizes)?;
        }
        let skipped = skip_notices(&kernels, &precisions, &threads, &sizes);
```

and add `skipped,` to the `Ok(BenchmarkPlan { .. })` initializer. Delete `validate_static_threads` and `validate_precisions`, and add:

```rust
/// A kernel named on the command line that can't run anywhere in the sweep is
/// a mistake worth stopping for; default kernels are only skipped.
fn reject_idle_kernels(
    kernels: &[KernelChoice],
    precisions: &[Precision],
    threads: &[usize],
    sizes: &[usize],
) -> Result<(), String> {
    for &kernel in kernels {
        if !precisions.iter().any(|&p| kernel.supports(p)) {
            let requested: Vec<&str> = precisions.iter().map(|p| p.label()).collect();
            return Err(format!(
                "{} does not support {} precision",
                kernel.label(),
                requested.join(", ")
            ));
        }
        let runnable = sizes
            .iter()
            .any(|&n| threads.iter().any(|&t| kernel.fits(t, n)));
        if kernel.uses_workers() && !runnable {
            return Err(format!(
                "{} needs at least one row per thread; every --threads value exceeds every --sizes value",
                kernel.label()
            ));
        }
    }
    Ok(())
}

/// One stderr line per group of cells `BenchmarkPlan::cells` leaves out.
fn skip_notices(
    kernels: &[KernelChoice],
    precisions: &[Precision],
    threads: &[usize],
    sizes: &[usize],
) -> Vec<String> {
    let mut notices = Vec::new();
    for &kernel in kernels {
        let unsupported: Vec<&str> = precisions
            .iter()
            .filter(|&&p| !kernel.supports(p))
            .map(|p| p.label())
            .collect();
        if !unsupported.is_empty() {
            notices.push(format!(
                "skipping {} at {} (unsupported precision)",
                kernel.label(),
                unsupported.join(", ")
            ));
        }
        if !kernel.uses_workers() {
            continue;
        }
        for &n in sizes {
            let too_many: Vec<String> = threads
                .iter()
                .filter(|&&t| !kernel.fits(t, n))
                .map(ToString::to_string)
                .collect();
            if !too_many.is_empty() {
                notices.push(format!(
                    "skipping {} with {} threads at n={n} (needs a row per thread)",
                    kernel.label(),
                    too_many.join(",")
                ));
            }
        }
    }
    notices
}
```

- [ ] **Step 4: Update the loop and `main`**

In `benchmark/src/benchmark.rs`, change `for (thread_count, block_size) in plan.cells(kernel) {` to `for (thread_count, block_size) in plan.cells(kernel, precision, n) {`.

In `benchmark/src/main.rs`, after `let plan = ...;` add:

```rust
    for notice in &plan.skipped {
        eprintln!("{notice}");
    }
```

- [ ] **Step 5: Run the tests and clippy**

Run: `just lint-bench && just check-bench && just test-bench`
Expected: all pass. The existing `mps_with_f64_precision_is_rejected_before_running` and `mps_with_integer_precision_is_rejected_before_running` still pass unchanged ("mps does not support f64 precision" / "i32").

- [ ] **Step 6: Real run**

Run: `just bench --sizes 8,64 --threads 4,16 --kernel static-ikj --precision f32 --output /tmp/gemm-t3.csv --no-progress`
Expected: stderr prints `skipping static-ikj with 16 threads at n=8 (needs a row per thread)`; 3 records are written.

- [ ] **Step 7: Update `README.md`**

Replace the Default column of the `--kernel` row with: `All kernels; combinations a kernel can't run are skipped with a notice (\`mps\` outside \`f16\`/\`f32\`, static kernels with more threads than rows)`.

- [ ] **Step 8: Commit**

```bash
git add benchmark/src/cli.rs benchmark/src/benchmark.rs benchmark/src/main.rs README.md
git commit -m "$(cat <<'EOF'
Skip unsupported sweep cells instead of rejecting the plan

mps outside f16/f32 and static kernels with more threads than rows are
skipped with a stderr notice, so a cross-product sweep can include every
kernel. A kernel named explicitly with nothing to run is still an error.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Omitted dimensions sweep every value; `--sweep` guards the full run

**Files:**
- Modify: `benchmark/src/cli.rs` (constants, `#[command]`, flag docs, `repetitions`, new `sweep` flag, `is_unpinned`, `into_plan` defaults, `validate_cli`, tests)
- Modify: `benchmark/src/main.rs`
- Modify: `README.md` (Default Sweep section, recipes, CLI Options table), `CLAUDE.md` (Commands)

**Interfaces:**
- Produces: `Cli::is_unpinned(&self) -> bool`; constants `DEFAULT_BLOCK_SIZES: [usize; 5]`, `DEFAULT_REPETITIONS: usize`, `AFTER_HELP: &str`.

- [ ] **Step 1: Write the failing tests** (`benchmark/src/cli.rs`, `mod tests`)

Replace `empty_sweeps_expand_to_defaults` with:

```rust
    #[test]
    fn omitted_dimensions_sweep_every_value() {
        let output = temp_output("defaults");
        let plan = Cli::try_parse_from([
            OsStr::new("gemm-bench"),
            OsStr::new("--sweep"),
            OsStr::new("--output"),
            output.as_os_str(),
        ])
        .expect("arguments should parse")
        .into_plan()
        .expect("the full sweep should be valid");

        assert_eq!(plan.sizes, [64, 128, 256, 512, 1024, 2048, 4096]);
        assert!(plan.threads.contains(&1));
        assert_eq!(plan.kernels, KernelChoice::value_variants());
        assert_eq!(plan.precisions, Precision::value_variants());
        assert_eq!(plan.block_sizes, [16, 32, 64, 128, 256]);
        assert_eq!(plan.repetitions, 5);
        assert!(!plan.no_progress);
        assert!(!plan.context.host.is_empty());
        let _ = fs::remove_file(&output);
    }

    #[test]
    fn only_a_pinned_dimension_or_sweep_skips_the_help() {
        let unpinned = |args: &[&str]| {
            Cli::try_parse_from(std::iter::once("gemm-bench").chain(args.iter().copied()))
                .expect("arguments should parse")
                .is_unpinned()
        };
        assert!(unpinned(&[]));
        assert!(unpinned(&["--no-progress", "--repetitions", "3"]));
        assert!(!unpinned(&["--sweep"]));
        assert!(!unpinned(&["--sizes", "64"]));
        assert!(!unpinned(&["--block-size", "32"]));
    }
```

In `mps_parses_as_a_kernel_choice`, change the last assertion to:

```rust
        assert_eq!(plan.total_configurations(), 14); // 7 default sizes * mps's 2 precisions (f16, f32)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `just test-bench`
Expected: compile error, no method `is_unpinned` (and `--sweep` is an unknown argument).

- [ ] **Step 3: Implement in `benchmark/src/cli.rs`**

Next to `DEFAULT_SIZES`, add:

```rust
const DEFAULT_BLOCK_SIZES: [usize; 5] = [16, 32, 64, 128, 256];
const DEFAULT_REPETITIONS: usize = 5;

const AFTER_HELP: &str = "\
Every omitted dimension (--sizes, --threads, --kernel, --precision,
--block-size) sweeps all of its values. With none given, pass --sweep to run
the full sweep (hours); otherwise this help is shown.

Examples:
  gemm-bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32
  gemm-bench --sizes 1024 --kernel tiled --precision f32 --block-size 32,64,128
  gemm-bench --sweep";
```

Change the struct attribute to `#[command(about = "Benchmark safe, row-major GEMM kernels", after_help = AFTER_HELP)]` and replace the flag fields `sizes` through `block_size` with:

```rust
    /// Matrix dimensions, as a comma-delimited list. Omit to sweep 64 through 4096.
    #[arg(long, value_delimiter = ',')]
    sizes: Vec<usize>,

    /// Worker counts, as a comma-delimited list. Omit to sweep powers of two up to available CPUs.
    #[arg(long, value_delimiter = ',')]
    threads: Vec<usize>,

    /// Kernel(s) to run. Omit to run every kernel.
    #[arg(long, value_delimiter = ',', value_enum)]
    kernel: Vec<KernelChoice>,

    /// Element precision(s), as a comma-delimited list. Omit to sweep all of them.
    #[arg(long, value_delimiter = ',', value_enum)]
    precision: Vec<Precision>,

    /// Number of measured runs per configuration (default 5), after one untimed
    /// warm-up run; records contain their median, minimum, and standard deviation.
    #[arg(long)]
    repetitions: Option<usize>,

    /// Tile edge length(s) for the tiled kernels, as a comma-delimited list.
    /// Omit to sweep 16 through 256.
    #[arg(long, value_delimiter = ',')]
    block_size: Vec<usize>,
```

After `no_progress`, add:

```rust
    /// Run even though no dimension is pinned: the full sweep, which takes hours.
    #[arg(long)]
    sweep: bool,
```

At the top of `impl Cli`, add:

```rust
    /// True when nothing narrows the sweep and `--sweep` wasn't given; `main`
    /// shows the help instead of starting an hours-long run.
    pub(crate) fn is_unpinned(&self) -> bool {
        !self.sweep
            && self.sizes.is_empty()
            && self.threads.is_empty()
            && self.kernel.is_empty()
            && self.precision.is_empty()
            && self.block_size.is_empty()
    }
```

In `into_plan`, change the `precisions` default to `Precision::value_variants().to_vec()`, add after it:

```rust
        let block_sizes = if self.block_size.is_empty() {
            DEFAULT_BLOCK_SIZES.to_vec()
        } else {
            self.block_size
        };
```

and in the `Ok(BenchmarkPlan { .. })` initializer use `repetitions: self.repetitions.unwrap_or(DEFAULT_REPETITIONS),` and `block_sizes,`. In `validate_cli`, change `if cli.repetitions == 0 {` to `if cli.repetitions == Some(0) {`.

- [ ] **Step 4: Implement in `benchmark/src/main.rs`**

```rust
use clap::{CommandFactory, Parser};

use crate::cli::Cli;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    if cli.is_unpinned() {
        Cli::command().print_help()?;
        return Ok(());
    }
    let plan = cli.into_plan()?;
    for notice in &plan.skipped {
        eprintln!("{notice}");
    }
    let records = benchmark::run(&plan)?;

    report::print_results_table(&records);
    report::write_records(plan.output, &records)?;
    eprintln!(
        "Wrote {} records to {}",
        records.len(),
        plan.output_path.display()
    );
    Ok(())
}
```

- [ ] **Step 5: Run the tests and clippy**

Run: `just lint-bench && just check-bench && just test-bench`
Expected: all pass.

- [ ] **Step 6: Verify the bare invocation creates nothing**

Run: `just bench; echo "exit=$?"; just bench --no-progress | head -3; git status --short data/runs`
Expected: the help (usage, options, the AFTER_HELP text) is printed twice, `exit=0`, and `git status` shows no new run file.

- [ ] **Step 7: Update `README.md` and `CLAUDE.md`**

Replace the `### Default Sweep` section (heading through "Narrow `--sizes` or `--kernel` for quick runs.") with:

````markdown
### The Full Sweep

Every omitted dimension (`--sizes`, `--threads`, `--kernel`, `--precision`, `--block-size`) sweeps all of its values: sizes `64`–`4096`, powers-of-two thread counts up to `available_parallelism()`, every kernel, all five precisions, and block sizes `16`–`256`. With none of them given, `just bench` prints the help instead of starting a run. Opt in to the full sweep, which takes hours, with `--sweep`:

```sh
just bench --sweep
```
````

In the Targeted Sweeps recipes, add `--precision f32` to "Compare Cache Locality", "Parallel Scaling", and "Headless / CI", and add `--block-size 64` to "Compare Cache Locality" (it runs `tiled`). In the CLI Options table, set the Default column of `--sizes` to `All: \`64,128,256,512,1024,2048,4096\``, of `--precision` to `All: \`f16,f32,f64,i32,i64\``, and of `--block-size` to `All: \`16,32,64,128,256\``, and add the row:

```markdown
| `--sweep` | Run with no dimension pinned: every value of every dimension (hours). Without it and with nothing pinned, the help is shown | `false` |
```

In `CLAUDE.md`, replace the `just bench` bullet under Commands with:

```markdown
- `just bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32`: forwards args to the CLI. Every omitted dimension sweeps all of its values, so pin `--precision` (and `--block-size` for tiled kernels) too. With nothing pinned it prints the help; `--sweep` runs everything (hours).
```

- [ ] **Step 8: Commit**

```bash
git add benchmark/src/cli.rs benchmark/src/main.rs README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
Sweep every value of an omitted dimension, behind a --sweep guard

An omitted --sizes/--threads/--kernel/--precision/--block-size now means
all of its values. With nothing pinned, gemm-bench prints its help and
exits instead of starting an hours-long run; --sweep opts in.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `--config` loads a TOML preset

**Files:**
- Modify: `benchmark/Cargo.toml` (and the lock file `cargo` updates)
- Create: `benchmark/src/config.rs`
- Modify: `benchmark/src/cli.rs` (`config` flag, `is_unpinned`, `AFTER_HELP` prose, `into_plan` resolution, replace `validate_cli` with `validate_values`, tests)
- Modify: `benchmark/src/main.rs` (`mod config;`)
- Modify: `README.md` (CLI Options row)

**Interfaces:**
- Consumes: `KernelChoice`, `Precision` (`clap::ValueEnum`), `DEFAULT_*` constants (Task 4), `reject_idle_kernels`, `skip_notices` (Task 3).
- Produces: `config::ConfigFile { sizes: Option<Vec<usize>>, threads: Option<Vec<usize>>, block_size: Option<Vec<usize>>, repetitions: Option<usize> }` (pub(crate) fields) with `ConfigFile::load(&Path) -> Result<ConfigFile, String>`, `kernels(&self) -> Result<Option<Vec<KernelChoice>>, String>`, `precisions(&self) -> Result<Option<Vec<Precision>>, String>`, `Default`.

- [ ] **Step 1: Write the failing tests** (`benchmark/src/cli.rs`, `mod tests`)

Add `use std::ffi::OsString;` and `BenchmarkPlan` to the test module's imports (`use super::{BenchmarkPlan, Cli, ...};`), then append:

```rust
    fn temp_config(name: &str, body: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "gemm-bench-test-{}-{name}.toml",
            std::process::id()
        ));
        fs::write(&path, body).expect("write test config");
        path
    }

    fn plan_with_config(name: &str, body: &str, flags: &[&str]) -> Result<BenchmarkPlan, String> {
        let config = temp_config(name, body);
        let output = temp_output(name);
        let mut args: Vec<OsString> = vec![
            "gemm-bench".into(),
            "--config".into(),
            config.clone().into(),
            "--output".into(),
            output.clone().into(),
        ];
        args.extend(flags.iter().map(OsString::from));
        let plan = Cli::try_parse_from(args)
            .expect("arguments should parse")
            .into_plan();
        let _ = fs::remove_file(config);
        let _ = fs::remove_file(output);
        plan
    }

    const PRESET: &str = "sizes = [64]\nkernel = [\"ikj\"]\nprecision = [\"f32\"]\nblock-size = [32]\nrepetitions = 2\n";

    #[test]
    fn config_keys_fill_the_dimensions_flags_omit() {
        let plan = plan_with_config("fill", PRESET, &[]).expect("config plan should be valid");
        assert_eq!(plan.sizes, [64]);
        assert_eq!(plan.kernels, [KernelChoice::Ikj]);
        assert_eq!(plan.precisions, [Precision::F32]);
        assert_eq!(plan.block_sizes, [32]);
        assert_eq!(plan.repetitions, 2);
        assert!(plan.threads.contains(&1), "an omitted key still sweeps every value");
    }

    #[test]
    fn a_flag_replaces_its_config_key_and_nothing_else() {
        let plan = plan_with_config("override", PRESET, &["--sizes", "128,256"])
            .expect("config plan should be valid");
        assert_eq!(plan.sizes, [128, 256]);
        assert_eq!(plan.kernels, [KernelChoice::Ikj]);
        assert_eq!(plan.repetitions, 2);
    }

    #[test]
    fn a_misspelled_config_key_is_rejected() {
        let error = plan_with_config("typo", "size = [64]\n", &[])
            .expect_err("unknown keys must be rejected");
        assert!(error.contains("unknown field `size`"), "{error}");
    }

    #[test]
    fn an_unknown_kernel_in_a_config_is_rejected() {
        let error = plan_with_config("bad-kernel", "kernel = [\"ijk\"]\n", &[])
            .expect_err("unknown kernel names must be rejected");
        assert!(error.contains("unknown value 'ijk'"), "{error}");
    }

    #[test]
    fn an_empty_config_list_is_rejected() {
        let error = plan_with_config("empty", "sizes = []\n", &[])
            .expect_err("an empty dimension must be rejected");
        assert!(error.contains("--sizes needs at least one value"), "{error}");
    }

    #[test]
    fn a_kernel_named_in_a_config_counts_as_explicit() {
        let error = plan_with_config(
            "idle",
            "kernel = [\"static-ikj\"]\nsizes = [8]\nthreads = [16]\n",
            &[],
        )
        .expect_err("a named kernel with nothing to run must be rejected");
        assert!(
            error.contains("static-ikj needs at least one row per thread"),
            "{error}"
        );
    }

    #[test]
    fn a_config_counts_as_pinning() {
        let cli = Cli::try_parse_from(["gemm-bench", "--config", "configs/quick.toml"])
            .expect("arguments should parse");
        assert!(!cli.is_unpinned());
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `just test-bench`
Expected: `--config` is an unknown argument / compile errors.

- [ ] **Step 3: Add the dependency**

Run: `cargo add toml@1 --manifest-path benchmark/Cargo.toml`
Expected: `benchmark/Cargo.toml` gains `toml = "1..."` under `[dependencies]`.

- [ ] **Step 4: Create `benchmark/src/config.rs`**

```rust
use std::{fs, path::Path};

use clap::ValueEnum;
use serde::Deserialize;

use crate::cli::{KernelChoice, Precision};

/// A preset: the sweep dimensions under the same names as the CLI flags.
/// Omitted keys sweep every value; flags on the command line override keys.
// ponytail: dimensions and repetitions only; add output/no-progress if a preset needs them.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub(crate) struct ConfigFile {
    pub(crate) sizes: Option<Vec<usize>>,
    pub(crate) threads: Option<Vec<usize>>,
    kernel: Option<Vec<String>>,
    precision: Option<Vec<String>>,
    pub(crate) block_size: Option<Vec<usize>>,
    pub(crate) repetitions: Option<usize>,
}

impl ConfigFile {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        let text = fs::read_to_string(path)
            .map_err(|error| format!("cannot read config '{}': {error}", path.display()))?;
        toml::from_str(&text)
            .map_err(|error| format!("invalid config '{}': {error}", path.display()))
    }

    pub(crate) fn kernels(&self) -> Result<Option<Vec<KernelChoice>>, String> {
        parse_names(self.kernel.as_deref(), "kernel")
    }

    pub(crate) fn precisions(&self) -> Result<Option<Vec<Precision>>, String> {
        parse_names(self.precision.as_deref(), "precision")
    }
}

/// Parses through clap's `ValueEnum`, so a preset accepts exactly the
/// spellings the CLI does.
fn parse_names<T: ValueEnum>(names: Option<&[String]>, key: &str) -> Result<Option<Vec<T>>, String> {
    names
        .map(|names| {
            names
                .iter()
                .map(|name| {
                    T::from_str(name, false)
                        .map_err(|_| format!("config key '{key}': unknown value '{name}'"))
                })
                .collect()
        })
        .transpose()
}
```

- [ ] **Step 5: Wire it into `benchmark/src/cli.rs` and `main.rs`**

In `main.rs`, add `mod config;` next to `mod cli;`. In `cli.rs`, add `use crate::config::ConfigFile;`. After the `sweep` flag, add:

```rust
    /// TOML preset whose keys are these flags' names; flags given here override it.
    #[arg(long)]
    config: Option<PathBuf>,
```

In `is_unpinned`, add `&& self.config.is_none()` after `!self.sweep`. In `AFTER_HELP`, replace the first paragraph (everything before the blank line and `Examples:`) with:

```text
Every omitted dimension (--sizes, --threads, --kernel, --precision,
--block-size) sweeps all of its values. With none given, load a preset with
--config or pass --sweep to run everything (hours); otherwise this help is
shown.
```

Replace `into_plan` from its start down to (and including) the `let skipped = ...;` line with:

```rust
    pub(crate) fn into_plan(self) -> Result<BenchmarkPlan, String> {
        let file = match &self.config {
            Some(path) => ConfigFile::load(path)?,
            None => ConfigFile::default(),
        };
        let file_kernels = file.kernels()?;
        let file_precisions = file.precisions()?;
        let explicit_kernels = !self.kernel.is_empty() || file_kernels.is_some();

        let sizes = pick(self.sizes, file.sizes, || DEFAULT_SIZES.to_vec());
        let threads = pick(self.threads, file.threads, default_thread_counts);
        let precisions = pick(self.precision, file_precisions, || {
            Precision::value_variants().to_vec()
        });
        // Every kernel by default; `cells` skips the combinations one can't run.
        let kernels = pick(self.kernel, file_kernels, || {
            KernelChoice::value_variants().to_vec()
        });
        let block_sizes = pick(self.block_size, file.block_size, || {
            DEFAULT_BLOCK_SIZES.to_vec()
        });
        let repetitions = self
            .repetitions
            .or(file.repetitions)
            .unwrap_or(DEFAULT_REPETITIONS);

        // Validate the resolved sweep before touching the filesystem, so a
        // rejected plan never creates directories or an output file.
        validate_values(&sizes, &threads, &kernels, &precisions, &block_sizes, repetitions)?;
        if explicit_kernels {
            reject_idle_kernels(&kernels, &precisions, &threads, &sizes)?;
        }
        let skipped = skip_notices(&kernels, &precisions, &threads, &sizes);
```

In the `Ok(BenchmarkPlan { .. })` initializer, use `repetitions,`. Replace `validate_cli` entirely with:

```rust
/// A command-line flag wins, then the config key; an omitted dimension sweeps
/// every value.
fn pick<T>(flag: Vec<T>, key: Option<Vec<T>>, all: impl FnOnce() -> Vec<T>) -> Vec<T> {
    if flag.is_empty() {
        key.unwrap_or_else(all)
    } else {
        flag
    }
}

/// Checks the resolved values, so config keys get the same checks as flags.
fn validate_values(
    sizes: &[usize],
    threads: &[usize],
    kernels: &[KernelChoice],
    precisions: &[Precision],
    block_sizes: &[usize],
    repetitions: usize,
) -> Result<(), String> {
    if repetitions == 0 {
        return Err("--repetitions must be greater than zero".into());
    }
    let counts = [
        ("--sizes", sizes.len()),
        ("--threads", threads.len()),
        ("--kernel", kernels.len()),
        ("--precision", precisions.len()),
        ("--block-size", block_sizes.len()),
    ];
    if let Some((flag, _)) = counts.iter().find(|(_, count)| *count == 0) {
        return Err(format!("{flag} needs at least one value"));
    }
    for (flag, values) in [("--sizes", sizes), ("--threads", threads), ("--block-size", block_sizes)] {
        if values.contains(&0) {
            return Err(format!("all {flag} values must be greater than zero"));
        }
    }
    Ok(())
}
```

and delete the old `let sizes = if ...`, `let threads = ...`, `let precisions = ...`, `let block_sizes = ...` blocks and the `validate_cli(&self)?;` call they replace.

- [ ] **Step 6: Run the tests and clippy**

Run: `just lint-bench && just check-bench && just test-bench`
Expected: all pass, including the 7 new config tests.

- [ ] **Step 7: Real run with an ad-hoc preset**

Run: `printf 'sizes = [128]\nkernel = ["ikj", "tiled"]\nprecision = ["f32"]\nblock-size = [32, 64]\n' > /tmp/gemm-t5.toml && just bench --config /tmp/gemm-t5.toml --output /tmp/gemm-t5.csv --no-progress && just bench --config /tmp/gemm-t5.toml --sizes 64 --output /tmp/gemm-t5b.csv --no-progress && cut -d, -f1,5,12 /tmp/gemm-t5.csv /tmp/gemm-t5b.csv`
Expected: 3 records each (ikj, tiled×2); the second file has `n=64`, proving the flag overrode the key.

- [ ] **Step 8: Update `README.md`**

Add to the CLI Options table:

```markdown
| `--config <FILE.toml>` | Preset whose keys are the flag names (`sizes`, `threads`, `kernel`, `precision`, `block-size`, `repetitions`); unknown keys are rejected. A flag on the command line replaces the matching key; omitted keys sweep every value | none |
```

- [ ] **Step 9: Commit**

```bash
git add benchmark/Cargo.toml benchmark/Cargo.lock benchmark/src/config.rs benchmark/src/cli.rs benchmark/src/main.rs README.md
git commit -m "$(cat <<'EOF'
Load sweep presets from TOML with --config

A preset's keys are the flag names; flags on the command line replace the
matching key and omitted keys sweep every value. Kernel and precision
names parse through clap's ValueEnum, and unknown keys are rejected.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Ship the presets

**Files:**
- Create: `configs/default.toml`, `configs/quick.toml`, `configs/precisions.toml`, `configs/block-sizes.toml`
- Modify: `benchmark/src/config.rs` (test), `benchmark/src/cli.rs` (`AFTER_HELP` examples)
- Modify: `README.md` (presets section), `CLAUDE.md` (Commands)

**Interfaces:**
- Consumes: `ConfigFile::load`, `kernels`, `precisions` (Task 5).

- [ ] **Step 1: Write the failing test** (append to `benchmark/src/config.rs`)

```rust
#[cfg(test)]
mod tests {
    use std::{ffi::OsStr, fs, path::Path};

    use super::ConfigFile;

    #[test]
    fn every_preset_parses() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../configs");
        let mut presets = 0;
        for entry in fs::read_dir(&dir).expect("configs/ should exist") {
            let path = entry.expect("readable entry").path();
            if path.extension() != Some(OsStr::new("toml")) {
                continue;
            }
            let preset = ConfigFile::load(&path).unwrap_or_else(|error| panic!("{error}"));
            // precisions.toml names mps, which exists only on macOS.
            #[cfg(target_os = "macos")]
            let _kernels = preset.kernels().unwrap_or_else(|error| panic!("{error}"));
            let _precisions = preset.precisions().unwrap_or_else(|error| panic!("{error}"));
            presets += 1;
        }
        assert!(presets > 0, "no presets found in {}", dir.display());
    }
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cargo test --manifest-path benchmark/Cargo.toml every_preset_parses`
Expected: FAIL, "configs/ should exist".

- [ ] **Step 3: Create the presets**

`configs/default.toml`:

```toml
# The default run before --sweep existed. Every omitted key sweeps all of its
# values (sizes 64-4096, threads 1..all cores, every kernel); flags override keys.
precision = ["f32"]
block-size = [64]
```

`configs/quick.toml`:

```toml
# Seconds-long sanity check across every kernel and thread count.
sizes = [64, 256]
precision = ["f32"]
block-size = [64]
repetitions = 3
```

`configs/precisions.toml`:

```toml
# Every precision at one size. mps runs at f16/f32 and is skipped for the rest.
# mps exists only on macOS; elsewhere override with --kernel ikj,rayon-ikj.
sizes = [1024]
block-size = [64]
kernel = ["ikj", "rayon-ikj", "mps"]
```

`configs/block-sizes.toml`:

```toml
# Block-size sweep for the tiled kernels at every thread count. rayon-tiled
# splits rows into at least 4 tasks per thread, so its curve tracks cache fit.
sizes = [512, 1024, 2048]
precision = ["f32"]
kernel = ["tiled", "rayon-tiled", "static-tiled"]
```

- [ ] **Step 4: Update the help examples** (`benchmark/src/cli.rs`)

Replace the `Examples:` block of `AFTER_HELP` with:

```text
Examples:
  gemm-bench --sizes 256,512 --kernel ikj,rayon-ikj --precision f32
  gemm-bench --config configs/quick.toml
  gemm-bench --config configs/default.toml --sizes 1024
  gemm-bench --sweep

Presets in configs/: default, quick, precisions, block-sizes.
```

- [ ] **Step 5: Run the tests and a real preset**

Run: `just check-bench && just test-bench && time just bench --config configs/quick.toml --output /tmp/gemm-quick.csv --no-progress`
Expected: all pass; the quick preset finishes in seconds; on macOS stderr shows no skip notice (f32 only), and the run writes one record per cell.

- [ ] **Step 6: Update `README.md` and `CLAUDE.md`**

Insert after the `### The Full Sweep` section (Task 4):

````markdown
### Presets

A preset is a TOML file whose keys are the flag names. List only what you pin: an omitted key sweeps every value, and a listed key is a fixed snapshot, so a kernel added later won't join a preset that names its kernels. Flags on the command line replace the matching key.

```sh
just bench --config configs/quick.toml                 # seconds-long sanity check
just bench --config configs/default.toml               # f32, block 64, everything else swept
just bench --config configs/default.toml --sizes 1024  # a flag replaces its key
```

| Preset | Pins | Use |
| :--- | :--- | :--- |
| `default.toml` | precision `f32`, block size `64` | The default run before `--sweep` existed |
| `quick.toml` | sizes `64,256`, `f32`, block `64`, 3 repetitions | Sanity check |
| `precisions.toml` | size `1024`, block `64`, `ikj,rayon-ikj,mps` | Precision comparison (`mps` is macOS-only) |
| `block-sizes.toml` | sizes `512,1024,2048`, `f32`, the tiled kernels | Block-size sweep |
````

In `CLAUDE.md`, append to the `just bench` bullet: ` Presets: \`just bench --config configs/quick.toml\` (see \`configs/\`).`

- [ ] **Step 7: Commit**

```bash
git add configs/ benchmark/src/config.rs benchmark/src/cli.rs README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
Add default, quick, precisions and block-sizes sweep presets

Each preset pins only what it narrows, so omitted dimensions keep
following the kernels and values the code supports. A test loads every
preset so a renamed flag or kernel breaks the build, not a run.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Out of Scope

- Part A of the spec (`max_rel_error_f64` against an f64 reference).
- Regenerating `data/runs/` with the new schema (the user will rerun sweeps; old files stay valid because `build.sql` exempts `block_size`).
- The untracked `data/runs/Pauls-MacBook-Pro/block-size-{16,32}.csv` files, which use an older 7-column schema.
