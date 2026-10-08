use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::Connection;

use super::{
    APPLICATION_ID, SCHEMA, SCHEMA_VERSION, fixtures, open_for_run, validate_db_path, write_run,
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
    // SQLite stores a CREATE's text, comments included, and validate
    // compares it byte for byte: a comment there could never be edited.
    let commented: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE sql LIKE '%--%'",
            [],
            |row| row.get(0),
        )
        .expect("count");
    assert_eq!(commented, 0, "schema.sql comments belong above each CREATE");
}

/// A CRLF checkout of schema.sql would store `\r` in every CREATE, which
/// CI's LF copy then rejects, so fail here before a run is spent on it.
#[test]
fn the_schema_has_lf_line_endings() {
    assert!(
        !SCHEMA.contains('\r'),
        "data/schema.sql has CRLF line endings; check out with .gitattributes' eol=lf"
    );
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

    let unstamped = temp_db("unstamped");
    drop(open_for_run(&unstamped, "2026-10-02T10:00:00Z").expect("open"));
    Connection::open(&unstamped)
        .expect("reopen")
        .execute_batch("PRAGMA application_id = 0")
        .expect("clear the stamp");
    let error = open_for_run(&unstamped, "2026-10-02T11:00:00Z")
        .expect_err("version 1 without gemm-bench's application_id");
    assert!(error.contains("not a gemm-bench database"), "{error}");
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

/// SQLite quietly opens a write-protected file read-only; the run would
/// only fail once the sweep was over.
#[cfg(unix)]
#[test]
fn a_write_protected_db_is_refused_before_running() {
    use std::os::unix::fs::PermissionsExt;

    let path = temp_db("read-only");
    drop(open_for_run(&path, "2026-10-02T10:00:00Z").expect("open"));
    fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).expect("chmod");
    let error = open_for_run(&path, "2026-10-02T11:00:00Z").expect_err("a read-only DB");
    assert!(error.contains("read-only"), "{error}");
}

/// validate would reject the file, so no run may be added to it.
#[test]
fn a_db_whose_schema_differs_is_refused_before_running() {
    let path = temp_db("altered");
    drop(open_for_run(&path, "2026-10-02T10:00:00Z").expect("open"));
    Connection::open(&path)
        .expect("reopen")
        .execute_batch("CREATE TABLE extra (x)")
        .expect("alter");
    let error = open_for_run(&path, "2026-10-02T11:00:00Z").expect_err("an altered schema");
    assert!(error.contains("fails validation"), "{error}");
}

/// A writable file in a read-only directory can't create its journal, so
/// the run would only fail once the sweep was over.
#[cfg(unix)]
#[test]
fn a_db_in_a_write_protected_directory_is_refused_before_running() {
    use std::os::unix::fs::PermissionsExt;

    let path = temp_db("read-only-dir");
    drop(open_for_run(&path, "2026-10-02T10:00:00Z").expect("open"));
    let dir = path.parent().expect("parent");
    fs::set_permissions(dir, fs::Permissions::from_mode(0o555)).expect("chmod");
    let result = open_for_run(&path, "2026-10-02T11:00:00Z");
    fs::set_permissions(dir, fs::Permissions::from_mode(0o755)).expect("restore");
    let error = result.expect_err("a read-only directory");
    assert!(error.contains("cannot write"), "{error}");
}
