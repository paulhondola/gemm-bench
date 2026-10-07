use std::time::{Duration, Instant};

use super::progress::{Ticker, until_next_second};
use super::table::render_results_table;
use crate::benchmark::BenchmarkRecord;
use crate::kernel::Knob;
use indicatif::{ProgressBar, ProgressStyle};

fn record() -> BenchmarkRecord {
    BenchmarkRecord {
        kernel: "rayon-ikj".to_owned(),
        backend: "cpu",
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
        params: Vec::new(),
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
    let wait = |ms| until_next_second(Duration::from_millis(ms));
    assert_eq!(wait(2_300), Duration::from_millis(700));
    assert_eq!(wait(5_000), Duration::from_secs(1));
    assert_eq!(wait(0), Duration::from_secs(1));
}

#[test]
fn dropping_the_ticker_stops_it_without_waiting_for_a_tick() {
    let ticker = Ticker::spawn(ProgressBar::hidden());
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
    let res = ProgressStyle::default_bar().template(
        "{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {pos}/{len} {msg} ({eta})",
    );
    assert!(res.is_ok(), "template error: {:?}", res.err());
}
