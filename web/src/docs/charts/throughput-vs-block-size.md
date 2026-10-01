**What it shows.** Each blocked kernel's throughput at every block size measured, at the selected precision and matrix size. For the tiled kernels the block size is the tile edge; for `packed` and `rayon-packed` it is the depth of each packed k-block. Each point is the kernel's best thread count at that block size. The x-axis is logarithmic and the y-axis linear.

**How to read it.** Smaller tiles fit in faster caches; larger ones spend less time on loop bookkeeping. A deeper k-block adds each register block into C less often, but its packed slices of A and B take more cache. The top of each line is that kernel's best block size for this matrix size.

**Caveats.** Only blocked kernels record a block size, so only they appear here; a kernel measured at a single block size has nothing to sweep and is left out too. Read a large, consistent change as a real block-size effect and a small wobble as run-to-run noise.
