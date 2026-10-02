//! `gemm-bench validate`: the gate every contributed database passes before
//! it merges. The schema's CHECKs bind only files our DDL created, so this
//! re-derives every guarantee from the file itself, and adds the rules that
//! span rows, which no CHECK can express.

use std::{
    fs,
    path::{Path, PathBuf},
};

use clap::ValueEnum;
use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::{
    db, host,
    kernel::{KernelChoice, Precision},
};

/// The largest database accepted: a full sweep is about 0.8 MB.
const MAX_BYTES: u64 = 16 * 1024 * 1024;
/// The longest free-text value accepted, such as a CPU name.
const MAX_TEXT_CHARS: usize = 200;

/// Checks every file, one line each, and fails if any file does.
pub(crate) fn validate_all(paths: &[PathBuf]) -> Result<(), String> {
    let mut failed = 0;
    for path in paths {
        match validate(path) {
            Ok(()) => println!("ok    {}", path.display()),
            Err(reason) => {
                failed += 1;
                eprintln!("FAIL  {}: {reason}", path.display());
            }
        }
    }
    if failed == 0 {
        Ok(())
    } else {
        Err(format!(
            "{failed} of {} databases failed validation",
            paths.len()
        ))
    }
}

/// Checks one file and names the first rule it breaks.
pub(crate) fn validate(path: &Path) -> Result<(), String> {
    if host::host_of_db_path(path).is_none() {
        return Err("the path must be data/db/<github-login>/<machine>.sqlite".into());
    }
    let size = fs::metadata(path)
        .map_err(|error| format!("cannot read it: {error}"))?
        .len();
    if size > MAX_BYTES {
        return Err(format!("{size} bytes is over the {MAX_BYTES}-byte limit"));
    }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(sql)?;
    check_stamps(&db)?;
    check_integrity(&db)?;
    check_schema(&db)?;
    check_kernels(&db)?;
    check_params(&db)?;
    check_runs(&db)?;
    check_text(&db)
}

fn sql(error: rusqlite::Error) -> String {
    error.to_string()
}

fn check_stamps(db: &Connection) -> Result<(), String> {
    let pragma = |name: &str| db.pragma_query_value(None, name, |row| row.get::<_, i64>(0));
    let app =
        pragma("application_id").map_err(|error| format!("not an SQLite database: {error}"))?;
    if app != db::APPLICATION_ID {
        return Err(format!(
            "application_id {app:#x} is not gemm-bench's {:#x}",
            db::APPLICATION_ID
        ));
    }
    let version = pragma("user_version").map_err(sql)?;
    if version != db::SCHEMA_VERSION {
        return Err(format!(
            "schema version {version}; this tool validates version {}",
            db::SCHEMA_VERSION
        ));
    }
    Ok(())
}

fn check_integrity(db: &Connection) -> Result<(), String> {
    let status: String = db
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(sql)?;
    if status != "ok" {
        return Err(format!("integrity_check: {status}"));
    }
    let dangling: Option<String> = db
        .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
        .optional()
        .map_err(sql)?;
    match dangling {
        Some(table) => Err(format!(
            "a row of {table:?} points at a row that does not exist"
        )),
        None => Ok(()),
    }
}

/// The stored DDL must be byte-identical to data/schema.sql's: a file with a
/// CHECK stripped, or with an extra table, view or trigger, fails here.
fn check_schema(db: &Connection) -> Result<(), String> {
    let reference = Connection::open_in_memory().map_err(sql)?;
    reference.execute_batch(db::SCHEMA).map_err(sql)?;
    let objects = |db: &Connection| -> rusqlite::Result<Vec<(String, String, Option<String>)>> {
        let mut statement =
            db.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name")?;
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect()
    };
    let (actual, expected) = (objects(db).map_err(sql)?, objects(&reference).map_err(sql)?);
    if let Some((kind, name, _)) = actual.iter().find(|object| !expected.contains(object)) {
        return Err(format!("{kind} {name:?} differs from data/schema.sql"));
    }
    if let Some((kind, name, _)) = expected.iter().find(|object| !actual.contains(object)) {
        return Err(format!("{kind} {name:?} from data/schema.sql is missing"));
    }
    Ok(())
}

/// Every kernel is one the tool has, on its own backend, at a precision it
/// runs; only worker kernels record more than one thread; and a Metal row
/// belongs to a run that recorded its GPU.
fn check_kernels(db: &Connection) -> Result<(), String> {
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
fn check_params(db: &Connection) -> Result<(), String> {
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
fn check_runs(db: &Connection) -> Result<(), String> {
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
fn check_text(db: &Connection) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use rusqlite::Connection;

    use super::{validate, validate_all};
    use crate::db::{self, fixtures};

    /// A valid DB at `<tmp>/<name>/data/db/octocat/m1pro.sqlite`, written by
    /// the real writer.
    fn valid_db(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("gemm-bench-validate-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let path = root.join("data/db/octocat/m1pro.sqlite");
        let at = "2026-10-02T10:00:00Z";
        let mut db = db::open_for_run(&path, at).expect("open");
        db::write_run(
            &mut db,
            &fixtures::context(at),
            5,
            &fixtures::machine(),
            &fixtures::records(),
        )
        .expect("write");
        path
    }

    /// The reason a valid DB fails once `sql` has run on it.
    fn failure(name: &str, sql: &str) -> String {
        let path = valid_db(name);
        Connection::open(&path)
            .expect("open")
            .execute_batch(sql)
            .expect("mutate");
        validate(&path).expect_err("the mutated DB must fail")
    }

    #[test]
    fn a_db_the_tool_wrote_passes() {
        validate(&valid_db("ok")).expect("a written DB is valid");
    }

    #[test]
    fn the_path_must_name_a_host() {
        let valid = valid_db("path");
        // data/db/m1pro.sqlite: no login folder.
        let stray = valid
            .parent()
            .and_then(Path::parent)
            .expect("data/db")
            .join("m1pro.sqlite");
        fs::copy(&valid, &stray).expect("copy");
        assert!(
            validate(&stray)
                .expect_err("not under a login")
                .contains("data/db/<github-login>/<machine>.sqlite")
        );
    }

    #[test]
    fn an_oversized_file_fails_before_it_is_opened() {
        let path = valid_db("big");
        fs::write(&path, vec![0_u8; 17 << 20]).expect("17 MB");
        assert!(validate(&path).expect_err("too big").contains("limit"));
    }

    #[test]
    fn stamps_must_say_gemm_bench_v1() {
        assert!(failure("app-id", "PRAGMA application_id = 1").contains("application_id"));
        assert!(failure("version", "PRAGMA user_version = 2").contains("schema version 2"));
    }

    #[test]
    fn the_stored_ddl_must_match_schema_sql() {
        assert!(
            failure(
                "trigger",
                "CREATE TRIGGER t AFTER INSERT ON runs BEGIN SELECT 1; END"
            )
            .contains("\"t\"")
        );
        let path = valid_db("stripped");
        fs::remove_file(&path).expect("remove");
        let stripped = Connection::open(&path).expect("create");
        stripped
            .execute_batch(&db::SCHEMA.replace(" CHECK (value > 0)", ""))
            .expect("schema without a CHECK");
        let error = validate(&path).expect_err("a stripped CHECK");
        assert!(
            error.contains("\"params\"") && error.contains("differs"),
            "{error}"
        );
    }

    #[test]
    fn kernels_must_be_known_on_their_backend_and_precision() {
        assert!(
            failure(
                "unknown",
                "UPDATE measurements SET kernel = 'warp-drive' WHERE kernel = 'ikj'"
            )
            .contains("unknown kernel")
        );
        assert!(
            failure(
                "backend",
                "UPDATE measurements SET backend = 'matrix' WHERE kernel = 'ikj'"
            )
            .contains("ikj runs on cpu")
        );
        assert!(
            failure(
                "precision",
                "UPDATE measurements SET precision = 'f64' WHERE kernel = 'mps'"
            )
            .contains("mps does not run at")
        );
        assert!(
            failure(
                "threads",
                "UPDATE measurements SET threads = 4 WHERE kernel = 'ikj'"
            )
            .contains("one caller thread")
        );
        assert!(
            failure("gpu", "UPDATE runs SET gpu = NULL, gpu_cores = NULL")
                .contains("recorded no GPU")
        );
    }

    #[test]
    fn params_must_be_exactly_the_declared_ones() {
        let undeclared = "INSERT INTO params SELECT measurement_id, 'mystery', 1, 'derived' FROM measurements WHERE kernel = 'ikj'";
        assert!(failure("undeclared", undeclared).contains("declares"));
        assert!(
            failure("missing", "DELETE FROM params WHERE name = 'register_rows'")
                .contains("declares")
        );
        assert!(
            failure(
                "source",
                "UPDATE params SET source = 'derived' WHERE name = 'register_rows'"
            )
            .contains("declares")
        );
    }

    #[test]
    fn a_cell_appears_once_per_run() {
        let twice = "INSERT INTO measurements (run_id, kernel, backend, precision, n, threads, gops, median_ms, min_ms, stddev_ms, setup_ms)
                     SELECT run_id, kernel, backend, precision, n, threads, gops, median_ms, min_ms, stddev_ms, setup_ms FROM measurements WHERE kernel = 'ikj'";
        assert!(failure("twice", twice).contains("twice"));
    }

    #[test]
    fn every_run_has_measurements_and_the_file_has_a_run() {
        let empty_run = "INSERT INTO runs (started_at, commit_id, rustc_version, repetitions, os, arch, target_features, cpu, available_parallelism)
                         VALUES ('2026-10-03T00:00:00Z', 'a', 'r', 1, 'o', 'aarch64', '', 'c', 1)";
        assert!(failure("empty-run", empty_run).contains("has no measurements"));
        assert!(
            failure("no-runs", "PRAGMA foreign_keys = ON; DELETE FROM runs").contains("no runs")
        );
    }

    #[test]
    fn free_text_must_be_short_and_printable() {
        assert!(
            failure("bell", "UPDATE runs SET cpu = 'Apple' || char(7) || 'M1'")
                .contains("runs.cpu")
        );
        assert!(failure("long", "UPDATE runs SET os = printf('%.300c', 'x')").contains("runs.os"));
    }

    #[test]
    fn a_dangling_reference_fails() {
        let dangling =
            "PRAGMA foreign_keys = OFF; INSERT INTO params VALUES (999, 'tile_size', 16, 'swept')";
        assert!(failure("dangling", dangling).contains("does not exist"));
    }

    #[test]
    fn validate_all_checks_every_file_and_fails_if_any_does() {
        let good = valid_db("all-good");
        let bad = valid_db("all-bad");
        Connection::open(&bad)
            .expect("open")
            .execute_batch("PRAGMA user_version = 9")
            .expect("bump");
        let error = validate_all(&[good, bad]).expect_err("one bad file");
        assert!(error.contains("1 of 2"), "{error}");
        assert!(validate_all(&[valid_db("all-ok")]).is_ok());
    }
}
