use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};

/// The largest database accepted: a full sweep is about 0.8 MB.
pub(super) const MAX_BYTES: u64 = 16 * 1024 * 1024;

/// Git commits symlinks and SQLite follows them, so a link could publish
/// another host's database under this login. Returns the file's size.
pub(super) fn check_unlinked(path: &Path) -> Result<u64, String> {
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
pub(super) fn check_header(bytes: &[u8]) -> Result<(), String> {
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
pub(super) struct Scratch(pub(super) PathBuf);

impl Scratch {
    pub(super) fn new() -> Result<Self, String> {
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
