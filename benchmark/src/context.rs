//! Where and when a run happened, captured once before any kernel runs.

use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

/// Written in place of any value a lookup could not determine.
pub(crate) const UNKNOWN: &str = "unknown";

/// Provenance shared by every record of one run.
#[derive(Debug)]
pub(crate) struct RunContext {
    pub(crate) host: String,
    pub(crate) commit: String,
    pub(crate) timestamp: String,
}

/// Looks up the host and commit and reads the clock. Failed lookups become
/// `unknown` so a missing `git` or `hostname` never aborts a benchmark.
pub(crate) fn capture() -> RunContext {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    RunContext {
        host: command_output("hostname", &[])
            .map_or_else(|| UNKNOWN.to_owned(), |raw| short_host(&raw)),
        commit: command_output("git", &["describe", "--always", "--dirty"])
            .unwrap_or_else(|| UNKNOWN.to_owned()),
        timestamp: iso_timestamp(secs),
    }
}

/// Trimmed stdout of a successful command, or `None` if it failed or printed nothing.
pub(crate) fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    let text = stdout.trim();
    (output.status.success() && !text.is_empty()).then(|| text.to_owned())
}

/// `Pauls-MacBook-Pro.local` → `Pauls-MacBook-Pro`: the domain adds nothing
/// to results and would differ between networks.
fn short_host(raw: &str) -> String {
    raw.split('.').next().unwrap_or(raw).to_owned()
}

fn iso_timestamp(secs: u64) -> String {
    let [year, month, day, hour, minute, second] = utc_fields(secs);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Splits Unix seconds into UTC `[year, month, day, hour, minute, second]`,
/// using Howard Hinnant's `civil_from_days`, which avoids a date dependency.
fn utc_fields(secs: u64) -> [u64; 6] {
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    [year, month, day, rem / 3_600, rem % 3_600 / 60, rem % 60]
}

#[cfg(test)]
mod tests {
    use super::{capture, iso_timestamp, short_host};

    #[test]
    fn iso_timestamp_formats_utc_calendar_dates() {
        assert_eq!(iso_timestamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_timestamp(1_709_210_096), "2024-02-29T12:34:56Z");
        assert_eq!(iso_timestamp(2_208_988_800), "2040-01-01T00:00:00Z");
    }

    #[test]
    fn short_host_drops_the_domain() {
        assert_eq!(short_host("Pauls-MacBook-Pro.local"), "Pauls-MacBook-Pro");
        assert_eq!(short_host("build-box"), "build-box");
    }

    #[test]
    fn capture_fills_every_field() {
        let context = capture();
        assert!(!context.host.is_empty());
        assert!(!context.commit.is_empty());
        assert_eq!(context.timestamp.len(), "2026-09-17T12:15:00Z".len());
        assert!(context.timestamp.ends_with('Z'));
    }
}
