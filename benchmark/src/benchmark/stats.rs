use std::time::Duration;

/// Timing summary of one configuration's samples, in milliseconds.
pub(crate) struct TimingStats {
    pub(crate) median_ms: f64,
    pub(crate) min_ms: f64,
    pub(crate) stddev_ms: f64,
}

/// Median, minimum, and sample standard deviation (zero for a single sample).
pub(crate) fn summarize(samples: &[Duration]) -> TimingStats {
    assert!(
        !samples.is_empty(),
        "at least one timing sample is required"
    );
    let mut sorted: Vec<f64> = samples.iter().map(|d| d.as_secs_f64() * 1_000.0).collect();
    sorted.sort_by(f64::total_cmp);

    let len = sorted.len();
    let median_ms = if len % 2 == 1 {
        sorted[len / 2]
    } else {
        (sorted[len / 2 - 1] + sorted[len / 2]) / 2.0
    };
    let stddev_ms = if len == 1 {
        0.0
    } else {
        let mean = sorted.iter().sum::<f64>() / len as f64;
        let variance = sorted.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (len - 1) as f64;
        variance.sqrt()
    };

    TimingStats {
        median_ms,
        min_ms: sorted[0],
        stddev_ms,
    }
}
