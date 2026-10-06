use gemm_bench::kernels::Source;
use tabled::{
    Table, Tabled,
    settings::{Alignment, Style, object::Columns},
};

use crate::benchmark::BenchmarkRecord;

/// Renders the human-facing view after all timed work is complete.
pub(crate) fn print_results_table(records: &[BenchmarkRecord]) {
    println!("{}", render_results_table(records));
}

/// Presentation-only view: the database keeps the full-precision values of
/// `BenchmarkRecord`, while the terminal stays compact and easy to scan.
#[derive(Tabled)]
struct TerminalBenchmarkRecord<'a> {
    kernel: &'a str,
    n: usize,
    threads: usize,
    knob: String,
    precision: &'a str,
    median_ms: String,
    stddev_ms: String,
    gpu_ms: String,
    setup_ms: String,
    gops: String,
    err_f64: String,
}

pub(crate) fn render_results_table(records: &[BenchmarkRecord]) -> String {
    let rows = records.iter().map(|record| TerminalBenchmarkRecord {
        kernel: &record.kernel,
        n: record.n,
        threads: record.threads,
        knob: record
            .params
            .iter()
            .find(|p| p.source == Source::Swept)
            .map_or_else(|| "-".to_owned(), |p| format!("{}={}", p.name, p.value)),
        precision: record.precision,
        median_ms: format!("{:.3}", record.median_ms),
        stddev_ms: format!("{:.3}", record.stddev_ms),
        gpu_ms: record
            .gpu_ms
            .map_or_else(|| "-".to_owned(), |ms| format!("{ms:.3}")),
        setup_ms: format!("{:.3}", record.setup_ms),
        gops: format!("{:.3}", record.gops),
        err_f64: format!("{:.1e}", record.mean_rel_error_f64),
    });
    let mut table = Table::new(rows);
    table.with(Style::psql());
    table.modify(Columns::new(1..), Alignment::right());
    table.to_string()
}
