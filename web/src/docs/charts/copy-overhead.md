**What it shows.** For each GPU kernel at each size, the share of its end-to-end time spent outside the GPU's own execution: copying the inputs into the GPU's buffers, encoding the work, and copying the result back out.

**How to read it.** The copies grow as N² while the arithmetic grows as N³, so at large N the share falls as the computing takes over. At the smallest sizes the share can be small too, for a different reason: there the GPU's own time is mostly the fixed cost of launching the work, which counts as GPU time, not copying.

**Caveats.** The GPU's own time (`gpu_ms`) is the median over the same timed runs as the end-to-end time. The CPU and GPU share memory on Apple Silicon, so these copies stay within the same RAM rather than crossing a bus. The axis starts at 0 but isn't clamped there, so a negative share in contributed data stays visible.
