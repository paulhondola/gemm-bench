**What it shows.** Each packed kernel's throughput (`packed`, `rayon-packed`) at every depth block measured, at the selected precision and matrix size. The depth block (BLIS's KC, `--kc`) is how many steps along the shared dimension each packed slice of A and B covers. Each point is the kernel's best thread count at that depth. The x-axis is logarithmic and the y-axis linear.

**How to read it.** A deeper block adds each register block into C less often, and with threads it saves a round of packing and synchronisation, but its packed slices take more cache. Once the depth reaches N, deeper requests change nothing: the kernel records the depth it actually used as `depth_block_used`.

**Caveats.** A kernel measured at a single depth has nothing to sweep and is left out. In `f16` the depth also moves the error, because each block's sum starts afresh: see the Precision tab's accuracy chart.
