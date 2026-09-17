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
    pub(crate) file_stamp: String,
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
        file_stamp: file_stamp(secs),
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

/// The same instant as `iso_timestamp`, without separators, for filenames:
/// colons are invalid on Windows, and this still sorts chronologically.
fn file_stamp(secs: u64) -> String {
    let [year, month, day, hour, minute, second] = utc_fields(secs);
    format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}Z")
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

/// The CPU model, e.g. `Apple M1 Pro` or `AMD Ryzen 9 7950X 16-Core Processor`.
pub(crate) fn cpu_name() -> String {
    #[cfg(target_os = "macos")]
    let name = command_output("sysctl", &["-n", "machdep.cpu.brand_string"]);
    #[cfg(target_os = "linux")]
    let name = std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|cpuinfo| parse_cpu_model(&cpuinfo));
    // ponytail: Windows and other targets report `unknown`; use `sysinfo` once a contributor needs them.
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let name: Option<String> = None;
    name.unwrap_or_else(|| UNKNOWN.to_owned())
}

/// The first `model name` line of `/proc/cpuinfo`. ARM kernels often omit it.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_cpu_model(cpuinfo: &str) -> Option<String> {
    cpuinfo.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "model name").then(|| value.trim().to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::{capture, cpu_name, file_stamp, iso_timestamp, parse_cpu_model, short_host};

    #[test]
    fn iso_timestamp_formats_utc_calendar_dates() {
        assert_eq!(iso_timestamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_timestamp(1_709_210_096), "2024-02-29T12:34:56Z");
        assert_eq!(iso_timestamp(2_208_988_800), "2040-01-01T00:00:00Z");
    }

    #[test]
    fn file_stamp_is_a_compact_sortable_utc_instant() {
        assert_eq!(file_stamp(0), "19700101T000000Z");
        assert_eq!(file_stamp(1_709_210_096), "20240229T123456Z");
        assert_eq!(file_stamp(2_208_988_800), "20400101T000000Z");
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
        assert_eq!(context.file_stamp.len(), "20260917T121500Z".len());
    }

    #[test]
    fn parse_cpu_model_reads_the_x86_model_name() {
        let cpuinfo = "processor\t: 0\nvendor_id\t: AuthenticAMD\nmodel name\t: AMD Ryzen 9 7950X 16-Core Processor\n";
        assert_eq!(
            parse_cpu_model(cpuinfo).as_deref(),
            Some("AMD Ryzen 9 7950X 16-Core Processor")
        );
    }

    #[test]
    fn parse_cpu_model_is_none_when_arm_cpuinfo_lacks_a_model_name() {
        let cpuinfo = "processor\t: 0\nBogoMIPS\t: 48.00\nCPU implementer\t: 0x41\n";
        assert_eq!(parse_cpu_model(cpuinfo), None);
    }

    #[test]
    fn cpu_name_is_never_empty() {
        assert!(!cpu_name().is_empty());
    }
}
