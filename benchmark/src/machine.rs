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
    {
        command_output("sysctl", &["hw"])
            .map(|text| macos_topology(&parse_sysctl(&text)))
            .unwrap_or_default()
    }
    #[cfg(target_os = "linux")]
    {
        linux_topology(Path::new("/sys/devices"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        (Vec::new(), Vec::new())
    }
}

/// `key: value` lines of `sysctl hw`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_sysctl(text: &str) -> HashMap<&str, &str> {
    text.lines()
        .filter_map(|line| line.split_once(": "))
        .collect()
}

/// Tiers and caches from `hw.perflevelN.*`. Never the legacy
/// `hw.l1dcachesize`/`hw.l2cachesize`: on Apple Silicon they describe the
/// E-cores.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
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
    let mut seen = BTreeMap::new();
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
    let caches = grouped
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
        .collect();
    (tiers, caches)
}

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
    fn target_features_are_sorted_and_name_the_build() {
        let features = target_features();
        let names: Vec<&str> = features
            .split(' ')
            .filter(|name| !name.is_empty())
            .collect();
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
        assert!(
            machine.rustc_version.starts_with("rustc "),
            "{}",
            machine.rustc_version
        );
        assert!(machine.available_parallelism > 0);
        assert!(machine.gpu.is_some() || machine.gpu_cores.is_none());
        #[cfg(target_os = "macos")]
        assert!(!machine.tiers.is_empty() && !machine.caches.is_empty());
    }
}
