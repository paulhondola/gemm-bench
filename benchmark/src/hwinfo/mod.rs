//! The machine a run measured, captured once per run: the build (arch,
//! compile-time target features, rustc), the OS, the CPU's core tiers and
//! caches, and the GPU. Each platform module reads what its OS exposes, as a
//! normal user; what it doesn't is left out (an empty list, or `None`), never
//! guessed.

mod features;
mod linux;
mod macos;
mod summary;
mod topology;
mod types;
mod windows;

#[cfg(test)]
mod tests;

pub(crate) use features::target_features;
pub(crate) use topology::{CacheMap, group_caches};
pub(crate) use types::{Cache, CacheKind, CoreTier, Machine};

use crate::context::UNKNOWN;

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
