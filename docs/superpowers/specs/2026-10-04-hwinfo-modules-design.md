# `hwinfo`: Per-Platform Hardware Capture

**Date:** 2026-10-04
**Status:** Approved; plan in `docs/superpowers/plans/2026-10-04-hwinfo-modules.md`.
**Ships after:** the quick PR in `docs/superpowers/plans/2026-10-04-windows-host-support.md` (Windows CI job, `just bench` argument fix, x86 presets), merged as #29. Its Windows CI job is what exercises this design's Windows module.

## Problem

`data/db/dselement/ideapad5pro.sqlite`, the first Windows host database, recorded `cpu = 'unknown'`, `os = 'windows'`, no GPU, and no `core_tiers` or `caches` rows. Windows was never implemented. The hardware lookups also live in two places with one `#[cfg]` arm per platform inside each function:

- `benchmark/src/context.rs`: `cpu_name()` and its `/proc/cpuinfo` and `lscpu` parsers, next to the run's commit and timestamp.
- `benchmark/src/machine.rs` (728 lines): `Machine`, `os()`, `target_features()`, `topology()`, the macOS `sysctl` and Linux sysfs topology parsers, and the `ioreg` GPU core count.

Adding Windows to that layout means a third arm in every function.

## Goals

1. One module per platform, each reading the OS, CPU, GPU, core tiers and caches the platform's own way.
2. Windows records all of those.
3. Linux and Windows record a GPU name.
4. macOS and Linux keep recording exactly the values they record today.
5. Every parser stays unit-tested on every platform.

## Non-Goals

- **RAM.** `runs` has no column for it, and schema v1 is frozen: `validate` compares each database's DDL byte-for-byte with `data/schema.sql`, and there is no migration path. RAM waits for schema v2.
- **Clocks, power, SPD data** or anything else that needs admin or root (`powermetrics`, `dmidecode`).
- **GPU kernels off macOS.** The Windows and Linux GPU name is informational.
- **`peaks.csv` rows for the Ryzen 5 7535HS.** `bun test` requires every peak row to match a recorded `device`. The rows wait for the contributor's rerun after this ships.

## Decisions

| Question | Decision |
|---|---|
| How modules compile | **Parsers compile on every platform; only OS calls are gated** (approach A). Whole-module gating (B) would stop the macOS parser tests from running in CI and the Windows ones from running anywhere but the Windows runner. A trait (C) would have one implementation per build. |
| RAM | Deferred to schema v2. |
| GPU off macOS | One name, the first display adapter the OS lists. `gpu_cores` stays `NULL` off macOS. |
| Privileges | **Every lookup works as a normal user.** No lookup in scope needs admin. Requiring it would leave root-owned files in `data/db/` and `benchmark/target/` on macOS and Linux, and would run `PATH`-resolved tools elevated for hours. |
| Sequencing | Quick PR first, then this as its own PR. |

## Design

### Layout

```text
benchmark/src/
  context.rs        RunContext (commit, timestamp), command_output, UNKNOWN
  hwinfo/
    mod.rs          Machine, CoreTier, Cache, CacheKind; Machine::capture();
                    target_features(); CacheMap and group_caches()
    macos.rs        sysctl, sw_vers, Metal, ioreg
    linux.rs        uname, /proc/cpuinfo, lscpu, sysfs, lspci
    windows.rs      cmd /C ver, reg query, PowerShell CIM, GetLogicalProcessorInformationEx
```

`machine.rs` is removed. `cpu_name`, `parse_cpu_model` and `parse_lscpu_model` leave `context.rs`. `command_output` and `UNKNOWN` stay there, because the commit lookup uses them too. `plan.rs`, `db.rs` and `cli.rs` change only their import path, from `crate::machine` to `crate::hwinfo`. The `Machine`, `CoreTier`, `Cache` and `CacheKind` types and fields are unchanged.

### Interface

Each platform module exports the same four functions:

```rust
/// e.g. `macOS 27.0.1`, `Linux 6.8.0-45-generic`, `Windows 10.0.22631.4317`.
pub(super) fn os() -> Option<String>;
/// The CPU's name as the OS reports it.
pub(super) fn cpu() -> Option<String>;
/// The GPU's name, and its core count where the OS reports one (macOS only).
pub(super) fn gpu() -> Option<(String, Option<usize>)>;
/// Kinds of core, fastest first, and the caches that serve them.
pub(super) fn topology() -> (Vec<CoreTier>, Vec<Cache>);
```

These four, and the OS calls behind them, carry `#[cfg(target_os = "<platform>")]`. Everything else in a platform module is a parser over `&str` or `&[u8]` that compiles everywhere. Each file starts with one `#![cfg_attr(not(target_os = "<platform>"), allow(dead_code))]` in place of today's per-function attributes.

`mod.rs` selects the native module and owns every fallback:

```rust
mod linux;
mod macos;
mod windows;

#[cfg(target_os = "linux")]
use linux as native;
#[cfg(target_os = "macos")]
use macos as native;
#[cfg(target_os = "windows")]
use windows as native;

/// Targets with no module record only what std and the compiler know.
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod native {
    pub(super) fn os() -> Option<String> { None }
    pub(super) fn cpu() -> Option<String> { None }
    pub(super) fn gpu() -> Option<(String, Option<usize>)> { None }
    pub(super) fn topology() -> (Vec<super::CoreTier>, Vec<super::Cache>) { (Vec::new(), Vec::new()) }
}
```

`Machine::capture()` calls `native::*` and fills the gaps in one place:

| Field | Source | When the lookup fails |
|---|---|---|
| `os` | `native::os()` | `std::env::consts::OS` (`windows`, `linux`, …), as today |
| `arch` | `std::env::consts::ARCH` | — |
| `target_features` | `target_features()` in `mod.rs`, unchanged | — |
| `rustc_version` | `env!("GEMM_BENCH_RUSTC")`, unchanged | — |
| `cpu` | `native::cpu()` | `UNKNOWN` |
| `available_parallelism` | `std::thread::available_parallelism()`, unchanged | `1` |
| `gpu`, `gpu_cores` | `native::gpu()` | both `None` |
| `tiers`, `caches` | `native::topology()` | both empty |

A lookup never fails a run. A missing or unparsable value is left out, as `machine.rs` does today.

### Sources per platform

| | macOS (moved, unchanged) | Linux | Windows (new) |
|---|---|---|---|
| `os` | `sw_vers -productVersion` → `macOS <v>` | `uname -r` → `Linux <r>` (unchanged) | `cmd /C ver` → `Windows <build>` |
| `cpu` | `sysctl -n machdep.cpu.brand_string` | `/proc/cpuinfo` `model name`, then `lscpu` `Model name` (unchanged) | `reg query HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0 /v ProcessorNameString` |
| `gpu` | Metal default device + `ioreg -rc AGXAccelerator -d1` `gpu-core-count` | **new:** `lspci -mm`, first display-class device | `powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_VideoController).Name"`, first line |
| `topology` | `sysctl hw` `hw.perflevelN.*` | sysfs under `/sys/devices` (unchanged) | `GetLogicalProcessorInformationEx(RelationAll)` |

#### Windows `os`

`ver` prints `Microsoft Windows [Version 10.0.22631.4317]`, with the word "Version" localized. The parser takes the last whitespace-separated token inside the brackets and returns `Windows 10.0.22631.4317`. Windows 11 still reports `10.0`; its builds start at 22000. The build is recorded as-is rather than turned into a product name. The registry's `ProductName` says "Windows 10" on Windows 11, so it can't be used.

#### Windows `cpu`

The parser finds the line whose trimmed text starts with `ProcessorNameString`, takes what follows `REG_SZ`, and trims it, because Intel pads the name with spaces. A blank name counts as missing. On the IdeaPad the expected value is `AMD Ryzen 5 7535HS with Radeon Graphics`.

#### Windows `gpu`

`Win32_VideoController` lists only adapters that are present. The registry display class (`{4d36e968-e325-11ce-bfc1-08002be10318}`) keeps entries for removed GPUs, and a recursive query of it hits access-denied `Properties` subkeys, which makes `reg` exit non-zero. The parser takes the first non-blank line, trimmed. `gpu_cores` is `None`. On the IdeaPad the expected value is `AMD Radeon(TM) Graphics`: AMD's driver gives Rembrandt iGPUs this generic name. A name that isn't valid UTF-8 in the console code page makes `command_output` return `None`, so the GPU is left out.

#### Windows `topology`

`GetLogicalProcessorInformationEx` is declared in a hand-written `unsafe extern "system"` block with `#[link(name = "kernel32")]`; there are no new dependencies. It is called once with a null buffer to learn the length, then once to fill a `Vec<u8>`. `windows_topology(buffer: &[u8])` walks back-to-back `SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX` records at their x64 offsets (from `winnt.h`):

| Record | Field | Offset |
|---|---|---|
| any | `Relationship: u32` (0 core, 1 NUMA node, 2 cache, 3 package, 4 group) | 0 |
| any | `Size: u32` | 4 |
| core | `EfficiencyClass: u8` (higher is faster; all 0 when cores don't differ) | 9 |
| core | first `GROUP_AFFINITY` (`Mask: u64`, `Group: u16`) | 32 |
| cache | `Level: u8`, `LineSize: u16`, `CacheSize: u32`, `Type: u32` (0 unified, 1 instruction, 2 data, 3 trace) | 8, 10, 12, 16 |
| cache | first `GROUP_AFFINITY` | 40 |

The parser:
- Each core record is one physical core. The set bits of its mask are its logical CPUs, numbered `group * 64 + bit`.
- Tiers group cores by `EfficiencyClass`, highest first. Windows names no tiers, so `CoreTier::name` is `None`.
- Cache records feed `group_caches`. Trace caches are skipped.
- Other record kinds are skipped.
- The walk stops at a record cut off by the buffer's end, and at a `Size` below the 8-byte header, so it never loops.
- It reads only each record's first `GROUP_AFFINITY`, so on hosts with more than 64 logical CPUs, cores and caches beyond the first processor group are lost. The code marks this limit with a `ponytail:` comment.

The parser and its fixture tests were compiled and passed clippy `-D warnings` in a scratch crate on 2026-10-04. The hwinfo implementation plan carries that code.

#### Linux `gpu`

`lspci -mm` prints one device per line: the slot, then quoted fields. For example:

```text
00:02.0 "VGA compatible controller" "Intel Corporation" "Alder Lake-P GT2 [Iris Xe Graphics]" -r0c -p00 "Lenovo" "Device 3803"
```

The parser takes the first line whose first quoted field (the class) is `VGA compatible controller`, `3D controller` or `Display controller`, and returns `"<vendor> <device>"`, from the second and third quoted fields. The result is `None` when `lspci` is absent (no `pciutils`, as in minimal containers) or no line matches (most ARM boards). "First" is PCI bus order. `gpu_cores` is `None`.

### Shared code in `mod.rs`

`group_caches` moves out of `linux_topology` without changes. It is now shared with `windows_topology`:

```rust
/// Each distinct cache: (level, kind, the CPUs it serves) → (size, line).
type CacheMap = BTreeMap<(usize, CacheKind, Vec<usize>), (usize, Option<usize>)>;

/// Groups distinct caches into (tier, level, kind, size, sharing) with an
/// instance count. A cache whose CPUs span tiers gets no tier.
fn group_caches(seen: CacheMap, tier_of: &HashMap<usize, usize>) -> Vec<Cache>;
```

Linux-only helpers (`parse_cpu_list`, `parse_size`, `CacheKind::from_sysfs`) move to `linux.rs`. `CacheKind::from_sysfs` becomes a free function there, so `mod.rs` holds no platform's format.

## Testing

Approach A runs every parser test on every machine: your Mac (via lefthook), Linux CI, and the Windows CI job.

| Module | Tests |
|---|---|
| `macos.rs` | moved unchanged: the M1 Pro `sysctl` perf-level fixture, ignoring the legacy keys, the no-perf-levels case, the `ioreg` core count |
| `linux.rs` | moved unchanged: the hybrid and big.LITTLE sysfs fixtures, the empty-sysfs case, sysfs list and size parsing, the `cpuinfo`/`lscpu` parsers and their blank-name cases. **New:** an `lspci -mm` fixture whose first line isn't a display device, followed by an Intel VGA and an NVIDIA 3D controller (Intel wins); a fixture with no display device (`None`) |
| `windows.rs` | **new:** `ver` in two locales and with no brackets; the `reg` CPU name (normal, trailing padding, blank, error text); the CIM GPU output (one adapter, two adapters, blank); the record parser on a Ryzen 5 7535HS fixture (6 SMT cores, one tier, per-core L1d/L1i/L2, an L3 over all 12 CPUs, an ignored package record), a hybrid fixture (efficiency class 1 before 0, an L3 spanning tiers with no tier), and a cut-off buffer |
| `mod.rs` | `target_features`, unchanged; one native capture test |

The native capture test asserts, per platform:
- **All platforms:** `os` and `cpu` are non-empty, `arch` matches, `rustc_version` starts with `rustc `, `available_parallelism > 0`, and `gpu_cores` implies `gpu`.
- **macOS:** tiers, caches and `gpu` are present.
- **Linux:** tiers are present.
- **Windows:**
  - `os` starts with `Windows `;
  - `cpu` isn't `UNKNOWN`;
  - tiers and caches are present;
  - the tiers' `logical_cpus` sum to `available_parallelism`, which checks the record offsets against the real API.

GPU presence isn't asserted on Linux or Windows: CI runners may have none.

**macOS and Linux values must not change.** Parsing is pinned by the moved tests, which stay byte-identical. The captured values depend on the machine, so the pure-move commit carries a one-time check instead of a permanent test:
1. On the Mac, before the move: `just bench --config configs/quick.toml --output <scratch>/before.sqlite`.
2. The same after the move, to `after.sqlite`.
3. `os, arch, target_features, cpu, available_parallelism, gpu, gpu_cores` from `runs`, and all of `core_tiers` and `caches`, must be identical between the two.

## Migration

One PR on `feat/hwinfo-modules`, branched from `main` after #29. Four commits:

1. **Pure move.**
   - `machine.rs` becomes `hwinfo/{mod,macos,linux}.rs`.
   - The CPU-name code moves out of `context.rs`.
   - `group_caches` is extracted.
   - Imports in `plan.rs`, `db.rs` and `cli.rs` are updated.
   - No behavior change; verified by the before/after check above.
2. **`windows.rs`:** `os`, `cpu`, `topology`.
3. **Windows `gpu`** through CIM.
4. **Linux `gpu`** through `lspci`.

Each commit passes `just check && just test` locally and both CI Rust jobs.

## Docs

- **`README.md` line 197** (the `runs` field list): `gpu` becomes "the GPU the Metal kernels run on (macOS), or the OS's first display adapter (Linux, Windows); `gpu_cores` on macOS only". Add a sentence: every lookup runs as a normal user, and a value the OS doesn't give is left out (`cpu` reads `unknown`).
- **`data/schema.sql` is not touched.** Its comments are part of the DDL that `validate` compares byte-for-byte.
- **`CLAUDE.md`:** no change. The quick PR updates its "CI is Linux" note when it adds the Windows job.

## After This Ships

- The contributor reruns on the IdeaPad with the x86 presets. The new run records the CPU, OS build, GPU, tiers and caches.
- Then `peaks.csv` can gain 1-core f32 and f64 rows for `AMD Ryzen 5 7535HS with Radeon Graphics`. That also needs `engineLabel` in `web/src/lib/hardware.ts` fixed first, since it calls every peaked CPU's cores "P-cores".
- RAM joins `hwinfo` with schema v2: one more function per platform module.
