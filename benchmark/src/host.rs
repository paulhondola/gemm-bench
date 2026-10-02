//! Whose machine a run measured: `<github-login>/<machine>`, set once with
//! `just init` into the git-ignored `.host` file at the repo root. The same
//! id names the host's DB, so CI can tie each DB to a PR author.

use std::{
    fs,
    path::{Path, PathBuf},
};

/// Written by `just init`; read by every run without `--output`.
pub(crate) const HOST_FILE: &str = ".host";

/// `<login>/<machine>`: a GitHub login (at most 39 characters) and a machine
/// name, both lowercase letters, digits and hyphens, not starting with a
/// hyphen.
pub(crate) fn is_host_id(id: &str) -> bool {
    let part = |text: &str, max: usize| {
        !text.is_empty()
            && text.len() <= max
            && !text.starts_with('-')
            && text
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    };
    id.split_once('/')
        .is_some_and(|(login, machine)| part(login, 39) && part(machine, usize::MAX))
}

/// The host id in `path`. A missing or malformed file says how to fix it.
pub(crate) fn read_host_file(path: &Path) -> Result<String, String> {
    let fix = "run `just init <github-login>/<machine>` once (e.g. `just init octocat/m1pro`), or pass --output";
    let text =
        fs::read_to_string(path).map_err(|_| format!("no host id in {}: {fix}", path.display()))?;
    let id = text.trim();
    if is_host_id(id) {
        Ok(id.to_owned())
    } else {
        Err(format!(
            "'{id}' in {} is not <github-login>/<machine> in lowercase letters, digits and hyphens: {fix}",
            path.display()
        ))
    }
}

/// Where a host's runs go, relative to the repo root (where `just bench`
/// runs): `data/db/<login>/<machine>.sqlite`.
pub(crate) fn db_path(host: &str) -> PathBuf {
    Path::new("data/db").join(format!("{host}.sqlite"))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use super::{db_path, is_host_id, read_host_file};

    #[test]
    fn a_host_id_is_a_github_login_and_a_machine_name() {
        for id in ["octocat/m1pro", "a/b", "paul-h0/mac-studio-2"] {
            assert!(is_host_id(id), "{id}");
        }
        let too_long = format!("{}/m1", "a".repeat(40));
        for id in [
            "octocat",
            "Octocat/m1",
            "-octo/m1",
            "octo/-m1",
            "octo/",
            "/m1",
            "octo/m1/x",
            "octo/m 1",
            &too_long,
        ] {
            assert!(!is_host_id(id), "{id}");
        }
    }

    fn temp_file(name: &str, content: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("gemm-bench-host-{}-{name}", std::process::id()));
        fs::write(&path, content).expect("write host file");
        path
    }

    #[test]
    fn the_host_file_is_read_trimmed() {
        let path = temp_file("ok", "octocat/m1pro\n");
        assert_eq!(read_host_file(&path).as_deref(), Ok("octocat/m1pro"));
    }

    #[test]
    fn a_missing_or_malformed_host_file_names_the_fix() {
        let missing = read_host_file(Path::new("/nonexistent/.host")).expect_err("missing");
        assert!(missing.contains("just init"), "{missing}");
        let bad = read_host_file(&temp_file("bad", "Pauls-MacBook-Pro\n")).expect_err("malformed");
        assert!(
            bad.contains("just init") && bad.contains("Pauls-MacBook-Pro"),
            "{bad}"
        );
    }

    #[test]
    fn a_host_writes_to_its_own_db() {
        assert_eq!(
            db_path("octocat/m1pro"),
            PathBuf::from("data/db/octocat/m1pro.sqlite")
        );
    }
}
