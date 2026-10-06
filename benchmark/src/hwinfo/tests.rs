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
