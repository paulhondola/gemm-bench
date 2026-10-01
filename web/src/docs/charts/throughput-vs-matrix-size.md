**What it shows.** Every CPU and AMX kernel's throughput as the matrices grow, at the selected precision and block size. Each point is the kernel's best thread count at that size. Both axes are logarithmic, and the shaded band around each line spans ±1 standard deviation of its timed runs.

**How to read it.** The gaps between lines show what each technique adds: loop order (`naive-ijk` to `ikj`), cache blocking (`tiled`), register blocking (`packed`), threads (`rayon-*`, `static-*`) and AMX (`accelerate-*`). Turn on **Relative** to re-plot every line as a speedup over `naive-ijk` at the same size.

**Caveats.** GPU kernels aren't drawn here; the GPU tab compares them. The band is a legibility aid, not a confidence interval: at the smallest sizes the spread can exceed the median, so the band's upper edge is capped at twice the line. Kernels without a block size ignore the block-size pill. Relative needs `naive-ijk` results; without them the chart stays in GOP/s.
