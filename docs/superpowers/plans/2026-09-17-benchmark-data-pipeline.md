# Benchmark Output and Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Benchmark runs write self-describing CSV rows to one new file per run, and a single validated DuckDB script merges every run into the dashboard's Parquet file, locally, on commit, and in CI.

**Architecture:** The Rust CLI records run provenance (host, commit, timestamp) and per-kernel backend and device on each record. It writes only CSV, by default to `data/runs/<host>/<stamp>.csv`. `data/build.sql` validates required values and writes `web/public/results.parquet`. `just data`, a lefthook pre-commit command, and both GitHub workflows run it with `duckdb -bail`.

**Tech Stack:** Rust nightly (edition 2024, std only for the new code; `csv`, `serde`, `clap`, and `objc2-metal` are already dependencies), DuckDB CLI v1.5.5, lefthook, GitHub Actions, Bun.

**Spec:** `docs/superpowers/specs/2026-09-17-benchmark-data-pipeline-design.md`

## Global Constraints

- No new Rust dependencies. `serde_json` is removed.
- CSV column order is exactly: `kernel, backend, device, precision, n, threads, gflops, mean_rel_error_f64, median_ms, min_ms, stddev_ms, block_size, repetitions, host, commit, timestamp`.
- `mean_rel_error_f64` is always `0.0`, marked with a `ponytail:` comment naming roadmap item 4.
- Failed host, commit, or device lookups write the string `unknown` and never abort a run.
- `timestamp` format: `YYYY-MM-DDTHH:MM:SSZ` (UTC). File stamp format: `YYYYMMDDTHHMMSSZ`, from the same instant.
- Every DuckDB invocation of the build script is `duckdb -bail < data/build.sql`, run from the repo root.
- DuckDB CLI in CI: `https://github.com/duckdb/duckdb/releases/download/v1.5.5/duckdb_cli-linux-amd64.zip`.
- Every commit must pass the repo's lefthook pre-commit hooks: `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test` on `.rs` changes. Do not use `--no-verify`.
- Rust commands run from the repo root with `--manifest-path benchmark/Cargo.toml`.
- End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `benchmark/src/context.rs` | Create | Run provenance (host, commit, timestamps) and CPU name lookup. Pure formatting and parsing helpers have unit tests. |
| `benchmark/src/main.rs` | Modify | Register `mod context;` and write records to the single output file. |
| `benchmark/src/cli.rs` | Modify | `KernelChoice::backend` and `device`, `Devices`, optional `.csv` `--output`, default path, and the plan carrying context and devices. |
| `benchmark/src/benchmark.rs` | Modify | `BenchmarkRecord` schema and filling the new fields. |
| `benchmark/src/report.rs` | Modify | CSV-only `write_records`. |
| `benchmark/src/kernels/mps.rs` | Modify | `default_device_name()`. |
| `benchmark/Cargo.toml` | Modify | Remove `serde_json`. |
| `data/build.sql` | Create | Validate and merge the run CSVs into Parquet. |
| `data/runs/Pauls-MacBook-Pro/*.csv` | Create | Migrated historical runs. |
| `data/*.csv`, `data/*.json`, `data/old/` | Delete | Superseded formats. |
| `justfile` | Modify | `data` recipe runs `build.sql`. |
| `lefthook.yml` | Modify | `data-build` hook, and `svelte` added to the `frontend-lint` glob. |
| `.github/workflows/ci.yml`, `deploy.yml` | Modify | Build the Parquet file with `build.sql`; CI also builds the web app. |
| `README.md` | Modify | Document the new output, data layout, and contribution flow. |

---

### Task 1: Run provenance columns

Adds `host`, `commit`, and `timestamp`, records `block_size` and `repetitions`, adds the `mean_rel_error_f64` placeholder, and reorders the record fields. Backend and device come in Task 2.

**Files:**
- Create: `benchmark/src/context.rs`
- Modify: `benchmark/src/main.rs`, `benchmark/src/cli.rs` (`BenchmarkPlan`, `into_plan`, one test), `benchmark/src/benchmark.rs` (`BenchmarkRecord`, record construction), `benchmark/src/report.rs` (tests)

**Interfaces:**
- Produces:
  - `context::UNKNOWN: &str = "unknown"`
  - `context::RunContext { pub(crate) host: String, pub(crate) commit: String, pub(crate) timestamp: String }` (derives `Debug`)
  - `context::capture() -> RunContext`
  - `context::command_output(program: &str, args: &[&str]) -> Option<String>` (`pub(crate)`)
  - private `context::utc_fields(secs: u64) -> [u64; 6]` (year, month, day, hour, minute, second)
  - `BenchmarkPlan.context: RunContext`
  - `BenchmarkRecord` fields in order: `kernel: String, precision: &'static str, n: usize, threads: usize, gflops: f64, mean_rel_error_f64: f64, median_ms: f64, min_ms: f64, stddev_ms: f64, block_size: usize, repetitions: usize, host: String, commit: String, timestamp: String`

- [ ] **Step 1: Write the failing context tests**

Create `benchmark/src/context.rs` containing only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::{capture, iso_timestamp, short_host};

    #[test]
    fn iso_timestamp_formats_utc_calendar_dates() {
        assert_eq!(iso_timestamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_timestamp(1_709_210_096), "2024-02-29T12:34:56Z");
        assert_eq!(iso_timestamp(2_208_988_800), "2040-01-01T00:00:00Z");
    }

    #[test]
    fn short_host_drops_the_domain() {
        assert_eq!(short_host("Pauls-MacBook-Pro.local"), "Pauls-MacBook-Pro");
        assert_eq!(short_host("build-box"), "build-box");
    }

    #[test]
    fn capture_fills_every_field() {
        let context = capture();
        assert!(!context.host.is_empty());
        assert!(!context.commit.is_empty());
        assert_eq!(context.timestamp.len(), "2026-09-17T12:15:00Z".len());
        assert!(context.timestamp.ends_with('Z'));
    }
}
```

In `benchmark/src/main.rs`, register the module after `mod cli;`:

```rust
mod benchmark;
mod cli;
mod context;
mod report;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml context::`
Expected: compile error, `unresolved imports super::capture, super::iso_timestamp, super::short_host`.

- [ ] **Step 3: Implement `context.rs`**

Put this above the test module in `benchmark/src/context.rs`:

```rust
//! Where and when a run happened, captured once before any kernel runs.

use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

/// Written in place of any value a lookup could not determine.
pub(crate) const UNKNOWN: &str = "unknown";

/// Provenance shared by every record of one run.
#[derive(Debug)]
pub(crate) struct RunContext {
    pub(crate) host: String,
    pub(crate) commit: String,
    pub(crate) timestamp: String,
}

/// Looks up the host and commit and reads the clock. Failed lookups become
/// `unknown` so a missing `git` or `hostname` never aborts a benchmark.
pub(crate) fn capture() -> RunContext {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    RunContext {
        host: command_output("hostname", &[])
            .map_or_else(|| UNKNOWN.to_owned(), |raw| short_host(&raw)),
        commit: command_output("git", &["describe", "--always", "--dirty"])
            .unwrap_or_else(|| UNKNOWN.to_owned()),
        timestamp: iso_timestamp(secs),
    }
}

/// Trimmed stdout of a successful command, or `None` if it failed or printed nothing.
pub(crate) fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    let text = stdout.trim();
    (output.status.success() && !text.is_empty()).then(|| text.to_owned())
}

/// `Pauls-MacBook-Pro.local` → `Pauls-MacBook-Pro`: the domain adds nothing
/// to results and would differ between networks.
fn short_host(raw: &str) -> String {
    raw.split('.').next().unwrap_or(raw).to_owned()
}

fn iso_timestamp(secs: u64) -> String {
    let [year, month, day, hour, minute, second] = utc_fields(secs);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Splits Unix seconds into UTC `[year, month, day, hour, minute, second]`,
/// using Howard Hinnant's `civil_from_days`, which avoids a date dependency.
fn utc_fields(secs: u64) -> [u64; 6] {
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    [year, month, day, rem / 3_600, rem % 3_600 / 60, rem % 60]
}
```

- [ ] **Step 4: Run the context tests to verify they pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml context::`
Expected: 3 passed.

- [ ] **Step 5: Write the failing record tests**

In `benchmark/src/report.rs`, replace the test module's first test (`terminal_table_uses_schema_headers_and_compact_float_precision`) and the last test (`write_records_outputs_both_valid_csv_and_json`) with the code below. Add the `record` helper at the top of the test module, after the `use` lines. Keep `progress_bar_lifecycle_disabled` and `template_compilation` unchanged.

```rust
    fn record() -> BenchmarkRecord {
        BenchmarkRecord {
            kernel: "rayon-ikj".to_owned(),
            precision: "f32",
            n: 256,
            threads: 4,
            gflops: 2.5,
            mean_rel_error_f64: 0.0,
            median_ms: 12.345_67,
            min_ms: 12.0,
            stddev_ms: 0.25,
            block_size: 64,
            repetitions: 5,
            host: "test-host".to_owned(),
            commit: "abc1234".to_owned(),
            timestamp: "2026-09-17T12:15:00Z".to_owned(),
        }
    }

    #[test]
    fn terminal_table_uses_schema_headers_and_compact_float_precision() {
        let table = render_results_table(&[record()]);

        assert!(table.contains("kernel"));
        assert!(table.contains("precision"));
        assert!(table.contains("f32"));
        assert!(table.contains("median_ms"));
        assert!(table.contains("stddev_ms"));
        assert!(table.contains("0.250"));
        assert!(table.contains("rayon-ikj"));
        assert!(table.contains("12.346"));
        assert!(table.contains("2.500"));
    }
```

```rust
    #[test]
    fn write_records_outputs_both_valid_csv_and_json() {
        let temp_dir =
            std::env::temp_dir().join(format!("rayon-gemm-report-test-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let csv_path = temp_dir.join("test.csv");
        let json_path = temp_dir.join("test.json");

        let csv_file = std::fs::File::create(&csv_path).expect("create csv file");
        let json_file = std::fs::File::create(&json_path).expect("create json file");

        super::write_records(csv_file, json_file, &[record()]).expect("write records");

        let csv_content = std::fs::read_to_string(&csv_path).expect("read csv");
        assert_eq!(
            csv_content,
            "kernel,precision,n,threads,gflops,mean_rel_error_f64,median_ms,min_ms,stddev_ms,block_size,repetitions,host,commit,timestamp\n\
             rayon-ikj,f32,256,4,2.5,0.0,12.34567,12.0,0.25,64,5,test-host,abc1234,2026-09-17T12:15:00Z\n"
        );

        let json_content = std::fs::read_to_string(&json_path).expect("read json");
        assert!(json_content.contains("\"kernel\": \"rayon-ikj\""));

        let _ = std::fs::remove_dir_all(temp_dir);
    }
```

In `benchmark/src/cli.rs`, add one assertion to `empty_sweeps_expand_to_defaults`, right after `assert!(plan.total_configurations() > 0);`:

```rust
        assert!(!plan.context.host.is_empty());
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: compile errors: `struct BenchmarkRecord has no field named mean_rel_error_f64` (and likewise `block_size`, `repetitions`, `host`, `commit`, `timestamp`), plus `no field context on type BenchmarkPlan`.

- [ ] **Step 7: Implement the schema and wire the context**

In `benchmark/src/benchmark.rs`, replace the `BenchmarkRecord` struct:

```rust
/// One measured benchmark configuration, shared by terminal and file reporters.
/// Field order is the CSV column order.
#[derive(Debug, Serialize)]
pub(crate) struct BenchmarkRecord {
    pub(crate) kernel: String,
    pub(crate) precision: &'static str,
    pub(crate) n: usize,
    pub(crate) threads: usize,
    pub(crate) gflops: f64,
    pub(crate) mean_rel_error_f64: f64,
    pub(crate) median_ms: f64,
    pub(crate) min_ms: f64,
    pub(crate) stddev_ms: f64,
    pub(crate) block_size: usize,
    pub(crate) repetitions: usize,
    pub(crate) host: String,
    pub(crate) commit: String,
    pub(crate) timestamp: String,
}
```

In the same file, replace the `records.push(BenchmarkRecord { ... });` call in `run_precision`:

```rust
                records.push(BenchmarkRecord {
                    kernel: kernel.label().to_owned(),
                    precision: precision.label(),
                    n,
                    threads: thread_count,
                    gflops,
                    // ponytail: placeholder until roadmap item 4 measures error against an f64 reference.
                    mean_rel_error_f64: 0.0,
                    median_ms: stats.median_ms,
                    min_ms: stats.min_ms,
                    stddev_ms: stats.stddev_ms,
                    block_size: plan.block_size,
                    repetitions: plan.repetitions,
                    host: plan.context.host.clone(),
                    commit: plan.context.commit.clone(),
                    timestamp: plan.context.timestamp.clone(),
                });
```

In `benchmark/src/cli.rs`:
- Add `use crate::context::{self, RunContext};` below `use clap::{Parser, ValueEnum};`.
- Add the field `pub(crate) context: RunContext,` to `BenchmarkPlan`, after `block_size`.
- In `into_plan`, capture the context between precision validation and opening outputs, and store it:

```rust
        validate_static_threads(&kernels, &threads, &sizes)?;
        validate_precisions(&kernels, &precisions)?;
        let context = context::capture();
        let (csv_output, json_output) = open_outputs(&self.output)?;

        Ok(BenchmarkPlan {
            sizes,
            threads,
            kernels,
            precisions,
            repetitions: self.repetitions,
            block_size: self.block_size,
            context,
            csv_output,
            json_output,
            no_progress: self.no_progress,
        })
```

- [ ] **Step 8: Run all checks**

Run: `cargo test --manifest-path benchmark/Cargo.toml && cargo clippy --manifest-path benchmark/Cargo.toml --all-targets --all-features -- -D warnings`
Expected: all tests pass, and clippy reports no warnings.

If the exact-string CSV assertion fails only on float formatting (for example `12` instead of `12.0`), update the expected string to what the `csv` crate writes. Keep the column order.

- [ ] **Step 9: Commit**

```bash
git add benchmark/src/context.rs benchmark/src/main.rs benchmark/src/cli.rs benchmark/src/benchmark.rs benchmark/src/report.rs
git commit -m "Record run host, commit, timestamp, and parameters on each result

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Backend and device columns

**Files:**
- Modify: `benchmark/src/context.rs` (`cpu_name`, `parse_cpu_model`), `benchmark/src/kernels/mps.rs` (`default_device_name`), `benchmark/src/cli.rs` (`KernelChoice::backend` and `device`, `Devices`, plan field, tests), `benchmark/src/benchmark.rs` (record fields), `benchmark/src/report.rs` (test helper and expected CSV)

**Interfaces:**
- Consumes (from Task 1): `context::UNKNOWN`, `context::command_output`, `BenchmarkRecord`, `BenchmarkPlan.context`
- Produces:
  - `context::cpu_name() -> String`
  - `rayon_gemm::kernels::mps::default_device_name() -> Option<String>` (macOS only)
  - `cli::Devices { pub(crate) cpu: String, #[cfg(target_os = "macos")] pub(crate) metal: String }` (derives `Debug`), with `Devices::lookup(kernels: &[KernelChoice]) -> Devices`
  - `KernelChoice::backend(self) -> &'static str`, and `KernelChoice::device(self, devices: &Devices) -> &str`
  - `BenchmarkPlan.devices: Devices`
  - `BenchmarkRecord` gains `backend: &'static str` and `device: String`, directly after `kernel`

- [ ] **Step 1: Write the failing tests**

In `benchmark/src/context.rs`, change the test `use` to `use super::{capture, cpu_name, iso_timestamp, parse_cpu_model, short_host};` and add:

```rust
    #[test]
    fn parse_cpu_model_reads_the_x86_model_name() {
        let cpuinfo = "processor\t: 0\nvendor_id\t: AuthenticAMD\nmodel name\t: AMD Ryzen 9 7950X 16-Core Processor\n";
        assert_eq!(
            parse_cpu_model(cpuinfo).as_deref(),
            Some("AMD Ryzen 9 7950X 16-Core Processor")
        );
    }

    #[test]
    fn parse_cpu_model_is_none_when_arm_cpuinfo_lacks_a_model_name() {
        let cpuinfo = "processor\t: 0\nBogoMIPS\t: 48.00\nCPU implementer\t: 0x41\n";
        assert_eq!(parse_cpu_model(cpuinfo), None);
    }

    #[test]
    fn cpu_name_is_never_empty() {
        assert!(!cpu_name().is_empty());
    }
```

In `benchmark/src/cli.rs` tests, change the `use super::...` line to:

```rust
    use clap::{Parser, ValueEnum};

    use super::{Cli, Devices, KernelChoice, Precision, open_outputs, validate_and_resolve_output_paths};
```

(Remove the old separate `use clap::Parser;` line.) Then add:

```rust
    #[test]
    fn every_kernel_names_its_backend() {
        for &kernel in KernelChoice::value_variants() {
            #[cfg(target_os = "macos")]
            if kernel == KernelChoice::Mps {
                assert_eq!(kernel.backend(), "metal");
                continue;
            }
            assert_eq!(kernel.backend(), "cpu", "{}", kernel.label());
        }
    }

    #[test]
    fn kernels_report_the_device_of_their_backend() {
        let devices = Devices {
            cpu: "Test CPU".to_owned(),
            #[cfg(target_os = "macos")]
            metal: "Test GPU".to_owned(),
        };
        assert_eq!(KernelChoice::RayonTiled.device(&devices), "Test CPU");
        #[cfg(target_os = "macos")]
        assert_eq!(KernelChoice::Mps.device(&devices), "Test GPU");
    }
```

In `mps_parses_as_a_kernel_choice` (macOS only), add after `assert_eq!(plan.kernels, [KernelChoice::Mps]);`:

```rust
        assert_ne!(plan.devices.metal, "unknown", "a Mac with Metal must name its GPU");
```

In `benchmark/src/report.rs` tests, add these two fields to the `record()` helper, directly after `kernel`:

```rust
            backend: "cpu",
            device: "Test CPU".to_owned(),
```

and change the expected CSV in `write_records_outputs_both_valid_csv_and_json` to:

```rust
            "kernel,backend,device,precision,n,threads,gflops,mean_rel_error_f64,median_ms,min_ms,stddev_ms,block_size,repetitions,host,commit,timestamp\n\
             rayon-ikj,cpu,Test CPU,f32,256,4,2.5,0.0,12.34567,12.0,0.25,64,5,test-host,abc1234,2026-09-17T12:15:00Z\n"
```

(Keep whatever float formatting Task 1 confirmed.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: compile errors: unresolved `cpu_name`, `parse_cpu_model`, and `Devices`; no method `backend` or `device` on `KernelChoice`; `BenchmarkRecord` has no field `backend`.

- [ ] **Step 3: Implement CPU lookup in `context.rs`**

Add above the test module:

```rust
/// The CPU model, e.g. `Apple M1 Pro` or `AMD Ryzen 9 7950X 16-Core Processor`.
pub(crate) fn cpu_name() -> String {
    #[cfg(target_os = "macos")]
    let name = command_output("sysctl", &["-n", "machdep.cpu.brand_string"]);
    #[cfg(target_os = "linux")]
    let name = std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|cpuinfo| parse_cpu_model(&cpuinfo));
    // ponytail: Windows and other targets report `unknown`; use `sysinfo` once a contributor needs them.
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let name: Option<String> = None;
    name.unwrap_or_else(|| UNKNOWN.to_owned())
}

/// The first `model name` line of `/proc/cpuinfo`. ARM kernels often omit it.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_cpu_model(cpuinfo: &str) -> Option<String> {
    cpuinfo.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "model name").then(|| value.trim().to_owned())
    })
}
```

- [ ] **Step 4: Implement the Metal device name**

In `benchmark/src/kernels/mps.rs`, add directly above `/// A dense matrix multiplication kernel leveraging Apple's `MPSMatrixMultiplication`.`:

```rust
/// Name of the system default Metal device, the one `MpsGemm::new` acquires.
pub fn default_device_name() -> Option<String> {
    MTLCreateSystemDefaultDevice().map(|device| device.name().to_string())
}
```

- [ ] **Step 5: Implement backend, device, and `Devices` in `cli.rs`**

Add these methods inside `impl KernelChoice`, after `label`. The explicit variant lists (no `_` arm) make a new kernel fail to compile until it names its backend and device.

```rust
    /// Hardware family the kernel runs on. Needed next to `device` because
    /// Apple Silicon reports the same name for its CPU and GPU.
    pub(crate) fn backend(self) -> &'static str {
        match self {
            Self::Naive
            | Self::Ikj
            | Self::Tiled
            | Self::RayonIkj
            | Self::RayonTiled
            | Self::StaticIkj
            | Self::StaticTiled => "cpu",
            #[cfg(target_os = "macos")]
            Self::Mps => "metal",
        }
    }

    pub(crate) fn device(self, devices: &Devices) -> &str {
        match self {
            Self::Naive
            | Self::Ikj
            | Self::Tiled
            | Self::RayonIkj
            | Self::RayonTiled
            | Self::StaticIkj
            | Self::StaticTiled => &devices.cpu,
            #[cfg(target_os = "macos")]
            Self::Mps => &devices.metal,
        }
    }
```

Add this below the `BenchmarkPlan` struct:

```rust
/// Device names, looked up once per backend before any kernel runs.
#[derive(Debug)]
pub(crate) struct Devices {
    pub(crate) cpu: String,
    #[cfg(target_os = "macos")]
    pub(crate) metal: String,
}

impl Devices {
    // Off macOS only the CPU is looked up, leaving `kernels` unread.
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    fn lookup(kernels: &[KernelChoice]) -> Self {
        Self {
            cpu: context::cpu_name(),
            #[cfg(target_os = "macos")]
            metal: kernels
                .contains(&KernelChoice::Mps)
                .then(rayon_gemm::kernels::mps::default_device_name)
                .flatten()
                .unwrap_or_else(|| context::UNKNOWN.to_owned()),
        }
    }
}
```

Add `pub(crate) devices: Devices,` to `BenchmarkPlan` after `context`. In `into_plan`, add `let devices = Devices::lookup(&kernels);` directly after `let context = context::capture();`, and `devices,` after `context,` in the `BenchmarkPlan` literal.

- [ ] **Step 6: Fill the record fields**

In `benchmark/src/benchmark.rs`, add to `BenchmarkRecord` directly after `kernel`:

```rust
    pub(crate) backend: &'static str,
    pub(crate) device: String,
```

and to the `records.push(BenchmarkRecord { ... })` literal directly after `kernel: ...`:

```rust
                    backend: kernel.backend(),
                    device: kernel.device(&plan.devices).to_owned(),
```

- [ ] **Step 7: Run all checks**

Run: `cargo test --manifest-path benchmark/Cargo.toml && cargo clippy --manifest-path benchmark/Cargo.toml --all-targets --all-features -- -D warnings`
Expected: all tests pass (on macOS, including `mps_parses_as_a_kernel_choice`), and clippy reports no warnings.

- [ ] **Step 8: Commit**

```bash
git add benchmark/src/context.rs benchmark/src/kernels/mps.rs benchmark/src/cli.rs benchmark/src/benchmark.rs benchmark/src/report.rs
git commit -m "Record each kernel's backend and device name

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: CSV-only output with a default per-run path

**Files:**
- Modify: `benchmark/src/context.rs` (`file_stamp`), `benchmark/src/cli.rs` (the `output` flag, validation, opening, plan fields, tests), `benchmark/src/report.rs` (`write_records`, test), `benchmark/src/main.rs`, `benchmark/Cargo.toml`

**Interfaces:**
- Consumes (from Tasks 1–2): `RunContext`, `context::capture`, `context::utc_fields`, `Devices::lookup`
- Produces:
  - `RunContext.file_stamp: String`
  - `cli::default_output_path(host: &str, file_stamp: &str) -> PathBuf`
  - `cli::validate_output_path(path: &Path) -> Result<(), String>`
  - `cli::open_output(path: &Path) -> Result<File, String>`
  - `BenchmarkPlan.output: File` and `BenchmarkPlan.output_path: PathBuf` (replacing `csv_output` and `json_output`)
  - `report::write_records(csv_file: File, records: &[BenchmarkRecord]) -> Result<(), Box<dyn std::error::Error>>`

- [ ] **Step 1: Write the failing context test**

In `benchmark/src/context.rs` tests, add `file_stamp` to the `use super::{...}` list and add:

```rust
    #[test]
    fn file_stamp_is_a_compact_sortable_utc_instant() {
        assert_eq!(file_stamp(0), "19700101T000000Z");
        assert_eq!(file_stamp(1_709_210_096), "20240229T123456Z");
        assert_eq!(file_stamp(2_208_988_800), "20400101T000000Z");
    }
```

and extend `capture_fills_every_field` with:

```rust
        assert_eq!(context.file_stamp.len(), "20260917T121500Z".len());
```

- [ ] **Step 2: Rewrite the CLI output tests**

In `benchmark/src/cli.rs` tests:

1. Change the import line to:

```rust
    use super::{
        Cli, Devices, KernelChoice, Precision, default_output_path, open_output,
        validate_output_path,
    };
```

2. Replace `temp_output` so it returns a `.csv` file path:

```rust
    /// A per-process `.csv` path under the system temp directory, so tests never
    /// write into the repository and parallel test runs do not collide.
    fn temp_output(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("rayon-gemm-test-{}-{name}.csv", std::process::id()))
    }
```

3. In `empty_sweeps_expand_to_defaults`, change `output: output.clone(),` to `output: Some(output.clone()),`.

4. Throughout the test module, replace every cleanup pair
```rust
        let _ = fs::remove_file(output.with_extension("csv"));
        let _ = fs::remove_file(output.with_extension("json"));
```
with
```rust
        let _ = fs::remove_file(&output);
```

5. Throughout the test module, replace every "not created" pair, in whichever of these two forms it appears:
```rust
        assert!(!output.with_extension("csv").exists());
        assert!(!output.with_extension("json").exists());
```
or the multi-line `assert!(!output.with_extension("csv").exists(), "a rejected plan must not create the output file"); assert!(!output.with_extension("json").exists(), ...);`, with
```rust
        assert!(!output.exists(), "a rejected plan must not create the output file");
```

6. Delete these tests: `output_with_extension_is_rejected`, `output_as_existing_directory_is_rejected`, `output_creates_both_csv_and_json_files`, `missing_output_directories_are_created_before_running`, `unusable_output_paths_are_rejected_before_running`, and `existing_output_is_not_truncated_until_records_are_written`. Add these in their place:

```rust
    #[test]
    fn default_output_is_a_new_file_per_run_under_the_host() {
        assert_eq!(
            default_output_path("Pauls-MacBook-Pro", "20260917T121500Z"),
            PathBuf::from("data/runs/Pauls-MacBook-Pro/20260917T121500Z.csv")
        );
    }

    #[test]
    fn output_accepts_csv_in_any_case() {
        validate_output_path(PathBuf::from("results.csv").as_path()).expect("lowercase csv");
        validate_output_path(PathBuf::from("data/results.CSV").as_path()).expect("uppercase CSV");
    }

    #[test]
    fn output_without_a_csv_extension_is_rejected() {
        for path in ["results", "data/f16.json", ""] {
            let error = validate_output_path(PathBuf::from(path).as_path())
                .expect_err("non-csv output must be rejected");
            assert!(error.contains(".csv"), "{path}: {error}");
        }
    }

    #[test]
    fn output_as_existing_directory_is_rejected() {
        let dir = temp_output("existing_dir");
        fs::create_dir_all(&dir).expect("create test dir");

        let error =
            validate_output_path(&dir).expect_err("existing directory must be rejected");
        assert!(error.contains("is an existing directory"));

        fs::remove_dir_all(dir).expect("remove test dir");
    }

    #[test]
    fn missing_output_directories_are_created_before_running() {
        let root = std::env::temp_dir().join(format!("rayon-gemm-test-{}-nested", std::process::id()));
        let output = root.join("a/b/results.csv");

        drop(open_output(&output).expect("missing parent directories should be created"));

        assert!(output.is_file());
        fs::remove_dir_all(root).expect("remove test directories");
    }

    #[test]
    fn unusable_output_paths_are_rejected_before_running() {
        let blocker = temp_output("blocker");
        fs::write(&blocker, b"").expect("create a regular file");

        let error = open_output(&blocker.join("results.csv"))
            .expect_err("a regular file cannot be a parent directory");

        assert!(error.contains("output directory"));
        fs::remove_file(blocker).expect("remove test file");
    }

    #[test]
    fn existing_output_is_not_truncated_until_records_are_written() {
        let output = temp_output("existing");
        fs::write(&output, b"previous csv").expect("seed existing csv");

        drop(open_output(&output).expect("existing output should open"));

        assert_eq!(fs::read(&output).expect("read existing output"), b"previous csv");
        let _ = fs::remove_file(output);
    }
```

- [ ] **Step 3: Rewrite the report test**

In `benchmark/src/report.rs`, replace `write_records_outputs_both_valid_csv_and_json` with this version. The expected CSV string is identical to the one Task 2 finalized.

```rust
    #[test]
    fn write_records_outputs_csv_in_schema_order() {
        let csv_path = std::env::temp_dir()
            .join(format!("rayon-gemm-report-test-{}.csv", std::process::id()));
        let csv_file = std::fs::File::create(&csv_path).expect("create csv file");

        super::write_records(csv_file, &[record()]).expect("write records");

        let csv_content = std::fs::read_to_string(&csv_path).expect("read csv");
        assert_eq!(
            csv_content,
            "kernel,backend,device,precision,n,threads,gflops,mean_rel_error_f64,median_ms,min_ms,stddev_ms,block_size,repetitions,host,commit,timestamp\n\
             rayon-ikj,cpu,Test CPU,f32,256,4,2.5,0.0,12.34567,12.0,0.25,64,5,test-host,abc1234,2026-09-17T12:15:00Z\n"
        );
        let _ = std::fs::remove_file(csv_path);
    }
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml`
Expected: compile errors: unresolved `file_stamp`, `default_output_path`, `open_output`, and `validate_output_path`; mismatched `Option<PathBuf>` for `output`; and `write_records` takes 3 arguments but 2 were supplied.

- [ ] **Step 5: Implement `file_stamp`**

In `benchmark/src/context.rs`:
- Add `pub(crate) file_stamp: String,` to `RunContext` after `timestamp`.
- In `capture()`, add `file_stamp: file_stamp(secs),` after `timestamp: iso_timestamp(secs),`.
- Add below `iso_timestamp`:

```rust
/// The same instant as `iso_timestamp`, without separators, for filenames:
/// colons are invalid on Windows, and this still sorts chronologically.
fn file_stamp(secs: u64) -> String {
    let [year, month, day, hour, minute, second] = utc_fields(secs);
    format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}Z")
}
```

- [ ] **Step 6: Implement the output path handling in `cli.rs`**

Replace the `output` field of `Cli` (and its doc comment):

```rust
    /// Output CSV file. Defaults to a new file per run,
    /// data/runs/<host>/<timestamp>.csv; missing parent directories are created.
    #[arg(long)]
    output: Option<PathBuf>,
```

In `BenchmarkPlan`, replace `csv_output` and `json_output` with:

```rust
    pub(crate) output: File,
    pub(crate) output_path: PathBuf,
```

In `into_plan`, replace the `open_outputs` line and the output fields of the literal:

```rust
        let context = context::capture();
        let devices = Devices::lookup(&kernels);
        let output_path = self
            .output
            .unwrap_or_else(|| default_output_path(&context.host, &context.file_stamp));
        let output = open_output(&output_path)?;

        Ok(BenchmarkPlan {
            sizes,
            threads,
            kernels,
            precisions,
            repetitions: self.repetitions,
            block_size: self.block_size,
            context,
            devices,
            output,
            output_path,
            no_progress: self.no_progress,
        })
```

Delete `validate_and_resolve_output_paths` and `open_outputs`, and add in their place:

```rust
/// Each run gets its own file, so reruns and other machines add data instead
/// of replacing it. Relative to the working directory: `just bench` runs from the repo root.
fn default_output_path(host: &str, file_stamp: &str) -> PathBuf {
    Path::new("data/runs").join(host).join(format!("{file_stamp}.csv"))
}

/// `--output` names the CSV file itself.
fn validate_output_path(path: &Path) -> Result<(), String> {
    if path.file_name().is_none() {
        return Err("--output must name a .csv file (e.g. 'results.csv')".into());
    }
    if path.is_dir() {
        return Err(format!(
            "output path '{}' is an existing directory; --output must name a .csv file (e.g. '{}')",
            path.display(),
            path.join("results.csv").display()
        ));
    }
    let is_csv = path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"));
    if !is_csv {
        return Err(format!(
            "--output must be a .csv file path (got '{}')",
            path.display()
        ));
    }
    Ok(())
}

/// Creates missing parent directories and opens the output file before any
/// benchmark runs, so an unwritable path fails immediately instead of after
/// the sweep. The file is not truncated here: existing results keep their
/// contents until new records are written.
fn open_output(path: &Path) -> Result<File, String> {
    validate_output_path(path)?;

    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "cannot create output directory '{}': {error}",
                parent.display()
            )
        })?;
    }

    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|error| format!("cannot open output file '{}': {error}", path.display()))
}
```

- [ ] **Step 7: Make `write_records` CSV-only**

In `benchmark/src/report.rs`, replace `write_records`:

```rust
/// Writes into the output file that `Cli::into_plan` opened before the sweep.
/// Truncation happens only now, so a failed run leaves earlier results intact.
pub(crate) fn write_records(
    mut csv_file: File,
    records: &[BenchmarkRecord],
) -> Result<(), Box<dyn std::error::Error>> {
    csv_file.set_len(0)?;
    csv_file.seek(SeekFrom::Start(0))?;
    let mut writer = csv::Writer::from_writer(csv_file);
    for record in records {
        writer.serialize(record)?;
    }
    writer.flush()?;
    Ok(())
}
```

In `benchmark/src/main.rs`, replace the body's last two statements before `Ok(())`:

```rust
    report::print_results_table(&records);
    report::write_records(plan.output, &records)?;
    eprintln!("Wrote {} records to {}", records.len(), plan.output_path.display());
    Ok(())
```

In `benchmark/Cargo.toml`, delete the line `serde_json = "1.0"`.

- [ ] **Step 8: Run all checks**

Run: `cargo test --manifest-path benchmark/Cargo.toml && cargo clippy --manifest-path benchmark/Cargo.toml --all-targets --all-features -- -D warnings`
Expected: all tests pass, and clippy reports no warnings. `Cargo.lock` drops `serde_json` (and its now-unused dependencies, such as `itoa` or `ryu`, only if nothing else uses them).

Run: `grep -rn "json" benchmark/src`
Expected: no matches.

- [ ] **Step 9: Commit**

```bash
git add benchmark/src/context.rs benchmark/src/cli.rs benchmark/src/report.rs benchmark/src/main.rs benchmark/Cargo.toml benchmark/Cargo.lock
git commit -m "Write one CSV per run to data/runs/<host>/ by default

--output is optional and must name a .csv file. JSON output is removed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Migrate data, add the validated merge script and hooks

**Files:**
- Create: `data/build.sql`, `data/runs/Pauls-MacBook-Pro/20260916T183701Z.csv`, `data/runs/Pauls-MacBook-Pro/20260916T220656Z.csv`
- Delete: `data/f16.csv`, `data/f32.csv`, `data/f64.csv`, `data/i32.csv`, `data/i64.csv`, the matching `.json` files, and `data/old/`
- Modify: `justfile`, `lefthook.yml`

**Interfaces:**
- Consumes: the column order from the Global Constraints (the migrated files must match what Task 3's binary writes).
- Produces: `data/build.sql`, invoked as `duckdb -bail < data/build.sql` from the repo root.

- [ ] **Step 1: Migrate the current CSVs**

Run from the repo root:

```bash
mkdir -p data/runs/Pauls-MacBook-Pro
duckdb -bail <<'SQL'
COPY (
  SELECT kernel, CASE WHEN kernel = 'mps' THEN 'metal' ELSE 'cpu' END AS backend,
         'Apple M1 Pro' AS device, precision, n, threads, gflops,
         0.0 AS mean_rel_error_f64, median_ms, min_ms, stddev_ms,
         64 AS block_size, 5 AS repetitions, 'Pauls-MacBook-Pro' AS host,
         'unknown' AS commit, '2026-09-16T18:37:01Z' AS "timestamp"
  FROM read_csv(['data/f16.csv', 'data/f32.csv', 'data/f64.csv'])
) TO 'data/runs/Pauls-MacBook-Pro/20260916T183701Z.csv' (HEADER);
COPY (
  SELECT kernel, CASE WHEN kernel = 'mps' THEN 'metal' ELSE 'cpu' END AS backend,
         'Apple M1 Pro' AS device, precision, n, threads, gflops,
         0.0 AS mean_rel_error_f64, median_ms, min_ms, stddev_ms,
         64 AS block_size, 5 AS repetitions, 'Pauls-MacBook-Pro' AS host,
         'unknown' AS commit, '2026-09-16T22:06:56Z' AS "timestamp"
  FROM read_csv(['data/i32.csv', 'data/i64.csv'])
) TO 'data/runs/Pauls-MacBook-Pro/20260916T220656Z.csv' (HEADER);
SQL
```

- [ ] **Step 2: Verify the migration**

Run: `head -1 data/runs/Pauls-MacBook-Pro/20260916T183701Z.csv`
Expected: `kernel,backend,device,precision,n,threads,gflops,mean_rel_error_f64,median_ms,min_ms,stddev_ms,block_size,repetitions,host,commit,timestamp`

Run: `duckdb -c "SELECT count(*), count(*) FILTER (backend = 'metal') FROM read_csv('data/runs/**/*.csv')"`
Expected: `677`, `10` (5 old files: 121+121+116+162+162 lines minus 5 headers; 10 `mps` rows).

- [ ] **Step 3: Delete the superseded data**

```bash
git rm -q data/f16.csv data/f32.csv data/f64.csv data/i32.csv data/i64.csv \
  data/f16.json data/f32.json data/f64.json data/i32.json data/i64.json
git rm -rq data/old
```

- [ ] **Step 4: Create `data/build.sql`**

```sql
-- Validates every benchmark run and merges them into the Parquet file the
-- dashboard queries. Run from the repo root: duckdb -bail < data/build.sql
-- -bail matters: without it DuckDB keeps executing after a failed check and
-- the COPY would still overwrite the Parquet file.

CREATE VIEW runs AS
SELECT * FROM read_csv('data/runs/**/*.csv', union_by_name = true, filename = true,
    -- Explicit types stop e.g. a digit-only commit hash being read as a number.
    types = {'kernel': 'VARCHAR', 'backend': 'VARCHAR', 'device': 'VARCHAR',
             'precision': 'VARCHAR', 'host': 'VARCHAR', 'commit': 'VARCHAR',
             'timestamp': 'TIMESTAMPTZ'});

-- union_by_name fills a column missing from one file with NULL instead of
-- failing, so required values are checked explicitly. block_size is exempt:
-- roadmap item 4 leaves it empty for kernels that don't use blocks.
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

- [ ] **Step 5: Point `just data` at the script**

In `justfile`, replace the `data` recipe and its comment:

```just
# Validates data/runs/**/*.csv and merges it into the Parquet file the dashboard queries.
data:
    duckdb -bail < data/build.sql
```

- [ ] **Step 6: Verify the build succeeds**

Run: `just data && duckdb -c "DESCRIBE 'web/public/results.parquet'" && duckdb -c "SELECT count(*) FROM 'web/public/results.parquet'"`
Expected: exit 0. The `DESCRIBE` output lists the 16 columns in Global Constraints order, with `commit` as `VARCHAR` and `timestamp` as `TIMESTAMP WITH TIME ZONE`. The count is `677`.

- [ ] **Step 7: Verify that a malformed run file fails and leaves the Parquet file alone**

```bash
duckdb -c "COPY (SELECT * EXCLUDE (gflops) FROM read_csv('data/runs/Pauls-MacBook-Pro/20260916T220656Z.csv')) TO 'data/runs/Pauls-MacBook-Pro/broken.csv' (HEADER)"
stat -f %m web/public/results.parquet
just data; echo "exit=$?"
stat -f %m web/public/results.parquet
rm data/runs/Pauls-MacBook-Pro/broken.csv
```

Expected:
- `just data` prints `Invalid Input Error: run files missing required values: data/runs/Pauls-MacBook-Pro/broken.csv` and `exit` is non-zero.
- Both `stat` timestamps are identical, meaning the Parquet file was not rewritten.

- [ ] **Step 8: Add the pre-commit hooks**

In `lefthook.yml`, change the `frontend-lint` glob line to:

```yaml
      glob: "*.{ts,tsx,js,jsx,json,svelte}"
```

and append this command at the end of `commands:` (same indentation as `frontend-typecheck`):

```yaml
    data-build:
      glob: "data/runs/**/*.csv"
      run: duckdb -bail < data/build.sql
```

- [ ] **Step 9: Verify the Svelte lint target**

Run: `cd web && bunx @biomejs/biome check src/App.svelte; echo "exit=$?"; cd ..`
Expected: `exit=0`. Two `noUnusedVariables` warnings for `columns` and `fmt` are known false positives: Biome can't see the template using them. They are warnings, not failures, and the hook's `--write` applies only safe fixes, so it won't rename them.

- [ ] **Step 10: Commit (this exercises the new data hook)**

```bash
git add data/build.sql data/runs justfile lefthook.yml
git commit -m "Move benchmark data to per-host run files with a validated merge

data/build.sql rejects run files missing required values. lefthook runs it
on data commits and now lints .svelte files.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Expected: the lefthook summary shows `data-build` ran and passed. (The `git rm` deletions from Step 3 are already staged and go into this commit.)

---

### Task 5: CI and deploy use the shared script

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `data/build.sql` (Task 4)

- [ ] **Step 1: Update `ci.yml`**

Replace the whole `web:` job with:

```yaml
  web:
    name: Web (Data, Lint, Typecheck, Build)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install Dependencies
        run: bun install --frozen-lockfile
        working-directory: web

      - name: Setup DuckDB
        run: |
          curl -fsSL -o duckdb.zip https://github.com/duckdb/duckdb/releases/download/v1.5.5/duckdb_cli-linux-amd64.zip
          unzip -q duckdb.zip -d "$HOME/.local/bin"
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"

      # Rejects contributor run files with missing values before they merge.
      - name: Build Results Parquet
        run: duckdb -bail < data/build.sql

      - name: Biome Lint & Format Check
        run: bunx @biomejs/biome check src
        working-directory: web

      - name: TypeScript Typecheck
        run: bun run typecheck
        working-directory: web

      - name: Build Web App
        run: bun run build
        working-directory: web
```

- [ ] **Step 2: Update `deploy.yml`**

Replace the `Build Results Parquet` step:

```yaml
      - name: Build Results Parquet
        run: duckdb -bail < data/build.sql
```

- [ ] **Step 3: Verify the workflows locally**

Run: `grep -rn "read_csv\|duckdb -bail" .github/workflows`
Expected: no `read_csv` matches, and exactly two `duckdb -bail < data/build.sql` matches (one per workflow).

Run the CI web job's commands in order from the repo root:
```bash
duckdb -bail < data/build.sql && (cd web && bunx @biomejs/biome check src && bun run typecheck && bun run build)
```
Expected: exit 0, and `web/dist/results.parquet` exists.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml
git commit -m "Validate benchmark data and build the web app in PR CI

Both workflows run data/build.sql instead of an inline copy of the merge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: README and end-to-end verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

Apply each replacement exactly (old → new):

1. Repository layout row:
   - old: ``| [`data/`](data) | Recorded benchmark runs (`f16`, `f32`, `f64`), each as `.csv` and `.json`. |``
   - new: ``| [`data/`](data) | Benchmark runs as `runs/<host>/<timestamp>.csv`, and `build.sql`, which validates and merges them for the dashboard. |``
2. Prerequisites row: in ``| [DuckDB CLI](https://duckdb.org) | `just data` |``, change ``| `just data` |`` to ``| `just data`, the data pre-commit hook |``.
3. Quick start: ``just bench --sizes 256,512 --kernel ikj,rayon-ikj --output results`` → ``just bench --sizes 256,512 --kernel ikj,rayon-ikj``
4. Commands table, `just bench` row: replace `` `--output` is required. |`` with ``Results go to `data/runs/<host>/<timestamp>.csv` unless `--output` is given. |``
5. Commands table, `just data` row, replace the whole row with:
   ``| `just data` | `duckdb -bail < data/build.sql` | Validate every `data/runs/**/*.csv` and merge them into `web/public/results.parquet`, the file the dashboard queries. A run file missing a required value fails with its filename. `just dev` and `just build` run it first. |``
6. Default Sweep: ``just bench --output results`` → ``just bench``
7. In each targeted sweep example, delete the final `--output <name>` line and the ` \` continuation on the line before it. This applies to `cache_comparison`, `parallel_scaling`, `precisions`, `mps_results`, and the headless `results` example. For example:
   ```sh
   just bench \
     --sizes 128,256,512,1024 \
     --kernel naive,ikj,tiled
   ```
8. CLI options row:
   - old: ``| `--output <PREFIX>` | **(Required)** Path prefix without extension; writes both `<PREFIX>.csv` and `<PREFIX>.json` | — |``
   - new: ``| `--output <FILE.csv>` | Output file; must have a `.csv` extension. Missing parent directories are created. Run via `just bench` so the default lands in the repo's `data/` | `data/runs/<host>/<timestamp>.csv` |``
9. Methodology item 4: ``and `--output` must be a prefix, not a directory or a path with an extension.`` → ``and `--output` must be a `.csv` file path, not a directory.``
10. Methodology item 5: ``Both output files are opened before the sweep but truncated only when results are written`` → ``The output file is opened before the sweep but truncated only when results are written``
11. Methodology columns: replace the line ``   - Columns: `kernel, n, threads, precision, median_ms, min_ms, stddev_ms, gflops`.`` with:
    ```markdown
       - Columns: `kernel, backend, device, precision, n, threads, gflops, mean_rel_error_f64, median_ms, min_ms, stddev_ms, block_size, repetitions, host, commit, timestamp`.
       - `backend` is `cpu` or `metal`. `device` is the CPU model (`sysctl` on macOS, `/proc/cpuinfo` on Linux) or the Metal GPU name.
       - `host` (hostname without domain), `commit` (`git describe --always --dirty`), and `timestamp` (UTC) are captured once per run. Any lookup that fails is written as `unknown`.
       - `mean_rel_error_f64` is `0.0` until accuracy measurement lands.
    ```
12. Replace the whole `## Benchmark Data` section body (from `Recorded full sweeps live in` through the `data/f64.csv` table row) with:
    ```markdown
    Every run is its own file under [`data/runs/`](data/runs), at `data/runs/<host>/<timestamp>.csv`, so reruns and other machines add data instead of replacing it. [`data/build.sql`](data/build.sql) validates the files and merges them into `web/public/results.parquet`.

    To contribute results from your machine:

    1. `just bench` with the sweep you want. It prints the file it wrote.
    2. Commit the new file. The `data-build` pre-commit hook validates it if lefthook and DuckDB are installed.
    3. Open a PR. CI runs the same validation, and merged runs deploy to the dashboard.
    ```

- [ ] **Step 2: Verify no stale references remain**

Run: `grep -n "\.json\|PREFIX\|--output results\|data/\*\.csv\|data/f16" README.md`
Expected: no matches.

- [ ] **Step 3: End-to-end run**

```bash
just bench --sizes 64,128 --kernel ikj,mps --precision f32 --no-progress
```

Expected: the table prints, then `Wrote 4 records to data/runs/Pauls-MacBook-Pro/<stamp>.csv`.

Run: `f=$(ls -t data/runs/Pauls-MacBook-Pro/*.csv | head -1); cat "$f"`
Expected:
- the 16-column header;
- `ikj` rows with `cpu,Apple M1 Pro`, and `mps` rows with `metal,Apple M1 Pro`;
- `block_size` `64`, `repetitions` `5`, `host` `Pauls-MacBook-Pro`;
- `commit` equal to `git describe --always --dirty` run in the same tree;
- a current UTC `timestamp`.

Run: `just data && duckdb -c "SELECT count(*) FROM 'web/public/results.parquet'"`
Expected: `681`.

Then delete the test run: `rm "$f" && just data`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document per-run CSV output and the data contribution flow

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
