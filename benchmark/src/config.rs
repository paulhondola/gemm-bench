use std::{fs, path::Path};

use clap::ValueEnum;
use serde::Deserialize;

use crate::cli::{KernelChoice, Precision};

/// A preset: the sweep dimensions under the same names as the CLI flags.
/// Omitted keys sweep every value; flags on the command line override keys.
// ponytail: dimensions and repetitions only; add output/no-progress if a preset needs them.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub(crate) struct ConfigFile {
    pub(crate) sizes: Option<Vec<usize>>,
    pub(crate) threads: Option<Vec<usize>>,
    kernel: Option<Vec<String>>,
    precision: Option<Vec<String>>,
    pub(crate) block_size: Option<Vec<usize>>,
    pub(crate) repetitions: Option<usize>,
}

impl ConfigFile {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        let text = fs::read_to_string(path)
            .map_err(|error| format!("cannot read config '{}': {error}", path.display()))?;
        toml::from_str(&text)
            .map_err(|error| format!("invalid config '{}': {error}", path.display()))
    }

    pub(crate) fn kernels(&self) -> Result<Option<Vec<KernelChoice>>, String> {
        parse_names(self.kernel.as_deref(), "kernel")
    }

    pub(crate) fn precisions(&self) -> Result<Option<Vec<Precision>>, String> {
        parse_names(self.precision.as_deref(), "precision")
    }
}

/// Parses through clap's `ValueEnum`, so a preset accepts exactly the
/// spellings the CLI does.
fn parse_names<T: ValueEnum>(
    names: Option<&[String]>,
    key: &str,
) -> Result<Option<Vec<T>>, String> {
    names
        .map(|names| {
            names
                .iter()
                .map(|name| {
                    T::from_str(name, false)
                        .map_err(|_| format!("config key '{key}': unknown value '{name}'"))
                })
                .collect()
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsStr, fs, path::Path};

    use super::ConfigFile;

    #[test]
    fn every_preset_parses() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../configs");
        let mut presets = 0;
        for entry in fs::read_dir(&dir).expect("configs/ should exist") {
            let path = entry.expect("readable entry").path();
            if path.extension() != Some(OsStr::new("toml")) {
                continue;
            }
            let preset = ConfigFile::load(&path).unwrap_or_else(|error| panic!("{error}"));
            // precisions.toml names mps, which exists only on macOS.
            #[cfg(target_os = "macos")]
            let _kernels = preset.kernels().unwrap_or_else(|error| panic!("{error}"));
            let _precisions = preset
                .precisions()
                .unwrap_or_else(|error| panic!("{error}"));
            presets += 1;
        }
        assert!(presets > 0, "no presets found in {}", dir.display());
    }
}
