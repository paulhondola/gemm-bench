**What it shows.** One group of bars per element type — 16-, 32- and 64-bit floats (`f16`, `f32`, `f64`) and 32- and 64-bit integers (`i32`, `i64`) — at the selected matrix size, fastest group first. Within a group, each bar is a family's best result: whichever kernel, thread count, tile size and depth block was fastest.

**How to read it.** Narrower types fit more values into each SIMD register and move fewer bytes, so they can run faster, but only where the hardware has fast arithmetic for them. A missing bar means the family has no kernel for that type: the GPU kernels have no `f64`, and the matrix-unit kernels no integers.

**Caveats.** The precision pill is disabled on this tab, because precision is the x-axis. GPU timings are end-to-end, including the copies in and out. GOP/s counts the same 2N³ operations at every type, so integer and float bars compare directly.
