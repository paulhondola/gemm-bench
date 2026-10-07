use clap::ValueEnum;
use rusqlite::{Connection, OptionalExtension};

use super::schema::sql;
use crate::kernel::{KernelChoice, Precision};

/// The longest free-text value accepted, such as a CPU name.
pub(super) const MAX_TEXT_CHARS: usize = 200;

/// Every kernel is one the tool has, on its own backend, at a precision it
/// runs; only worker kernels record more than one thread; and a Metal row
/// belongs to a run that recorded its GPU.
pub(super) fn check_kernels(db: &Connection) -> Result<(), String> {
    let mut statement = db
        .prepare("SELECT DISTINCT kernel, backend, precision, threads > 1 FROM measurements")
        .map_err(sql)?;
    let rows: Vec<(String, String, String, bool)> = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .and_then(Iterator::collect)
        .map_err(sql)?;
    for (label, backend, precision, threaded) in rows {
        let kernel =
            KernelChoice::from_label(&label).ok_or_else(|| format!("unknown kernel {label:?}"))?;
        if kernel.backend() != backend {
            return Err(format!(
                "{label} runs on {}, not {backend:?}",
                kernel.backend()
            ));
        }
        if !Precision::from_str(&precision, false).is_ok_and(|p| kernel.supports(p)) {
            return Err(format!("{label} does not run at {precision:?}"));
        }
        if threaded && !kernel.uses_workers() {
            return Err(format!(
                "{label} runs on one caller thread, but a row records more"
            ));
        }
    }
    let gpu_less: i64 = db
        .query_row(
            "SELECT count(*) FROM measurements m JOIN runs r USING (run_id)
             WHERE m.backend = 'metal' AND r.gpu IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(sql)?;
    if gpu_less > 0 {
        return Err(format!(
            "{gpu_less} Metal rows belong to a run that recorded no GPU"
        ));
    }
    Ok(())
}

/// Each measurement records exactly its kernel's declared params, and no
/// cell (kernel, precision, n, threads, swept params) appears twice in a run.
pub(super) fn check_params(db: &Connection) -> Result<(), String> {
    let mut statement = db
        .prepare(
            "SELECT m.measurement_id, m.kernel, p.name, p.source
             FROM measurements m LEFT JOIN params p USING (measurement_id)
             ORDER BY m.measurement_id, p.name",
        )
        .map_err(sql)?;
    let rows: Vec<(i64, String, Option<String>, Option<String>)> = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .and_then(Iterator::collect)
        .map_err(sql)?;
    for group in rows.chunk_by(|a, b| a.0 == b.0) {
        let (id, label) = (group[0].0, &group[0].1);
        let recorded: Vec<(&str, &str)> = group
            .iter()
            .filter_map(|(_, _, name, source)| Some((name.as_deref()?, source.as_deref()?)))
            .collect();
        let kernel =
            KernelChoice::from_label(label).ok_or_else(|| format!("unknown kernel {label:?}"))?;
        let declared: Vec<(&str, &str)> = kernel
            .declared_params()
            .into_iter()
            .map(|(name, source)| (name, source.label()))
            .collect();
        if recorded != declared {
            return Err(format!(
                "measurement {id} ({label}) records params {recorded:?}, but {label} declares {declared:?}"
            ));
        }
    }
    let twice: Option<(i64, String)> = db
        .query_row(
            "SELECT run_id, kernel FROM (
               SELECT m.run_id, m.kernel, m.precision, m.n, m.threads,
                 (SELECT group_concat(p.name || '=' || p.value, ',' ORDER BY p.name)
                  FROM params p WHERE p.measurement_id = m.measurement_id AND p.source = 'swept') AS swept
               FROM measurements m)
             GROUP BY run_id, kernel, precision, n, threads, swept HAVING count(*) > 1 LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(sql)?;
    match twice {
        Some((run, label)) => Err(format!("run {run} measures a {label} cell twice")),
        None => Ok(()),
    }
}

/// The file holds at least one run, and no run is empty.
pub(super) fn check_runs(db: &Connection) -> Result<(), String> {
    let runs: i64 = db
        .query_row("SELECT count(*) FROM runs", [], |row| row.get(0))
        .map_err(sql)?;
    if runs == 0 {
        return Err("it holds no runs".into());
    }
    let empty: Option<String> = db
        .query_row(
            "SELECT started_at FROM runs r
             WHERE NOT EXISTS (SELECT 1 FROM measurements m WHERE m.run_id = r.run_id) LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    match empty {
        Some(at) => Err(format!("the run started at {at} has no measurements")),
        None => Ok(()),
    }
}

/// Free text from a contributor's machine: short, and no control characters.
pub(super) fn check_text(db: &Connection) -> Result<(), String> {
    let columns = [
        ("runs.os", "SELECT os FROM runs"),
        ("runs.cpu", "SELECT cpu FROM runs"),
        ("runs.gpu", "SELECT gpu FROM runs WHERE gpu IS NOT NULL"),
        ("runs.commit_id", "SELECT commit_id FROM runs"),
        ("runs.rustc_version", "SELECT rustc_version FROM runs"),
        (
            "core_tiers.name",
            "SELECT name FROM core_tiers WHERE name IS NOT NULL",
        ),
    ];
    for (column, query) in columns {
        let mut statement = db.prepare(query).map_err(sql)?;
        let values: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .and_then(Iterator::collect)
            .map_err(sql)?;
        for value in values {
            if value.chars().count() > MAX_TEXT_CHARS || value.chars().any(char::is_control) {
                let shown: String = value.chars().take(60).collect();
                return Err(format!(
                    "{column} {shown:?} is over {MAX_TEXT_CHARS} characters or holds a control character"
                ));
            }
        }
    }
    Ok(())
}
