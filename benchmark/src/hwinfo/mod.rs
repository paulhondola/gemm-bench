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
    use super::{Machine, target_features};

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
        #[cfg(target_os = "macos")]
        assert!(machine.gpu.is_some(), "{machine:?}");
        #[cfg(target_os = "linux")]
        assert!(!machine.tiers.is_empty(), "{machine:?}");
    }
}
