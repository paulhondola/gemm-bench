use rusqlite::{Connection, OptionalExtension};

use crate::db;

pub(super) fn sql(error: rusqlite::Error) -> String {
    error.to_string()
}

pub(super) fn check_stamps(db: &Connection) -> Result<(), String> {
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

pub(crate) fn check_integrity(db: &Connection) -> Result<(), String> {
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
pub(crate) fn check_schema(db: &Connection) -> Result<(), String> {
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
