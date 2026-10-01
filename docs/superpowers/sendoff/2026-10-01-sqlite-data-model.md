# Sendoff: Per-Host SQLite Data and a Kernel Parameter Model

- **Branch:** `feat/sqlite-data-model`. This file is the branch's only commit, on top of `main` at `3f26f6a`, which already includes PR #25 (the `packed` and `rayon-packed` kernels).
- **Stage:** brainstorming (superpowers:brainstorming), architectural path.
  - The decisions below are approved.
  - The open questions are listed in dependency order.
  - There is no spec or plan yet.
- **Scope:** sub-project 1 of 3 (see [Decomposition](#decomposition)).

## Goal

The benchmark data has to scale along three axes:

1. **Kernels with several knobs.** BLIS-style MC/NC/KC on the CPU, and a tile plus BK on the GPU.
2. **New parameter types**, without a schema change for each one.
3. **Many hosts**, behind a host selector in the dashboard.

The plan is to replace the flat CSV + DuckDB build pipeline with **one SQLite database per host**. The Rust tool writes each database, and the dashboard queries it directly in the browser.

## How We Got Here

- **The 512/1024 extension was global.** `dfa03b5` widened `DEFAULT_BLOCK_SIZES` to 16–1024 for *every* blocked kernel.
- **`block_size` means two things.** It is the tile edge for `tiled`, `rayon-tiled` and `static-tiled`, and the k-block depth (KC) for `packed` and `rayon-packed`.
- **The question that started this:** "Should KC be a separate variable?" That led to asking which future kernels need two knobs (both planned ones do), then to a parameter model, then to splitting the data into linked tables, and finally to SQLite.
- **Numbers:** see [Findings](#findings-from-the-kc-analysis-data-as-of-dfa03b5).

## Decomposition

| # | Sub-project | Depends on | Status |
| :--- | :--- | :--- | :--- |
| 1 | **Data platform:** per-host SQLite, parameter model, hosts, browser queries, DuckDB removal | none | this sendoff |
| 2 | `packed` with BLIS MC/NC blocking (CPU) | 1 | not started ([notes](#sub-projects-2-and-3-notes-so-far)) |
| 3 | `simdgroup_matrix` / register-tiled Metal kernel: tile × BK (GPU) | 1 | not started ([notes](#sub-projects-2-and-3-notes-so-far)) |

## Decisions Made

| Question | Decision |
| :--- | :--- |
| Multi-knob kernels to plan for | Both: `packed` + MC/NC, and the Metal tile + BK kernel |
| Storage | One SQLite database per host, `data/db/<host>.sqlite`, committed. The Rust tool writes it (`rusqlite` with the `bundled` feature), one transaction per run |
| Relational shape | Hosts are decoupled from runs; linked tables with real foreign keys ([draft schema](#draft-schema-not-approved)) |
| Trust model | The tool is open source, so contributed DBs are untrusted. Schema constraints only protect what our tool wrote, so a gate re-validates every DB (see below) |
| DuckDB | **Removed entirely**: `data/build.sql`, `just data`, the `data-build` lefthook hook, the DuckDB setup in CI and deploy, and `results.json` / `peaks.json` |
| Frontend | Reads the SQLite files directly through a SQLite wasm build (~1 MB) and runs SQL in the browser. The host selector fetches only the selected host's DB |
| Legacy data | Runs are reproducible, so the 14 flat CSVs in `data/runs/` are not migrated. A fresh sweep regenerates them, which takes hours on the M1 Pro. An `import-csv` subcommand was considered and judged unnecessary |

Where DuckDB's five current jobs go (approved):

| DuckDB's job today | New home |
| :--- | :--- |
| Merging runs across files and hosts | **The browser.** Vite's `import.meta.glob('…/data/db/*.sqlite', { query: '?url' })` builds the host list at build time. GitHub Pages cannot list directories, so there is no hand-written manifest |
| Validating run data | **The schema itself** (`NOT NULL`, `CHECK`, `FOREIGN KEY`, `STRICT`), written by the tool, **plus `gemm-bench validate <db>…`** in CI and lefthook for contributed DBs. It runs `PRAGMA integrity_check`, `foreign_key_check` and `user_version`, and compares the tables and columns against the tool's own DDL. A DB with the wrong schema fails before deploy, not in a visitor's browser |
| Validating `data/peaks.csv` | **A `bun test`** that applies today's `build.sql` rules: exact header, non-blank source, backend `cpu`/`metal`, whole cores ≥ 1, finite gflops > 0, no duplicates, no unmatched rows. The dashboard parses the CSV itself. It stays reviewable text |
| Fixed joins and shaping (params into one object per row) | **SQL views in the DB schema**, created by the tool and queried by the frontend. Browser and tests share one definition |
| NaN/Inf → null for JSON | **Mostly gone.** SQLite `REAL` keeps ±Inf, and NaN becomes NULL, which the dashboard already treats as unplottable |

## Open Questions (resume here)

The first one names the DB file. The recommendation is listed first in each row.

| # | Question | Options |
| :--- | :--- | :--- |
| 1 | **Host identity** | **A.** Hostname. The file is `data/db/<hostname>.sqlite`, and each run stores its hardware snapshot, so an upgrade under the same name shows as a different snapshot. A `--host <name>` override handles two machines with the same name. **B.** Hostname + a short hardware hash. Collisions can't happen, but selector names are less readable, and one machine can split in two if a reported value changes (e.g. core counts under Low Power Mode) |
| 2 | **Parameter representation** | Working assumption: a long table `params(run_id, seq, name, value, source)`. All GEMM knobs are positive integers, so the generic table loses no typing. This was **not explicitly chosen**. The alternatives were wide sparse columns, one table per kernel family, or a JSON column |
| 3 | **Which params are recorded** | **B.** Swept + derived (anything that depends on n, the host or the GPU). **A.** Swept only. **C.** Also fixed constants, which the `commit` column already identifies |
| 4 | **Sweep model per kernel** | Leaning: one swept knob per kernel, the rest derived from host caches (BLIS-style). `params.source` supports independent grids too (two `swept` rows) |
| 5 | **Default sweep ranges** | Replace the global `DEFAULT_BLOCK_SIZES` (now 16–1024 for every kernel) with per-kernel defaults: tile 16–256, KC 64–1024. The data supports this: KC 16/32 were 25–60% slower than KC 256 in every cell, and tile 1024 hits the power-of-two aliasing cliff. Also decide whether `--block-size` stays one flag or becomes `--tile` / `--kc` |
| 6 | **Cross-run aggregation** | The dashboard charts the best median over every row in a cell, so n=512 and n=1024 currently get a best-of-two. Pick a rule (latest run per host and cell, best, or median of runs) and implement it as one SQL view |
| 7 | **SQLite wasm library and cross-host views** | `sql.js` or `@sqlite.org/sqlite-wasm`. For comparison views, `ATTACH` the DBs or query each one and merge in JS. Also confirm JSON1 (`json_group_object`) is in the chosen build. **Settle with a short spike before the plan** |
| 8 | **`threads`** | Recommended: it stays a `measurements` column. It's a sweep dimension shared by six kernels, it drives the Threading tab, and it decides the serial/parallel family |
| 9 | **Effective vs requested values** | Recommended: the kernel reports what it actually used. At n=512, "KC 1024" ran with kc = 512, because the last k-block is `min(KC, n − pc)`; record that as `kc_eff` |
| 10 | **Palette scaling** | The host colour group has no 11th slot (exhaustive search, `d1a525a`). A separate dashboard sub-project: per-view colours, or folding into family views |

## Draft Schema (not approved)

A starting point for the design sections. Where the hardware snapshot lives depends on open question 1.

```sql
PRAGMA user_version = 2;   -- schema version; v1 = the legacy flat CSV

CREATE TABLE hosts (
  host_id          TEXT PRIMARY KEY,
  cpu              TEXT NOT NULL,
  p_cores          INTEGER NOT NULL CHECK (p_cores > 0),
  e_cores          INTEGER NOT NULL CHECK (e_cores >= 0),
  l1d_bytes        INTEGER CHECK (l1d_bytes > 0),     -- P-core: hw.perflevel0.*
  l2_bytes         INTEGER CHECK (l2_bytes > 0),
  cpus_per_l2      INTEGER CHECK (cpus_per_l2 > 0),
  cacheline_bytes  INTEGER CHECK (cacheline_bytes > 0),
  gpu              TEXT,
  gpu_tg_mem_bytes INTEGER CHECK (gpu_tg_mem_bytes > 0)
) STRICT;

CREATE TABLE runs (
  run_id      TEXT PRIMARY KEY,                       -- '<host>/<UTC timestamp>'
  host_id     TEXT NOT NULL REFERENCES hosts,
  commit_id   TEXT NOT NULL,                          -- git describe --always --dirty
  started_at  TEXT NOT NULL,                          -- UTC ISO-8601
  repetitions INTEGER NOT NULL CHECK (repetitions > 0)
) STRICT;

CREATE TABLE measurements (
  run_id    TEXT NOT NULL REFERENCES runs,
  seq       INTEGER NOT NULL CHECK (seq >= 0),
  kernel    TEXT NOT NULL,
  backend   TEXT NOT NULL CHECK (backend IN ('cpu', 'amx', 'metal')),
  device    TEXT NOT NULL,
  precision TEXT NOT NULL CHECK (precision IN ('f16', 'f32', 'f64', 'i32', 'i64')),
  n         INTEGER NOT NULL CHECK (n > 0),
  threads   INTEGER NOT NULL CHECK (threads > 0),
  gops      REAL NOT NULL,
  mean_rel_error_f64 REAL,   -- +Inf is a real result (kernel produced NaN); SQLite turns NaN into NULL
  median_ms REAL NOT NULL,
  min_ms    REAL NOT NULL,
  stddev_ms REAL NOT NULL,
  gpu_ms    REAL,
  setup_ms  REAL NOT NULL,
  PRIMARY KEY (run_id, seq),
  CHECK ((backend = 'metal') = (gpu_ms IS NOT NULL))
) STRICT;

CREATE TABLE params (
  run_id TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  name   TEXT NOT NULL CHECK (name GLOB '[a-z]*'),
  value  INTEGER NOT NULL CHECK (value > 0),
  source TEXT NOT NULL CHECK (source IN ('swept', 'derived')),
  PRIMARY KEY (run_id, seq, name),
  FOREIGN KEY (run_id, seq) REFERENCES measurements
) STRICT;

-- One row per measurement, its params rolled into a JSON object ({} when none).
-- The exact view is a design-section item; it needs JSON1 (open question 7).
```

Two SQLite gotchas to carry into the spec:
- **Foreign keys are off by default.** The writer must run `PRAGMA foreign_keys = ON` on every connection, and `validate` must run `PRAGMA foreign_key_check`.
- **NaN is stored as NULL.** `mean_rel_error_f64` therefore cannot be `NOT NULL`, or a NaN result would fail to save the whole run.

## Parameter Inventory

Every knob in the code as of `3f26f6a`, plus the planned kernels:
- **swept:** a CLI sweep coordinate
- **derived:** computed at run time from n, the host or another knob
- **fixed:** a compile-time constant

| Kernel | Swept | Derived | Fixed |
| :--- | :--- | :--- | :--- |
| `naive-ijk`, `ikj` | none | none | none |
| `tiled` | `tile` (today `block_size`) | none | none |
| `rayon-ikj` | `threads` | none (one row per task) | none |
| `static-ikj` | `threads` | `rows_per_thread` = ⌈n/threads⌉ | none |
| `static-tiled` | `threads`, `tile` | `rows_per_thread` | none |
| `rayon-tiled` | `threads`, `tile` | `tasks`, `chunk_rows` | `tasks_per_worker` = 4 |
| `packed` | `kc` (today `block_size`) | `kc_eff` = min(kc, n); `nr` = 3·lanes (12 f32/i32, 24 f16, 6 f64/i64) | `mr` = 8, `nr_vecs` = 3 |
| `rayon-packed` | `threads`, `kc` | `kc_eff`, `nr`, `strips` = ⌈n/8⌉ | `mr`, `nr_vecs` |
| `accelerate-blas`, `-bnns` | none | Accelerate picks its own threads (`VECLIB_MAXIMUM_THREADS` if set) | none |
| `mps` | none | none | none |
| `metal-naive` | none | threadgroup 32×32, queried from the pipeline at run time (`threadExecutionWidth`), so it is GPU-dependent | none |
| `metal-tiled` | none | threadgroups = ⌈n/16⌉² | `tile` = `bk` = 16 |
| *planned* `packed` + MC/NC | `threads`, `kc` | `mc`, `nc`, `kc_eff`, `nr` | `mr`, `nr_vecs` |
| *planned* Metal `simdgroup_matrix` | `tile` (bm = bn) | threadgroups = ⌈n/tile⌉²; `tg_mem_bytes` = (bm+bn)·bk·sizeof, which must be ≤ 32 KB | `bk`, simdgroups per threadgroup, 8×8 tiles per simdgroup |

Each measurement would carry 0–6 param rows, roughly 10–15k rows for today's ~4k measurements.

Strategy choices (e.g. which loop to parallelize) become **separate kernel labels**, not params, so `value` stays an integer.

## Rust-Side Notes

- **Declaring knobs.** `KernelInfo.blocks: bool` (`benchmark/src/kernel.rs`) becomes a declaration: the swept knob with its default range, and the names of the derived knobs. The kernel reports its effective values after construction.
- **Cache sizes on macOS.** Use `sysctl hw.perflevel0.{l1dcachesize,l2cachesize,cpusperl2}` and `hw.cachelinesize`, through the existing `command_output` in `benchmark/src/context.rs`.
  - **Trap:** the legacy `hw.l1dcachesize` / `hw.l2cachesize` report the **E-core** values on the M1 Pro (64 KB / 4 MB, against 128 KB / 12 MB for the P-cores).
  - The system-level cache is not exposed.
- **Cache sizes elsewhere.**
  - Linux: `/sys/devices/system/cpu/cpu0/cache/index*/{level,type,size,shared_cpu_list}`. `cpu0` can be a little core on hybrid chips.
  - Metal: `MTLDevice.maxThreadgroupMemoryLength`, which is 32 KB on the M1.
- **BLIS-style sizing,** after Low et al., *Analytical Modeling Is Enough for High-Performance BLIS* (s = element size):
  - `KC·(MR+NR)·s ≲ L1/2`
  - `MC·KC·s ≲ (L2/cpus_per_l2)/2`
  - `KC·NC·s ≲ L2/2`
- **The writer** replaces `report.rs::write_records` (CSV). `--output` currently requires a `.csv` path, which changes too.

## Frontend Notes

- **Loading.** `web/src/lib/db.ts` (`loadRows`, `loadPeaks`) and `state.svelte.ts` (`boot`) switch from fetching JSON to opening the DB(s) through wasm. The host list comes from `import.meta.glob`, and `peaks.csv` is parsed in the browser.
- **Tests.** Bun ships `bun:sqlite`, so `bun test` can run **the same SQL** the browser runs against a fixture DB. That is a stronger test than today's JS-only filters.
- **Guards.** The `Row` type and the `derive.ts` guards (`isPlottable`) need revisiting, since rows no longer pass through JSON.

## Findings From the KC Analysis (data as of `dfa03b5`)

**Best median, as % of NEON peak (`data/peaks.csv`), n = 4096, KC = 256:**
- `packed`, 1 thread: f16 88.6%, f32 88.2% (91.2 GOPS), f64 ~87%
- `rayon-packed`, 8 threads: f16 76.9%, f32 79.3% (617 GOPS), f64 80.0%
- `rayon-packed`, 10 threads: 80.0% / 81.3% / 83.4%. These are flattered: the peak counts 8 P-cores only
- Integers: i32 69.5 GOPS (0.76× f32), i64 12.3 GOPS (2× `ikj`, scalar multiply)

**Noise.** The same cell, measured in two runs an hour apart, deviates by a median of:

| Threads | 1–4 | 8 | 10 |
| :--- | :--- | :--- | :--- |
| Between runs | 1–2% | 3.6% | 6.2% (outliers −26% / +25%) |
| Within one run (KC 512 vs 1024 at n = 512, identical work) | 0.2–1.9% | | |

**What KC 512 / 1024 bought.** These were measured at n = 512 and 1024 only.
- **1 thread:** ±3%, i.e. noise. The kernel already saturates at KC = 256.
- **8 threads, n = 512:** **+8–19%** (f32 346 → 400–413 GOPS). That's real, about 2–5× the noise. One k-block round fewer saves about 0.1 ms of fork-join and serial B packing.
- **8 threads, n = 1024:**
  - KC 512 f32: +9%
  - KC 1024: f16 +6%, **f32 −3%, f64 −9%**
  - Hypothesis (not measured): L1 pressure. The A and B strips take `KC·(8 + nr)·sizeof`, which is 64 / 80 / **112 KB** for f16 / f32 / f64, against a 128 KB L1.
- At n = 4096 a round costs under 1% of the run, so extending 512/1024 to large n would gain nothing. And f64 KC 512 at n = 4096 is a 16 MB panel, more than the 12 MB L2.

**Scaling, f32, efficiency per cycle against 1 thread:**

| n | 256 | 512 | 1024 | 2048 | 4096 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 8 threads | 33% | 64% | 77% | 87% | 92% |
| 4 threads | 58% | 85% | 89% | 96% | 99% |

The 8-thread losses at n ≤ 1024 come from serial `pack_b` plus per-round costs. At n ≤ 128, 8 threads are slower than 1–2 threads.

**f16 accuracy: KC is an accuracy knob.** Mean relative error against the f64 reference:
- At n = 4096: `ikj` 6.6e-2, against `packed` 7e-4 to 1.5e-3
- At n = 1024: KC 64 gives 3.6e-4; KC 1024 gives 3.8e-3, the same as `ikj`'s 3.7e-3. A single k-block is one long running f16 sum

**NEON best / AMX best:** f16 0.29 (1243 / 4334), f32 0.28 (632 / 2289), f64 **0.64** (324 / 505).

## Issues Found in `dfa03b5` (not yet fixed)

- The global `DEFAULT_BLOCK_SIZES = [16 … 1024]` also applies to `tiled`, `rayon-tiled` and `static-tiled`. That lengthens `--sweep` and adds tile 1024 cells, which hit the aliasing cliff (~9.7 GOPS at n = 4096).
- Stale docs:
  - `README.md:95` ("block sizes `16`–`256`")
  - `README.md:178` (default `16,32,64,128,256`)
  - `benchmark/src/cli.rs:57` (`--help`: "Omit to sweep 16 through 256")
- The dashboard keeps both runs, so n = 512 and 1024 get a best-of-two (open question 6).
- The extension rows carry `commit = 4d47c4f-dirty`: the `cli.rs` edit was uncommitted when they ran. Harmless, since the kernel code was identical.
- `configs/block-sizes.toml` sets `block-size = [512, 1024, 2048]`, but the README says the preset pins *sizes* 512/1024/2048.

## Everything That Touches DuckDB or the JSON Pipeline (as of `3f26f6a`)

- `data/build.sql` (deleted)
- `justfile`: `data`, plus `dev: data` and `build-web: data`
- `lefthook.yml`: the `data-build` hook
- `.github/workflows/ci.yml` and `deploy.yml`: the "Setup DuckDB" steps, and `duckdb -bail < data/build.sql`
- `.claude/hooks/session-start.sh`: installs the DuckDB CLI
- `.claude/agents/adversarial-reviewer.md`: targets `data/build.sql` and merging untrusted CSVs. It should retarget to `validate` and the writer
- `.claude/agents/dashboard-designer.md`: data source `results.json`
- `.claude/skills/bench-compare/SKILL.md`: compares run CSVs with the DuckDB CLI. It moves to `sqlite3`, or to a `gemm-bench compare` subcommand
- `CLAUDE.md`: the summary line, `just data`, and the run-file and `peaks.csv` gotchas
- `README.md`: lines 13, 27, 54–55, 202–210, 222, 237, 246, plus the CSV schema section
- `web/src/lib/db.ts`, `state.svelte.ts`, `derive.ts`, `App.svelte` (the "run `just data`" hint), `derive.test.ts`, `charts/precision.test.ts` (null-for-non-finite comments)

## Sub-Projects 2 and 3: Notes So Far

**2. `packed` + MC/NC** (the spec's deferred "BLIS loops 1 and 3"):
- Without NC, the B panel is always KC × n. That's why f64 at n = 4096 can't use KC 512.
- MC adds a second parallel dimension, and parallel B packing comes with it.
- From the HPC review of `rayon-packed`: serial `pack_b` costs about 8% of an 8-thread run at n = 2048 and about 25% at n = 512. `pack_b<f32>` also calls `memcpy` through a dyld stub for every 48-byte segment.
- The write-back goes through the stack twice, worth about 2–4%.

**3. Metal tile + BK:**
- `metal-tiled` reaches 10.6% of peak at f32 and is bound by threadgroup memory: f16 runs 1.74× faster than f32 even though the ALU rate is the same.
- A register-tiled or `simdgroup_matrix` kernel has a threadgroup output tile (BM×BN) and a k-step (BK), bounded by the 32 KB of threadgroup memory.
- MPS reaches about 65% end to end and about 76% by GPU time, which shows how much headroom there is.

## Next Steps

1. Answer open questions 1–6 (one at a time, recommendation first).
2. Run the spike for open question 7.
3. Write the design sections, then the spec in `docs/superpowers/specs/`, then the plan via superpowers:writing-plans.
