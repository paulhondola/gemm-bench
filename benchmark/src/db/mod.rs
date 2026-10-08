//! The host database: `data/schema.sql` applied to a new file, checked before
//! any kernel runs, and one transaction per run.

use std::{ffi::OsStr, fs, path::Path};

use rusqlite::{Connection, OptionalExtension, params};

use crate::{benchmark::BenchmarkRecord, context::RunContext, hwinfo::Machine, validate::schema};

/// Schema v1, the only version: see the spec before changing it.
pub(crate) const SCHEMA: &str = include_str!("../../../data/schema.sql");
/// 'GEMM', the `application_id` of every gemm-bench database.
pub(crate) const APPLICATION_ID: i64 = 0x4745_4d4d;
/// The `user_version` this tool writes and validates.
pub(crate) const SCHEMA_VERSION: i64 = 1;

/// `--output` names the database file itself.
pub(crate) fn validate_db_path(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        return Err(format!(
            "output path '{}' is an existing directory; --output must name a .sqlite file",
            path.display()
        ));
    }
    let is_sqlite = path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("sqlite"));
    if !is_sqlite {
        return Err(format!(
            "--output must be a .sqlite file path (got '{}')",
            path.display()
        ));
    }
    Ok(())
}

/// Opens `path` for a run starting at `started_at`, before any kernel runs:
/// creates missing directories, applies the schema to a new file, and refuses
/// anything that isn't a gemm-bench v1 database, that `validate` would reject,
/// that can't be written, or that already holds a run that started at the
/// same second.
pub(crate) fn open_for_run(path: &Path, started_at: &str) -> Result<Connection, String> {
    validate_db_path(path)?;
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "cannot create output directory '{}': {error}",
                parent.display()
            )
        })?;
    }
    let shown = path.display();
    let mut db =
        Connection::open(path).map_err(|error| format!("cannot open '{shown}': {error}"))?;
    // SQLite opens a write-protected file read-only instead of failing.
    let readonly = db
        .is_readonly(rusqlite::MAIN_DB)
        .map_err(|error| format!("cannot open '{shown}': {error}"))?;
    if readonly {
        return Err(format!(
            "'{shown}' is read-only, so a run cannot be added to it"
        ));
    }
    let not_sqlite =
        |error: rusqlite::Error| format!("'{shown}' is not an SQLite database: {error}");
    db.pragma_update(None, "foreign_keys", true)
        .map_err(not_sqlite)?;
    let pragma =
        |db: &Connection, name: &str| db.pragma_query_value(None, name, |row| row.get::<_, i64>(0));
    let version = pragma(&db, "user_version").map_err(not_sqlite)?;
    let objects: i64 = db
        .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row.get(0))
        .map_err(not_sqlite)?;
    match version {
        0 if objects == 0 => {
            let tx = db.transaction().map_err(|error| error.to_string())?;
            tx.execute_batch(SCHEMA)
                .map_err(|error| format!("cannot create '{shown}': {error}"))?;
            tx.commit().map_err(|error| error.to_string())?;
        }
        SCHEMA_VERSION if pragma(&db, "application_id").map_err(not_sqlite)? == APPLICATION_ID => {
            // validate's own checks, so a run is never added to a file CI rejects.
            schema::check_schema(&db)
                .and_then(|()| schema::check_integrity(&db))
                .map_err(|error| format!("'{shown}' fails validation: {error}"))?;
            // A writable file in a read-only directory opens read-write but
            // can't create its rollback journal: prove a write now, not
            // after the sweep.
            db.execute_batch(&format!(
                "BEGIN; PRAGMA user_version = {SCHEMA_VERSION}; ROLLBACK"
            ))
            .map_err(|error| format!("cannot write to '{shown}': {error}"))?;
        }
        0 | SCHEMA_VERSION => {
            return Err(format!(
                "'{shown}' is an SQLite file, but not a gemm-bench database"
            ));
        }
        other => {
            return Err(format!(
                "'{shown}' has schema version {other}; this tool writes version {SCHEMA_VERSION}"
            ));
        }
    }
    let taken = db
        .query_row(
            "SELECT 1 FROM runs WHERE started_at = ?1",
            [started_at],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if taken.is_some() {
        return Err(format!(
            "'{shown}' already holds a run started at {started_at}"
        ));
    }
    Ok(db)
}

/// Adds a run, its machine and every measurement in one transaction: a
/// failure leaves the database as it was.
pub(crate) fn write_run(
    db: &mut Connection,
    context: &RunContext,
    repetitions: usize,
    machine: &Machine,
    records: &[BenchmarkRecord],
) -> rusqlite::Result<()> {
    let tx = db.transaction()?;
    tx.execute(
        "INSERT INTO runs (started_at, commit_id, rustc_version, repetitions, os, arch,
                           target_features, cpu, available_parallelism, gpu, gpu_cores)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            context.timestamp,
            context.commit,
            machine.rustc_version,
            int(repetitions),
            machine.os,
            machine.arch,
            machine.target_features,
            machine.cpu,
            int(machine.available_parallelism),
            machine.gpu,
            machine.gpu_cores.map(int),
        ],
    )?;
    let run_id = tx.last_insert_rowid();
    for tier in &machine.tiers {
        tx.execute(
            "INSERT INTO core_tiers (run_id, tier, name, cores, logical_cpus) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![run_id, int(tier.tier), tier.name, int(tier.cores), int(tier.logical_cpus)],
        )?;
    }
    for cache in &machine.caches {
        tx.execute(
            "INSERT INTO caches (run_id, tier, level, kind, size_bytes, line_bytes, shared_by, instances)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                run_id,
                cache.tier.map(int),
                int(cache.level),
                cache.kind.label(),
                int(cache.size_bytes),
                cache.line_bytes.map(int),
                int(cache.shared_by),
                int(cache.instances),
            ],
        )?;
    }
    {
        let mut measurement = tx.prepare(
            "INSERT INTO measurements (run_id, kernel, backend, precision, n, threads, gops,
                                       mean_rel_error_f64, median_ms, min_ms, stddev_ms, gpu_ms, setup_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )?;
        let mut param = tx.prepare(
            "INSERT INTO params (measurement_id, name, value, source) VALUES (?1, ?2, ?3, ?4)",
        )?;
        for record in records {
            // A NaN error binds as NULL (SQLite has no NaN); +Inf is kept.
            measurement.execute(params![
                run_id,
                record.kernel,
                record.backend,
                record.precision,
                int(record.n),
                int(record.threads),
                record.gops,
                record.mean_rel_error_f64,
                record.median_ms,
                record.min_ms,
                record.stddev_ms,
                record.gpu_ms,
                record.setup_ms,
            ])?;
            let measurement_id = tx.last_insert_rowid();
            for p in &record.params {
                param.execute(params![
                    measurement_id,
                    p.name,
                    int(p.value),
                    p.source.label()
                ])?;
            }
        }
    }
    tx.commit()
}

/// SQLite integers are i64; every count and size the harness records fits.
fn int(value: usize) -> i64 {
    i64::try_from(value).expect("counts and sizes fit in an i64")
}

#[cfg(test)]
pub(crate) mod fixtures;

#[cfg(test)]
mod tests;
