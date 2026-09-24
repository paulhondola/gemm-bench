use std::{
    fs::File,
    io::{Seek, SeekFrom},
};

use indicatif::{ProgressBar, ProgressStyle};
use tabled::{
    Table, Tabled,
    settings::{Alignment, Style, object::Columns},
};

use crate::benchmark::BenchmarkRecord;

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
        // No steady tick: its redraw thread would wake inside timed regions.
        // The bar redraws on set_target/step, between cells.
        Self { bar }
    }

    pub(crate) fn set_target(
        &self,
        kernel: &str,
        n: usize,
        precision: &str,
        threads: usize,
        block_size: Option<usize>,
    ) {
        let block = block_size.map_or_else(String::new, |b| format!(" b={b}"));
        self.bar.set_message(format!(
            "{kernel:<11} n={n:<4} {precision:<3} t={threads}{block}"
        ));
    }

    pub(crate) fn step(&self) {
        self.bar.inc(1);
    }

    pub(crate) fn finish(&self) {
        if self.bar.is_hidden() {
            return;
        }
        let finish_style = ProgressStyle::default_bar()
            .template(
                "{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {pos}/{len} {msg}",
            )
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
    mut csv_file: File,
    records: &[BenchmarkRecord],
) -> Result<(), Box<dyn std::error::Error>> {
    csv_file.set_len(0)?;
    csv_file.seek(SeekFrom::Start(0))?;
    let mut writer = csv::Writer::from_writer(csv_file);
    for record in records {
        writer.serialize(record)?;
    }
    writer.flush()?;
    Ok(())
}

/// Presentation-only view: benchmark files retain the full precision values
/// in `BenchmarkRecord`, while the terminal stays compact and easy to scan.
#[derive(Tabled)]
struct TerminalBenchmarkRecord<'a> {
    kernel: &'a str,
    n: usize,
    threads: usize,
    block: String,
    precision: &'a str,
    median_ms: String,
    stddev_ms: String,
    gops: String,
    err_f64: String,
}

fn render_results_table(records: &[BenchmarkRecord]) -> String {
    let rows = records.iter().map(|record| TerminalBenchmarkRecord {
        kernel: &record.kernel,
        n: record.n,
        threads: record.threads,
        block: record
            .block_size
            .map_or_else(|| "-".to_owned(), |b| b.to_string()),
        precision: record.precision,
        median_ms: format!("{:.3}", record.median_ms),
        stddev_ms: format!("{:.3}", record.stddev_ms),
        gops: format!("{:.3}", record.gops),
        err_f64: format!("{:.1e}", record.mean_rel_error_f64),
    });
    let mut table = Table::new(rows);
    table.with(Style::psql());
    table.modify(Columns::new(1..), Alignment::right());
    table.to_string()
}

#[cfg(test)]
mod tests {
    use super::render_results_table;
    use crate::benchmark::BenchmarkRecord;
    use indicatif::ProgressStyle;

    fn record() -> BenchmarkRecord {
        BenchmarkRecord {
            kernel: "rayon-ikj".to_owned(),
            backend: "cpu",
            device: "Test CPU".to_owned(),
            precision: "f32",
            n: 256,
            threads: 4,
            gops: 2.5,
            mean_rel_error_f64: 0.001_234,
            median_ms: 12.345_67,
            min_ms: 12.0,
            stddev_ms: 0.25,
            block_size: None,
            repetitions: 5,
            host: "test-host".to_owned(),
            commit: "abc1234".to_owned(),
            timestamp: "2026-09-17T12:15:00Z".to_owned(),
        }
    }

    #[test]
    fn terminal_table_uses_schema_headers_and_compact_float_precision() {
        let table = render_results_table(&[record()]);

        assert!(table.contains("kernel"));
        assert!(table.contains("precision"));
        assert!(table.contains("f32"));
        assert!(table.contains("median_ms"));
        assert!(table.contains("stddev_ms"));
        assert!(table.contains("gops"));
        assert!(table.contains("block"));
        assert!(table.contains("0.250"));
        assert!(table.contains("rayon-ikj"));
        assert!(table.contains("12.346"));
        assert!(table.contains("2.500"));
        assert!(table.contains("err_f64"));
        assert!(table.contains("1.2e-3"));
    }

    #[test]
    fn progress_bar_lifecycle_disabled() {
        let progress = super::BenchmarkProgress::new(5, true);
        progress.set_target("naive", 64, "f32", 1, None);
        progress.set_target("tiled", 64, "f32", 1, Some(64));
        progress.step();
        progress.finish();
    }

    #[test]
    fn template_compilation() {
        let res = ProgressStyle::default_bar().template("{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {pos}/{len} {msg} ({eta})");
        assert!(res.is_ok(), "template error: {:?}", res.err());
    }

    #[test]
    fn write_records_outputs_csv_in_schema_order() {
        let csv_path =
            std::env::temp_dir().join(format!("gemm-bench-report-test-{}.csv", std::process::id()));
        let csv_file = std::fs::File::create(&csv_path).expect("create csv file");
        let tiled = BenchmarkRecord {
            kernel: "tiled".to_owned(),
            block_size: Some(64),
            ..record()
        };

        super::write_records(csv_file, &[record(), tiled]).expect("write records");

        let csv_content = std::fs::read_to_string(&csv_path).expect("read csv");
        // Kernels that don't tile leave block_size empty; tiled ones record it.
        assert_eq!(
            csv_content,
            "kernel,backend,device,precision,n,threads,gops,mean_rel_error_f64,median_ms,min_ms,stddev_ms,block_size,repetitions,host,commit,timestamp\n\
             rayon-ikj,cpu,Test CPU,f32,256,4,2.5,0.001234,12.34567,12.0,0.25,,5,test-host,abc1234,2026-09-17T12:15:00Z\n\
             tiled,cpu,Test CPU,f32,256,4,2.5,0.001234,12.34567,12.0,0.25,64,5,test-host,abc1234,2026-09-17T12:15:00Z\n"
        );
        let _ = std::fs::remove_file(csv_path);
    }
}
