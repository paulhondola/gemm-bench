**What it shows.** Each tiled kernel's throughput at every tile size (block size) measured, at the selected precision and matrix size. Each point is the kernel's best thread count at that block size. The x-axis is logarithmic and the y-axis linear.

**How to read it.** Smaller tiles fit in faster caches; larger ones spend less time on loop bookkeeping. The top of each line is that kernel's best tile size for this matrix size.

**Caveats.** Only kernels that tile record a block size, so only they appear here; a kernel measured at a single block size has nothing to sweep and is left out too. Read a large, consistent change as a real block-size effect and a small wobble as run-to-run noise.
