//! The host database: `data/schema.sql` applied to a new file, checked before
//! any kernel runs, and one transaction per run.

use std::{ffi::OsStr, fs, path::Path};

use rusqlite::{Connection, OptionalExtension, params};

use crate::{benchmark::BenchmarkRecord, context::RunContext, machine::Machine};

/// Schema v1, the only version: see the spec before changing it.
pub(crate) const SCHEMA: &str = include_str!("../../data/schema.sql");
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
/// anything that isn't a gemm-bench v1 database or already holds a run that
/// started at the same second.
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
        SCHEMA_VERSION if pragma(&db, "application_id").map_err(not_sqlite)? == APPLICATION_ID => {}
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

/// A machine, a run context and one run's records, shared by the writer's
/// and `validate`'s tests.
#[cfg(test)]
pub(crate) mod fixtures {
    use gemm_bench::{GemmKernel, kernels::PackedGemm};

    use crate::{
        benchmark::BenchmarkRecord,
        context::RunContext,
        machine::{Cache, CacheKind, CoreTier, Machine},
    };

    pub(crate) fn machine() -> Machine {
        Machine {
            os: "macOS 27.0.1".to_owned(),
            arch: "aarch64",
            target_features: "dotprod fp16 neon".to_owned(),
            rustc_version: "rustc 1.101.0-nightly",
            cpu: "Apple M1 Pro".to_owned(),
            available_parallelism: 10,
            gpu: Some("Apple M1 Pro".to_owned()),
            gpu_cores: Some(16),
            tiers: vec![CoreTier {
                tier: 0,
                name: Some("Performance".to_owned()),
                cores: 8,
                logical_cpus: 8,
            }],
            caches: vec![Cache {
                tier: Some(0),
                level: 2,
                kind: CacheKind::Unified,
                size_bytes: 12 << 20,
                line_bytes: Some(128),
                shared_by: 4,
                instances: 2,
            }],
        }
    }

    pub(crate) fn context(started_at: &str) -> RunContext {
        RunContext {
            commit: "abc1234".to_owned(),
            timestamp: started_at.to_owned(),
        }
    }

    /// A CPU kernel with no params, `packed` with the params it really
    /// reports, and a Metal kernel with `gpu_ms`.
    pub(crate) fn records() -> Vec<BenchmarkRecord> {
        let base = |kernel: &str, backend: &'static str| BenchmarkRecord {
            kernel: kernel.to_owned(),
            backend,
            precision: "f32",
            n: 64,
            threads: 1,
            gops: 10.0,
            mean_rel_error_f64: 1e-7,
            median_ms: 0.05,
            min_ms: 0.05,
            stddev_ms: 0.001,
            gpu_ms: None,
            setup_ms: 0.0,
            params: Vec::new(),
        };
        vec![
            base("ikj", "cpu"),
            BenchmarkRecord {
                params: GemmKernel::<f32>::params(&PackedGemm::new(256), 64),
                ..base("packed", "cpu")
            },
            BenchmarkRecord {
                gpu_ms: Some(0.02),
                ..base("mps", "metal")
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use rusqlite::Connection;

    use super::{
        APPLICATION_ID, SCHEMA_VERSION, fixtures, open_for_run, validate_db_path, write_run,
    };
    use crate::benchmark::BenchmarkRecord;

    /// A fresh `<name>/run.sqlite` under the temp dir; parents not yet created.
    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gemm-bench-db-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("nested/run.sqlite")
    }

    fn count(db: &Connection, table: &str) -> i64 {
        db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count")
    }

    #[test]
    fn a_new_file_gets_the_schema_and_its_stamps() {
        let path = temp_db("new");
        let db = open_for_run(&path, "2026-10-02T10:00:00Z").expect("a new DB opens");
        let pragma = |name| {
            db.pragma_query_value(None, name, |row| row.get::<_, i64>(0))
                .expect(name)
        };
        assert_eq!(pragma("application_id"), APPLICATION_ID);
        assert_eq!(pragma("user_version"), SCHEMA_VERSION);
        assert_eq!(count(&db, "runs"), 0);
    }

    #[test]
    fn a_run_is_written_whole_with_its_machine_and_params() {
        let path = temp_db("round-trip");
        let mut db = open_for_run(&path, "2026-10-02T10:00:00Z").expect("open");
        let mut records = fixtures::records();
        records.push(BenchmarkRecord {
            gops: f64::INFINITY,
            mean_rel_error_f64: f64::NAN,
            n: 128,
            ..fixtures::records().remove(0)
        });
        write_run(
            &mut db,
            &fixtures::context("2026-10-02T10:00:00Z"),
            5,
            &fixtures::machine(),
            &records,
        )
        .expect("write");

        assert_eq!(
            (
                count(&db, "runs"),
                count(&db, "core_tiers"),
                count(&db, "caches")
            ),
            (1, 1, 1)
        );
        assert_eq!(count(&db, "measurements"), 4);
        assert_eq!(count(&db, "params"), 5, "packed's five params");
        let (gops, error): (f64, Option<f64>) = db
            .query_row(
                "SELECT gops, mean_rel_error_f64 FROM measurements WHERE n = 128",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("the +Inf row");
        assert_eq!(
            (gops, error),
            (f64::INFINITY, None),
            "+Inf kept, NaN stored as NULL"
        );
        let gpu_ms: Option<f64> = db
            .query_row(
                "SELECT gpu_ms FROM measurements WHERE kernel = 'mps'",
                [],
                |row| row.get(0),
            )
            .expect("the mps row");
        assert_eq!(gpu_ms, Some(0.02));
    }

    #[test]
    fn a_second_run_is_added_and_its_start_time_cannot_repeat() {
        let path = temp_db("append");
        for at in ["2026-10-02T10:00:00Z", "2026-10-02T11:00:00Z"] {
            let mut db = open_for_run(&path, at).expect("open");
            write_run(
                &mut db,
                &fixtures::context(at),
                5,
                &fixtures::machine(),
                &fixtures::records(),
            )
            .expect("write");
        }
        let db = Connection::open(&path).expect("reopen");
        assert_eq!(count(&db, "runs"), 2);
        let error = open_for_run(&path, "2026-10-02T11:00:00Z").expect_err("a repeated start time");
        assert!(error.contains("already holds a run"), "{error}");
    }

    #[test]
    fn files_that_are_not_gemm_bench_v1_dbs_are_refused() {
        let foreign = temp_db("foreign");
        fs::create_dir_all(foreign.parent().expect("parent")).expect("dirs");
        Connection::open(&foreign)
            .expect("create")
            .execute_batch("CREATE TABLE notes (x)")
            .expect("table");
        let error = open_for_run(&foreign, "2026-10-02T10:00:00Z").expect_err("another app's DB");
        assert!(error.contains("not a gemm-bench database"), "{error}");

        let text = foreign.with_file_name("text.sqlite");
        fs::write(
            &text,
            "hello, this is not a database at all, just some bytes",
        )
        .expect("write");
        let error = open_for_run(&text, "2026-10-02T10:00:00Z").expect_err("a text file");
        assert!(error.contains("not an SQLite database"), "{error}");

        let newer = temp_db("newer");
        drop(open_for_run(&newer, "2026-10-02T10:00:00Z").expect("open"));
        Connection::open(&newer)
            .expect("reopen")
            .execute_batch("PRAGMA user_version = 2")
            .expect("bump");
        let error = open_for_run(&newer, "2026-10-02T11:00:00Z").expect_err("a newer schema");
        assert!(error.contains("schema version 2"), "{error}");
    }

    #[test]
    fn output_paths_must_name_a_sqlite_file() {
        validate_db_path(Path::new("results.sqlite")).expect("lowercase");
        validate_db_path(Path::new("data/results.SQLITE")).expect("uppercase");
        for path in ["results", "data/results.csv", ""] {
            let error = validate_db_path(Path::new(path)).expect_err("not .sqlite");
            assert!(error.contains(".sqlite"), "{path}: {error}");
        }
        let dir = temp_db("dir");
        fs::create_dir_all(&dir).expect("a directory named like a DB");
        assert!(
            validate_db_path(&dir)
                .expect_err("a directory")
                .contains("existing directory")
        );
    }

    #[test]
    fn a_parent_that_is_a_file_fails_before_running() {
        let blocker = temp_db("blocker").with_file_name("blocker");
        fs::create_dir_all(blocker.parent().expect("parent")).expect("dirs");
        fs::write(&blocker, b"").expect("a regular file");
        let error = open_for_run(&blocker.join("run.sqlite"), "2026-10-02T10:00:00Z")
            .expect_err("a file cannot be a parent directory");
        assert!(error.contains("output directory"), "{error}");
    }
}
