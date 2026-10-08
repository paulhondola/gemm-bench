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

mod file;
mod rules;
pub(crate) mod schema;

#[cfg(test)]
mod tests;

use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::Connection;

use self::file::{MAX_BYTES, Scratch, check_header, check_unlinked};
use self::rules::{check_kernels, check_params, check_runs, check_text};
use self::schema::{check_integrity, check_schema, check_stamps, sql};
use crate::host;

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
