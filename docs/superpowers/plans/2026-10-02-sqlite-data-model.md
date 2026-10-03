# Per-Host SQLite Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSV + DuckDB + JSON pipeline with one SQLite database per host, written by the Rust tool and read directly in the browser by sql.js, with kernel knobs and machine topology stored as rows.

**Architecture:**
- **Writing.** `gemm-bench` opens `data/db/<github-login>/<machine>.sqlite` before any kernel runs, then writes each run in one transaction. The tables are `runs`, `core_tiers`, `caches`, `measurements` and `params`.
- **Gating.** `gemm-bench validate` gates contributed databases. CI also checks that a PR only touches its author's folder.
- **Reading.** The dashboard fetches the selected host's database, creates `TEMP` views from `web/src/lib/views.sql`, and reads the `latest` view, where the latest run of each cell wins.

**Tech Stack:**
- Rust nightly with `rusqlite` 0.40 (`bundled`, SQLite 3.53.2).
- Svelte 5 + Vite 8 + TypeScript, with `sql.js` 1.14.2 (SQLite 3.49.1). It runs in the browser and, under `bun test`, through the same engine.

**Spec:** [`docs/superpowers/specs/2026-10-02-sqlite-data-model-design.md`](../specs/2026-10-02-sqlite-data-model-design.md). Read it before starting any task: this plan argues from it.

## Global Constraints

These apply to every task:

**Database format**
- **Location:** one host database per machine at `data/db/<github-login>/<machine>.sqlite`. A host id matches `^[a-z0-9][a-z0-9-]{0,38}/[a-z0-9][a-z0-9-]*$`.
- **Header stamps:** every database has `PRAGMA application_id = 0x47454d4d` ('GEMM') and `PRAGMA user_version = 1`. The writer refuses any file that isn't version 0 (new) or a version-1 gemm-bench database. Schema migrations are out of scope.
- **SQLite features:** `data/schema.sql` may only use features that SQLite 3.49.1 (sql.js) supports. The web tests load it through sql.js, so a newer feature fails `bun test`.
- **Param names** (`params.name`):
  - Swept: `tile_size`, `depth_block`.
  - Derived: `depth_block_used`, `register_cols`, `row_strips`, `max_rows_per_thread`, `tasks`, `rows_per_task`, `threadgroup_width`, `threadgroup_height`, `threadgroups`.
  - Fixed: `register_rows`, `register_col_vectors`, `tasks_per_worker`, `depth_step`.
  - Sources are exactly `swept`, `derived` or `fixed`.
- **Backends:** exactly `cpu`, `matrix` (formerly `amx`) and `metal`.

**CLI**
- **Knob flags:** `--tile-size` (visible alias `--tile`) defaults to `16,32,64,128,256`. `--depth-block` (visible alias `--kc`) defaults to `64,128,256,512,1024`. `--block-size` is removed.
- **Writer:** one transaction per run, with `PRAGMA foreign_keys = ON` on every write connection. A failed or aborted run writes nothing.

**`validate`**
- Rejects any database larger than 16 MB (16 × 1024 × 1024 bytes).
- Rejects free-text fields longer than 200 characters or containing a control character.

**Dashboard and data**
- Contributed strings (kernel, device, CPU, GPU, OS names from host databases) never go through `renderMarkdown`. Svelte text interpolation only.
- Never hand-edit a committed host database, and never bypass lefthook.

**Every task**
- `just check && just test` passes at the end of every task.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility | Task |
| :--- | :--- | :--- |
| `benchmark/src/kernels/param.rs` (new) | `Param`, `Source`: a knob value as recorded | 1 |
| `benchmark/src/kernels/mod.rs` | `GemmKernel::params` (default empty) | 1 |
| `benchmark/src/kernels/{serial,rayon,static_threads}/*.rs`, `kernels/packed.rs`, `kernels/metal/shader.rs` | Each kernel reports the params it actually used | 1 |
| `benchmark/src/kernel.rs` | Kernel vocabulary: `matrix` backend (2); `Knob` (3); `KernelChoice::ALL`, declared params, macOS kernels known everywhere (7) | 2, 3, 7 |
| `benchmark/src/benchmark.rs` | `measure` collects params; record carries them; declaration-vs-report test | 2, 3, 6, 7 |
| `benchmark/src/cli.rs`, `config.rs`, `plan.rs`, `report.rs` | `--tile-size` / `--depth-block`, presets, progress line | 3 |
| `configs/*.toml` | Presets use the knob keys | 3 |
| `benchmark/src/machine.rs` (new), `benchmark/build.rs` | Machine capture: OS, arch, target features, rustc, tiers, caches, GPU | 4 |
| `benchmark/src/host.rs` (new), `justfile`, `.gitignore` | Host identity: `.host`, `just init`, DB path; path → host for `validate` | 5, 7 |
| `data/schema.sql` (new), `benchmark/src/db.rs` (new) | Schema v1; open-for-run checks; one-transaction writer | 6 |
| `benchmark/src/validate.rs` (new) | `gemm-bench validate` | 7 |
| `.github/workflows/ci.yml`, `lefthook.yml`, `justfile` | Ownership check, validate in CI and pre-commit | 8 |
| `web/src/lib/views.sql`, `sqlite.ts`, `db.ts`, `testdb.ts`, `peaks.ts`, `hosts.ts`, `hostlist.ts` (new or rewritten) | Read host databases in the browser | 9 |
| `web/src/lib/**`, `web/src/docs/**` | `amx` family → `matrix` | 10 |
| `web/src/lib/derive.ts`, `charts/{index,types,knobs}.ts`, `App.svelte`, `state.svelte.ts`, docs | Knob pills and knob charts replace block size | 11 |
| `web/src/lib/machine.ts`, `MachineTable.svelte`, `App.svelte`, `About.svelte`, `derive.ts`, `charts/types.ts`, `hardware.ts` | Host selector, machine panel, GPU peaks by `gpu_cores` | 12 |
| `README.md`, `CLAUDE.md`, `.claude/agents/*.md`, `.claude/skills/bench-compare/SKILL.md` | Docs for the new pipeline | 13 |
| `data/runs/`, `data/build.sql`, `deploy.yml`, `ci.yml`, `justfile`, `lefthook.yml`, `.claude/hooks/session-start.sh`, `web/.gitignore`, `web/src/lib/peaks.test.ts` | Cutover: first real database, DuckDB removed | 14 |

---

## Phase A: The Rust Tool

### Task 1: Kernels Report the Params They Use

**Files:**
- Create: `benchmark/src/kernels/param.rs`
- Modify: `benchmark/src/kernels/mod.rs`, `benchmark/src/kernels/packed.rs`, `benchmark/src/kernels/serial/tiled.rs`, `benchmark/src/kernels/serial/packed.rs`, `benchmark/src/kernels/rayon/tiled.rs`, `benchmark/src/kernels/rayon/packed.rs`, `benchmark/src/kernels/static_threads/ikj.rs`, `benchmark/src/kernels/static_threads/tiled.rs`, `benchmark/src/kernels/metal/shader.rs`
- Test: the `tests` module in `benchmark/src/kernels/mod.rs`, plus a new `tests` module in `benchmark/src/kernels/rayon/tiled.rs`

**Interfaces:**
- Produces:
  - `gemm_bench::kernels::{Param, Source}`. `Param { name: &'static str, value: usize, source: Source }` is built with `Param::swept/derived/fixed(name, value)`.
  - `Source::label() -> &'static str` returns `"swept" | "derived" | "fixed"`.
  - `GemmKernel<T>::params(&self, n: usize) -> Vec<Param>` defaults to empty.

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/kernels/mod.rs`, inside `mod tests`, add `Param` to the existing `use super::{…}` list, which already names every kernel type used below. Then append:

```rust
    #[test]
    fn kernels_without_knobs_record_no_params() {
        assert!(GemmKernel::<f32>::params(&IkjGemm, 64).is_empty());
        assert!(GemmKernel::<f32>::params(&NaiveGemm, 64).is_empty());
    }

    #[test]
    fn tiled_records_its_tile() {
        assert_eq!(
            GemmKernel::<f32>::params(&TiledGemm::new(32), 64),
            [Param::swept("tile_size", 32)]
        );
    }

    #[test]
    fn packed_records_the_requested_and_the_used_depth_block() {
        assert_eq!(
            GemmKernel::<f32>::params(&PackedGemm::new(1024), 512),
            [
                Param::swept("depth_block", 1024),
                Param::derived("depth_block_used", 512),
                Param::derived("register_cols", 12),
                Param::fixed("register_rows", 8),
                Param::fixed("register_col_vectors", 3),
            ]
        );
        let cols = |params: Vec<Param>| {
            params
                .into_iter()
                .find(|p| p.name == "register_cols")
                .map(|p| p.value)
        };
        assert_eq!(cols(GemmKernel::<f16>::params(&PackedGemm::new(64), 512)), Some(24));
        assert_eq!(cols(GemmKernel::<f64>::params(&PackedGemm::new(64), 512)), Some(6));
    }

    #[test]
    fn rayon_packed_adds_its_row_strips() {
        let params = GemmKernel::<f32>::params(&RayonPackedGemm::new(256), 100);
        assert!(params.contains(&Param::derived("row_strips", 13)));
        assert!(params.contains(&Param::derived("depth_block_used", 100)));
    }

    #[test]
    fn rayon_tiled_records_the_split_of_the_pool_it_runs_in() {
        let pool = ::rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .build()
            .expect("a 4-thread pool");
        let params = pool.install(|| GemmKernel::<f32>::params(&RayonTiledGemm::new(64), 10));
        assert_eq!(
            params,
            [
                Param::swept("tile_size", 64),
                // 16 tasks are planned for 4 workers, but 10 rows make 10 one-row tasks.
                Param::derived("tasks", 10),
                Param::derived("rows_per_task", 1),
                Param::fixed("tasks_per_worker", 4),
            ]
        );
    }

    #[test]
    fn static_kernels_record_their_largest_row_share() {
        let ikj = StaticIkjGemm::new(3).expect("a 3-thread pool");
        assert_eq!(
            GemmKernel::<f32>::params(&ikj, 10),
            [Param::derived("max_rows_per_thread", 4)]
        );
        let tiled = StaticTiledGemm::new(3, 32).expect("a 3-thread pool");
        assert_eq!(
            GemmKernel::<f32>::params(&tiled, 10),
            [
                Param::swept("tile_size", 32),
                Param::derived("max_rows_per_thread", 4),
            ]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn metal_shaders_record_their_threadgroups() {
        use super::{Shader, ShaderGemm};
        let tiled = ShaderGemm::<f32>::new(Shader::Tiled)
            .expect("gemm.metal compiles")
            .expect("a Metal device");
        assert_eq!(
            GemmKernel::<f32>::params(&tiled, 100),
            [
                Param::fixed("threadgroup_width", 16),
                Param::fixed("threadgroup_height", 16),
                Param::fixed("depth_step", 16),
                Param::derived("threadgroups", 49),
            ]
        );
        let naive = ShaderGemm::<f32>::new(Shader::Naive)
            .expect("gemm.metal compiles")
            .expect("a Metal device");
        let params = GemmKernel::<f32>::params(&naive, 100);
        let value = |name: &str| {
            params
                .iter()
                .find(|p| p.name == name)
                .map(|p| p.value)
                .unwrap_or_else(|| panic!("{name} is missing"))
        };
        let (width, height) = (value("threadgroup_width"), value("threadgroup_height"));
        assert!(width * height <= 1024, "{width}x{height}");
        assert_eq!(
            value("threadgroups"),
            100usize.div_ceil(width) * 100usize.div_ceil(height)
        );
    }
```

At the end of `benchmark/src/kernels/rayon/tiled.rs`, add a test module for the split arithmetic:

```rust
#[cfg(test)]
mod tests {
    use super::split;

    #[test]
    fn split_plans_four_tasks_per_worker_and_counts_the_tasks_that_run() {
        // ⌈64/32⌉ = 2 tasks by tile, raised to 4 per worker: 32 tasks of 2 rows.
        assert_eq!(split(64, 32, 8), (32, 2));
        // 12 planned tasks of ⌈100/12⌉ = 9 rows: 12 run.
        assert_eq!(split(100, 64, 3), (12, 9));
        // 16 planned, but 10 rows give only 10 one-row tasks.
        assert_eq!(split(10, 64, 4), (10, 1));
    }
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib params split`
Expected: compile errors. `Param` is not found in `super`, `params` is not a method of `GemmKernel`, and `split` is not found.

- [ ] **Step 3: Add `Param` and `Source`**

Create `benchmark/src/kernels/param.rs`:

```rust
//! A kernel's knobs as the benchmark records them: one row of the `params`
//! table per knob, with where its value came from.

/// Where a param's value comes from: the `params.source` column.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Source {
    /// Requested on the command line: a sweep coordinate.
    Swept,
    /// Worked out at run time from n, threads, precision, the host or the GPU.
    Derived,
    /// A compile-time constant of the kernel.
    Fixed,
}

impl Source {
    /// The value stored in `params.source`.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Swept => "swept",
            Self::Derived => "derived",
            Self::Fixed => "fixed",
        }
    }
}

/// One knob value a kernel actually ran with.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Param {
    pub name: &'static str,
    pub value: usize,
    pub source: Source,
}

impl Param {
    #[must_use]
    pub fn swept(name: &'static str, value: usize) -> Self {
        Self { name, value, source: Source::Swept }
    }

    #[must_use]
    pub fn derived(name: &'static str, value: usize) -> Self {
        Self { name, value, source: Source::Derived }
    }

    #[must_use]
    pub fn fixed(name: &'static str, value: usize) -> Self {
        Self { name, value, source: Source::Fixed }
    }
}
```

In `benchmark/src/kernels/mod.rs`, add `mod param;` after the existing `mod` lines, `pub use param::{Param, Source};` after the existing `pub use` lines, and give the trait its second method:

```rust
pub trait GemmKernel<T: Element>: Send + Sync {
    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>);

    /// The knob values this kernel uses at size `n`, as the `params` table
    /// records them. Empty for kernels with no knobs.
    fn params(&self, _n: usize) -> Vec<Param> {
        Vec::new()
    }
}
```

- [ ] **Step 4: Implement `params` for every kernel with knobs**

`benchmark/src/kernels/packed.rs`: make `NR_VECS` `pub(crate)` (keep its doc comment). Add `use crate::kernels::Param;` to the imports, and add this after `fn nr`:

```rust
/// The knobs both packed kernels record at size `n`: the requested k-block
/// depth, the depth the blocks actually use, and the register block.
pub(crate) fn params<T: Element>(depth_block: usize, n: usize) -> Vec<Param> {
    vec![
        Param::swept("depth_block", depth_block),
        Param::derived("depth_block_used", depth_block.min(n)),
        Param::derived("register_cols", nr::<T>()),
        Param::fixed("register_rows", MR),
        Param::fixed("register_col_vectors", NR_VECS),
    ]
}
```

`benchmark/src/kernels/serial/packed.rs`: change the import to `use crate::kernels::packed::{MR, multiply_strip, pack_a, pack_b, params as packed_params};` and `use crate::kernels::{GemmKernel, Param, assert_gemm_dimensions};`. Then add inside `impl<T: Element> GemmKernel<T> for PackedGemm`:

```rust
    fn params(&self, n: usize) -> Vec<Param> {
        packed_params::<T>(self.block_size, n)
    }
```

`benchmark/src/kernels/rayon/packed.rs`: the same two import changes, then:

```rust
    fn params(&self, n: usize) -> Vec<Param> {
        let mut params = packed_params::<T>(self.block_size, n);
        params.push(Param::derived("row_strips", n.div_ceil(MR)));
        params
    }
```

`benchmark/src/kernels/serial/tiled.rs`: change the import to `use crate::kernels::{GemmKernel, Param, assert_gemm_dimensions};` and add:

```rust
    fn params(&self, _n: usize) -> Vec<Param> {
        vec![Param::swept("tile_size", self.block_size)]
    }
```

`benchmark/src/kernels/rayon/tiled.rs`: change the import to `use crate::kernels::{GemmKernel, Param, assert_gemm_dimensions};`. Add this above `pub struct RayonTiledGemm`:

```rust
/// Tasks per worker `rayon-tiled` aims for: no idle rounds, and spare tasks
/// let stealing route around slow cores.
// ponytail: 4 tuned on M1 Pro 8P+2E.
const TASKS_PER_WORKER: usize = 4;

/// How `rayon-tiled` splits `n` rows on `threads` workers, as (tasks, rows per
/// task). Rounding rows up to a whole task can leave fewer tasks than planned,
/// so the count is of the tasks that actually run.
fn split(n: usize, tile: usize, threads: usize) -> (usize, usize) {
    let planned = n
        .div_ceil(tile)
        .max(TASKS_PER_WORKER * threads)
        .div_ceil(threads)
        * threads;
    let rows_per_task = n.div_ceil(planned);
    (n.div_ceil(rows_per_task), rows_per_task)
}
```

In `compute`, replace the comment block and the three lines from `let threads = rayon::current_num_threads();` through `let chunk_rows = n.div_ceil(tasks);` with:

```rust
        let (_, chunk_rows) = split(n, block_size, rayon::current_num_threads());
```

Then add the method:

```rust
    /// Reads the worker count of the pool it is called in, like `compute`.
    fn params(&self, n: usize) -> Vec<Param> {
        let (tasks, rows_per_task) = split(n, self.block_size, rayon::current_num_threads());
        vec![
            Param::swept("tile_size", self.block_size),
            Param::derived("tasks", tasks),
            Param::derived("rows_per_task", rows_per_task),
            Param::fixed("tasks_per_worker", TASKS_PER_WORKER),
        ]
    }
```

`benchmark/src/kernels/static_threads/ikj.rs`: add `Param` to the `crate::kernels` import, then:

```rust
    fn params(&self, n: usize) -> Vec<Param> {
        let threads = self.pool.current_num_threads();
        vec![Param::derived("max_rows_per_thread", n.div_ceil(threads))]
    }
```

`benchmark/src/kernels/static_threads/tiled.rs`: add `Param` to the `crate::kernels` import, then:

```rust
    fn params(&self, n: usize) -> Vec<Param> {
        let threads = self.pool.current_num_threads();
        vec![
            Param::swept("tile_size", self.block_size),
            Param::derived("max_rows_per_thread", n.div_ceil(threads)),
        ]
    }
```

`benchmark/src/kernels/metal/shader.rs`: change `use crate::kernels::GemmKernel;` to `use crate::kernels::{GemmKernel, Param};`. Add this method to `impl<T: Element> ShaderGemm<T>`:

```rust
    /// `metal-naive`'s threadgroup: one SIMD-group wide, as tall as the
    /// pipeline allows (32×32 on M1 Pro).
    fn naive_threadgroup(&self) -> (usize, usize) {
        let width = self.pipeline.threadExecutionWidth();
        (width, self.pipeline.maxTotalThreadsPerThreadgroup() / width)
    }
```

In the encoding `match self.shader`, replace the `Shader::Naive` arm's first two lines (the comment and `let width …; let height …;`) with `let (width, height) = self.naive_threadgroup();`. Then add to `impl<T: Element> GemmKernel<T> for ShaderGemm<T>`:

```rust
    fn params(&self, n: usize) -> Vec<Param> {
        match self.shader {
            Shader::Naive => {
                let (width, height) = self.naive_threadgroup();
                vec![
                    Param::derived("threadgroup_width", width),
                    Param::derived("threadgroup_height", height),
                    Param::derived("threadgroups", n.div_ceil(width) * n.div_ceil(height)),
                ]
            }
            Shader::Tiled => vec![
                Param::fixed("threadgroup_width", TILE),
                Param::fixed("threadgroup_height", TILE),
                Param::fixed("depth_step", TILE),
                Param::derived("threadgroups", n.div_ceil(TILE).pow(2)),
            ],
        }
    }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml --lib`
Expected: PASS, including the new `params` and `split` tests and the existing correctness tests.

- [ ] **Step 6: Lint and commit**

Run: `just lint && just check-bench`
Expected: no warnings.

```bash
git add benchmark/src/kernels
git commit -m "Have every kernel report the knob values it runs with

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Records Carry Their Params, and `amx` Becomes `matrix`

**Files:**
- Modify: `benchmark/src/benchmark.rs`, `benchmark/src/kernel.rs`, `benchmark/src/report.rs`

**Interfaces:**
- Consumes: from Task 1, `gemm_bench::kernels::{Param, Source}` and `GemmKernel::params`.
- Produces:
  - `Samples.params: Vec<Param>`.
  - `BenchmarkRecord.params: Vec<Param>`, not a CSV column.
  - `on_gpu(built, samples, params)`.
  - Accelerate kernels report backend `"matrix"`.
  - The terminal table's `block` column becomes `knob` and shows the swept param as `name=value`.

Each later task adds only what its own non-test code reads, so every commit passes clippy's `-D warnings`. The kernel *declarations* that `validate` checks against arrive in Task 7, the `--tile-size`/`--depth-block` vocabulary in Task 3.

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/kernel.rs`'s `every_kernel_names_its_backend`, change `assert_eq!(kernel.backend(), "amx");` to `assert_eq!(kernel.backend(), "matrix");`.

In `benchmark/src/benchmark.rs`'s `mod tests`, change the `gemm_bench` imports to `use gemm_bench::{GemmKernel, kernels::{IkjGemm, Param}};` and append:

```rust
    #[test]
    fn a_measurement_carries_the_params_its_kernel_reports() {
        let (lhs, rhs) = benchmark_inputs::<f32>(64);
        let mut output = Matrix::zeros(64, 64);
        let tiled = measure(KernelChoice::Tiled, 1, Some(16), 1, &lhs, &rhs, &mut output)
            .expect("tiled runs");
        assert_eq!(tiled.params, [Param::swept("tile_size", 16)]);
        // Asked inside its own 2-worker pool: 8 tasks of 8 rows. Asked on
        // the global pool it would plan 4 tasks per core of this machine.
        let rayon = measure(KernelChoice::RayonTiled, 2, Some(16), 1, &lhs, &rhs, &mut output)
            .expect("rayon-tiled runs");
        assert!(rayon.params.contains(&Param::derived("tasks", 8)), "{:?}", rayon.params);
        assert!(rayon.params.contains(&Param::derived("rows_per_task", 8)));
        let ikj = measure(KernelChoice::Ikj, 1, None, 1, &lhs, &rhs, &mut output)
            .expect("ikj runs");
        assert!(ikj.params.is_empty());
    }
```

In `benchmark/src/report.rs`'s tests:
- **Fixture:** add `params: Vec::new(),` to `record()`.
- **Table test:** in `terminal_table_uses_schema_headers_and_compact_float_precision`, replace `assert!(table.contains("block"));` with:

```rust
        assert!(table.contains("knob"));
        let tiled = BenchmarkRecord {
            kernel: "tiled".to_owned(),
            params: vec![gemm_bench::kernels::Param::swept("tile_size", 64)],
            ..record()
        };
        assert!(render_results_table(&[tiled]).contains("tile_size=64"));
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --bin gemm-bench`
Expected: compile errors. `Samples` and `BenchmarkRecord` have no `params` field yet. The backend test would then fail on `"amx"`.

- [ ] **Step 3: Rename the backend**

In `benchmark/src/kernel.rs`:
- **Backend values:** change both `backend: "amx",` to `backend: "matrix",`.
- **Comment above `AccelerateBlas`:** change it to `// A matrix unit (Apple's AMX, or Arm SME on M4 and later) reached only through Accelerate, which picks its own threading: one caller thread.`
- **`KernelInfo.backend` doc:** change it to `/// Hardware family: \`cpu\`, \`matrix\` (a matrix unit behind a vendor library) or \`metal\`. Needed next to \`device\` because Apple Silicon reports the same name for its CPU and GPU.`

- [ ] **Step 4: Thread params through `measure` and the record**

In `benchmark/src/benchmark.rs`:

1. Add `Param` to the `gemm_bench::kernels::{…}` import.
2. In `BenchmarkRecord`, add after `block_size`:

```rust
    /// The knob values the kernel ran with; the terminal table shows the
    /// swept one. Not a CSV column: the DB writer (Task 6) stores them.
    #[serde(skip)]
    pub(crate) params: Vec<Param>,
```

3. Give `Samples` a field `params: Vec<Param>`, documented as `/// The knob values the kernel reported for this configuration.`
4. In `sample`, after `let setup = setup_start.elapsed();`, add `let params = kernel.params(lhs.rows());`. Put `params` in the returned `Samples`.
5. Give `on_gpu` a third parameter `params: Vec<Param>`, and put it in the returned `Samples`.
6. In `measure`'s three Metal arms, add `let params = GemmKernel::<T>::params(&kernel, lhs.rows());` after `let built = …;`, and pass `params` as `on_gpu`'s third argument.
7. Give `InPool` a `params` that asks the kernel from inside the pool, so `rayon-tiled` sees the pool's worker count, not the global pool's:

```rust
    fn params(&self, n: usize) -> Vec<Param> {
        self.pool.install(|| self.kernel.params(n))
    }
```

8. In `run_precision`, compute the summaries before building the record, so `samples.params` can move into it:

```rust
                let stats = summarize(&samples.timed);
                let gpu_ms = samples.gpu.as_deref().map(|gpu| summarize(gpu).median_ms);
```

  In the `BenchmarkRecord { … }` literal, set `gpu_ms,` and add `params: samples.params,`.

In `benchmark/src/report.rs`:
- **Import:** add `use gemm_bench::kernels::Source;`.
- **Table field:** in `TerminalBenchmarkRecord`, rename the field `block` to `knob`, and fill it in `render_results_table` with:

```rust
        knob: record
            .params
            .iter()
            .find(|p| p.source == Source::Swept)
            .map_or_else(|| "-".to_owned(), |p| format!("{}={}", p.name, p.value)),
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: PASS. The CSV test still prints `block_size` exactly as before, because `params` is skipped.

- [ ] **Step 6: Lint and commit**

Run: `just lint && just check-bench`

```bash
git add benchmark/src
git commit -m "Record each measurement's params, and rename the amx backend matrix

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `--tile-size` and `--depth-block` Replace `--block-size`

**Files:**
- Modify: `benchmark/src/kernel.rs`, `benchmark/src/cli.rs`, `benchmark/src/config.rs`, `benchmark/src/plan.rs`, `benchmark/src/report.rs`, `benchmark/src/benchmark.rs`
- Modify: `configs/default.toml`, `configs/quick.toml`, `configs/precisions.toml`
- Rename: `configs/block-sizes.toml` → `configs/knobs.toml`

**Interfaces:**
- Consumes: from Task 2, `Samples.params`.
- Produces:
  - `crate::kernel::Knob { TileSize, DepthBlock }`, with `name()`, `flag()`, `short()` and `defaults()`.
  - `KernelChoice::knob(self) -> Option<Knob>`, replacing `uses_blocks`.
  - `BenchmarkPlan.tile_sizes`, `BenchmarkPlan.depth_blocks` and `BenchmarkPlan::knob_values(&self, Knob) -> &[usize]`.
  - `BenchmarkProgress::set_target(&self, kernel, n, precision, threads, knob: Option<(Knob, usize)>)`.
  - `measure`'s third parameter is renamed `knob_value: Option<usize>`.
  - `cells` still returns `Vec<(usize, Option<usize>)>`, where the option is the kernel's knob value.

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/kernel.rs`'s `mod tests`, add:

```rust
    #[test]
    fn tiled_kernels_sweep_the_tile_and_packed_kernels_the_depth_block() {
        use super::Knob;
        for &kernel in KernelChoice::value_variants() {
            let expected = match kernel {
                KernelChoice::Tiled | KernelChoice::RayonTiled | KernelChoice::StaticTiled => {
                    Some(Knob::TileSize)
                }
                KernelChoice::Packed | KernelChoice::RayonPacked => Some(Knob::DepthBlock),
                _ => None,
            };
            assert_eq!(kernel.knob(), expected, "{}", kernel.label());
        }
    }
```

In `benchmark/src/cli.rs`'s `mod tests`:

1. In `omitted_dimensions_sweep_every_value`, replace the `block_sizes` assertion with:

```rust
        assert_eq!(plan.tile_sizes, [16, 32, 64, 128, 256]);
        assert_eq!(plan.depth_blocks, [64, 128, 256, 512, 1024]);
```

2. In `only_a_pinned_dimension_or_sweep_skips_the_help`, replace `assert!(!unpinned(&["--block-size", "32"]));` with:

```rust
        assert!(!unpinned(&["--tile-size", "32"]));
        assert!(!unpinned(&["--kc", "256"]));
```

3. Replace the tests `block_size_flag_accepts_a_comma_delimited_sweep`, `zero_in_the_block_size_list_is_rejected` and `block_sizes_multiply_only_the_tiled_kernels` with:

```rust
    #[test]
    fn knob_flags_and_their_aliases_accept_comma_delimited_sweeps() {
        let plan = plan_for("knobs", &["--tile", "32,64", "--depth-block", "128,512"])
            .expect("plan should be valid");
        assert_eq!(plan.tile_sizes, [32, 64]);
        assert_eq!(plan.depth_blocks, [128, 512]);
        let plan = plan_for("kc-alias", &["--kc", "256"]).expect("plan should be valid");
        assert_eq!(plan.depth_blocks, [256]);
    }

    #[test]
    fn zero_in_a_knob_list_is_rejected() {
        for flag in ["--tile-size", "--depth-block"] {
            let error = plan_for("zero-knob", &[flag, "32,0"])
                .expect_err("a zero knob value must be rejected");
            assert!(error.contains(flag), "{error}");
        }
    }

    #[test]
    fn each_knob_multiplies_only_the_kernels_that_sweep_it() {
        let plan = plan_for(
            "knob-count",
            &[
                "--sizes", "64",
                "--precision", "f32",
                "--kernel", "ikj,tiled,rayon-tiled,packed",
                "--threads", "1,2",
                "--tile-size", "32,64,128",
                "--depth-block", "256",
            ],
        )
        .expect("plan should be valid");

        // ikj 1 + tiled 3 + rayon-tiled 2 threads x 3 tiles + packed 1 = 11
        assert_eq!(plan.total_configurations(), 11);
        assert_eq!(plan.cells(KernelChoice::Ikj, Precision::F32, 64), [(1, None)]);
        assert_eq!(
            plan.cells(KernelChoice::Tiled, Precision::F32, 64),
            [(1, Some(32)), (1, Some(64)), (1, Some(128))]
        );
        assert_eq!(plan.cells(KernelChoice::Packed, Precision::F32, 64), [(1, Some(256))]);
    }

    #[test]
    fn a_knob_no_selected_kernel_sweeps_is_rejected() {
        let error = plan_for("unused-knob", &["--kernel", "ikj,packed", "--tile-size", "32"])
            .expect_err("a knob no selected kernel uses must be rejected");
        assert!(error.contains("--tile-size applies only to tiled"), "{error}");
    }

    #[test]
    fn the_block_size_flag_is_gone() {
        assert!(Cli::try_parse_from(["gemm-bench", "--block-size", "64"]).is_err());
    }
```

4. Change `PRESET` and the two tests that read it, so the preset's knob has a kernel to apply to:

```rust
    const PRESET: &str = "sizes = [64]\nkernel = [\"tiled\"]\nprecision = [\"f32\"]\ntile-size = [32]\nrepetitions = 2\n";
```

In `config_keys_fill_the_dimensions_flags_omit`, assert `plan.kernels == [KernelChoice::Tiled]` and `plan.tile_sizes == [32]`, replacing the `block_sizes` line. In `a_flag_replaces_its_config_key_and_nothing_else`, assert `plan.kernels == [KernelChoice::Tiled]`. Then add:

```rust
    #[test]
    fn config_knob_keys_accept_the_blis_alias() {
        let plan = plan_with_config("kc-key", "kernel = [\"packed\"]\nkc = [512]\n", &[])
            .expect("config plan should be valid");
        assert_eq!(plan.depth_blocks, [512]);
    }
```

In `benchmark/src/report.rs`'s `progress_bar_lifecycle_disabled`, replace the second `set_target` call with `progress.set_target("tiled", 64, "f32", 1, Some((Knob::TileSize, 64)));`, and add `use crate::kernel::Knob;` to that test module.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --bin gemm-bench`
Expected: compile errors. `Knob`, `KernelChoice::knob`, `tile_sizes`, `depth_blocks` and the `--tile-size`/`--depth-block` flags don't exist.

- [ ] **Step 3: Give the vocabulary its knobs**

In `benchmark/src/kernel.rs`, add after the `KernelChoice` enum:

```rust
/// A knob swept from the command line besides `--threads`: one flag, one
/// default range, recorded under one `params.name`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Knob {
    /// Edge of the square cache tile of the tiled kernels.
    TileSize,
    /// Depth of each packed k-block of the packed kernels (BLIS's KC).
    DepthBlock,
}

impl Knob {
    /// The `params.name` it is recorded under.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::TileSize => "tile_size",
            Self::DepthBlock => "depth_block",
        }
    }

    /// Its CLI flag: the name in kebab case.
    pub(crate) fn flag(self) -> &'static str {
        match self {
            Self::TileSize => "--tile-size",
            Self::DepthBlock => "--depth-block",
        }
    }

    /// The progress bar's short form: BLIS's name where there is one.
    pub(crate) fn short(self) -> &'static str {
        match self {
            Self::TileSize => "tile",
            Self::DepthBlock => "kc",
        }
    }

    /// Swept when its flag is omitted. Tile 1024 hits the power-of-two
    /// aliasing cliff, and KC 16 and 32 measured 25–60% slower than KC 256.
    pub(crate) fn defaults(self) -> &'static [usize] {
        match self {
            Self::TileSize => &[16, 32, 64, 128, 256],
            Self::DepthBlock => &[64, 128, 256, 512, 1024],
        }
    }
}
```

In `KernelInfo`, replace the `blocks: bool` field and its comment with:

```rust
    /// The knob swept besides threads.
    // ponytail: one per kernel; sweep a cartesian product once a kernel needs two.
    knob: Option<Knob>,
```

In `KernelInfo::serial`, replace `blocks: false,` with `knob: None,`, and change its doc to say "with no knob". In `KernelChoice::info`:
- `Tiled`, `RayonTiled` and `StaticTiled`: replace `blocks: true,` with `knob: Some(Knob::TileSize),`.
- `Packed` and `RayonPacked`: replace it with `knob: Some(Knob::DepthBlock),`, and delete the `// --block-size is the k-block depth…` comment above `Packed`.

Replace the method `uses_blocks` with:

```rust
    /// The knob this kernel sweeps besides threads, if any.
    pub(crate) fn knob(self) -> Option<Knob> {
        self.info().knob
    }
```

- [ ] **Step 4: Replace the flag, the config key and the plan field**

In `benchmark/src/cli.rs`:

- Delete `DEFAULT_BLOCK_SIZES`.
- Add `Knob` to `use crate::kernel::{KernelChoice, Knob, Precision};`.
- Update `AFTER_HELP`'s first sentence to `Every omitted dimension (--sizes, --threads, --kernel, --precision, --tile-size, --depth-block) sweeps all of its values.`
- Update its last line to `Presets in configs/: default, quick, precisions, knobs.`
- Replace the `block_size` field with:

```rust
    /// Tile edge(s) for tiled, static-tiled and rayon-tiled, comma-delimited.
    /// Omit to sweep 16 through 256.
    #[arg(long, value_delimiter = ',', visible_alias = "tile")]
    tile_size: Vec<usize>,

    /// Depth of each packed k-block (BLIS's KC) for packed and rayon-packed,
    /// comma-delimited. Omit to sweep 64 through 1024.
    #[arg(long, value_delimiter = ',', visible_alias = "kc")]
    depth_block: Vec<usize>,
```

In `is_unpinned`, replace `&& self.block_size.is_empty()` with `&& self.tile_size.is_empty() && self.depth_block.is_empty()`.

In `into_plan`, record which knobs were given explicitly before `pick` consumes the vectors. Put this right after `let explicit_kernels = …;`:

```rust
        let explicit_knobs: Vec<Knob> = [
            (Knob::TileSize, !self.tile_size.is_empty() || file.tile_size.is_some()),
            (Knob::DepthBlock, !self.depth_block.is_empty() || file.depth_block.is_some()),
        ]
        .into_iter()
        .filter_map(|(knob, explicit)| explicit.then_some(knob))
        .collect();
```

Replace the `let block_sizes = …;` statement with:

```rust
        let tile_sizes = pick(self.tile_size, file.tile_size, || {
            Knob::TileSize.defaults().to_vec()
        });
        let depth_blocks = pick(self.depth_block, file.depth_block, || {
            Knob::DepthBlock.defaults().to_vec()
        });
```

Pass `&tile_sizes, &depth_blocks` to `validate_values` in place of `&block_sizes`. After the `#[cfg(target_os = "macos")] let bnns_skip = …;` statement, add `reject_unused_knobs(&kernels, &explicit_knobs)?;`. In the `BenchmarkPlan { … }` literal, replace `block_sizes,` with `tile_sizes, depth_blocks,`.

Change `validate_values` to take `tile_sizes: &[usize], depth_blocks: &[usize]` in place of `block_sizes`. In both lists, replace `("--block-size", …)` with `("--tile-size", …)` and `("--depth-block", …)` entries.

Add this function after `reject_idle_kernels`:

```rust
/// A knob given explicitly (flag or config key) that no selected kernel
/// sweeps would be silently ignored, so it is a mistake worth stopping for.
fn reject_unused_knobs(kernels: &[KernelChoice], explicit: &[Knob]) -> Result<(), String> {
    for &knob in explicit {
        if kernels.iter().any(|kernel| kernel.knob() == Some(knob)) {
            continue;
        }
        let users: Vec<&str> = KernelChoice::value_variants()
            .iter()
            .filter(|kernel| kernel.knob() == Some(knob))
            .map(|kernel| kernel.label())
            .collect();
        return Err(format!(
            "{} applies only to {}, and none of them is selected",
            knob.flag(),
            users.join(", ")
        ));
    }
    Ok(())
}
```

In `benchmark/src/config.rs`, replace the `block_size` field with:

```rust
    #[serde(alias = "tile")]
    pub(crate) tile_size: Option<Vec<usize>>,
    #[serde(alias = "kc")]
    pub(crate) depth_block: Option<Vec<usize>>,
```

In `benchmark/src/plan.rs`, add `Knob` to the kernel import and replace `pub(crate) block_sizes: Vec<usize>,` with:

```rust
    pub(crate) tile_sizes: Vec<usize>,
    pub(crate) depth_blocks: Vec<usize>,
```

Add this method to `impl BenchmarkPlan`:

```rust
    /// The values swept for `knob`.
    pub(crate) fn knob_values(&self, knob: Knob) -> &[usize] {
        match knob {
            Knob::TileSize => &self.tile_sizes,
            Knob::DepthBlock => &self.depth_blocks,
        }
    }
```

In `cells`, replace the `let blocks …` statement with:

```rust
        let knobs: Vec<Option<usize>> = match kernel.knob() {
            Some(knob) => self.knob_values(knob).iter().copied().map(Some).collect(),
            None => vec![None],
        };
```

Use `knobs` in place of `blocks` in the final `flat_map`. Also update the doc comment on `cells` to say "(threads, knob value) cells".

In `benchmark/src/report.rs`, change `set_target` to take `knob: Option<(Knob, usize)>` and format it like this (add `use crate::kernel::Knob;`):

```rust
        let knob = knob.map_or_else(String::new, |(knob, value)| {
            format!(" {}={value}", knob.short())
        });
        self.bar.set_message(format!(
            "{kernel:<11} n={n:<4} {precision:<3} t={threads}{knob}"
        ));
```

In `benchmark/src/benchmark.rs`:
- **`run_precision` loop:** rename the loop variable `block_size` to `knob` and pass `knob` to `measure`. Call `progress.set_target(kernel.label(), n, precision.label(), thread_count, kernel.knob().zip(knob));`. In the record, set `block_size: knob,` (the CSV column until Task 6).
- **Error text:** make it name the knob, using `{knob_text}` where the message used `{block}`:

```rust
                    let knob_text = kernel.knob().zip(knob).map_or_else(String::new, |(k, v)| {
                        format!(", {} {v}", k.name())
                    });
```

- **`measure`:** rename the parameter `block_size: Option<usize>` to `knob_value: Option<usize>`. Its closure becomes `let knob = || knob_value.expect("kernels with a knob always get a value");`, and every `block()` call becomes `knob()`.

- [ ] **Step 5: Update the presets**

`configs/default.toml`:

```toml
# The default run before --sweep existed. Every omitted key sweeps all of its
# values (sizes 64-4096, threads 1..all cores, every kernel); flags override keys.
precision = ["f32"]
tile-size = [64]
depth-block = [256]
```

`configs/quick.toml`:

```toml
# Seconds-long sanity check across every kernel and thread count.
sizes = [64, 256]
precision = ["f32"]
tile-size = [64]
depth-block = [256]
repetitions = 3
```

`configs/precisions.toml`: delete the `block-size = [64]` line. None of its kernels sweeps a knob, so the line would now be rejected.

Rename the block-size preset (`git mv configs/block-sizes.toml configs/knobs.toml`) and replace its contents:

```toml
# Every tile size and depth block at three sizes, for the dashboard's Tuning
# knobs tab. Omitted knob keys sweep their full default ranges.
sizes = [512, 1024, 2048]
precision = ["f32"]
kernel = ["tiled", "static-tiled", "rayon-tiled", "packed", "rayon-packed"]
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: PASS. `every_preset_parses` loads `knobs.toml`.

- [ ] **Step 7: Lint and commit**

Run: `just lint && just check-bench`

```bash
git add benchmark/src configs
git commit -m "Replace --block-size with --tile-size and --depth-block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Capture the Machine

**Files:**
- Create: `benchmark/src/machine.rs`
- Modify: `benchmark/build.rs`, `benchmark/src/context.rs`, `benchmark/src/main.rs`
- Test: the `tests` module in `benchmark/src/machine.rs`, plus the existing one in `benchmark/src/context.rs`

**Interfaces:**
- Produces (all in `crate::machine`):
  - `Machine { os: String, arch: &'static str, target_features: String, rustc_version: &'static str, cpu: String, available_parallelism: usize, gpu: Option<String>, gpu_cores: Option<usize>, tiers: Vec<CoreTier>, caches: Vec<Cache> }` and `Machine::capture() -> Machine`.
  - `CoreTier { tier: usize, name: Option<String>, cores: usize, logical_cpus: usize }`.
  - `Cache { tier: Option<usize>, level: usize, kind: CacheKind, size_bytes: usize, line_bytes: Option<usize>, shared_by: usize, instances: usize }`.
  - `CacheKind::{Data, Instruction, Unified}` with `label() -> "data" | "instruction" | "unified"`.
  - The build exports the env var `GEMM_BENCH_RUSTC`.

Nothing reads `Machine` until the writer in Task 6, so `mod machine;` carries a temporary `allow(dead_code)` that Task 6 deletes.

- [ ] **Step 1: Write the failing tests**

Create `benchmark/src/machine.rs` with only its test module, plus `mod machine;` in `main.rs` (next to the other `mod` lines):

```rust
#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{
        Cache, CacheKind, CoreTier, Machine, linux_topology, macos_topology, parse_cpu_list,
        parse_gpu_cores, parse_size, parse_sysctl, target_features,
    };

    /// `sysctl hw` on a 10-core M1 Pro, trimmed. The legacy `hw.l1dcachesize`
    /// and `hw.l2cachesize` report the E-cores, so they must be ignored.
    const M1_PRO: &str = "\
hw.perflevel0.physicalcpu: 8
hw.perflevel0.logicalcpu: 8
hw.perflevel0.l1icachesize: 196608
hw.perflevel0.l1dcachesize: 131072
hw.perflevel0.l2cachesize: 12582912
hw.perflevel0.cpusperl2: 4
hw.perflevel0.name: Performance
hw.perflevel1.physicalcpu: 2
hw.perflevel1.logicalcpu: 2
hw.perflevel1.l1icachesize: 131072
hw.perflevel1.l1dcachesize: 65536
hw.perflevel1.l2cachesize: 4194304
hw.perflevel1.cpusperl2: 2
hw.perflevel1.name: Efficiency
hw.l1dcachesize: 65536
hw.l2cachesize: 4194304
hw.cachelinesize: 128
hw.nperflevels: 2
";

    fn cache(tier: usize, level: usize, kind: CacheKind, size_bytes: usize, shared_by: usize, instances: usize) -> Cache {
        Cache { tier: Some(tier), level, kind, size_bytes, line_bytes: Some(128), shared_by, instances }
    }

    #[test]
    fn macos_perflevels_become_tiers_with_their_own_caches() {
        let (tiers, caches) = macos_topology(&parse_sysctl(M1_PRO));
        assert_eq!(
            tiers,
            [
                CoreTier { tier: 0, name: Some("Performance".into()), cores: 8, logical_cpus: 8 },
                CoreTier { tier: 1, name: Some("Efficiency".into()), cores: 2, logical_cpus: 2 },
            ]
        );
        assert_eq!(
            caches,
            [
                cache(0, 1, CacheKind::Data, 128 << 10, 1, 8),
                cache(0, 1, CacheKind::Instruction, 192 << 10, 1, 8),
                cache(0, 2, CacheKind::Unified, 12 << 20, 4, 2),
                cache(1, 1, CacheKind::Data, 64 << 10, 1, 2),
                cache(1, 1, CacheKind::Instruction, 128 << 10, 1, 2),
                cache(1, 2, CacheKind::Unified, 4 << 20, 2, 1),
            ]
        );
    }

    #[test]
    fn without_perflevels_macos_reports_no_topology() {
        let (tiers, caches) = macos_topology(&parse_sysctl("hw.ncpu: 8\n"));
        assert!(tiers.is_empty() && caches.is_empty());
    }

    #[test]
    fn ioreg_names_the_gpu_core_count() {
        let ioreg = "  | {\n  |   \"model\" = \"Apple M1 Pro\"\n  |   \"gpu-core-count\" = 16\n";
        assert_eq!(parse_gpu_cores(ioreg), Some(16));
        assert_eq!(parse_gpu_cores("\"model\" = \"x\"\n"), None);
    }

    #[test]
    fn sysfs_lists_and_sizes_parse() {
        assert_eq!(parse_cpu_list("0-3,8,10-11\n"), Some(vec![0, 1, 2, 3, 8, 10, 11]));
        assert_eq!(parse_cpu_list(""), None);
        assert_eq!(parse_size("48K"), Some(48 << 10));
        assert_eq!(parse_size("36M"), Some(36 << 20));
        assert_eq!(parse_size("512"), Some(512));
        assert_eq!(parse_size("12Q"), None);
    }

    /// One CPU's sysfs files: its core id and its caches as (index, level,
    /// type, size, shared_cpu_list).
    fn cpu(cpu: usize, core: usize, caches: &[(usize, usize, &str, &str, &str)]) -> Vec<(String, String)> {
        let dir = format!("system/cpu/cpu{cpu}");
        let mut files = vec![
            (format!("{dir}/topology/physical_package_id"), "0".to_owned()),
            (format!("{dir}/topology/core_id"), core.to_string()),
        ];
        for &(index, level, kind, size, shared) in caches {
            let cache = format!("{dir}/cache/index{index}");
            files.extend([
                (format!("{cache}/level"), level.to_string()),
                (format!("{cache}/type"), kind.to_owned()),
                (format!("{cache}/size"), size.to_owned()),
                (format!("{cache}/coherency_line_size"), "64".to_owned()),
                (format!("{cache}/shared_cpu_list"), shared.to_owned()),
            ]);
        }
        files
    }

    fn sysfs(name: &str, files: &[(String, String)]) -> PathBuf {
        let root = std::env::temp_dir().join(format!("gemm-bench-sysfs-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (path, content) in files {
            let file = root.join(path);
            fs::create_dir_all(file.parent().expect("a parent")).expect("create dirs");
            fs::write(file, content).expect("write sysfs file");
        }
        root
    }

    #[test]
    fn linux_hybrid_splits_core_and_atom_and_finds_the_shared_l3() {
        // Two SMT P-cores (cpus 0-3) with private L1/L2, four E-cores (cpus
        // 4-7) sharing one L2, and one L3 across all eight.
        let mut files = vec![
            ("system/cpu/online".to_owned(), "0-7\n".to_owned()),
            ("cpu_core/cpus".to_owned(), "0-3\n".to_owned()),
            ("cpu_atom/cpus".to_owned(), "4-7\n".to_owned()),
        ];
        for p in 0..4 {
            let pair = if p < 2 { "0-1" } else { "2-3" };
            files.extend(cpu(p, p / 2, &[
                (0, 1, "Data", "48K", pair),
                (2, 2, "Unified", "2048K", pair),
                (3, 3, "Unified", "36864K", "0-7"),
            ]));
        }
        for e in 4..8 {
            let own = e.to_string();
            files.extend(cpu(e, e, &[
                (0, 1, "Data", "32K", &own),
                (2, 2, "Unified", "4096K", "4-7"),
                (3, 3, "Unified", "36864K", "0-7"),
            ]));
        }
        let (tiers, caches) = linux_topology(&sysfs("hybrid", &files));
        assert_eq!(
            tiers,
            [
                CoreTier { tier: 0, name: Some("Performance".into()), cores: 2, logical_cpus: 4 },
                CoreTier { tier: 1, name: Some("Efficiency".into()), cores: 4, logical_cpus: 4 },
            ]
        );
        let line = Some(64);
        let expected = [
            Cache { tier: None, level: 3, kind: CacheKind::Unified, size_bytes: 36 << 20, line_bytes: line, shared_by: 8, instances: 1 },
            Cache { tier: Some(0), level: 1, kind: CacheKind::Data, size_bytes: 48 << 10, line_bytes: line, shared_by: 2, instances: 2 },
            Cache { tier: Some(0), level: 2, kind: CacheKind::Unified, size_bytes: 2 << 20, line_bytes: line, shared_by: 2, instances: 2 },
            Cache { tier: Some(1), level: 1, kind: CacheKind::Data, size_bytes: 32 << 10, line_bytes: line, shared_by: 1, instances: 4 },
            Cache { tier: Some(1), level: 2, kind: CacheKind::Unified, size_bytes: 4 << 20, line_bytes: line, shared_by: 4, instances: 1 },
        ];
        assert_eq!(caches, expected);
    }

    #[test]
    fn linux_without_hybrid_pmus_orders_tiers_by_capacity() {
        let mut files = vec![("system/cpu/online".to_owned(), "0-3\n".to_owned())];
        for cpu_id in 0..4 {
            files.extend(cpu(cpu_id, cpu_id, &[(0, 1, "Data", "64K", &cpu_id.to_string())]));
            let capacity = if cpu_id < 2 { "446" } else { "1024" };
            files.push((format!("system/cpu/cpu{cpu_id}/cpu_capacity"), capacity.to_owned()));
        }
        let (tiers, _) = linux_topology(&sysfs("big-little", &files));
        assert_eq!(tiers.len(), 2);
        assert_eq!((tiers[0].name.as_deref(), tiers[0].cores), (None, 2));
    }

    #[test]
    fn linux_without_sysfs_reports_no_topology() {
        let (tiers, caches) = linux_topology(&sysfs("empty", &[]));
        assert!(tiers.is_empty() && caches.is_empty());
    }

    #[test]
    fn target_features_are_sorted_and_name_the_build() {
        let features = target_features();
        let names: Vec<&str> = features.split(' ').filter(|name| !name.is_empty()).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted);
        #[cfg(target_arch = "aarch64")]
        assert!(names.contains(&"neon"), "{features}");
    }

    #[test]
    fn capture_fills_what_every_run_needs() {
        let machine = Machine::capture();
        assert!(!machine.os.is_empty() && !machine.cpu.is_empty());
        assert_eq!(machine.arch, std::env::consts::ARCH);
        assert!(machine.rustc_version.starts_with("rustc "), "{}", machine.rustc_version);
        assert!(machine.available_parallelism > 0);
        assert!(machine.gpu.is_some() || machine.gpu_cores.is_none());
        #[cfg(target_os = "macos")]
        assert!(!machine.tiers.is_empty() && !machine.caches.is_empty());
    }
}
```

In `benchmark/src/context.rs`'s tests, add `parse_lscpu_model` to the `use super::{…}` list and append:

```rust
    #[test]
    fn parse_lscpu_model_reads_the_decoded_arm_part() {
        let lscpu = "Architecture:  aarch64\nVendor ID:     ARM\nModel name:    Neoverse-V1\n";
        assert_eq!(parse_lscpu_model(lscpu).as_deref(), Some("Neoverse-V1"));
        assert_eq!(parse_lscpu_model("Architecture: aarch64\n"), None);
    }
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --bin gemm-bench machine context`
Expected: compile errors. `Machine`, `macos_topology` and `parse_lscpu_model` are not defined, and `GEMM_BENCH_RUSTC` is not set.

- [ ] **Step 3: Record the compiler in `build.rs`**

At the top of `main` in `benchmark/build.rs`, before the Swift lines, add:

```rust
    // Recorded with every run as `runs.rustc_version`: rust-toolchain.toml
    // pins the nightly channel, not a date, so contributors' compilers differ.
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".to_owned());
    let version = std::process::Command::new(rustc)
        .arg("-V")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=GEMM_BENCH_RUSTC={version}");
```

- [ ] **Step 4: Add the lscpu fallback to `context::cpu_name`**

In `benchmark/src/context.rs`, change the Linux branch of `cpu_name` to:

```rust
    #[cfg(target_os = "linux")]
    let name = std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|cpuinfo| parse_cpu_model(&cpuinfo))
        // ARM kernels leave `model name` out; lscpu decodes the part number.
        .or_else(|| command_output("lscpu", &[]).and_then(|text| parse_lscpu_model(&text)));
```

Then add after `parse_cpu_model`:

```rust
/// lscpu's `Model name`, e.g. `Neoverse-V1` on an ARM server.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_lscpu_model(lscpu: &str) -> Option<String> {
    lscpu.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "Model name").then(|| value.trim().to_owned())
    })
}
```

- [ ] **Step 5: Write `machine.rs` above its tests**

```rust
//! The machine a run measured, captured once per run: the build (arch,
//! compile-time target features, rustc), the OS, the CPU's core tiers and
//! caches, and the GPU. What a platform doesn't expose is left out (an empty
//! list, or `None`), never guessed.

use std::{
    cmp::Reverse,
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::Path,
};

use crate::context::{command_output, cpu_name};

/// What the `runs`, `core_tiers` and `caches` tables record about the machine.
#[derive(Debug)]
pub(crate) struct Machine {
    /// e.g. `macOS 27.0.1` or `Linux 6.8.0-45-generic`.
    pub(crate) os: String,
    /// `std::env::consts::ARCH`, e.g. `aarch64`.
    pub(crate) arch: &'static str,
    /// The target features this binary was compiled with, sorted and
    /// space-separated.
    pub(crate) target_features: String,
    /// `rustc -V` of the compiler that built this binary.
    pub(crate) rustc_version: &'static str,
    pub(crate) cpu: String,
    /// What `--threads` sweeps up to; below the core count under a CPU quota.
    pub(crate) available_parallelism: usize,
    pub(crate) gpu: Option<String>,
    pub(crate) gpu_cores: Option<usize>,
    /// Kinds of core, fastest first.
    pub(crate) tiers: Vec<CoreTier>,
    pub(crate) caches: Vec<Cache>,
}

/// One kind of core: an Apple performance level, or Intel's core or atom half.
#[derive(Debug, Eq, PartialEq)]
pub(crate) struct CoreTier {
    /// 0 is the fastest.
    pub(crate) tier: usize,
    /// The OS's name for it (`Performance`), when it has one.
    pub(crate) name: Option<String>,
    pub(crate) cores: usize,
    pub(crate) logical_cpus: usize,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) enum CacheKind {
    Data,
    Instruction,
    Unified,
}

impl CacheKind {
    /// The value stored in `caches.kind`.
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Data => "data",
            Self::Instruction => "instruction",
            Self::Unified => "unified",
        }
    }

    /// sysfs's `type` file: `Data`, `Instruction` or `Unified`.
    fn from_sysfs(text: &str) -> Option<Self> {
        match text {
            "Data" => Some(Self::Data),
            "Instruction" => Some(Self::Instruction),
            "Unified" => Some(Self::Unified),
            _ => None,
        }
    }
}

/// `instances` identical caches, each shared by `shared_by` logical CPUs.
#[derive(Debug, Eq, PartialEq)]
pub(crate) struct Cache {
    /// The tier whose CPUs it serves, or `None` when it spans tiers (a shared L3).
    pub(crate) tier: Option<usize>,
    pub(crate) level: usize,
    pub(crate) kind: CacheKind,
    pub(crate) size_bytes: usize,
    pub(crate) line_bytes: Option<usize>,
    pub(crate) shared_by: usize,
    pub(crate) instances: usize,
}

impl Machine {
    /// Looks the machine up now. Never fails: a lookup that does is left out,
    /// or recorded as `unknown` where the schema needs a value.
    pub(crate) fn capture() -> Self {
        let (tiers, caches) = topology();
        #[cfg(target_os = "macos")]
        let gpu = gemm_bench::kernels::metal::default_device_name();
        #[cfg(not(target_os = "macos"))]
        let gpu: Option<String> = None;
        // The 14- and 16-core M1 Pro GPUs report the same name; peaks.csv
        // needs the core count to pick the right ceiling.
        #[cfg(target_os = "macos")]
        let gpu_cores = gpu
            .as_ref()
            .and_then(|_| command_output("ioreg", &["-rc", "AGXAccelerator", "-d1"]))
            .and_then(|text| parse_gpu_cores(&text));
        #[cfg(not(target_os = "macos"))]
        let gpu_cores = None;
        Self {
            os: os(),
            arch: std::env::consts::ARCH,
            target_features: target_features(),
            rustc_version: env!("GEMM_BENCH_RUSTC"),
            cpu: cpu_name(),
            available_parallelism: std::thread::available_parallelism()
                .map_or(1, std::num::NonZero::get),
            gpu,
            gpu_cores,
            tiers,
            caches,
        }
    }
}

fn os() -> String {
    #[cfg(target_os = "macos")]
    let version = command_output("sw_vers", &["-productVersion"]).map(|v| format!("macOS {v}"));
    #[cfg(target_os = "linux")]
    let version = command_output("uname", &["-r"]).map(|v| format!("Linux {v}"));
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let version: Option<String> = None;
    version.unwrap_or_else(|| std::env::consts::OS.to_owned())
}

/// The enabled subset of the features that change how the kernels compile,
/// sorted. Only names rustc knows: an unknown one trips `unexpected_cfgs`.
fn target_features() -> String {
    #[cfg(target_arch = "aarch64")]
    let known = [
        ("bf16", cfg!(target_feature = "bf16")),
        ("dotprod", cfg!(target_feature = "dotprod")),
        ("fp16", cfg!(target_feature = "fp16")),
        ("i8mm", cfg!(target_feature = "i8mm")),
        ("neon", cfg!(target_feature = "neon")),
        ("sme", cfg!(target_feature = "sme")),
        ("sve", cfg!(target_feature = "sve")),
        ("sve2", cfg!(target_feature = "sve2")),
    ];
    #[cfg(target_arch = "x86_64")]
    let known = [
        ("avx", cfg!(target_feature = "avx")),
        ("avx2", cfg!(target_feature = "avx2")),
        ("avx512f", cfg!(target_feature = "avx512f")),
        ("avx512fp16", cfg!(target_feature = "avx512fp16")),
        ("f16c", cfg!(target_feature = "f16c")),
        ("fma", cfg!(target_feature = "fma")),
        ("sse4.2", cfg!(target_feature = "sse4.2")),
    ];
    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    let known: [(&str, bool); 0] = [];
    known
        .iter()
        .filter(|&&(_, enabled)| enabled)
        .map(|&(name, _)| name)
        .collect::<Vec<_>>()
        .join(" ")
}

fn topology() -> (Vec<CoreTier>, Vec<Cache>) {
    #[cfg(target_os = "macos")]
    let topology = command_output("sysctl", &["hw"]).map(|text| macos_topology(&parse_sysctl(&text)));
    #[cfg(target_os = "linux")]
    let topology = Some(linux_topology(Path::new("/sys/devices")));
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let topology: Option<(Vec<CoreTier>, Vec<Cache>)> = None;
    topology.unwrap_or_default()
}

/// `key: value` lines of `sysctl hw`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_sysctl(text: &str) -> HashMap<&str, &str> {
    text.lines().filter_map(|line| line.split_once(": ")).collect()
}

/// Tiers and caches from `hw.perflevelN.*`. Never the legacy
/// `hw.l1dcachesize`/`hw.l2cachesize`: on Apple Silicon they describe the
/// E-cores.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn macos_topology(sysctl: &HashMap<&str, &str>) -> (Vec<CoreTier>, Vec<Cache>) {
    let number = |key: &str| sysctl.get(key).and_then(|value| value.parse::<usize>().ok());
    let line_bytes = number("hw.cachelinesize");
    let (mut tiers, mut caches) = (Vec::new(), Vec::new());
    for tier in 0..number("hw.nperflevels").unwrap_or(0) {
        let key = |name: &str| format!("hw.perflevel{tier}.{name}");
        let (Some(cores), Some(logical)) = (number(&key("physicalcpu")), number(&key("logicalcpu"))) else {
            continue;
        };
        tiers.push(CoreTier {
            tier,
            name: sysctl.get(key("name").as_str()).map(|name| (*name).to_owned()),
            cores,
            logical_cpus: logical,
        });
        // L1s are per core (its SMT threads share it); L2/L3 name their sharing.
        let per_core = logical / cores.max(1);
        let levels = [
            ("l1dcachesize", 1, CacheKind::Data, None),
            ("l1icachesize", 1, CacheKind::Instruction, None),
            ("l2cachesize", 2, CacheKind::Unified, Some("cpusperl2")),
            ("l3cachesize", 3, CacheKind::Unified, Some("cpusperl3")),
        ];
        for (size_key, level, kind, sharing_key) in levels {
            let Some(size_bytes) = number(&key(size_key)).filter(|&size| size > 0) else {
                continue;
            };
            let shared_by = sharing_key
                .map_or(Some(per_core), |sharing| number(&key(sharing)))
                .filter(|&shared| shared > 0)
                .unwrap_or(1);
            caches.push(Cache {
                tier: Some(tier),
                level,
                kind,
                size_bytes,
                line_bytes,
                shared_by,
                instances: logical.div_ceil(shared_by),
            });
        }
    }
    (tiers, caches)
}

/// `"gpu-core-count" = 16` in `ioreg -rc AGXAccelerator -d1`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_gpu_cores(ioreg: &str) -> Option<usize> {
    ioreg.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        key.trim_start_matches([' ', '|'])
            .trim()
            .eq("\"gpu-core-count\"")
            .then(|| value.trim().parse().ok())
            .flatten()
    })
}

/// A sysfs CPU list: `0-3,8,10-11` → `[0, 1, 2, 3, 8, 10, 11]`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_cpu_list(text: &str) -> Option<Vec<usize>> {
    let mut cpus = Vec::new();
    for part in text.trim().split(',').filter(|part| !part.is_empty()) {
        match part.split_once('-') {
            Some((first, last)) => cpus.extend(first.parse::<usize>().ok()?..=last.parse().ok()?),
            None => cpus.push(part.parse().ok()?),
        }
    }
    cpus.sort_unstable();
    cpus.dedup();
    (!cpus.is_empty()).then_some(cpus)
}

/// A sysfs cache size: `48K`, `36M`, or plain bytes.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_size(text: &str) -> Option<usize> {
    let text = text.trim();
    let split = text.find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len());
    let (digits, unit) = text.split_at(split);
    let scale = match unit {
        "" => 1,
        "K" => 1 << 10,
        "M" => 1 << 20,
        "G" => 1 << 30,
        _ => return None,
    };
    digits.parse::<usize>().ok().map(|n| n * scale).filter(|&n| n > 0)
}

/// Core tiers and caches from a Linux sysfs tree: `/sys/devices` in use, a
/// temp directory in tests.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_topology(devices: &Path) -> (Vec<CoreTier>, Vec<Cache>) {
    let cpu_dir = devices.join("system/cpu");
    let read = |path: &Path| fs::read_to_string(path).ok().map(|text| text.trim().to_owned());
    let list = |path: &Path| read(path).and_then(|text| parse_cpu_list(&text));
    let Some(online) = list(&cpu_dir.join("online")) else {
        return (Vec::new(), Vec::new());
    };

    // Tiers, fastest first: Intel's hybrid PMUs name them; elsewhere a higher
    // cpu_capacity is a faster core; with neither, every CPU is one tier.
    let groups: Vec<(Option<String>, Vec<usize>)> =
        match (list(&devices.join("cpu_core/cpus")), list(&devices.join("cpu_atom/cpus"))) {
            (Some(core), Some(atom)) => vec![
                (Some("Performance".to_owned()), core),
                (Some("Efficiency".to_owned()), atom),
            ],
            _ => {
                let mut by_capacity: BTreeMap<Reverse<usize>, Vec<usize>> = BTreeMap::new();
                for &cpu in &online {
                    let capacity = read(&cpu_dir.join(format!("cpu{cpu}/cpu_capacity")))
                        .and_then(|text| text.parse().ok())
                        .unwrap_or(0);
                    by_capacity.entry(Reverse(capacity)).or_default().push(cpu);
                }
                by_capacity.into_values().map(|cpus| (None, cpus)).collect()
            }
        };
    let tier_of: HashMap<usize, usize> = groups
        .iter()
        .enumerate()
        .flat_map(|(tier, (_, cpus))| cpus.iter().map(move |&cpu| (cpu, tier)))
        .collect();
    let tiers = groups
        .iter()
        .enumerate()
        .map(|(tier, (name, cpus))| {
            // A core is a (package, core id) pair; its SMT siblings share it.
            let cores: BTreeSet<(Option<String>, Option<String>)> = cpus
                .iter()
                .map(|cpu| {
                    let topology = cpu_dir.join(format!("cpu{cpu}/topology"));
                    let core = read(&topology.join("core_id")).or_else(|| Some(format!("cpu{cpu}")));
                    (read(&topology.join("physical_package_id")), core)
                })
                .collect();
            CoreTier { tier, name: name.clone(), cores: cores.len(), logical_cpus: cpus.len() }
        })
        .collect();

    // Each cache once, keyed by the CPUs it serves, then grouped into
    // (tier, level, kind, size, sharing) with an instance count.
    let mut seen: BTreeMap<(usize, CacheKind, Vec<usize>), (usize, Option<usize>)> = BTreeMap::new();
    for &cpu in &online {
        let Ok(entries) = fs::read_dir(cpu_dir.join(format!("cpu{cpu}/cache"))) else {
            continue;
        };
        for dir in entries.flatten().map(|entry| entry.path()) {
            if !dir.file_name().is_some_and(|name| name.to_string_lossy().starts_with("index")) {
                continue;
            }
            let (Some(level), Some(kind), Some(size), Some(shared)) = (
                read(&dir.join("level"))
                    .and_then(|text| text.parse::<usize>().ok())
                    .filter(|level| (1..=4).contains(level)),
                read(&dir.join("type")).and_then(|text| CacheKind::from_sysfs(&text)),
                read(&dir.join("size")).and_then(|text| parse_size(&text)),
                list(&dir.join("shared_cpu_list")),
            ) else {
                continue;
            };
            let line = read(&dir.join("coherency_line_size"))
                .and_then(|text| text.parse::<usize>().ok())
                .filter(|&line| line > 0);
            seen.insert((level, kind, shared), (size, line));
        }
    }
    let mut grouped: BTreeMap<(Option<usize>, usize, CacheKind, usize, usize), (Option<usize>, usize)> =
        BTreeMap::new();
    for ((level, kind, shared), (size, line)) in seen {
        let tier = tier_of
            .get(&shared[0])
            .copied()
            .filter(|&tier| shared.iter().all(|cpu| tier_of.get(cpu) == Some(&tier)));
        grouped.entry((tier, level, kind, size, shared.len())).or_insert((line, 0)).1 += 1;
    }
    let caches = grouped
        .into_iter()
        .map(|((tier, level, kind, size_bytes, shared_by), (line_bytes, instances))| Cache {
            tier,
            level,
            kind,
            size_bytes,
            line_bytes,
            shared_by,
            instances,
        })
        .collect();
    (tiers, caches)
}
```

In `benchmark/src/main.rs`, mark the module until Task 6 reads it:

```rust
#[allow(dead_code, reason = "the SQLite writer (Task 6) records it; delete this attribute then")]
mod machine;
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml --bin gemm-bench machine context`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

Run: `just lint && just check-bench`

```bash
git add benchmark/build.rs benchmark/src
git commit -m "Capture the machine a run measures: build, OS, core tiers, caches, GPU

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Host Identity

**Files:**
- Create: `benchmark/src/host.rs`
- Modify: `benchmark/src/main.rs`, `justfile`, `.gitignore`

**Interfaces:**
- Produces (all in `crate::host`):
  - `HOST_FILE: &str = ".host"`.
  - `is_host_id(&str) -> bool`.
  - `read_host_file(&Path) -> Result<String, String>`.
  - `db_path(&str) -> PathBuf`, giving `data/db/<id>.sqlite`.

- [ ] **Step 1: Write the failing tests**

Create `benchmark/src/host.rs` with only its tests:

```rust
#[cfg(test)]
mod tests {
    use std::{fs, path::{Path, PathBuf}};

    use super::{db_path, is_host_id, read_host_file};

    #[test]
    fn a_host_id_is_a_github_login_and_a_machine_name() {
        for id in ["octocat/m1pro", "a/b", "paul-h0/mac-studio-2"] {
            assert!(is_host_id(id), "{id}");
        }
        let too_long = format!("{}/m1", "a".repeat(40));
        for id in ["octocat", "Octocat/m1", "-octo/m1", "octo/-m1", "octo/", "/m1", "octo/m1/x", "octo/m 1", &too_long] {
            assert!(!is_host_id(id), "{id}");
        }
    }

    fn temp_file(name: &str, content: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("gemm-bench-host-{}-{name}", std::process::id()));
        fs::write(&path, content).expect("write host file");
        path
    }

    #[test]
    fn the_host_file_is_read_trimmed() {
        let path = temp_file("ok", "octocat/m1pro\n");
        assert_eq!(read_host_file(&path).as_deref(), Ok("octocat/m1pro"));
    }

    #[test]
    fn a_missing_or_malformed_host_file_names_the_fix() {
        let missing = read_host_file(Path::new("/nonexistent/.host")).expect_err("missing");
        assert!(missing.contains("just init"), "{missing}");
        let bad = read_host_file(&temp_file("bad", "Pauls-MacBook-Pro\n")).expect_err("malformed");
        assert!(bad.contains("just init") && bad.contains("Pauls-MacBook-Pro"), "{bad}");
    }

    #[test]
    fn a_host_writes_to_its_own_db() {
        assert_eq!(db_path("octocat/m1pro"), PathBuf::from("data/db/octocat/m1pro.sqlite"));
    }
}
```

Add `mod host;` to `benchmark/src/main.rs`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --bin gemm-bench host`
Expected: compile errors, because the functions don't exist.

- [ ] **Step 3: Write `host.rs` above its tests**

```rust
//! Whose machine a run measured: `<github-login>/<machine>`, set once with
//! `just init` into the git-ignored `.host` file at the repo root. The same
//! id names the host's DB, so CI can tie each DB to a PR author.

use std::{
    fs,
    path::{Path, PathBuf},
};

/// Written by `just init`; read by every run without `--output`.
pub(crate) const HOST_FILE: &str = ".host";

/// `<login>/<machine>`: a GitHub login (at most 39 characters) and a machine
/// name, both lowercase letters, digits and hyphens, not starting with a
/// hyphen.
pub(crate) fn is_host_id(id: &str) -> bool {
    let part = |text: &str, max: usize| {
        !text.is_empty()
            && text.len() <= max
            && !text.starts_with('-')
            && text.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    };
    id.split_once('/')
        .is_some_and(|(login, machine)| part(login, 39) && part(machine, usize::MAX))
}

/// The host id in `path`. A missing or malformed file says how to fix it.
pub(crate) fn read_host_file(path: &Path) -> Result<String, String> {
    let fix = "run `just init <github-login>/<machine>` once (e.g. `just init octocat/m1pro`), or pass --output";
    let text = fs::read_to_string(path)
        .map_err(|_| format!("no host id in {}: {fix}", path.display()))?;
    let id = text.trim();
    if is_host_id(id) {
        Ok(id.to_owned())
    } else {
        Err(format!(
            "'{id}' in {} is not <github-login>/<machine> in lowercase letters, digits and hyphens: {fix}",
            path.display()
        ))
    }
}

/// Where a host's runs go, relative to the repo root (where `just bench`
/// runs): `data/db/<login>/<machine>.sqlite`.
pub(crate) fn db_path(host: &str) -> PathBuf {
    Path::new("data/db").join(format!("{host}.sqlite"))
}
```

Mark the module the same way as `machine` until Task 6 uses it:

```rust
#[allow(dead_code, reason = "the SQLite writer (Task 6) uses it; delete this attribute then")]
mod host;
```

- [ ] **Step 4: Add `just init` and ignore `.host`**

Add to `justfile` after the `bench` recipe:

```just
# Names this machine for `just bench`, once: <github-login>/<machine>, e.g. octocat/m1pro.
init id:
    printf '%s\n' '{{id}}' > .host
```

Append `/.host` to `.gitignore`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml --bin gemm-bench host`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

Run: `just lint && just check-bench`

```bash
git add benchmark/src justfile .gitignore
git commit -m "Name hosts by GitHub login and machine, set once with just init

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The SQLite Writer Replaces the CSV

**Files:**
- Create: `data/schema.sql`, `benchmark/src/db.rs`
- Modify: `benchmark/Cargo.toml`, `benchmark/src/main.rs`, `benchmark/src/cli.rs`, `benchmark/src/plan.rs`, `benchmark/src/benchmark.rs`, `benchmark/src/report.rs`, `benchmark/src/context.rs`

**Interfaces:**
- Consumes: from Task 4, `Machine`, `CoreTier`, `Cache`, `CacheKind::label`. From Task 5, `host::{HOST_FILE, read_host_file, db_path}`. From Task 2, `BenchmarkRecord.params` and `Source::label`.
- Produces (all in `crate::db`):
  - `SCHEMA: &str` (`include_str!` of `data/schema.sql`).
  - `APPLICATION_ID: i64 = 0x4745_4d4d` and `SCHEMA_VERSION: i64 = 1`.
  - `open_for_run(path: &Path, started_at: &str) -> Result<Connection, String>`.
  - `write_run(db: &mut Connection, context: &RunContext, repetitions: usize, machine: &Machine, records: &[BenchmarkRecord]) -> rusqlite::Result<()>`.
  - `#[cfg(test)] pub(crate) mod fixtures { machine(), context(at), records() }`.
- Changes elsewhere:
  - `BenchmarkPlan` gains `machine: Machine` and `db: Connection`, and loses `output: File` and `devices`.
  - `RunContext` keeps only `{ commit, timestamp }`.
  - `BenchmarkRecord` loses `device`, `block_size`, `repetitions`, `host`, `commit`, `timestamp` and its `Serialize` derive.

- [ ] **Step 1: Add the schema and the dependency**

Create `data/schema.sql` with exactly this DDL (the spec's schema, tested in the brainstorm spike):

```sql
-- Schema v1 of a gemm-bench host database. The Rust tool applies it to a new
-- file; `gemm-bench validate` compares a DB's stored DDL with it byte for
-- byte; the dashboard's tests build fixture DBs from it. Every feature used
-- must exist in sql.js's SQLite (3.49.1).
PRAGMA application_id = 0x47454d4d;  -- 'GEMM': marks the file as a gemm-bench DB
PRAGMA user_version = 1;             -- schema version; 0 = empty file

-- One row per `gemm-bench` invocation: provenance, build, and the machine as it was then.
CREATE TABLE runs (
  run_id                INTEGER PRIMARY KEY,
  started_at            TEXT    NOT NULL UNIQUE CHECK (started_at GLOB
                          '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z'),
  commit_id             TEXT    NOT NULL CHECK (commit_id <> ''),
  rustc_version         TEXT    NOT NULL CHECK (rustc_version <> ''),
  repetitions           INTEGER NOT NULL CHECK (repetitions > 0),
  os                    TEXT    NOT NULL CHECK (os <> ''),
  arch                  TEXT    NOT NULL CHECK (arch GLOB '[a-z]*' AND arch NOT GLOB '*[^a-z0-9_]*'),
  target_features       TEXT    NOT NULL CHECK (target_features NOT GLOB '*[^a-z0-9._ ]*'),
  cpu                   TEXT    NOT NULL CHECK (cpu <> ''),
  available_parallelism INTEGER NOT NULL CHECK (available_parallelism > 0),
  gpu                   TEXT    CHECK (gpu <> ''),
  gpu_cores             INTEGER CHECK (gpu_cores > 0),
  CHECK (gpu IS NOT NULL OR gpu_cores IS NULL)
) STRICT;

-- One row per kind of core, fastest first (Apple's perflevel0 = tier 0).
CREATE TABLE core_tiers (
  run_id       INTEGER NOT NULL REFERENCES runs ON DELETE CASCADE,
  tier         INTEGER NOT NULL CHECK (tier >= 0),
  name         TEXT    CHECK (name <> ''),
  cores        INTEGER NOT NULL CHECK (cores > 0),
  logical_cpus INTEGER NOT NULL CHECK (logical_cpus >= cores),
  PRIMARY KEY (run_id, tier)
) STRICT, WITHOUT ROWID;

-- One row per distinct cache configuration. tier NULL = shared across tiers.
CREATE TABLE caches (
  run_id     INTEGER NOT NULL REFERENCES runs ON DELETE CASCADE,
  tier       INTEGER,
  level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
  kind       TEXT    NOT NULL CHECK (kind IN ('data', 'instruction', 'unified')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  line_bytes INTEGER CHECK (line_bytes > 0),
  shared_by  INTEGER NOT NULL CHECK (shared_by > 0),   -- logical CPUs per instance
  instances  INTEGER NOT NULL CHECK (instances > 0),
  FOREIGN KEY (run_id, tier) REFERENCES core_tiers ON DELETE CASCADE
) STRICT;
CREATE UNIQUE INDEX caches_unique ON caches (run_id, coalesce(tier, -1), level, kind, size_bytes, shared_by);

CREATE TABLE measurements (
  measurement_id     INTEGER PRIMARY KEY,
  run_id             INTEGER NOT NULL REFERENCES runs ON DELETE CASCADE,
  kernel             TEXT    NOT NULL CHECK (kernel GLOB '[a-z]*' AND kernel NOT GLOB '*[^a-z0-9-]*'),
  backend            TEXT    NOT NULL CHECK (backend IN ('cpu', 'matrix', 'metal')),
  precision          TEXT    NOT NULL CHECK (precision IN ('f16', 'f32', 'f64', 'i32', 'i64')),
  n                  INTEGER NOT NULL CHECK (n > 0),
  threads            INTEGER NOT NULL CHECK (threads > 0),
  gops               REAL    NOT NULL CHECK (gops > 0),
  mean_rel_error_f64 REAL    CHECK (mean_rel_error_f64 >= 0),  -- NULL = NaN, +Inf = kernel produced NaN
  median_ms          REAL    NOT NULL CHECK (median_ms >= 0),
  min_ms             REAL    NOT NULL CHECK (min_ms >= 0 AND min_ms <= median_ms),
  stddev_ms          REAL    NOT NULL CHECK (stddev_ms >= 0),
  gpu_ms             REAL    CHECK (gpu_ms >= 0),
  setup_ms           REAL    NOT NULL CHECK (setup_ms >= 0),
  CHECK ((backend = 'metal') = (gpu_ms IS NOT NULL))
) STRICT;

CREATE TABLE params (
  measurement_id INTEGER NOT NULL REFERENCES measurements ON DELETE CASCADE,
  name           TEXT    NOT NULL CHECK (name GLOB '[a-z]*' AND name NOT GLOB '*[^a-z_]*'),
  value          INTEGER NOT NULL CHECK (value > 0),
  source         TEXT    NOT NULL CHECK (source IN ('swept', 'derived', 'fixed')),
  PRIMARY KEY (measurement_id, name)
) STRICT, WITHOUT ROWID;
```

Run: `cargo add rusqlite@0.40 --features bundled --manifest-path benchmark/Cargo.toml && cargo remove csv --manifest-path benchmark/Cargo.toml`

- [ ] **Step 2: Write the failing tests**

Create `benchmark/src/db.rs` with only its test support and tests:

```rust
/// A machine, a run context and one run's records, shared by the writer's
/// and `validate`'s tests.
#[cfg(test)]
pub(crate) mod fixtures {
    use gemm_bench::{GemmKernel, kernels::PackedGemm};

    use crate::{
        benchmark::BenchmarkRecord,
        context::RunContext,
        machine::{Cache, CacheKind, CoreTier, Machine},
    };

    pub(crate) fn machine() -> Machine {
        Machine {
            os: "macOS 27.0.1".to_owned(),
            arch: "aarch64",
            target_features: "dotprod fp16 neon".to_owned(),
            rustc_version: "rustc 1.101.0-nightly",
            cpu: "Apple M1 Pro".to_owned(),
            available_parallelism: 10,
            gpu: Some("Apple M1 Pro".to_owned()),
            gpu_cores: Some(16),
            tiers: vec![CoreTier { tier: 0, name: Some("Performance".to_owned()), cores: 8, logical_cpus: 8 }],
            caches: vec![Cache {
                tier: Some(0),
                level: 2,
                kind: CacheKind::Unified,
                size_bytes: 12 << 20,
                line_bytes: Some(128),
                shared_by: 4,
                instances: 2,
            }],
        }
    }

    pub(crate) fn context(started_at: &str) -> RunContext {
        RunContext { commit: "abc1234".to_owned(), timestamp: started_at.to_owned() }
    }

    /// A CPU kernel with no params, `packed` with the params it really
    /// reports, and a Metal kernel with `gpu_ms`.
    pub(crate) fn records() -> Vec<BenchmarkRecord> {
        let base = |kernel: &str, backend: &'static str| BenchmarkRecord {
            kernel: kernel.to_owned(),
            backend,
            precision: "f32",
            n: 64,
            threads: 1,
            gops: 10.0,
            mean_rel_error_f64: 1e-7,
            median_ms: 0.05,
            min_ms: 0.05,
            stddev_ms: 0.001,
            gpu_ms: None,
            setup_ms: 0.0,
            params: Vec::new(),
        };
        vec![
            base("ikj", "cpu"),
            BenchmarkRecord {
                params: GemmKernel::<f32>::params(&PackedGemm::new(256), 64),
                ..base("packed", "cpu")
            },
            BenchmarkRecord { gpu_ms: Some(0.02), ..base("mps", "metal") },
        ]
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::{Path, PathBuf}};

    use rusqlite::Connection;

    use super::{APPLICATION_ID, SCHEMA_VERSION, fixtures, open_for_run, validate_db_path, write_run};
    use crate::benchmark::BenchmarkRecord;

    /// A fresh `<name>/run.sqlite` under the temp dir; parents not yet created.
    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gemm-bench-db-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("nested/run.sqlite")
    }

    fn count(db: &Connection, table: &str) -> i64 {
        db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row.get(0)).expect("count")
    }

    #[test]
    fn a_new_file_gets_the_schema_and_its_stamps() {
        let path = temp_db("new");
        let db = open_for_run(&path, "2026-10-02T10:00:00Z").expect("a new DB opens");
        let pragma = |name| db.pragma_query_value(None, name, |row| row.get::<_, i64>(0)).expect(name);
        assert_eq!(pragma("application_id"), APPLICATION_ID);
        assert_eq!(pragma("user_version"), SCHEMA_VERSION);
        assert_eq!(count(&db, "runs"), 0);
    }

    #[test]
    fn a_run_is_written_whole_with_its_machine_and_params() {
        let path = temp_db("round-trip");
        let mut db = open_for_run(&path, "2026-10-02T10:00:00Z").expect("open");
        let mut records = fixtures::records();
        records.push(BenchmarkRecord {
            gops: f64::INFINITY,
            mean_rel_error_f64: f64::NAN,
            n: 128,
            ..fixtures::records().remove(0)
        });
        write_run(&mut db, &fixtures::context("2026-10-02T10:00:00Z"), 5, &fixtures::machine(), &records)
            .expect("write");

        assert_eq!(
            (count(&db, "runs"), count(&db, "core_tiers"), count(&db, "caches")),
            (1, 1, 1)
        );
        assert_eq!(count(&db, "measurements"), 4);
        assert_eq!(count(&db, "params"), 5, "packed's five params");
        let (gops, error): (f64, Option<f64>) = db
            .query_row("SELECT gops, mean_rel_error_f64 FROM measurements WHERE n = 128", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .expect("the +Inf row");
        assert_eq!((gops, error), (f64::INFINITY, None), "+Inf kept, NaN stored as NULL");
        let gpu_ms: Option<f64> = db
            .query_row("SELECT gpu_ms FROM measurements WHERE kernel = 'mps'", [], |row| row.get(0))
            .expect("the mps row");
        assert_eq!(gpu_ms, Some(0.02));
    }

    #[test]
    fn a_second_run_is_added_and_its_start_time_cannot_repeat() {
        let path = temp_db("append");
        for at in ["2026-10-02T10:00:00Z", "2026-10-02T11:00:00Z"] {
            let mut db = open_for_run(&path, at).expect("open");
            write_run(&mut db, &fixtures::context(at), 5, &fixtures::machine(), &fixtures::records())
                .expect("write");
        }
        let db = Connection::open(&path).expect("reopen");
        assert_eq!(count(&db, "runs"), 2);
        let error = open_for_run(&path, "2026-10-02T11:00:00Z").expect_err("a repeated start time");
        assert!(error.contains("already holds a run"), "{error}");
    }

    #[test]
    fn files_that_are_not_gemm_bench_v1_dbs_are_refused() {
        let foreign = temp_db("foreign");
        fs::create_dir_all(foreign.parent().expect("parent")).expect("dirs");
        Connection::open(&foreign).expect("create").execute_batch("CREATE TABLE notes (x)").expect("table");
        let error = open_for_run(&foreign, "2026-10-02T10:00:00Z").expect_err("another app's DB");
        assert!(error.contains("not a gemm-bench database"), "{error}");

        let text = foreign.with_file_name("text.sqlite");
        fs::write(&text, "hello, this is not a database at all, just some bytes").expect("write");
        let error = open_for_run(&text, "2026-10-02T10:00:00Z").expect_err("a text file");
        assert!(error.contains("not an SQLite database"), "{error}");

        let newer = temp_db("newer");
        drop(open_for_run(&newer, "2026-10-02T10:00:00Z").expect("open"));
        Connection::open(&newer).expect("reopen").execute_batch("PRAGMA user_version = 2").expect("bump");
        let error = open_for_run(&newer, "2026-10-02T11:00:00Z").expect_err("a newer schema");
        assert!(error.contains("schema version 2"), "{error}");
    }

    #[test]
    fn output_paths_must_name_a_sqlite_file() {
        validate_db_path(Path::new("results.sqlite")).expect("lowercase");
        validate_db_path(Path::new("data/results.SQLITE")).expect("uppercase");
        for path in ["results", "data/results.csv", ""] {
            let error = validate_db_path(Path::new(path)).expect_err("not .sqlite");
            assert!(error.contains(".sqlite"), "{path}: {error}");
        }
        let dir = temp_db("dir");
        fs::create_dir_all(&dir).expect("a directory named like a DB");
        assert!(validate_db_path(&dir).expect_err("a directory").contains("existing directory"));
    }

    #[test]
    fn a_parent_that_is_a_file_fails_before_running() {
        let blocker = temp_db("blocker").with_file_name("blocker");
        fs::create_dir_all(blocker.parent().expect("parent")).expect("dirs");
        fs::write(&blocker, b"").expect("a regular file");
        let error = open_for_run(&blocker.join("run.sqlite"), "2026-10-02T10:00:00Z")
            .expect_err("a file cannot be a parent directory");
        assert!(error.contains("output directory"), "{error}");
    }
}
```

Add `mod db;` to `benchmark/src/main.rs`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --bin gemm-bench db`
Expected: compile errors, because `open_for_run`, `write_run`, the constants and `validate_db_path` don't exist, and `BenchmarkRecord` still has the CSV fields.

- [ ] **Step 4: Write `db.rs` above its test support**

```rust
//! The host database: `data/schema.sql` applied to a new file, checked before
//! any kernel runs, and one transaction per run.

use std::{ffi::OsStr, fs, path::Path};

use rusqlite::{Connection, OptionalExtension, params};

use crate::{benchmark::BenchmarkRecord, context::RunContext, machine::Machine};

/// Schema v1, the only version: see the spec before changing it.
pub(crate) const SCHEMA: &str = include_str!("../../data/schema.sql");
/// 'GEMM', the `application_id` of every gemm-bench database.
pub(crate) const APPLICATION_ID: i64 = 0x4745_4d4d;
/// The `user_version` this tool writes and validates.
pub(crate) const SCHEMA_VERSION: i64 = 1;

/// `--output` names the database file itself.
pub(crate) fn validate_db_path(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        return Err(format!(
            "output path '{}' is an existing directory; --output must name a .sqlite file",
            path.display()
        ));
    }
    let is_sqlite = path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("sqlite"));
    if !is_sqlite {
        return Err(format!("--output must be a .sqlite file path (got '{}')", path.display()));
    }
    Ok(())
}

/// Opens `path` for a run starting at `started_at`, before any kernel runs:
/// creates missing directories, applies the schema to a new file, and refuses
/// anything that isn't a gemm-bench v1 database or already holds a run that
/// started at the same second.
pub(crate) fn open_for_run(path: &Path, started_at: &str) -> Result<Connection, String> {
    validate_db_path(path)?;
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|error| {
            format!("cannot create output directory '{}': {error}", parent.display())
        })?;
    }
    let shown = path.display();
    let mut db = Connection::open(path).map_err(|error| format!("cannot open '{shown}': {error}"))?;
    let not_sqlite = |error: rusqlite::Error| format!("'{shown}' is not an SQLite database: {error}");
    db.pragma_update(None, "foreign_keys", true).map_err(not_sqlite)?;
    let pragma = |db: &Connection, name: &str| db.pragma_query_value(None, name, |row| row.get::<_, i64>(0));
    let version = pragma(&db, "user_version").map_err(not_sqlite)?;
    let objects: i64 = db
        .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))
        .map_err(not_sqlite)?;
    match version {
        0 if objects == 0 => {
            let tx = db.transaction().map_err(|error| error.to_string())?;
            tx.execute_batch(SCHEMA).map_err(|error| format!("cannot create '{shown}': {error}"))?;
            tx.commit().map_err(|error| error.to_string())?;
        }
        SCHEMA_VERSION if pragma(&db, "application_id").map_err(not_sqlite)? == APPLICATION_ID => {}
        0 | SCHEMA_VERSION => {
            return Err(format!("'{shown}' is an SQLite file, but not a gemm-bench database"));
        }
        other => {
            return Err(format!(
                "'{shown}' has schema version {other}; this tool writes version {SCHEMA_VERSION}"
            ));
        }
    }
    let taken = db
        .query_row("SELECT 1 FROM runs WHERE started_at = ?1", [started_at], |_| Ok(()))
        .optional()
        .map_err(|error| error.to_string())?;
    if taken.is_some() {
        return Err(format!("'{shown}' already holds a run started at {started_at}"));
    }
    Ok(db)
}

/// Adds a run, its machine and every measurement in one transaction: a
/// failure leaves the database as it was.
pub(crate) fn write_run(
    db: &mut Connection,
    context: &RunContext,
    repetitions: usize,
    machine: &Machine,
    records: &[BenchmarkRecord],
) -> rusqlite::Result<()> {
    let tx = db.transaction()?;
    tx.execute(
        "INSERT INTO runs (started_at, commit_id, rustc_version, repetitions, os, arch,
                           target_features, cpu, available_parallelism, gpu, gpu_cores)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            context.timestamp,
            context.commit,
            machine.rustc_version,
            int(repetitions),
            machine.os,
            machine.arch,
            machine.target_features,
            machine.cpu,
            int(machine.available_parallelism),
            machine.gpu,
            machine.gpu_cores.map(int),
        ],
    )?;
    let run_id = tx.last_insert_rowid();
    for tier in &machine.tiers {
        tx.execute(
            "INSERT INTO core_tiers (run_id, tier, name, cores, logical_cpus) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![run_id, int(tier.tier), tier.name, int(tier.cores), int(tier.logical_cpus)],
        )?;
    }
    for cache in &machine.caches {
        tx.execute(
            "INSERT INTO caches (run_id, tier, level, kind, size_bytes, line_bytes, shared_by, instances)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                run_id,
                cache.tier.map(int),
                int(cache.level),
                cache.kind.label(),
                int(cache.size_bytes),
                cache.line_bytes.map(int),
                int(cache.shared_by),
                int(cache.instances),
            ],
        )?;
    }
    {
        let mut measurement = tx.prepare(
            "INSERT INTO measurements (run_id, kernel, backend, precision, n, threads, gops,
                                       mean_rel_error_f64, median_ms, min_ms, stddev_ms, gpu_ms, setup_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )?;
        let mut param =
            tx.prepare("INSERT INTO params (measurement_id, name, value, source) VALUES (?1, ?2, ?3, ?4)")?;
        for record in records {
            // A NaN error binds as NULL (SQLite has no NaN); +Inf is kept.
            measurement.execute(params![
                run_id,
                record.kernel,
                record.backend,
                record.precision,
                int(record.n),
                int(record.threads),
                record.gops,
                record.mean_rel_error_f64,
                record.median_ms,
                record.min_ms,
                record.stddev_ms,
                record.gpu_ms,
                record.setup_ms,
            ])?;
            let measurement_id = tx.last_insert_rowid();
            for p in &record.params {
                param.execute(params![measurement_id, p.name, int(p.value), p.source.label()])?;
            }
        }
    }
    tx.commit()
}

/// SQLite integers are i64; every count and size the harness records fits.
fn int(value: usize) -> i64 {
    i64::try_from(value).expect("counts and sizes fit in an i64")
}
```

- [ ] **Step 5: Slim the record and the context, and wire the plan and `main`**

`benchmark/src/benchmark.rs`:
- **Record:** in `BenchmarkRecord`, delete the fields `device`, `block_size`, `repetitions`, `host`, `commit` and `timestamp`, the `#[derive(Serialize)]` (keep `Debug`), the `#[serde(skip)]` on `params`, and the `use serde::Serialize;` import. Update the struct's doc comment to `/// One measured configuration, shared by the terminal table and the DB writer.`
- **`run_precision`:** delete those six fields from the `BenchmarkRecord { … }` literal.
- **`run_one` test:** in its temp output name, change `.csv` to `.sqlite`.

`benchmark/src/context.rs`:
- **`RunContext`:** delete the `host` and `file_stamp` fields, and in `capture` delete the `host:` and `file_stamp:` initialisers. Update the doc comment to `/// Looks up the commit and reads the clock.`
- **Helpers:** delete `short_host` and `file_stamp`, along with their tests (`short_host_drops_the_domain`, `file_stamp_is_a_compact_sortable_utc_instant`).
- **`capture_fills_every_field`:** keep only the `commit` and `timestamp` assertions.

`benchmark/src/plan.rs`: replace the file with:

```rust
use std::path::PathBuf;

use rusqlite::Connection;

use crate::context::RunContext;
use crate::kernel::{KernelChoice, Knob, Precision};
use crate::machine::Machine;

/// Fully resolved configuration used by the benchmark runner.
#[derive(Debug)]
pub(crate) struct BenchmarkPlan {
    pub(crate) sizes: Vec<usize>,
    pub(crate) threads: Vec<usize>,
    pub(crate) kernels: Vec<KernelChoice>,
    pub(crate) precisions: Vec<Precision>,
    pub(crate) repetitions: usize,
    pub(crate) tile_sizes: Vec<usize>,
    pub(crate) depth_blocks: Vec<usize>,
    pub(crate) context: RunContext,
    /// The machine as it is now, recorded with the run.
    pub(crate) machine: Machine,
    /// Opened and checked before any kernel runs; the run is written into it.
    pub(crate) db: Connection,
    pub(crate) output_path: PathBuf,
    pub(crate) no_progress: bool,
    /// One line per group of skipped cells, printed before the run.
    pub(crate) skipped: Vec<String>,
}
```

Keep the existing `impl BenchmarkPlan` with `cells`, `total_configurations` and `knob_values` unchanged below it. Delete `Devices`, its `impl`, and its test module.

`benchmark/src/cli.rs`:
- **Imports:** replace `use crate::plan::{BenchmarkPlan, Devices};` with `use crate::plan::BenchmarkPlan;`, and add `use crate::{db, host, machine::Machine};`. Drop `fs`, `File`, `OpenOptions` and `OsStr` from the `std` import if nothing else uses them (the compiler will say).
- **`output` field:** change the doc comment to `/// Output database. Defaults to data/db/<login>/<machine>.sqlite for the host id in .host (set once with just init); runs are added to an existing file.`
- **`into_plan`:** replace everything from `let context = context::capture();` through `let output = open_output(&output_path)?;` with:

```rust
        let context = context::capture();
        let machine = Machine::capture();
        let output_path = match self.output {
            Some(path) => path,
            None => host::db_path(&host::read_host_file(Path::new(host::HOST_FILE))?),
        };
        let db = db::open_for_run(&output_path, &context.timestamp)?;
```

  In the `BenchmarkPlan { … }` literal, replace `devices, output,` with `machine, db,`.
- **Output helpers:** delete `default_output_path`, `validate_output_path` and `open_output`.
- **Tests:**
  - **Temp paths:** in `temp_output`, change `.csv` to `.sqlite`.
  - **Moved tests:** delete `default_output_is_a_new_file_per_run_under_the_host`, `output_accepts_csv_in_any_case`, `output_without_a_csv_extension_is_rejected`, `output_as_existing_directory_is_rejected`, `unusable_output_paths_are_rejected_before_running` and `existing_output_is_not_truncated_until_records_are_written`. Their replacements now live in `db.rs` and `host.rs`.
  - **`missing_output_directories_are_created_before_running`:** keep it, with `results.sqlite` in place of `results.csv`.
  - **Use import:** remove `default_output_path, open_output, validate_output_path` from the tests' `use super::{…}`.
  - **`omitted_dimensions_sweep_every_value`:** delete `assert!(!plan.context.host.is_empty());`.
  - **`mps_parses_as_a_kernel_choice`:** replace the `plan.devices.metal` assertion with `assert!(plan.machine.gpu.is_some(), "a Mac with Metal must name its GPU");`.
  - **`metal_shader_kernels_run_every_gpu_precision_on_the_gpu`:** replace both `devices` assertions with the same `plan.machine.gpu.is_some()` assertion.

`benchmark/src/report.rs`:
- **CSV writer:** delete `write_records`, its test `write_records_outputs_csv_in_schema_order`, and the `File`/`Seek` imports it used.
- **Test fixture:** in the tests' `record()`, delete the six removed fields. The terminal table already reads `params` (Task 2).

`benchmark/src/main.rs`:
- **Module attributes:** delete the two `#[allow(dead_code, …)]` attributes from Tasks 4 and 5. Keep `mod db;`, `mod host;` and `mod machine;`.
- **`main`:** replace the tail of `main` from `report::print_results_table(&records);` on with:

```rust
    report::print_results_table(&records);
    db::write_run(&mut plan.db, &plan.context, plan.repetitions, &plan.machine, &records)?;
    eprintln!(
        "Wrote {} measurements to {}",
        records.len(),
        plan.output_path.display()
    );
    Ok(())
```

  and change `let plan = cli.into_plan()?;` to `let mut plan = cli.into_plan()?;`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: PASS. Every module is now reachable from `main`, so no `dead_code` is left.

- [ ] **Step 7: Try a real run**

```bash
just init paulhondola/m1pro
just bench --config configs/quick.toml --no-progress --output /tmp/gemm-quick.sqlite
sqlite3 /tmp/gemm-quick.sqlite "SELECT count(*) FROM runs; SELECT kernel, count(*) FROM measurements GROUP BY kernel; SELECT name, value, source FROM params LIMIT 5; SELECT * FROM core_tiers; SELECT * FROM caches;"
```

Expected:
- One run, and a measurement count for every kernel.
- `params` rows such as `tile_size|64|swept`.
- Two core tiers (`Performance`, `Efficiency`) and six cache rows.

Remove `/tmp/gemm-quick.sqlite` afterwards. Do **not** write to `data/db/` yet. The first committed database comes from the full sweep in Task 14.

- [ ] **Step 8: Lint and commit**

Run: `just lint && just check-bench`

```bash
git add data/schema.sql benchmark
git commit -m "Write each run to the host's SQLite database in one transaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `gemm-bench validate`

**Files:**
- Create: `benchmark/src/validate.rs`
- Modify: `benchmark/src/kernel.rs`, `benchmark/src/benchmark.rs`, `benchmark/src/host.rs`, `benchmark/src/cli.rs`, `benchmark/src/main.rs`

**Interfaces:**
- Consumes:
  - From Task 6: `db::{SCHEMA, APPLICATION_ID, SCHEMA_VERSION, open_for_run, write_run, fixtures}`.
  - From Task 5: `host::host_of_db_path`.
  - From Task 3: `Knob`, `KernelChoice::knob`.
  - From Task 1: `Param`, `Source` and `GemmKernel::params`.
- Produces:
  - `KernelChoice::ALL: [KernelChoice; 14]` and `KernelChoice::from_label(&str) -> Option<KernelChoice>`. Every kernel is known on every platform; the Apple-only ones are `value(skip)` off macOS.
  - `KernelChoice::declared_params(self) -> Vec<(&'static str, Source)>`, sorted by name, from new `KernelInfo.derived`/`fixed` lists.
  - `host::host_of_db_path(&Path) -> Option<String>`.
  - `validate::validate(&Path) -> Result<(), String>`.
  - `validate::validate_all(&[PathBuf]) -> Result<(), String>`.
  - `cli::Command::Validate { dbs: Vec<PathBuf> }`, with `Cli.command: Option<Command>`.

These are the first non-test readers of the kernel *declarations*, so the declarations land here too. `validate` must recognise Mac-recorded kernels on Linux CI, so the macOS kernels stop being removed by `#[cfg]` here too: they become `value(skip)`, hidden from the CLI but known to the vocabulary.

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/kernel.rs`'s `mod tests`, add `use gemm_bench::kernels::Source;` and change `use super::KernelChoice;` to `use super::{KernelChoice, Knob};` (then drop the `use super::Knob;` line inside Task 3's test). Replace `every_kernel_names_its_backend` with this version, which covers every kernel on every platform:

```rust
    #[test]
    fn every_kernel_names_its_backend() {
        for kernel in KernelChoice::ALL {
            let expected = match kernel {
                KernelChoice::Mps | KernelChoice::MetalNaive | KernelChoice::MetalTiled => "metal",
                KernelChoice::AccelerateBlas | KernelChoice::AccelerateBnns => "matrix",
                _ => "cpu",
            };
            assert_eq!(kernel.backend(), expected, "{}", kernel.label());
        }
    }
```

Add:

```rust
    #[test]
    fn all_kernels_are_known_everywhere_but_offered_only_where_they_run() {
        assert_eq!(KernelChoice::ALL.len(), 14);
        let offered = KernelChoice::value_variants();
        if cfg!(target_os = "macos") {
            assert_eq!(offered, &KernelChoice::ALL[..]);
        } else {
            assert_eq!(offered.len(), 9);
            assert!(offered.iter().all(|kernel| kernel.backend() == "cpu"));
        }
    }

    #[test]
    fn labels_round_trip() {
        for kernel in KernelChoice::ALL {
            assert_eq!(KernelChoice::from_label(kernel.label()), Some(kernel));
        }
        assert_eq!(KernelChoice::from_label("warp-drive"), None);
    }

    #[test]
    fn a_kernels_knob_is_its_only_swept_param() {
        for kernel in KernelChoice::ALL {
            let swept: Vec<&str> = kernel
                .declared_params()
                .into_iter()
                .filter(|&(_, source)| source == Source::Swept)
                .map(|(name, _)| name)
                .collect();
            let knob: Vec<&str> = kernel.knob().map(Knob::name).into_iter().collect();
            assert_eq!(swept, knob, "{}", kernel.label());
        }
    }
```

In `benchmark/src/benchmark.rs`'s `mod tests`, make the `gemm_bench` import `use gemm_bench::{Element, GemmKernel, kernels::{IkjGemm, Param, Source}};`, add `use clap::ValueEnum;` and `use crate::kernel::Precision;`, and append:

```rust
    /// The params one real measurement of `kernel` reports, at 2 threads and
    /// its knob's smallest default value.
    fn params_at(kernel: KernelChoice, precision: Precision, n: usize) -> Vec<Param> {
        fn at<T: Element>(kernel: KernelChoice, n: usize) -> Vec<Param> {
            let (lhs, rhs) = benchmark_inputs::<T>(n);
            let mut output = Matrix::zeros(n, n);
            let knob = kernel.knob().map(|knob| knob.defaults()[0]);
            measure(kernel, 2, knob, 1, &lhs, &rhs, &mut output)
                .expect("the kernel should run")
                .params
        }
        match precision {
            Precision::F16 => at::<f16>(kernel, n),
            Precision::F32 => at::<f32>(kernel, n),
            Precision::F64 => at::<f64>(kernel, n),
            Precision::I32 => at::<i32>(kernel, n),
            Precision::I64 => at::<i64>(kernel, n),
        }
    }

    /// `validate` trusts `declared_params` for DBs it never saw being written,
    /// so every kernel must report exactly what it declares.
    #[test]
    fn every_kernel_records_exactly_the_params_it_declares() {
        for &kernel in KernelChoice::value_variants() {
            #[cfg(target_os = "macos")]
            if kernel == KernelChoice::AccelerateBnns
                && gemm_bench::kernels::AccelerateBnnsGemm::<f32>::new(1).is_none()
            {
                continue; // needs macOS 26
            }
            for &precision in Precision::value_variants() {
                if !kernel.supports(precision) {
                    continue;
                }
                for n in [8, 33] {
                    let mut recorded: Vec<(&str, Source)> = params_at(kernel, precision, n)
                        .iter()
                        .map(|p| (p.name, p.source))
                        .collect();
                    recorded.sort_unstable_by_key(|&(name, _)| name);
                    assert_eq!(
                        recorded,
                        kernel.declared_params(),
                        "{} at {} with n = {n}",
                        kernel.label(),
                        precision.label()
                    );
                }
            }
        }
    }
```

In `benchmark/src/host.rs`'s tests, add `host_of_db_path` to the `use super::{…}` list and append:

```rust
    #[test]
    fn a_committed_db_path_names_its_host() {
        assert_eq!(host_of_db_path(Path::new("data/db/octocat/m1pro.sqlite")).as_deref(), Some("octocat/m1pro"));
        assert_eq!(host_of_db_path(Path::new("/repo/data/db/octocat/m1pro.sqlite")).as_deref(), Some("octocat/m1pro"));
        for path in ["data/db/m1pro.sqlite", "data/db/octocat/m1pro.db", "data/x/octocat/m1pro.sqlite", "data/db/Octo/m1.sqlite"] {
            assert_eq!(host_of_db_path(Path::new(path)), None, "{path}");
        }
    }
```

Create `benchmark/src/validate.rs` with only its tests:

```rust
#[cfg(test)]
mod tests {
    use std::{fs, path::{Path, PathBuf}};

    use rusqlite::Connection;

    use super::{validate, validate_all};
    use crate::db::{self, fixtures};

    /// A valid DB at `<tmp>/<name>/data/db/octocat/m1pro.sqlite`, written by
    /// the real writer.
    fn valid_db(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("gemm-bench-validate-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let path = root.join("data/db/octocat/m1pro.sqlite");
        let at = "2026-10-02T10:00:00Z";
        let mut db = db::open_for_run(&path, at).expect("open");
        db::write_run(&mut db, &fixtures::context(at), 5, &fixtures::machine(), &fixtures::records())
            .expect("write");
        path
    }

    /// The reason a valid DB fails once `sql` has run on it.
    fn failure(name: &str, sql: &str) -> String {
        let path = valid_db(name);
        Connection::open(&path).expect("open").execute_batch(sql).expect("mutate");
        validate(&path).expect_err("the mutated DB must fail")
    }

    #[test]
    fn a_db_the_tool_wrote_passes() {
        validate(&valid_db("ok")).expect("a written DB is valid");
    }

    #[test]
    fn the_path_must_name_a_host() {
        let valid = valid_db("path");
        // data/db/m1pro.sqlite: no login folder.
        let stray = valid.parent().and_then(Path::parent).expect("data/db").join("m1pro.sqlite");
        fs::copy(&valid, &stray).expect("copy");
        assert!(validate(&stray).expect_err("not under a login").contains("data/db/<github-login>/<machine>.sqlite"));
    }

    #[test]
    fn an_oversized_file_fails_before_it_is_opened() {
        let path = valid_db("big");
        fs::write(&path, vec![0_u8; 17 << 20]).expect("17 MB");
        assert!(validate(&path).expect_err("too big").contains("limit"));
    }

    #[test]
    fn stamps_must_say_gemm_bench_v1() {
        assert!(failure("app-id", "PRAGMA application_id = 1").contains("application_id"));
        assert!(failure("version", "PRAGMA user_version = 2").contains("schema version 2"));
    }

    #[test]
    fn the_stored_ddl_must_match_schema_sql() {
        assert!(failure("trigger", "CREATE TRIGGER t AFTER INSERT ON runs BEGIN SELECT 1; END").contains("\"t\""));
        let path = valid_db("stripped");
        fs::remove_file(&path).expect("remove");
        let stripped = Connection::open(&path).expect("create");
        stripped.execute_batch(&db::SCHEMA.replace(" CHECK (value > 0)", "")).expect("schema without a CHECK");
        let error = validate(&path).expect_err("a stripped CHECK");
        assert!(error.contains("\"params\"") && error.contains("differs"), "{error}");
    }

    #[test]
    fn kernels_must_be_known_on_their_backend_and_precision() {
        assert!(failure("unknown", "UPDATE measurements SET kernel = 'warp-drive' WHERE kernel = 'ikj'").contains("unknown kernel"));
        assert!(failure("backend", "UPDATE measurements SET backend = 'matrix' WHERE kernel = 'ikj'").contains("ikj runs on cpu"));
        assert!(failure("precision", "UPDATE measurements SET precision = 'f64' WHERE kernel = 'mps'").contains("mps does not run at"));
        assert!(failure("threads", "UPDATE measurements SET threads = 4 WHERE kernel = 'ikj'").contains("one caller thread"));
        assert!(failure("gpu", "UPDATE runs SET gpu = NULL, gpu_cores = NULL").contains("recorded no GPU"));
    }

    #[test]
    fn params_must_be_exactly_the_declared_ones() {
        let undeclared = "INSERT INTO params SELECT measurement_id, 'mystery', 1, 'derived' FROM measurements WHERE kernel = 'ikj'";
        assert!(failure("undeclared", undeclared).contains("declares"));
        assert!(failure("missing", "DELETE FROM params WHERE name = 'register_rows'").contains("declares"));
        assert!(failure("source", "UPDATE params SET source = 'derived' WHERE name = 'register_rows'").contains("declares"));
    }

    #[test]
    fn a_cell_appears_once_per_run() {
        let twice = "INSERT INTO measurements (run_id, kernel, backend, precision, n, threads, gops, median_ms, min_ms, stddev_ms, setup_ms)
                     SELECT run_id, kernel, backend, precision, n, threads, gops, median_ms, min_ms, stddev_ms, setup_ms FROM measurements WHERE kernel = 'ikj'";
        assert!(failure("twice", twice).contains("twice"));
    }

    #[test]
    fn every_run_has_measurements_and_the_file_has_a_run() {
        let empty_run = "INSERT INTO runs (started_at, commit_id, rustc_version, repetitions, os, arch, target_features, cpu, available_parallelism)
                         VALUES ('2026-10-03T00:00:00Z', 'a', 'r', 1, 'o', 'aarch64', '', 'c', 1)";
        assert!(failure("empty-run", empty_run).contains("has no measurements"));
        assert!(failure("no-runs", "PRAGMA foreign_keys = ON; DELETE FROM runs").contains("no runs"));
    }

    #[test]
    fn free_text_must_be_short_and_printable() {
        assert!(failure("bell", "UPDATE runs SET cpu = 'Apple' || char(7) || 'M1'").contains("runs.cpu"));
        assert!(failure("long", "UPDATE runs SET os = printf('%.300c', 'x')").contains("runs.os"));
    }

    #[test]
    fn a_dangling_reference_fails() {
        let dangling = "PRAGMA foreign_keys = OFF; INSERT INTO params VALUES (999, 'tile_size', 16, 'swept')";
        assert!(failure("dangling", dangling).contains("does not exist"));
    }

    #[test]
    fn validate_all_checks_every_file_and_fails_if_any_does() {
        let good = valid_db("all-good");
        let bad = valid_db("all-bad");
        Connection::open(&bad).expect("open").execute_batch("PRAGMA user_version = 9").expect("bump");
        let error = validate_all(&[good, bad]).expect_err("one bad file");
        assert!(error.contains("1 of 2"), "{error}");
        assert!(validate_all(&[valid_db("all-ok")]).is_ok());
    }
}
```

In `benchmark/src/cli.rs`'s tests, add:

```rust
    #[test]
    fn validate_takes_database_paths_and_needs_one() {
        let cli = Cli::try_parse_from(["gemm-bench", "validate", "a.sqlite", "b.sqlite"]).expect("parses");
        assert!(matches!(cli.command, Some(super::Command::Validate { ref dbs }) if dbs.len() == 2));
        assert!(Cli::try_parse_from(["gemm-bench", "validate"]).is_err());
    }
```

Add `mod validate;` to `benchmark/src/main.rs`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml --bin gemm-bench`
Expected: compile errors. `ALL`, `from_label`, `declared_params`, `host_of_db_path`, `validate`, `validate_all` and `Command` don't exist.

- [ ] **Step 3: Make every kernel known everywhere, with its declared params**

Replace everything above `#[cfg(test)]` in `benchmark/src/kernel.rs` with the final vocabulary. It is Task 3's file plus `value(skip)`, `ALL`, `from_label`, and each kernel's `derived`/`fixed` lists:

```rust
//! The benchmark's vocabulary: which kernels exist, what each one sweeps,
//! which params it records, and which precisions it runs.

use clap::ValueEnum;
use gemm_bench::kernels::Source;

/// Every kernel, on every platform. Off macOS the Apple-only ones are
/// `value(skip)`: the CLI and the default sweep never see them, but
/// `validate` still knows them, since it checks DBs recorded on a Mac.
#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum KernelChoice {
    Naive,
    Ikj,
    Tiled,
    Packed,
    RayonIkj,
    RayonTiled,
    RayonPacked,
    StaticIkj,
    StaticTiled,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    AccelerateBlas,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    AccelerateBnns,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    Mps,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    MetalNaive,
    #[cfg_attr(not(target_os = "macos"), value(skip))]
    MetalTiled,
}

/// A knob swept from the command line besides `--threads`: one flag, one
/// default range, recorded under one `params.name`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Knob {
    /// Edge of the square cache tile of the tiled kernels.
    TileSize,
    /// Depth of each packed k-block of the packed kernels (BLIS's KC).
    DepthBlock,
}

impl Knob {
    /// The `params.name` it is recorded under.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::TileSize => "tile_size",
            Self::DepthBlock => "depth_block",
        }
    }

    /// Its CLI flag: the name in kebab case.
    pub(crate) fn flag(self) -> &'static str {
        match self {
            Self::TileSize => "--tile-size",
            Self::DepthBlock => "--depth-block",
        }
    }

    /// The progress bar's short form: BLIS's name where there is one.
    pub(crate) fn short(self) -> &'static str {
        match self {
            Self::TileSize => "tile",
            Self::DepthBlock => "kc",
        }
    }

    /// Swept when its flag is omitted. Tile 1024 hits the power-of-two
    /// aliasing cliff, and KC 16 and 32 measured 25–60% slower than KC 256.
    pub(crate) fn defaults(self) -> &'static [usize] {
        match self {
            Self::TileSize => &[16, 32, 64, 128, 256],
            Self::DepthBlock => &[64, 128, 256, 512, 1024],
        }
    }
}

/// Everything the harness needs to know about a kernel, in one row.
struct KernelInfo {
    /// The `kernel` column.
    label: &'static str,
    /// Hardware family: `cpu`, `matrix` (a matrix unit behind a vendor
    /// library: Apple's AMX, or Arm SME on M4 and later) or `metal`. Needed
    /// next to the device because Apple Silicon names its CPU and GPU alike.
    backend: &'static str,
    precisions: &'static [Precision],
    /// Sweeps `--threads`; the others run on one caller thread.
    workers: bool,
    /// The knob swept besides threads.
    // ponytail: one per kernel; sweep a cartesian product once a kernel needs two.
    knob: Option<Knob>,
    /// Params the kernel works out at run time.
    derived: &'static [&'static str],
    /// Params that are compile-time constants of the kernel.
    fixed: &'static [&'static str],
    /// Gives every worker at least one row, so needs `threads <= n`.
    row_per_worker: bool,
}

const PACKED_FIXED: &[&str] = &["register_rows", "register_col_vectors"];

impl KernelInfo {
    /// A single-threaded CPU kernel with no knobs, at every precision; each
    /// row in `KernelChoice::info` overrides what differs.
    fn serial(label: &'static str) -> Self {
        Self {
            label,
            backend: "cpu",
            precisions: Precision::value_variants(),
            workers: false,
            knob: None,
            derived: &[],
            fixed: &[],
            row_per_worker: false,
        }
    }
}

impl KernelChoice {
    /// Every kernel, including those `value(skip)` hides off macOS.
    pub(crate) const ALL: [Self; 14] = [
        Self::Naive,
        Self::Ikj,
        Self::Tiled,
        Self::Packed,
        Self::RayonIkj,
        Self::RayonTiled,
        Self::RayonPacked,
        Self::StaticIkj,
        Self::StaticTiled,
        Self::AccelerateBlas,
        Self::AccelerateBnns,
        Self::Mps,
        Self::MetalNaive,
        Self::MetalTiled,
    ];

    fn info(self) -> KernelInfo {
        use Precision::{F16, F32, F64, I32, I64};
        let serial = KernelInfo::serial;
        match self {
            Self::Naive => serial("naive-ijk"),
            Self::Ikj => serial("ikj"),
            Self::Tiled => KernelInfo {
                knob: Some(Knob::TileSize),
                ..serial("tiled")
            },
            Self::Packed => KernelInfo {
                knob: Some(Knob::DepthBlock),
                derived: &["depth_block_used", "register_cols"],
                fixed: PACKED_FIXED,
                ..serial("packed")
            },
            Self::RayonIkj => KernelInfo {
                workers: true,
                ..serial("rayon-ikj")
            },
            Self::RayonTiled => KernelInfo {
                workers: true,
                knob: Some(Knob::TileSize),
                derived: &["tasks", "rows_per_task"],
                fixed: &["tasks_per_worker"],
                ..serial("rayon-tiled")
            },
            Self::RayonPacked => KernelInfo {
                workers: true,
                knob: Some(Knob::DepthBlock),
                derived: &["depth_block_used", "register_cols", "row_strips"],
                fixed: PACKED_FIXED,
                ..serial("rayon-packed")
            },
            Self::StaticIkj => KernelInfo {
                workers: true,
                derived: &["max_rows_per_thread"],
                row_per_worker: true,
                ..serial("static-ikj")
            },
            Self::StaticTiled => KernelInfo {
                workers: true,
                knob: Some(Knob::TileSize),
                derived: &["max_rows_per_thread"],
                row_per_worker: true,
                ..serial("static-tiled")
            },
            // A matrix unit reached only through Accelerate, which picks its
            // own threading: one caller thread.
            Self::AccelerateBlas => KernelInfo {
                backend: "matrix",
                precisions: &[F32, F64],
                ..serial("accelerate-blas")
            },
            Self::AccelerateBnns => KernelInfo {
                backend: "matrix",
                precisions: &[F16, F32],
                ..serial("accelerate-bnns")
            },
            Self::Mps => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32],
                ..serial("mps")
            },
            // Hand-written shaders: MSL has half, float, int and long, but no double.
            Self::MetalNaive => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32, I32, I64],
                derived: &["threadgroup_width", "threadgroup_height", "threadgroups"],
                ..serial("metal-naive")
            },
            Self::MetalTiled => KernelInfo {
                backend: "metal",
                precisions: &[F16, F32, I32, I64],
                derived: &["threadgroups"],
                fixed: &["threadgroup_width", "threadgroup_height", "depth_step"],
                ..serial("metal-tiled")
            },
        }
    }

    /// The kernel recorded under `label`, on any platform.
    pub(crate) fn from_label(label: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kernel| kernel.label() == label)
    }

    pub(crate) fn label(self) -> &'static str {
        self.info().label
    }

    pub(crate) fn backend(self) -> &'static str {
        self.info().backend
    }

    pub(crate) fn uses_workers(self) -> bool {
        self.info().workers
    }

    /// The knob this kernel sweeps besides threads, if any.
    pub(crate) fn knob(self) -> Option<Knob> {
        self.info().knob
    }

    /// Every param this kernel records, with its source, sorted by name: what
    /// `validate` holds each stored measurement to.
    pub(crate) fn declared_params(self) -> Vec<(&'static str, Source)> {
        let info = self.info();
        let mut params: Vec<(&'static str, Source)> = info
            .knob
            .map(|knob| (knob.name(), Source::Swept))
            .into_iter()
            .chain(info.derived.iter().map(|&name| (name, Source::Derived)))
            .chain(info.fixed.iter().map(|&name| (name, Source::Fixed)))
            .collect();
        params.sort_unstable_by_key(|&(name, _)| name);
        params
    }

    /// Whether the kernel can run `threads` workers on `n` rows.
    pub(crate) fn fits(self, threads: usize, n: usize) -> bool {
        !self.info().row_per_worker || threads <= n
    }

    /// Whether this kernel can run at `precision`. With `fits`, the single
    /// source for skipping cells and rejecting a named kernel with nothing to
    /// run.
    pub(crate) fn supports(self, precision: Precision) -> bool {
        self.info().precisions.contains(&precision)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum Precision {
    F16,
    F32,
    F64,
    I32,
    I64,
}

impl Precision {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::F16 => "f16",
            Self::F32 => "f32",
            Self::F64 => "f64",
            Self::I32 => "i32",
            Self::I64 => "i64",
        }
    }
}
```

`web/src/lib/docs.test.ts` reads every kernel label from `serial("…")` in this file, so every kernel keeps going through `serial(…)` as shown.

In `benchmark/src/benchmark.rs`'s `measure`, keep the `#[cfg(target_os = "macos")]` on the five macOS arms, since their kernel types exist only there. Now that the variants exist on every platform, add this arm last:

```rust
        // `value(skip)` keeps these out of every plan off macOS.
        #[cfg(not(target_os = "macos"))]
        KernelChoice::AccelerateBlas
        | KernelChoice::AccelerateBnns
        | KernelChoice::Mps
        | KernelChoice::MetalNaive
        | KernelChoice::MetalTiled => unreachable!("{} runs only on macOS", choice.label()),
```

Leave every other `#[cfg(target_os = "macos")]` in `benchmark/src/` as it is. The tests it gates (planning `mps`, finding a Metal device) still need a Mac.

- [ ] **Step 4: Name the host a committed path belongs to**

Add to `benchmark/src/host.rs`:

```rust
/// The host a DB path names, if it ends in `data/db/<login>/<machine>.sqlite`.
pub(crate) fn host_of_db_path(path: &Path) -> Option<String> {
    let mut parts = path.components().rev().map(|part| part.as_os_str().to_str());
    let (file, login, db, data) = (parts.next()??, parts.next()??, parts.next()??, parts.next()??);
    let id = format!("{login}/{}", file.strip_suffix(".sqlite")?);
    (db == "db" && data == "data" && is_host_id(&id)).then_some(id)
}
```

- [ ] **Step 5: Write `validate.rs` above its tests**

```rust
//! `gemm-bench validate`: the gate every contributed database passes before
//! it merges. The schema's CHECKs bind only files our DDL created, so this
//! re-derives every guarantee from the file itself, and adds the rules that
//! span rows, which no CHECK can express.

use std::{
    fs,
    path::{Path, PathBuf},
};

use clap::ValueEnum;
use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::{
    db, host,
    kernel::{KernelChoice, Precision},
};

/// The largest database accepted: a full sweep is about 0.8 MB.
const MAX_BYTES: u64 = 16 * 1024 * 1024;
/// The longest free-text value accepted, such as a CPU name.
const MAX_TEXT_CHARS: usize = 200;

/// Checks every file, one line each, and fails if any file does.
pub(crate) fn validate_all(paths: &[PathBuf]) -> Result<(), String> {
    let mut failed = 0;
    for path in paths {
        match validate(path) {
            Ok(()) => println!("ok    {}", path.display()),
            Err(reason) => {
                failed += 1;
                eprintln!("FAIL  {}: {reason}", path.display());
            }
        }
    }
    if failed == 0 {
        Ok(())
    } else {
        Err(format!("{failed} of {} databases failed validation", paths.len()))
    }
}

/// Checks one file and names the first rule it breaks.
pub(crate) fn validate(path: &Path) -> Result<(), String> {
    if host::host_of_db_path(path).is_none() {
        return Err("the path must be data/db/<github-login>/<machine>.sqlite".into());
    }
    let size = fs::metadata(path).map_err(|error| format!("cannot read it: {error}"))?.len();
    if size > MAX_BYTES {
        return Err(format!("{size} bytes is over the {MAX_BYTES}-byte limit"));
    }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(sql)?;
    check_stamps(&db)?;
    check_integrity(&db)?;
    check_schema(&db)?;
    check_kernels(&db)?;
    check_params(&db)?;
    check_runs(&db)?;
    check_text(&db)
}

fn sql(error: rusqlite::Error) -> String {
    error.to_string()
}

fn check_stamps(db: &Connection) -> Result<(), String> {
    let pragma = |name: &str| db.pragma_query_value(None, name, |row| row.get::<_, i64>(0));
    let app = pragma("application_id").map_err(|error| format!("not an SQLite database: {error}"))?;
    if app != db::APPLICATION_ID {
        return Err(format!("application_id {app:#x} is not gemm-bench's {:#x}", db::APPLICATION_ID));
    }
    let version = pragma("user_version").map_err(sql)?;
    if version != db::SCHEMA_VERSION {
        return Err(format!(
            "schema version {version}; this tool validates version {}",
            db::SCHEMA_VERSION
        ));
    }
    Ok(())
}

fn check_integrity(db: &Connection) -> Result<(), String> {
    let status: String = db.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(sql)?;
    if status != "ok" {
        return Err(format!("integrity_check: {status}"));
    }
    let dangling: Option<String> = db
        .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
        .optional()
        .map_err(sql)?;
    match dangling {
        Some(table) => Err(format!("a row of {table:?} points at a row that does not exist")),
        None => Ok(()),
    }
}

/// The stored DDL must be byte-identical to data/schema.sql's: a file with a
/// CHECK stripped, or with an extra table, view or trigger, fails here.
fn check_schema(db: &Connection) -> Result<(), String> {
    let reference = Connection::open_in_memory().map_err(sql)?;
    reference.execute_batch(db::SCHEMA).map_err(sql)?;
    let objects = |db: &Connection| -> rusqlite::Result<Vec<(String, String, Option<String>)>> {
        let mut statement = db.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name")?;
        statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?.collect()
    };
    let (actual, expected) = (objects(db).map_err(sql)?, objects(&reference).map_err(sql)?);
    if let Some((kind, name, _)) = actual.iter().find(|object| !expected.contains(object)) {
        return Err(format!("{kind} {name:?} differs from data/schema.sql"));
    }
    if let Some((kind, name, _)) = expected.iter().find(|object| !actual.contains(object)) {
        return Err(format!("{kind} {name:?} from data/schema.sql is missing"));
    }
    Ok(())
}

/// Every kernel is one the tool has, on its own backend, at a precision it
/// runs; only worker kernels record more than one thread; and a Metal row
/// belongs to a run that recorded its GPU.
fn check_kernels(db: &Connection) -> Result<(), String> {
    let mut statement = db
        .prepare("SELECT DISTINCT kernel, backend, precision, threads > 1 FROM measurements")
        .map_err(sql)?;
    let rows: Vec<(String, String, String, bool)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .and_then(Iterator::collect)
        .map_err(sql)?;
    for (label, backend, precision, threaded) in rows {
        let kernel = KernelChoice::from_label(&label).ok_or_else(|| format!("unknown kernel {label:?}"))?;
        if kernel.backend() != backend {
            return Err(format!("{label} runs on {}, not {backend:?}", kernel.backend()));
        }
        if !Precision::from_str(&precision, false).is_ok_and(|p| kernel.supports(p)) {
            return Err(format!("{label} does not run at {precision:?}"));
        }
        if threaded && !kernel.uses_workers() {
            return Err(format!("{label} runs on one caller thread, but a row records more"));
        }
    }
    let gpu_less: i64 = db
        .query_row(
            "SELECT count(*) FROM measurements m JOIN runs r USING (run_id)
             WHERE m.backend = 'metal' AND r.gpu IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(sql)?;
    if gpu_less > 0 {
        return Err(format!("{gpu_less} Metal rows belong to a run that recorded no GPU"));
    }
    Ok(())
}

/// Each measurement records exactly its kernel's declared params, and no
/// cell (kernel, precision, n, threads, swept params) appears twice in a run.
fn check_params(db: &Connection) -> Result<(), String> {
    let mut statement = db
        .prepare(
            "SELECT m.measurement_id, m.kernel, p.name, p.source
             FROM measurements m LEFT JOIN params p USING (measurement_id)
             ORDER BY m.measurement_id, p.name",
        )
        .map_err(sql)?;
    let rows: Vec<(i64, String, Option<String>, Option<String>)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .and_then(Iterator::collect)
        .map_err(sql)?;
    for group in rows.chunk_by(|a, b| a.0 == b.0) {
        let (id, label) = (group[0].0, &group[0].1);
        let recorded: Vec<(&str, &str)> = group
            .iter()
            .filter_map(|(_, _, name, source)| Some((name.as_deref()?, source.as_deref()?)))
            .collect();
        let kernel = KernelChoice::from_label(label).ok_or_else(|| format!("unknown kernel {label:?}"))?;
        let declared: Vec<(&str, &str)> = kernel
            .declared_params()
            .into_iter()
            .map(|(name, source)| (name, source.label()))
            .collect();
        if recorded != declared {
            return Err(format!(
                "measurement {id} ({label}) records params {recorded:?}, but {label} declares {declared:?}"
            ));
        }
    }
    let twice: Option<(i64, String)> = db
        .query_row(
            "SELECT run_id, kernel FROM (
               SELECT m.run_id, m.kernel, m.precision, m.n, m.threads,
                 (SELECT group_concat(p.name || '=' || p.value, ',' ORDER BY p.name)
                  FROM params p WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS swept
               FROM measurements m)
             GROUP BY run_id, kernel, precision, n, threads, swept HAVING count(*) > 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(sql)?;
    match twice {
        Some((run, label)) => Err(format!("run {run} measures a {label} cell twice")),
        None => Ok(()),
    }
}

/// The file holds at least one run, and no run is empty.
fn check_runs(db: &Connection) -> Result<(), String> {
    let runs: i64 = db.query_row("SELECT count(*) FROM runs", [], |row| row.get(0)).map_err(sql)?;
    if runs == 0 {
        return Err("it holds no runs".into());
    }
    let empty: Option<String> = db
        .query_row(
            "SELECT started_at FROM runs r
             WHERE NOT EXISTS (SELECT 1 FROM measurements m WHERE m.run_id = r.run_id) LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    match empty {
        Some(at) => Err(format!("the run started at {at} has no measurements")),
        None => Ok(()),
    }
}

/// Free text from a contributor's machine: short, and no control characters.
fn check_text(db: &Connection) -> Result<(), String> {
    let columns = [
        ("runs.os", "SELECT os FROM runs"),
        ("runs.cpu", "SELECT cpu FROM runs"),
        ("runs.gpu", "SELECT gpu FROM runs WHERE gpu IS NOT NULL"),
        ("runs.commit_id", "SELECT commit_id FROM runs"),
        ("runs.rustc_version", "SELECT rustc_version FROM runs"),
        ("core_tiers.name", "SELECT name FROM core_tiers WHERE name IS NOT NULL"),
    ];
    for (column, query) in columns {
        let mut statement = db.prepare(query).map_err(sql)?;
        let values: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .and_then(Iterator::collect)
            .map_err(sql)?;
        for value in values {
            if value.chars().count() > MAX_TEXT_CHARS || value.chars().any(char::is_control) {
                let shown: String = value.chars().take(60).collect();
                return Err(format!(
                    "{column} {shown:?} is over {MAX_TEXT_CHARS} characters or holds a control character"
                ));
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 6: Add the subcommand**

In `benchmark/src/cli.rs`:
- **`Subcommand` import:** change `use clap::{Parser, ValueEnum};` to `use clap::{Parser, Subcommand, ValueEnum};`.
- **`command` attribute:** change the `#[command(…)]` on `Cli` to `#[command(about = "Benchmark safe, row-major GEMM kernels", after_help = AFTER_HELP, args_conflicts_with_subcommands = true)]`.
- **`command` field:** add a first field to `Cli`:

```rust
    #[command(subcommand)]
    pub(crate) command: Option<Command>,
```

  After `struct Cli`, add:

```rust
/// What the CLI does besides running a benchmark.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Check host databases the way CI does before they merge: path, size,
    /// schema, integrity, and every rule that spans rows.
    Validate {
        /// Database files, e.g. data/db/*/*.sqlite.
        #[arg(required = true)]
        dbs: Vec<PathBuf>,
    },
}
```

- **`is_unpinned`:** start with `self.command.is_none() &&`.

In `benchmark/src/main.rs`, import `cli::Command` and, right after `let cli = Cli::parse();`, add:

```rust
    if let Some(Command::Validate { dbs }) = &cli.command {
        return validate::validate_all(dbs).map_err(Into::into);
    }
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: PASS.

- [ ] **Step 8: Check the Linux shape**

Off macOS, the five Apple kernels are now `value(skip)` variants that only `ALL` constructs. If the `x86_64-unknown-linux-gnu` standard library is installed (`rustup target list --installed`), run:

`cargo clippy --manifest-path benchmark/Cargo.toml --all-targets --target x86_64-unknown-linux-gnu -- -D warnings`

Otherwise, CI's Linux job checks it when you push. In either case, a `dead_code` or `unreachable_patterns` warning there is a real bug to fix, not to silence.

- [ ] **Step 9: Lint and commit**

Run: `just lint && just check-bench`

```bash
git add benchmark/src
git commit -m "Add gemm-bench validate, the gate for contributed host databases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Validate in CI and on Commit, and Check Who Owns a Database

**Files:**
- Modify: `.github/workflows/ci.yml`, `lefthook.yml`, `justfile`

**Interfaces:**
- Consumes: from Task 7, `gemm-bench validate <db>...`.
- Produces: `just validate`, the `host-db-validate` lefthook command, and two CI steps in the Rust job.

- [ ] **Step 1: Add `just validate`**

Add to `justfile` after `init`:

```just
# Checks every committed host database the way CI does.
validate:
    #!/usr/bin/env bash
    set -euo pipefail
    shopt -s nullglob
    dbs=(data/db/*/*.sqlite)
    if (( ${#dbs[@]} )); then
        cargo run --quiet --manifest-path benchmark/Cargo.toml -- validate "${dbs[@]}"
    else
        echo "no host databases in data/db"
    fi
```

Run: `just validate`
Expected: `no host databases in data/db`.

- [ ] **Step 2: Validate staged databases on commit**

Add to `lefthook.yml` under `commands:`, leaving `data-build` in place until Task 14:

```yaml
    host-db-validate:
      glob: "data/db/*/*.sqlite"
      run: cargo run --quiet --manifest-path benchmark/Cargo.toml -- validate {staged_files}
```

- [ ] **Step 3: Add the CI steps**

In `.github/workflows/ci.yml`'s `rust` job, change `- uses: actions/checkout@v4` to:

```yaml
      - uses: actions/checkout@v4
        with:
          # The ownership check diffs the PR against its base branch.
          fetch-depth: 0
```

Append after `Run Tests`:

```yaml
      - name: Validate Host Databases
        run: |
          shopt -s nullglob
          dbs=(data/db/*/*.sqlite)
          if (( ${#dbs[@]} )); then
            cargo run --quiet --manifest-path benchmark/Cargo.toml -- validate "${dbs[@]}"
          fi

      # A contributed database is binary, so review can't see what changed:
      # a PR may only touch data/db/<its author's login>/.
      - name: Host Databases Belong to the PR Author
        if: github.event_name == 'pull_request'
        env:
          AUTHOR: ${{ github.event.pull_request.user.login }}
          BASE: ${{ github.base_ref }}
        run: |
          owner="data/db/$(printf %s "$AUTHOR" | tr '[:upper:]' '[:lower:]')/"
          # --no-renames shows a move out of someone else's folder as that folder's deletion.
          foreign=$(git diff --name-only --no-renames "origin/$BASE...HEAD" -- data/db | grep -v "^$owner" || true)
          if [ -n "$foreign" ]; then
            echo "A pull request may only change $owner. It also changes:"
            echo "$foreign"
            exit 1
          fi
```

- [ ] **Step 4: Dry-run the ownership script locally**

```bash
AUTHOR=OctoCat; owner="data/db/$(printf %s "$AUTHOR" | tr '[:upper:]' '[:lower:]')/"; printf 'data/db/octocat/m1.sqlite\ndata/db/alice/x.sqlite\n' | grep -v "^$owner"
```

Expected: prints only `data/db/alice/x.sqlite`, the line that would fail the step.

- [ ] **Step 5: Commit**

```bash
git add justfile lefthook.yml .github/workflows/ci.yml
git commit -m "Validate host databases on commit and in CI, and tie each to its author

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase B: The Dashboard

Every web command runs in `web/` unless it says otherwise. `bun test` runs every `src/**/*.test.ts`. `bun run typecheck` also checks the test files, so a field that's gone from `Row` shows up there.

### Task 9: Read Host Databases With sql.js

**Files:**
- Create: `web/src/lib/views.sql`, `web/src/lib/sqlite.ts`, `web/src/lib/testdb.ts`, `web/src/lib/db.test.ts`, `web/src/lib/peaks.ts`, `web/src/lib/peaks.test.ts`, `web/src/lib/hosts.ts`, `web/src/lib/hosts.test.ts`, `web/src/lib/hostlist.ts`
- Rewrite: `web/src/lib/db.ts`
- Modify: `web/package.json`, `web/vite.config.ts`, `web/src/lib/state.svelte.ts`, `web/src/App.svelte`, `web/src/lib/fixtures.ts`, `web/src/lib/derive.ts`, `web/src/lib/derive.test.ts`, `web/src/lib/charts/precision.ts`, `web/src/lib/charts/precision.test.ts`

**Interfaces:**
- Consumes: from Task 6, `data/schema.sql`.
- Produces from `db.ts`:
  - `Row`, a typed interface: the `latest` view's columns, `params` and `swept` as `Record<string, number>`, and a transitional `block_size: number | null`.
  - `Peak`, `CoreTier`, `Cache` and `Machine`.
  - `APPLICATION_ID` and `SCHEMA_VERSION`.
  - `openDb(SQL, bytes) -> Database`, `readRows(db) -> Row[]` and `readMachine(db) -> Machine | undefined`.
- Produces elsewhere:
  - `peaks.ts`: `parseCsv`, `parsePeaks` and `PEAKS_HEADER`.
  - `hosts.ts`: `Host { id, url }`, `hostsFrom` and `pickHost`.
  - `hostlist.ts`: `HOSTS`.
  - `sqlite.ts`: `loadSql()`.
  - `testdb.ts`: `SQL` and `fixtureDb(runs)`.
  - `derive.ts`: `formatParams`.
  - `store` gains `hosts`, `host` and `machine`.

- [ ] **Step 1: Add sql.js and let Vite serve the repo's data**

Run: `bun add sql.js@1.14.2 && bun add -d @types/sql.js`

In `web/vite.config.ts`, add to the config object:

```ts
	server: {
		// data/db/**/*.sqlite and data/peaks.csv live outside web/.
		fs: { allow: [".."] },
	},
```

- [ ] **Step 2: Add the views and the test-database builder**

Create `web/src/lib/views.sql`:

```sql
-- Reader-side views, created as TEMP on every host DB the dashboard opens,
-- so they can change without touching any committed DB (schema.sql holds
-- only tables). bun test runs them through sql.js, the engine browsers use.

-- One row per measurement: its run's context, the device it ran on (the
-- run's GPU for Metal, else its CPU), every param as a JSON object, and the
-- swept params alone, which identify the cell.
CREATE TEMP VIEW measurement_rows AS
SELECT m.*,
  CASE m.backend WHEN 'metal' THEN r.gpu ELSE r.cpu END AS device,
  r.gpu_cores, r.started_at, r.commit_id, r.repetitions,
  (SELECT json_group_object(name, value ORDER BY name) FROM params p
    WHERE p.measurement_id = m.measurement_id) AS params,
  (SELECT json_group_object(name, value ORDER BY name) FROM params p
    WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS swept_params
FROM measurements m JOIN runs r USING (run_id);

-- The newest measurement of each cell: the latest run wins.
CREATE TEMP VIEW latest AS
SELECT * FROM (
  SELECT *, row_number() OVER (
    PARTITION BY kernel, precision, n, threads, swept_params
    ORDER BY started_at DESC, measurement_id DESC) AS recency
  FROM measurement_rows)
WHERE recency = 1;
```

Create `web/src/lib/testdb.ts`:

```ts
import initSqlJs from "sql.js";
import schema from "../../../data/schema.sql?raw";

/** sql.js under Bun: the same engine the dashboard runs in the browser. */
export const SQL = await initSqlJs();

export interface FixtureMeasurement {
	kernel: string;
	backend?: string;
	precision?: string;
	n: number;
	threads?: number;
	gops: number;
	/** null or NaN stores NULL, as the Rust writer does for a NaN error. */
	mean_rel_error_f64?: number | null;
	median_ms?: number;
	gpu_ms?: number | null;
	params?: [name: string, value: number, source: "swept" | "derived" | "fixed"][];
}

export interface FixtureRun {
	started_at: string;
	cpu?: string;
	gpu?: string | null;
	gpu_cores?: number | null;
	tiers?: [tier: number, name: string | null, cores: number, logicalCpus: number][];
	caches?: [tier: number | null, level: number, kind: string, sizeBytes: number, sharedBy: number, instances: number][];
	measurements: FixtureMeasurement[];
}

/** A host DB built from data/schema.sql, holding `runs` as the Rust writer would. */
export function fixtureDb(runs: FixtureRun[]): Uint8Array {
	const db = new SQL.Database();
	db.exec(schema);
	const lastId = () => Number(db.exec("SELECT last_insert_rowid()")[0].values[0][0]);
	for (const run of runs) {
		db.run(
			`INSERT INTO runs (started_at, commit_id, rustc_version, repetitions, os, arch,
			                   target_features, cpu, available_parallelism, gpu, gpu_cores)
			 VALUES (?, 'abc1234', 'rustc 1.101.0-nightly', 5, 'macOS 27.0.1', 'aarch64',
			         'dotprod fp16 neon', ?, 10, ?, ?)`,
			[
				run.started_at,
				run.cpu ?? "Apple M1 Pro",
				run.gpu === undefined ? "Apple M1 Pro" : run.gpu,
				run.gpu_cores === undefined ? 16 : run.gpu_cores,
			],
		);
		const runId = lastId();
		for (const [tier, name, cores, logical] of run.tiers ?? []) {
			db.run("INSERT INTO core_tiers VALUES (?, ?, ?, ?, ?)", [runId, tier, name, cores, logical]);
		}
		for (const [tier, level, kind, size, sharedBy, instances] of run.caches ?? []) {
			db.run("INSERT INTO caches VALUES (?, ?, ?, ?, ?, 128, ?, ?)", [
				runId, tier, level, kind, size, sharedBy, instances,
			]);
		}
		for (const m of run.measurements) {
			const backend = m.backend ?? "cpu";
			const gpuMs = m.gpu_ms === undefined ? (backend === "metal" ? 0.5 : null) : m.gpu_ms;
			const error = m.mean_rel_error_f64 === undefined ? 1e-7 : m.mean_rel_error_f64;
			db.run(
				`INSERT INTO measurements (run_id, kernel, backend, precision, n, threads, gops,
				   mean_rel_error_f64, median_ms, min_ms, stddev_ms, gpu_ms, setup_ms)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
				[
					runId, m.kernel, backend, m.precision ?? "f32", m.n, m.threads ?? 1, m.gops,
					error, m.median_ms ?? 1, m.median_ms ?? 1, gpuMs,
				],
			);
			const measurementId = lastId();
			for (const [name, value, source] of m.params ?? []) {
				db.run("INSERT INTO params VALUES (?, ?, ?, ?)", [measurementId, name, value, source]);
			}
		}
	}
	const bytes = db.export();
	db.close();
	return bytes;
}
```

- [ ] **Step 3: Write the failing database tests**

Create `web/src/lib/db.test.ts`:

```ts
import { expect, test } from "bun:test";
import { openDb, readMachine, readRows } from "./db";
import { fixtureDb, SQL } from "./testdb";

const PACKED_256: [string, number, "swept" | "derived" | "fixed"][] = [
	["depth_block", 256, "swept"],
	["depth_block_used", 256, "derived"],
	["register_cols", 12, "derived"],
	["register_rows", 8, "fixed"],
	["register_col_vectors", 3, "fixed"],
];

const open = (runs: Parameters<typeof fixtureDb>[0]) => openDb(SQL, fixtureDb(runs));

test("the latest run of a cell wins, and older runs stay in the file", () => {
	const rows = readRows(
		open([
			{ started_at: "2026-10-01T00:00:00Z", measurements: [{ kernel: "ikj", n: 64, gops: 10 }, { kernel: "ikj", n: 128, gops: 11 }] },
			{ started_at: "2026-10-02T00:00:00Z", measurements: [{ kernel: "ikj", n: 64, gops: 20 }] },
		]),
	);
	expect(rows.map((r) => [r.n, r.gops, r.started_at])).toEqual([
		[64, 20, "2026-10-02T00:00:00Z"],
		[128, 11, "2026-10-01T00:00:00Z"],
	]);
});

test("swept params tell cells apart; other params ride along", () => {
	const rows = readRows(
		open([
			{
				started_at: "2026-10-01T00:00:00Z",
				measurements: [
					{ kernel: "packed", n: 256, gops: 80, params: PACKED_256 },
					{ kernel: "packed", n: 256, gops: 90, params: [["depth_block", 512, "swept"], ["depth_block_used", 256, "derived"], ["register_cols", 12, "derived"], ["register_rows", 8, "fixed"], ["register_col_vectors", 3, "fixed"]] },
					{ kernel: "ikj", n: 256, gops: 20 },
				],
			},
		]),
	);
	expect(rows).toHaveLength(3);
	const [ikj, packed256] = rows;
	expect(ikj.params).toEqual({});
	expect(ikj.swept).toEqual({});
	expect(ikj.block_size).toBeNull();
	expect(packed256.swept).toEqual({ depth_block: 256 });
	expect(packed256.params).toEqual({ depth_block: 256, depth_block_used: 256, register_col_vectors: 3, register_cols: 12, register_rows: 8 });
	expect(packed256.block_size).toBe(256);
});

test("the device is the run's GPU for Metal rows and its CPU otherwise", () => {
	const rows = readRows(
		open([
			{
				started_at: "2026-10-01T00:00:00Z",
				cpu: "Test CPU",
				gpu: "Test GPU",
				gpu_cores: 14,
				measurements: [{ kernel: "ikj", n: 64, gops: 1 }, { kernel: "mps", backend: "metal", n: 64, gops: 2 }],
			},
		]),
	);
	expect(rows.map((r) => [r.kernel, r.device, r.gpu_cores])).toEqual([
		["ikj", "Test CPU", 14],
		["mps", "Test GPU", 14],
	]);
});

test("+Inf survives, and a NaN error reads as null", () => {
	const [row] = readRows(
		open([{ started_at: "2026-10-01T00:00:00Z", measurements: [{ kernel: "ikj", n: 64, gops: Number.POSITIVE_INFINITY, mean_rel_error_f64: Number.NaN }] }]),
	);
	expect(row.gops).toBe(Number.POSITIVE_INFINITY);
	expect(row.mean_rel_error_f64).toBeNull();
});

test("a file that isn't a gemm-bench v1 database is refused", () => {
	const foreign = new SQL.Database();
	foreign.exec("CREATE TABLE notes (x)");
	expect(() => openDb(SQL, foreign.export())).toThrow("not a gemm-bench database");

	const newer = new SQL.Database(fixtureDb([{ started_at: "2026-10-01T00:00:00Z", measurements: [] }]));
	newer.exec("PRAGMA user_version = 2");
	expect(() => openDb(SQL, newer.export())).toThrow("schema version 2");
});

test("the machine is the latest run's, tiers and caches included", () => {
	const db = open([
		{ started_at: "2026-10-01T00:00:00Z", cpu: "Old CPU", measurements: [] },
		{
			started_at: "2026-10-02T00:00:00Z",
			tiers: [[0, "Performance", 8, 8], [1, "Efficiency", 2, 2]],
			caches: [[null, 3, "unified", 32 << 20, 10, 1], [0, 2, "unified", 12 << 20, 4, 2]],
			measurements: [],
		},
	]);
	const machine = readMachine(db);
	expect(machine?.cpu).toBe("Apple M1 Pro");
	expect(machine?.tiers.map((t) => t.name)).toEqual(["Performance", "Efficiency"]);
	// Tier caches first, then the ones shared across tiers.
	expect(machine?.caches.map((c) => c.tier)).toEqual([0, null]);
	expect(readMachine(open([]))).toBeUndefined();
});
```

Run: `bun test src/lib/db.test.ts`
Expected: FAIL. `openDb`, `readRows` and `readMachine` are not exported by `./db`.

- [ ] **Step 4: Rewrite `web/src/lib/db.ts`**

```ts
import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import viewsSql from "./views.sql?raw";

/** One measurement: a row of the `latest` view (views.sql). */
export interface Row {
	kernel: string;
	/** `cpu`, `matrix` or `metal`. */
	backend: string;
	/** The run's GPU for Metal rows, its CPU otherwise. */
	device: string;
	precision: string;
	n: number;
	threads: number;
	gops: number;
	/** null: the kernel's error was NaN, which SQLite stores as NULL. */
	mean_rel_error_f64: number | null;
	median_ms: number;
	min_ms: number;
	stddev_ms: number;
	/** Set exactly on Metal rows. */
	gpu_ms: number | null;
	setup_ms: number;
	/** The run's GPU core count, which picks the GPU's ceiling. */
	gpu_cores: number | null;
	started_at: string;
	commit_id: string;
	repetitions: number;
	/** Every param the kernel recorded, by name. */
	params: Record<string, number>;
	/** The swept params alone: with kernel, precision, n and threads, the cell. */
	swept: Record<string, number>;
	/** Transitional: the one swept value, for the block-size views until they read `swept`. */
	block_size: number | null;
}

/** A hardware ceiling: one row of data/peaks.csv. */
export interface Peak {
	device: string;
	backend: string;
	precision: string;
	cores: number;
	gflops: number;
	source: string;
}

export interface CoreTier {
	tier: number;
	name: string | null;
	cores: number;
	logical_cpus: number;
}

export interface Cache {
	/** null: shared across tiers. */
	tier: number | null;
	level: number;
	kind: string;
	size_bytes: number;
	line_bytes: number | null;
	shared_by: number;
	instances: number;
}

/** The machine as a host's latest run recorded it. */
export interface Machine {
	started_at: string;
	os: string;
	arch: string;
	target_features: string;
	rustc_version: string;
	cpu: string;
	available_parallelism: number;
	gpu: string | null;
	gpu_cores: number | null;
	tiers: CoreTier[];
	caches: Cache[];
}

/** 'GEMM': data/schema.sql's application_id. */
export const APPLICATION_ID = 0x47454d4d;
/** The schema version this dashboard reads. */
export const SCHEMA_VERSION = 1;

function all<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
	const statement = db.prepare(sql, params);
	const rows: T[] = [];
	// getAsObject is untyped (column → SqlValue); each query's T names its columns.
	while (statement.step()) rows.push(statement.getAsObject() as unknown as T);
	statement.free();
	return rows;
}

function pragma(db: Database, name: string): number {
	return Number(db.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0]);
}

/**
 * A host database's bytes, opened with the dashboard's views on it. Throws
 * for a file that isn't a gemm-bench database of the version this dashboard
 * reads, so a bad host fails alone.
 */
export function openDb(SQL: SqlJsStatic, bytes: Uint8Array): Database {
	const db = new SQL.Database(bytes);
	try {
		if (pragma(db, "application_id") !== APPLICATION_ID) {
			throw new Error("not a gemm-bench database");
		}
		const version = pragma(db, "user_version");
		if (version !== SCHEMA_VERSION) {
			throw new Error(`schema version ${version}; this dashboard reads version ${SCHEMA_VERSION}`);
		}
		db.exec(viewsSql);
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}

type LatestRow = Omit<Row, "params" | "swept" | "block_size"> & {
	params: string;
	swept_params: string;
};

/** Every cell's latest measurement, with its params parsed. */
export function readRows(db: Database): Row[] {
	return all<LatestRow>(
		db,
		`SELECT kernel, backend, device, precision, n, threads, gops, mean_rel_error_f64,
		        median_ms, min_ms, stddev_ms, gpu_ms, setup_ms, gpu_cores, started_at,
		        commit_id, repetitions, params, swept_params
		 FROM latest ORDER BY kernel, precision, n, threads, swept_params`,
	).map(({ params, swept_params, ...measurement }) => {
		const swept: Record<string, number> = JSON.parse(swept_params);
		const values = Object.values(swept);
		return {
			...measurement,
			params: JSON.parse(params),
			swept,
			block_size: values.length === 1 ? values[0] : null,
		};
	});
}

/** The machine as the host's latest run recorded it; undefined with no runs. */
export function readMachine(db: Database): Machine | undefined {
	const [run] = all<Omit<Machine, "tiers" | "caches"> & { run_id: number }>(
		db,
		`SELECT run_id, started_at, os, arch, target_features, rustc_version, cpu,
		        available_parallelism, gpu, gpu_cores
		 FROM runs ORDER BY started_at DESC LIMIT 1`,
	);
	if (!run) return undefined;
	const { run_id: runId, ...machine } = run;
	return {
		...machine,
		tiers: all<CoreTier>(
			db,
			"SELECT tier, name, cores, logical_cpus FROM core_tiers WHERE run_id = ? ORDER BY tier",
			[runId],
		),
		caches: all<Cache>(
			db,
			`SELECT tier, level, kind, size_bytes, line_bytes, shared_by, instances FROM caches
			 WHERE run_id = ? ORDER BY tier IS NULL, tier, level, kind`,
			[runId],
		),
	};
}
```

Run: `bun test src/lib/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Peaks from the CSV, with `build.sql`'s rules as tests**

Create `web/src/lib/peaks.ts`:

```ts
import type { Peak } from "./db";

/** data/peaks.csv's header, exactly. */
export const PEAKS_HEADER = ["device", "backend", "precision", "cores", "gflops", "source"];

/** RFC 4180: commas and line breaks inside "…" stay in the field, and "" is a literal quote. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				quoted = false;
			} else {
				field += c;
			}
		} else if (c === '"') {
			quoted = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += c;
		}
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/** data/peaks.csv as typed ceilings. peaks.test.ts holds the file to its rules, so this only converts. */
export function parsePeaks(csv: string): Peak[] {
	const [, ...body] = parseCsv(csv.replace(/^﻿/, ""));
	return body
		.filter((fields) => fields.some((field) => field !== ""))
		.map(([device, backend, precision, cores, gflops, source]) => ({
			device,
			backend,
			precision,
			cores: Number(cores),
			gflops: Number(gflops),
			source,
		}));
}
```

Create `web/src/lib/peaks.test.ts`:

```ts
import { expect, test } from "bun:test";
import peaksCsv from "../../../data/peaks.csv?raw";
import { PEAKS_HEADER, parseCsv, parsePeaks } from "./peaks";

test("parseCsv keeps quoted commas and doubled quotes inside one field", () => {
	expect(parseCsv('a,"b, ""c""",d\n')).toEqual([["a", 'b, "c"', "d"]]);
});

test("parseCsv reads CRLF and a missing final newline", () => {
	expect(parseCsv("a,b\r\nc,d")).toEqual([
		["a", "b"],
		["c", "d"],
	]);
});

// data/peaks.csv is hand-curated: every value in it was typed by someone, so
// a bad one fails the build here instead of drawing a wrong ceiling.
const [header, ...rows] = parseCsv(peaksCsv.replace(/^﻿/, "")).filter((fields) =>
	fields.some((field) => field !== ""),
);
const nameOf = (fields: string[]) => fields.slice(0, 4).join("/");

test("data/peaks.csv starts with the exact header", () => {
	expect(header).toEqual(PEAKS_HEADER);
});

test("every peaks row has six fields", () => {
	expect(rows.filter((fields) => fields.length !== 6).map(nameOf)).toEqual([]);
});

test("every ceiling has every value, a cited source, backend cpu or metal, whole cores ≥ 1 and a finite gflops > 0", () => {
	const bad = rows.filter(
		([device, backend, precision, cores, gflops, source]) =>
			[device, backend, precision, cores, gflops].some((value) => !value?.trim()) ||
			// \s alone misses no-break and zero-width spaces.
			/^[\s\p{Z}\p{C}]*$/u.test(source ?? "") ||
			!["cpu", "metal"].includes(backend) ||
			!/^[1-9][0-9]{0,5}$/.test(cores) ||
			!(Number.isFinite(Number(gflops)) && Number(gflops) > 0),
	);
	expect(bad.map(nameOf)).toEqual([]);
});

test("no ceiling is listed twice", () => {
	const names = rows.map(nameOf);
	expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
});

test("parsePeaks types every row", () => {
	const peaks = parsePeaks(peaksCsv);
	expect(peaks).toHaveLength(rows.length);
	expect(peaks.every((p) => Number.isInteger(p.cores) && p.gflops > 0)).toBe(true);
});
```

Run: `bun test src/lib/peaks.test.ts`
Expected: PASS against today's `data/peaks.csv`.

- [ ] **Step 6: The host list, and loading sql.js in the browser**

Create `web/src/lib/hosts.ts`:

```ts
/** A host database the build found: `<login>/<machine>` and its asset URL. */
export interface Host {
	id: string;
	url: string;
}

/** Hosts from Vite's glob map (`…/data/db/<login>/<machine>.sqlite` → URL), sorted by id. */
export function hostsFrom(urls: Record<string, string>): Host[] {
	return Object.entries(urls)
		.flatMap(([path, url]) => {
			const id = path.match(/data\/db\/([^/]+\/[^/]+)\.sqlite$/)?.[1];
			return id ? [{ id, url }] : [];
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

/** The host `?host=` names, else the first; undefined when there are none. */
export function pickHost(hosts: Host[], search: string): Host | undefined {
	const wanted = new URLSearchParams(search).get("host");
	return hosts.find((host) => host.id === wanted) ?? hosts[0];
}
```

Create `web/src/lib/hosts.test.ts`:

```ts
import { expect, test } from "bun:test";
import { hostsFrom, pickHost } from "./hosts";

const hosts = hostsFrom({
	"../../../data/db/zed/box.sqlite": "/a.sqlite",
	"../../../data/db/alice/m1.sqlite": "/b.sqlite",
	"../../../data/db/stray.sqlite": "/c.sqlite",
});

test("host ids come from the database paths, sorted", () => {
	expect(hosts).toEqual([
		{ id: "alice/m1", url: "/b.sqlite" },
		{ id: "zed/box", url: "/a.sqlite" },
	]);
});

test("?host= picks a listed host, and anything else falls back to the first", () => {
	expect(pickHost(hosts, "?host=zed%2Fbox")?.id).toBe("zed/box");
	expect(pickHost(hosts, "?host=nobody%2Fx")?.id).toBe("alice/m1");
	expect(pickHost(hosts, "")?.id).toBe("alice/m1");
	expect(pickHost([], "?host=zed%2Fbox")).toBeUndefined();
});
```

Create `web/src/lib/hostlist.ts`. It is Vite-only (Bun has no `import.meta.glob`), so no test imports it:

```ts
import { hostsFrom } from "./hosts";

/** Every committed host database, found at build time: Pages can't list a directory. */
export const HOSTS = hostsFrom(
	import.meta.glob("../../../data/db/*/*.sqlite", {
		query: "?url",
		import: "default",
		eager: true,
	}) as Record<string, string>,
);
```

Create `web/src/lib/sqlite.ts`, which is browser-only for the same reason:

```ts
import initSqlJs, { type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";

let loading: Promise<SqlJsStatic> | undefined;

/** sql.js, loaded once; the wasm comes from Vite's content-hashed asset URL. */
export function loadSql(): Promise<SqlJsStatic> {
	loading ??= initSqlJs({ locateFile: () => wasmUrl });
	return loading;
}
```

Run: `bun test src/lib/hosts.test.ts`
Expected: PASS.

- [ ] **Step 7: Move the fixtures and guards onto the typed `Row`**

In `web/src/lib/fixtures.ts`, replace `row` with:

```ts
/**
 * A test row: a single-threaded f32 CPU result on the M1 Pro unless the
 * fields say otherwise. Timings left out are NaN, as they read when missing.
 */
export function row(fields: Partial<Row>): Row {
	return {
		kernel: "",
		backend: "cpu",
		device: "Apple M1 Pro",
		precision: "f32",
		n: Number.NaN,
		threads: 1,
		gops: Number.NaN,
		mean_rel_error_f64: Number.NaN,
		median_ms: Number.NaN,
		min_ms: Number.NaN,
		stddev_ms: Number.NaN,
		gpu_ms: null,
		setup_ms: Number.NaN,
		gpu_cores: null,
		started_at: "2026-10-01T00:00:00Z",
		commit_id: "test",
		repetitions: 5,
		params: {},
		swept: {},
		block_size: null,
		...fields,
	};
}
```

In `web/src/lib/derive.ts`, replace the doc comment above `isPlottable` with:

```ts
/**
 * Host databases are contributed, and the schema allows +Inf (a kernel whose
 * timing rounded to zero). A single non-finite or non-positive n or gops
 * poisons a log scale's whole domain, blanking every series on the chart
 * rather than just the bad row, so unusable rows are dropped at the door.
 */
```

Add after `partitionPlottable`:

```ts
/** A row's params for the data view: `depth_block=256 register_cols=12`. */
export function formatParams(params: Record<string, number>): string {
	return Object.entries(params)
		.map(([name, value]) => `${name}=${value}`)
		.join(" ");
}
```

In `web/src/lib/derive.test.ts`:
- **Removed tests:** delete `isPlottable rejects null stddev_ms` and `isPlottable rejects null gops`. The schema makes both columns `NOT NULL`, and a typed `Row` can't hold the null.
- **New test:** add `formatParams` to the import and add:

```ts
test("formatParams lists name=value pairs", () => {
	expect(formatParams({ depth_block: 256, register_cols: 12 })).toBe("depth_block=256 register_cols=12");
	expect(formatParams({})).toBe("");
});
```

In `web/src/lib/charts/precision.ts`, the accuracy filter must now also drop `+Inf`. A kernel that produced NaN records an infinite error, which a log axis can't place. Replace its filter predicate with:

```ts
		(r) => r.mean_rel_error_f64 !== null && Number.isFinite(r.mean_rel_error_f64) && r.mean_rel_error_f64 > 0,
```

In `web/src/lib/charts/precision.test.ts`, which already imports `accuracyVsThroughput`, `plotted`, `row` and `makeCtx` and defines `f`, add:

```ts
test("an infinite error (a kernel that produced NaN) is left out of the accuracy chart", () => {
	const rows = [
		row({ kernel: "ikj", n: 512, gops: 20, mean_rel_error_f64: 1e-6 }),
		row({ kernel: "tiled", n: 512, gops: 25, mean_rel_error_f64: Number.POSITIVE_INFINITY }),
	];
	const spec = accuracyVsThroughput(rows, { ...f, n: 512 }, makeCtx(rows));
	expect(plotted(spec).every((p) => Number.isFinite(Number(p.x)))).toBe(true);
});
```

- [ ] **Step 8: Boot from the selected host**

Replace `web/src/lib/state.svelte.ts` with:

```ts
import peaksCsv from "../../../data/peaks.csv?raw";
import { type Machine, openDb, type Peak, readMachine, readRows, type Row } from "./db";
import {
	defaultBlockSizeFor,
	defaultParallelKernel,
	defaultPrecision,
	defaultSize,
	partitionPlottable,
} from "./derive";
import { HOSTS } from "./hostlist";
import { type Host, pickHost } from "./hosts";
import { parsePeaks } from "./peaks";
import { loadSql } from "./sqlite";

export const store = $state({
	rows: [] as Row[],
	peaks: [] as Peak[],
	hosts: HOSTS as Host[],
	host: undefined as Host | undefined,
	machine: undefined as Machine | undefined,
	error: "",
	loaded: false,
	precision: "",
	n: 0,
	kernel: "",
	blockSize: 0,
	relative: false,
	tab: "overview",
	dropped: 0,
});

/**
 * Fetches the selected host's database (`?host=`, else the first) and reads
 * it once; every derivation downstream is synchronous.
 */
export async function boot(): Promise<void> {
	const host = pickHost(HOSTS, location.search);
	store.host = host;
	try {
		store.peaks = parsePeaks(peaksCsv);
		if (host) {
			const [SQL, response] = await Promise.all([loadSql(), fetch(host.url)]);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const db = openDb(SQL, new Uint8Array(await response.arrayBuffer()));
			const { rows, dropped } = partitionPlottable(readRows(db));
			store.machine = readMachine(db);
			db.close();
			store.rows = rows;
			store.dropped = dropped;
			store.precision = defaultPrecision(rows);
			store.n = defaultSize(rows, store.precision);
			store.kernel = defaultParallelKernel(rows, store.precision);
			store.blockSize = defaultBlockSizeFor(rows, store.precision, store.n);
		}
		store.loaded = true;
	} catch (e) {
		store.error = host ? `${host.id}: ${e}` : String(e);
	}
}
```

In `web/src/App.svelte`:
- **Empty state:** replace the `{:else if !tab}` branch (the `just data` hint) with:

```svelte
	{:else if !store.host}
		<p class="muted">
			No host databases yet. Run <code>just init &lt;github-login&gt;/&lt;machine&gt;</code> once,
			then <code>just bench</code>.
		</p>
	{:else if !tab}
		<p class="muted">{store.host.id} has no measurements to chart yet.</p>
```

- **Data view:** a typed `Row` can't be indexed by a string, and `params`/`swept` are objects. Add `formatParams` to the `./lib/derive` import and `type Row` from `./lib/db`, then add to the script:

```ts
const columns = $derived(scoped.length ? (Object.keys(scoped[0]) as (keyof Row)[]) : []);

/** One data-view cell: params as name=value pairs, floats to 3 places. */
function cell(value: Row[keyof Row]): string {
	if (value !== null && typeof value === "object") return formatParams(value);
	if (typeof value === "number" && !Number.isInteger(value)) return value.toFixed(3);
	return String(value ?? "");
}
```

  Replace the table's header loop with `{#each columns as c}<th>{c}</th>{/each}` and its cell loop with `{#each columns as c}<td>{cell(row[c])}</td>{/each}`.

- [ ] **Step 9: Typecheck, test, build**

Run: `bun run typecheck && bun test && bun run build`
Expected:
- The typecheck is clean. Any error left will be a test passing a field `Row` doesn't have. Fix the test (`swept` replaces nothing yet; only the two null tests above were removed).
- Every test passes.
- The build succeeds with zero hosts.

- [ ] **Step 10: See it work against a real database**

From the repo root:

```bash
just bench --config configs/quick.toml --no-progress
```

This writes `data/db/paulhondola/m1pro.sqlite` (from `.host`, set in Task 6). Start the dashboard with the preview tools (`preview_start` with name `dashboard`) and check:
- The CPU, threading and precision tabs chart the quick run.
- The console has no errors.
- `read_network_requests` shows the `.sqlite` and `.wasm` fetched once each.

Then delete the local database so it isn't committed. Task 14 commits the full sweep instead:

```bash
rm data/db/paulhondola/m1pro.sqlite
```

- [ ] **Step 11: Lint and commit**

From the repo root: `just lint && just check && just test`

```bash
git add web
git commit -m "Read the selected host's SQLite database in the browser with sql.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The `amx` Family Becomes `matrix`

**Files:**
- Rename: `web/src/docs/kernels/amx.md` → `web/src/docs/kernels/matrix.md`
- Modify: `web/src/lib/**/*.ts`, `web/src/docs/charts/*.md`, `web/src/docs/kernels/serial.md`

**Interfaces:**
- Consumes: from Task 2, the backend value `"matrix"` in new databases.
- Produces: `Family = "serial" | "parallel" | "matrix" | "gpu"` and `FAMILY_INK.matrix`. The user-facing labels are "Matrix", "Matrix unit", "Matrix peak" and the tab "CPU & matrix".

- [ ] **Step 1: Rename the identifiers**

```bash
cd web/src
git mv docs/kernels/amx.md docs/kernels/matrix.md
perl -pi -e 's/"amx f64"/"matrix f64"/g; s/"amx"/"matrix"/g; s/\bamx: /matrix: /g; s/FAMILY_INK\.amx\b/FAMILY_INK.matrix/g' $(git ls-files 'lib/*.ts' 'lib/**/*.ts')
perl -pi -e 's/"AMX"/"Matrix"/g' lib/charts/gpu.test.ts
perl -pi -e 's/toBe\("AMX"\)/toBe("Matrix unit")/' lib/hardware.test.ts
```

- [ ] **Step 2: Update the labels by hand**

- `lib/docs.ts`: `import amx from "../docs/kernels/amx.md?raw";` → `import matrix from "../docs/kernels/matrix.md?raw";`, and the entry becomes `{ family: "matrix", title: "Matrix unit (Apple AMX, Arm SME)", doc: matrix },`.
- `lib/hardware.ts`: in `engineLabel`, `return "AMX";` → `return "Matrix unit";`. In the doc comments, the `"AMX"` example becomes `"Matrix unit"`, and "none for AMX" becomes "none for the matrix unit".
- `lib/charts/types.ts`: `matrix: () => "AMX peak",` → `matrix: () => "Matrix peak",`, and the comment above it says "familyPeak lists no matrix-unit peak".
- `lib/charts/gpu.ts`: `{ family: "matrix", label: "AMX" }` → `{ family: "matrix", label: "Matrix" }`. In the comments, "AMX" becomes "the matrix unit".
- `lib/charts/index.ts`:
  - The label `"CPU & AMX"` becomes `"CPU & matrix"`.
  - The GPU tab's notes become `"End-to-end GPU timings against the best threaded-CPU and matrix-unit results · log–log · dashed lines are hardware peaks"` and `"Shaders vs threaded CPU, MPS vs the matrix unit, at each size · above 1.0 the GPU wins"`.
- `lib/derive.ts`: the `familyPeak` comment's last sentence becomes "Apple publishes no matrix-unit peak, so matrix never has one."

- [ ] **Step 3: Update the docs**

```bash
perl -pi -e '
  s/the best AMX result at each size/the best matrix-unit result (`matrix`) at each size/;
  s/AMX has no published peak/The matrix unit has no published peak/;
  s/by the best AMX kernel/by the best matrix-unit kernel/;
  s/the AMX kernels no integers/the matrix-unit kernels no integers/;
  s/`amx` and `gpu`/`matrix` and `gpu`/;
  s/the threaded and AMX kernels/the threaded and matrix-unit kernels/;
  s/Apple.s AMX coprocessor, then the GPU/the matrix unit (Apple'"'"'s AMX), then the GPU/;
  s/no AMX kernel for the integer types/no matrix-unit kernel for the integer types/;
  s/Every CPU and AMX kernel.s throughput/Every CPU and matrix-unit kernel'"'"'s throughput/;
  s/and AMX \(`accelerate-\*`\)/and the matrix unit (`accelerate-*`)/;
  s/CPU & AMX speedups/CPU & matrix speedups/;
' docs/charts/*.md docs/kernels/serial.md
```

In `docs/kernels/matrix.md`, add this sentence at the end of the blurb (the paragraph before the first `## `): "On M1–M3 this is Apple's AMX; from M4 on, Accelerate drives the same kind of unit as Arm SME, so the dashboard calls the family `matrix`." The descriptions of Apple's AMX hardware in `docs/about.md`, `docs/hardware.md` and `docs/kernels/gpu.md` stay as they are: they describe the M1 Pro.

- [ ] **Step 4: Check nothing was missed**

Run: `grep -rn -E '"amx|amx:|\.amx\b|kernels/amx' web/src`
Expected: no output.

- [ ] **Step 5: Typecheck, test, commit**

Run: `bun run typecheck && bun test` (in `web/`), then `just lint` from the repo root.
Expected: PASS. `docs.test.ts` checks that `KERNEL_DOCS` families equal `FAMILY_ORDER`, both of which now say `matrix`.

```bash
git add web
git commit -m "Call the vendor matrix-unit family matrix, not amx

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Knob Pills and Knob Charts Replace Block Size

**Files:**
- Create: `web/src/lib/charts/knobs.ts`, `web/src/lib/charts/knobs.test.ts`, `web/src/docs/charts/throughput-vs-tile-size.md`, `web/src/docs/charts/throughput-vs-depth-block.md`
- Delete: `web/src/lib/charts/blocksize.ts`, `web/src/lib/charts/blocksize.test.ts`, `web/src/docs/charts/throughput-vs-block-size.md`
- Modify: `web/src/lib/db.ts`, `web/src/lib/db.test.ts`, `web/src/lib/fixtures.ts`, `web/src/lib/derive.ts`, `web/src/lib/derive.test.ts`, `web/src/lib/charts/types.ts`, `web/src/lib/charts/index.ts`, `web/src/lib/charts/index.test.ts`, `web/src/lib/charts/*.test.ts` (their `Filters`), `web/src/lib/hardware.test.ts`, `web/src/lib/state.svelte.ts`, `web/src/App.svelte`, `web/src/docs/charts/*.md`, `web/src/docs/kernels/{serial,parallel,gpu}.md`

**Interfaces:**
- Consumes: from Task 9, `Row.swept`.
- Produces:
  - In `derive.ts`: `KNOB_LABEL`, `knobLabel(name)`, `knobNames(rows)`, `knobValues(rows, name)`, `knobValuesFor(rows, name, precision, n)`, `pinKnobs(rows, precision, n, current) -> Record<string, number>` and `singleValueKernels(rows) -> Map<string, Set<string>>`.
  - `Filters.knobs: Record<string, number>` and `Ctx.singleKnob: Map<string, Set<string>>`.
  - `Control = "precision" | "n" | "kernel" | "knobs"` and `Tab.inertKnobs`.
  - `rowsForTab(tab, rows, precision, knobs, ctx)` and `knobSweep(name): ChartSpec`.
  - The tab id `knobs`, labelled "Tuning knobs".
  - `Row.block_size` is removed.

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/derive.test.ts`:
- **Imports:** replace `blockSizes, blockSizesFor, defaultBlockSizeFor, singleBlockSizeKernels` with `knobNames, knobValues, knobValuesFor, pinKnobs, singleValueKernels`.
- **Old tests:** replace everything from `const blockRows` through the `rows without a block size are not a block size` test with:

```ts
const knobRows: Row[] = [
	row({ kernel: "tiled", n: 64, gops: 10, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 128, gops: 12, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 256, gops: 14, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 64, gops: 9, swept: { tile_size: 64 } }),
	row({ kernel: "tiled", n: 128, gops: 11, swept: { tile_size: 64 } }),
	row({ kernel: "packed", n: 64, gops: 30, swept: { depth_block: 256 } }),
	row({ kernel: "ikj", n: 64, gops: 5 }),
];

test("knobNames lists each swept knob once, sorted", () => {
	expect(knobNames(knobRows)).toEqual(["depth_block", "tile_size"]);
});

test("knobValues lists one knob's values once, sorted", () => {
	expect(knobValues(knobRows, "tile_size")).toEqual([32, 64]);
	expect(knobValues(knobRows, "depth_block")).toEqual([256]);
});

test("knobValuesFor narrows to the given precision and n", () => {
	expect(knobValuesFor(knobRows, "tile_size", "f32", 64)).toEqual([32, 64]);
	expect(knobValuesFor(knobRows, "tile_size", "f32", 256)).toEqual([32]);
	expect(knobValuesFor(knobRows, "tile_size", "f16", 64)).toEqual([]);
});

test("pinKnobs keeps a pin still measured there and moves a stranded one to the smallest value", () => {
	// Tile 64 is valid at n=128, but n=256 has only 32 (the pickSize scenario).
	expect(pinKnobs(knobRows, "f32", 128, { tile_size: 64 })).toEqual({ tile_size: 64 });
	expect(pinKnobs(knobRows, "f32", 256, { tile_size: 64 })).toEqual({ tile_size: 32 });
	expect(pinKnobs(knobRows, "f32", 64, {})).toEqual({ depth_block: 256, tile_size: 32 });
});

test("pinKnobs leaves out a knob with no values at that size", () => {
	expect(pinKnobs(knobRows, "f32", 4096, { tile_size: 32 })).toEqual({});
});

test("singleValueKernels: per knob, the kernels measured at only one value", () => {
	const single = singleValueKernels(knobRows);
	expect(single.get("depth_block")?.has("packed")).toBe(true);
	expect(single.get("tile_size")?.has("tiled")).toBe(false);
	expect([...single.values()].some((kernels) => kernels.has("ikj"))).toBe(false);
});
```

In `web/src/lib/charts/index.test.ts`:
- **`f` literal:** `blockSize: 32,` becomes `knobs: {},`.
- **`cpuOnly` rows:** delete the four `block_size: 32,` lines; none of those kernels has a knob.
- **Controls test:** in `every tab declares its own controls`, the last tab id `"blocksize"` becomes `"knobs"`. Both `inertBlockSize` assertions become `inertKnobs` (`tab("knobs")?.inertKnobs` for the second), and the CPU tab's controls become `["precision", "knobs"]`.
- **Old tests:** replace the seven tests from `a non-selected block size does not leak into a pinned chart` through `the Overview is a family view: it keeps every block size` with:

```ts
/** A tab by id, failing the test if it's gone. */
function tabById(id: string) {
	const found = TABS.find((t) => t.id === id);
	if (!found) throw new Error(`no ${id} tab`);
	return found;
}

test("a non-selected tile size does not leak into a pinned chart", () => {
	// If rowsForTab stopped scoping by knob, the outlier at tile 64 would
	// survive into a chart pinned to tile 32.
	const twoTiles: Row[] = [
		row({ kernel: "tiled", n: 256, gops: 10, median_ms: 1, stddev_ms: 0, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 512, gops: 11, median_ms: 1, stddev_ms: 0, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 256, gops: 9999, median_ms: 1, stddev_ms: 0, swept: { tile_size: 64 } }),
	];
	const scoped = rowsForTab(tabById("cpu"), twoTiles, "f32", { tile_size: 32 }, makeCtx(twoTiles));
	expect(scoped.map((r) => r.swept.tile_size)).toEqual([32, 32]);
});

test("each knob pins only the kernels that sweep it", () => {
	const both: Row[] = [
		row({ kernel: "tiled", n: 256, gops: 10, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 256, gops: 12, swept: { tile_size: 64 } }),
		row({ kernel: "packed", n: 256, gops: 30, swept: { depth_block: 256 } }),
		row({ kernel: "packed", n: 256, gops: 35, swept: { depth_block: 512 } }),
	];
	const scoped = rowsForTab(tabById("cpu"), both, "f32", { tile_size: 64, depth_block: 256 }, makeCtx(both));
	expect(scoped.map((r) => r.gops)).toEqual([12, 30]);
});

test("the Tuning knobs tab is absent with one value per knob, present with two", () => {
	const one: Row[] = [
		row({ kernel: "tiled", n: 256, gops: 10, median_ms: 1, stddev_ms: 0, swept: { tile_size: 32 } }),
		row({ kernel: "packed", n: 256, gops: 20, median_ms: 1, stddev_ms: 0, swept: { depth_block: 256 } }),
	];
	const ids = (rows: Row[]) =>
		visibleTabs(rows, { ...f, precision: "f32", n: 256, knobs: { tile_size: 32, depth_block: 256 } }, makeCtx(rows)).map(
			(t) => t.id,
		);
	expect(ids(one)).not.toContain("knobs");
	const two = [...one, row({ kernel: "tiled", n: 256, gops: 12, median_ms: 1, stddev_ms: 0, swept: { tile_size: 64 } })];
	expect(ids(two)).toContain("knobs");
});

test("the GPU tab ignores knob pins: it is a family view", () => {
	const rows: Row[] = [
		row({ kernel: "mps", n: 256, gops: 93, backend: "metal", median_ms: 1, stddev_ms: 0 }),
		row({ kernel: "mps", n: 512, gops: 738, backend: "metal", median_ms: 1, stddev_ms: 0 }),
		row({ kernel: "rayon-tiled", n: 256, threads: 4, gops: 40, median_ms: 1, stddev_ms: 0, swept: { tile_size: 32 } }),
		row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 70, median_ms: 1, stddev_ms: 0, swept: { tile_size: 32 } }),
	];
	const ids = visibleTabs(rows, { ...f, precision: "f32", knobs: { tile_size: 64 } }, makeCtx(rows)).map((t) => t.id);
	expect(ids).toContain("gpu");
});

test("the GPU tab's CPU reference is the family's best tile size", () => {
	// rayon-tiled is faster at tile 64, the non-selected one; the GPU tab is a
	// family view, so its parallel reference is the family's best configuration.
	const rows: Row[] = [
		row({ kernel: "mps", n: 256, gops: 93, backend: "metal" }),
		row({ kernel: "mps", n: 512, gops: 738, backend: "metal" }),
		row({ kernel: "rayon-tiled", n: 256, threads: 4, gops: 40, swept: { tile_size: 32 } }),
		row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 45, swept: { tile_size: 32 } }),
		row({ kernel: "rayon-tiled", n: 256, threads: 4, gops: 60, swept: { tile_size: 64 } }),
		row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 70, swept: { tile_size: 64 } }),
	];
	const gpu = tabById("gpu");
	expect(gpu.inertKnobs).toBe(true);
	const ctx = makeCtx(rows);
	const scoped = rowsForTab(gpu, rows, "f32", { tile_size: 32 }, ctx);
	const spec = gpuKernels(scoped, { ...f, knobs: { tile_size: 32 } }, ctx);
	expect(pointsOf(spec, "parallel CPU").find((p) => p.x === 256)?.y).toBe(60);
});

test("rows without knobs, and a kernel measured at one value, survive any pin", () => {
	const mixed: Row[] = [
		row({ kernel: "ikj", n: 256, gops: 10, median_ms: 1, stddev_ms: 0 }),
		row({ kernel: "ikj", n: 512, gops: 11, median_ms: 1, stddev_ms: 0 }),
		row({ kernel: "tiled", n: 256, gops: 12, median_ms: 1, stddev_ms: 0, swept: { tile_size: 32 } }),
	];
	const scoped = rowsForTab(tabById("cpu"), mixed, "f32", { tile_size: 64 }, makeCtx(mixed));
	expect(scoped.map((r) => r.gops)).toEqual([10, 11, 12]);
});

test("the Overview is a family view: it keeps every knob value", () => {
	const rows: Row[] = [
		row({ kernel: "tiled", n: 256, gops: 10, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 512, gops: 11, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 256, gops: 20, swept: { tile_size: 64 } }),
	];
	expect(rowsForTab(tabById("overview"), rows, "f32", { tile_size: 32 }, makeCtx(rows))).toHaveLength(3);
});
```

In every other chart test's `Filters` literal, replace `blockSize: 32` with `knobs: {}`:

```bash
perl -pi -e 's/^\tblockSize: 32,$/\tknobs: {},/' web/src/lib/charts/*.test.ts
```

In `web/src/lib/hardware.test.ts`, `block_size: 64` becomes `swept: { tile_size: 64 }`.

Delete `web/src/lib/charts/blocksize.test.ts`, and create `web/src/lib/charts/knobs.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Row } from "../db";
import { legendOf, plotted, pointsOf, row } from "../fixtures";
import { knobSweep } from "./knobs";
import { type Filters, makeCtx } from "./types";

const f: Filters = { precision: "f32", n: 512, kernel: "rayon-ikj", knobs: {}, relative: false };
const tileSweep = knobSweep("tile_size");

const rows: Row[] = [
	row({ kernel: "tiled", n: 512, gops: 30, swept: { tile_size: 32 } }),
	row({ kernel: "tiled", n: 512, gops: 50, swept: { tile_size: 64 } }),
	row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 20, swept: { tile_size: 32 } }),
	row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 20.1, swept: { tile_size: 64 } }),
];

test("the sweep builds when a knob has two values", () => {
	expect(tileSweep(rows, f, makeCtx(rows))).not.toBeNull();
});

test("a single value is not a sweep", () => {
	const single = rows.filter((r) => r.swept.tile_size === 32);
	expect(tileSweep(single, f, makeCtx(single))).toBeNull();
});

test("no rows, no chart", () => {
	expect(tileSweep([], f, makeCtx([]))).toBeNull();
});

test("pins n: a row at another size does not leak into the sweep", () => {
	const otherSize = [...rows, row({ kernel: "tiled", n: 1024, gops: 999, swept: { tile_size: 128 } })];
	const spec = tileSweep(otherSize, f, makeCtx(otherSize));
	expect(spec?.layout.xaxis?.tickvals).toEqual([32, 64]);
	expect(pointsOf(spec, "tiled").some((p) => p.x === 128)).toBe(false);
});

test("takes the best result per (kernel, value), whatever thread count got it", () => {
	const withThreads: Row[] = [
		row({ kernel: "rayon-tiled", n: 512, gops: 10, swept: { tile_size: 32 } }),
		row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 90, swept: { tile_size: 32 } }),
		row({ kernel: "rayon-tiled", n: 512, threads: 4, gops: 95, swept: { tile_size: 64 } }),
	];
	const spec = tileSweep(withThreads, f, makeCtx(withThreads));
	expect(pointsOf(spec, "rayon-tiled").find((p) => p.x === 32)?.y).toBe(90);
});

test("a kernel missing a value gets an explicit gap", () => {
	const ragged: Row[] = [
		row({ kernel: "tiled", n: 512, gops: 30, swept: { tile_size: 32 } }),
		row({ kernel: "tiled", n: 512, gops: 50, swept: { tile_size: 64 } }),
		row({ kernel: "rayon-tiled", n: 512, gops: 20, swept: { tile_size: 32 } }),
		// rayon-tiled has tile 64 only at n=1024, so across the dataset it does sweep.
		row({ kernel: "rayon-tiled", n: 1024, gops: 22, swept: { tile_size: 64 } }),
	];
	const spec = tileSweep(ragged, f, makeCtx(ragged));
	expect(pointsOf(spec, "rayon-tiled").find((p) => p.x === 64)?.y).toBeNull();
});

test("a kernel measured at one value is left out, even at a dominant gops", () => {
	const withDominant = [...rows, row({ kernel: "static-tiled", n: 512, threads: 4, gops: 660, swept: { tile_size: 32 } })];
	const spec = tileSweep(withDominant, f, makeCtx(withDominant));
	expect(Math.max(...plotted(spec).map((p) => Number(p.y)))).toBe(50);
	expect(legendOf(spec).names).not.toContain("static-tiled");
});

test("the legend lists only the kernels actually plotted", () => {
	const unplotted = [...rows, row({ kernel: "static-tiled", n: 1024, threads: 4, gops: 200, swept: { tile_size: 32 } })];
	expect(legendOf(tileSweep(unplotted, f, makeCtx(unplotted))).names.sort()).toEqual(["rayon-tiled", "tiled"]);
});

test("kernels that don't sweep this knob are never plotted", () => {
	const others = [
		...rows,
		row({ kernel: "packed", n: 512, gops: 80, swept: { depth_block: 256 } }),
		row({ kernel: "packed", n: 512, gops: 85, swept: { depth_block: 512 } }),
		row({ kernel: "ikj", n: 512, gops: 25 }),
	];
	expect(legendOf(tileSweep(others, f, makeCtx(others))).names.sort()).toEqual(["rayon-tiled", "tiled"]);
});

test("the x-axis is named after the knob", () => {
	const title = (spec: ReturnType<typeof tileSweep>) => (spec?.layout.xaxis?.title as { text?: string })?.text;
	expect(title(tileSweep(rows, f, makeCtx(rows)))).toBe("Tile size");
	const packed = [
		row({ kernel: "packed", n: 512, gops: 80, swept: { depth_block: 256 } }),
		row({ kernel: "packed", n: 512, gops: 85, swept: { depth_block: 512 } }),
	];
	expect(title(knobSweep("depth_block")(packed, f, makeCtx(packed)))).toBe("Depth block");
});
```

In `web/src/lib/db.test.ts`, delete the two `block_size` assertions in `swept params tell cells apart; other params ride along`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test`
Expected: FAIL. The knob functions, `./knobs` and `Filters.knobs` don't exist yet.

- [ ] **Step 3: Implement the knob helpers**

In `web/src/lib/derive.ts`, delete `hasBlockSize`, `blockSizes`, `blockSizesFor`, `defaultBlockSizeFor` and `singleBlockSizeKernels`. In their place, after `allSizes`, add:

```ts
/** Display names of the swept knobs; an unknown knob shows its params.name. */
export const KNOB_LABEL: Record<string, string> = {
	tile_size: "Tile size",
	depth_block: "Depth block",
};

export const knobLabel = (name: string): string => KNOB_LABEL[name] ?? name;

/** Every swept knob in the rows, once each, sorted: one pill group per knob. */
export function knobNames(rows: Row[]): string[] {
	return [...new Set(rows.flatMap((r) => Object.keys(r.swept)))].sort();
}

/** One knob's values, once each, sorted. */
export function knobValues(rows: Row[], name: string): number[] {
	return [...new Set(rows.flatMap((r) => (name in r.swept ? [r.swept[name]] : [])))].sort(ascending);
}

/** One knob's values at a precision and size: the pills selectable there. */
export function knobValuesFor(rows: Row[], name: string, precision: string, n: number): number[] {
	return knobValues(
		rows.filter((r) => r.precision === precision && r.n === n),
		name,
	);
}

/**
 * Every knob's pin, kept valid at (precision, n): a pin still measured there
 * stays, any other falls back to the smallest value there, and a knob with
 * no values there has no pin.
 */
export function pinKnobs(
	rows: Row[],
	precision: string,
	n: number,
	current: Record<string, number>,
): Record<string, number> {
	const pins: Record<string, number> = {};
	for (const name of knobNames(rows)) {
		const values = knobValuesFor(rows, name, precision, n);
		if (values.length === 0) continue;
		pins[name] = values.includes(current[name]) ? current[name] : values[0];
	}
	return pins;
}

/**
 * Per knob, the kernels measured at only one value of it in the whole
 * dataset: the knob doesn't vary for them, so a pin must not filter them away.
 */
export function singleValueKernels(rows: Row[]): Map<string, Set<string>> {
	const seen = new Map<string, Map<string, Set<number>>>();
	for (const r of rows) {
		for (const [name, value] of Object.entries(r.swept)) {
			const byKernel = seen.get(name) ?? new Map<string, Set<number>>();
			const values = byKernel.get(r.kernel) ?? new Set<number>();
			values.add(value);
			byKernel.set(r.kernel, values);
			seen.set(name, byKernel);
		}
	}
	return new Map(
		[...seen].map(([name, byKernel]) => [
			name,
			new Set([...byKernel].filter(([, values]) => values.size === 1).map(([kernel]) => kernel)),
		]),
	);
}
```

Also in `derive.ts`, the `bestPerFamily` doc says "whatever kernel, thread count or block size produced it": make that "thread count or knob value".

In `web/src/lib/db.ts`, delete `block_size` from `Row`, from the `Omit<…>` in `LatestRow`, and from `readRows` (also the `values` constant). In `web/src/lib/fixtures.ts`, delete `block_size: null,`.

- [ ] **Step 4: Filters, context, tabs, scoping**

In `web/src/lib/charts/types.ts`:
- **Import:** replace `singleBlockSizeKernels` with `singleValueKernels`.
- **`Filters`:** `blockSize: number;` becomes `knobs: Record<string, number>;`, documented as `/** The pinned value of each swept knob, by params.name. */`.
- **`Ctx`:** replace `singleBlockSize: Set<string>;` and its comment with:

```ts
	/** Per knob, the kernels measured at only one value of it: the knob does
	 *  not vary for them, so a pin must not filter them away. */
	singleKnob: Map<string, Set<string>>;
```

- **`makeCtx`:** `singleBlockSize: singleBlockSizeKernels(allRows),` becomes `singleKnob: singleValueKernels(allRows),`.

Create `web/src/lib/charts/knobs.ts` (and delete `blocksize.ts`):

```ts
import { knobLabel } from "../derive";
import {
	AXIS,
	BASE_LAYOUT,
	type ChartSpec,
	LABELLED_MARGIN,
	lineTraces,
	log2Axis,
	log2Ticks,
} from "./types";

type KnobPoint = { value: number; kernel: string; gops: number };

/**
 * One line per kernel that sweeps the knob `name`: x is the knob's value and
 * y the kernel's best result there at the pinned N, whatever thread count got
 * it, the same way the size chart takes each kernel's best across threads.
 */
export function knobSweep(name: string): ChartSpec {
	return (rows, f, ctx) => {
		// A kernel measured at one value has nothing to sweep: its lone point
		// would only stretch the linear y-axis and squash the kernels that vary.
		const atSize = rows.filter(
			(r) =>
				name in r.swept &&
				r.n === f.n &&
				ctx.palette.has(r.kernel) &&
				!ctx.singleKnob.get(name)?.has(r.kernel),
		);
		const best = new Map<string, KnobPoint>();
		for (const r of atSize) {
			const value = r.swept[name];
			const key = `${r.kernel}\u0000${value}`;
			const current = best.get(key);
			if (!current || r.gops > current.gops) best.set(key, { value, kernel: r.kernel, gops: r.gops });
		}
		const points = [...best.values()];
		const xs = log2Ticks(points.map((p) => p.value));
		if (xs.length < 2) return null;

		// Scoped to what's plotted, so the legend never lists a kernel this chart doesn't draw.
		const present = [...new Set(points.map((p) => p.kernel))];
		const showLabels = present.length <= 4;
		return {
			data: lineTraces(
				points.map((p) => ({ series: p.kernel, x: p.value, y: p.gops, custom: [] })),
				{
					order: present,
					color: (k) => ctx.palette.get(k) as string,
					xs,
					labels: showLabels,
					hovertemplate: "<b>%{y:.1f} GOP/s</b>  %{fullData.name}<extra></extra>",
				},
			),
			layout: {
				...BASE_LAYOUT,
				...(showLabels ? { margin: LABELLED_MARGIN } : {}),
				xaxis: log2Axis(xs, knobLabel(name)),
				yaxis: { ...AXIS, type: "linear", title: { text: "GOP/s" } },
			},
		};
	};
}
```

In `web/src/lib/charts/index.ts`:
- **Imports:**
  - Replace `import throughputVsBlockSizeDoc from "../../docs/charts/throughput-vs-block-size.md?raw";` with `import throughputVsDepthBlockDoc from "../../docs/charts/throughput-vs-depth-block.md?raw";` and `import throughputVsTileSizeDoc from "../../docs/charts/throughput-vs-tile-size.md?raw";`, keeping the imports sorted.
  - Replace `import { blockSizeSweep } from "./blocksize";` with `import { knobSweep } from "./knobs";`.
- **`Control`:** becomes `"precision" | "n" | "kernel" | "knobs"`.
- **`Tab`:** replace `inertBlockSize?: boolean` and its comment with:

```ts
	/**
	 * Knobs (tile size, depth block) are not a dimension of this tab: no
	 * pills, and rowsForTab doesn't scope by them. Either a knob is the x-axis
	 * (Tuning knobs) or the tab shows each family's best configuration
	 * (Overview, Precision, GPU), the way bestPerKernel takes the best thread
	 * count. A kernel measured at one value of a knob is exempted from scoping
	 * automatically via `ctx.singleKnob`; that is a property of the data, so it
	 * is never a reason to set this flag.
	 */
	inertKnobs?: boolean;
```

- **`TABS`:**
  - Rename every `inertBlockSize: true` to `inertKnobs: true`, and every `"blockSize"` control to `"knobs"`.
  - Notes on the CPU tab: `"Each kernel's best thread count, at the selected tile size and depth block · log–log · band is ±1 stddev"` and `"Loop order, cache blocking and register blocking on one core, at the selected knobs, on their own scale"`.
  - Note on the threading tab's first panel: `"Work-stealing vs fixed partitioning at the selected size and knobs · linear axes"`.
  - Replace the `blocksize` tab with:

```ts
	{
		id: "knobs",
		label: "Tuning knobs",
		controls: ["precision", "n"],
		inertKnobs: true,
		panels: [
			{
				title: "Throughput vs tile size",
				note: "Each tiled kernel's best result at each tile edge, at the selected size · small wobbles are noise",
				doc: throughputVsTileSizeDoc,
				spec: knobSweep("tile_size"),
			},
			{
				title: "Throughput vs depth block",
				note: "Each packed kernel's best result at each k-block depth (KC), at the selected size · small wobbles are noise",
				doc: throughputVsDepthBlockDoc,
				spec: knobSweep("depth_block"),
			},
		],
	},
```

- **`rowsForTab`:** replace it and its doc comment's block-size sentences with:

```ts
/**
 * The rows a tab actually renders. A tab with inertPrecision needs every
 * precision (precision is its x-axis); a tab with inertKnobs needs every knob
 * value. Every other tab is scoped to the selected precision and to each
 * knob's pin, except a kernel measured at only one value of a knob, which
 * that knob's pin never filters away. A row with no knobs is never filtered
 * by a pin. This is the single place scoping happens: visibility and
 * rendering must agree, or a tab can appear and then render nothing.
 */
export function rowsForTab(
	tab: Tab,
	rows: Row[],
	precision: string,
	knobs: Record<string, number>,
	ctx: Ctx,
): Row[] {
	return rows.filter(
		(r) =>
			(tab.inertPrecision || r.precision === precision) &&
			(tab.inertKnobs ||
				Object.entries(r.swept).every(
					([name, value]) => ctx.singleKnob.get(name)?.has(r.kernel) || knobs[name] === value,
				)),
	);
}
```

- **`visibleTabs`:** pass `f.knobs` in place of `f.blockSize`.

- [ ] **Step 5: State and pills**

In `web/src/lib/state.svelte.ts`:
- **Import:** replace `defaultBlockSizeFor` with `pinKnobs`.
- **`store`:** `blockSize: 0,` becomes `knobs: {} as Record<string, number>,`.
- **`boot`:** the `store.blockSize = …` line becomes `store.knobs = pinKnobs(rows, store.precision, store.n, {});`.

In `web/src/App.svelte`:
- **Imports:** replace `blockSizes, blockSizesFor, defaultBlockSizeFor` with `knobLabel, knobNames, knobValues, knobValuesFor, pinKnobs`.
- **`filters`:** `blockSize: store.blockSize,` becomes `knobs: store.knobs,`.
- **`scoped`:** pass `store.knobs` in place of `store.blockSize`.
- **Derivations and handlers:**
  - Delete `availableBlockSizes` and `pickBlockSize`.
  - In `pickPrecision`, replace the block-size `if` with `store.knobs = pinKnobs(store.rows, p, store.n, store.knobs);`.
  - In `pickSize`, replace its `if` with `store.knobs = pinKnobs(store.rows, store.precision, s, store.knobs);`.
- **Template:** replace the `{#if tab.controls.includes("blockSize")} … {/if}` block with:

```svelte
				{#if tab.controls.includes("knobs")}
					{#each knobNames(store.rows) as name (name)}
						{@const here = knobValuesFor(store.rows, name, store.precision, store.n)}
						<PickerGroup
							label={knobLabel(name)}
							items={knobValues(store.rows, name)}
							selected={store.knobs[name] ?? 0}
							disabled={(v) => !here.includes(v)}
							title={(v) =>
								here.includes(v)
									? ""
									: `no ${store.precision} ${knobLabel(name).toLowerCase()} ${v} runs at N = ${store.n}`}
							onSelect={(v) => (store.knobs = { ...store.knobs, [name]: v })} />
					{/each}
				{/if}
```

- [ ] **Step 6: Docs**

Delete `web/src/docs/charts/throughput-vs-block-size.md`. Create `web/src/docs/charts/throughput-vs-tile-size.md`:

```markdown
**What it shows.** Each tiled kernel's throughput (`tiled`, `static-tiled`, `rayon-tiled`) at every tile size measured, at the selected precision and matrix size. The tile size is the edge of the square block of A, B and C each loop works on. Each point is the kernel's best thread count at that tile size. The x-axis is logarithmic and the y-axis linear.

**How to read it.** Smaller tiles fit in faster caches; larger ones spend less time on loop bookkeeping. The top of each line is that kernel's best tile size for this matrix size. Tiles of 1024 fall off a power-of-two cache-aliasing cliff, which is why the default sweep stops at 256.

**Caveats.** A kernel measured at a single tile size has nothing to sweep and is left out. Read a large, consistent change as a real effect and a small wobble as run-to-run noise.
```

Create `web/src/docs/charts/throughput-vs-depth-block.md`:

```markdown
**What it shows.** Each packed kernel's throughput (`packed`, `rayon-packed`) at every depth block measured, at the selected precision and matrix size. The depth block (BLIS's KC, `--kc`) is how many steps along the shared dimension each packed slice of A and B covers. Each point is the kernel's best thread count at that depth. The x-axis is logarithmic and the y-axis linear.

**How to read it.** A deeper block adds each register block into C less often, and with threads it saves a round of packing and synchronisation, but its packed slices take more cache. Once the depth reaches N, deeper requests change nothing: the kernel records the depth it actually used as `depth_block_used`.

**Caveats.** A kernel measured at a single depth has nothing to sweep and is left out. In `f16` the depth also moves the error, because each block's sum starts afresh: see the Precision tab's accuracy chart.
```

Update the remaining "block size" wording:

```bash
cd web/src
perl -pi -e '
  s/thread count and block size/thread count, tile size and depth block/g;
  s/precision and block size/precision, tile size and depth block/g;
  s/matrix size and block size/matrix size, tile size and depth block/g;
  s/at the selected block size/at the selected tile size and depth block/g;
  s/Kernels without a block size ignore the block-size pill\./A kernel without a tile size or depth block ignores those pills./g;
' docs/charts/*.md
```

In `docs/kernels/serial.md`:
- **`tiled`:**
  - "whose edge is the block size" becomes "whose edge is the tile size".
  - `# b = block size` becomes `# b = tile size`.
  - "at each block size measured" becomes "at each tile size measured".
  - "- **Tunes:** Block size." becomes "- **Tunes:** Tile size (`--tile-size`)."
  - "the Block size tab compares them" becomes "the Tuning knobs tab compares them".
- **`packed`:**
  - `# b = block size: the k-block depth` becomes `# b = depth block (KC): the k-block depth`.
  - "- **Tunes:** Block size, as the depth of each packed k-block." becomes "- **Tunes:** Depth block (`--depth-block`, alias `--kc`, BLIS's KC): the depth of each packed k-block."
  - "So the block size moves the error" becomes "So the depth block moves the error".

In `docs/kernels/parallel.md`, change the three "**Tunes:**" lines:
- `rayon-tiled` and `static-tiled`: "Thread count and tile size (`--tile-size`)."
- `rayon-packed`: "Thread count and depth block (`--depth-block`, alias `--kc`)."

In `docs/kernels/gpu.md`, "so the block size doesn't apply" becomes "so no knob applies".

Run: `grep -rn -i 'block.size\|blockSize\|block_size\|singleBlock' web/src`
Expected: no output.

- [ ] **Step 7: Typecheck, test, look, commit**

Run: `bun run typecheck && bun test` (in `web/`)
Expected: PASS. `index.test.ts` checks that every panel title has its doc file and that every doc file belongs to a panel.

Run a quick bench (as in Task 9 Step 10) and `preview_start` the dashboard. Check that:
- The CPU tab shows "Tile size" and "Depth block" pill groups.
- The Tuning knobs tab draws both charts with their axis titles.

Then `rm data/db/paulhondola/m1pro.sqlite`.

From the repo root: `just lint && just check && just test`

```bash
git add web
git commit -m "Replace the block-size pill and chart with one per knob

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Host Selector, Machine Panel, and GPU Peaks by Core Count

**Files:**
- Create: `web/src/lib/machine.ts`, `web/src/lib/machine.test.ts`, `web/src/lib/MachineTable.svelte`
- Modify: `web/src/App.svelte`, `web/src/lib/About.svelte`, `web/src/lib/derive.ts`, `web/src/lib/derive.test.ts`, `web/src/lib/charts/types.ts`, `web/src/lib/charts/types.test.ts`, `web/src/lib/hardware.ts`, `web/src/lib/fixtures.ts`

**Interfaces:**
- Consumes: from Task 9, `store.hosts`, `store.host`, `store.machine`, `Machine` and `Row.gpu_cores`.
- Produces:
  - In `machine.ts`: `tierSummary(tiers)`, `machineLabel(machine)`, `formatBytes(n)` and `cacheLabel(cache)`.
  - In `derive.ts`: `familyPeak(peaks, family, device, precision, gpuCores?: number | null)`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/machine.test.ts`:

```ts
import { expect, test } from "bun:test";
import type { Machine } from "./db";
import { cacheLabel, formatBytes, machineLabel, tierSummary } from "./machine";

const m1Pro: Machine = {
	started_at: "2026-10-02T00:00:00Z",
	os: "macOS 27.0.1",
	arch: "aarch64",
	target_features: "dotprod fp16 neon",
	rustc_version: "rustc 1.101.0-nightly",
	cpu: "Apple M1 Pro",
	available_parallelism: 10,
	gpu: "Apple M1 Pro",
	gpu_cores: 16,
	tiers: [
		{ tier: 0, name: "Performance", cores: 8, logical_cpus: 8 },
		{ tier: 1, name: "Efficiency", cores: 2, logical_cpus: 2 },
	],
	caches: [],
};

test("tierSummary tags each tier with its name's initial", () => {
	expect(tierSummary(m1Pro.tiers)).toBe("8P + 2E");
	expect(tierSummary([{ tier: 0, name: null, cores: 16, logical_cpus: 32 }])).toBe("16");
	expect(tierSummary([])).toBe("");
});

test("machineLabel names the CPU, its tiers and the GPU", () => {
	expect(machineLabel(m1Pro)).toBe("Apple M1 Pro · 8P + 2E · 16-core GPU");
	expect(machineLabel({ ...m1Pro, gpu: null, gpu_cores: null, tiers: [] })).toBe("Apple M1 Pro");
});

test("formatBytes picks the largest whole unit", () => {
	expect(formatBytes(65536)).toBe("64 KB");
	expect(formatBytes(12582912)).toBe("12 MB");
	expect(formatBytes(1310720)).toBe("1280 KB");
	expect(formatBytes(100)).toBe("100 B");
});

test("cacheLabel reads like a spec sheet", () => {
	expect(
		cacheLabel({ tier: 0, level: 2, kind: "unified", size_bytes: 12 << 20, line_bytes: 128, shared_by: 4, instances: 2 }),
	).toBe("L2 unified · 12 MB · shared by 4 · ×2");
});
```

In `web/src/lib/derive.test.ts`:
- **GPU ceilings take a core count:** pass `16` as the fifth argument to every `familyPeak(…, "gpu", …)` call in the existing tests (`gpu takes the metal row, never a cpu one`, `another device gets nothing`, `an integer precision gets nothing…`).
- **New test:**

```ts
test("familyPeak: a GPU ceiling needs the run's core count to match", () => {
	// The 14- and 16-core M1 Pro GPUs report the same name.
	expect(familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "f32", 14)).toBeUndefined();
	expect(familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "f32", null)).toBeUndefined();
	expect(familyPeak(M1_PEAKS, "gpu", "Apple M1 Pro", "f32", 16)?.gflops).toBe(5308);
});
```

In `web/src/lib/charts/types.test.ts`, in `each family's ceiling carries its own label and figure`, the GPU assertion reads a plain CPU row, which now carries no GPU core count. Give that call its own row:

```ts
	expect(ceilingOf([row({ kernel: "k", n: 64, gops: 1, gpu_cores: 16 })], "gpu", ctx)).toEqual({
		family: "gpu",
		gflops: 5308,
		label: "GPU peak",
	});
```

Then add after that test:

```ts
test("a 14-core GPU gets no ceiling from the 16-core row", () => {
	const rows = [row({ kernel: "k", n: 64, gops: 1, gpu_cores: 14 })];
	expect(ceilingOf(rows, "gpu", ctx)).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test src/lib/machine.test.ts src/lib/derive.test.ts src/lib/charts/types.test.ts`
Expected: FAIL. `./machine` doesn't exist, and `familyPeak` ignores the core count.

- [ ] **Step 3: Implement**

Create `web/src/lib/machine.ts`:

```ts
import type { Cache, CoreTier, Machine } from "./db";

/** "8P + 2E": each tier's cores, tagged with the initial of the OS's name for it. */
export function tierSummary(tiers: CoreTier[]): string {
	return tiers.map((t) => `${t.cores}${t.name?.[0] ?? ""}`).join(" + ");
}

/** The line under the host picker: CPU, core tiers, GPU. */
export function machineLabel(m: Machine): string {
	const gpu = m.gpu && m.gpu_cores ? `${m.gpu_cores}-core GPU` : (m.gpu ?? "");
	return [m.cpu, tierSummary(m.tiers), gpu].filter((part) => part !== "").join(" · ");
}

/** 65536 → "64 KB", 12582912 → "12 MB": the largest unit that divides evenly. */
export function formatBytes(n: number): string {
	if (n >= 1 << 20 && n % (1 << 20) === 0) return `${n / (1 << 20)} MB`;
	if (n >= 1 << 10 && n % (1 << 10) === 0) return `${n / (1 << 10)} KB`;
	return `${n} B`;
}

/** "L2 unified · 12 MB · shared by 4 · ×2". */
export function cacheLabel(c: Cache): string {
	return [`L${c.level} ${c.kind}`, formatBytes(c.size_bytes), `shared by ${c.shared_by}`, `×${c.instances}`].join(" · ");
}
```

In `web/src/lib/derive.ts`, give `familyPeak` a fifth parameter, `gpuCores: number | null = null`, and replace the `gpu` case:

```ts
		case "gpu":
			// The 14- and 16-core M1 Pro GPUs report the same name, so only the
			// run's core count picks the right ceiling; without one, none.
			return gpuCores == null
				? undefined
				: own.find((p) => p.backend === "metal" && p.cores === gpuCores);
```

Add a line to its doc comment: "A GPU ceiling must also match the run's GPU core count."

In `web/src/lib/charts/types.ts`, inside `ceilingOf`, before `familyPeak` is called, add:

```ts
	const cores = new Set(rows.map((r) => r.gpu_cores));
	const gpuCores = cores.size === 1 ? [...cores][0] : null;
```

Then pass `gpuCores` as `familyPeak`'s fifth argument.

In `web/src/lib/hardware.ts`, inside `engineRows`'s `devices.flatMap((device) => …)`, add:

```ts
		const gpuCores = rows.find((r) => r.device === device && r.gpu_cores !== null)?.gpu_cores ?? null;
```

Then pass it as the fifth argument of its `familyPeak` call.

In `web/src/lib/fixtures.ts`, make Metal test rows look like this M1 Pro's: in `row`, `gpu_cores: null,` becomes `gpu_cores: fields.backend === "metal" ? 16 : null,` (it stays before `...fields`).

Create `web/src/lib/MachineTable.svelte`:

```svelte
<script lang="ts">
import type { Machine } from "./db";
import { cacheLabel } from "./machine";

const { machine }: { machine: Machine } = $props();

const tierName = (tier: number | null) =>
	tier === null ? "Shared" : (machine.tiers.find((t) => t.tier === tier)?.name ?? `Tier ${tier}`);
</script>

<!-- Every value here comes from a contributor's machine: text only, never {@html}. -->
<table>
	<tbody>
		<tr><th>CPU</th><td>{machine.cpu}</td></tr>
		{#each machine.tiers as t (t.tier)}
			<tr><th>{t.name ?? `Tier ${t.tier}`} cores</th><td>{t.cores} cores, {t.logical_cpus} threads</td></tr>
		{/each}
		{#each machine.caches as c, i (i)}
			<tr><th>{tierName(c.tier)} cache</th><td>{cacheLabel(c)}</td></tr>
		{/each}
		{#if machine.gpu}
			<tr><th>GPU</th><td>{machine.gpu}{machine.gpu_cores ? `, ${machine.gpu_cores} cores` : ""}</td></tr>
		{/if}
		<tr><th>OS</th><td>{machine.os}</td></tr>
		<tr><th>Build</th><td>{machine.arch} · {machine.target_features || "baseline"} · {machine.rustc_version}</td></tr>
		<tr><th>Threads available</th><td>{machine.available_parallelism}</td></tr>
		<tr><th>Recorded</th><td>{machine.started_at}</td></tr>
	</tbody>
</table>

<style>
	table {
		border-collapse: collapse;
		font-family: "IBM Plex Mono", monospace;
		font-size: 12px;
		margin: 12px 0;
	}
	th,
	td {
		padding: 4px 12px 4px 0;
		text-align: left;
		border-bottom: 1px solid #24292e;
	}
	th {
		color: #9aa1a8;
		font-weight: 500;
		white-space: nowrap;
	}
</style>
```

In `web/src/lib/About.svelte`:
- **Imports:** add `type Machine` to the `./db` import and `import MachineTable from "./MachineTable.svelte";`.
- **Props:** add `machine` to the destructured props, with type `machine: Machine | undefined`.
- **Template:** in the "Hardware tested" section, just before `<HardwareTable …/>`, add `{#if machine}<MachineTable {machine} />{/if}`.

In `web/src/App.svelte`:
- **Imports:** add `import { machineLabel } from "./lib/machine";`.
- **Handler:** add to the script:

```ts
/** Loads another host as a fresh page: no picker state carries over from the last one. */
function selectHost(id: string) {
	location.search = new URLSearchParams({ host: id }).toString();
}
```

- **Header:** inside `<header>`, after the existing `<p>`, add:

```svelte
		{#if store.hosts.length > 0}
			<div class="host">
				<label>
					Host
					<select value={store.host?.id} onchange={(e) => selectHost(e.currentTarget.value)}>
						{#each store.hosts as h (h.id)}<option value={h.id}>{h.id}</option>{/each}
					</select>
				</label>
				{#if store.machine}<span class="muted">{machineLabel(store.machine)}</span>{/if}
			</div>
		{/if}
```

- **About:** pass `machine={store.machine}` to `<About …/>`.
- **Style:** add:

```css
	.host {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
		font-size: 13px;
		color: #9aa1a8;
	}
	.host select {
		margin-left: 6px;
		font: inherit;
	}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun run typecheck && bun test`
Expected: PASS. The fixture's Metal rows carry `gpu_cores: 16`, so the existing GPU ceiling tests keep finding the 16-core peak.

- [ ] **Step 5: Look at it**

Write two local host databases, start the dashboard, and switch between them:

```bash
just bench --config configs/quick.toml --no-progress
mkdir -p data/db/test-host
just bench --sizes 64 --kernel ikj --precision f32 --no-progress --output data/db/test-host/other.sqlite
```

With `preview_start` (`dashboard`), check:
- The Host picker lists both hosts, and the header line reads like `Apple M1 Pro · 8P + 2E · 16-core GPU`.
- Picking `test-host/other` reloads with `?host=test-host%2Fother` and shows only `ikj`.
- The About tab shows the machine table.
- The GPU charts on `paulhondola/m1pro` still draw the GPU ceiling.

Take a screenshot as proof. Then delete both local databases:

```bash
rm -r data/db/test-host data/db/paulhondola/m1pro.sqlite
```

- [ ] **Step 6: Lint and commit**

From the repo root: `just lint && just check && just test`

```bash
git add web
git commit -m "Add a host picker and machine table, and match GPU peaks on core count

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase C: Docs and Cutover

### Task 13: Document the New Pipeline

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `.claude/agents/adversarial-reviewer.md`, `.claude/agents/dashboard-designer.md`, `.claude/skills/bench-compare/SKILL.md`

**Interfaces:**
- Consumes: the commands, flags and files from Tasks 1–12. The DuckDB lines stay until Task 14 removes DuckDB itself, but nothing written here mentions DuckDB.

- [ ] **Step 1: README, line by line**

Apply each replacement (old text → new text) in `README.md`:

| Where | Old | New |
| :--- | :--- | :--- |
| Layout table, `data/` row | `Benchmark runs as \`runs/<host>/<timestamp>.csv\`, and \`build.sql\`, which validates and merges them for the dashboard.` | `One SQLite database per host at \`db/<github-login>/<machine>.sqlite\`, the schema they share (\`schema.sql\`), and hand-curated hardware peaks (\`peaks.csv\`).` |
| Prerequisites | the whole `[DuckDB CLI]` row | *(delete the row)* |
| `just bench` row | `Results go to \`data/runs/<host>/<timestamp>.csv\` unless \`--output\` is given.` | `Each run is added to \`data/db/<github-login>/<machine>.sqlite\` (named once with \`just init\`) unless \`--output\` is given.` |
| `just build` row | `` `just build-web` (`just data`, then `bun install && bun run build`) `` | `` `just build-web` (`bun install && bun run build`) `` |
| `just data` row | the whole row | two rows: `` \| `just init <login>/<machine>` \| writes `.host` \| Name this machine once, as your GitHub login and a machine name (e.g. `just init octocat/m1pro`). `just bench` then writes to `data/db/<login>/<machine>.sqlite`; `.host` is git-ignored. \| `` and `` \| `just validate` \| `gemm-bench validate data/db/*/*.sqlite` \| Check every committed host database the way CI does (see [Benchmark Data](#benchmark-data)). \| `` |
| Kernel table, `packed` | `` `--block-size` sets the k-block depth. `` | `` `--depth-block` (alias `--kc`) sets the k-block depth. `` |
| Kernel table, `metal-tiled` | `` The tile is fixed; `--block-size` does not apply. `` | `The tile is fixed, so no knob applies.` |
| The Full Sweep | `` `--precision`, `--block-size`) `` | `` `--precision`, `--tile-size`, `--depth-block`) `` |
| The Full Sweep | `` and block sizes `16`–`256`. `` | `` tile sizes `16`–`256` and depth blocks `64`–`1024`. `` |
| Presets example | `# f32, block 64, everything else swept` | `# f32, tile 64, depth block 256, everything else swept` |
| Presets table | `` precision `f32`, block size `64` `` | `` precision `f32`, tile size `64`, depth block `256` `` |
| Presets table | `` sizes `64,256`, `f32`, block `64`, 3 repetitions `` | `` sizes `64,256`, `f32`, tile `64`, depth block `256`, 3 repetitions `` |
| Presets table | `` size `1024`, block `64`, `ikj,rayon-ikj,mps` `` | `` size `1024`, `ikj,rayon-ikj,mps` `` |
| Presets table | `` \| `block-sizes.toml` \| sizes `512,1024,2048`, `f32`, the tiled kernels \| Block-size sweep \| `` | `` \| `knobs.toml` \| sizes `512,1024,2048`, `f32`, the tiled and packed kernels \| Every tile size and depth block \| `` |
| Cache-locality example | `--block-size 64` | `--tile-size 64` |
| CLI Options | the `--block-size` row | `` \| `--tile-size <T,...>` (alias `--tile`) \| Tile edge(s) for `tiled`, `static-tiled` and `rayon-tiled`, comma-delimited. Naming it when no selected kernel sweeps it is an error \| All: `16,32,64,128,256` \| `` and `` \| `--depth-block <D,...>` (alias `--kc`) \| Depth of each packed k-block (BLIS's KC) for `packed` and `rayon-packed`, comma-delimited. Naming it when no selected kernel sweeps it is an error \| All: `64,128,256,512,1024` \| `` |
| CLI Options | the `--output` row | `` \| `--output <FILE.sqlite>` \| Database to add the run to; must have a `.sqlite` extension. Missing parent directories are created, a new file gets `data/schema.sql`, and a file that isn't a gemm-bench database (or already holds a run started in the same second) is refused before anything runs \| `data/db/<login>/<machine>.sqlite`, from `.host` \| `` |
| CLI Options | `` (`sizes`, `threads`, `kernel`, `precision`, `block-size`, `repetitions`) `` | `` (`sizes`, `threads`, `kernel`, `precision`, `tile-size` or `tile`, `depth-block` or `kc`, `repetitions`) `` |
| Methodology 4 | `` `--output` must be a `.csv` file path, not a directory. `` | `` `--output` must be a `.sqlite` file path, not a directory, and an existing file must be a gemm-bench database without a run started in the same second. A `--tile-size` or `--depth-block` given explicitly that no selected kernel sweeps is rejected. `` |

Add one row to the CLI Options table, after `--config`:

```markdown
| `validate <DB...>` | Subcommand: check host databases (path, size, stamps, integrity, schema, kernels, params, runs, text) and print `ok` or `FAIL` per file; exits non-zero if any fails | none |
```

Replace Methodology item 5 (from `5. **Structured Export**` through the `gops` bullet, which ends "says which kind of operation was counted.") with:

```markdown
5. **Structured Export**: The database is opened and checked before the sweep, and the run is written in one transaction only after it, so a failed or aborted run leaves the file as it was. The schema is [`data/schema.sql`](data/schema.sql):
   - `runs`: one row per invocation, with its start time (UTC), `commit_id` (`git describe --always --dirty`), `rustc_version`, `repetitions`, and the machine as it was then: `os`, `arch`, `target_features` (what this build was compiled with, e.g. `dotprod fp16 neon`; a default x86-64 build has only SSE2), `cpu`, `available_parallelism`, `gpu` and `gpu_cores`.
   - `core_tiers` and `caches`: the CPU's kinds of core (Apple's performance and efficiency levels, Intel's core and atom halves, or one tier) and every cache configuration per tier, with a `NULL` tier for a cache shared across tiers. A platform that doesn't expose them leaves them empty.
   - `measurements`: one row per configuration: `kernel`, `backend` (`cpu`, `matrix` for Accelerate's matrix unit, or `metal`), `precision`, `n`, `threads`, `gops`, `mean_rel_error_f64`, `median_ms`, `min_ms`, `stddev_ms`, `gpu_ms` (exactly on Metal rows) and `setup_ms`.
   - `params`: each kernel's knobs, one row per knob, as `swept` (a sweep coordinate such as `tile_size`), `derived` (what the kernel actually used, such as `depth_block_used`) or `fixed` (a compile-time constant such as `register_rows`).
   - `setup_ms` is the one-time cost of building the kernel for that configuration, before the warmup run: spawning a thread pool, compiling a BNNS graph, or creating a Metal device, compiling the shader and allocating the buffers (≈ 0 for kernels with nothing to build). It is a single sample and depends on order (the first Metal device in a process pays driver initialization, and Metal caches compiled shaders), so read it as an order of magnitude.
   - `mean_rel_error_f64` is the kernel's accuracy: the mean element-wise relative error against the same inputs widened to `f64` and multiplied in `f64` (untimed, once per size and precision). It counts only the kernel's arithmetic, not the rounding of its inputs, so `f64` CPU kernels and exact `i32`/`i64` products score `0`. A kernel that produced NaN records `+Inf`; SQLite stores NaN as `NULL`. It is informational; step 3's check is what aborts a run.
   - `gops` is $2N^3$ operations per second (from the median time), in billions. The count is $N^3$ multiplies plus $N^3$ adds whatever the element type, so one figure covers the floating-point and the integer precisions alike; `precision` says which kind of operation was counted.
```

Replace the body of `## Benchmark Data` (everything between that heading and the next `---`) with:

```markdown
Each machine has one SQLite database, committed at `data/db/<github-login>/<machine>.sqlite`, and every run adds to it. The dashboard charts the latest run of each cell (kernel, precision, size, threads and swept knobs), so a rerun replaces what it measures and the rest stays.

To contribute results from your machine:

1. `just init <github-login>/<machine>` once, e.g. `just init octocat/m1pro`.
2. `just bench` with the sweep you want. It prints the database it wrote to.
3. Commit the database. The `host-db-validate` pre-commit hook runs `gemm-bench validate` on it if lefthook is installed.
4. Open a PR. CI runs the same validation and checks that the PR changes only `data/db/<your-login>/`; merged databases deploy to the dashboard.

The databases are binary, so review can't see what changed: [`validate`](benchmark/src/validate.rs) is the gate. It checks the path and size (at most 16 MB), the `application_id` and `user_version` stamps, `PRAGMA integrity_check` and `foreign_key_check`, that the stored schema is byte-identical to [`data/schema.sql`](data/schema.sql), that every kernel, backend and precision is one the tool has, that each measurement records exactly its kernel's declared params, that no cell repeats within a run, that no run is empty, and that free text is short and printable.

[`data/peaks.csv`](data/peaks.csv) holds hand-curated hardware ceilings in GFLOP/s, which the dashboard draws against the runs. Each row is one ceiling for a `device`, `backend`, `precision`, and number of busy `cores`, not a per-core rate, because the P-core clock falls as more cores are busy. Every row must cite its source. `bun test` (`web/src/lib/peaks.test.ts`) checks the file strictly: the header must match exactly, every value must be present, `cores` must be a whole number ≥ 1, `gflops` finite and positive, and `backend` either `cpu` or `metal`. No ceiling may be listed twice, and every row must match a host's `device`, `backend`, and `precision`. A GPU ceiling also matches on the run's `gpu_cores`, since the 14- and 16-core M1 Pro GPUs report the same name.
```

In `## Web Dashboard`, make these changes in the long paragraph:
- `It loads \`web/public/results.json\` and \`web/public/peaks.json\` and charts them` → `It fetches the selected host's database (a picker lists every \`data/db/<login>/<machine>.sqlite\`, and \`?host=<login>/<machine>\` links to one), opens it in the browser with [sql.js](https://sql.js.org), reads the \`latest\` view from \`web/src/lib/views.sql\`, and charts it`.
- `CPU & AMX, CPU threading, Precision, GPU, and Block size` → `CPU & matrix, CPU threading, Precision, GPU, and Tuning knobs`.
- `covers the hardware tested (the machine's specs, and each engine's peak against its best measured result)` → `covers the hardware tested (the selected host's core tiers, caches, GPU and build, and each engine's peak against its best measured result)`.
- `AMX and the integer precisions have none` → `the matrix unit and the integer precisions have none`.
- `by precision, matrix size, block size, or kernel` → `by precision, matrix size, tile size, depth block, or kernel`.
- `(over \`naive-ijk\` on CPU & AMX,` → `(over \`naive-ijk\` on CPU & matrix,`.

In `### Pre-Commit Hooks`, replace the `data/runs/**/*.csv` row with:

```markdown
| `data/db/*/*.sqlite` | `gemm-bench validate` on the staged databases |
```

In `### Continuous Integration`:
- Append to the Rust job's steps: `, \`gemm-bench validate\` on every committed database, and on pull requests a check that only \`data/db/<author>/\` changed`.
- Replace the web job's cell with: `` `bun install --frozen-lockfile`, `biome check src`, `bun run typecheck`, `bun test`, `bun run build` ``.
- Rename that job `**Web (Lint, Typecheck, Test, Build)**`.

- [ ] **Step 2: CLAUDE.md**

Apply these edits:
- **Summary line:** replace with `Rust GEMM benchmarks (\`benchmark/\`) plus a Svelte dashboard (\`web/\`) that reads one SQLite database per host (\`data/db/<github-login>/<machine>.sqlite\`, schema in \`data/schema.sql\`) directly in the browser with sql.js. README.md has the full CLI, methodology, and schema.`
- **`just bench` command:** `(and \`--block-size\` for tiled kernels)` becomes `(and \`--tile-size\` / \`--depth-block\` for the tiled / packed kernels)`.
- **`just data` command:** replace that line with two lines:
  - `` - `just init <github-login>/<machine>`: once per machine; writes the git-ignored `.host` that names your database. ``
  - `` - `just validate`: `gemm-bench validate` over every `data/db/*/*.sqlite`, as CI runs it. ``
- **Run-file gotcha:** replace the `data/runs/<host>/<timestamp>.csv` gotcha with:
  - `` - `data/db/<login>/<machine>.sqlite` files are committed data, written only by the tool: `just bench` adds a run to yours by default, so pass `--output /tmp/x.sqlite` for throwaway runs. Never hand-edit one. A PR may only touch its author's folder (CI checks), and `gemm-bench validate` gates every file. ``
  - `` - `data/schema.sql` is version 1 and the only version: there is no migration path yet (see the spec's Follow-ups), so a schema change is a design decision, not an edit. It may only use SQLite features sql.js (3.49.1) has. ``
  - `` - The dashboard's SQL views live in `web/src/lib/views.sql` as `TEMP` views, never in the databases. The latest run of each cell wins. ``
  - `` - Kernel knobs are rows in `params` (`swept`, `derived` or `fixed`). A kernel declares them in `KernelInfo` (`benchmark/src/kernel.rs`) and reports them from `GemmKernel::params`; a test checks the two agree, and `validate` holds stored rows to the declaration. ``
- **`peaks.csv` gotcha:** `Unlike run files, a bad value fails \`just data\` rather than becoming null.` becomes `A bad value fails \`bun test\` (\`web/src/lib/peaks.test.ts\`). GPU ceilings also match on the run's \`gpu_cores\`.`
- **Dashboard-docs gotcha:** `(kernel, device and precision names from run CSVs)` becomes `(kernel, device, CPU, GPU and OS names from host databases)`.
- **Lefthook gotcha:** `fmt/clippy/test/Biome/typecheck/data-build` becomes `fmt/clippy/test/Biome/typecheck/validate`.

- [ ] **Step 3: The agents and the compare skill**

`.claude/agents/adversarial-reviewer.md`:
- **Description:** replace the `description:` line with `description: Use PROACTIVELY after changes to benchmark/src/cli.rs, benchmark/src/db.rs, benchmark/src/validate.rs, data/schema.sql, the --output path handling, or any unsafe/objc2 Metal FFI code (benchmark/src/kernels/mps.rs). Tries to break the code rather than review its style — malformed input, untrusted SQLite databases contributed from other machines, overflow, panics, unsafe-lifetime bugs. Not for general code quality or style review.`
- **Attack surface 1:** replace item 1 with:

```markdown
1. **`benchmark/src/validate.rs` and `data/schema.sql`** — contributed `data/db/<login>/<machine>.sqlite` files come from other machines via PRs and are untrusted input; the dashboard opens them in every visitor's browser. Try a database with a CHECK stripped, an extra table, view or trigger, a wrong `application_id` or `user_version`, dangling foreign keys, undeclared or mislabelled params, a kernel the registry lacks, a duplicated cell, huge or control-character text, a truncated file, or a file that isn't SQLite at all. Does `validate` reject each one, and can anything it accepts break `web/src/lib/views.sql`, a chart's log axis (`+Inf`, zero), or reach `renderMarkdown`?
```

- **Attack surface 2:** `--sizes`/`--threads`/`--block-size` becomes `--sizes`/`--threads`/`--tile-size`/`--depth-block`.
- **Method:** in the last bullet but one, `` `duckdb -bail < data/build.sql` against a hand-crafted bad-input file `` becomes `` `cargo run -- validate data/db/<login>/<machine>.sqlite` against a hand-crafted bad database ``.

`.claude/agents/dashboard-designer.md`:
- **Description:** `loading web/public/results.json and rendering` becomes `loading the per-host SQLite databases (sql.js) and rendering`.
- **Data source:** replace the `**Data source**` bullet with:

```markdown
- **Data source**: one SQLite database per host, `data/db/<login>/<machine>.sqlite` (schema: `data/schema.sql`), found at build time by `web/src/lib/hostlist.ts` and opened in the browser by sql.js (`web/src/lib/db.ts`). `views.sql` creates `TEMP` views on each; `readRows` reads the `latest` view into typed `Row`s (`params` and `swept` are objects; `device` is derived from the run's CPU or GPU). `data/peaks.csv` is parsed by `web/src/lib/peaks.ts` into `Ctx.peaks`. Read `db.ts` and `views.sql` before assuming a column — don't invent one.
```

- **Data layer:** that bullet's first clause becomes `` `web/src/lib/state.svelte.ts` fetches the selected host's database once at boot ``.

Replace `.claude/skills/bench-compare/SKILL.md` with:

````markdown
---
name: bench-compare
description: Compare two benchmark runs (before/after a kernel change, or two machines) and report per-kernel gops deltas against the measurement noise. Use when the user wants to spot regressions or improvements between runs.
argument-hint: <before.sqlite> [<after.sqlite>]
---

Compare two runs with the `sqlite3` CLI. `$ARGUMENTS` is one host database (compare its two latest runs) or two (compare each one's latest run). Read-only: never write to `data/db/`.

Cells match on `(kernel, precision, n, threads, swept params)`. `median_ms` and `stddev_ms` are per-cell, so noise is `stddev_ms / median_ms`.

```sh
sqlite3 -markdown BEFORE "
ATTACH 'AFTER' AS b;   -- for one database, use AFTER = BEFORE and pick the runs below
WITH cell AS (
  SELECT r.started_at, m.kernel, m.precision, m.n, m.threads, m.gops, m.median_ms, m.stddev_ms,
    (SELECT group_concat(name || '=' || value, ',' ORDER BY name) FROM params p
      WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS knobs
  FROM measurements m JOIN runs r USING (run_id)
  WHERE r.started_at = (SELECT max(started_at) FROM runs)),
after AS (
  SELECT r.started_at, m.kernel, m.precision, m.n, m.threads, m.gops, m.median_ms, m.stddev_ms,
    (SELECT group_concat(name || '=' || value, ',' ORDER BY name) FROM b.params p
      WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS knobs
  FROM b.measurements m JOIN b.runs r USING (run_id)
  WHERE r.started_at = (SELECT max(started_at) FROM b.runs))
SELECT a.kernel, a.precision, a.n, a.threads, a.knobs,
       round(a.gops, 2) AS before, round(z.gops, 2) AS after,
       round(100 * (z.gops - a.gops) / a.gops, 1) AS delta_pct,
       round(100 * max(a.stddev_ms / a.median_ms, z.stddev_ms / z.median_ms), 1) AS noise_pct
FROM cell a JOIN after z USING (kernel, precision, n, threads)
WHERE a.knobs IS z.knobs
ORDER BY abs(delta_pct) DESC"
```

For two runs of **one** database, replace the two `max(started_at)` subqueries with the two `started_at` values you're comparing (`SELECT started_at FROM runs ORDER BY started_at DESC LIMIT 2`).

Then report:

- **Regressions/improvements:** rows where `abs(delta_pct) > 2 * noise_pct` (anything inside that is within noise; say so rather than calling it a change). Group by kernel.
- **Unmatched cells:** cells present in only one run, since a changed sweep shape is not a regression.
- **Caveats:** compare `runs.cpu`, `gpu`, `target_features` and `rustc_version` of the two runs. A difference means the comparison is cross-machine or cross-build, not a code change. Note each run's `commit_id` when it isn't `unknown`.
````

- [ ] **Step 4: Check and commit**

Run: `grep -rn -i 'block.size\|results\.json\|data/runs\|just data' README.md CLAUDE.md .claude/agents .claude/skills`
Expected: no output. (`DuckDB` may still appear in `README.md`'s prerequisite context only if you missed the row; `rg -i duckdb README.md CLAUDE.md .claude/agents .claude/skills` must be empty too.)

```bash
git add README.md CLAUDE.md .claude/agents .claude/skills
git commit -m "Document per-host databases, the knob flags and validate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Cutover — the First Real Database, and DuckDB Removed

**Files:**
- Create: `data/db/paulhondola/m1pro.sqlite` (by the tool)
- Delete: `data/runs/`, `data/build.sql`
- Modify: `justfile`, `lefthook.yml`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.claude/hooks/session-start.sh`, `web/.gitignore`, `web/src/lib/peaks.test.ts`

**Interfaces:**
- Consumes: everything above. After this task, nothing in the repo reads CSV runs or calls DuckDB.

- [ ] **Step 1: Run the full sweep (hours, on the M1 Pro)**

This is the user's machine time, so ask before starting. From the repo root, with `.host` set to `paulhondola/m1pro` (Task 6), close other heavy apps (8-thread noise is background contention; see the measurement-noise notes) and run:

```bash
just bench --sweep --no-progress
```

When it finishes:

```bash
just validate
sqlite3 data/db/paulhondola/m1pro.sqlite "SELECT count(*) FROM runs; SELECT backend, count(*) FROM measurements GROUP BY backend;"
```

Expected:
- `ok    data/db/paulhondola/m1pro.sqlite`.
- One run, and measurement counts for `cpu`, `matrix` and `metal`.

- [ ] **Step 2: Require every ceiling to match a host**

Append to `web/src/lib/peaks.test.ts` (add `openDb` and `readRows` from `./db`, and `SQL` from `./testdb`, to its imports):

```ts
test("every ceiling matches a host's device, backend and precision", async () => {
	// A typo in any of the three would silently draw no ceiling.
	const repo = new URL("../../../", import.meta.url).pathname;
	const seen = new Set<string>();
	for await (const path of new Bun.Glob("data/db/*/*.sqlite").scan({ cwd: repo })) {
		const db = openDb(SQL, new Uint8Array(await Bun.file(`${repo}${path}`).arrayBuffer()));
		for (const r of readRows(db)) seen.add(`${r.device}\u0000${r.backend}\u0000${r.precision}`);
		db.close();
	}
	const unmatched = parsePeaks(peaksCsv)
		.filter((p) => !seen.has(`${p.device}\u0000${p.backend}\u0000${p.precision}`))
		.map((p) => `${p.device}/${p.backend}/${p.precision}/${p.cores}`);
	expect(unmatched).toEqual([]);
});
```

Run: `cd web && bun test src/lib/peaks.test.ts`
Expected: PASS. Every M1 Pro ceiling matches a row of the new database.

- [ ] **Step 3: Remove the CSV pipeline**

```bash
git rm -r data/runs data/build.sql
```

- **`justfile`:**
  - Delete the `data` recipe and its comment.
  - Change `dev: data` to `dev:` and `build-web: data` to `build-web:`.
- **`lefthook.yml`:** delete the `data-build` command.
- **`.github/workflows/ci.yml`:**
  - In the `web` job, delete the `Setup DuckDB` step and the `Build Results JSON` step with its comment.
  - Rename the job to `Web (Lint, Typecheck, Test, Build)`.
- **`.github/workflows/deploy.yml`:** delete the `Setup DuckDB` and `Build Results JSON` steps.
- **`.claude/hooks/session-start.sh`:**
  - Delete the `duckdb/duckdb` block (the `tag=$(latest_tag duckdb/duckdb)` line through its `fi`).
  - Change the header comment's ``Installs what `just check`, `just test`, `just data` and`` to ``Installs what `just check`, `just test` and``.
- **`web/.gitignore`:** delete the three lines from the `# Generated by \`just data\`` comment through `public/peaks.json`.
- **Old outputs:** remove any leftover generated `web/public/results.json` and `web/public/peaks.json` from your working tree (`rm -f web/public/results.json web/public/peaks.json`).

- [ ] **Step 4: Verify nothing still points at the old pipeline**

```bash
rg -i 'duckdb|build\.sql|results\.json|peaks\.json|data/runs|just data|block_size|--block-size' --glob '!docs/superpowers/**' --glob '!**/Cargo.lock' --glob '!web/bun.lock' .
```

Expected: no output. The history docs under `docs/superpowers/` keep their mentions on purpose.

Run from the repo root: `just check && just test && just validate && just build`
Expected:
- Every check passes and every test passes, including the new peaks test.
- `validate` prints `ok` for the one database.
- `web/dist/assets/` holds `m1pro-<hash>.sqlite` and `sql-wasm-browser-<hash>.wasm`.

- [ ] **Step 5: Look at the real data**

Start the dashboard (`preview_start`, `dashboard`). Check:
- The host picker shows `paulhondola/m1pro` with the label `Apple M1 Pro · 8P + 2E · 16-core GPU`.
- Every tab renders with no console errors.
- The GPU tab draws its 16-core ceiling.
- The Tuning knobs tab shows tile sizes 16–256 and depth blocks 64–1024.
- Compared with the deployed dashboard (the CSV era), the charts agree, except where the old best-of-two reruns at n = 512 and 1024 now show the latest run.

Take a screenshot as proof.

- [ ] **Step 6: Commit**

The database is binary. lefthook's `host-db-validate` runs `validate` on it as you commit.

```bash
git add data/db/paulhondola/m1pro.sqlite web/src/lib/peaks.test.ts justfile lefthook.yml .github .claude/hooks web/.gitignore
git commit -m "Commit the M1 Pro's first host database and remove the CSV + DuckDB pipeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: After the merge, check the deployed site**

Once the branch is merged and `deploy.yml` has run, open the Pages URL. Check that:
- The `.sqlite` and `.wasm` assets load with no console errors.
- `curl -sI <pages-url>/assets/<m1pro-hash>.sqlite -H 'Accept-Encoding: gzip'` shows `content-encoding: gzip`.

This is the spec's acceptance item 2. If the wasm is served with the wrong MIME type, sql.js falls back to a slower load but still works. Note it rather than block on it.

---

## Self-Review Notes

**Spec coverage**

| Spec requirement | Task |
| :--- | :--- |
| Goals 1, 4 and 5 | Tasks 6, 7, 8 and 14 |
| Goal 2: params and hardware as rows | Tasks 1, 2, 4, 6 and 7 |
| Goal 3: sql.js in the browser, host selector | Tasks 9 and 12 |
| Parameter inventory | Tasks 1 (reports) and 7 (declarations) |
| CLI table | Tasks 3, 5 and 7 |
| Writer and capture table | Tasks 4 and 6 |
| Validate rules 1–6 | Task 7 |
| CI ownership check | Task 8 |
| Dashboard: hosts, loading, peaks, derivations, empty state | Tasks 9–12 |
| `amx` → `matrix` | Tasks 2 and 10 |
| `device` derived in the view | Tasks 6 and 9 |
| Integration (cutover, peaks rules) | Tasks 9 and 14 |
| Testing section | Each task's tests |
| Acceptance 1 | Task 6, step 7 |
| Acceptance 2 | Task 14, steps 1, 5 and 7 |
| Acceptance 3 | Tasks 7 and 8 |
| Acceptance 4 | Task 14, step 4 |

**Choices this plan makes that the spec left open**

- **Knob pills and charts.** The spec says "the block-size chart becomes a swept-knob chart". This plan gives each knob its own pill group and its own panel (`Throughput vs tile size`, `Throughput vs depth block`) on a tab renamed `Tuning knobs`. A single shared axis would mix a tile edge and a k-depth again, which is the conflation the spec removes.
- **Host switching** reloads the page with `?host=`, so no state carries over between hosts.
- **The display name for `matrix`** is "Matrix unit (Apple AMX, Arm SME)".

**Rejected along the way**

- **A generic `--param name=v` flag.** The spec chose named flags.
- **A `hosts` table.** The spec: the path is the identity.
- **A Rust `gemm-bench init` subcommand.** The spec: a one-line `just` recipe.

