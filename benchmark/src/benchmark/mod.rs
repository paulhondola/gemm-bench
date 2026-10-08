mod accuracy;
mod measure;
mod record;
mod stats;

#[cfg(test)]
mod tests;

pub(crate) use accuracy::{
    benchmark_inputs, f64_reference, max_relative_error, mean_relative_error, tolerance,
};
pub(crate) use measure::measure;
pub(crate) use record::BenchmarkRecord;
pub(crate) use stats::summarize;

use gemm_bench::{Element, GemmKernel, Matrix, kernels::IkjGemm};

use crate::{kernel::Precision, plan::BenchmarkPlan, report::BenchmarkProgress};

pub(crate) fn run(
    plan: &BenchmarkPlan,
) -> Result<Vec<BenchmarkRecord>, Box<dyn std::error::Error>> {
    let mut records = Vec::new();
    let mut progress = BenchmarkProgress::new(plan.total_configurations(), plan.no_progress);

    // Each arm monomorphizes the whole sweep, so kernels compile to native
    // arithmetic for that precision with no per-element dispatch.
    for &precision in &plan.precisions {
        match precision {
            Precision::F16 => run_precision::<f16>(plan, precision, &progress, &mut records)?,
            Precision::F32 => run_precision::<f32>(plan, precision, &progress, &mut records)?,
            Precision::F64 => run_precision::<f64>(plan, precision, &progress, &mut records)?,
            Precision::I32 => run_precision::<i32>(plan, precision, &progress, &mut records)?,
            Precision::I64 => run_precision::<i64>(plan, precision, &progress, &mut records)?,
        }
    }

    progress.finish();
    Ok(records)
}

fn run_precision<T: Element>(
    plan: &BenchmarkPlan,
    precision: Precision,
    progress: &BenchmarkProgress,
    records: &mut Vec<BenchmarkRecord>,
) -> Result<(), Box<dyn std::error::Error>> {
    for &n in &plan.sizes {
        if plan
            .kernels
            .iter()
            .all(|&k| plan.cells(k, precision, n).is_empty())
        {
            continue;
        }
        let (lhs, rhs) = benchmark_inputs::<T>(n);
        let mut output = Matrix::zeros(n, n);
        let mut reference = Matrix::zeros(n, n);
        IkjGemm.compute(&lhs, &rhs, &mut reference);
        // ponytail: for T = f64 this repeats `reference` (~12 s at n=4096);
        // special-case it only if that shows up next to the timed work.
        let truth = f64_reference(&lhs, &rhs);
        let tolerance = tolerance::<T>(n);

        for kernel in plan.kernels.iter().copied() {
            for (thread_count, knob) in plan.cells(kernel, precision, n) {
                progress.set_target(
                    kernel.label(),
                    n,
                    precision.label(),
                    thread_count,
                    kernel.knob().zip(knob),
                );
                // A kernel that wrote nothing must not pass on the previous
                // kernel's output.
                output.as_mut_slice().fill(T::default());
                let samples = measure(
                    kernel,
                    thread_count,
                    knob,
                    plan.repetitions,
                    &lhs,
                    &rhs,
                    &mut output,
                )?;
                progress.step();

                // Checked after timing, against the last timed run's output.
                // Within tolerance of either the ikj reference or the f64
                // truth: past n ~ 13k the f16 reference itself drifts further
                // than the sqrt(n) slack, failing kernels more accurate than it.
                let error = max_relative_error(&output, &reference)
                    .min(max_relative_error(&output, &truth));
                if error > tolerance {
                    let knob_text = kernel
                        .knob()
                        .zip(knob)
                        .map_or_else(String::new, |(k, v)| format!(", {} {v}", k.name()));
                    return Err(format!(
                        "{} produced wrong output at n={n}, precision {}, threads {thread_count}{knob_text}: \
                         max relative error {error:e} exceeds tolerance {tolerance:e}",
                        kernel.label(),
                        precision.label(),
                    )
                    .into());
                }

                let stats = summarize(&samples.timed);
                let gpu_ms = samples.gpu.as_deref().map(|gpu| summarize(gpu).median_ms);
                records.push(BenchmarkRecord {
                    kernel: kernel.label().to_owned(),
                    backend: kernel.backend(),
                    precision: precision.label(),
                    n,
                    threads: thread_count,
                    gops: 2.0 * (n as f64).powi(3) / (stats.median_ms / 1_000.0) / 1e9,
                    mean_rel_error_f64: mean_relative_error(&output, &truth),
                    median_ms: stats.median_ms,
                    min_ms: stats.min_ms,
                    stddev_ms: stats.stddev_ms,
                    gpu_ms,
                    setup_ms: samples.setup.as_secs_f64() * 1_000.0,
                    params: samples.params,
                });
            }
        }
    }

    Ok(())
}
