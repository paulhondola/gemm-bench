**What it shows.** Each tiled kernel's throughput (`tiled`, `static-tiled`, `rayon-tiled`) at every tile size measured, at the selected precision and matrix size. The tile size is the edge of the square block of A, B and C each loop works on. Each point is the kernel's best thread count at that tile size. The x-axis is logarithmic and the y-axis linear.

**How to read it.** Smaller tiles fit in faster caches; larger ones spend less time on loop bookkeeping. The top of each line is that kernel's best tile size for this matrix size. Tiles of 1024 fall off a power-of-two cache-aliasing cliff, which is why the default sweep stops at 256.

**Caveats.** A kernel measured at a single tile size has nothing to sweep and is left out. Read a large, consistent change as a real effect and a small wobble as run-to-run noise.
