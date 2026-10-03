//! Builds and links the Swift BNNSGraph shim (`swift/BnnsGraph`) behind the
//! `accelerate-bnns` kernel. Nothing to build off macOS.

fn main() {
    // Recorded with every run as `runs.rustc_version`: rust-toolchain.toml
    // pins the nightly channel, not a date, so contributors' compilers differ.
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".to_owned());
    let version = std::process::Command::new(rustc)
        .arg("-V")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=GEMM_BENCH_RUSTC={version}");

    // Must match `platforms` in Package.swift. BNNSGraph's builder needs
    // macOS 26, which the shim checks at runtime so older macOS still runs
    // every other kernel.
    #[cfg(target_os = "macos")]
    swift_rs::SwiftLinker::new("11.0")
        .with_package("BnnsGraph", "swift/BnnsGraph")
        .link();
}
