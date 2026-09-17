# Benchmark Output and Data Pipeline

- **Status:** Proposed
- **Builds on:** DuckDB-WASM dashboard skeleton (`f5f425f`)

The benchmark CLI and the path its results take to `web/public/results.parquet`. The dashboard itself is a skeleton and out of scope. The goal is output that stays trustworthy as runs from many machines, commits, and kernels accumulate.

## Problem

- **Results carry no provenance.** Rows don't record the machine, device, commit, time, or run parameters, so merged runs can't be told apart.
- **Runs overwrite each other.** `--output data/f32` is named by precision only. A second machine, or a partial rerun (`--kernel mps`), replaces earlier rows instead of adding to them.
- **JSON output is dead.** Nothing reads `data/*.json`.
- **The merge query exists twice.** It lives in `justfile` and inline in `deploy.yml`, so the two can drift.
- **Contributor data is validated too late.** The Parquet file is only built on deploy, so a malformed CSV passes PR CI and breaks the deploy after merge.

## Record Schema

`BenchmarkRecord` field order is the CSV column order, grouped by importance:

| # | Column | Type | Group |
|---|---|---|---|
| 1 | `kernel` | text | configuration |
| 2 | `backend` | text: `cpu`, `metal` | |
| 3 | `device` | text | |
| 4 | `precision` | text | |
| 5 | `n` | integer | |
| 6 | `threads` | integer | |
| 7 | `gflops` | float | speed vs accuracy |
| 8 | `mean_rel_error_f64` | float | |
| 9 | `median_ms` | float | timing statistics |
| 10 | `min_ms` | float | |
| 11 | `stddev_ms` | float | |
| 12 | `block_size` | integer | run parameters |
| 13 | `repetitions` | integer | |
| 14 | `host` | text | provenance |
| 15 | `commit` | text | |
| 16 | `timestamp` | text: UTC ISO-8601, `2026-09-17T12:15:00Z` | |

- `mean_rel_error_f64` is always `0.0` for now, marked with a `ponytail:` comment. Roadmap item 4 fills it with the mean element-wise relative error against an f64 reference. That replaces the max-based `max_rel_error_f64` proposed in the item 4 spec.
- `block_size` is the single `--block-size` value on every row. Item 4 makes it empty for kernels that don't use blocks.
- The terminal table is unchanged.

## Run Context

Captured once in `Cli::into_plan`, after plan validation and before opening the output file or running any kernel. Every row of a run shares these values, and all lookups use std only. A failed lookup writes `unknown` and never aborts the run.

| Field | Source |
|---|---|
| `host` | `hostname` command output, cut at the first `.` (`Pauls-MacBook-Pro.local` → `Pauls-MacBook-Pro`) |
| `commit` | `git describe --always --dirty` (`37e8e21` or `37e8e21-dirty`) |
| `timestamp` | `SystemTime::now()`, formatted by a small days-to-civil-date conversion (no `chrono`). The same instant also gives the file stamp `20260917T121500Z`. |

## Backend and Device

The device belongs to the kernel, not the run: in one run, `ikj` uses the CPU and `mps` uses the GPU.

- **`KernelChoice::backend() -> &'static str`** is an exhaustive `match`, like `label()` and `supports()`. A new variant (such as a future `Cuda`) doesn't compile until it names its backend.
- **Device names are looked up once per backend** during plan construction, and stored in the plan:
  - `cpu`: `sysctl -n machdep.cpu.brand_string` on macOS. On Linux, the `model name` line of `/proc/cpuinfo`, read by a pure `parse_cpu_model(&str) -> Option<String>`. `unknown` elsewhere.
  - `metal`: `MTLCreateSystemDefaultDevice()` then `name()`. This is looked up only when `mps` is selected, through a function in `kernels/mps.rs` next to the device `MpsGemm::new` already creates.
  - Future CUDA: the kernel reports the name of the device it actually opened, not the system's first GPU.
- A separate `backend` column is required because Apple Silicon reports the same name (`Apple M1 Pro`) for the CPU and the GPU.

## Output Path

- **`--output` becomes optional.**
  - **Default:** `data/runs/<host>/<file stamp>.csv`, relative to the current directory (`just bench` runs from the repo root).
  - **When given:** it must be a `.csv` path (extension case-insensitive), not an existing directory. This restores the validation of `ff16414`.
- Missing parent directories are created. The file is opened before the sweep and truncated only when records are written, as today, so a failed run leaves existing data intact.
- **Known pitfall:** `cargo run` from inside `benchmark/` writes to `benchmark/data/runs/`. The README documents running via `just bench`.
- **Why append-only:** a new file per run means reruns and partial reruns never destroy data, and contributor PRs only add files, so they never conflict.

## JSON Removal

- `write_records` writes only the CSV.
- Remove `BenchmarkPlan::json_output`, the JSON half of the output-opening code, and the `serde_json` dependency.

## Data Layout and Migration

```
data/
  build.sql
  runs/
    <host>/
      <YYYYMMDDTHHMMSSZ>.csv
```

A one-off DuckDB command, run once on the machine that produced the data (not committed), migrates the current files. Each source commit becomes one run file:

| New file | Source | Timestamp (commit time, UTC) |
|---|---|---|
| `data/runs/Pauls-MacBook-Pro/20260916T183701Z.csv` | `data/f16.csv`, `f32.csv`, `f64.csv` (`b79e416`) | `2026-09-16T18:37:01Z` |
| `data/runs/Pauls-MacBook-Pro/20260916T220656Z.csv` | `data/i32.csv`, `i64.csv` (`37e8e21`) | `2026-09-16T22:06:56Z` |

**How the new columns are filled:**

| Column | Value |
|---|---|
| `backend` | `metal` for `mps`, else `cpu` |
| `device` | `Apple M1 Pro` |
| `host` | `Pauls-MacBook-Pro` |
| `mean_rel_error_f64` | `0.0` |
| `block_size` | `64` |
| `repetitions` | `5` |
| `commit` | `unknown`, because the producing code version wasn't recorded |
| `timestamp` | from the table above, formatted with `strftime` to match the Rust output |

**Deleted:** `data/*.csv`, `data/*.json`, and `data/old/`. `data/old/` has a single `elapsed_ms` per configuration, which can't honestly fill the timing statistics columns, and it was superseded by `b79e416`. Git history keeps all of it.

## Merge Query

`data/build.sql` is the single definition, run as `duckdb -bail < data/build.sql` from the repo root by `just data`, the pre-commit hook, and CI:

```sql
CREATE VIEW runs AS
SELECT * FROM read_csv('data/runs/**/*.csv', union_by_name = true, filename = true,
    types = {'kernel': 'VARCHAR', 'backend': 'VARCHAR', 'device': 'VARCHAR',
             'precision': 'VARCHAR', 'host': 'VARCHAR', 'commit': 'VARCHAR',
             'timestamp': 'TIMESTAMPTZ'});

SELECT error('run files missing required values: ' || string_agg(DISTINCT filename, ', '))
FROM runs
WHERE kernel IS NULL OR backend IS NULL OR device IS NULL OR precision IS NULL
   OR n IS NULL OR threads IS NULL OR gflops IS NULL OR mean_rel_error_f64 IS NULL
   OR median_ms IS NULL OR min_ms IS NULL OR stddev_ms IS NULL OR repetitions IS NULL
   OR host IS NULL OR commit IS NULL OR "timestamp" IS NULL
HAVING count(*) > 0;

COPY (
  SELECT kernel, backend, device, precision, n, threads,
         gflops, mean_rel_error_f64, median_ms, min_ms, stddev_ms,
         block_size, repetitions, host, commit, "timestamp"
  FROM runs
  ORDER BY host, "timestamp", precision, kernel, n, threads
) TO 'web/public/results.parquet' (FORMAT parquet, COMPRESSION zstd);
```

- **Required values are checked explicitly.** `union_by_name` silently fills a column missing from *one* file with NULL (verified on DuckDB v1.5.5), so the column list alone doesn't catch it. The check names the offending files. `block_size` is exempt, because roadmap item 4 leaves it empty for kernels without blocks. A column absent from *every* file fails the `COPY` binder instead.
- **`-bail` is required.** Without it the CLI still exits 1 on an error, but it runs the remaining statements first, so the `COPY` would overwrite the Parquet file with bad data.
- **Explicit types** stop a digit-only commit hash (`1234567`) from being inferred as a number.
- **`ORDER BY`** makes the Parquet file identical for identical input.
- **The Parquet file keeps every run.** Choosing the latest measurement is a query-time concern for the future dashboard.

## Pre-Commit Hooks

- **`data-build`**, a new `lefthook.yml` command: `glob: "data/runs/**/*.csv"`, `run: duckdb -bail < data/build.sql`. A malformed run file fails locally before the PR. It needs the DuckDB CLI, which the README already lists as a prerequisite.
- **`frontend-lint`:** the glob gains `svelte` (`"*.{ts,tsx,js,jsx,json,svelte}"`), so `.svelte` files are linted on commit.

## CI and Deployment

- **`ci.yml` web job** adds three steps: install DuckDB (the same pinned v1.5.5 URL as `deploy.yml`), `duckdb -bail < data/build.sql`, and `bun run build`. Malformed contributor CSVs and web build breaks then fail on the PR instead of after merge.
- **`deploy.yml`:** the inline `COPY` becomes `duckdb -bail < data/build.sql`.
- **`justfile`:** `data` runs `duckdb -bail < data/build.sql`, with its comment updated to `data/runs/**/*.csv`.
- **Deliberately duplicated:** the six-line DuckDB install step lives in both workflows. A composite action for two uses isn't worth it.

## README

- Update the `just data` row and the `--output` flag row (optional, `.csv` path, default location).
- Update the output column list, noting that `gflops` and `mean_rel_error_f64` are informational.
- Replace the Benchmark Data section with the `data/runs/<host>/` layout and the contribution flow: run `just bench`, commit the new file, open a PR, CI validates it.
- Document the device lookup and `unknown` fallbacks.

## Testing

Each test follows the existing patterns in its file.

**`cli.rs`:**
- With `--output` omitted, the default path comes out as `data/runs/<host>/<stamp>.csv` for a given host and stamp.
- `--output results.CSV` is accepted.
- `--output results.json`, `--output results`, and an existing directory are rejected, without creating files.
- A missing parent directory is created.
- `backend()` returns `metal` for `Mps` and `cpu` for every other variant.

**Run context:**
- The date conversion formats Unix epoch `0`, a leap day (`2024-02-29`), and a post-2038 instant in both ISO and file-stamp forms.
- The hostname trim cuts at the first `.`, and a name without a dot is kept whole.
- `parse_cpu_model` finds `model name` in x86 cpuinfo text and returns `None` for ARM cpuinfo text that lacks it.

**`report.rs`:** `write_records` writes the 16-column header in schema order, and no JSON file exists.

**End to end, run manually on macOS:**
1. `just bench --sizes 64,128 --kernel ikj,mps --precision f32` writes one file under `data/runs/Pauls-MacBook-Pro/`, with `backend` `cpu`/`metal`, `device` `Apple M1 Pro`, and a real `commit` and `timestamp`.
2. `just data` succeeds over the migrated files plus that run. `duckdb -c "DESCRIBE 'web/public/results.parquet'"` lists the 16 columns in order, and the row count equals the migrated 677 rows plus the new run.
3. Delete a required column from a copy of a run file. `just data` fails and names that file, and the Parquet file is not rewritten. Remove the copy.
4. The test run file is deleted, not committed.

## Out of Scope

- **Dashboard changes.**
  - **Future note:** the "latest measurement" view should partition by `host, device, kernel, precision, n, threads, block_size`, order by `timestamp` descending, and keep row 1. The full history stays queryable from the Parquet file.
- **Computing `mean_rel_error_f64`, and the block-size sweep:** both are roadmap item 4.
- **Stricter data checks** (non-empty `kernel`, positive timings): add when a real bad PR shows up.
- **`sysinfo`-based device detection** for Windows or ARM Linux: add when a contributor there hits `unknown`.
