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
