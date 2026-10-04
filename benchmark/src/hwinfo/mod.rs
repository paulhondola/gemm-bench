//! The machine a run measured, captured once per run: the build (arch,
//! compile-time target features, rustc), the OS, the CPU's core tiers and
//! caches, and the GPU. Each platform module reads what its OS exposes, as a
//! normal user; what it doesn't is left out (an empty list, or `None`), never
//! guessed.

use std::collections::{BTreeMap, HashMap};

use crate::context::UNKNOWN;

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
        let (tiers, caches) = native::topology();
        let (gpu, gpu_cores) =
            native::gpu().map_or((None, None), |(name, cores)| (Some(name), cores));
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

impl Machine {
    /// The block printed before a run: what this machine is, and what it
    /// didn't report.
    pub(crate) fn summary(&self) -> String {
        let mut out = format!(
            "Machine\n  OS        {} ({})\n  CPU       {}, {} logical CPUs available\n",
            self.os, self.arch, self.cpu, self.available_parallelism
        );
        if self.tiers.is_empty() {
            out.push_str("    cores not reported\n");
        }
        for tier in &self.tiers {
            let name = tier
                .name
                .as_deref()
                .map_or_else(String::new, |n| format!(" {n}"));
            out.push_str(&format!(
                "    tier {}{name}: {} core{}, {} thread{}\n",
                tier.tier,
                tier.cores,
                plural(tier.cores),
                tier.logical_cpus,
                plural(tier.logical_cpus)
            ));
            self.push_caches(&mut out, "      ", Some(tier.tier));
        }
        if self.caches.is_empty() {
            out.push_str("    caches not reported\n");
        }
        self.push_caches(&mut out, "    all tiers: ", None);
        out.push_str(&match (&self.gpu, self.gpu_cores) {
            (Some(name), Some(cores)) => format!("  GPU       {name}, {cores} cores\n"),
            (Some(name), None) => format!("  GPU       {name}\n"),
            (None, _) => "  GPU       not detected\n".to_owned(),
        });
        out.push_str(&format!("  Features  {}\n", self.target_features));
        out
    }

    /// One line of the caches serving `tier` (`None`: shared across tiers), if any.
    fn push_caches(&self, out: &mut String, prefix: &str, tier: Option<usize>) {
        let caches: Vec<String> = self
            .caches
            .iter()
            .filter(|cache| cache.tier == tier)
            .map(|cache| {
                let kind = match cache.kind {
                    CacheKind::Data => "d",
                    CacheKind::Instruction => "i",
                    CacheKind::Unified => "",
                };
                let shared = if cache.shared_by > 1 {
                    format!(" (shared by {})", cache.shared_by)
                } else {
                    String::new()
                };
                format!(
                    "L{}{kind} {} x{}{shared}",
                    cache.level,
                    byte_size(cache.size_bytes),
                    cache.instances
                )
            })
            .collect();
        if !caches.is_empty() {
            out.push_str(&format!("{prefix}{}\n", caches.join(", ")));
        }
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

/// `131072` → `128 KiB`; sizes that aren't a whole KiB stay in bytes.
fn byte_size(bytes: usize) -> String {
    match bytes {
        b if b % (1 << 20) == 0 => format!("{} MiB", b >> 20),
        b if b % (1 << 10) == 0 => format!("{} KiB", b >> 10),
        b => format!("{b} B"),
    }
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

#[cfg(test)]
mod tests {
    use super::{Cache, CacheKind, CoreTier, Machine, target_features};

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

    fn machine(
        tiers: Vec<CoreTier>,
        caches: Vec<Cache>,
        gpu: Option<(&str, Option<usize>)>,
    ) -> Machine {
        Machine {
            os: "macOS 27.0.1".to_owned(),
            arch: "aarch64",
            target_features: "dotprod fp16 neon".to_owned(),
            rustc_version: "rustc 1.99.0-nightly",
            cpu: "Apple M1 Pro".to_owned(),
            available_parallelism: 10,
            gpu: gpu.map(|(name, _)| name.to_owned()),
            gpu_cores: gpu.and_then(|(_, cores)| cores),
            tiers,
            caches,
        }
    }

    fn cache(
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
            line_bytes: Some(128),
            shared_by,
            instances,
        }
    }

    #[test]
    fn summary_lists_cpu_tiers_caches_gpu_and_features() {
        let tiers = vec![
            CoreTier {
                tier: 0,
                name: Some("Performance".to_owned()),
                cores: 8,
                logical_cpus: 8,
            },
            CoreTier {
                tier: 1,
                name: None,
                cores: 2,
                logical_cpus: 2,
            },
        ];
        let caches = vec![
            cache(None, 3, CacheKind::Unified, 24 << 20, 10, 1),
            cache(Some(0), 1, CacheKind::Data, 128 << 10, 1, 8),
            cache(Some(0), 2, CacheKind::Unified, 12 << 20, 4, 2),
            cache(Some(1), 1, CacheKind::Instruction, 1000, 1, 2),
        ];
        let summary = machine(tiers, caches, Some(("Apple M1 Pro", Some(16)))).summary();
        assert_eq!(
            summary,
            "\
Machine
  OS        macOS 27.0.1 (aarch64)
  CPU       Apple M1 Pro, 10 logical CPUs available
    tier 0 Performance: 8 cores, 8 threads
      L1d 128 KiB x8, L2 12 MiB x2 (shared by 4)
    tier 1: 2 cores, 2 threads
      L1i 1000 B x2
    all tiers: L3 24 MiB x1 (shared by 10)
  GPU       Apple M1 Pro, 16 cores
  Features  dotprod fp16 neon
"
        );
    }

    #[test]
    fn summary_says_what_the_machine_did_not_report() {
        let summary = machine(Vec::new(), Vec::new(), None).summary();
        assert_eq!(
            summary,
            "\
Machine
  OS        macOS 27.0.1 (aarch64)
  CPU       Apple M1 Pro, 10 logical CPUs available
    cores not reported
    caches not reported
  GPU       not detected
  Features  dotprod fp16 neon
"
        );
        let named_gpu = machine(Vec::new(), Vec::new(), Some(("Intel Iris", None))).summary();
        assert!(
            named_gpu.contains("  GPU       Intel Iris\n"),
            "{named_gpu}"
        );
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
        #[cfg(target_os = "macos")]
        assert!(machine.gpu.is_some(), "{machine:?}");
        #[cfg(target_os = "linux")]
        assert!(!machine.tiers.is_empty(), "{machine:?}");
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
    }
}
