// A C interface over BNNSGraph's matmul for `kernels/accelerate_bnns.rs`.
// The graph builder is Swift-only (macOS 26+); BNNS's C API can only load
// compiled Core ML models, and `BNNSMatMul` is deprecated.

import Accelerate

/// One compiled row-major `n`×`n` matmul. Runs `c = a * b` on raw buffers of
/// the element type the graph was built for.
final class Graph {
    let run: (UnsafeMutableRawPointer, UnsafeMutableRawPointer, UnsafeMutableRawPointer) throws -> Void

    init(run: @escaping (UnsafeMutableRawPointer, UnsafeMutableRawPointer, UnsafeMutableRawPointer) throws -> Void) {
        self.run = run
    }
}

/// Retained `Graph` as an opaque pointer, or nil before macOS 26 or if BNNS
/// can't compile the graph.
private func make<T: BNNSScalar>(_: T.Type, _ n: Int) -> UnsafeMutableRawPointer? {
    guard #available(macOS 26, *) else { return nil }
    guard let context = try? BNNSGraph.makeContext({ builder in
        let a = builder.argument(name: "a", dataType: T.self, shape: [n, n])
        let b = builder.argument(name: "b", dataType: T.self, shape: [n, n])
        return [a.matmul(other: b)]
    }) else { return nil }
    let count = n * n
    let graph = Graph { a, b, c in
        func buffer(_ p: UnsafeMutableRawPointer) -> UnsafeMutableBufferPointer<T> {
            UnsafeMutableBufferPointer(start: p.assumingMemoryBound(to: T.self), count: count)
        }
        // Outputs precede inputs, each in declaration order.
        try context.executeFunction(arguments: [buffer(c), buffer(a), buffer(b)])
    }
    return Unmanaged.passRetained(graph).toOpaque()
}

@_cdecl("bnns_graph_make_f16")
public func bnnsGraphMakeF16(_ n: Int) -> UnsafeMutableRawPointer? { make(Float16.self, n) }

@_cdecl("bnns_graph_make_f32")
public func bnnsGraphMakeF32(_ n: Int) -> UnsafeMutableRawPointer? { make(Float.self, n) }

/// `c = a * b`; 0 on success. `a` and `b` are only read.
@_cdecl("bnns_graph_run")
public func bnnsGraphRun(
    _ graph: UnsafeMutableRawPointer,
    _ a: UnsafeMutableRawPointer,
    _ b: UnsafeMutableRawPointer,
    _ c: UnsafeMutableRawPointer
) -> Int32 {
    do {
        try Unmanaged<Graph>.fromOpaque(graph).takeUnretainedValue().run(a, b, c)
        return 0
    } catch {
        return 1
    }
}

@_cdecl("bnns_graph_free")
public func bnnsGraphFree(_ graph: UnsafeMutableRawPointer) {
    Unmanaged<Graph>.fromOpaque(graph).release()
}
