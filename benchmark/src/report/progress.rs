use std::{
    sync::mpsc::{self, RecvTimeoutError, Sender},
    thread::{self, JoinHandle},
    time::Duration,
};

use indicatif::{ProgressBar, ProgressStyle};

use crate::kernel::Knob;

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
pub(crate) struct Ticker {
    stop: Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl Ticker {
    pub(crate) fn spawn(bar: ProgressBar) -> Self {
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
pub(crate) fn until_next_second(elapsed: Duration) -> Duration {
    Duration::from_secs(elapsed.as_secs() + 1) - elapsed
}
