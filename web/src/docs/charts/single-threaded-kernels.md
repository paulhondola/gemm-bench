**What it shows.** Only the single-threaded CPU kernels (`naive-ijk`, `ikj`, `tiled`, `packed`), at the selected precision and block size, on a y-axis of their own. On the chart above, the threaded and AMX kernels stretch the scale and flatten these lines together.

**How to read it.** Everything here runs on one core. `naive-ijk`, `ikj` and `tiled` do the same arithmetic in different orders, so the gaps between them come from the order of memory accesses alone: `naive-ijk` walks down columns of B and misses the cache, `ikj` walks along rows, and `tiled` also keeps small tiles in the L1/L2 cache while it reuses them. `packed` adds register blocking: it holds a block of C in registers for a whole k-block instead of loading and storing it at every multiply-add, so the multiply-add units set its pace rather than memory.

**Caveats.** Relative doesn't apply to this chart. The band is ±1 standard deviation, capped as on the chart above.
