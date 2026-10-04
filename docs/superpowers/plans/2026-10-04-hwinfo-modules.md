# `hwinfo` Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move hardware capture into `benchmark/src/hwinfo/{mod,macos,linux,windows}.rs` behind one four-function interface, so Windows records its OS build, CPU, GPU, core tiers and caches, and Linux records a GPU name. macOS and Linux keep recording exactly what they record today.

**Architecture:** Each platform module exports `os`, `cpu`, `gpu` and `topology`, gated to its OS. Everything else in it is a parser over `&str` or `&[u8]` that compiles on every platform, so every parser test runs everywhere. `mod.rs` aliases the native module as `native`, owns `Machine::capture()` and every fallback, and holds `group_caches`, which Linux and Windows share. Task 1 is a pure move, checked by capturing before and after on a Mac. Tasks 2–4 add Windows and the Linux GPU, and the Windows CI job (from the quick PR) compiles and runs the Windows-only code.

**Tech Stack:** Rust nightly (edition 2024), std only, a hand-declared Win32 `extern "system"` call, GitHub Actions (`ubuntu-latest`, `windows-latest`).

**Spec:** `docs/superpowers/specs/2026-10-04-hwinfo-modules-design.md`

## Global Constraints

- Branch `feat/hwinfo-modules`, from `origin/main`, already created. The quick PR (`docs/superpowers/plans/2026-10-04-windows-host-support.md`) merged as #29 (`bfcfebb`), together with this plan and its spec, so `main` already has the `windows-latest` CI job. That job is the only place the Windows-only code compiles. Don't reuse `feat/hwinfo`: it is #29's merged branch.
- No new dependencies. The Win32 call is a hand-declared `unsafe extern "system"` block with `#[link(name = "kernel32")]`.
- Approach A from the spec:
  - In each platform module, only the four interface functions (`os`, `cpu`, `gpu`, `topology`) and the OS calls behind them carry `#[cfg(target_os = "<platform>")]`.
  - Every parser compiles on every platform.
  - Each platform file starts with exactly one `#![cfg_attr(not(target_os = "<platform>"), allow(dead_code))]`. No per-function `cfg_attr(... allow(dead_code))` remains.
- Every lookup runs as a normal user. A failed or unparsable lookup is left out (`None` or empty), and a run never fails over hardware info.
- macOS and Linux must record byte-identical `runs`, `core_tiers` and `caches` values before and after this work (Task 1, Step 9).
- No schema change: `data/schema.sql` is not touched, not even its comments. No `KernelInfo` change.
- Never edit a host database. Throwaway runs go to `/tmp/<name>.sqlite`.
- Lefthook runs fmt, clippy, tests, Biome, typecheck and validate on commit. Never bypass it.
- Run `just lint` (auto-fixes rustfmt) before every commit, and `just check && just test` before every push. The code here compiles and passes clippy, but may not be rustfmt-exact.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Windows-only code compiles only in CI. After each push, the `Rust Nightly on Windows (Clippy, Test)` job must pass before the next task starts.
- Windows clippy sees a different shape of the crate than macOS clippy. In #29 it rejected two things macOS accepted (`d9e739f`):
  - `let x: Option<String> = None; x.unwrap_or_else(…)` (`clippy::unnecessary_literal_unwrap`);
  - an unused import of a helper only macOS and Linux call.

  So never bind a literal `None` and unwrap it, and gate every import that only OS-specific code uses with the same `#[cfg(target_os = …)]` as that code. This plan's code follows both rules: fallbacks are function calls such as `native::cpu().unwrap_or_else(…)`, and each module's `command_output` import is gated.

## File Map

| File | Responsibility |
|---|---|
| `benchmark/src/hwinfo/mod.rs` (was `machine.rs`) | `Machine`, `CoreTier`, `CacheKind`, `Cache`; `Machine::capture()` and its fallbacks; `target_features()`; `CacheMap` and `group_caches()`; selects `native` |
| `benchmark/src/hwinfo/macos.rs` | `sw_vers`, `sysctl`, Metal, `ioreg`; `parse_sysctl`, `macos_topology`, `parse_gpu_cores` |
| `benchmark/src/hwinfo/linux.rs` | `uname`, `/proc/cpuinfo`, `lscpu`, sysfs, `lspci`; `parse_cpu_model`, `parse_lscpu_model`, `parse_cpu_list`, `parse_size`, `cache_kind`, `linux_topology`, `parse_lspci_gpu` |
| `benchmark/src/hwinfo/windows.rs` | `ver`, `reg query`, PowerShell CIM, `GetLogicalProcessorInformationEx`; `parse_ver`, `parse_reg_cpu_name`, `parse_cim_gpu`, `bytes_at`, `group_cpus`, `windows_topology` |
| `benchmark/src/context.rs` | loses `cpu_name`, `parse_cpu_model`, `parse_lscpu_model` and their tests; keeps `RunContext`, `command_output`, `UNKNOWN` |
| `benchmark/src/main.rs`, `plan.rs`, `db.rs`, `cli.rs` | `machine` → `hwinfo` in module declaration and imports |
| `README.md` | `runs.gpu` / `gpu_cores` meaning; Windows tiers |

---

### Task 1: Pure move into `hwinfo/`

No behavior change. Steps 2 and 9 prove it.

**Files:**
- Move: `benchmark/src/machine.rs` → `benchmark/src/hwinfo/mod.rs`
- Create: `benchmark/src/hwinfo/macos.rs`, `benchmark/src/hwinfo/linux.rs`
- Modify: `benchmark/src/context.rs`, `benchmark/src/main.rs`, `benchmark/src/plan.rs`, `benchmark/src/db.rs`, `benchmark/src/cli.rs`

**Interfaces:**
- Consumes: `crate::context::{command_output, UNKNOWN}` (`command_output(program: &str, args: &[&str]) -> Option<String>`).
- Produces:
  - `crate::hwinfo::{Machine, CoreTier, Cache, CacheKind}`, with fields and `CacheKind::label` unchanged.
  - In `hwinfo/mod.rs`: `type CacheMap = BTreeMap<(usize, CacheKind, Vec<usize>), (usize, Option<usize>)>;` and `fn group_caches(seen: CacheMap, tier_of: &HashMap<usize, usize>) -> Vec<Cache>`.
  - Each platform module's interface, on its own OS:
    - `pub(super) fn os() -> Option<String>`
    - `pub(super) fn cpu() -> Option<String>`
    - `pub(super) fn gpu() -> Option<(String, Option<usize>)>`
    - `pub(super) fn topology() -> (Vec<CoreTier>, Vec<Cache>)`

- [ ] **Step 1: Switch to the branch and catch up with `main`**

The branch already exists. It was created from `origin/main` (`bfcfebb`) and holds this plan's refresh commit.

```bash
git fetch origin
git switch feat/hwinfo-modules
git rebase origin/main
```

Expected: `.github/workflows/ci.yml` has a `rust-windows` job, `justfile` starts with `set positional-arguments`, and `benchmark/src/machine.rs` still exists. If any of these is wrong, `main` isn't where this plan expects it: stop.

- [ ] **Step 2: Record the "before" capture and test count (on a Mac)**

If `/tmp/hwinfo-before.sqlite` exists from an earlier attempt, delete it first: a second run would add `run_id` 2 and break the diff.

```bash
just bench --config configs/quick.toml --output /tmp/hwinfo-before.sqlite --no-progress
```

```bash
sqlite3 /tmp/hwinfo-before.sqlite "SELECT os, arch, target_features, cpu, available_parallelism, gpu, gpu_cores FROM runs; SELECT * FROM core_tiers; SELECT * FROM caches;" > /tmp/hwinfo-before.txt
```

```bash
cargo test --manifest-path benchmark/Cargo.toml 2>&1 | grep "test result"
```

Write down the `passed` counts.

- [ ] **Step 3: Move the file and rename the module**

```bash
mkdir benchmark/src/hwinfo
git mv benchmark/src/machine.rs benchmark/src/hwinfo/mod.rs
```

- `benchmark/src/main.rs`: delete `mod machine;` and add `mod hwinfo;` after `mod host;`.
- `benchmark/src/plan.rs`: `use crate::machine::Machine;` → `use crate::hwinfo::Machine;`
- `benchmark/src/cli.rs`: `use crate::{db, host, machine::Machine};` → `use crate::{db, host, hwinfo::Machine};`
- `benchmark/src/db.rs`, top: `use crate::{benchmark::BenchmarkRecord, context::RunContext, machine::Machine};` → `use crate::{benchmark::BenchmarkRecord, context::RunContext, hwinfo::Machine};`
- `benchmark/src/db.rs`, in `mod fixtures`: `machine::{Cache, CacheKind, CoreTier, Machine},` → `hwinfo::{Cache, CacheKind, CoreTier, Machine},`

- [ ] **Step 4: Create `hwinfo/macos.rs`**

Start the file with:

```rust
//! macOS: `sw_vers`, `sysctl`, Metal and `ioreg`. Only the four lookups are
//! macOS-only; the parsers compile everywhere, so their tests run on every
//! platform.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::collections::HashMap;

use super::{Cache, CacheKind, CoreTier};
#[cfg(target_os = "macos")]
use crate::context::command_output;

#[cfg(target_os = "macos")]
pub(super) fn os() -> Option<String> {
    command_output("sw_vers", &["-productVersion"]).map(|v| format!("macOS {v}"))
}

#[cfg(target_os = "macos")]
pub(super) fn cpu() -> Option<String> {
    command_output("sysctl", &["-n", "machdep.cpu.brand_string"])
}

/// The Metal device and its core count. The 14- and 16-core M1 Pro GPUs
/// report the same name, so peaks.csv needs the count to pick the right ceiling.
#[cfg(target_os = "macos")]
pub(super) fn gpu() -> Option<(String, Option<usize>)> {
    let name = gemm_bench::kernels::metal::default_device_name()?;
    let cores = command_output("ioreg", &["-rc", "AGXAccelerator", "-d1"])
        .and_then(|text| parse_gpu_cores(&text));
    Some((name, cores))
}

#[cfg(target_os = "macos")]
pub(super) fn topology() -> (Vec<CoreTier>, Vec<Cache>) {
    command_output("sysctl", &["hw"])
        .map(|text| macos_topology(&parse_sysctl(&text)))
        .unwrap_or_default()
}
```

Then **cut** these items from `hwinfo/mod.rs` and paste them below, each with its doc comment and unchanged, except for **deleting** the `#[cfg_attr(not(target_os = "macos"), allow(dead_code))]` line above each:
- `fn parse_sysctl`
- `fn macos_topology`
- `fn parse_gpu_cores`

Then add a test module and **cut** into it, unchanged from `hwinfo/mod.rs`'s tests:
- the `M1_PRO` const with its doc comment;
- the `fn cache(…)` helper;
- `#[test] macos_perflevels_become_tiers_with_their_own_caches`;
- `#[test] without_perflevels_macos_reports_no_topology`;
- `#[test] ioreg_names_the_gpu_core_count`.

The test module opens with:

```rust
#[cfg(test)]
mod tests {
    use super::{Cache, CacheKind, CoreTier, macos_topology, parse_gpu_cores, parse_sysctl};
```

- [ ] **Step 5: Create `hwinfo/linux.rs`**

Start the file with:

```rust
//! Linux: `uname`, `/proc/cpuinfo` and `lscpu`, and sysfs. Only the four
//! lookups are Linux-only; the parsers compile everywhere, so their tests run
//! on every platform.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::{
    cmp::Reverse,
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::Path,
};

use super::{Cache, CacheKind, CacheMap, CoreTier, group_caches};
#[cfg(target_os = "linux")]
use crate::context::command_output;

#[cfg(target_os = "linux")]
pub(super) fn os() -> Option<String> {
    command_output("uname", &["-r"]).map(|v| format!("Linux {v}"))
}

#[cfg(target_os = "linux")]
pub(super) fn cpu() -> Option<String> {
    fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|cpuinfo| parse_cpu_model(&cpuinfo))
        // ARM kernels leave `model name` out; lscpu decodes the part number.
        .or_else(|| command_output("lscpu", &[]).and_then(|text| parse_lscpu_model(&text)))
}

/// No GPU lookup yet.
#[cfg(target_os = "linux")]
pub(super) fn gpu() -> Option<(String, Option<usize>)> {
    None
}

#[cfg(target_os = "linux")]
pub(super) fn topology() -> (Vec<CoreTier>, Vec<Cache>) {
    linux_topology(Path::new("/sys/devices"))
}

/// sysfs's `type` file: `Data`, `Instruction` or `Unified`.
fn cache_kind(text: &str) -> Option<CacheKind> {
    match text {
        "Data" => Some(CacheKind::Data),
        "Instruction" => Some(CacheKind::Instruction),
        "Unified" => Some(CacheKind::Unified),
        _ => None,
    }
}
```

Then **cut** these and paste them below, each with its doc comment and unchanged, except for deleting its `#[cfg_attr(not(target_os = "linux"), allow(dead_code))]` line:
- from `benchmark/src/context.rs`: `fn parse_cpu_model`, `fn parse_lscpu_model`;
- from `hwinfo/mod.rs`: `fn parse_cpu_list`, `fn parse_size`, `fn linux_topology`.

Make exactly three edits inside the pasted `linux_topology`:
1. `read(&dir.join("type")).and_then(|text| CacheKind::from_sysfs(&text)),` → `read(&dir.join("type")).and_then(|text| cache_kind(&text)),`
2. `let mut seen = BTreeMap::new();` → `let mut seen = CacheMap::new();`
3. Replace everything from `let mut grouped = BTreeMap::new();` to the function's closing `}` with:

```rust
    (tiers, group_caches(seen, &tier_of))
}
```

Then add a test module and **cut** into it, unchanged:
- from `hwinfo/mod.rs`'s tests:
  - `#[test] sysfs_lists_and_sizes_parse`;
  - the `fn cpu(…)` helper and the `fn sysfs(…)` helper, each with its doc comment;
  - `#[test] linux_hybrid_splits_core_and_atom_and_finds_the_shared_l3`;
  - `#[test] linux_without_hybrid_pmus_orders_tiers_by_capacity`;
  - `#[test] linux_without_sysfs_reports_no_topology`.
- from `context.rs`'s tests:
  - `#[test] parse_cpu_model_reads_the_x86_model_name`;
  - `#[test] parse_cpu_model_is_none_when_arm_cpuinfo_lacks_a_model_name`;
  - `#[test] a_blank_model_name_counts_as_missing`, with its doc comment;
  - `#[test] parse_lscpu_model_reads_the_decoded_arm_part`.

The test module opens with:

```rust
#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{
        Cache, CacheKind, CoreTier, linux_topology, parse_cpu_list, parse_cpu_model,
        parse_lscpu_model, parse_size,
    };
```

- [ ] **Step 6: Rewrite the top of `hwinfo/mod.rs`**

Replace the module doc comment and the `use` block (everything above `/// What the \`runs\`, \`core_tiers\` and \`caches\` tables record about the machine.`) with:

```rust
//! The machine a run measured, captured once per run: the build (arch,
//! compile-time target features, rustc), the OS, the CPU's core tiers and
//! caches, and the GPU. Each platform module reads what its OS exposes, as a
//! normal user; what it doesn't is left out (an empty list, or `None`), never
//! guessed.

use std::collections::{BTreeMap, HashMap};

use crate::context::UNKNOWN;

mod linux;
mod macos;

#[cfg(target_os = "linux")]
use linux as native;
#[cfg(target_os = "macos")]
use macos as native;

/// Targets with no module record only what std and the compiler know.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
mod native {
    use super::{Cache, CoreTier};

    pub(super) fn os() -> Option<String> {
        None
    }

    pub(super) fn cpu() -> Option<String> {
        None
    }

    pub(super) fn gpu() -> Option<(String, Option<usize>)> {
        None
    }

    pub(super) fn topology() -> (Vec<CoreTier>, Vec<Cache>) {
        (Vec::new(), Vec::new())
    }
}
```

- [ ] **Step 7: Rewrite the rest of `hwinfo/mod.rs`**

- In `impl CacheKind`, delete `fn from_sysfs` and its doc comment. `fn label` stays.
- Replace the whole `impl Machine { … }` block with:

```rust
impl Machine {
    /// Looks the machine up now. Never fails: a lookup that does is left out,
    /// or recorded as `unknown` where the schema needs a value.
    pub(crate) fn capture() -> Self {
        let (tiers, caches) = native::topology();
        let (gpu, gpu_cores) = native::gpu()
            .map_or((None, None), |(name, cores)| (Some(name), cores));
        Self {
            os: native::os().unwrap_or_else(|| std::env::consts::OS.to_owned()),
            arch: std::env::consts::ARCH,
            target_features: target_features(),
            rustc_version: env!("GEMM_BENCH_RUSTC"),
            cpu: native::cpu().unwrap_or_else(|| UNKNOWN.to_owned()),
            available_parallelism: std::thread::available_parallelism()
                .map_or(1, std::num::NonZero::get),
            gpu,
            gpu_cores,
            tiers,
            caches,
        }
    }
}
```

- Delete `fn os()` and `fn topology()`. Their bodies now live in `macos::os`, `macos::topology`, `linux::os` and `linux::topology`.
- Keep `fn target_features()` unchanged, and add after it:

```rust
/// Each distinct cache: (level, kind, the CPUs it serves) → (size, line).
type CacheMap = BTreeMap<(usize, CacheKind, Vec<usize>), (usize, Option<usize>)>;

/// Groups distinct caches into (tier, level, kind, size, sharing) with an
/// instance count. A cache whose CPUs span tiers gets no tier.
fn group_caches(seen: CacheMap, tier_of: &HashMap<usize, usize>) -> Vec<Cache> {
    let mut grouped = BTreeMap::new();
    for ((level, kind, shared), (size, line)) in seen {
        let tier = tier_of
            .get(&shared[0])
            .copied()
            .filter(|&tier| shared.iter().all(|cpu| tier_of.get(cpu) == Some(&tier)));
        grouped
            .entry((tier, level, kind, size, shared.len()))
            .or_insert((line, 0))
            .1 += 1;
    }
    grouped
        .into_iter()
        .map(
            |((tier, level, kind, size_bytes, shared_by), (line_bytes, instances))| Cache {
                tier,
                level,
                kind,
                size_bytes,
                line_bytes,
                shared_by,
                instances,
            },
        )
        .collect()
}
```

- In the test module, delete `use std::{fs, path::PathBuf};` (only the sysfs helpers used it, and they moved), and change `use super::{…}` to `use super::{Machine, target_features};`. The two tests left in it are `target_features_are_sorted_and_name_the_build` and `capture_fills_what_every_run_needs`.
- In `capture_fills_what_every_run_needs`, after the existing `#[cfg(target_os = "macos")] assert!(!machine.tiers.is_empty() && !machine.caches.is_empty());`, add:

```rust
        #[cfg(target_os = "macos")]
        assert!(machine.gpu.is_some(), "{machine:?}");
        #[cfg(target_os = "linux")]
        assert!(!machine.tiers.is_empty(), "{machine:?}");
```

- [ ] **Step 8: Trim `context.rs` and run everything**

In `benchmark/src/context.rs`:
- Delete `cpu_name` and `#[test] cpu_name_is_never_empty`. The capture test's `!machine.cpu.is_empty()` covers the latter.
- Change the test import to `use super::{capture, iso_timestamp};`.
- `parse_cpu_model` and `parse_lscpu_model` already moved in Step 5.

Run: `just lint && just check && just test`
Expected: PASS. The Rust `passed` total is Step 2's minus 1 (`cpu_name_is_never_empty`). No `dead_code` or `unused_imports` warnings.

- [ ] **Step 9: Prove macOS records the same values**

If `/tmp/hwinfo-after.sqlite` exists from an earlier attempt, delete it first.

```bash
just bench --config configs/quick.toml --output /tmp/hwinfo-after.sqlite --no-progress
```

```bash
sqlite3 /tmp/hwinfo-after.sqlite "SELECT os, arch, target_features, cpu, available_parallelism, gpu, gpu_cores FROM runs; SELECT * FROM core_tiers; SELECT * FROM caches;" > /tmp/hwinfo-after.txt
```

```bash
diff /tmp/hwinfo-before.txt /tmp/hwinfo-after.txt
```

Expected: no output. Any difference is a behavior change: fix it before committing. The Linux CI job's tests check the Linux parsers, which moved unchanged.

- [ ] **Step 10: Commit, push, open the draft PR**

```bash
git add -A benchmark/src
git commit -m "Move hardware capture into per-platform hwinfo modules

machine.rs becomes hwinfo/{mod,macos,linux}.rs behind os/cpu/gpu/topology,
with cpu_name moved out of context.rs and the cache grouping shared as
group_caches. No behavior change: a quick run records identical runs,
core_tiers and caches rows before and after.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/hwinfo-modules
```

```bash
gh pr create --draft --base main --title "hwinfo: per-platform hardware capture" --body "Spec: docs/superpowers/specs/2026-10-04-hwinfo-modules-design.md
Plan: docs/superpowers/plans/2026-10-04-hwinfo-modules.md"
```

Expected: both Rust CI jobs pass.

---

### Task 2: Windows OS, CPU and topology

**Files:**
- Create: `benchmark/src/hwinfo/windows.rs`
- Modify: `benchmark/src/hwinfo/mod.rs` (module selection, the capture test)

**Interfaces:**
- Consumes: `super::{Cache, CacheKind, CacheMap, CoreTier, group_caches}` and `crate::context::command_output` (Task 1).
- Produces:
  - `windows::{os, cpu, gpu, topology}` with the Task 1 signatures. `gpu` returns `None` until Task 3.
  - Parsers:
    - `fn parse_ver(ver: &str) -> Option<String>`
    - `fn parse_reg_cpu_name(reg: &str) -> Option<String>`
    - `fn windows_topology(buffer: &[u8]) -> (Vec<CoreTier>, Vec<Cache>)`

- [ ] **Step 1: Write the failing tests**

Create `benchmark/src/hwinfo/windows.rs` with the header and the tests only:

```rust
//! Windows: `ver`, the registry and `GetLogicalProcessorInformationEx`. Only
//! the four lookups and the Win32 call are Windows-only; the parsers compile
//! everywhere, so their tests run on every platform.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::{
    cmp::Reverse,
    collections::{BTreeMap, HashMap},
};

use super::{Cache, CacheKind, CacheMap, CoreTier, group_caches};
#[cfg(target_os = "windows")]
use crate::context::command_output;

#[cfg(test)]
mod tests {
    use super::{Cache, CacheKind, CoreTier, parse_reg_cpu_name, parse_ver, windows_topology};

    /// `ver` is localized ("[Version …]", "[version …]"), so only the build counts.
    #[test]
    fn ver_names_the_build_in_any_locale() {
        assert_eq!(
            parse_ver("Microsoft Windows [Version 10.0.22631.4317]").as_deref(),
            Some("Windows 10.0.22631.4317")
        );
        assert_eq!(
            parse_ver("Microsoft Windows [version 10.0.26100.2033]").as_deref(),
            Some("Windows 10.0.26100.2033")
        );
        assert_eq!(parse_ver("Microsoft Windows"), None);
    }

    #[test]
    fn reg_names_the_cpu() {
        let reg = "\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0\r\n    ProcessorNameString    REG_SZ    AMD Ryzen 5 7535HS with Radeon Graphics        \r\n";
        assert_eq!(
            parse_reg_cpu_name(reg).as_deref(),
            Some("AMD Ryzen 5 7535HS with Radeon Graphics")
        );
        assert_eq!(
            parse_reg_cpu_name("    ProcessorNameString    REG_SZ    \r\n"),
            None
        );
        assert_eq!(
            parse_reg_cpu_name(
                "ERROR: The system was unable to find the specified registry key or value."
            ),
            None
        );
    }

    /// `PROCESSOR_CACHE_TYPE` values.
    const UNIFIED: u32 = 0;
    const INSTRUCTION: u32 = 1;
    const DATA: u32 = 2;

    /// A `SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX` record for a core
    /// (relationship 0) or package (3), x64 layout: EfficiencyClass at 9,
    /// GroupCount at 30, GroupMask at 32.
    fn processor_record(relationship: u32, class: u8, mask: u64) -> Vec<u8> {
        let mut record = vec![0; 48];
        record[0..4].copy_from_slice(&relationship.to_le_bytes());
        record[4..8].copy_from_slice(&48u32.to_le_bytes());
        record[9] = class;
        record[30..32].copy_from_slice(&1u16.to_le_bytes());
        record[32..40].copy_from_slice(&mask.to_le_bytes());
        record
    }

    /// A cache record (relationship 2), x64 layout: Level at 8, LineSize at
    /// 10, CacheSize at 12, Type at 16, GroupCount at 38, GroupMask at 40.
    fn cache_record(level: u8, kind: u32, size: u32, mask: u64) -> Vec<u8> {
        let mut record = vec![0; 56];
        record[0..4].copy_from_slice(&2u32.to_le_bytes());
        record[4..8].copy_from_slice(&56u32.to_le_bytes());
        record[8] = level;
        record[10..12].copy_from_slice(&64u16.to_le_bytes());
        record[12..16].copy_from_slice(&size.to_le_bytes());
        record[16..20].copy_from_slice(&kind.to_le_bytes());
        record[38..40].copy_from_slice(&1u16.to_le_bytes());
        record[40..48].copy_from_slice(&mask.to_le_bytes());
        record
    }

    /// A cache with the fixtures' 64-byte lines.
    fn cache64(
        tier: Option<usize>,
        level: usize,
        kind: CacheKind,
        size_bytes: usize,
        shared_by: usize,
        instances: usize,
    ) -> Cache {
        Cache {
            tier,
            level,
            kind,
            size_bytes,
            line_bytes: Some(64),
            shared_by,
            instances,
        }
    }

    /// The contributor's Ryzen 5 7535HS: six SMT cores, each with its own
    /// L1d, L1i and L2, under one L3. The package record must be ignored.
    #[test]
    fn ryzen_has_one_tier_and_per_core_l1_and_l2() {
        let mut buffer = Vec::new();
        for core in 0..6 {
            let pair = 0b11u64 << (2 * core);
            buffer.extend(processor_record(0, 0, pair));
            buffer.extend(cache_record(1, DATA, 32 << 10, pair));
            buffer.extend(cache_record(1, INSTRUCTION, 32 << 10, pair));
            buffer.extend(cache_record(2, UNIFIED, 512 << 10, pair));
        }
        buffer.extend(cache_record(3, UNIFIED, 16 << 20, 0xFFF));
        buffer.extend(processor_record(3, 0, 0xFFF));
        let (tiers, caches) = windows_topology(&buffer);
        assert_eq!(
            tiers,
            [CoreTier {
                tier: 0,
                name: None,
                cores: 6,
                logical_cpus: 12
            }]
        );
        assert_eq!(
            caches,
            [
                cache64(Some(0), 1, CacheKind::Data, 32 << 10, 2, 6),
                cache64(Some(0), 1, CacheKind::Instruction, 32 << 10, 2, 6),
                cache64(Some(0), 2, CacheKind::Unified, 512 << 10, 2, 6),
                cache64(Some(0), 3, CacheKind::Unified, 16 << 20, 12, 1),
            ]
        );
    }

    /// Two SMT P-cores (class 1, CPUs 0-3) and four E-cores (class 0, CPUs
    /// 4-7) sharing one L2, under an L3 across all eight.
    #[test]
    fn hybrid_puts_the_higher_efficiency_class_first() {
        let mut buffer = Vec::new();
        buffer.extend(processor_record(0, 1, 0b0011));
        buffer.extend(processor_record(0, 1, 0b1100));
        for e in 4..8 {
            buffer.extend(processor_record(0, 0, 1 << e));
        }
        buffer.extend(cache_record(2, UNIFIED, 4 << 20, 0xF0));
        buffer.extend(cache_record(3, UNIFIED, 24 << 20, 0xFF));
        let (tiers, caches) = windows_topology(&buffer);
        assert_eq!(
            tiers,
            [
                CoreTier {
                    tier: 0,
                    name: None,
                    cores: 2,
                    logical_cpus: 4
                },
                CoreTier {
                    tier: 1,
                    name: None,
                    cores: 4,
                    logical_cpus: 4
                },
            ]
        );
        assert_eq!(
            caches,
            [
                cache64(None, 3, CacheKind::Unified, 24 << 20, 8, 1),
                cache64(Some(1), 2, CacheKind::Unified, 4 << 20, 4, 1),
            ]
        );
    }

    /// A record cut off by the buffer's end is dropped, and a size below the
    /// 8-byte header stops the walk instead of looping on it.
    #[test]
    fn a_cut_off_buffer_keeps_only_whole_records() {
        let mut buffer = processor_record(0, 0, 0b11);
        buffer.extend(&cache_record(1, DATA, 32 << 10, 0b11)[..20]);
        let (tiers, caches) = windows_topology(&buffer);
        assert_eq!(tiers.len(), 1);
        assert!(caches.is_empty());
        assert_eq!(windows_topology(&[0; 8]), (Vec::new(), Vec::new()));
    }
}
```

In `benchmark/src/hwinfo/mod.rs`:
- Add `mod windows;` after `mod macos;`.
- Add `#[cfg(target_os = "windows")] use windows as native;` after the macOS `use`, on two lines like the others.
- Change the fallback's `#[cfg(not(any(target_os = "linux", target_os = "macos")))]` to `#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml hwinfo::windows`
Expected: FAIL to compile with `unresolved imports` for `super::parse_ver`, `super::parse_reg_cpu_name` and `super::windows_topology`.

- [ ] **Step 3: Implement the parsers**

In `windows.rs`, between the `use` lines and `#[cfg(test)]`, add:

```rust
/// `ver`'s `Microsoft Windows [Version 10.0.22631.4317]` → `Windows
/// 10.0.22631.4317`. Windows 11 still reports 10.0: its builds start at 22000.
fn parse_ver(ver: &str) -> Option<String> {
    let (_, bracketed) = ver.split_once('[')?;
    let (inside, _) = bracketed.split_once(']')?;
    inside
        .split_whitespace()
        .last()
        .map(|build| format!("Windows {build}"))
}

/// `reg query`'s `ProcessorNameString    REG_SZ    <name>` line, unless blank.
/// Intel pads the name with trailing spaces.
fn parse_reg_cpu_name(reg: &str) -> Option<String> {
    reg.lines()
        .find_map(|line| {
            line.trim_start()
                .strip_prefix("ProcessorNameString")?
                .trim_start()
                .strip_prefix("REG_SZ")
        })
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
}

/// `N` bytes at `at`, or `None` past the end.
fn bytes_at<const N: usize>(record: &[u8], at: usize) -> Option<[u8; N]> {
    record.get(at..)?.first_chunk().copied()
}

/// The logical CPUs in the `GROUP_AFFINITY` at `at`: bit i of its mask is
/// CPU i of its processor group, 64 to a group.
fn group_cpus(record: &[u8], at: usize) -> Option<Vec<usize>> {
    let mask = u64::from_le_bytes(bytes_at(record, at)?);
    let group = usize::from(u16::from_le_bytes(bytes_at(record, at + 8)?));
    let cpus: Vec<usize> = (0..64)
        .filter(|&bit| (mask >> bit) & 1 == 1)
        .map(|bit| group * 64 + bit)
        .collect();
    (!cpus.is_empty()).then_some(cpus)
}

/// Core tiers and caches from `GetLogicalProcessorInformationEx(RelationAll)`:
/// back-to-back `SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX` records, read at
/// their x64 offsets. A core record is one physical core, its SMT siblings in
/// its mask; a higher `EfficiencyClass` is a faster core. Windows names no
/// tiers, so `name` stays `None`.
// ponytail: reads only each record's first GROUP_AFFINITY, so a cache or core
// spanning processor groups (over 64 logical CPUs) loses the rest; read all
// GroupCount masks if such a host shows up.
fn windows_topology(buffer: &[u8]) -> (Vec<CoreTier>, Vec<Cache>) {
    const RELATION_PROCESSOR_CORE: u32 = 0;
    const RELATION_CACHE: u32 = 2;
    // (efficiency class, logical CPUs) per physical core.
    let mut cores: Vec<(u8, Vec<usize>)> = Vec::new();
    let mut seen = CacheMap::new();
    let mut rest = buffer;
    while let Some(size) = bytes_at(rest, 4).map(u32::from_le_bytes) {
        let size = size as usize;
        let Some(record) = rest.get(..size).filter(|_| size >= 8) else {
            break;
        };
        rest = &rest[size..];
        match bytes_at(record, 0).map(u32::from_le_bytes) {
            Some(RELATION_PROCESSOR_CORE) => {
                if let (Some([class]), Some(cpus)) = (bytes_at(record, 9), group_cpus(record, 32)) {
                    cores.push((class, cpus));
                }
            }
            Some(RELATION_CACHE) => {
                let kind = match bytes_at(record, 16).map(u32::from_le_bytes) {
                    Some(0) => CacheKind::Unified,
                    Some(1) => CacheKind::Instruction,
                    Some(2) => CacheKind::Data,
                    _ => continue, // a trace cache
                };
                if let (Some([level]), Some(line), Some(size), Some(cpus)) = (
                    bytes_at(record, 8),
                    bytes_at(record, 10).map(u16::from_le_bytes),
                    bytes_at(record, 12).map(u32::from_le_bytes),
                    group_cpus(record, 40),
                ) && (1..=4).contains(&level)
                    && size > 0
                {
                    seen.insert(
                        (usize::from(level), kind, cpus),
                        (size as usize, (line > 0).then_some(usize::from(line))),
                    );
                }
            }
            _ => {}
        }
    }

    // Fastest first: a higher efficiency class is a faster core.
    let mut by_class: BTreeMap<Reverse<u8>, (usize, Vec<usize>)> = BTreeMap::new();
    for (class, cpus) in cores {
        let (count, logical) = by_class.entry(Reverse(class)).or_default();
        *count += 1;
        logical.extend(cpus);
    }
    let tier_of: HashMap<usize, usize> = by_class
        .values()
        .enumerate()
        .flat_map(|(tier, (_, cpus))| cpus.iter().map(move |&cpu| (cpu, tier)))
        .collect();
    let tiers = by_class
        .into_values()
        .enumerate()
        .map(|(tier, (core_count, cpus))| CoreTier {
            tier,
            name: None,
            cores: core_count,
            logical_cpus: cpus.len(),
        })
        .collect();
    (tiers, group_caches(seen, &tier_of))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path benchmark/Cargo.toml hwinfo::windows && cargo clippy --manifest-path benchmark/Cargo.toml --all-targets -- -D warnings`
Expected: 5 tests PASS, and clippy is clean on macOS.

- [ ] **Step 5: Add the Windows lookups**

In `windows.rs`, between the `use` lines and `fn parse_ver`, add:

```rust
#[cfg(target_os = "windows")]
pub(super) fn os() -> Option<String> {
    command_output("cmd", &["/C", "ver"]).and_then(|text| parse_ver(&text))
}

#[cfg(target_os = "windows")]
pub(super) fn cpu() -> Option<String> {
    command_output(
        "reg",
        &[
            "query",
            r"HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            "/v",
            "ProcessorNameString",
        ],
    )
    .and_then(|text| parse_reg_cpu_name(&text))
}

/// No GPU lookup yet.
#[cfg(target_os = "windows")]
pub(super) fn gpu() -> Option<(String, Option<usize>)> {
    None
}

#[cfg(target_os = "windows")]
pub(super) fn topology() -> (Vec<CoreTier>, Vec<Cache>) {
    processor_information()
        .map(|buffer| windows_topology(&buffer))
        .unwrap_or_default()
}

/// `GetLogicalProcessorInformationEx(RelationAll)`'s buffer: asked once for
/// the length it needs, then filled.
#[cfg(target_os = "windows")]
fn processor_information() -> Option<Vec<u8>> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLogicalProcessorInformationEx(
            relationship: u32,
            buffer: *mut u8,
            length: *mut u32,
        ) -> i32;
    }
    const RELATION_ALL: u32 = 0xffff;
    let mut length = 0u32;
    // SAFETY: a null buffer with length 0 only reports the length needed.
    unsafe { GetLogicalProcessorInformationEx(RELATION_ALL, std::ptr::null_mut(), &mut length) };
    let mut buffer = vec![0u8; usize::try_from(length).ok()?];
    // SAFETY: `buffer` holds `length` writable bytes, and the call writes at most that many.
    let filled =
        unsafe { GetLogicalProcessorInformationEx(RELATION_ALL, buffer.as_mut_ptr(), &mut length) };
    (filled != 0).then_some(buffer)
}
```

In `hwinfo/mod.rs`'s `capture_fills_what_every_run_needs`, after the Linux assertion, add:

```rust
        #[cfg(target_os = "windows")]
        {
            assert!(
                machine.os.starts_with("Windows ") && machine.cpu != crate::context::UNKNOWN,
                "{machine:?}"
            );
            assert!(
                !machine.tiers.is_empty() && !machine.caches.is_empty(),
                "{machine:?}"
            );
            // Checks the record offsets against the real API: every logical CPU lands in a tier.
            assert_eq!(
                machine
                    .tiers
                    .iter()
                    .map(|tier| tier.logical_cpus)
                    .sum::<usize>(),
                machine.available_parallelism,
                "{machine:?}"
            );
        }
```

- [ ] **Step 6: Run everything, commit, push**

Run: `just lint && just check && just test`
Expected: PASS on macOS. The Windows lookups don't compile here; CI compiles them.

```bash
git add benchmark/src/hwinfo
git commit -m "Record the OS build, CPU, core tiers and caches on Windows

ver, the registry's ProcessorNameString and GetLogicalProcessorInformationEx,
each behind a parser tested on every platform. Windows runs recorded os
'windows', cpu 'unknown' and no tiers or caches before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Expected: the Windows CI job passes, including the Windows block of `capture_fills_what_every_run_needs`. If clippy fails there on the `extern` block or the unsafe calls, fix it in `windows.rs` only and push again.

---

### Task 3: Windows GPU name

**Files:**
- Modify: `benchmark/src/hwinfo/windows.rs`

**Interfaces:**
- Consumes: `crate::context::command_output`.
- Produces:
  - `fn parse_cim_gpu(names: &str) -> Option<String>`.
  - `windows::gpu()` returns `Some((name, None))` when CIM lists an adapter.

- [ ] **Step 1: Write the failing test**

In `windows.rs`'s test module, add `parse_cim_gpu` to the `use super::{…}` list and add:

```rust
    /// One name per line, in WMI order; the first is the primary adapter.
    #[test]
    fn cim_names_the_first_adapter() {
        assert_eq!(
            parse_cim_gpu("AMD Radeon(TM) Graphics").as_deref(),
            Some("AMD Radeon(TM) Graphics")
        );
        assert_eq!(
            parse_cim_gpu("\r\nAMD Radeon(TM) Graphics\r\nNVIDIA GeForce RTX 4060 Laptop GPU\r\n")
                .as_deref(),
            Some("AMD Radeon(TM) Graphics")
        );
        assert_eq!(parse_cim_gpu(" \r\n"), None);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path benchmark/Cargo.toml hwinfo::windows`
Expected: FAIL to compile with `unresolved import` for `super::parse_cim_gpu`.

- [ ] **Step 3: Implement**

Add after `fn parse_reg_cpu_name`:

```rust
/// The first adapter in `(Get-CimInstance Win32_VideoController).Name`, which
/// prints one name per line. CIM lists only adapters that are present; the
/// registry's display class also keeps removed ones.
fn parse_cim_gpu(names: &str) -> Option<String> {
    names
        .lines()
        .map(str::trim)
        .find(|name| !name.is_empty())
        .map(str::to_owned)
}
```

Replace the Windows `gpu()` stub (its `/// No GPU lookup yet.` doc comment and body) with:

```rust
/// The first display adapter, through Windows PowerShell's CIM. Windows
/// reports no core count.
#[cfg(target_os = "windows")]
pub(super) fn gpu() -> Option<(String, Option<usize>)> {
    command_output(
        "powershell",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-CimInstance Win32_VideoController).Name",
        ],
    )
    .and_then(|text| parse_cim_gpu(&text))
    .map(|name| (name, None))
}
```

- [ ] **Step 4: Run, commit, push**

Run: `just lint && just check && just test`
Expected: PASS.

```bash
git add benchmark/src/hwinfo/windows.rs
git commit -m "Record the first display adapter on Windows

Win32_VideoController through PowerShell's CIM lists only adapters that
are present, unlike the registry's display class.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Expected: both Rust CI jobs pass. The Windows runner's adapter name isn't asserted, because a runner may have none.

---

### Task 4: Linux GPU name and README

**Files:**
- Modify: `benchmark/src/hwinfo/linux.rs`, `README.md`

**Interfaces:**
- Consumes: `crate::context::command_output`.
- Produces:
  - `fn parse_lspci_gpu(lspci: &str) -> Option<String>`.
  - `linux::gpu()` returns `Some((name, None))` when `lspci -mm` lists a display device.

- [ ] **Step 1: Write the failing test**

In `linux.rs`'s test module, add `parse_lspci_gpu` to the `use super::{…}` list and add:

```rust
    /// `lspci -mm` on a laptop with an Intel iGPU and an NVIDIA dGPU, after a
    /// non-display device.
    const LSPCI: &str = "\
00:00.0 \"Host bridge\" \"Intel Corporation\" \"Device 4621\" -r02 \"Lenovo\" \"Device 3803\"
00:02.0 \"VGA compatible controller\" \"Intel Corporation\" \"Alder Lake-P GT2 [Iris Xe Graphics]\" -r0c -p00 \"Lenovo\" \"Device 3803\"
01:00.0 \"3D controller\" \"NVIDIA Corporation\" \"AD107M [GeForce RTX 4060 Max-Q / Mobile]\" -ra1 \"Lenovo\" \"Device 3803\"
";

    #[test]
    fn lspci_names_the_first_display_device() {
        assert_eq!(
            parse_lspci_gpu(LSPCI).as_deref(),
            Some("Intel Corporation Alder Lake-P GT2 [Iris Xe Graphics]")
        );
        let without_vga: String = LSPCI
            .lines()
            .filter(|line| !line.contains("VGA"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            parse_lspci_gpu(&without_vga).as_deref(),
            Some("NVIDIA Corporation AD107M [GeForce RTX 4060 Max-Q / Mobile]")
        );
    }

    #[test]
    fn lspci_without_a_display_device_names_no_gpu() {
        assert_eq!(parse_lspci_gpu(LSPCI.lines().next().unwrap_or_default()), None);
        assert_eq!(parse_lspci_gpu(""), None);
        assert_eq!(parse_lspci_gpu("00:02.0 \"VGA compatible controller\""), None);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path benchmark/Cargo.toml hwinfo::linux`
Expected: FAIL to compile with `unresolved import` for `super::parse_lspci_gpu`.

- [ ] **Step 3: Implement**

Add after `fn parse_lscpu_model`:

```rust
/// The first display device in `lspci -mm`, whose lines read
/// `<slot> "<class>" "<vendor>" "<device>" -r.. "<subsystem vendor>" ...`, as
/// `<vendor> <device>`. "First" is PCI bus order.
fn parse_lspci_gpu(lspci: &str) -> Option<String> {
    const DISPLAY: [&str; 3] = [
        "VGA compatible controller",
        "3D controller",
        "Display controller",
    ];
    lspci.lines().find_map(|line| {
        let mut quoted = line.split('"').skip(1).step_by(2);
        let (class, vendor, device) = (quoted.next()?, quoted.next()?, quoted.next()?);
        DISPLAY
            .contains(&class)
            .then(|| format!("{vendor} {device}"))
    })
}
```

Replace the Linux `gpu()` stub (its `/// No GPU lookup yet.` doc comment and body) with:

```rust
/// The first display device `lspci` lists. `None` without `pciutils` (as in
/// minimal containers) or without a PCI GPU (most ARM boards). Linux reports
/// no core count.
#[cfg(target_os = "linux")]
pub(super) fn gpu() -> Option<(String, Option<usize>)> {
    command_output("lspci", &["-mm"])
        .and_then(|text| parse_lspci_gpu(&text))
        .map(|name| (name, None))
}
```

Update `linux.rs`'s module doc comment to `//! Linux: \`uname\`, \`/proc/cpuinfo\` and \`lscpu\`, sysfs, and \`lspci\`. Only the four` (keep the rest of the sentence).

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path benchmark/Cargo.toml hwinfo::linux`
Expected: PASS.

- [ ] **Step 5: Update the README's schema notes**

In `README.md`'s `runs` bullet, replace

```markdown
`cpu`, `available_parallelism`, `gpu` and `gpu_cores`.
```

with

```markdown
`cpu`, `available_parallelism`, `gpu` (on macOS, the GPU the Metal kernels run on; on Linux and Windows, the OS's first display adapter) and `gpu_cores` (macOS only). Every lookup runs as a normal user; a value the OS doesn't give is left out, and `cpu` reads `unknown`.
```

In the `core_tiers` and `caches` bullet, replace `Intel's core and atom halves, or one tier` with `Intel's core and atom halves, Windows' efficiency classes, or one tier`.

- [ ] **Step 6: Run everything, commit, push, mark ready**

Run: `just lint && just check && just test`
Expected: PASS.

```bash
git add benchmark/src/hwinfo/linux.rs README.md
git commit -m "Record the first display device on Linux

lspci -mm's first VGA, 3D or display controller, as vendor and device.
README notes what runs.gpu means off macOS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
gh pr ready
```

Expected: both Rust CI jobs pass.

---

## After Merge (the contributor, on the IdeaPad)

1. `just test` passes.
2. Rerun into their database: `just bench --config configs/x86.toml`, then `just bench --config configs/x86-f16.toml`.
3. The new run should record:
   - `cpu` = `AMD Ryzen 5 7535HS with Radeon Graphics`;
   - `os` = `Windows 10.0.2xxxx.xxxx`;
   - `gpu` = `AMD Radeon(TM) Graphics`;
   - one tier of 6 cores / 12 logical CPUs;
   - caches: L1d and L1i 32 KiB ×6, L2 512 KiB ×6, L3 16 MiB ×1.

   Check with:

   ```bash
   sqlite3 data/db/dselement/ideapad5pro.sqlite "SELECT os, cpu, gpu FROM runs ORDER BY run_id DESC LIMIT 1"
   ```

4. Then the `peaks.csv` follow-up can start: `device` = the recorded `cpu`, after `engineLabel` in `web/src/lib/hardware.ts` stops calling every peaked CPU's cores "P-cores".
