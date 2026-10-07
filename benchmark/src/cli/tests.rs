use std::{ffi::OsString, fs, path::PathBuf};

use clap::{Parser, ValueEnum};

use super::Cli;
#[cfg(target_os = "macos")]
use super::validate::drop_unavailable_bnns;
use crate::kernel::{KernelChoice, Precision};
use crate::plan::BenchmarkPlan;

/// A per-process `.sqlite` path under the system temp directory, so tests never
/// write into the repository and parallel test runs do not collide.
fn temp_output(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "gemm-bench-test-{}-{name}.sqlite",
        std::process::id()
    ))
}

/// Whether this machine can build the BNNSGraph kernel, as `into_plan` asks.
#[cfg(target_os = "macos")]
fn bnns_available() -> bool {
    gemm_bench::kernels::AccelerateBnnsGemm::<f32>::new(1).is_some()
}

/// Every kernel, minus `accelerate-bnns` where `into_plan` drops it.
fn default_kernels() -> Vec<KernelChoice> {
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut kernels = KernelChoice::value_variants().to_vec();
    #[cfg(target_os = "macos")]
    if !bnns_available() {
        kernels.retain(|&k| k != KernelChoice::AccelerateBnns);
    }
    kernels
}

#[test]
fn omitted_dimensions_sweep_every_value() {
    let plan = plan_for("defaults", &["--sweep"]).expect("the full sweep should be valid");

    assert_eq!(plan.sizes, [64, 128, 256, 512, 1024, 2048, 4096]);
    assert!(plan.threads.contains(&1));
    assert_eq!(plan.kernels, default_kernels());
    assert_eq!(plan.precisions, Precision::value_variants());
    assert_eq!(plan.tile_sizes, [16, 32, 64, 128, 256]);
    assert_eq!(plan.depth_blocks, [64, 128, 256, 512, 1024]);
    assert_eq!(plan.repetitions, 5);
    assert!(!plan.no_progress);
}

#[test]
fn only_a_pinned_dimension_or_sweep_skips_the_help() {
    let unpinned = |args: &[&str]| {
        Cli::try_parse_from(std::iter::once("gemm-bench").chain(args.iter().copied()))
            .expect("arguments should parse")
            .is_unpinned()
    };
    assert!(unpinned(&[]));
    assert!(unpinned(&["--no-progress", "--repetitions", "3"]));
    assert!(!unpinned(&["--sweep"]));
    assert!(!unpinned(&["--sizes", "64"]));
    assert!(!unpinned(&["--tile-size", "32"]));
    assert!(!unpinned(&["--kc", "256"]));
}

#[test]
fn precision_flag_accepts_a_comma_delimited_sweep() {
    let plan = plan_for("precision", &["--precision", "f16,f64"]).expect("plan should be valid");

    assert_eq!(plan.precisions, [Precision::F16, Precision::F64]);
}

#[test]
fn precision_flag_accepts_integer_precisions() {
    let plan = plan_for("integers", &["--precision", "i32,i64"]).expect("plan should be valid");

    assert_eq!(plan.precisions, [Precision::I32, Precision::I64]);
    assert_eq!(plan.kernels, default_kernels());
    #[cfg(target_os = "macos")]
    assert!(plan.cells(KernelChoice::Mps, Precision::I32, 64).is_empty());
}

#[test]
fn static_thread_counts_above_a_size_are_skipped_for_that_size() {
    let plan = plan_for(
        "static-skip",
        &[
            "--sizes",
            "8,64",
            "--threads",
            "4,16",
            "--kernel",
            "static-ikj",
            "--precision",
            "f32",
        ],
    )
    .expect("a partly runnable static sweep should be valid");

    assert_eq!(
        plan.cells(KernelChoice::StaticIkj, Precision::F32, 8),
        [(4, None)]
    );
    assert_eq!(
        plan.cells(KernelChoice::StaticIkj, Precision::F32, 64),
        [(4, None), (16, None)]
    );
    assert_eq!(plan.total_configurations(), 3);
    assert_eq!(
        plan.skipped,
        ["skipping static-ikj with 16 threads at n=8 (needs a row per thread)"]
    );
}

#[test]
fn a_static_kernel_with_no_runnable_thread_count_is_rejected_before_running() {
    let error = plan_for(
        "static-idle",
        &["--sizes", "8", "--threads", "16", "--kernel", "static-ikj"],
    )
    .expect_err("a named kernel with nothing to run must be rejected");

    assert!(
        error.contains("static-ikj needs at least one row per thread"),
        "{error}"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn default_kernels_skip_mps_at_precisions_it_lacks() {
    let plan = plan_for(
        "mps-skip",
        &["--sizes", "64", "--precision", "f32,f64", "--threads", "1"],
    )
    .expect("unsupported cells of a default kernel are skipped, not rejected");

    assert!(plan.kernels.contains(&KernelChoice::Mps));
    assert_eq!(
        plan.cells(KernelChoice::Mps, Precision::F32, 64),
        [(1, None)]
    );
    assert!(plan.cells(KernelChoice::Mps, Precision::F64, 64).is_empty());
    let mut expected = Vec::new();
    if bnns_available() {
        expected.push("skipping accelerate-bnns at f64 (unsupported precision)");
    }
    expected.extend([
        "skipping mps at f64 (unsupported precision)",
        "skipping metal-naive at f64 (unsupported precision)",
        "skipping metal-tiled at f64 (unsupported precision)",
        "skipping metal-simdgroup at f64 (unsupported precision)",
    ]);
    if !bnns_available() {
        expected.push("skipping accelerate-bnns (needs macOS 26)");
    }
    assert_eq!(plan.skipped, expected);
}

#[test]
fn missing_output_directories_are_created_before_running() {
    let root = std::env::temp_dir().join(format!("gemm-bench-test-{}-nested", std::process::id()));
    let output = root.join("a/b/results.sqlite");

    let plan = Cli::try_parse_from([
        OsString::from("gemm-bench"),
        "--output".into(),
        output.clone().into(),
        "--sizes".into(),
        "8".into(),
    ])
    .expect("arguments should parse")
    .into_plan()
    .expect("missing parent directories should be created");

    drop(plan);
    assert!(output.is_file());
    fs::remove_dir_all(root).expect("remove test directories");
}

/// Tests run in debug, so without --output the plan is always refused,
/// whatever `.host` holds.
#[test]
fn a_debug_build_does_not_write_the_host_db() {
    let error = Cli::try_parse_from(["gemm-bench", "--sizes", "8"])
        .expect("arguments should parse")
        .into_plan()
        .expect_err("a debug build must not write the host DB");
    assert!(
        error.contains("debug build") && error.contains("--output"),
        "{error}"
    );
}

#[test]
fn no_progress_flag_is_parsed() {
    let plan = plan_for("no_progress", &["--no-progress"]).expect("plan should be valid");

    assert!(plan.no_progress);
}

#[test]
fn total_configurations_counts_worker_and_single_thread_kernels_correctly() {
    let plan = plan_for(
        "count",
        &[
            "--sizes",
            "64,128",
            "--precision",
            "f32,f64",
            "--kernel",
            "naive,rayon-ikj",
            "--threads",
            "1,2,4",
        ],
    )
    .expect("plan should be valid");

    // 2 precisions * 2 sizes * (1 for naive + 3 for rayon-ikj) = 2 * 2 * 4 = 16
    assert_eq!(plan.total_configurations(), 16);
}

#[cfg(target_os = "macos")]
#[test]
fn mps_parses_as_a_kernel_choice() {
    let plan = plan_for("mps", &["--kernel", "mps"]).expect("mps plan should be valid");

    assert_eq!(plan.kernels, [KernelChoice::Mps]);
    assert!(
        plan.machine.gpu.is_some(),
        "a Mac with Metal must name its GPU"
    );
    assert_eq!(plan.total_configurations(), 14); // 7 default sizes * mps's 2 precisions (f16, f32)
}

#[cfg(target_os = "macos")]
#[test]
fn metal_shader_kernels_run_every_gpu_precision_on_the_gpu() {
    let plan = plan_for(
        "metal-shaders",
        &["--kernel", "metal-naive,metal-tiled", "--sizes", "64"],
    )
    .expect("metal shader plan should be valid");

    assert_eq!(
        plan.kernels,
        [KernelChoice::MetalNaive, KernelChoice::MetalTiled]
    );
    assert!(
        plan.machine.gpu.is_some(),
        "a Mac with Metal must name its GPU"
    );
    // 1 size * 2 kernels * (f16, f32, i32, i64); f64 is skipped.
    assert_eq!(plan.total_configurations(), 8);
}

#[cfg(target_os = "macos")]
#[test]
fn a_named_kernel_at_a_precision_it_lacks_is_rejected_before_running() {
    for (kernel, precision) in [
        ("mps", "f64"),
        ("mps", "i32"),
        ("metal-naive", "f64"),
        ("metal-tiled", "f64"),
        ("metal-simdgroup", "i32"),
        ("accelerate-blas", "f16"),
        ("accelerate-bnns", "f64"),
    ] {
        let error = plan_for(
            &format!("{kernel}-{precision}"),
            &["--kernel", kernel, "--precision", precision],
        )
        .expect_err("a named kernel with nothing to run must be rejected");
        assert!(
            error.contains(&format!("{kernel} does not support {precision} precision")),
            "{error}"
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn accelerate_blas_parses_as_a_single_thread_cpu_kernel() {
    let plan = plan_for(
        "accelerate",
        &["--kernel", "accelerate-blas", "--threads", "1,4"],
    )
    .expect("accelerate-blas plan should be valid");

    assert_eq!(plan.kernels, [KernelChoice::AccelerateBlas]);
    assert_eq!(
        plan.cells(KernelChoice::AccelerateBlas, Precision::F64, 64),
        [(1, None)]
    );
    assert_eq!(plan.total_configurations(), 14); // 7 default sizes * (f32, f64)
}

#[cfg(target_os = "macos")]
#[test]
fn default_kernels_skip_accelerate_blas_at_f16() {
    let plan = plan_for(
        "accelerate-skip",
        &["--sizes", "64", "--precision", "f16,f32", "--threads", "1"],
    )
    .expect("unsupported cells of a default kernel are skipped, not rejected");

    assert!(
        plan.cells(KernelChoice::AccelerateBlas, Precision::F16, 64)
            .is_empty()
    );
    assert_eq!(
        plan.cells(KernelChoice::AccelerateBlas, Precision::F32, 64),
        [(1, None)]
    );
    let mut expected = vec!["skipping accelerate-blas at f16 (unsupported precision)"];
    if !bnns_available() {
        expected.push("skipping accelerate-bnns (needs macOS 26)");
    }
    assert_eq!(plan.skipped, expected);
}

#[cfg(target_os = "macos")]
#[test]
fn accelerate_bnns_runs_f16_and_f32_on_one_caller_thread() {
    if !bnns_available() {
        return;
    }
    let plan = plan_for(
        "accelerate-bnns",
        &["--kernel", "accelerate-bnns", "--threads", "1,4"],
    )
    .expect("accelerate-bnns plan should be valid");

    assert_eq!(plan.kernels, [KernelChoice::AccelerateBnns]);
    assert_eq!(
        plan.cells(KernelChoice::AccelerateBnns, Precision::F16, 64),
        [(1, None)]
    );
    assert_eq!(plan.total_configurations(), 14); // 7 default sizes * (f16, f32)
}

#[cfg(target_os = "macos")]
#[test]
fn accelerate_bnns_before_macos_26_is_dropped_by_default_and_rejected_when_named() {
    let mut kernels = vec![KernelChoice::Ikj, KernelChoice::AccelerateBnns];
    let error = drop_unavailable_bnns(&mut kernels, true, || false)
        .expect_err("a named accelerate-bnns must be rejected");
    assert!(error.contains("needs macOS 26"));

    let notice = drop_unavailable_bnns(&mut kernels, false, || false)
        .expect("a default accelerate-bnns is only skipped");
    assert_eq!(kernels, [KernelChoice::Ikj]);
    assert_eq!(
        notice.as_deref(),
        Some("skipping accelerate-bnns (needs macOS 26)")
    );
}

#[test]
fn knob_flags_and_their_aliases_accept_comma_delimited_sweeps() {
    let plan = plan_for("knobs", &["--tile", "32,64", "--depth-block", "128,512"])
        .expect("plan should be valid");
    assert_eq!(plan.tile_sizes, [32, 64]);
    assert_eq!(plan.depth_blocks, [128, 512]);
    let plan = plan_for("kc-alias", &["--kc", "256"]).expect("plan should be valid");
    assert_eq!(plan.depth_blocks, [256]);
}

#[test]
fn zero_in_a_knob_list_is_rejected() {
    for flag in ["--tile-size", "--depth-block"] {
        let error =
            plan_for("zero-knob", &[flag, "32,0"]).expect_err("a zero knob value must be rejected");
        assert!(error.contains(flag), "{error}");
    }
}

#[test]
fn each_knob_multiplies_only_the_kernels_that_sweep_it() {
    let plan = plan_for(
        "knob-count",
        &[
            "--sizes",
            "64",
            "--precision",
            "f32",
            "--kernel",
            "ikj,tiled,rayon-tiled,packed",
            "--threads",
            "1,2",
            "--tile-size",
            "32,64,128",
            "--depth-block",
            "256",
        ],
    )
    .expect("plan should be valid");

    // ikj 1 + tiled 3 + rayon-tiled 2 threads x 3 tiles + packed 1 = 11
    assert_eq!(plan.total_configurations(), 11);
    assert_eq!(
        plan.cells(KernelChoice::Ikj, Precision::F32, 64),
        [(1, None)]
    );
    assert_eq!(
        plan.cells(KernelChoice::Tiled, Precision::F32, 64),
        [(1, Some(32)), (1, Some(64)), (1, Some(128))]
    );
    assert_eq!(
        plan.cells(KernelChoice::Packed, Precision::F32, 64),
        [(1, Some(256))]
    );
}

#[test]
fn a_knob_no_selected_kernel_sweeps_is_rejected() {
    let error = plan_for(
        "unused-knob",
        &["--kernel", "ikj,packed", "--tile-size", "32"],
    )
    .expect_err("a knob no selected kernel uses must be rejected");
    assert!(
        error.contains("--tile-size applies only to tiled"),
        "{error}"
    );
}

/// A repeated value would measure a cell twice, which `validate` rejects
/// only after the run is in the host DB.
#[test]
fn a_repeated_value_is_rejected_before_running() {
    for (flag, values, repeated) in [
        ("--sizes", "64,128,64", "64"),
        ("--threads", "2,2", "2"),
        ("--kernel", "ikj,ikj", "ikj"),
        ("--precision", "f32,f32", "f32"),
        ("--tile-size", "32,32", "32"),
        ("--depth-block", "256,256", "256"),
    ] {
        let error =
            plan_for("repeat", &[flag, values]).expect_err("a repeated value must be rejected");
        assert!(
            error.contains(&format!("{flag} lists {repeated} twice")),
            "{error}"
        );
    }
}

#[test]
fn the_block_size_flag_is_gone() {
    assert!(Cli::try_parse_from(["gemm-bench", "--block-size", "64"]).is_err());
}

fn temp_config(name: &str, body: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "gemm-bench-test-{}-{name}.toml",
        std::process::id()
    ));
    fs::write(&path, body).expect("write test config");
    path
}

/// Plans `flags` with a temp `--output`, removed afterwards. Every
/// rejected plan is also checked to have left no output file behind.
fn plan_for(name: &str, flags: &[&str]) -> Result<BenchmarkPlan, String> {
    let output = temp_output(name);
    let mut args: Vec<OsString> = vec![
        "gemm-bench".into(),
        "--output".into(),
        output.clone().into(),
    ];
    args.extend(flags.iter().map(OsString::from));
    let plan = Cli::try_parse_from(args)
        .expect("arguments should parse")
        .into_plan();
    if plan.is_err() {
        assert!(
            !output.exists(),
            "a rejected plan must not create the output file"
        );
    }
    let _ = fs::remove_file(output);
    plan
}

fn plan_with_config(name: &str, body: &str, flags: &[&str]) -> Result<BenchmarkPlan, String> {
    let config = temp_config(name, body);
    let config_arg = config.to_str().expect("temp paths are UTF-8");
    let plan = plan_for(name, &[&["--config", config_arg], flags].concat());
    let _ = fs::remove_file(config);
    plan
}

const PRESET: &str = "sizes = [64]\nkernel = [\"tiled\"]\nprecision = [\"f32\"]\ntile-size = [32]\nrepetitions = 2\n";

#[test]
fn config_keys_fill_the_dimensions_flags_omit() {
    let plan = plan_with_config("fill", PRESET, &[]).expect("config plan should be valid");
    assert_eq!(plan.sizes, [64]);
    assert_eq!(plan.kernels, [KernelChoice::Tiled]);
    assert_eq!(plan.precisions, [Precision::F32]);
    assert_eq!(plan.tile_sizes, [32]);
    assert_eq!(plan.repetitions, 2);
    assert!(
        plan.threads.contains(&1),
        "an omitted key still sweeps every value"
    );
}

#[test]
fn a_flag_replaces_its_config_key_and_nothing_else() {
    let plan = plan_with_config("override", PRESET, &["--sizes", "128,256"])
        .expect("config plan should be valid");
    assert_eq!(plan.sizes, [128, 256]);
    assert_eq!(plan.kernels, [KernelChoice::Tiled]);
    assert_eq!(plan.repetitions, 2);
}

#[test]
fn config_knob_keys_accept_the_blis_alias() {
    let plan = plan_with_config("kc-key", "kernel = [\"packed\"]\nkc = [512]\n", &[])
        .expect("config plan should be valid");
    assert_eq!(plan.depth_blocks, [512]);
}

#[test]
fn a_misspelled_config_key_is_rejected() {
    let error =
        plan_with_config("typo", "size = [64]\n", &[]).expect_err("unknown keys must be rejected");
    assert!(error.contains("unknown field `size`"), "{error}");
}

#[test]
fn an_unknown_kernel_in_a_config_is_rejected() {
    let error = plan_with_config("bad-kernel", "kernel = [\"ijk\"]\n", &[])
        .expect_err("unknown kernel names must be rejected");
    assert!(error.contains("unknown value 'ijk'"), "{error}");
    assert!(error.contains("invalid config '"), "{error}");
}

#[test]
fn an_empty_config_list_is_rejected() {
    let error = plan_with_config("empty", "sizes = []\n", &[])
        .expect_err("an empty dimension must be rejected");
    assert!(
        error.contains("--sizes needs at least one value"),
        "{error}"
    );
}

#[test]
fn a_kernel_named_in_a_config_counts_as_explicit() {
    let error = plan_with_config(
        "idle",
        "kernel = [\"static-ikj\"]\nsizes = [8]\nthreads = [16]\n",
        &[],
    )
    .expect_err("a named kernel with nothing to run must be rejected");
    assert!(
        error.contains("static-ikj needs at least one row per thread"),
        "{error}"
    );
}

/// A preset's knob keys serve whichever kernels sweep them; narrowing
/// --kernel to one that doesn't must not trip over a flag never typed.
#[test]
fn a_preset_knob_key_no_selected_kernel_sweeps_is_ignored() {
    let quick = concat!(env!("CARGO_MANIFEST_DIR"), "/../configs/quick.toml");
    let plan = plan_for("quick-ikj", &["--config", quick, "--kernel", "ikj"])
        .expect("a preset narrowed to ikj should plan");
    assert_eq!(plan.kernels, [KernelChoice::Ikj]);
    assert_eq!(plan.sizes, [64, 256]);
}

#[test]
fn a_config_counts_as_pinning() {
    let cli = Cli::try_parse_from(["gemm-bench", "--config", "configs/quick.toml"])
        .expect("arguments should parse");
    assert!(!cli.is_unpinned());
}

#[test]
fn validate_takes_database_paths_and_needs_one() {
    let cli =
        Cli::try_parse_from(["gemm-bench", "validate", "a.sqlite", "b.sqlite"]).expect("parses");
    assert!(matches!(cli.command, Some(super::Command::Validate { ref dbs }) if dbs.len() == 2));
    assert!(Cli::try_parse_from(["gemm-bench", "validate"]).is_err());
}
