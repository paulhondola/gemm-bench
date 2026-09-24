//! Builds and links the Swift BNNSGraph shim (`swift/BnnsGraph`) behind the
//! `accelerate-bnns` kernel. Nothing to build off macOS.

fn main() {
    // Must match `platforms` in Package.swift. BNNSGraph's builder needs
    // macOS 26, which the shim checks at runtime so older macOS still runs
    // every other kernel.
    #[cfg(target_os = "macos")]
    swift_rs::SwiftLinker::new("11.0")
        .with_package("BnnsGraph", "swift/BnnsGraph")
        .link();
}
