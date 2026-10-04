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

/// `key: value` lines of `sysctl hw`.
fn parse_sysctl(text: &str) -> HashMap<&str, &str> {
    text.lines()
        .filter_map(|line| line.split_once(": "))
        .collect()
}

/// Tiers and caches from `hw.perflevelN.*`. Never the legacy
/// `hw.l1dcachesize`/`hw.l2cachesize`: on Apple Silicon they describe the
/// E-cores.
fn macos_topology(sysctl: &HashMap<&str, &str>) -> (Vec<CoreTier>, Vec<Cache>) {
    let number = |key: &str| {
        sysctl
            .get(key)
            .and_then(|value| value.parse::<usize>().ok())
    };
    let line_bytes = number("hw.cachelinesize");
    let (mut tiers, mut caches) = (Vec::new(), Vec::new());
    for tier in 0..number("hw.nperflevels").unwrap_or(0) {
        let key = |name: &str| format!("hw.perflevel{tier}.{name}");
        let (Some(cores), Some(logical)) =
            (number(&key("physicalcpu")), number(&key("logicalcpu")))
        else {
            continue;
        };
        tiers.push(CoreTier {
            tier,
            name: sysctl
                .get(key("name").as_str())
                .map(|name| (*name).to_owned()),
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

#[cfg(test)]
mod tests {
    use super::{Cache, CacheKind, CoreTier, macos_topology, parse_gpu_cores, parse_sysctl};

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

    fn cache(
        tier: usize,
        level: usize,
        kind: CacheKind,
        size_bytes: usize,
        shared_by: usize,
        instances: usize,
    ) -> Cache {
        Cache {
            tier: Some(tier),
            level,
            kind,
            size_bytes,
            line_bytes: Some(128),
            shared_by,
            instances,
        }
    }

    #[test]
    fn macos_perflevels_become_tiers_with_their_own_caches() {
        let (tiers, caches) = macos_topology(&parse_sysctl(M1_PRO));
        assert_eq!(
            tiers,
            [
                CoreTier {
                    tier: 0,
                    name: Some("Performance".into()),
                    cores: 8,
                    logical_cpus: 8
                },
                CoreTier {
                    tier: 1,
                    name: Some("Efficiency".into()),
                    cores: 2,
                    logical_cpus: 2
                },
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
}
