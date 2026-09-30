import type { Family } from "./derive";

export interface KernelDoc {
	/** The CSV `kernel` label, as the charts show it. */
	name: string;
	/** What it does, in plain language. */
	what: string;
	/** How it reaches the hardware. */
	via: string;
}

export interface FamilyDoc {
	family: Family;
	/** The heading beside the family's legend name. */
	title: string;
	/** One line: what the family's kernels share. */
	blurb: string;
	kernels: KernelDoc[];
}

/**
 * The About tab's kernel catalogue, in FAMILY_ORDER. The family is written
 * here rather than read off the data with families(), so the catalogue is the
 * same whatever the data holds. docs.test.ts checks the names against the
 * kernel registry in benchmark/src/kernel.rs.
 */
export const KERNEL_DOCS: FamilyDoc[] = [
	{
		family: "serial",
		title: "Single-threaded CPU",
		blurb:
			"One core: these kernels show what the order of memory accesses is worth on its own.",
		kernels: [
			{
				name: "naive-ijk",
				what: "The textbook triple loop: each output value is a row of A times a column of B. Walking down a column of B jumps a whole row ahead in memory at every step, so most reads miss the cache. It's the baseline the optimization ladder and the CPU & AMX speedups start from.",
				via: "Plain Rust loops on one core.",
			},
			{
				name: "ikj",
				what: "The same arithmetic with the two inner loops swapped. The innermost loop now walks along rows of B and C, which sit next to each other in memory, so reads come from cache and the compiler can process several values per instruction (SIMD).",
				via: "Plain Rust on one core, vectorized by the compiler (NEON on Apple Silicon).",
			},
			{
				name: "tiled",
				what: "ikj, working through the matrices in square tiles (the block size), so the parts of A, B and C in use stay in the L1/L2 cache while they're reused.",
				via: "Plain Rust on one core, at each block size measured.",
			},
		],
	},
	{
		family: "parallel",
		title: "Multi-threaded CPU",
		blurb:
			"The same loops spread over several cores. They differ in how they hand out the work.",
		kernels: [
			{
				name: "rayon-ikj",
				what: "ikj with the output rows shared out by Rayon. Threads that finish early take rows from busy ones (work stealing), so fast and slow cores both stay busy.",
				via: "A Rayon parallel iterator, on a thread pool of the measured size.",
			},
			{
				name: "rayon-tiled",
				what: "Rows grouped into chunks, about four chunks per thread, each computed in tiles like tiled. Work stealing balances the chunks across threads.",
				via: "A Rayon parallel iterator over the row chunks.",
			},
			{
				name: "static-ikj",
				what: "Rows split into equal consecutive ranges up front, one per thread, like OpenMP's static schedule. Nothing is rebalanced, so there's no scheduling overhead, but the run lasts as long as its slowest thread.",
				via: "A persistent Rayon thread pool used without stealing: one broadcast hands every thread its fixed range.",
			},
			{
				name: "static-tiled",
				what: "The same fixed split, computed in tiles inside each thread's range.",
				via: "The same pool and broadcast as static-ikj.",
			},
		],
	},
	{
		family: "amx",
		title: "Apple's matrix coprocessor",
		blurb:
			"A matrix unit beside the CPU cores. Apple doesn't document its instructions, so the only way to use it is through Apple's Accelerate library.",
		kernels: [
			{
				name: "accelerate-blas",
				what: "Apple's BLAS matrix multiply (sgemm for f32, dgemm for f64), which runs on AMX on Apple Silicon. Accelerate picks its own threading.",
				via: "A C function call from Rust into Apple's Accelerate framework.",
			},
			{
				name: "accelerate-bnns",
				what: "The same AMX through BNNSGraph, Apple's machine-learning graph API: a one-operation graph, compiled once per matrix size before timing starts. At f16 it also adds up in f16, so it's fast but loses accuracy as N grows.",
				via: "Rust calls a small Swift package, because the BNNSGraph builder is Swift-only (macOS 26+). The package calls Accelerate.",
			},
		],
	},
	{
		family: "gpu",
		title: "Apple GPU (Metal)",
		blurb:
			"The CPU and GPU share memory, but each run still copies the inputs into GPU buffers and the result back out, and that copying is timed.",
		kernels: [
			{
				name: "mps",
				what: "Apple's tuned GPU matrix multiply, MPSMatrixMultiplication from Metal Performance Shaders.",
				via: "Metal's Objective-C API, called from Rust through the objc2 bindings.",
			},
			{
				name: "metal-naive",
				what: "A hand-written GPU program (a compute shader) that runs one GPU thread per output value. Each thread reads its row of A and column of B straight from GPU memory.",
				via: "gemm.metal, compiled from source at run time and dispatched through Metal.",
			},
			{
				name: "metal-tiled",
				what: "The same shader file, tiled: each 16 × 16 group of GPU threads loads a tile of A and one of B into fast on-chip memory and shares them. Each value is then fetched from GPU memory once per group instead of once per thread.",
				via: "The same as metal-naive.",
			},
		],
	},
];
