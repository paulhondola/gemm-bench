use std::time::Duration;

use clap::{Parser, ValueEnum};
use gemm_bench::Matrix;

use gemm_bench::{
    Element, GemmKernel,
    kernels::{IkjGemm, Param, Source},
};

use super::{
    BenchmarkRecord, benchmark_inputs, f64_reference, max_relative_error, mean_relative_error,
    measure, run, summarize, tolerance,
};
use crate::{
    cli::Cli,
    db,
    kernel::{KernelChoice, Precision},
    validate,
};

fn ms(values: &[u64]) -> Vec<Duration> {
    values.iter().map(|&v| Duration::from_millis(v)).collect()
}

#[test]
fn summarize_odd_sample_count_uses_middle_value() {
    let stats = summarize(&ms(&[30, 10, 20]));
    assert_eq!(stats.median_ms, 20.0);
    assert_eq!(stats.min_ms, 10.0);
    assert!((stats.stddev_ms - 10.0).abs() < 1e-9);
}

#[test]
fn summarize_even_sample_count_averages_middle_values() {
    let stats = summarize(&ms(&[40, 10, 20, 30]));
    assert_eq!(stats.median_ms, 25.0);
    assert_eq!(stats.min_ms, 10.0);
}

#[test]
fn summarize_single_sample_has_zero_stddev() {
    let stats = summarize(&ms(&[7]));
    assert_eq!(
        (stats.median_ms, stats.min_ms, stats.stddev_ms),
        (7.0, 7.0, 0.0)
    );
}

#[test]
fn identical_outputs_have_zero_error() {
    let reference = Matrix::from_vec(1, 2, vec![1.0_f32, 2.0]);
    assert_eq!(max_relative_error(&reference.clone(), &reference), 0.0);
}

#[test]
fn relative_error_reports_the_worst_element() {
    let reference = Matrix::from_vec(1, 2, vec![100.0_f64, 2.0]);
    let output = Matrix::from_vec(1, 2, vec![101.0_f64, 2.1]);
    assert!((max_relative_error(&output, &reference) - 0.05).abs() < 1e-12);
}

#[test]
fn nan_output_is_an_infinite_error() {
    let reference = Matrix::from_vec(1, 2, vec![1.0_f32, 2.0]);
    let output = Matrix::from_vec(1, 2, vec![f32::NAN, 2.0]);
    assert_eq!(max_relative_error(&output, &reference), f64::INFINITY);
}

#[test]
fn tolerance_scales_with_sqrt_n_and_precision() {
    assert_eq!(tolerance::<f64>(16), 16.0 * f64::EPSILON);
    assert!(tolerance::<f16>(4096) > tolerance::<f32>(4096));
    assert_eq!(tolerance::<i32>(4096), 0.0);
    assert_eq!(tolerance::<i64>(4096), 0.0);
}

#[test]
fn identical_output_has_zero_mean_error() {
    let truth = Matrix::from_vec(1, 2, vec![1.0_f64, 2.0]);
    let output = Matrix::from_vec(1, 2, vec![1.0_f32, 2.0]);
    assert_eq!(mean_relative_error(&output, &truth), 0.0);
}

#[test]
fn mean_error_averages_over_every_element() {
    let truth = Matrix::from_vec(1, 2, vec![100.0_f64, 2.0]);
    let output = Matrix::from_vec(1, 2, vec![101.0_f32, 2.0]);
    // (0.01 + 0) / 2
    assert!((mean_relative_error(&output, &truth) - 0.005).abs() < 1e-12);
}

#[test]
fn nan_output_is_an_infinite_mean_error() {
    let truth = Matrix::from_vec(1, 2, vec![1.0_f64, 2.0]);
    let output = Matrix::from_vec(1, 2, vec![f32::NAN, 2.0]);
    assert_eq!(mean_relative_error(&output, &truth), f64::INFINITY);
}

fn ikj_error_vs_f64<T: gemm_bench::Element>(n: usize) -> f64 {
    let (lhs, rhs) = benchmark_inputs::<T>(n);
    let mut output = Matrix::zeros(n, n);
    IkjGemm.compute(&lhs, &rhs, &mut output);
    mean_relative_error(&output, &f64_reference(&lhs, &rhs))
}

#[test]
fn error_vs_f64_orders_precisions_by_mantissa_width() {
    let n = 64;
    let (f16, f32, f64) = (
        ikj_error_vs_f64::<f16>(n),
        ikj_error_vs_f64::<f32>(n),
        ikj_error_vs_f64::<f64>(n),
    );
    assert!(f16 > f32 && f32 > 0.0, "f16 {f16:e}, f32 {f32:e}");
    // The reference widens the kernel's own inputs, so f64 and exact
    // integer products match it bit for bit.
    assert_eq!(f64, 0.0);
    assert_eq!(ikj_error_vs_f64::<i32>(n), 0.0);
    assert_eq!(ikj_error_vs_f64::<i64>(n), 0.0);
}

#[test]
fn integer_inputs_are_not_truncated_to_zero() {
    let (lhs, rhs) = benchmark_inputs::<i32>(8);
    assert!(lhs.as_slice().iter().any(|&value| value != 0));
    assert!(rhs.as_slice().iter().any(|&value| value != 0));
}

#[test]
fn cpu_kernels_have_a_setup_time_and_no_gpu_window() {
    let (lhs, rhs) = benchmark_inputs::<f32>(8);
    let mut output = Matrix::zeros(8, 8);
    let samples = measure(KernelChoice::RayonIkj, 2, None, 2, &lhs, &rhs, &mut output)
        .expect("rayon-ikj should run");
    assert_eq!(samples.timed.len(), 2);
    assert!(samples.gpu.is_none());
    // Building a two-worker pool spawns threads, which takes measurable time.
    assert!(samples.setup > Duration::ZERO);
}

#[cfg(target_os = "macos")]
#[test]
fn metal_kernels_time_the_round_trip_the_gpu_window_and_setup() {
    let (lhs, rhs) = benchmark_inputs::<f32>(8);
    let mut output = Matrix::zeros(8, 8);
    let samples =
        measure(KernelChoice::Mps, 1, None, 2, &lhs, &rhs, &mut output).expect("mps should run");
    let gpu = samples.gpu.expect("a Metal kernel records its GPU window");
    assert_eq!((samples.timed.len(), gpu.len()), (2, 2));
    // `timed` is the round trip, and the GPU window sits inside it.
    assert!(gpu.iter().zip(&samples.timed).all(|(gpu, e2e)| gpu <= e2e));
    assert!(samples.setup > Duration::ZERO);
}

#[test]
fn a_measurement_carries_the_params_its_kernel_reports() {
    let (lhs, rhs) = benchmark_inputs::<f32>(64);
    let mut output = Matrix::zeros(64, 64);
    let tiled =
        measure(KernelChoice::Tiled, 1, Some(16), 1, &lhs, &rhs, &mut output).expect("tiled runs");
    assert_eq!(tiled.params, [Param::swept("tile_size", 16)]);
    // Asked inside its own 2-worker pool: 8 tasks of 8 rows. Asked on
    // the global pool it would plan 4 tasks per core of this machine.
    let rayon = measure(
        KernelChoice::RayonTiled,
        2,
        Some(16),
        1,
        &lhs,
        &rhs,
        &mut output,
    )
    .expect("rayon-tiled runs");
    assert!(
        rayon.params.contains(&Param::derived("tasks", 8)),
        "{:?}",
        rayon.params
    );
    assert!(rayon.params.contains(&Param::derived("rows_per_task", 8)));
    let ikj = measure(KernelChoice::Ikj, 1, None, 1, &lhs, &rhs, &mut output).expect("ikj runs");
    assert!(ikj.params.is_empty());
}

/// One real run of `kernel` at n = 8, planned, written and validated as
/// `main` and CI do: this machine's real capture, through `write_run`
/// and `validate` (on CI, the Linux capture path).
fn run_one(kernel: &str) -> Vec<BenchmarkRecord> {
    let root = std::env::temp_dir().join(format!(
        "gemm-bench-run-test-{}-{kernel}",
        std::process::id()
    ));
    let output = root.join("data/db/test/run.sqlite");
    let mut plan = Cli::try_parse_from([
        "gemm-bench",
        "--output",
        output.to_str().expect("temp paths are UTF-8"),
        "--sizes",
        "8",
        "--kernel",
        kernel,
        "--threads",
        "1",
        "--precision",
        "f32",
        "--repetitions",
        "2",
        "--no-progress",
    ])
    .expect("arguments should parse")
    .into_plan()
    .expect("the plan should be valid");
    let records = run(&plan).expect("the run should succeed");
    db::write_run(
        &mut plan.db,
        &plan.context,
        plan.repetitions,
        &plan.machine,
        &records,
    )
    .expect("the run should be written");
    let verdict = validate::validate(&output);
    let _ = std::fs::remove_dir_all(root);
    verdict.expect("the written DB should pass validate");
    records
}

#[test]
fn a_cpu_measurement_writes_one_record_without_gpu_ms() {
    let records = run_one("ikj");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].kernel, "ikj");
    assert_eq!(records[0].gpu_ms, None);
    assert!(records[0].setup_ms >= 0.0);
}

#[cfg(target_os = "macos")]
#[test]
fn a_metal_measurement_writes_one_end_to_end_record_with_gpu_ms() {
    let records = run_one("mps");
    assert_eq!(records.len(), 1, "no separate -e2e record");
    let record = &records[0];
    assert_eq!(record.kernel, "mps");
    let gpu_ms = record.gpu_ms.expect("Metal records carry gpu_ms");
    // Each GPU window sits inside its round trip, so the medians keep that order.
    assert!(gpu_ms <= record.median_ms);
    // gops comes from the round trip, like every CPU row.
    let expected = 2.0 * 8f64.powi(3) / (record.median_ms / 1_000.0) / 1e9;
    assert!((record.gops - expected).abs() <= 1e-9 * expected);
    assert!(record.setup_ms > 0.0);
}

/// The params one real measurement of `kernel` reports, at 2 threads and
/// its knob's smallest default value.
fn params_at(kernel: KernelChoice, precision: Precision, n: usize) -> Vec<Param> {
    fn at<T: Element>(kernel: KernelChoice, n: usize) -> Vec<Param> {
        let (lhs, rhs) = benchmark_inputs::<T>(n);
        let mut output = Matrix::zeros(n, n);
        let knob = kernel.knob().map(|knob| knob.defaults()[0]);
        measure(kernel, 2, knob, 1, &lhs, &rhs, &mut output)
            .expect("the kernel should run")
            .params
    }
    match precision {
        Precision::F16 => at::<f16>(kernel, n),
        Precision::F32 => at::<f32>(kernel, n),
        Precision::F64 => at::<f64>(kernel, n),
        Precision::I32 => at::<i32>(kernel, n),
        Precision::I64 => at::<i64>(kernel, n),
    }
}

/// `validate` trusts `declared_params` for DBs it never saw being written,
/// so every kernel must report exactly what it declares.
#[test]
fn every_kernel_records_exactly_the_params_it_declares() {
    for &kernel in KernelChoice::value_variants() {
        #[cfg(target_os = "macos")]
        if kernel == KernelChoice::AccelerateBnns
            && gemm_bench::kernels::AccelerateBnnsGemm::<f32>::new(1).is_none()
        {
            continue; // needs macOS 26 / disabled in CI
        }
        for &precision in Precision::value_variants() {
            if !kernel.supports(precision) {
                continue;
            }
            for n in [8, 33] {
                let mut recorded: Vec<(&str, Source)> = params_at(kernel, precision, n)
                    .iter()
                    .map(|p| (p.name, p.source))
                    .collect();
                recorded.sort_unstable_by_key(|&(name, _)| name);
                assert_eq!(
                    recorded,
                    kernel.declared_params(),
                    "{} at {} with n = {n}",
                    kernel.label(),
                    precision.label()
                );
            }
        }
    }
}
