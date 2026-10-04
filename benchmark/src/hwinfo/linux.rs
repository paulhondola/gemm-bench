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

/// The first `model name` line of `/proc/cpuinfo`, unless blank. ARM kernels
/// often omit it.
fn parse_cpu_model(cpuinfo: &str) -> Option<String> {
    cpuinfo
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key.trim() == "model name").then(|| value.trim().to_owned())
        })
        .filter(|name| !name.is_empty())
}

/// lscpu's `Model name`, e.g. `Neoverse-V1` on an ARM server, unless blank.
fn parse_lscpu_model(lscpu: &str) -> Option<String> {
    lscpu
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key.trim() == "Model name").then(|| value.trim().to_owned())
        })
        .filter(|name| !name.is_empty())
}

/// A sysfs CPU list: `0-3,8,10-11` → `[0, 1, 2, 3, 8, 10, 11]`.
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
fn parse_size(text: &str) -> Option<usize> {
    let text = text.trim();
    let split = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    let (digits, unit) = text.split_at(split);
    let scale = match unit {
        "" => 1,
        "K" => 1 << 10,
        "M" => 1 << 20,
        "G" => 1 << 30,
        _ => return None,
    };
    digits
        .parse::<usize>()
        .ok()
        .map(|n| n * scale)
        .filter(|&n| n > 0)
}

/// Core tiers and caches from a Linux sysfs tree: `/sys/devices` in use, a
/// temp directory in tests.
fn linux_topology(devices: &Path) -> (Vec<CoreTier>, Vec<Cache>) {
    let cpu_dir = devices.join("system/cpu");
    let read = |path: &Path| {
        fs::read_to_string(path)
            .ok()
            .map(|text| text.trim().to_owned())
    };
    let list = |path: &Path| read(path).and_then(|text| parse_cpu_list(&text));
    let Some(online) = list(&cpu_dir.join("online")) else {
        return (Vec::new(), Vec::new());
    };

    // Tiers, fastest first: Intel's hybrid PMUs name them; elsewhere a higher
    // cpu_capacity is a faster core; with neither, every CPU is one tier.
    let groups: Vec<(Option<String>, Vec<usize>)> = match (
        list(&devices.join("cpu_core/cpus")),
        list(&devices.join("cpu_atom/cpus")),
    ) {
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
                    let core =
                        read(&topology.join("core_id")).or_else(|| Some(format!("cpu{cpu}")));
                    (read(&topology.join("physical_package_id")), core)
                })
                .collect();
            CoreTier {
                tier,
                name: name.clone(),
                cores: cores.len(),
                logical_cpus: cpus.len(),
            }
        })
        .collect();

    // Each cache once, keyed by the CPUs it serves, then grouped into
    // (tier, level, kind, size, sharing) with an instance count.
    let mut seen = CacheMap::new();
    for &cpu in &online {
        let Ok(entries) = fs::read_dir(cpu_dir.join(format!("cpu{cpu}/cache"))) else {
            continue;
        };
        for dir in entries.flatten().map(|entry| entry.path()) {
            if !dir
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("index"))
            {
                continue;
            }
            let (Some(level), Some(kind), Some(size), Some(shared)) = (
                read(&dir.join("level"))
                    .and_then(|text| text.parse::<usize>().ok())
                    .filter(|level| (1..=4).contains(level)),
                read(&dir.join("type")).and_then(|text| cache_kind(&text)),
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
    (tiers, group_caches(seen, &tier_of))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{
        Cache, CacheKind, CoreTier, linux_topology, parse_cpu_list, parse_cpu_model,
        parse_lscpu_model, parse_size,
    };

    #[test]
    fn sysfs_lists_and_sizes_parse() {
        assert_eq!(
            parse_cpu_list("0-3,8,10-11\n"),
            Some(vec![0, 1, 2, 3, 8, 10, 11])
        );
        assert_eq!(parse_cpu_list(""), None);
        assert_eq!(parse_size("48K"), Some(48 << 10));
        assert_eq!(parse_size("36M"), Some(36 << 20));
        assert_eq!(parse_size("512"), Some(512));
        assert_eq!(parse_size("12Q"), None);
    }

    /// One CPU's sysfs files: its core id and its caches as (index, level,
    /// type, size, shared_cpu_list).
    fn cpu(
        cpu: usize,
        core: usize,
        caches: &[(usize, usize, &str, &str, &str)],
    ) -> Vec<(String, String)> {
        let dir = format!("system/cpu/cpu{cpu}");
        let mut files = vec![
            (
                format!("{dir}/topology/physical_package_id"),
                "0".to_owned(),
            ),
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
        let root =
            std::env::temp_dir().join(format!("gemm-bench-sysfs-{}-{name}", std::process::id()));
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
            files.extend(cpu(
                p,
                p / 2,
                &[
                    (0, 1, "Data", "48K", pair),
                    (2, 2, "Unified", "2048K", pair),
                    (3, 3, "Unified", "36864K", "0-7"),
                ],
            ));
        }
        for e in 4..8 {
            let own = e.to_string();
            files.extend(cpu(
                e,
                e,
                &[
                    (0, 1, "Data", "32K", &own),
                    (2, 2, "Unified", "4096K", "4-7"),
                    (3, 3, "Unified", "36864K", "0-7"),
                ],
            ));
        }
        let (tiers, caches) = linux_topology(&sysfs("hybrid", &files));
        assert_eq!(
            tiers,
            [
                CoreTier {
                    tier: 0,
                    name: Some("Performance".into()),
                    cores: 2,
                    logical_cpus: 4
                },
                CoreTier {
                    tier: 1,
                    name: Some("Efficiency".into()),
                    cores: 4,
                    logical_cpus: 4
                },
            ]
        );
        let line = Some(64);
        let expected = [
            Cache {
                tier: None,
                level: 3,
                kind: CacheKind::Unified,
                size_bytes: 36 << 20,
                line_bytes: line,
                shared_by: 8,
                instances: 1,
            },
            Cache {
                tier: Some(0),
                level: 1,
                kind: CacheKind::Data,
                size_bytes: 48 << 10,
                line_bytes: line,
                shared_by: 2,
                instances: 2,
            },
            Cache {
                tier: Some(0),
                level: 2,
                kind: CacheKind::Unified,
                size_bytes: 2 << 20,
                line_bytes: line,
                shared_by: 2,
                instances: 2,
            },
            Cache {
                tier: Some(1),
                level: 1,
                kind: CacheKind::Data,
                size_bytes: 32 << 10,
                line_bytes: line,
                shared_by: 1,
                instances: 4,
            },
            Cache {
                tier: Some(1),
                level: 2,
                kind: CacheKind::Unified,
                size_bytes: 4 << 20,
                line_bytes: line,
                shared_by: 4,
                instances: 1,
            },
        ];
        assert_eq!(caches, expected);
    }

    #[test]
    fn linux_without_hybrid_pmus_orders_tiers_by_capacity() {
        let mut files = vec![("system/cpu/online".to_owned(), "0-3\n".to_owned())];
        for cpu_id in 0..4 {
            files.extend(cpu(
                cpu_id,
                cpu_id,
                &[(0, 1, "Data", "64K", &cpu_id.to_string())],
            ));
            let capacity = if cpu_id < 2 { "446" } else { "1024" };
            files.push((
                format!("system/cpu/cpu{cpu_id}/cpu_capacity"),
                capacity.to_owned(),
            ));
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

    /// An empty name would fail runs.cpu's CHECK only once the sweep is over.
    #[test]
    fn a_blank_model_name_counts_as_missing() {
        assert_eq!(parse_cpu_model("model name\t: \nprocessor\t: 0\n"), None);
        assert_eq!(parse_lscpu_model("Model name:   \t\n"), None);
    }

    #[test]
    fn parse_lscpu_model_reads_the_decoded_arm_part() {
        let lscpu = "Architecture:  aarch64\nVendor ID:     ARM\nModel name:    Neoverse-V1\n";
        assert_eq!(parse_lscpu_model(lscpu).as_deref(), Some("Neoverse-V1"));
        assert_eq!(parse_lscpu_model("Architecture: aarch64\n"), None);
    }
}
