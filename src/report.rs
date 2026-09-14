use std::{fs::File, time::Duration};

use indicatif::{ProgressBar, ProgressStyle};
use tabled::{
    Table, Tabled,
    settings::{Alignment, Style, object::Columns},
};

use crate::{benchmark::BenchmarkRecord, cli::OutputFormat};

/// Interactive progress tracker wrapping `indicatif::ProgressBar`.
pub(crate) struct BenchmarkProgress {
    bar: ProgressBar,
}

impl BenchmarkProgress {
    pub(crate) fn new(total: usize, disabled: bool) -> Self {
        if disabled {
            return Self {
                bar: ProgressBar::hidden(),
            };
        }

        let bar = ProgressBar::new(total as u64);
        let style = ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {pos}/{len} {msg} ({eta})")
            .unwrap_or_else(|_| ProgressStyle::default_bar())
            .progress_chars("=>-");

        bar.set_style(style);
        bar.enable_steady_tick(Duration::from_millis(80));
        Self { bar }
    }

    pub(crate) fn set_target(&self, kernel: &str, n: usize, precision: &str, threads: usize) {
        self.bar
            .set_message(format!("{kernel:<11} n={n:<4} {precision:<3} t={threads}"));
    }

    pub(crate) fn step(&self) {
        self.bar.inc(1);
    }

    pub(crate) fn finish(&self) {
        if self.bar.is_hidden() {
            return;
        }
        let finish_style = ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {pos}/{len} {msg}")
            .unwrap_or_else(|_| ProgressStyle::default_bar())
            .progress_chars("=>-");
        self.bar.set_style(finish_style);
        self.bar.finish_with_message("Complete");
        eprintln!();
    }
}

impl Drop for BenchmarkProgress {
    fn drop(&mut self) {
        if !self.bar.is_finished() {
            self.bar.finish_with_message("Aborted");
            if !self.bar.is_hidden() {
                eprintln!();
            }
        }
    }
}

/// Renders the human-facing view after all timed work is complete.
pub(crate) fn print_results_table(records: &[BenchmarkRecord]) {
    println!("{}", render_results_table(records));
}

/// Writes into the output file that `Cli::into_plan` opened before the sweep.
/// Truncation happens only now, so a failed run leaves earlier results intact.
pub(crate) fn write_records(
    file: File,
    format: OutputFormat,
    records: &[BenchmarkRecord],
) -> Result<(), Box<dyn std::error::Error>> {
    file.set_len(0)?;
    match format {
        OutputFormat::Csv => {
            let mut writer = csv::Writer::from_writer(file);
            for record in records {
                writer.serialize(record)?;
            }
            writer.flush()?;
        }
        OutputFormat::Json => serde_json::to_writer_pretty(file, records)?,
    }
    Ok(())
}

/// Presentation-only view: benchmark files retain the full precision values
/// in `BenchmarkRecord`, while the terminal stays compact and easy to scan.
#[derive(Tabled)]
struct TerminalBenchmarkRecord<'a> {
    kernel: &'a str,
    n: usize,
    threads: usize,
    precision: &'a str,
    elapsed_ms: String,
    gflops: String,
}

fn render_results_table(records: &[BenchmarkRecord]) -> String {
    let rows = records.iter().map(|record| TerminalBenchmarkRecord {
        kernel: &record.kernel,
        n: record.n,
        threads: record.threads,
        precision: record.precision,
        elapsed_ms: format!("{:.3}", record.elapsed_ms),
        gflops: format!("{:.3}", record.gflops),
    });
    let mut table = Table::new(rows);
    table.with(Style::psql());
    table.modify(Columns::new(1..), Alignment::right());
    table.to_string()
}

#[cfg(test)]
mod tests {
    use indicatif::ProgressStyle;
    use super::render_results_table;
    use crate::benchmark::BenchmarkRecord;

    #[test]
    fn terminal_table_uses_schema_headers_and_compact_float_precision() {
        let table = render_results_table(&[BenchmarkRecord {
            kernel: "rayon-ikj".to_owned(),
            n: 256,
            threads: 4,
            precision: "f32",
            elapsed_ms: 12.345_67,
            gflops: 2.5,
        }]);

        assert!(table.contains("kernel"));
        assert!(table.contains("precision"));
        assert!(table.contains("f32"));
        assert!(table.contains("elapsed_ms"));
        assert!(table.contains("rayon-ikj"));
        assert!(table.contains("12.346"));
        assert!(table.contains("2.500"));
    }

    #[test]
    fn progress_bar_lifecycle_disabled() {
        let progress = super::BenchmarkProgress::new(5, true);
        progress.set_target("naive", 64, "f32", 1);
        progress.step();
        progress.finish();
    }

    #[test]
    fn template_compilation() {
        let res = ProgressStyle::default_bar().template("{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {pos}/{len} {msg} ({eta})");
        assert!(res.is_ok(), "template error: {:?}", res.err());
    }
}
