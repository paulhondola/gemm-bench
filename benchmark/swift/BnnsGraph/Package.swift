// swift-tools-version:5.9
import PackageDescription

// Built and linked by `benchmark/build.rs` (swift-rs) for the `accelerate-bnns`
// kernel. The macOS version must match `SwiftLinker::new` there.
let package = Package(
    name: "BnnsGraph",
    platforms: [.macOS(.v11)],
    products: [.library(name: "BnnsGraph", type: .static, targets: ["BnnsGraph"])],
    targets: [.target(name: "BnnsGraph")]
)
