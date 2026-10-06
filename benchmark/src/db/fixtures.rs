//! Test fixtures for db and validate tests.

use gemm_bench::{GemmKernel, kernels::PackedGemm};

use crate::{
    benchmark::BenchmarkRecord,
    context::RunContext,
    hwinfo::{Cache, CacheKind, CoreTier, Machine},
};

pub(crate) fn machine() -> Machine {
    Machine {
        os: "macOS 27.0.1".to_owned(),
        arch: "aarch64",
        target_features: "dotprod fp16 neon".to_owned(),
        rustc_version: "rustc 1.101.0-nightly",
        cpu: "Apple M1 Pro".to_owned(),
        available_parallelism: 10,
        gpu: Some("Apple M1 Pro".to_owned()),
        gpu_cores: Some(16),
        tiers: vec![CoreTier {
            tier: 0,
            name: Some("Performance".to_owned()),
            cores: 8,
            logical_cpus: 8,
        }],
        caches: vec![Cache {
            tier: Some(0),
            level: 2,
            kind: CacheKind::Unified,
            size_bytes: 12 << 20,
            line_bytes: Some(128),
            shared_by: 4,
            instances: 2,
        }],
    }
}

pub(crate) fn context(started_at: &str) -> RunContext {
    RunContext {
        commit: "abc1234".to_owned(),
        timestamp: started_at.to_owned(),
    }
}

/// A CPU kernel with no params, `packed` with the params it really
/// reports, and a Metal kernel with `gpu_ms`.
pub(crate) fn records() -> Vec<BenchmarkRecord> {
    let base = |kernel: &str, backend: &'static str| BenchmarkRecord {
        kernel: kernel.to_owned(),
        backend,
        precision: "f32",
        n: 64,
        threads: 1,
        gops: 10.0,
        mean_rel_error_f64: 1e-7,
        median_ms: 0.05,
        min_ms: 0.05,
        stddev_ms: 0.001,
        gpu_ms: None,
        setup_ms: 0.0,
        params: Vec::new(),
    };
    vec![
        base("ikj", "cpu"),
        BenchmarkRecord {
            params: GemmKernel::<f32>::params(&PackedGemm::new(256), 64),
            ..base("packed", "cpu")
        },
        BenchmarkRecord {
            gpu_ms: Some(0.02),
            ..base("mps", "metal")
        },
    ]
}
