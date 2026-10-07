use clap::ValueEnum;

use crate::kernel::{KernelChoice, Knob, Precision};

/// Checks the resolved values, so config keys get the same checks as flags.
pub(crate) fn validate_values(
    sizes: &[usize],
    threads: &[usize],
    kernels: &[KernelChoice],
    precisions: &[Precision],
    tile_sizes: &[usize],
    depth_blocks: &[usize],
    repetitions: usize,
) -> Result<(), String> {
    if repetitions == 0 {
        return Err("--repetitions must be greater than zero".into());
    }
    let counts = [
        ("--sizes", sizes.len()),
        ("--threads", threads.len()),
        ("--kernel", kernels.len()),
        ("--precision", precisions.len()),
        ("--tile-size", tile_sizes.len()),
        ("--depth-block", depth_blocks.len()),
    ];
    if let Some((flag, _)) = counts.iter().find(|(_, count)| *count == 0) {
        return Err(format!("{flag} needs at least one value"));
    }
    for (flag, values) in [
        ("--sizes", sizes),
        ("--threads", threads),
        ("--tile-size", tile_sizes),
        ("--depth-block", depth_blocks),
    ] {
        if values.contains(&0) {
            return Err(format!("all {flag} values must be greater than zero"));
        }
    }
    // A repeat would measure a cell twice, which `validate` rejects only
    // after the run is in the database.
    let repeats = [
        ("--sizes", first_repeat(sizes).map(ToString::to_string)),
        ("--threads", first_repeat(threads).map(ToString::to_string)),
        (
            "--kernel",
            first_repeat(kernels).map(|k| k.label().to_owned()),
        ),
        (
            "--precision",
            first_repeat(precisions).map(|p| p.label().to_owned()),
        ),
        (
            "--tile-size",
            first_repeat(tile_sizes).map(ToString::to_string),
        ),
        (
            "--depth-block",
            first_repeat(depth_blocks).map(ToString::to_string),
        ),
    ];
    if let Some((flag, Some(value))) = repeats.into_iter().find(|(_, value)| value.is_some()) {
        return Err(format!("{flag} lists {value} twice"));
    }
    Ok(())
}

/// The first value that appears earlier in `values` too.
fn first_repeat<T: PartialEq>(values: &[T]) -> Option<&T> {
    values
        .iter()
        .enumerate()
        .find_map(|(i, value)| values[..i].contains(value).then_some(value))
}

/// A kernel named on the command line that can't run anywhere in the sweep is
/// a mistake worth stopping for; default kernels are only skipped.
pub(crate) fn reject_idle_kernels(
    kernels: &[KernelChoice],
    precisions: &[Precision],
    threads: &[usize],
    sizes: &[usize],
) -> Result<(), String> {
    for &kernel in kernels {
        if !precisions.iter().any(|&p| kernel.supports(p)) {
            let requested: Vec<&str> = precisions.iter().map(|p| p.label()).collect();
            return Err(format!(
                "{} does not support {} precision",
                kernel.label(),
                requested.join(", ")
            ));
        }
        let runnable = sizes
            .iter()
            .any(|&n| threads.iter().any(|&t| kernel.fits(t, n)));
        if kernel.uses_workers() && !runnable {
            return Err(format!(
                "{} needs at least one row per thread; every --threads value exceeds every --sizes value",
                kernel.label()
            ));
        }
    }
    Ok(())
}

/// A knob flag given on the command line that no selected kernel sweeps
/// would be silently ignored, so it is a mistake worth stopping for.
pub(crate) fn reject_unused_knobs(
    kernels: &[KernelChoice],
    explicit: &[Knob],
) -> Result<(), String> {
    for &knob in explicit {
        if kernels.iter().any(|kernel| kernel.knob() == Some(knob)) {
            continue;
        }
        let users: Vec<&str> = KernelChoice::value_variants()
            .iter()
            .filter(|kernel| kernel.knob() == Some(knob))
            .map(|kernel| kernel.label())
            .collect();
        return Err(format!(
            "{} applies only to {}, and none of them is selected",
            knob.flag(),
            users.join(", ")
        ));
    }
    Ok(())
}

/// `accelerate-bnns` is compiled into every macOS build but needs macOS 26 at
/// run time: stop if it was named, otherwise drop it with a notice.
#[cfg(target_os = "macos")]
pub(crate) fn drop_unavailable_bnns(
    kernels: &mut Vec<KernelChoice>,
    explicit: bool,
    available: impl FnOnce() -> bool,
) -> Result<Option<String>, String> {
    if !kernels.contains(&KernelChoice::AccelerateBnns) || available() {
        return Ok(None);
    }
    if explicit {
        return Err("accelerate-bnns needs macOS 26 (the BNNSGraph builder)".to_owned());
    }
    kernels.retain(|&kernel| kernel != KernelChoice::AccelerateBnns);
    Ok(Some("skipping accelerate-bnns (needs macOS 26)".to_owned()))
}

/// One stderr line per group of cells `BenchmarkPlan::cells` leaves out.
pub(crate) fn skip_notices(
    kernels: &[KernelChoice],
    precisions: &[Precision],
    threads: &[usize],
    sizes: &[usize],
) -> Vec<String> {
    let mut notices = Vec::new();
    for &kernel in kernels {
        let unsupported: Vec<&str> = precisions
            .iter()
            .filter(|&&p| !kernel.supports(p))
            .map(|p| p.label())
            .collect();
        if !unsupported.is_empty() {
            notices.push(format!(
                "skipping {} at {} (unsupported precision)",
                kernel.label(),
                unsupported.join(", ")
            ));
        }
        if !kernel.uses_workers() {
            continue;
        }
        for &n in sizes {
            let too_many: Vec<String> = threads
                .iter()
                .filter(|&&t| !kernel.fits(t, n))
                .map(ToString::to_string)
                .collect();
            if !too_many.is_empty() {
                notices.push(format!(
                    "skipping {} with {} threads at n={n} (needs a row per thread)",
                    kernel.label(),
                    too_many.join(",")
                ));
            }
        }
    }
    notices
}
