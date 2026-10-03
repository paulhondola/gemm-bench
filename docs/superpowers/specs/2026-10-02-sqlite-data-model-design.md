# Per-Host SQLite Data Model, Read in the Browser

- **Status:** Approved design (brainstormed 2026-10-01/02)
- **Supersedes:** `docs/superpowers/sendoff/2026-10-01-sqlite-data-model.md` where they differ. Each change to the sendoff's approved decisions is marked **(changed)**.
- **Scope:** sub-project 1 of 3. Sub-projects 2 (`packed` with BLIS MC/NC) and 3 (a Metal tile × BK kernel) depend on it.

## Problem

The benchmark data is a set of flat CSVs, merged by DuckDB (`data/build.sql`) into `web/public/results.json`. That shape no longer fits:

- **One `block_size` column means two things.** It is the tile edge for `tiled`, `rayon-tiled` and `static-tiled`, and the k-block depth (KC) for `packed` and `rayon-packed`. Both planned kernels need two knobs, so a single column can't hold their parameters.
- **One global `DEFAULT_BLOCK_SIZES` (16–1024) applies to every blocked kernel.** `tiled` gets tile 1024, which hits the power-of-two aliasing cliff (~9.7 GOPS at n = 4096). `packed` gets KC 16/32, which were 25–60% slower than KC 256 in every cell.
- **The dashboard assumes a single machine.** The goal is to show other people's benchmarks, from other architectures, behind a host selector.
- **Nothing records what a result depends on across machines.** Missing today: the compiler's target features (a default x86-64 build is SSE2-only), the rustc version (`rust-toolchain.toml` is an undated `nightly`), the cache topology, and binned-chip variants (an "Apple M1 Pro" GPU has 14 or 16 cores, and `peaks.csv` assumes 16).

## Goals

1. **One SQLite database per host,** committed at `data/db/<github-login>/<machine>.sqlite`. Only the Rust tool writes it.
2. **A schema that holds any number of kernel knobs and any machine topology without a schema change.** Knobs and hardware are stored as rows, not columns.
3. **The dashboard reads the DB files directly** with sql.js, with no build step. A host selector fetches only the selected host.
4. **Contributed DBs are untrusted.** `gemm-bench validate` and a CI ownership check gate them before merge.
5. **DuckDB is removed entirely.**

## Non-Goals

- **Migrating the legacy CSVs.** Runs are reproducible, so a fresh sweep replaces them.
- **Schema migrations.** There are no other contributors yet, so v1 is the only version. See [Follow-ups](#follow-ups).
- **Charts comparing hosts and new host colours** (sendoff open question 10). That's a follow-up dashboard sub-project.
- **The `packed` MC/NC and Metal tile × BK kernels themselves** (sub-projects 2 and 3). This spec only reserves their param names.
- **Incremental writes during a run.** A run is still all-or-nothing, as the CSV is today.

## Decisions

| Question | Decision |
| :--- | :--- |
| Storage | One DB per host, `data/db/<login>/<machine>.sqlite`. **Not one global DB:** concurrent PRs would always conflict on the shared binary file, and nobody could review the changes. |
| Host identity | `<github-login>/<machine>`, set once by `just init`, which writes a git-ignored `.host`. GitHub logins are unique, so collisions are impossible, and hostnames (which leak names and collide) aren't published. |
| Reading | **sql.js** in the browser: 342 KB of wasm + JS on the wire, cached after the first visit. `bun:sqlite` exists only inside the Bun process and can't run in a browser. |
| Cross-host merging | Run the same views on each opened DB and concatenate the rows in JS. No `ATTACH` and no build step. |
| Keys | Integer surrogate keys. Text keys made the DB 1.7× larger on the wire (spike). A run's global identity is `(host, started_at)`. |
| Params | A long table `params(measurement_id, name, value INTEGER > 0, source)`, with source `swept` (requested), `derived` (the value actually used, or a value depending on n, threads, precision, host or GPU) or `fixed` (a compile-time constant). No param-name lookup table: it saved only 5% on the wire. |
| Names | Descriptive snake_case in the DB, kebab-case flags, BLIS short names as visible aliases ([inventory](#parameter-inventory)). |
| Repeated runs | The **latest run per cell** wins. A cell is (kernel, precision, n, threads, swept params). All runs stay in the DB. |
| `threads` | Stays a `measurements` column. |
| Hardware | **Rows, not columns**: `core_tiers` and `caches` per run. `arch`, `target_features`, `rustc_version`, `available_parallelism` and `gpu_cores` go on `runs`. |
| Backends | `cpu` / **`matrix`** / `metal`. `amx` was renamed because on M4 and later Accelerate's matrix unit is Arm SME, and Intel's AMX is something else. |
| `measurements.device` | **Dropped.** The view derives it from `runs.cpu` or `runs.gpu` by backend. |
| Views | **(changed)** They live in `web/src/lib/views.sql` and are created as `TEMP` views on every DB the dashboard opens, not stored in the DBs. A view change then never touches a contributor's file. |
| Peaks | `data/peaks.csv` stays CSV. The browser parses it, and a `bun test` applies today's `build.sql` rules. GPU peaks match on `runs.gpu_cores`. |
| Dashboard scope | A host selector only. Every existing chart shows the selected host. |

## Design

### Schema (`data/schema.sql`, v1)

One file, applied to an empty DB in one transaction. The Rust writer and `validate` read it with `include_str!`, and the web tests read it with `?raw`. Every statement below passed 33 constraint cases in sql.js and loads in `sqlite3` 3.54.

```sql
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

Notes:
- **`caches.tier` NULL means the cache is shared across tiers** (an Intel L3, for example). A FK whose child column is NULL isn't checked, so a non-NULL tier must exist in `core_tiers`. The `coalesce` index exists because `UNIQUE` treats NULLs as distinct.
- **Unknown topology means zero `core_tiers`/`caches` rows,** never NULL-filled columns.
- **`+Inf` is a real result,** stored as-is. SQLite stores NaN as NULL, which is why `mean_rel_error_f64` is nullable.
- **The writer runs `PRAGMA foreign_keys = ON` on every connection,** because SQLite defaults it to off.
- **The default rollback journal stays.** WAL would leave `-wal`/`-shm` files next to a committed DB.
- **Deliberately absent:** a `hosts` table (the path is the identity), a `seq` column (`measurement_id` is insertion order), a kernel-name enum in a `CHECK` (that would mean a schema bump per kernel; `validate` checks names instead), and indexes on the FK columns (cascade scans of about 20k rows are instant).

The **topology model was tested against four machines**: an M1 Pro (2 tiers, an L2 per cluster), an i9-13900K (P with SMT plus E, a shared L3), a 7950X3D (one tier, two L3s of 32 MB and 96 MB), and a Snapdragon X Elite (one tier, an L2 per 4-core cluster).

### Views (`web/src/lib/views.sql`, owned by the dashboard)

```sql
CREATE TEMP VIEW measurement_rows AS
SELECT m.*,
  CASE m.backend WHEN 'metal' THEN r.gpu ELSE r.cpu END AS device,
  r.gpu_cores, r.started_at, r.commit_id, r.repetitions,
  (SELECT json_group_object(name, value ORDER BY name) FROM params p
    WHERE p.measurement_id = m.measurement_id) AS params,
  (SELECT json_group_object(name, value ORDER BY name) FROM params p
    WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS swept_params
FROM measurements m JOIN runs r USING (run_id);

CREATE TEMP VIEW latest AS
SELECT * FROM (
  SELECT *, row_number() OVER (
    PARTITION BY kernel, precision, n, threads, swept_params
    ORDER BY started_at DESC, measurement_id DESC) AS recency
  FROM measurement_rows)
WHERE recency = 1;
```

- **The cell key comes from swept params only,** so a different `register_cols` (another SIMD width) or `depth_block_used` stays in the same cell.
- **Zero params give `{}`.**
- **Aggregate `ORDER BY` needs SQLite 3.44 or newer;** sql.js 1.14.2 ships 3.49.1.
- **On today's data the view collapses 300 duplicate cells,** the best-of-two reruns.

### Parameter inventory

Each kernel declares its params (name and source). The declaration replaces `KernelInfo.blocks: bool`, and a swept param carries its default range. After construction, each kernel reports the values it actually used.

| Kernel | Swept | Derived | Fixed |
| :--- | :--- | :--- | :--- |
| `naive-ijk`, `ikj`, `rayon-ikj` | none | none | none |
| `tiled` | `tile_size` | none | none |
| `static-ikj` | none | `max_rows_per_thread` = ⌈n / threads⌉ | none |
| `static-tiled` | `tile_size` | `max_rows_per_thread` | none |
| `rayon-tiled` | `tile_size` | `tasks`, `rows_per_task` (today's `chunk_rows`) | `tasks_per_worker` = 4 |
| `packed` | `depth_block` | `depth_block_used` = min(depth_block, n), `register_cols` = 3·lanes | `register_rows` = 8, `register_col_vectors` = 3 |
| `rayon-packed` | `depth_block` | `depth_block_used`, `register_cols`, `row_strips` = ⌈n / 8⌉ | `register_rows`, `register_col_vectors` |
| `accelerate-blas`, `accelerate-bnns`, `mps` | none | none | none |
| `metal-naive` | none | `threadgroup_width`, `threadgroup_height` (queried from the pipeline), `threadgroups` | none |
| `metal-tiled` | none | `threadgroups` = ⌈n / 16⌉² | `threadgroup_width` = `threadgroup_height` = 16, `depth_step` = 16 |
| *reserved* (sub-projects 2 and 3) | `row_block` (`--mc`), `col_block` (`--nc`), `depth_step` (`--bk`) | | |

Strategy choices, such as which loop is parallelized, become separate kernel labels, never params.

### CLI

| Change | Detail |
| :--- | :--- |
| `--tile-size <N,...>` | Visible alias `--tile`. Default `16,32,64,128,256` |
| `--depth-block <N,...>` | Visible alias `--kc`. Default `64,128,256,512,1024` |
| `--block-size` | **Removed**, together with `DEFAULT_BLOCK_SIZES` |
| An explicitly given knob flag that no selected kernel uses | Rejected, the same way an explicitly named idle kernel is today |
| `--output <FILE.sqlite>` | Must end in `.sqlite`. Default `data/db/<host>.sqlite`, with `<host>` read from `.host`. With `--output`, no `.host` is needed |
| `validate <DB>...` | New subcommand ([below](#validate)). The bench flags stay top-level, so `just bench --sizes …` is unchanged |
| Presets | Keys follow the flag names: `block-size` becomes `tile-size` and/or `depth-block`, and serde aliases accept `tile`/`kc`. `configs/block-sizes.toml` gets a correct description (the sendoff found it mislabelled) |

New `just` recipes: `init id` writes `.host` in one line, and `validate` runs the tool over `data/db/*/*.sqlite`. `just data` is deleted, along with its use in `dev` and `build-web`.

### Writer (replaces `report::write_records`)

**At plan time, before any kernel runs:**
1. Resolve the path: `--output`, or `data/db/<host>.sqlite` from `.host`. A `.host` that is missing or doesn't match `^[a-z0-9][a-z0-9-]{0,38}/[a-z0-9][a-z0-9-]*$` fails with the `just init` command to run.
2. Open or create the DB, then dispatch on its version:
   - `user_version` 0: apply `data/schema.sql` in one transaction.
   - Version 1 with `application_id` = `GEMM`: accept.
   - Anything else, including another application's SQLite file: refuse.
3. Fail if `started_at` already exists in the DB, so a same-second collision fails now instead of after the sweep.

**After the sweep:**
- Print the results table, as today.
- Insert the run, its tiers, caches, measurements and params in **one transaction**, with `PRAGMA foreign_keys = ON`.
- A verification failure or a crash still writes nothing.

**Captured per run** (extending `context.rs`, through the existing `command_output`):

| Field | macOS | Linux | Elsewhere |
| :--- | :--- | :--- | :--- |
| `os` | `macOS ` + `sw_vers -productVersion` | `Linux ` + `uname -r` | `std::env::consts::OS` |
| `arch` | `std::env::consts::ARCH` (e.g. `aarch64`) | same | same |
| `target_features` | The enabled subset of a fixed `cfg!(target_feature = …)` list, sorted and space-separated. On `aarch64`: `neon fp16 bf16 dotprod i8mm sve sve2 sme`. On `x86_64`: `sse4.2 avx avx2 fma f16c avx512f avx512fp16`. Only names rustc recognizes, since an unknown name trips `unexpected_cfgs` under clippy's `-D warnings` | same | empty on other arches |
| `rustc_version` | `build.rs` runs `$RUSTC -V` and passes it with `cargo:rustc-env` | same | same |
| `cpu` | `machdep.cpu.brand_string` (today's lookup) | `/proc/cpuinfo` model name, or `lscpu`'s "Model name" on ARM | `unknown` |
| `available_parallelism` | `std::thread::available_parallelism()` | same | same |
| `core_tiers` | `hw.nperflevels` and `hw.perflevelN.{name, physicalcpu, logicalcpu}`, with tier = N | If `/sys/devices/cpu_core` and `cpu_atom` exist, their CPU lists become tiers 0 (`Performance`) and 1 (`Efficiency`). Otherwise group by `cpu_capacity`, highest first (name NULL). Otherwise one unnamed tier | no rows |
| `caches` | `hw.perflevelN.{l1dcachesize, l1icachesize, l2cachesize, cpusperl2, l3cachesize?, cpusperl3?}` and `hw.cachelinesize`. **Never** the legacy `hw.l1dcachesize`, which reports E-core values | `cpu*/cache/index*/{level, type, size, coherency_line_size, shared_cpu_list}`, deduplicated into (tier, level, kind, size, shared_by) with instance counts | no rows |
| `gpu`, `gpu_cores` | Metal device name (today's lookup), and `gpu-core-count` from `ioreg -rc AGXAccelerator -d1` | NULL | NULL |

**Parsing goes in pure functions** over captured `sysctl`/sysfs text, so it can be tested on any OS.

### Param reporting

- **`GemmKernel` gets `fn params(&self, n: usize) -> Vec<Param>`,** with an empty default. Each kernel reports the actual values (the clamped KC, the pipeline-queried threadgroup).
- **`BenchmarkRecord.block_size` becomes `params`.**
- **A unit test keeps declarations honest.** Every kernel's reported names and sources must equal its declaration, at several n and every supported precision. That test is what lets `validate` trust the declarations.

### Validate

`gemm-bench validate <DB>...` checks each file, stopping at the first failure in that file and naming the rule:

1. The path matches `data/db/<login>/<machine>.sqlite` (same pattern as `.host`), and the file is ≤ 16 MB.
2. `application_id` = `GEMM` and `user_version` = 1.
3. `PRAGMA integrity_check` is `ok` and `PRAGMA foreign_key_check` is empty.
4. **`sqlite_schema` is byte-identical** to a fresh in-memory DB built from `data/schema.sql`. This catches stripped `CHECK`s and extra tables, views or triggers.
5. Rules that span rows:
   - The kernel is in the registry, its backend matches the registry, and its precision is one the kernel supports.
   - Each measurement's params are **exactly** its kernel's declared names and sources.
   - `threads = 1` for kernels without workers.
   - Metal rows only appear in runs with a `gpu`.
   - No cell appears twice within one run.
   - No run is empty.
6. Every free-text field (`os`, `cpu`, `gpu`, `commit_id`, `rustc_version`, tier `name`) is ≤ 200 characters with no control characters.

**Required for Linux CI:**
- **The macOS `KernelChoice` variants are no longer removed by `#[cfg]`.** They become `#[cfg_attr(not(target_os = "macos"), value(skip))]`, hidden from the CLI but known to `validate`.
- **Only the arms that build those kernels stay gated.** Their non-macOS arm is unreachable, because `value(skip)` keeps them out of every plan.

### CI and hooks

**`ci.yml`, Rust job:**
- **Ownership step,** on pull requests only, with `fetch-depth: 0`. The login comes in through `env:` and is never interpolated into the script:
  ```sh
  owner="data/db/$(printf %s "$AUTHOR" | tr A-Z a-z)/"
  foreign=$(git diff --name-only --no-renames "origin/$BASE...HEAD" -- data/db | grep -v "^$owner" || true)
  [ -z "$foreign" ] || { echo "a PR may only change $owner:"; echo "$foreign"; exit 1; }
  ```
  `--no-renames` makes a move out of someone else's folder show up as that folder's deletion.
- **A `validate` step** over every committed DB.

**`ci.yml`, web job, and `deploy.yml`:** drop "Setup DuckDB" and the `build.sql` step.

**`lefthook.yml`:** `data-build` becomes `validate`, run on staged `data/db/**/*.sqlite` files, plus the peaks rules through `bun test`.

### Dashboard

- **Host list:** `web/src/lib/hosts.ts` builds it from `import.meta.glob("../../../data/db/*/*.sqlite", { query: "?url", import: "default", eager: true })`. The ID comes from the path.
  - The spike confirmed that each DB becomes a byte-identical, content-hashed asset under the `/gemm-bench/` base.
  - The dev server needs `server.fs.allow: [".."]`.
- **Selected host:** `?host=<login>/<machine>`, defaulting to the first host alphabetically. Only that host's DB is fetched.
- **Opening a DB** (`db.ts`):
  - sql.js is loaded once, with the wasm URL from `sql.js/dist/sql-wasm-browser.wasm?url`.
  - `new SQL.Database(bytes)`, then check `application_id` and `user_version`. An unknown value shows an error for that host without breaking the page.
  - `views.sql` (`?raw`) creates the views, then `SELECT * FROM latest` runs. `params`/`swept_params` are parsed into objects, giving a **typed `Row`**.
  - The latest run's `runs`, `core_tiers` and `caches` feed the hardware panel and the selector label (e.g. "Apple M1 Pro · 8P+2E").
- **Peaks:**
  - `data/peaks.csv` is imported `?raw` and parsed by a small RFC 4180 parser; the `source` field contains quoted commas.
  - CPU ceilings match on (device, backend, precision, cores).
  - Metal ceilings match on `cores = gpu_cores`.
- **Derivations:**
  - `block_size` becomes the kernel's swept param, and the block-size chart becomes a swept-knob chart whose axis is named after the param (`tile_size`, `depth_block`).
  - The `amx` family becomes `matrix`.
  - `isPlottable` requires a finite `gops`.
  - Kernel docs mention each knob's BLIS alias.
- **Empty state:** "No host databases yet: `just init <login>/<machine>`, then `just bench`" replaces the `just data` hint.

### Files

| Area | Files |
| :--- | :--- |
| New | `data/schema.sql`, `data/db/paulhondola/m1pro.sqlite` (from a fresh sweep), `web/src/lib/views.sql`, `web/src/lib/hosts.ts`, `.host` (git-ignored) |
| Rust | `Cargo.toml` (drop `csv`, add `rusqlite` with `bundled`), `build.rs` (rustc version), `cli.rs` (knob flags, `--output .sqlite`, the `validate` subcommand), `kernel.rs` (param declarations, un-gated metadata), `kernels/**` (`params()`), `benchmark.rs`, `context.rs` (hardware), `report.rs` (CSV writer removed), new `db.rs` (writer) and `validate.rs` |
| Web | `db.ts`, `state.svelte.ts`, `derive.ts`, `hardware.ts`, `charts/blocksize.ts` (becomes the knob chart) and its docs, `App.svelte`, `fixtures.ts`, `vite.config.ts`, `package.json` (add `sql.js`) |
| Deleted | `data/build.sql`, `data/runs/`, the `results.json`/`peaks.json` generation |
| Tooling | `justfile`, `lefthook.yml`, `.github/workflows/ci.yml`, `deploy.yml`, `.gitignore` (`.host`), `.claude/hooks/session-start.sh` (no DuckDB) |
| Docs and agents | `README.md` (data section, CLI, CSV schema → DB schema, the stale block-size lines), `CLAUDE.md` (summary line, `just data`, the run-file and peaks gotchas), `.claude/agents/adversarial-reviewer.md` (target `validate` and the writer instead of `build.sql`), `.claude/agents/dashboard-designer.md`, `.claude/skills/bench-compare/SKILL.md` (DuckDB → `sqlite3` over the `latest` view) |

## Integration

- **Data cutover:** the legacy CSVs are deleted in the same change that commits the first `m1pro.sqlite`, which comes from a fresh full sweep. The dashboard never exists in a half-migrated state.
- **The peaks rules move from SQL to a `bun test`**, keeping the same rules: exact header, a non-blank source, backend `cpu`/`metal`, a whole number of cores ≥ 1, a finite gflops > 0, no duplicate ceiling, and no row that matches no host's (device, backend, precision). The last rule now reads every committed DB.

## Testing

**Rust (`cargo test`):**
- The schema applies to an empty DB, and the `PRAGMA`s read back.
- A writer round trip: records → DB → rows read back, including `+Inf`, NaN→NULL and Metal `gpu_ms`.
- The up-front refusals: a foreign SQLite file, `user_version` 2, the wrong `application_id`, a duplicate `started_at`, and a missing or malformed `.host`.
- **Param declaration = report** for every kernel, at several n and every supported precision.
- **One crafted DB per `validate` rule:** a stripped `CHECK`, an extra trigger, a path outside the pattern, an oversized file, an undeclared param, a duplicate cell, a Metal row in a GPU-less run, and control characters.
- Hardware parsers on captured text: this M1 Pro's `sysctl` output, plus sysfs trees for a hybrid Intel and an X3D.
- CLI: the aliases, `--block-size` rejected, an unused knob flag rejected only when given explicitly, and preset keys including aliases.

**Web (`bun test`):**
- Fixture DBs are built from `data/schema.sql`, and the views run **through sql.js**, the engine browsers use. Covered: latest wins, `{}` params, device derivation, and `gpu_cores`.
- The peaks parser handles quoted commas, and each peaks rule has a failing fixture.
- Derive and chart tests run on rows that came from the views. The docs tests cover the new knob names and the `matrix` family.

## Acceptance

1. **Quick run on this machine:** `just init paulhondola/m1pro` then `just bench --config configs/quick.toml` creates `data/db/paulhondola/m1pro.sqlite`, and `just validate` passes on it.
2. **Fresh full sweep:** a sweep on the M1 Pro is committed and the CSVs are deleted. The deployed dashboard shows the host in the selector and the same charts as today, apart from the latest-run rule replacing best-of-reruns. Its `.sqlite` assets and sql.js wasm load on GitHub Pages with no console errors.
3. **CI gates:** a PR touching `data/db/someone-else/…` fails the ownership step, and each crafted bad DB fails `validate`.
4. **No DuckDB left:** `just check && just test` pass, and `rg -i duckdb` finds nothing outside the history docs.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| Git history grows with every committed DB version: about 240 KB gzipped per full sweep per host, stored as a new blob each commit | Acceptable at today's scale. A run-pruning policy can be added later; the `latest` view never reads old runs anyway |
| A schema feature newer than sql.js's SQLite (3.49.1) would write DBs browsers can't read | The web tests load `data/schema.sql` through sql.js, so such a feature fails `bun test` |
| Linux tier detection guesses wrong on unusual machines | Detection is best-effort, and wrong or unknown topology never blocks a run (zero rows) |
| A same-second `started_at` collision | Checked up front. Two concurrent sweeps on one machine are invalid measurements anyway |
| The run is all-or-nothing: a crash late in a long sweep loses everything | Same as the CSV writer today. Incremental commits are a follow-up |
| Byte-exact schema comparison could break if a future `Cargo.lock` update changes how SQLite formats stored DDL | Only relevant once migrations exist. If it happens, normalize quotes and whitespace before comparing |

## Follow-ups

- **Comparing hosts in the dashboard,** with host colours (sendoff open question 10). This uses the approved merge path: open several DBs, run the views, concatenate the rows.
- **Migrations, once there are contributors.** Two findings from this brainstorm:
  - **The reference schema must be rebuilt by replaying history.** A DB migrated v1→v3 matched one built fresh from the migration list byte for byte, but a hand-written v3 DDL did not (`RENAME` adds quotes, and `ADD COLUMN` appends its own text).
  - **Lazy vs eager.** Lazy means pure-SQL migrations shared by Rust and the browser, applied on read and on the owner's next write, so a file only changes when its owner writes. Eager means the bump PR rewrites everyone's DB, which needs a CI ownership exception and can cause binary conflicts for contributors with unpushed runs.
- **Incremental per-cell commits,** with a run-completion marker.
- **Sub-projects 2 and 3,** using the reserved `row_block`, `col_block` and `depth_step`.
