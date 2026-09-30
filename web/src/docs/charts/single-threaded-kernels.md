**What it shows.** Only the single-threaded CPU kernels (`naive-ijk`, `ikj`, `tiled`), at the selected precision and block size, on a y-axis of their own. On the chart above, the threaded and AMX kernels stretch the scale and flatten these lines together.

**How to read it.** Everything here runs on one core, so the differences come from the order of memory accesses alone: `naive-ijk` walks down columns of B and misses the cache, `ikj` walks along rows, and `tiled` also keeps small tiles in the L1/L2 cache while it reuses them.

**Caveats.** Relative doesn't apply to this chart. The band is ±1 standard deviation, capped as on the chart above.
