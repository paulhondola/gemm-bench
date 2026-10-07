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
        failure("gpu", "UPDATE runs SET gpu = NULL, gpu_cores = NULL").contains("recorded no GPU")
    );
}

#[test]
fn params_must_be_exactly_the_declared_ones() {
    let undeclared = "INSERT INTO params SELECT measurement_id, 'mystery', 1, 'derived' FROM measurements WHERE kernel = 'ikj'";
    assert!(failure("undeclared", undeclared).contains("declares"));
    assert!(
        failure("missing", "DELETE FROM params WHERE name = 'register_rows'").contains("declares")
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
    assert!(failure("no-runs", "PRAGMA foreign_keys = ON; DELETE FROM runs").contains("no runs"));
}

#[test]
fn free_text_must_be_short_and_printable() {
    assert!(
        failure("bell", "UPDATE runs SET cpu = 'Apple' || char(7) || 'M1'").contains("runs.cpu")
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

/// `path` with `suffix` appended to its file name, such as SQLite's `-wal`.
fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// The file names in the folder `path` is in, sorted.
fn siblings(path: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(path.parent().expect("a folder"))
        .expect("read the folder")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

#[test]
fn validating_leaves_nothing_next_to_the_input() {
    let path = valid_db("untouched");
    validate(&path).expect("valid");
    assert_eq!(siblings(&path), ["m1pro.sqlite"]);
}

/// A read-only connection never evaluates CHECKs, so rows written with
/// `ignore_check_constraints` behind the exact DDL must still be caught.
#[test]
fn check_constraints_hold_on_a_file_written_with_them_off() {
    for (name, sql) in [
        ("esc", "UPDATE runs SET arch = 'arm' || char(27) || '[2J'"),
        ("negative", "UPDATE measurements SET gops = -5"),
        ("gpu-blank", "UPDATE runs SET gpu = ''"),
    ] {
        let smuggled = format!("PRAGMA ignore_check_constraints = ON; {sql}");
        let error = failure(name, &smuggled);
        assert!(error.contains("CHECK constraint failed"), "{name}: {error}");
    }
}

#[test]
fn a_wal_mode_file_is_refused() {
    let path = valid_db("wal");
    let db = Connection::open(&path).expect("open");
    db.execute_batch("PRAGMA journal_mode = WAL")
        .expect("switch to WAL");
    drop(db);
    let error = validate(&path).expect_err("a WAL-mode header");
    assert!(error.contains("WAL"), "{error}");
    assert_eq!(siblings(&path), ["m1pro.sqlite"]);
}

/// SQLite applies `<file>-wal` whenever it exists, but the dashboard
/// fetches only the `.sqlite` bytes: the verdict must be about those.
#[test]
fn a_wal_sidecar_cannot_hide_the_files_own_bytes() {
    let path = valid_db("sidecar");
    Connection::open(&path)
        .expect("open")
        .execute_batch("UPDATE measurements SET kernel = 'warp-drive' WHERE kernel = 'ikj'")
        .expect("mutate");
    // A WAL that rewrites the measurements page with clean rows and page 1
    // (where the user_version cookie lives, so the header says WAL).
    let clean = valid_db("sidecar-clean");
    let writer = Connection::open(&clean).expect("open");
    writer
        .execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
             UPDATE measurements SET stddev_ms = stddev_ms + 1; PRAGMA user_version = 1",
        )
        .expect("write a WAL");
    fs::copy(sidecar(&clean, "-wal"), sidecar(&path, "-wal")).expect("copy the WAL");
    drop(writer);
    let error = validate(&path).expect_err("the base file's own rows are bad");
    assert!(error.contains("unknown kernel"), "{error}");
    assert_eq!(siblings(&path), ["m1pro.sqlite", "m1pro.sqlite-wal"]);
}

/// Git commits symlinks, and SQLite follows them: without this one PR
/// could publish another host's database under its own login.
#[cfg(unix)]
#[test]
fn a_symlinked_file_or_login_folder_is_refused() {
    use std::os::unix::fs::symlink;

    let real = valid_db("link-target");
    let db_dir = real.parent().and_then(Path::parent).expect("data/db");
    let mallory = db_dir.join("mallory");
    fs::create_dir(&mallory).expect("login folder");
    symlink(&real, mallory.join("m1.sqlite")).expect("link the file");
    let error = validate(&mallory.join("m1.sqlite")).expect_err("a symlinked file");
    assert!(error.contains("regular file"), "{error}");

    let linked = db_dir.join("trudy");
    symlink(real.parent().expect("octocat's folder"), &linked).expect("link the folder");
    let error = validate(&linked.join("m1pro.sqlite")).expect_err("a symlinked folder");
    assert!(error.contains("folder"), "{error}");
}
