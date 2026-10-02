use std::{
    fs::File,
    io::{Seek, SeekFrom},
    sync::mpsc::{self, RecvTimeoutError, Sender},
    thread::{self, JoinHandle},
    time::Duration,
};

use gemm_bench::kernels::Source;
use indicatif::{ProgressBar, ProgressStyle};
use tabled::{
    Table, Tabled,
    settings::{Alignment, Style, object::Columns},
};

use crate::{benchmark::BenchmarkRecord, kernel::Knob};

/// Interactive progress tracker wrapping `indicatif::ProgressBar`.
pub(crate) struct BenchmarkProgress {
    bar: ProgressBar,
    /// `None` when nothing draws: `--no-progress`, or stderr isn't a terminal.
    ticker: Option<Ticker>,
}

impl BenchmarkProgress {
    pub(crate) fn new(total: usize, disabled: bool) -> Self {
        if disabled {
            return Self {
                bar: ProgressBar::hidden(),
                ticker: None,
            };
        }

        let bar = ProgressBar::new(total as u64);
        let style = ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {pos}/{len} {msg} ({eta})")
            .unwrap_or_else(|_| ProgressStyle::default_bar())
            .progress_chars("=>-");

        bar.set_style(style);
        // Without a ticker the elapsed time only redraws between cells, so it
        // freezes for a whole cell.
        let ticker = (!bar.is_hidden()).then(|| Ticker::spawn(bar.clone()));
        Self { bar, ticker }
    }

    pub(crate) fn set_target(
        &self,
        kernel: &str,
        n: usize,
        precision: &str,
        threads: usize,
        knob: Option<(Knob, usize)>,
    ) {
        let knob = knob.map_or_else(String::new, |(knob, value)| {
            format!(" {}={value}", knob.short())
        });
        self.bar.set_message(format!(
            "{kernel:<11} n={n:<4} {precision:<3} t={threads}{knob}"
        ));
    }

    pub(crate) fn step(&self) {
        self.bar.inc(1);
    }

    pub(crate) fn finish(&mut self) {
        // Stopped first: a finished bar always redraws, so a tick after this
        // would draw over the final line.
        self.ticker = None;
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
        self.ticker = None;
        if !self.bar.is_finished() {
            self.bar.finish_with_message("Aborted");
            if !self.bar.is_hidden() {
                eprintln!();
            }
        }
    }
}

/// Redraws the bar just after each whole second of its elapsed time, so the
/// timer counts up by one per redraw. (indicatif's steady tick waits a fixed
/// interval after each redraw instead, so it drifts and now and then skips a
/// second.) It wakes once a second, inside timed regions too; a redraw is
/// ~0.1 ms. Dropping it stops the thread.
struct Ticker {
    stop: Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl Ticker {
    fn spawn(bar: ProgressBar) -> Self {
        let (stop, stopped) = mpsc::channel();
        let thread = thread::spawn(move || {
            // `force_draw` skips indicatif's rate limiter, which could drop a
            // tick that lands just after a burst of fast cells.
            while stopped.recv_timeout(until_next_second(bar.elapsed()))
                == Err(RecvTimeoutError::Timeout)
            {
                bar.force_draw();
            }
        });
        Self {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        // Anything but a timeout ends the thread's wait, so it exits now.
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Time until `elapsed` next reaches a whole second.
fn until_next_second(elapsed: Duration) -> Duration {
    Duration::from_secs(elapsed.as_secs() + 1) - elapsed
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
    knob: String,
    precision: &'a str,
    median_ms: String,
    stddev_ms: String,
    gpu_ms: String,
    setup_ms: String,
    gops: String,
    err_f64: String,
}

fn render_results_table(records: &[BenchmarkRecord]) -> String {
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

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::render_results_table;
    use crate::benchmark::BenchmarkRecord;
    use crate::kernel::Knob;
    use indicatif::{ProgressBar, ProgressStyle};

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
            gpu_ms: None,
            setup_ms: 0.05,
            block_size: None,
            params: Vec::new(),
            repetitions: 5,
            host: "test-host".to_owned(),
            commit: "abc1234".to_owned(),
            timestamp: "2026-09-17T12:15:00Z".to_owned(),
        }
    }

    #[test]
    fn terminal_table_uses_schema_headers_and_compact_float_precision() {
        let mps = BenchmarkRecord {
            kernel: "mps".to_owned(),
            backend: "metal",
            gpu_ms: Some(10.5),
            ..record()
        };
        let table = render_results_table(&[record(), mps]);

        assert!(table.contains("gpu_ms"));
        assert!(table.contains("10.500"));
        assert!(table.contains("setup_ms"));
        assert!(table.contains("0.050"));
        assert!(table.contains("kernel"));
        assert!(table.contains("precision"));
        assert!(table.contains("f32"));
        assert!(table.contains("median_ms"));
        assert!(table.contains("stddev_ms"));
        assert!(table.contains("gops"));
        assert!(table.contains("knob"));
        let tiled = BenchmarkRecord {
            kernel: "tiled".to_owned(),
            params: vec![gemm_bench::kernels::Param::swept("tile_size", 64)],
            ..record()
        };
        assert!(render_results_table(&[tiled]).contains("tile_size=64"));
        assert!(table.contains("0.250"));
        assert!(table.contains("rayon-ikj"));
        assert!(table.contains("12.346"));
        assert!(table.contains("2.500"));
        assert!(table.contains("err_f64"));
        assert!(table.contains("1.2e-3"));
    }

    #[test]
    fn ticker_waits_until_the_next_whole_second() {
        let wait = |ms| super::until_next_second(Duration::from_millis(ms));
        assert_eq!(wait(2_300), Duration::from_millis(700));
        assert_eq!(wait(5_000), Duration::from_secs(1));
        assert_eq!(wait(0), Duration::from_secs(1));
    }

    #[test]
    fn dropping_the_ticker_stops_it_without_waiting_for_a_tick() {
        let ticker = super::Ticker::spawn(ProgressBar::hidden());
        let start = Instant::now();
        drop(ticker);
        assert!(start.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn progress_bar_lifecycle_disabled() {
        let mut progress = super::BenchmarkProgress::new(5, true);
        progress.set_target("naive", 64, "f32", 1, None);
        progress.set_target("tiled", 64, "f32", 1, Some((Knob::TileSize, 64)));
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
        let mps = BenchmarkRecord {
            kernel: "mps".to_owned(),
            backend: "metal",
            device: "Test GPU".to_owned(),
            threads: 1,
            gpu_ms: Some(10.5),
            ..record()
        };

        super::write_records(csv_file, &[record(), tiled, mps]).expect("write records");

        let csv_content = std::fs::read_to_string(&csv_path).expect("read csv");
        // Kernels that don't tile leave block_size empty, and kernels off Metal
        // leave gpu_ms empty; the others record them.
        assert_eq!(
            csv_content,
            "kernel,backend,device,precision,n,threads,gops,mean_rel_error_f64,median_ms,min_ms,stddev_ms,gpu_ms,setup_ms,block_size,repetitions,host,commit,timestamp\n\
             rayon-ikj,cpu,Test CPU,f32,256,4,2.5,0.001234,12.34567,12.0,0.25,,0.05,,5,test-host,abc1234,2026-09-17T12:15:00Z\n\
             tiled,cpu,Test CPU,f32,256,4,2.5,0.001234,12.34567,12.0,0.25,,0.05,64,5,test-host,abc1234,2026-09-17T12:15:00Z\n\
             mps,metal,Test GPU,f32,256,1,2.5,0.001234,12.34567,12.0,0.25,10.5,0.05,,5,test-host,abc1234,2026-09-17T12:15:00Z\n"
        );
        let _ = std::fs::remove_file(csv_path);
    }
}
