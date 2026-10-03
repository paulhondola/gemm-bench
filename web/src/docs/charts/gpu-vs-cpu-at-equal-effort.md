**What it shows.** Each GPU kernel's throughput divided by its CPU counterpart's at the same size, at the selected precision. The hand-written shaders (`metal-naive`, `metal-tiled`, `metal-simdgroup`) are divided by the best hand-written multi-threaded CPU kernel, and Apple's `mps` library by the best matrix-unit kernel, which is Apple's library on the CPU side. The y-axis is logarithmic.

**How to read it.** Above the dashed line at 1.0 the GPU wins; below it, the CPU does. Pairing like with like answers a fairer question than raw speed: for the same engineering effort, which chip wins? Hover a point for the CPU kernel and thread count it is divided by.

**Caveats.** A size the counterpart never ran is a gap in the line, not a point. When lines end close together, their end labels share one line of text.
