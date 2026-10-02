//! `gemm-bench validate`: the gate every contributed database passes before
//! it merges. A contributed file is untrusted, and the schema's CHECKs bind
//! only a file our DDL created, so `validate`:
//!
//! - judges a private writable copy of the bytes it read, never the file:
//!   SQLite would follow a symlink, apply a `-wal` file the dashboard never
//!   fetches, and skip CHECKs on a read-only connection, where
//!   `integrity_check` cannot verify them;
//! - requires the stored DDL to equal data/schema.sql's before anything
//!   evaluates it, so `integrity_check` runs only our own CHECK expressions
//!   against every row;
//! - adds the rules that span rows, which no CHECK can express.

use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};

use clap::ValueEnum;
use rusqlite::{Connection, OptionalExtension};

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
    let size = check_unlinked(path)?;
    if size > MAX_BYTES {
        return Err(format!("{size} bytes is over the {MAX_BYTES}-byte limit"));
    }
    let bytes = fs::read(path).map_err(|error| format!("cannot read it: {error}"))?;
    check_header(&bytes)?;
    // Declared before `db`, so the connection closes before the copy goes.
    let scratch = Scratch::new()?;
    let copy = scratch.0.join("copy.sqlite");
    fs::write(&copy, &bytes).map_err(|error| format!("cannot copy it to scratch: {error}"))?;
    let db = Connection::open(&copy).map_err(sql)?;
    check_stamps(&db)?;
    check_schema(&db)?;
    check_integrity(&db)?;
    check_kernels(&db)?;
    check_params(&db)?;
    check_runs(&db)?;
    check_text(&db)
}

/// Git commits symlinks and SQLite follows them, so a link could publish
/// another host's database under this login. Returns the file's size.
fn check_unlinked(path: &Path) -> Result<u64, String> {
    let unreadable = |error| format!("cannot read it: {error}");
    let file = fs::symlink_metadata(path).map_err(unreadable)?;
    if !file.is_file() {
        return Err("it must be a regular file, not a symbolic link, directory or device".into());
    }
    if let Some(login) = path.parent()
        && !fs::symlink_metadata(login).map_err(unreadable)?.is_dir()
    {
        return Err(
            "its <github-login> folder must be a real directory, not a symbolic link".into(),
        );
    }
    Ok(file.len())
}

/// The bytes must be an SQLite file in rollback-journal mode, which the writer
/// uses (header bytes 18 and 19 are 1; WAL's are 2): a WAL-mode file keeps its
/// latest rows in a `-wal` file that the dashboard never fetches.
fn check_header(bytes: &[u8]) -> Result<(), String> {
    if !bytes.starts_with(b"SQLite format 3\0") {
        return Err("not an SQLite database".into());
    }
    match bytes.get(18..20) {
        Some([1, 1]) => Ok(()),
        Some(&[write, read]) => Err(format!(
            "header bytes 18 and 19 are {write} and {read}, not 1 and 1: a WAL-mode file keeps rows in a -wal file the dashboard never fetches"
        )),
        _ => Err("not an SQLite database: the header is cut short".into()),
    }
}

/// A folder of its own in the temp directory, removed with everything in it
/// when dropped, so SQLite's `-journal` or `-wal` files never land next to
/// the contributed file.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Result<Self, String> {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let temp = std::env::temp_dir();
        loop {
            let dir = temp.join(format!(
                "gemm-bench-scratch-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            // `create_dir` fails on an existing path, a symlink included.
            match fs::create_dir(&dir) {
                Ok(()) => return Ok(Self(dir)),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(format!(
                        "cannot create a scratch folder in {}: {error}",
                        temp.display()
                    ));
                }
            }
        }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
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
}
